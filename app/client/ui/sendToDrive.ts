import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {reportError} from 'app/client/models/errors';
import {spinnerModal} from 'app/client/ui2018/modals';
import type {DocPageModel} from 'app/client/models/DocPageModel';
import type {Document} from 'app/common/UserAPI';
import { getGoogleCodeForSending } from "app/client/ui/googleAuth";
const G = getBrowserGlobals('window');
import {t} from 'app/client/lib/localization';

const translate = (x: string, args?: any): string => t(`sendToDrive.${x}`, args);

/**
 * Sends xlsx file to Google Drive. It first authenticates with Google to get encrypted access
 * token, then it calls "send-to-drive" api endpoint to upload xlsx file to drive and finally it
 * redirects to the created spreadsheet. Code that is received from Google contains encrypted access
 * token, server is able to decrypt it using GOOGLE_CLIENT_SECRET key.
 */
export async function sendToDrive(doc: Document, pageModel: DocPageModel) {
  // Get current document - it will be used to remove popup listener.
  const gristDoc = pageModel.gristDoc.get();
  // Sanity check - gristDoc should be always present
  if (!gristDoc) { throw new Error("Grist document is not present in Page Model"); }

  // Create send to google drive handler (it will return a spreadsheet url).
  const send = (code: string) =>
    // Decorate it with a spinner
    spinnerModal(translate('SendingToGoogleDrive'),
      pageModel.appModel.api.getDocAPI(doc.id)
        .sendToDrive(code, pageModel.currentDocTitle.get())
    );

  try {
    const token = await getGoogleCodeForSending(gristDoc);
    const {url} = await send(token);
    G.window.location.assign(url);
  } catch (err) {
    reportError(err);
  }
}
