/**
 * Replicates some of grainjs's fromKo, except that the returned observables have a set() method
 * which calls koObs.saveOnly(val) rather than koObs(val).
 */
import {IKnockoutObservable, KoWrapObs, Observable} from 'grainjs';

const wrappers: WeakMap<IKnockoutObservable<any>, Observable<any>> = new WeakMap();

/**
 * Returns a Grain.js observable which mirrors a Knockout observable.
 *
 * Do not dispose this wrapper, as it is shared by all code using koObs, and its lifetime is tied
 * to the lifetime of koObs. If unused, it consumes minimal resources, and should get garbage
 * collected along with koObs.
 */
export function fromKoSave<T>(koObs: IKnockoutObservable<T>): Observable<T> {
  return wrappers.get(koObs) || wrappers.set(koObs, new KoSaveWrapObs(koObs)).get(koObs)!;
}

export class KoSaveWrapObs<T> extends KoWrapObs<T> {
  constructor(_koObs: IKnockoutObservable<T>) {
    if (!('saveOnly' in _koObs)) {
      throw new Error('fromKoSave needs a saveable observable');
    }
    super(_koObs);
  }

  public set(value: T): void {
    // Hacky cast to get a private member. TODO: should make it protected instead.
    (this as any)._koObs.saveOnly(value);
  }
}
