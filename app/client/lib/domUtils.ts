import {useBindable} from 'app/common/gutil';
import {BindableValue, dom} from 'grainjs';

/**
 * Version of makeTestId that can be appended conditionally.
 */
export function makeTestId(prefix: string) {
  return (id: BindableValue<string>, obs?: BindableValue<boolean>) => {
    return dom.cls(use => {
      if (obs !== undefined && !useBindable(use, obs)) {
        return '';
      }
      return `${useBindable(use, prefix)}${useBindable(use, id)}`;
    });
  };
}
