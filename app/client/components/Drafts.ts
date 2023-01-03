import { CellPosition, toCursor } from "app/client/components/CellPosition";
import {
  Disposable, dom, Emitter, Holder, IDisposable, IDisposableOwner,
  IDomArgs, MultiHolder, styled, TagElem
} from "grainjs";
import { GristDoc } from "app/client/components/GristDoc";
import { makeT } from 'app/client/lib/localization';
import { ITooltipControl, showTooltip, tooltipCloseButton } from "app/client/ui/tooltips";
import { FieldEditorStateEvent } from "app/client/widgets/FieldEditor";
import { testId, theme } from "app/client/ui2018/cssVars";
import { cssLink } from "app/client/ui2018/links";

const t = makeT('components.Drafts');

/**
 * Component that keeps track of editor's state (draft value). If user hits an escape button
 * by accident, this component will provide a way to continue the work.
 * Each editor can report its current state, that will be remembered and restored
 * when user whishes to continue his work.
 * Each document can have only one draft at a particular time, that
 * is cleared when changes occur on any other cell or the cursor navigates await from a cell.
 *
 * This component is built as a plugin for GristDoc. GristDoc, FieldBuilder, FieldEditor were just
 * extended in order to provide some public interface that this objects plugs into.
 * To disable the drafts, just simple remove it from GristDoc.
 */
export class Drafts extends Disposable {
  constructor(
    doc: GristDoc
  ) {
    super();

    // Here are all the parts that play some role in this feature

    // Cursor will navigate the cursor on a view to a proper cell
    const cursor: Cursor = CursorAdapter.create(this, doc);
    // Storage will remember last draft
    const storage: Storage = StorageAdapter.create(this);
    // Notification will show notification with button to undo discard
    const notification: Notification = NotificationAdapter.create(this, doc);
    // Tooltip will hover above the editor and offer to continue from last edit
    const tooltip: Tooltip = TooltipAdapter.create(this, doc);
    // Editor will restore its previous state and inform about keyboard events
    const editor: Editor = EditorAdapter.create(this, doc);

    // Here is the main use case describing how parts are connected

    const when = makeWhen(this);

    // When user cancels the editor
    when(editor.cellCancelled, (ev: StateChanged) => {
      // if the state of the editor hasn't changed
      if (!ev.modified) {
        // close the tooltip and notification
        tooltip.close();
        notification.close();
        // don't store the draft - we assume that user
        // actually wanted to discard the draft by pressing
        // escape again
        return;
      }
      // Show notification
      notification.showUndoDiscard();
      // Save draft in memory
      storage.save(ev);
      // Make sure that tooltip is not visible
      tooltip.close();
    });

    // When user clicks notification to continue with the draft
    when(notification.pressed, async () => {
      // if the draft is there
      const draft = storage.get();
      if (draft) {
        // restore the position of a cell
        await cursor.goToCell(draft.position);
        // activate the editor
        await editor.activate();
        // and restore last draft
        editor.setState(draft.state);
      }
      // We don't need the draft any more.
      // If user presses escape one more time it will be created
      // once again
      storage.clear();
      // Close the notification
      notification.close();
      // tooltip is not visible here, and will be shown
      // when editor is activated
    });

    // When user doesn't do anything while the notification is visible
    // remove the draft when it disappears
    when(notification.disappeared, () => {
      storage.clear();
    });

    // When editor is activated (user typed something or double clicked a cell)
    when(editor.activated, (pos: CellPosition) => {
      // if there was a draft for a cell
      if (storage.hasDraftFor(pos)) {
        // show tooltip to continue with a draft
        tooltip.showContinueDraft();
      }
      // make sure that notification is not visible
      notification.close();
    });

    // When editor is modified, close tooltip after some time
    when(editor.cellModified, (_: StateChanged) => {
      tooltip.scheduleClose();
    });

    // When user saves a cell
    when(editor.cellSaved, (_: StateChanged) => {
      // just close everything and clear draft
      storage.clear();
      tooltip.close();
      notification.close();
    });

    // When a user clicks a tooltip to continue with a draft
    when(tooltip.click, () => {
      const draft = storage.get();
      // if there was a draft
      if (draft) {
        // restore the draft
        editor.setState(draft.state);
      }
      // close the tooltip
      tooltip.close();
    });
  }
}

///////////////////////////////////////////////////////////
// Roles definition that abstract the way this feature interacts with Grist

/**
 * Cursor role can navigate the cursor to a proper cell
 */
interface Cursor {
  goToCell(pos: CellPosition): Promise<void>;
}

