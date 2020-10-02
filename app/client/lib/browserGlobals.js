/**
 * Module that allows client-side code to use browser globals (such as `document` or `Node`) in a
 * way that allows those globals to be replaced by mocks in browser-less tests.
 *
 * E.g. test/client/clientUtil.js can replace globals with those provided by jsdom.
 */


var allGlobals = [];

/* global window */
var globalVars = (typeof window !== 'undefined' ? window : {});

/**
 * Usage: to get access to global variables `foo` and `bar`, call:
 *    var G = require('browserGlobals').get('foo', 'bar');
 * and use G.foo and G.bar.
 *
 * This modules stores a reference to G, so that setGlobals() call can replace the values to which
 * G.foo and G.bar refer.
 */
function get(varArgNames) {
  var obj = {
    neededNames: Array.prototype.slice.call(arguments),
    globals: {}
  };
  updateGlobals(obj);
  allGlobals.push(obj);
  return obj.globals;
}
exports.get = get;

/**
 * Internal helper which updates properties of all globals objects created with get().
 */
function updateGlobals(obj) {
  obj.neededNames.forEach(function(key) {
    obj.globals[key] = globalVars[key];
  });
}

/**
 * Replace globals with those from the given object. The previous mapping of global values is
 * returned, so that it can be restored later.
 */
function setGlobals(globals) {
  var oldVars = globalVars;
  globalVars = globals;
  allGlobals.forEach(function(obj) {
    updateGlobals(obj);
  });
  return oldVars;
}
exports.setGlobals = setGlobals;
