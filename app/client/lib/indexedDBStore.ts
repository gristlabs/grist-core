/**
 * A key-value store backed by IndexedDB, with an in-memory fallback for cases when IndexedDB
 * doesn't work. Unlike localStorage, it can hold larger values, but can't be read synchronously.
 *
 * Usage:
 *    import {getIndexedDBStore} from 'app/client/lib/indexedDBStore';
 */

/**
 * A key-value store with asynchronous access. Values are stored as objects, not JSON strings.
 */
export interface KeyValueStore {
  getItem<T>(key: string): Promise<T | undefined>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Returns the values of all keys starting with `keyPrefix`, sorted by key. */
  getItems<T>(keyPrefix: string): Promise<T[]>;
  /** Returns false if values are only kept in memory, and won't survive a page reload. */
  isPersistent(): Promise<boolean>;
}

/**
 * Returns a {@link KeyValueStore} backed by IndexedDB, or an in-memory store if IndexedDB is not
 * available. Calls made while IndexedDB is still opening wait for it to finish. If the connection
 * is lost, the next call reopens it.
 *
 * IndexedDB stores structured clones of values, while the in-memory fallback keeps references to
 * them. So don't mutate a value after storing it, and don't rely on class instances surviving.
 */
export function getIndexedDBStore(): KeyValueStore {
  _indexedDBStore ??= createLazyStore(onClose =>
    openIndexedDBStore(onClose).then(store => store || createInMemoryStore()),
  );
  return _indexedDBStore;
}

let _indexedDBStore: KeyValueStore | undefined;

const INDEXED_DB_NAME = "grist";
const INDEXED_DB_STORE = "keyval";
const INDEXED_DB_OPEN_TIMEOUT_MS = 5000;

/**
 * Upgrades the database from one version to the next: the migration at index `i` upgrades it
 * from version `i` to version `i + 1`, so the current version is the number of migrations.
 *
 * To change the database, append a migration. Never change or remove existing ones, since
 * databases in users' browsers may be at any earlier version.
 */
const INDEXED_DB_MIGRATIONS: ((db: IDBDatabase, tx: IDBTransaction) => void)[] = [
  db => db.createObjectStore(INDEXED_DB_STORE),
];

/**
 * Opens the IndexedDB database, resolving to null if it fails or takes too long to open. In some
 * browsers (e.g. Safari 14), opening it can hang indefinitely.
 */
function openIndexedDBStore(onClose: () => void): Promise<KeyValueStore | null> {
  return new Promise((resolve) => {
    let settled = false;
    const fail = () => {
      if (settled) { return; }

      settled = true;
      clearTimeout(timeout);
      console.warn("indexedDB is not available; will use fallback");
      resolve(null);
    };
    const timeout = setTimeout(fail, INDEXED_DB_OPEN_TIMEOUT_MS);
    try {
      const request = window.indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_MIGRATIONS.length);
      request.onupgradeneeded = (event) => {
        for (const migrate of INDEXED_DB_MIGRATIONS.slice(event.oldVersion)) {
          migrate(request.result, request.transaction!);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          db.close();
          return;
        }

        settled = true;
        clearTimeout(timeout);
        // Fired if the browser closes the connection, e.g. when the user clears site data.
        db.addEventListener("close", onClose);
        // Fired when another tab opens a newer version of the database, which can't be upgraded
        // until this connection is closed. Closing it doesn't fire "close", so call onClose too.
        db.addEventListener("versionchange", () => {
          db.close();
          onClose();
        });
        resolve(createIndexedDBStore(db, onClose));
      };
      request.onerror = fail;
    } catch (e) {
      fail();
    }
  });
}

function createIndexedDBStore(db: IDBDatabase, onClose: () => void): KeyValueStore {
  // Runs a request in its own transaction, resolving once the transaction is committed.
  function run(mode: IDBTransactionMode, makeRequest: (store: IDBObjectStore) => IDBRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(INDEXED_DB_STORE, mode);
      } catch (e) {
        onClose();
        throw e;
      }
      const request = makeRequest(tx.objectStore(INDEXED_DB_STORE));
      tx.oncomplete = () => resolve(request.result);
      // A failed request aborts its transaction, as does a failed commit (e.g. when over quota),
      // or the connection being closed. In all of these cases, tx.error is set to the cause; it's
      // only null if tx.abort() is called explicitly.
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  }

  return {
    getItem: key => run("readonly", store => store.get(key)),
    setItem: (key, value) => run("readwrite", store => store.put(value, key)),
    removeItem: key => run("readwrite", store => store.delete(key)),
    // Keys are compared by UTF-16 code units, and "\uffff" is the largest one, so every key that
    // starts with `keyPrefix` falls between `keyPrefix` and `keyPrefix + "\uffff"`. getAll()
    // returns values sorted by key.
    getItems: keyPrefix => run("readonly", store => store.getAll(IDBKeyRange.bound(keyPrefix, keyPrefix + "\uffff"))),
    isPersistent: async () => true,
  };
}

function createInMemoryStore(): KeyValueStore {
  const values = new Map<string, any>();
  return {
    async getItem(key: string) { return values.get(key); },
    async setItem(key: string, value: any) { values.set(key, value); },
    async removeItem(key: string) { values.delete(key); },
    async getItems(keyPrefix: string) {
      return [...values.keys()].filter(key => key.startsWith(keyPrefix)).sort().map(key => values.get(key));
    },
    async isPersistent() { return false; },
  };
}

/**
 * Returns a {@link KeyValueStore} that forwards each call to the store returned by `open`. The
 * store is opened on first use, and again after it calls `onClose`.
 */
function createLazyStore(open: (onClose: () => void) => Promise<KeyValueStore>): KeyValueStore {
  let store: Promise<KeyValueStore> | undefined;
  const getOpenStore = () => {
    if (!store) {
      const opened = open(() => {
        if (store === opened) { store = undefined; }
      });
      store = opened;
    }
    return store;
  };
  return {
    async getItem(key: string) { return (await getOpenStore()).getItem(key); },
    async setItem(key: string, value: any) { return (await getOpenStore()).setItem(key, value); },
    async removeItem(key: string) { return (await getOpenStore()).removeItem(key); },
    async getItems(keyPrefix: string) { return (await getOpenStore()).getItems(keyPrefix); },
    async isPersistent() { return (await getOpenStore()).isPersistent(); },
  };
}
