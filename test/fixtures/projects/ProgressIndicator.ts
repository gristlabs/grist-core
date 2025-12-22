/**
 * This fixture just allows seeing the progress indicator created by HomeImports module. It should
 * soon be replaced with a Notifications-based version (but probably a similar look).
 */
import { Notifier } from "app/client/models/NotifyModel";
import { buildSnackbarDom } from "app/client/ui/NotifyUI";
import { dom } from "grainjs";
import { initGristStyles } from "test/fixtures/projects/helpers/gristStyles";

function setupTest() {
  const notifier = Notifier.create(null);
  notifier.createProgressIndicator("test-file.txt", "12mb");
  const p1 = notifier.createProgressIndicator("test-file.txt", "12mb");
  p1.setProgress(50);
  const p2 = notifier.createProgressIndicator("test-file.txt", "12mb");
  p2.setProgress(100);
  return buildSnackbarDom(notifier, null);
}

initGristStyles();
dom.update(document.body, setupTest());
