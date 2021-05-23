import { getStorage } from "app/client/lib/localStorageObs";
import { Disposable, Emitter, Holder, IDisposableOwner } from "grainjs";
import { GristDoc } from "app/client/components/GristDoc";
import { FieldEditor, FieldEditorStateEvent } from "app/client/widgets/FieldEditor";
import { CellPosition, toCursor } from "app/client/components/CellPosition";

/**
 * Feature for GristDoc that allows it to keep track of current editor's state.
 * State is stored in local storage by default.
 */
export class EditorMonitor extends Disposable {

  // abstraction to work with local storage
  private _store: EditMemoryStorage;
  // Holds a listener that is attached to the current view.
  // It will be cleared after first trigger.
  private _currentViewListener = Holder.create(this);

  constructor(
    doc: GristDoc,
    store?: Storage) {
    super();

    // create store
    this._store = new EditMemoryStorage(doc.docId(), store);

    // listen to document events to handle view load event
    this._listenToReload(doc);
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
  private _listenToReload(doc: GristDoc) {
    // subscribe to the current view event on the GristDoc, but make sure that the handler
    // will be invoked only once
    let executed = false;

    // on view shown
    this._currentViewListener.autoDispose(doc.currentView.addListener(async view => {
      if (executed) {
        // remove the listener - we can't do it while the listener is actively executing
        setImmediate(() => this._currentViewListener.clear());
        return;
      }
      executed = true;
      // if view wasn't rendered (page is displaying history or code view) do nothing
      if (!view) { return; }
      const lastEdit = this._restorePosition();
      if (lastEdit) {
        // set the cursor at right cell
        await doc.recursiveMoveToCursorPos(toCursor(lastEdit.position, doc.docModel), true);
        // activate the editor
        await doc.activateEditorAtCursor({ state: lastEdit.value });
      }
    }));
  }

  // read the value from the storage
  private _restorePosition() {
    const entry = this._store.readValue();
    return entry;
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

  constructor(private _docId: string, private _storage = getStorage()) {
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

  protected _key() {
    return `grist-last-edit-${this._docId}`;
  }

  protected load() {
    const storage = this._storage;
    const data = storage.getItem(this._key());
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
      storage.removeItem(this._key());
      return;
    }

    try {
      this._timestamp = Date.now();
      const data = { timestamp: this._timestamp, entry: this._entry };
      storage.setItem(this._key(), JSON.stringify(data));
    } catch (ex) {
      console.error("Can't save current edited cell state. Error message: " + ex?.message);
    }
  }
}
