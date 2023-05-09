import {safeJsonParse} from 'app/common/gutil';
import {Observable} from 'grainjs';
import {getSessionStorage, getStorage} from 'app/client/lib/storage';

function getStorageBoolObs(store: Storage, key: string, defValue: boolean) {
  const storedNegation = defValue ? 'false' : 'true';
  const obs = Observable.create(null, store.getItem(key) === storedNegation ? !defValue : defValue);
  obs.addListener((val) => val === defValue ? store.removeItem(key) : store.setItem(key, storedNegation));
  return obs;
}

/**
 * Helper to create a boolean observable whose state is stored in localStorage.
 *
 * Optionally, a default value of true will make the observable start off as true. Note that the
 * same default value should be used for an observable every time it's created.
 */
export function localStorageBoolObs(key: string, defValue = false): Observable<boolean> {
  return getStorageBoolObs(getStorage(), key, defValue);
}

/**
 * Similar to `localStorageBoolObs`, but always uses sessionStorage (or an in-memory equivalent).
 */
export function sessionStorageBoolObs(key: string, defValue = false): Observable<boolean> {
  return getStorageBoolObs(getSessionStorage(), key, defValue);
}

function getStorageObs(store: Storage, key: string, defaultValue?: string) {
  const obs = Observable.create<string|null>(null, store.getItem(key) ?? defaultValue ?? null);
  obs.addListener((val) => (val === null) ? store.removeItem(key) : store.setItem(key, val));
  return obs;
}

/**
 * Helper to create a string observable whose state is stored in localStorage.
 */
export function localStorageObs(key: string, defaultValue?: string): Observable<string|null> {
  return getStorageObs(getStorage(), key, defaultValue);
}

/**
 * Similar to `localStorageObs`, but always uses sessionStorage (or an in-memory equivalent).
 */
export function sessionStorageObs(key: string, defaultValue?: string): Observable<string|null> {
  return getStorageObs(getSessionStorage(), key, defaultValue);
}

/**
 * Helper to create a JSON observable whose state is stored in localStorage.
 */
 export function localStorageJsonObs<T>(key: string, defaultValue: T): Observable<T> {
  const store = getStorage();
  const currentValue = safeJsonParse(store.getItem(key) || '', defaultValue ?? null);
  const obs = Observable.create<T>(null, currentValue);
  obs.addListener((val) => (val === null) ? store.removeItem(key) : store.setItem(key, JSON.stringify(val ?? null)));
  return obs;
}
