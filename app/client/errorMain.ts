import {TopAppModelImpl} from 'app/client/models/AppModel';
import {setUpErrorHandling} from 'app/client/models/errors';
import {createErrPage} from 'app/client/ui/errorPages';
import {buildSnackbarDom} from 'app/client/ui/NotifyUI';
import {addViewportTag} from 'app/client/ui/viewport';
import {attachCssRootVars} from 'app/client/ui2018/cssVars';
import {dom} from 'grainjs';

// Set up the global styles for variables, and root/body styles.
setUpErrorHandling();
const topAppModel = TopAppModelImpl.create(null, {});
attachCssRootVars(topAppModel.productFlavor);
addViewportTag();
dom.update(document.body, dom.maybe(topAppModel.appObs, (appModel) => [
  createErrPage(appModel),
  buildSnackbarDom(appModel.notifier, appModel),
]));
