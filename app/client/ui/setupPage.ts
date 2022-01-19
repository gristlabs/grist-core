import {AppModel, TopAppModelImpl} from 'app/client/models/AppModel';
import {setUpErrorHandling} from 'app/client/models/errors';
import {buildSnackbarDom} from 'app/client/ui/NotifyUI';
import {addViewportTag} from 'app/client/ui/viewport';
import {attachCssRootVars} from 'app/client/ui2018/cssVars';
import {dom, DomContents} from 'grainjs';

/**
 * Sets up error handling and global styles, and replaces the DOM body with
 * the result of calling `buildPage`.
 */
export function setupPage(buildPage: (appModel: AppModel) => DomContents) {
  setUpErrorHandling();
  const topAppModel = TopAppModelImpl.create(null, {});
  attachCssRootVars(topAppModel.productFlavor);
  addViewportTag();
  dom.update(document.body, dom.maybe(topAppModel.appObs, (appModel) => [
    buildPage(appModel),
    buildSnackbarDom(appModel.notifier, appModel),
  ]));
}
