import {fromFile} from 'file-type';
import {extension, lookup} from 'mime-types';
import * as path from 'path';

/**
 * Get our best guess of the file extension, based on its original extension (as received from the
 * user), mimeType (as reported by the browser upload, or perhaps some API), and the file
 * contents.
 *
 * The resulting extension is used to choose a parser for imports, and to present the file back
 * to the user for attachments.
 */
export async function guessExt(filePath: string, fileName: string, mimeType: string|null): Promise<string> {
  const origExt = path.extname(fileName).toLowerCase();   // Has the form ".xls"

  let mimeExt = extension(mimeType);          // Has the form "xls"
  mimeExt = mimeExt ? "." + mimeExt : null;   // Use the more comparable form ".xls"
  if (mimeExt === ".json") {
    // It's common for JSON APIs to specify MIME type, but origExt might come from a URL with
    // periods that don't indicate a meaningful extension. Trust mime-type here.
    return mimeExt;
  }

  if (origExt === ".csv") {
    // File type detection doesn't work for these, and mime type can't be trusted. E.g. Windows
    // may report "application/vnd.ms-excel" for .csv files. See
    // https://github.com/ManifoldScholar/manifold/issues/2409#issuecomment-545152220
    return origExt;
  }

  // If extension and mime type agree, let's call it a day.
  if (origExt && (origExt === mimeExt || lookup(origExt.slice(1)) === mimeType)) {
    return origExt;
  }

  // If not, let's take a look at the file contents.
  const detected = await fromFile(filePath);
  const detectedExt = detected ? "." + detected.ext : null;
  if (detectedExt) {
    // For the types for which detection works, we think we should prefer it.
    return detectedExt;
  }

  if (mimeExt === '.txt' || mimeExt === '.bin') {
    // text/plain (txt) and application/octet-stream (bin) are too generic, only use them if we
    // don't have anything better.
    return origExt || mimeExt;
  }
  // In other cases, it's a tough call.
  return origExt || mimeExt;
}
