/**
 *
 * Dynamic imports from js work fine with webpack; from typescript we need to upgrade
 * our "module" setting, which has a lot of knock-on effects.  To work around that for
 * the moment, importing can be done from this js file.
 *
 */
/* global document */

exports.loadAccountPage = () => import("app/client/ui/AccountPage" /* webpackChunkName: "AccountPage" */);
exports.loadActivationPage = () => import("app/client/ui/ActivationPage" /* webpackChunkName: "ActivationPage" */);
exports.loadAirtableImportUI = () => import("app/client/lib/airtable/AirtableImportUI" /* webpackChunkName: "AirtableImport" */);
exports.loadAuditLogsPage = () => import("app/client/ui/AuditLogsPage" /* webpackChunkName: "AuditLogsPage" */);
exports.loadBillingPage = () => import("app/client/ui/BillingPage" /* webpackChunkName: "BillingModule" */);
exports.loadBootPage = () => import("app/client/ui/BootPage" /* webpackChunkName: "BootPage" */);
exports.loadAdminPanel = () => import("app/client/ui/AdminPanel" /* webpackChunkName: "AdminPanel" */);
exports.loadGristDoc = () => import("app/client/components/GristDoc" /* webpackChunkName: "GristDoc" */);
// When importing this way, the module is under the "default" member, not sure why (maybe
// esbuild-loader's doing).
exports.loadAce = () => import("ace-builds")
  .then(async (m) => {
    await Promise.all([
      import("ace-builds/src-noconflict/ext-static_highlight"),
      import("ace-builds/src-noconflict/mode-python"),
      import("ace-builds/src-noconflict/theme-chrome"),
      import("ace-builds/src-noconflict/theme-dracula"),
    ]);

    return m.default;
  });
exports.loadEmojiPicker = () => import("app/client/ui/EmojiPicker" /* webpackChunkName: "emojipicker" */);
exports.loadMomentTimezone = () => import("moment-timezone").then(m => m.default);
exports.loadPlotly = () => import("plotly.js-basic-dist" /* webpackChunkName: "plotly" */);
// Toast UI Calendar, used by the native CalendarView. The .css import resolves (via webpack's
// asset/resource) to a URL; we inject it once as a <link> here so views don't have to deal with
// dedup / FOUC. The whole loader is memoized so concurrent mounts share the same in-flight
// promise (no double <link>, no race).
let _toastUICalendarPromise = null;
exports.loadToastUICalendar = () => {
  if (!_toastUICalendarPromise) {
    _toastUICalendarPromise = Promise.all([
      import("@toast-ui/calendar" /* webpackChunkName: "toastui-calendar" */),
      import("@toast-ui/calendar/dist/toastui-calendar.min.css" /* webpackChunkName: "toastui-calendar" */)
        .then((css) => new Promise((resolve, reject) => {
          const href = css.default;
          if (document.querySelector(`link[href="${href}"]`)) { return resolve(); }
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = href;
          link.onload = () => resolve();
          link.onerror = reject;
          document.head.appendChild(link);
        })),
    ]).then(([mod]) => ({Calendar: mod.default, TZDate: mod.TZDate}));
    // If loading fails (offline, chunk error), drop the memo so a later mount can retry instead of
    // being stuck with the rejected promise forever.
    _toastUICalendarPromise.catch(() => { _toastUICalendarPromise = null; });
  }
  return _toastUICalendarPromise;
};
exports.loadSearch = () => import("app/client/ui2018/search" /* webpackChunkName: "search" */);
exports.loadUserManager = () => import("app/client/ui/UserManager" /* webpackChunkName: "usermanager" */);
exports.loadViewPane = () => import("app/client/components/ViewPane" /* webpackChunkName: "viewpane" */);
