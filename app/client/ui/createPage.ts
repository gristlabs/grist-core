import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {setupLocale} from 'app/client/lib/localization';
import {reportError, setErrorNotifier, setUpErrorHandling} from 'app/client/models/errors';
import {Notifier} from 'app/client/models/NotifyModel';
import {buildSnackbarDom} from 'app/client/ui/NotifyUI';
import {addViewportTag} from 'app/client/ui/viewport';
import {attachCssRootVars, attachTheme, prefersColorSchemeThemeObs} from 'app/client/ui2018/cssVars';
import {BaseAPI} from 'app/common/BaseAPI';
import {dom, DomContents} from 'grainjs';

const G = getBrowserGlobals('document', 'window');

/**
 * Sets up error handling and global styles, and replaces the DOM body with the
 * result of calling `buildPage`.
 */
export function createPage(buildPage: () => DomContents, options: {disableTheme?: boolean} = {}) {
  const {disableTheme} = options;

  setUpErrorHandling();

  addViewportTag();
  attachCssRootVars('grist');
  setupLocale().catch(reportError);

  // Add globals needed by test utils.
  G.window.gristApp = {
    testNumPendingApiRequests: () => BaseAPI.numPendingRequests(),
  };

  const notifier = Notifier.create(null);
  setErrorNotifier(notifier);

  dom.update(document.body, () => [
    disableTheme ? null : dom.autoDispose(attachTheme(prefersColorSchemeThemeObs())),
    buildPage(),
    buildSnackbarDom(notifier, null),
  ]);
}
