import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import type {Disposable} from 'grainjs';
import { GristLoadConfig } from "app/common/gristUrls";

/**
 * Functions to perform server side authentication with Google.
 *
 * The authentication flow is performed by server side (app/server/lib/GoogleAuth.ts). Here we will
 * open up a popup with a stub html file (served by the server), that will redirect user to Google
 * Auth Service. In return, we will get authorization_code (which will be delivered by a postMessage
 * from the iframe), that when converted to authorization_token, can be used to access Google Drive
 * API. Accessing Google Drive files is done by the server, here we only ask for the permissions.
 *
 * Exposed methods are:
 * - getGoogleCodeForSending: asks google for a permission to create files on the drive (and read
 *                            them)
 * - getGoogleCodeForReading: asks google for a permission to read all files
 * - canReadPrivateFiles:     Grist by default won't ask for permission to read all files, but can be
 *                            configured this way by an environmental variable.
 */

const G = getBrowserGlobals('window');

export const ACCESS_DENIED = "access_denied";
export const AUTH_INTERRUPTED = "auth_interrupted";

// https://developers.google.com/identity/protocols/oauth2/scopes#drive
// "View and manage Google Drive files and folders that you have opened or created with this app"
const APP_SCOPE = "https://www.googleapis.com/auth/drive.file";
// "See and download all your Google Drive files"
const READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export function getGoogleCodeForSending(owner: Disposable) {
  return getGoogleAuthCode(owner, APP_SCOPE);
}

export function getGoogleCodeForReading(owner: Disposable) {
  const gristConfig: GristLoadConfig = (window as any).gristConfig || {};
  // Default scope allows as to manage files we created.
  return getGoogleAuthCode(owner, gristConfig.googleDriveScope || APP_SCOPE);
}

/**
 * Checks if default scope for Google Drive integration will allow to access all personal files
 */
export function canReadPrivateFiles() {
  const gristConfig: GristLoadConfig = (window as any).gristConfig || {};
  return gristConfig.googleDriveScope === READ_SCOPE;
}

/**
 * Opens up a popup with server side Google Authentication. Returns a code that can be used
 * by server side to retrieve access_token required in Google Api.
 */
function getGoogleAuthCode(owner: Disposable, scope: string) {
  // Compute google auth server endpoint (grist endpoint for server side google authentication).
  // This endpoint renders a page that redirects user to Google Consent screen and after Google
  // sends a response, it will post this response back to us.
  // Message will be an object { code, error }.
  const authLink = getGoogleAuthEndpoint(scope);
  const authWindow = openPopup(authLink);
  return new Promise<string>((resolve, reject) => {
    attachListener(owner, authWindow, async (event: MessageEvent|null) => {
      // If the no message, or window was closed (user closed it intentionally).
      if (!event || authWindow.closed) {
        reject(new Error(AUTH_INTERRUPTED));
        return;
      }
      // For the first message (we expect only a single message) close the window.
      authWindow.close();
      if (owner.isDisposed()) {
        reject(new Error(AUTH_INTERRUPTED));
        return;
      }
      // Check response from the popup
      const response = (event.data || {}) as {code?: string, error?: string};
      // - when user declined, report back, caller should stop current flow,
      if (response.error === "access_denied") {
        reject(new Error(ACCESS_DENIED));
        return;
      }
      // - when there is no authorization, or error is different from what we expected - report to user.
      if (!response.code) {
        reject(new Error(response.error || "Missing authorization code"));
        return;
      }
      resolve(response.code);
    });
  });
}

// Helper function that attaches a handler to message event from a popup window.
function attachListener(owner: Disposable, popup: Window, listener: (e: MessageEvent|null) => void) {
  const wrapped = (e: MessageEvent) => {
    // Listen to events only from our window.
    if (e.source !== popup) { return; }
    // In case when Grist was reloaded or user navigated away - do nothing.
    if (owner.isDisposed()) { return; }
    listener(e);
    // Clear the listener, to avoid orphaned calls from closed event.
    listener = () => {};
  };
  // Unfortunately there is no ease way to detect if user has closed the popup.
  const closeHandler = onClose(popup, () => {
    listener(null);
    // Clear the listener, to avoid orphaned messages from window.
    listener = () => {};
  });
  owner.onDispose(closeHandler);
  G.window.addEventListener('message', wrapped);
  owner.onDispose(() => {
    G.window.removeEventListener('message', wrapped);
  });
}

// Periodically checks if the window is closed.
// Returns a function that can be used to cancel the event.
function onClose(window: Window, clb: () => void) {
  const interval = setInterval(() => {
    if (window.closed) {
      clearInterval(interval);
      clb();
    }
  }, 1000);
  return () => clearInterval(interval);
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

/**
 * Generates Google Auth endpoint (exposed by Grist) url. For example:
 * https://docs.getgrist.com/auth/google
 * @param scope Requested access scope for Google Services:
 * https://developers.google.com/identity/protocols/oauth2/scopes
 */
function getGoogleAuthEndpoint(scope: string) {
  return new URL(`auth/google?scope=${scope}`, window.location.origin).href;
}
