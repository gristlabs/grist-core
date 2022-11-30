/**
 * Expose localStorage and sessionStorage with fallbacks for cases when they don't work (e.g.
 * cross-domain embeds in Firefox and Safari).
 *
 * Usage:
 *    import {getStorage, getSessionStorage} from 'app/client/lib/storage';
 *    ... use getStorage() in place of localStorage...
 *    ... use getSessionStorage() in place of sessionStorage...
 */

/**
 * Returns localStorage if functional, or sessionStorage, or an in-memory storage. The fallbacks
 * help with tests, and when Grist is embedded.
 */
export function getStorage(): Storage {
  _storage ??= testStorage('localStorage') || getSessionStorage();
  return _storage;
}

/**
 * Return window.sessionStorage, or when not available, an in-memory storage.
 */
export function getSessionStorage(): Storage {
  // If can't use sessionStorage, fall back to a Map-based non-persistent implementation.
  _sessionStorage ??= testStorage('sessionStorage') || createInMemoryStorage();
  return _sessionStorage;
}


let _storage: Storage|undefined;
let _sessionStorage: Storage|undefined;

/**
 * Returns the result of window[storageName] if storage is functional, or null otherwise. In some
 * cases (e.g. when embedded), using localStorage may throw errors, in which case we return null.
 * This is similar to the approach taken by store.js.
 */
function testStorage(storageName: 'localStorage'|'sessionStorage'): Storage|null {
  try {
    const testStr = '__localStorage_test';
    const storage = window[storageName];
    storage.setItem(testStr, testStr);
    const ok = (storage.getItem(testStr) === testStr);
    storage.removeItem(testStr);
    if (ok) {
      return storage;
    }
  } catch (e) {
    // Fall through
  }
  console.warn(`${storageName} is not available; will use fallback`);
  return null;
}

function createInMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    setItem(key: string, val: string) { values.set(key, val); },
    getItem(key: string) { return values.get(key) ?? null; },
    removeItem(key: string) { values.delete(key); },
    clear() { values.clear(); },
    get length() { return values.size; },
    key(index: number): string|null { throw new Error('Not implemented'); },
  };
}
