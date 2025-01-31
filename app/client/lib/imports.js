/**
 *
 * Dynamic imports from js work fine with webpack; from typescript we need to upgrade
 * our "module" setting, which has a lot of knock-on effects.  To work around that for
 * the moment, importing can be done from this js file.
 *
 */

exports.loadAccountPage = () => import('app/client/ui/AccountPage' /* webpackChunkName: "AccountPage" */);
exports.loadActivationPage = () => import('app/client/ui/ActivationPage' /* webpackChunkName: "ActivationPage" */);
exports.loadAuditLogsPage = () => import('app/client/ui/AuditLogsPage' /* webpackChunkName: "AuditLogsPage" */);
exports.loadBillingPage = () => import('app/client/ui/BillingPage' /* webpackChunkName: "BillingModule" */);
exports.loadAdminPanel = () => import('app/client/ui/AdminPanel' /* webpackChunkName: "AdminPanel" */);
exports.loadGristDoc = () => import('app/client/components/GristDoc' /* webpackChunkName: "GristDoc" */);
// When importing this way, the module is under the "default" member, not sure why (maybe
// esbuild-loader's doing).
exports.loadAce = () => import('ace-builds')
  .then(async (m) => {
    await Promise.all([
      import('ace-builds/src-noconflict/ext-static_highlight'),
      import('ace-builds/src-noconflict/mode-python'),
      import('ace-builds/src-noconflict/theme-chrome'),
      import('ace-builds/src-noconflict/theme-dracula'),
    ]);

    return m.default;
  });
exports.loadEmojiPicker = () => import('app/client/ui/EmojiPicker' /* webpackChunkName: "emojipicker" */);
exports.loadMomentTimezone = () => import('moment-timezone').then(m => m.default);
exports.loadPlotly = () => import('plotly.js-basic-dist' /* webpackChunkName: "plotly" */);
exports.loadSearch = () => import('app/client/ui2018/search' /* webpackChunkName: "search" */);
exports.loadUserManager = () => import('app/client/ui/UserManager' /* webpackChunkName: "usermanager" */);
exports.loadViewPane = () => import('app/client/components/ViewPane' /* webpackChunkName: "viewpane" */);
