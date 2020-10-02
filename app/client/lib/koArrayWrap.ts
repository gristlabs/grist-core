import {KoArray} from 'app/client/lib/koArray';
import {IDisposableOwnerT, MutableObsArray, ObsArray, setDisposeOwner} from 'grainjs';

/**
 * Returns a grainjs ObsArray that reflects the given koArray, mapping small changes using
 * similarly efficient events.
 *
 * (Note that for both ObsArray and koArray, the main purpose in life is to be more efficient than
 * an array-valued observable by handling small changes more efficiently.)
 */
export function createObsArray<T>(
  owner: IDisposableOwnerT<ObsArray<T>> | null,
  koArray: KoArray<T>,
): ObsArray<T> {
  return setDisposeOwner(owner, new KoWrapObsArray(koArray));
}


/**
 * An Observable that wraps a Knockout observable, created via fromKo(). It keeps minimal overhead
 * when unused by only subscribing to the wrapped observable while it itself has subscriptions.
 *
 * This way, when unused, the only reference is from the wrapper to the wrapped object. KoWrapObs
 * should not be disposed; its lifetime is tied to that of the wrapped object.
 */
class KoWrapObsArray<T> extends MutableObsArray<T> {
  private _koSub: any = null;

  constructor(_koArray: KoArray<T>) {
    super(Array.from(_koArray.peek()));

    this._koSub = _koArray.subscribe((splice: any) => {
      const newValues = splice.array.slice(splice.start, splice.start + splice.added);
      this.splice(splice.start, splice.deleted.length, ...newValues);
    }, null, 'spliceChange');
  }

  public dispose(): void {
    this._koSub.dispose();
    super.dispose();
  }
}
