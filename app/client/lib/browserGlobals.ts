/**
 * Module that allows client-side code to use browser globals (such as `document` or `Node`) in a
 * way that allows those globals to be replaced by mocks in browser-less tests.
 *
 * E.g. test/client/clientUtil.js can replace globals with those provided by jsdom.
 */

type OrigGlobals = typeof globalThis;

interface Globals extends Partial<OrigGlobals> {
  $?: JQueryStatic;           // Some old code still uses JQuery events.
  globalThis?: OrigGlobals;   // Workaround for a typings error due to OrigGlobals.globalThis being readonly
}

type PossibleNames = keyof Globals;

interface RequestedGlobals {
  neededNames: PossibleNames[];
  globals: Globals;
}

const allGlobals: RequestedGlobals[] = [];

let globalVars: Globals = (typeof window !== 'undefined' ? window : {});

/**
 * Usage: to get access to global variables like `document` and `window`, call:
 *
 *    import {getBrowserGlobals} from 'app/client/lib/browserGlobals';
 *    const G = getBrowserGlobals('document', 'window');
 *
 * and use G.document and G.window.
 *
 * This modules stores a reference to G, so that setGlobals() call can replace the values to which
 * G.document and G.window refer.
 */
export function get<Names extends PossibleNames[]>(...neededNames: Names): Required<Pick<Globals, Names[number]>> {
  const obj = {
    neededNames,
    globals: {},
  };
  updateGlobals(obj);
  allGlobals.push(obj);
  return obj.globals as Required<Pick<Globals, Names[number]>>;
}

export const getBrowserGlobals = get;

/**
 * Internal helper which updates properties of all globals objects created with get().
 */
function updateGlobals(obj: RequestedGlobals) {
  for (const key of obj.neededNames) {
    obj.globals[key] = globalVars[key];
  }
}

/**
 * Replace globals with those from the given object. The previous mapping of global values is
 * returned, so that it can be restored later.
 */
export function setGlobals(globals: Globals) {
  const oldVars = globalVars;
  globalVars = globals;
  for (const obj of allGlobals) {
    updateGlobals(obj);
  }
  return oldVars;
}
