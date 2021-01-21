import {localStorageBoolObs} from 'app/client/lib/localStorageObs';
import {dom} from 'grainjs';

export const viewportEnabled = localStorageBoolObs('viewportEnabled');

export function toggleViewport() {
  viewportEnabled.set(!viewportEnabled.get());
  if (!viewportEnabled.get()) {
    // Removing the meta tag doesn't cause mobile browsers to reload automatically.
    location.reload();
  }
}

export function addViewportTag() {
  dom.update(document.head,
    dom.maybe(viewportEnabled, () =>
      dom('meta', {name: "viewport", content: "width=device-width,initial-scale=1.0"})
    )
  );
}
