/* global window */

// These modules are exposed for the sake of browser tests.
Object.assign(window.exposedModules, {
  dom: require('./lib/dom'),
  grainjs: require('grainjs'),
  ko: require('knockout'),
  moment: require('moment-timezone'),
  Comm: require('app/client/components/Comm'),
  loadScript: require('./lib/loadScript'),
  ConnectState: require('./models/ConnectState'),
});
