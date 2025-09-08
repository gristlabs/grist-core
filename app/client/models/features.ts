import {getGristConfig} from 'app/common/urlUtils';
import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {localStorageJsonObs} from 'app/client/lib/localStorageObs';
import {Observable} from 'grainjs';

export function PERMITTED_CUSTOM_WIDGETS(): Observable<string[]> {
  const G = getBrowserGlobals('document', 'window');
  if (!G.window.PERMITTED_CUSTOM_WIDGETS) {
    G.window.PERMITTED_CUSTOM_WIDGETS =
      localStorageJsonObs('PERMITTED_CUSTOM_WIDGETS', getGristConfig().permittedCustomWidgets || []);
  }
  return G.window.PERMITTED_CUSTOM_WIDGETS;
}
