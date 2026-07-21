import { reportError } from "app/client/models/errors";
import { SaveableObjObservable } from "app/client/models/modelUtil";

import { Computed, IDisposableOwner } from "grainjs";

/**
 * obsPropWithSaveOnWrite(owner, observable, prop, fallback) creates an observable for
 * observable()[prop], similar to fieldWithDefault(jsonObservable.prop(prop), fallback), but
 * without involving jsonObservable's per-property knockout machinery.
 *
 * On write, it sets and saves the full object with the one property updated, using
 * `setAndSaveOrRevert`. Writing a value equal to the one currently shown is a no-op, so that
 * e.g. re-selecting the current option of a select() doesn't produce an empty user action.
 */
export function obsPropWithSaveOnWrite<Props extends object, Key extends keyof Props, Val extends Props[Key]>(
  owner: IDisposableOwner,
  obs: SaveableObjObservable<Props>,
  prop: Key,
  fallback: Val,
): Computed<NonNullable<Props[Key]> | Val> {
  return Computed.create(owner, use => use(obs)[prop] ?? fallback)
    .onWrite((value) => {
      if (value !== (obs.peek()[prop] ?? fallback)) {
        obs.setAndSaveOrRevert({ ...obs.peek(), [prop]: value }).catch(reportError);
      }
    });
}