/**
 * Editor role represents active editor that is attached to a cell.
 */
interface Editor {
  // Occurs when user triggers the save operation (by the enter key, clicking away)
  cellSaved: TypedEmitter<StateChanged>;
  // Occurs when user triggers the save operation (by the enter key, clicking away)
  cellModified: TypedEmitter<StateChanged>;
  // Occurs when user typed something on a cell or double clicked it
  activated: TypedEmitter<CellPosition>;
  // Occurs when user cancels the edit (mainly by the escape key or by icon on mobile)
  cellCancelled: TypedEmitter<StateChanged>;
  // Editor can restore its state
  setState(state: any): void;
  // Editor can be shown up to the user on active cell
  activate(): Promise<void>;
}

/**
 * Notification that is shown to the user on the right bottom corner
 */
interface Notification {
  // Occurs when user clicked the notification
  pressed: Signal;
  // Occurs when notification disappears with no action from a user
  disappeared: Signal;
  // Notification can be closed if it is visible
  close(): void;
  // Show notification to the user, to inform him that he can continue with the draft
  showUndoDiscard(): void;
}

/**
 * Storage abstraction. Is responsible for storing latest
 * draft (position and state)
 */
interface Storage {
  // Retrieves latest draft data
  get(): State | null;
  // Stores latest draft data
  save(ev: State): void;
  // Checks if there is draft data at the position
  hasDraftFor(position: CellPosition): boolean;
  // Removes draft data
  clear(): void;
}

/**
 * Tooltip role is responsible for showing tooltip over active field editor with an information
 * that the drafts is available, and a button to continue with the draft
 */
interface Tooltip {
  // Occurs when user clicks the button on the tooltip - so he wants
  // to continue with the draft
  click: Signal;
  // Show tooltip over active cell editor
  showContinueDraft(): void;
  // Close tooltip
  close(): void;
  // Close tooltip after some time
  scheduleClose(): void;
}

/**
 * Schema of the information that is stored in the storage.
 */
interface State {
  // State of the editor
  state: any;
  // Cell position where the draft was created
  position: CellPosition;
}

/**
 * Event that is emitted when editor state has changed
 */
interface StateChanged extends State {
  modified: boolean;
}

///////////////////////////////////////////////////////////
// Here are all the adapters for the roles above. They
// abstract the way this feature interacts with the GristDoc

class CursorAdapter extends Disposable implements Cursor {
  constructor(private _doc: GristDoc) {
    super();
  }
  public async goToCell(pos: CellPosition): Promise<void> {
    await this._doc.recursiveMoveToCursorPos(toCursor(pos, this._doc.docModel), true);
  }
}

class StorageAdapter extends Disposable implements Storage {
  private _memory: State | null;
  public get(): State | null {
    return this._memory;
  }
  public save(ev: State) {
    this._memory = ev;
  }
  public hasDraftFor(position: CellPosition): boolean {
    const item = this._memory;
    if (item && CellPosition.equals(item.position, position)) {
      return true;
    }
    return false;
  }
  public clear(): void {
    this._memory = null;
  }
}

class NotificationAdapter extends Disposable implements Notification {
  public readonly pressed: Signal;
  public readonly disappeared: Signal;
  private _hadAction = false;
  private _holder = Holder.create(this);

  constructor(private _doc: GristDoc) {
    super();
    this.pressed = this.autoDispose(new Emitter());
    this.disappeared = this.autoDispose(new Emitter());
  }
  public close(): void {
    this._hadAction = true;
    this._holder.clear();
  }
  public showUndoDiscard() {
    const notifier = this._doc.app.topAppModel.notifier;
    const notification = notifier.createUserMessage(t("Undo discard"), {
      message: () =>
        discardNotification(
          dom.on("click", () => {
            this._hadAction = true;
            this.pressed.emit();
          })
        )
    });
    notification.onDispose(() => {
      if (!this._hadAction) {
        this.disappeared.emit();
      }
    });
    this._holder.autoDispose(notification);
    this._hadAction = false;
  }
}

class TooltipAdapter extends Disposable implements Tooltip {
  public readonly click: Signal;

  // there can be only one tooltip at a time
  private _tooltip: ITooltipControl | null = null;
  private _scheduled = false;

  constructor(private _doc: GristDoc) {
    super();
    this.click = this.autoDispose(new Emitter());

    // make sure that the tooltip is closed when this object gets disposed
    this.onDispose(() => {
      this.close();
    });
  }

