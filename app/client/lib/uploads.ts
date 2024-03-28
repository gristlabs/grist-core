/**
 * This module contains several ways to create an upload on the server. In all cases, an
 * UploadResult is returned, with an uploadId which may be used in other server calls to identify
 * this upload.
 *
 * TODO: another proposed source for files is uploadUrl(url) which would fetch a file from URL and
 * upload, and if that fails due to CORS, would fetch the file on the server side instead.
 */

import {DocComm} from 'app/client/components/DocComm';
import {UserError} from 'app/client/models/errors';
import {FileDialogOptions, openFilePicker} from 'app/client/ui/FileDialog';
import {GristLoadConfig} from 'app/common/gristUrls';
import {byteString, safeJsonParse} from 'app/common/gutil';
import {FetchUrlOptions, UPLOAD_URL_PATH, UploadResult} from 'app/common/uploads';
import {docUrl} from 'app/common/urlUtils';
import noop = require('lodash/noop');
import trimStart = require('lodash/trimStart');
import {basename} from 'path';      // made available by webpack using path-browserify module.

type ProgressCB = (percent: number) => void;

export interface UploadOptions {
  docWorkerUrl?: string;
  sizeLimit?: 'import'|'attachment';
}

export interface SelectFileOptions extends UploadOptions {
  multiple?: boolean;     // Whether multiple files may be selected.
  extensions?: string[];  // Comma-separated list of extensions (with a leading period),
                          // e.g. [".jpg", ".png"]
}

export const IMPORTABLE_EXTENSIONS = [".grist", ".csv", ".tsv", ".dsv", ".txt", ".xlsx", ".xlsm"];

/**
 * Shows the file-picker dialog with the given options, and uploads the selected files. If under
 * electron, shows the native file-picker instead.
 *
 * If given, onProgress() callback will be called with 0 on initial call, and will go up to 100
 * after files are selected to indicate percentage of data uploaded.
 */
export async function selectFiles(options: SelectFileOptions,
                                  onProgress: ProgressCB = noop): Promise<UploadResult|null> {
  onProgress(0);
  let result: UploadResult|null = null;
  const electronSelectFiles: any = (window as any).electronSelectFiles;
  if (typeof electronSelectFiles === 'function') {
    result = await electronSelectFiles(getElectronOptions(options));
  } else {
    const files: File[] = await openFilePicker(getFileDialogOptions(options));
    result = await uploadFiles(files, options, onProgress);
  }
  onProgress(100);
  return result;
}

// Helper to convert SelectFileOptions to the browser's FileDialogOptions.
function getFileDialogOptions(options: SelectFileOptions): FileDialogOptions {
  const resOptions: FileDialogOptions = {};
  if (options.multiple) {
    resOptions.multiple = options.multiple;
  }
  if (options.extensions) {
    resOptions.accept = options.extensions.join(",");
  }
  return resOptions;
}

// Helper to convert SelectFileOptions to electron's OpenDialogOptions.
function getElectronOptions(options: SelectFileOptions) /*: OpenDialogOptions */ {
  const resOptions /*: OpenDialogOptions*/ = {
    filters: [] as Array<{name: string, extensions: any}>,
    properties: ['openFile'],
  };
  if (options.extensions) {
    // Electron does not expect leading period.
    const extensions = options.extensions.map(e => trimStart(e, '.'));
    resOptions.filters.push({name: 'Select files', extensions});
  }
  if (options.multiple) {
    resOptions.properties.push('multiSelections');
  }
  return resOptions;
}

/**
 * Uploads a list of File objects to the server.
 */
export async function uploadFiles(
  fileList: File[], options: UploadOptions, onProgress: ProgressCB = noop
): Promise<UploadResult|null> {
  if (!fileList.length) { return null; }

  const formData = new FormData();
  for (const file of fileList) {
    formData.append('upload', file);
  }

  // Check for upload limits.
  const gristConfig: GristLoadConfig = (window as any).gristConfig || {};
  const {maxUploadSizeImport, maxUploadSizeAttachment} = gristConfig;
  if (options.sizeLimit === 'import' && maxUploadSizeImport) {
    // For imports, we limit the total upload size, but exempt .grist files from the upload limit.
    // Grist docs can be uploaded to make copies or restore from backup, and may legitimately be
    // very large (e.g. contain many attachments or on-demand tables).
    const totalSize = fileList.reduce((acc, f) => acc + (f.name.endsWith(".grist") ? 0 : f.size), 0);
    if (totalSize > maxUploadSizeImport) {
      throw new UserError(`Imported files may not exceed ${byteString(maxUploadSizeImport)}`);
    }
  } else if (options.sizeLimit === 'attachment' && maxUploadSizeAttachment) {
    // For attachments, we limit the size of each attachment.
    if (fileList.some((f) => (f.size > maxUploadSizeAttachment))) {
      throw new UserError(`Attachments may not exceed ${byteString(maxUploadSizeAttachment)}`);
    }
  }

  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('post', docUrl(options.docWorkerUrl, UPLOAD_URL_PATH), true);
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.withCredentials = true;
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded / e.total * 100);   // percentage complete
      }
    });
    xhr.addEventListener('error', (e: ProgressEvent) => {
      console.warn("Upload error", e);    // tslint:disable-line:no-console
      // The event does not seem to have any helpful info in it, to add to the message.
      reject(new Error('Upload error'));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status !== 200) {
        // tslint:disable-next-line:no-console
        console.warn("Upload failed", xhr.status, xhr.responseText);
        const err = safeJsonParse(xhr.responseText, null);
        reject(new UserError('Upload failed: ' + (err && err.error || xhr.status)));
      } else {
        resolve(JSON.parse(xhr.responseText));
      }
    });
    xhr.send(formData);
  });
}

/**
 * Fetches resource from a url and returns an UploadResult. Tries to fetch from the client and
 * upload the file to the server. If unsuccessful, tries to fetch directly from the server. In both
 * case, it guesses the name of the file based on the response's content-type and the url.
 */
export async function fetchURL(
  docComm: DocComm, url: string, options?: FetchUrlOptions, onProgress: ProgressCB = noop
  ): Promise<UploadResult> {

  if (isDriveUrl(url)) {
    // don't download from google drive, immediately fallback to server side.
    return docComm.fetchURL(url, options);
  }

  let response: Response;
  try {
    response = await window.fetch(url);
  } catch (err) {
    console.log( // tslint:disable-line:no-console
      `Could not fetch ${url} on the Client, falling back to server fetch: ${err.message}`
    );
    return docComm.fetchURL(url, options);
  }
  // TODO: We should probably parse response.headers.get('content-disposition') when available
  // (see content-disposition npm module).
  const fileName = basename(url);
  const mimeType = response.headers.get('content-type');
  const fileOptions = mimeType ? { type: mimeType } : {};
  const fileObj = new File([await response.blob()], fileName, fileOptions);
  const res = await uploadFiles([fileObj], {docWorkerUrl: docComm.docWorkerUrl}, onProgress);
  return res!;
}

export function isDriveUrl(url: string) {
  if (!url) { return null; }
  const match = /^https:\/\/(docs|drive).google.com\/(spreadsheets|file)\/d\/([^/]*)/i.exec(url);
  return !!match;
}
