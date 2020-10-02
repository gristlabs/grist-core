/* global window */

// These modules are exposed for the sake of browser tests.
Object.assign(window.exposedModules, {
  dom: require('./lib/dom'),
  grainjs: require('grainjs'),
  ko: require('knockout'),
  moment: require('moment-timezone'),
  Comm: require('./components/Comm'),
  ProfileForm: require('./components/ProfileForm'),
  _loadScript: require('./lib/loadScript'),
  ConnectState: require('./models/ConnectState'),
});
