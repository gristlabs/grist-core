/**
 * This fixture just allows seeing the progress indicator created by HomeImports module. It should
 * soon be replaced with a Notifications-based version (but probably a similar look).
 */
import {Notifier} from "app/client/models/NotifyModel";
import {buildSnackbarDom} from 'app/client/ui/NotifyUI';
import {cssRootVars} from 'app/client/ui2018/cssVars';
import {dom} from 'grainjs';

function setupTest() {
  const notifier = Notifier.create(null);
  notifier.createProgressIndicator("test-file.txt", "12mb");
  const p1 = notifier.createProgressIndicator("test-file.txt", "12mb");
  p1.setProgress(50);
  const p2 = notifier.createProgressIndicator("test-file.txt", "12mb");
  p2.setProgress(100);
  return buildSnackbarDom(notifier, null);
}

dom.update(document.body, dom.cls(cssRootVars), setupTest());
