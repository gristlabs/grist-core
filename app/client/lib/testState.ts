import { getBrowserGlobals } from 'app/client/lib/browserGlobals';
import { TestState } from 'app/common/TestState';

const G = getBrowserGlobals('window');

export function setTestState(state: Partial<TestState>) {
  if (!G.window.testGrist) {
    G.window.testGrist = {};
  }
  Object.assign(G.window.testGrist, state);
}

export function getTestState(): TestState {
  if (!G.window.testGrist) {
    G.window.testGrist = {};
  }
  return G.window.testGrist;
}