  public scheduleClose(): void {
    if (this._tooltip && !this._scheduled) {
      this._scheduled = true;
      const origClose = this._tooltip.close;
      this._tooltip.close = () => { clearTimeout(timer); origClose(); };
      const timer = setTimeout(this._tooltip.close, 6000);
    }
  }

  public showContinueDraft(): void {
    // close tooltip if there was a previous one
    this.close();

    // get the editor dom
    const editorDom = this._doc.activeEditor.get()?.getDom();
    if (!editorDom) {
      return;
    }

    // attach the tooltip
    this._tooltip = showTooltip(
      editorDom,
      cellTooltip(() => this.click.emit()));
  }

  public close(): void {
    this._scheduled = false;
    this._tooltip?.close();
    this._tooltip = null;
  }
}

class EditorAdapter extends Disposable implements Editor {
  public readonly cellSaved: TypedEmitter<StateChanged> = this.autoDispose(new Emitter());
  public readonly cellModified: TypedEmitter<StateChanged> = this.autoDispose(new Emitter());
  public readonly activated: TypedEmitter<CellPosition> = this.autoDispose(new Emitter());
  public readonly cellCancelled: TypedEmitter<StateChanged> = this.autoDispose(new Emitter());

  private _holder = Holder.create<MultiHolder>(this);

  constructor(private _doc: GristDoc) {
    super();

    // observe active editor
    this.autoDispose(_doc.activeEditor.addListener((editor) => {
      if (!editor) {
        return;
      }

      // when the editor is created we assume that it is visible to the user
      this.activated.emit(editor.cellPosition());

      // Auto dispose the previous MultiHolder along with all the previous listeners, and create a
      // new MultiHolder for the new ones.
      const mholder = MultiHolder.create(this._holder);

      mholder.autoDispose(editor.changeEmitter.addListener((e: FieldEditorStateEvent) => {
        this.cellModified.emit({
          position: e.position,
          state: e.currentState,
          modified: e.wasModified
        });
      }));

      // when user presses escape
      mholder.autoDispose(editor.cancelEmitter.addListener((e: FieldEditorStateEvent) => {
        this.cellCancelled.emit({
          position: e.position,
          state: e.currentState,
          modified: e.wasModified
        });
      }));

      // when user presses enter to save the value
      mholder.autoDispose(editor.saveEmitter.addListener((e: FieldEditorStateEvent) => {
        this.cellSaved.emit({
          position: e.position,
          state: e.currentState,
          modified: e.wasModified
        });
      }));
    }));
  }

  public setState(state: any): void {
    // rebuild active editor with a state from a draft
    this._doc.activeEditor.get()?.rebuildEditor(undefined, Number.POSITIVE_INFINITY, state);
  }

  public async activate() {
    // open up the editor at current position
    await this._doc.activateEditorAtCursor({});
  }
}

///////////////////////////////////////////////////////////
// Ui components

// Cell tooltip to restore the draft - it is visible over active editor
const styledTooltip = styled('div', `
  display: flex;
  align-items: center;
  --icon-color: ${theme.controlFg};

  & > .${cssLink.className} {
    margin-left: 8px;
  }
`);

function cellTooltip(clb: () => any) {
  return function (ctl: ITooltipControl) {
    return styledTooltip(
      cssLink(t("Restore last edit"),
        dom.on('mousedown', (ev) => { ev.preventDefault(); ctl.close(); clb(); }),
        testId('draft-tooltip'),
      ),
      tooltipCloseButton(ctl),
    );
  };
}

// Discard notification dom
const styledNotification = styled('div', `
  cursor: pointer;
  color: ${theme.controlFg};
  &:hover {
    text-decoration: underline;
  }
`);
function discardNotification(...args: IDomArgs<TagElem<"div">>) {
  return styledNotification(
    t("Undo discard"),
    testId("draft-notification"),
    ...args
  );
}

///////////////////////////////////////////////////////////
// Internal implementations - not relevant to main use case

// helper method to listen to the Emitter and dispose the listener with a parent
function makeWhen(owner: IDisposableOwner) {
  return function <T extends EmitterType<any>>(emitter: T, handler: EmitterHandler<T>) {
    owner.autoDispose(emitter.addListener(handler as any));
  };
}

// Default emitter is not typed, this augments the Emitter interface
interface TypedEmitter<T> {
  emit(item: T): void;
  addListener(clb: (e: T) => any): IDisposable;
}
interface Signal {
  emit(): void;
  addListener(clb: () => any): IDisposable;
}
type EmitterType<T> = T extends TypedEmitter<infer E> ? TypedEmitter<E> : Signal;
type EmitterHandler<T> = T extends TypedEmitter<infer E> ? ((e: E) => any) : () => any;
