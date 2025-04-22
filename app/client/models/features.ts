import {getGristConfig} from 'app/common/urlUtils';
import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {localStorageBoolObs, localStorageJsonObs} from 'app/client/lib/localStorageObs';
import {Observable} from 'grainjs';

/**
 * Are comments enabled by feature flag.
 */
export function COMMENTS(): Observable<boolean> {
  const G = getBrowserGlobals('document', 'window');
  if (!G.window.COMMENTS) {
    G.window.COMMENTS = localStorageBoolObs('feature-comments', Boolean(getGristConfig().featureComments));
  }
  return G.window.COMMENTS;
}

export function GRIST_NEW_ASSISTANT() {
  return Boolean(getGristConfig().featureNewAssistant);
}

export function PERMITTED_CUSTOM_WIDGETS(): Observable<string[]> {
  const G = getBrowserGlobals('document', 'window');
  if (!G.window.PERMITTED_CUSTOM_WIDGETS) {
    G.window.PERMITTED_CUSTOM_WIDGETS =
      localStorageJsonObs('PERMITTED_CUSTOM_WIDGETS', getGristConfig().permittedCustomWidgets || []);
  }
  return G.window.PERMITTED_CUSTOM_WIDGETS;
}
