/**
 * Code and declarations shared by browser and server-side code for handling uploads.
 *
 * Browser code has several functions available in app/client/lib/uploads.ts which return an
 * UploadResult that represents an upload. An upload may contain multiple files.
 *
 * An upload is identified by a numeric uploadId which is unique within an UploadSet. An UploadSet
 * is collection of uploads tied to a browser session (as maintained by app/server/lib/Client).
 * When the session ends, all uploads are cleaned up.
 *
 * The uploadId is useful to identify the upload to the server, which can then consume the actual
 * files there. It may also be used to clean up the upload once it is no longer needed.
 *
 * Files within an upload can be identified by their index in UploadResult.files array. The
 * origName available for files is not guaranteed to be unique.
 *
 * Implementation detail: The upload is usually a temporary directory on the server, but may be a
 * collection of non-temporary files when files are selected using Electron's native file picker.
 */

/**
 * Represents a single upload, containing one or more files. Empty uploads are never created.
 */
export interface UploadResult {
  uploadId: number;
  files: FileUploadResult[];
}

/**
 * Represents a single file within an upload. This is the only information made available to the
 * browser. (In particular, while the server knows also the actual path of the file on the server,
 * the browser has no need for it and should not know it.)
 */
export interface FileUploadResult {
  origName: string;     // The filename that the user reports for the file (not guaranteed unique).
  size: number;         // The size of the file in bytes.
  ext: string;          // The extension of the file, starting with "."
}

/**
 * Path where the server accepts POST requests with uploads.  Don't include a leading / so that
 * the page's <base> will be respected.
 */
export const UPLOAD_URL_PATH = 'uploads';

/**
 * Additional options for fetching external resources.
 */
export interface FetchUrlOptions {
  googleAuthorizationCode?: string;   // The authorization code received from Google Auth Service.
  fileName?: string;                  // The filename for external resource.
  headers?: {[key: string]: string};  // Additional headers to use when accessing external resource.
}
