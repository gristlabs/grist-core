import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {getHomeUrl} from 'app/client/models/AppModel';
import {reportError} from 'app/client/models/errors';
import {spinnerModal} from 'app/client/ui2018/modals';
import type { DocPageModel } from 'app/client/models/DocPageModel';
import type { Document } from 'app/common/UserAPI';
import type { Disposable } from 'grainjs';

const G = getBrowserGlobals('window');

/**
 * Generates Google Auth endpoint (exposed by Grist) url. For example:
 * https://docs.getgrist.com/auth/google
 * @param scope Requested access scope for Google Services
 * https://developers.google.com/identity/protocols/oauth2/scopes
 */
function getGoogleAuthEndpoint(scope?: string) {
  return new URL(`auth/google?scope=${scope || ''}`, getHomeUrl()).href;
}

/**
 * Sends xlsx file to Google Drive. It first authenticates with Google to get encrypted access token,
 * then it calls "send-to-drive" api endpoint to upload xlsx file to drive and finally it redirects
 * to the created spreadsheet.
 * Code that is received from Google contains encrypted access token, server is able to decrypt it
 * using GOOGLE_CLIENT_SECRET key.
 */
export function sendToDrive(doc: Document, pageModel: DocPageModel) {
  // Get current document - it will be used to remove popup listener.
  const gristDoc = pageModel.gristDoc.get();
  // Sanity check - gristDoc should be always present
  if (!gristDoc) { throw new Error("Grist document is not present in Page Model"); }

  // Create send to google drive handler (it will return a spreadsheet url).
  const send = (code: string) =>
    // Decorate it with a spinner
    spinnerModal('Sending file to Google Drive',
      pageModel.appModel.api.getDocAPI(doc.id)
        .sendToDrive(code, pageModel.currentDocTitle.get())
    );

  // Compute google auth server endpoint (grist endpoint for server side google authentication).
  // This endpoint will redirect user to Google Consent screen and after Google sends a response,
  // it will render a page (/static/message.html) that will post a message containing message
  // from Google. Message will be an object { code, error }. We will use the code to invoke
  // "send-to-drive" api endpoint - that will actually send the xlsx file to Google Drive.
  const authLink = getGoogleAuthEndpoint();
  const authWindow = openPopup(authLink);
  attachListener(gristDoc, authWindow, async (event: MessageEvent) => {
    // For the first message (we expect only a single message) close the window.
    authWindow.close();

    // Check response from the popup
    const response = (event.data || {}) as { code?: string, error?: string };
    // - when user declined, do nothing,
    if (response.error === "access_denied") { return; }
    // - when there is no response code or error code is different from what we expected - report to user.
    if (!response.code) { reportError(response.error || "Unrecognized or empty error code"); return; }

    // Send file to Google Drive.
    try {
      const { url } = await send(response.code);
      G.window.location.assign(url);
    } catch (err) {
      reportError(err);
    }
  });
}

// Helper function that attaches a handler to message event from a popup window.
function attachListener(owner: Disposable, popup: Window, listener: (e: MessageEvent) => any) {
  const wrapped = (e: MessageEvent) => {
    // Listen to events only from our window.
    if (e.source !== popup) { return; }
    // In case when Grist was reloaded or user navigated away - do nothing.
    if (owner.isDisposed()) { return; }
    listener(e);
  };
  G.window.addEventListener('message', wrapped);
  owner.onDispose(() => {
    G.window.removeEventListener('message', wrapped);
  });
}

function openPopup(url: string): Window {
  // Center window on desktop
  // https://stackoverflow.com/questions/16363474/window-open-on-a-multi-monitor-dual-monitor-system-where-does-window-pop-up
  const width = 600;
  const height = 650;
  const left = window.screenX + (screen.width - width) / 2;
  const top = (screen.height - height) / 4;
  let windowFeatures = `top=${top},left=${left},menubar=no,location=no,` +
    `resizable=yes,scrollbars=yes,status=yes,height=${height},width=${width}`;

  // If window will be too large (for example on mobile) - open as a new tab
  if (screen.width <= width || screen.height <= height) {
    windowFeatures = '';
  }

  const authWindow = G.window.open(url, "GoogleAuthPopup", windowFeatures);
  if (!authWindow) {
    // This method should be invoked by an user action.
    throw new Error("This method should be invoked synchronously");
  }
  return authWindow;
}
