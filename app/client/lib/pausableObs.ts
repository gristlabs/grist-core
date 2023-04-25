import {IDisposableOwner, Observable} from 'grainjs';

export interface PausableObservable<T> extends Observable<T> {
  pause(shouldPause?: boolean): void;
}

/**
 * Creates and returns an `Observable` that can be paused, effectively causing all
 * calls to `set` to become noops until unpaused, at which point the last value
 * passed to set, if any, will be applied.
 *
 * NOTE: It's only advisable to use this when there are no other alternatives; pausing
 * updates and notifications to subscribers increases the chances of introducing bugs.
 */
export function createPausableObs<T>(
  owner: IDisposableOwner|null,
  value: T,
): PausableObservable<T> {
  let _isPaused = false;
  let _lastValue: T | undefined = undefined;
  const obs = Observable.create<T>(owner, value);
  const set = Symbol('set');
  return Object.assign(obs, {
    pause(shouldPause: boolean = true) {
      _isPaused = shouldPause;
      if (shouldPause) {
        _lastValue = undefined;
      } else if (_lastValue) {
        obs.set(_lastValue);
        _lastValue = undefined;
      }
    },
    [set]: obs.set,
    set(val: T) {
      _lastValue = val;
      if (_isPaused) { return; }

      this[set](val);
    }
  });
}
