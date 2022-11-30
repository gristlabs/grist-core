import {CellPosition, toCursor} from 'app/client/components/CellPosition';
import {oneTimeListener} from 'app/client/components/CursorMonitor';
import {GristDoc} from 'app/client/components/GristDoc';
import {getStorage} from 'app/client/lib/storage';
import {UserError} from 'app/client/models/errors';
import {FieldEditor, FieldEditorStateEvent} from 'app/client/widgets/FieldEditor';
import {isViewDocPage} from 'app/common/gristUrls';
import {Disposable, Emitter, IDisposableOwner} from 'grainjs';

/**
 * Feature for GristDoc that allows it to keep track of current editor's state.
 * State is stored in local storage by default.
 */
export class EditorMonitor extends Disposable {

  // abstraction to work with local storage
  private _store: EditMemoryStorage;
  private _restored = false;

  constructor(
    doc: GristDoc,
    store?: Storage) {
    super();

    // create store
    const userId = doc.app.topAppModel.appObs.get()?.currentUser?.id ?? null;
    // use document id and user id as a key for storage
    const key = doc.docId() + userId;
    this._store = new EditMemoryStorage(key, store);

    // listen to document events to handle view load event
    this._listenToReload(doc).catch((err) => {
      if (!(err instanceof UserError)) {
        throw err;
      }
      // Don't report UserErrors for this feature (should not happen as
      // the only error that is thrown was silenced by recursiveMoveToCursorPos)
      console.error(`Error while restoring last edit position`, err);
    });
  }

  /**
   * Monitors a field editor and updates latest edit position
   * @param editor Field editor to track
   */
  public monitorEditor(editor: FieldEditor) {
    // typed helper to connect to the emitter
    const on = typedListener(this);
    // When user cancels the edit process, discard the memory of the last edited cell.
    on(editor.cancelEmitter, (event) => {
      this._store.clear();
    });
    // When saves a cell, discard the memory of the last edited cell.
    on(editor.saveEmitter, (event) => {
      this._store.clear();
    });
    // When user types in the editor, store its state
    on(editor.changeEmitter, (event) => {
      this._store.updateValue(event.position, event.currentState);
    });
  }

  /**
   * When document gets reloaded, restore last cursor position and a state of the editor.
   * Returns last edited cell position and saved editor state or undefined.
   */
  private async _listenToReload(doc: GristDoc) {
    // don't restore on readonly mode or when there is custom nav
    if (doc.isReadonly.get() || doc.hasCustomNav.get()) {
      this._store.clear();
      return;
     }
    // if we are on raw data view, we need to set the position manually
    // as currentView observable will not be changed.
    if (doc.activeViewId.get() === 'data') {
      await this._doRestorePosition(doc);
    } else {
      // on view shown
      this.autoDispose(oneTimeListener(doc.currentView, async () => {
        await this._doRestorePosition(doc);
      }));
    }
  }

  private async _doRestorePosition(doc: GristDoc) {
    if (this._restored) {
      return;
    }
    this._restored = true;
    const viewId = doc.activeViewId.get();
    // if view wasn't rendered (page is displaying history or code view) do nothing
    if (!isViewDocPage(viewId)) {
      this._store.clear();
      return;
     }
    const lastEdit = this._store.readValue();
    if (lastEdit) {
      // set the cursor at right cell
      await doc.recursiveMoveToCursorPos(toCursor(lastEdit.position, doc.docModel), true, true);
      // activate the editor
      await doc.activateEditorAtCursor({ state: lastEdit.value });
    }
  }
}

// Internal implementation, not relevant to the main use case

// typed listener for the Emitter class
function typedListener(owner: IDisposableOwner) {
  return function (emitter: Emitter, clb: (e: FieldEditorStateEvent) => any) {
    owner.autoDispose(emitter.addListener(clb));
  };
}

// Marker for a editor state - each editor can report any data as long as it is serialized
type EditorState = any;

// Schema for value stored in the local storage
interface LastEditData {
  // absolute position for a cell
  position: CellPosition;
  // editor's state
  value: EditorState;
}

// Abstraction for working with local storage
class EditMemoryStorage {

  private _entry: LastEditData | null = null;
  private _timestamp = 0;

  constructor(private _key: string, private _storage = getStorage()) {
  }

  public updateValue(pos: CellPosition, value: EditorState): void {
    this._entry = { position: pos, value: value };
    this.save();
  }

  public readValue(): LastEditData | null {
    this.load();
    return this._entry;
  }

  public clear(): void {
    this._entry = null;
    this.save();
  }

  public timestamp(): number {
    return this._timestamp;
  }

  protected _storageKey() {
    return `grist-last-edit-${this._key}`;
  }

  protected load() {
    const storage = this._storage;
    const data = storage.getItem(this._storageKey());
    this._entry = null;
    this._timestamp = 0;

    if (data) {
      try {
        const { entry, timestamp } = JSON.parse(data);
        if (typeof entry === 'undefined' || typeof timestamp != 'number') {
          console.error("[EditMemory] Data in local storage has a different structure");
          return;
        }
        this._entry = entry;
        this._timestamp = timestamp;
      } catch (e) {
        console.error("[EditMemory] Can't deserialize date from local storage");
      }
    }
  }

  protected save(): void {
    const storage = this._storage;

    // if entry was removed - clear the storage
    if (!this._entry) {
      storage.removeItem(this._storageKey());
      return;
    }

    try {
      this._timestamp = Date.now();
      const data = { timestamp: this._timestamp, entry: this._entry };
      storage.setItem(this._storageKey(), JSON.stringify(data));
    } catch (ex) {
      console.error("Can't save current edited cell state. Error message: " + ex?.message);
    }
  }
}
