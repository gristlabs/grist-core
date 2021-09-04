/* global $, window */

// This is the entry point into loading the whole of Grist frontend application. Some extensions
// attempt to load it more than once (e.g. "Lingvanex"). This leads to duplicated work and errors.
// At least some of such interference can be neutralized by simply ignoring repeated loads.
if (window._gristAppLoaded) {
  return;
}
window._gristAppLoaded = true;

const {App} = require('./ui/App');

// Disable longStackTraces, which seem to be enabled in the browser by default.
var bluebird = require('bluebird');
bluebird.config({ longStackTraces: false });

// Set up integration between grainjs and knockout disposal.
const {setupKoDisposal} = require('grainjs');
const ko = require('knockout');
setupKoDisposal(ko);

$(function() {
  window.gristApp = App.create(null);
  // Set from the login tests to stub and un-stub functions during execution.
  window.loginTestSandbox = null;

  // These modules are exposed for the sake of browser tests.
  window.exposeModulesForTests = function() {
    return (import('./exposeModulesForTests' /* webpackChunkName: "modulesForTests" */));
  };
  window.exposedModules = {
    // Several existing tests use window.exposedModules.loadScript has loaded
    // a file for them.  We now load exposedModules asynchronously, so that it
    // doesn't slow down application startup.  To avoid changing tests
    // unnecessarily, we implement a loadScript wrapper.
    loadScript(name) {
      return window.exposeModulesForTests()
        .then(() => window.exposedModules._loadScript(name));
    }
  };
});
