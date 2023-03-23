import {getGristConfig} from 'app/common/urlUtils';
import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {localStorageBoolObs} from 'app/client/lib/localStorageObs';
import {Observable} from 'grainjs';

export function COMMENTS(): Observable<boolean> {
  const G = getBrowserGlobals('document', 'window');
  if (!G.window.COMMENTS) {
    G.window.COMMENTS = localStorageBoolObs('feature-comments', Boolean(getGristConfig().featureComments));
  }
  return G.window.COMMENTS;
}

export function GRIST_FORMULA_ASSISTANT(): Observable<boolean> {
  const G = getBrowserGlobals('document', 'window');
  if (!G.window.GRIST_FORMULA_ASSISTANT) {
    G.window.GRIST_FORMULA_ASSISTANT =
      localStorageBoolObs('GRIST_FORMULA_ASSISTANT', Boolean(getGristConfig().featureFormulaAssistant));
  }
  return G.window.GRIST_FORMULA_ASSISTANT;
}
