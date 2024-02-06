import {GristDoc} from 'app/client/components/GristDoc';
import {getStorage} from 'app/client/lib/storage';
import {IDocPage, isViewDocPage, ViewDocPage} from 'app/common/gristUrls';
import {Disposable, Listener, Observable} from 'grainjs';
import {reportError} from 'app/client/models/errors';
import {CursorPos} from 'app/plugin/GristAPI';

/**
 * Enriched cursor position with a view id
 */
export type ViewCursorPos = CursorPos & { viewId: ViewDocPage }

/**
 * Component for GristDoc that allows it to keep track of the latest cursor position.
 * In case, when a document is reloaded abnormally, the latest cursor
 * position should be restored from a local storage.
 */
export class CursorMonitor extends Disposable {

  // abstraction to work with local storage
  private _store: StorageWrapper;
  // key for storing position in the memory (docId + userId)
  private _key: string;
  // flag that tells if the position was already restored
  // we track document's view change event, so we only want
  // to react to that event once
  private _restored = false;

  constructor(
    doc: GristDoc,
    store?: Storage) {
    super();

    this._store = new StorageWrapper(store);

    // Use document id and user id as a key for storage.
    const userId = doc.app.topAppModel.appObs.get()?.currentUser?.id ?? null;
    this._key = doc.docId() + userId;

    /**
     * When document loads last cursor position should be restored from local storage.
     */
    this._whenDocumentLoadsRestorePosition(doc);

    /**
     * When a cursor position changes, its value is stored in a local storage.
     */
    this._whenCursorHasChangedStoreInMemory(doc);
  }

  public clear() {
    this._store.clear(this._key);
  }

  private _whenCursorHasChangedStoreInMemory(doc: GristDoc) {
    // whenever current position changes, store it in the memory
    this.autoDispose(doc.cursorPosition.addListener(pos => {
      // if current position is not restored yet, don't change it
      if (!this._restored) { return; }
      // store position only when we have valid rowId
      // for some views (like CustomView) cursor position might not reflect actual row
      if (pos && pos.rowId !== undefined) {
        if (pos.sectionId) {
          pos = {...pos, linkingRowIds: doc.getLinkingRowIds(pos.sectionId)};
        }
        this._storePosition(pos);
      }
    }));
  }

  private _whenDocumentLoadsRestorePosition(doc: GristDoc) {
    // if doc was opened with a hash link, don't restore last position
    if (doc.hasCustomNav.get()) {
      return this._abortRestore();
    }

    // if we are on raw data view, we need to set the position manually
    // as currentView observable will not be changed.
    if (doc.activeViewId.get() === 'data') {
      this._doRestorePosition(doc).catch((e) => reportError(e));
      return;
    }

    // on view shown
    this.autoDispose(oneTimeListener(doc.currentView, async () => {
      await this._doRestorePosition(doc);
    }));
  }

  private async _doRestorePosition(doc: GristDoc) {
    // if the position was restored for this document do nothing
    if (this._restored) { return; }
    // set that we already restored the position, as some view is shown to the user
    this._restored = true;
    const viewId = doc.activeViewId.get();
    if (!isViewDocPage(viewId)) {
      return this._abortRestore();
    }
    const position = this._readPosition(viewId);
    if (position) {
      // Don't restore position if this is a collapsed section.
      const collapsed = doc.viewModel.activeCollapsedSections.peek();
      if (position.sectionId && collapsed.includes(position.sectionId)) {
        return;
      }
      // Ignore error with finding desired cell.
      await doc.recursiveMoveToCursorPos(position, true, true);
    }
  }

  private _abortRestore() {
    this.clear();
    this._restored = true;
  }

  private _storePosition(pos: ViewCursorPos) {
    this._store.update(this._key, pos);
  }

  private _readPosition(view: IDocPage) {
    const lastPosition = this._store.read(this._key);
    this._store.clear(this._key);
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

export function oneTimeListener<T>(obs: Observable<T>, handler: (value: T) => any) {
  let listener: Listener|null = obs.addListener((value) => {
    setImmediate(dispose);
    handler(value);
  });
  function dispose() {
    if (listener) {
      listener.dispose();
      listener = null;
    }
  }
  return { dispose };
}
