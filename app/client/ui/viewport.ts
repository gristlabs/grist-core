import {isIOS} from 'app/client/lib/browserInfo';
import {localStorageBoolObs} from 'app/client/lib/localStorageObs';
import {dom} from 'grainjs';

export const viewportEnabled = localStorageBoolObs('viewportEnabled', true);

export function toggleViewport() {
  viewportEnabled.set(!viewportEnabled.get());
  if (!viewportEnabled.get()) {
    // Removing the meta tag doesn't cause mobile browsers to reload automatically.
    location.reload();
  }
}

export function addViewportTag() {
  dom.update(document.head,
    dom.maybe(viewportEnabled, () => {
      // For the maximum-scale=1 advice, see https://stackoverflow.com/a/46254706/328565. On iOS,
      // it prevents the auto-zoom when an input is focused, but does not prevent manual
      // pinch-to-zoom. On Android, it's not needed, and would prevent manual zoom.
      const viewportContent = "width=device-width,initial-scale=1.0" + (isIOS() ? ",maximum-scale=1" : "");
      return dom('meta', {name: "viewport", content: viewportContent});
    })
  );
}
