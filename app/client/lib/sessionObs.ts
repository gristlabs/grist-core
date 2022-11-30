/**
 * createSessionObs() creates an observable tied to window.sessionStorage, i.e. preserved for the
 * lifetime of a browser tab for the current origin.
 */
import {safeJsonParse} from 'app/common/gutil';
import {IDisposableOwner, Observable} from 'grainjs';
import {getSessionStorage} from 'app/client/lib/storage';

export interface SessionObs<T> extends Observable<T> {
  pauseSaving(yesNo: boolean): void;
}

/**
 * Creates and returns an Observable tied to sessionStorage, to make its value stick across
 * reloads and navigation, but differ across browser tabs. E.g. whether a side pane is open.
 *
 * The `key` isn't visible to the user, so pick any unique string name. You may include the
 * docId into the key, to remember a separate value for each doc.
 *
 * To use it, you must specify a default, and a validation function: this module exposes a few
 * helpful ones. Some examples:
 *
 *    panelWidth = createSessionObs(owner, "panelWidth", 240, isNumber);  // Has type Observable<number>
 *
 *    import {StringUnion} from 'app/common/StringUnion';
 *    const SomeTab = StringUnion("foo", "bar", "baz");
 *    tab = createSessionObs(owner, "tab", "baz", SomeTab.guard);  // Type Observable<"foo"|"bar"|"baz">
 *
 * You can disable saving to sessionStorage:
 *    panelWidth.pauseSaving(true);
 *    doStuff();
 *    panelWidth.pauseSaving(false);
 *
 */
export function createSessionObs<T>(
  owner: IDisposableOwner|null,
  key: string,
  _default: T,
  isValid: (val: any) => val is T,
): SessionObs<T> {
  function fromString(value: string|null): T {
    const parsed = value == null ? null : safeJsonParse(value, null);
    return isValid(parsed) ? parsed : _default;
  }
  function toString(value: T): string|null {
    return value === _default || !isValid(value) ? null : JSON.stringify(value);
  }
  let _pauseSaving = false;
  const storage = getSessionStorage();
  const obs = Observable.create<T>(owner, fromString(storage.getItem(key)));
  obs.addListener((value: T) => {
    if (_pauseSaving) { return; }
    const stored = toString(value);
    if (stored == null) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, stored);
    }
  });
  return Object.assign(obs, {pauseSaving(yesNo: boolean) { _pauseSaving = yesNo; }});
}

/** Helper functions to check simple types, useful for the `isValid` argument to createSessionObs. */
export function isNumber(t: any): t is number { return typeof t === 'number'; }
export function isBoolean(t: any): t is boolean { return typeof t === 'boolean'; }
export function isString(t: any): t is string { return typeof t === 'string'; }
