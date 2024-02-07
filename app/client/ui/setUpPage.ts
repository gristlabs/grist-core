import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {setupLocale} from 'app/client/lib/localization';
import {AppModel, newUserAPIImpl, TopAppModelImpl} from 'app/client/models/AppModel';
import {setUpErrorHandling} from 'app/client/models/errors';
import {buildSnackbarDom} from 'app/client/ui/NotifyUI';
import {addViewportTag} from 'app/client/ui/viewport';
import {attachCssRootVars} from 'app/client/ui2018/cssVars';
import {BaseAPI} from 'app/common/BaseAPI';
import {dom, DomContents} from 'grainjs';

const G = getBrowserGlobals('document', 'window');

export interface SetUpPageOptions {
  /** Defaults to true. */
  attachTheme?: boolean;
}

/**
 * Sets up error handling and global styles, and replaces the DOM body with
 * the result of calling `buildPage`.
 */
export function setUpPage(
  buildPage: (appModel: AppModel) => DomContents,
  options: SetUpPageOptions = {}
) {
  const {attachTheme = true} = options;
  setUpErrorHandling();
  const topAppModel = TopAppModelImpl.create(null, {}, newUserAPIImpl(), {attachTheme});
  attachCssRootVars(topAppModel.productFlavor);
  addViewportTag();

  void setupLocale();

  // Add globals needed by test utils.
  G.window.gristApp = {
    testNumPendingApiRequests: () => BaseAPI.numPendingRequests(),
  };

  dom.update(document.body, dom.maybe(topAppModel.appObs, (appModel) => [
    buildPage(appModel),
    buildSnackbarDom(appModel.notifier, appModel),
  ]));
}
