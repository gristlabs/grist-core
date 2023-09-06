import {BindableValue, dom} from 'grainjs';

/**
 * Version of makeTestId that can be appended conditionally.
 * TODO: update grainjs typings, as this is already supported there.
 */
export function makeTestId(prefix: string) {
  return (id: string, obs?: BindableValue<boolean>) => dom.cls(prefix + id, obs ?? true);
}
