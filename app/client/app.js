/* global $, window, document */

const {App} = require('./ui/App');

// Disable longStackTraces, which seem to be enabled in the browser by default.
var bluebird = require('bluebird');
bluebird.config({ longStackTraces: false });

// Set up integration between grainjs and knockout disposal.
const {setupKoDisposal} = require('grainjs');
const ko = require('knockout');
setupKoDisposal(ko);

$(function() {
  window.gristApp = App.create(null, document.getElementById('grist-app'));
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
