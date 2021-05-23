import { CursorPos } from "app/client/components/Cursor";
import { getStorage } from "app/client/lib/localStorageObs";
import { IDocPage } from "app/common/gristUrls";
import { Disposable } from "grainjs";
import { GristDoc } from "app/client/components/GristDoc";

/**
 * Enriched cursor position with a view id
 */
export type ViewCursorPos = CursorPos & { viewId: number }

/**
 * Component for GristDoc that allows it to keep track of the latest cursor position.
 * In case, when a document is reloaded abnormally, the latest cursor
 * position should be restored from a local storage.
 */
export class CursorMonitor extends Disposable {

  // abstraction to work with local storage
  private _store: StorageWrapper;
  // document id that this monitor is attached
  private _docId: string;
  // flag that tells if the position was already restored
  // we track document's view change event, so we only want
  // to react to that event once
  private _restored = false;

  constructor(
    doc: GristDoc,
    store?: Storage) {
    super();

    this._store = new StorageWrapper(store);
    this._docId = doc.docId();

    /**
     * When document loads last cursor position should be restored from local storage.
     */
    this._whenDocumentLoadsRestorePosition(doc);

    /**
     * When a cursor position changes, its value is stored in a local storage.
     */
    this._whenCursorHasChangedStoreInMemory(doc);
  }

  private _whenCursorHasChangedStoreInMemory(doc: GristDoc) {
    // whenever current position changes, store it in the memory
    this.autoDispose(doc.cursorPosition.addListener(pos => {
      // if current position is not restored yet, don't change it
      if (!this._restored) { return; }
      if (pos) { this._storePosition(pos); }
    }));
  }

  private _whenDocumentLoadsRestorePosition(doc: GristDoc) {
    // on view shown
    this.autoDispose(doc.currentView.addListener(async view => {
      // if the position was restored for this document do nothing
      if (this._restored) { return; }
      // set that we already restored the position, as some view is shown to the user
      this._restored = true;
      // if view wasn't rendered (page is displaying history or code view) do nothing
      if (!view) { return; }
      const viewId = doc.activeViewId.get();
      const position = this._restoreLastPosition(viewId);
      if (position) {
        await doc.recursiveMoveToCursorPos(position, true);
      }
    }));
  }

  private _storePosition(pos: ViewCursorPos) {
    this._store.update(this._docId, pos);
  }

  private _restoreLastPosition(view: IDocPage) {
    const lastPosition = this._store.read(this._docId);
    this._store.clear(this._docId);
    if (lastPosition && lastPosition.position.viewId == view) {
      return lastPosition.position;
    }
    return null;
  }
}

// Internal implementations for working with local storage
class StorageWrapper {

  constructor(private _storage = getStorage()) {

  }

  public update(docId: string, position: ViewCursorPos): void {
    try {
      const storage = this._storage;
      const data = { docId, position, timestamp: Date.now() };
      storage.setItem(this._key(docId), JSON.stringify(data));
    } catch (e) {
      console.error("Can't store latest position in storage. Detail error " + e.message);
    }
  }

  public clear(docId: string,): void {
    const storage = this._storage;
    storage.removeItem(this._key(docId));
  }

  public read(docId: string): { docId: string; position: ViewCursorPos; } | undefined {
    const storage = this._storage;
    const result = storage.getItem(this._key(docId));
    if (!result) { return undefined; }
    return JSON.parse(result);
  }

  protected _key(docId: string) {
    return `grist-last-position-${docId}`;
  }
}
