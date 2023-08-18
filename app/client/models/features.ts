import {getGristConfig} from 'app/common/urlUtils';
import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {localStorageBoolObs} from 'app/client/lib/localStorageObs';
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

/**
 * Does backend supports AI assistant.
 */
export function HAS_FORMULA_ASSISTANT() {
  return Boolean(getGristConfig().featureFormulaAssistant);
}

export function WHICH_FORMULA_ASSISTANT() {
  return getGristConfig().assistantService;
}
