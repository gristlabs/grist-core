import {Observable} from 'grainjs';

/**
 * Helper to create a boolean observable whose state is stored in localStorage.
 */
export function localStorageBoolObs(key: string): Observable<boolean> {
  const obs = Observable.create(null, Boolean(localStorage.getItem(key)));
  obs.addListener((val) => val ? localStorage.setItem(key, 'true') : localStorage.removeItem(key));
  return obs;
}

/**
 * Helper to create a string observable whose state is stored in localStorage.
 */
export function localStorageObs(key: string): Observable<string|null> {
  const obs = Observable.create<string|null>(null, localStorage.getItem(key));
  obs.addListener((val) => (val === null) ? localStorage.removeItem(key) : localStorage.setItem(key, val));
  return obs;
}
