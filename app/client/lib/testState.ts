import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {TestState} from 'app/common/TestState';

const G = getBrowserGlobals('window');

export function setTestState(state: Partial<TestState>) {
  if (!('testGrist' in G.window)) {
    G.window.testGrist = {};
  }
  Object.assign(G.window.testGrist, state);
}
