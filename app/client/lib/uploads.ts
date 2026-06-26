/**
 * Client-side helpers for the doc-scoped upload pipeline.
 *
 * Uploads are routed through a `DocAPI` instance so the request lands on the doc-owning
 * worker (via DocApiProxy), where the resulting `uploadId` is consumable by the
 * subsequent WebSocket calls or HTTP requests.
 *
 * Generic uploads (not using the doc-scoped endpoint) are deprecated as they don't work when Grist is proxying
 * requests to doc workers, as the client may not be able to decide or know which doc worker the uploaded files will be
 * used on.
 */

import { DocComm } from "app/client/components/DocComm";
import { UserError } from "app/client/models/errors";
import { FileDialogOptions, openFilePicker } from "app/client/ui/FileDialog";
import { GristLoadConfig } from "app/common/gristUrls";
import { byteString } from "app/common/gutil";
import { FetchUrlOptions, UploadResult } from "app/common/uploads";
import { DocAPI, FormFile } from "app/common/UserAPI";

import { basename } from "path";      // made available by webpack using path-browserify module.

import noop from "lodash/noop";

type ProgressCB = (percent: number) => void;

export interface SelectFileOptions {
  multiple?: boolean;     // Whether multiple files may be selected.
  extensions?: string[];  // Comma-separated list of extensions (with a leading period),
  // e.g. [".jpg", ".png"]
}

// This list coincides with the extensions defined in core/plugins/manifest.yml
export const EXTENSIONS_IMPORTABLE_WITHIN_DOC = [".xlsx", ".json", ".csv", ".tsv", ".dsv"];

export const EXTENSIONS_IMPORTABLE_AS_DOC = [".grist", ".csv", ".tsv", ".dsv", ".txt", ".xlsx", ".xlsm"];

// Browser-side size-limit guard for DocAPI.upload. Caller guarantees we're in a browser
// (typeof window !== "undefined"); .grist files are exempt from the import limit because they
// can legitimately be very large (attachments, on-demand tables, restored backups, ...).
export function checkBrowserUploadSizeLimit(
  files: FormFile | FormFile[],
  kind: "import" | "attachment",
): void {
  const fileList = Array.isArray(files) ? files : [files];
  const gristConfig: Partial<GristLoadConfig> = (window as any).gristConfig || {};
  const { maxUploadSizeImport, maxUploadSizeAttachment } = gristConfig;
  if (kind === "import" && maxUploadSizeImport) {
    const totalSize = fileList.reduce((acc, f) => {
      const blob = f.contents ?? f;
      const size = (blob as Blob | undefined)?.size ?? 0;
      return acc + (f.name?.endsWith(".grist") ? 0 : size);
    }, 0);
    if (totalSize > maxUploadSizeImport) {
      throw new UserError(`Imported files may not exceed ${byteString(maxUploadSizeImport)}`);
    }
  } else if (kind === "attachment" && maxUploadSizeAttachment) {
    if (fileList.some((f) => {
      const blob = f.contents ?? f;
      const size = (blob as Blob | undefined)?.size ?? 0;
      return size > maxUploadSizeAttachment;
    })) {
      throw new UserError(`Attachments may not exceed ${byteString(maxUploadSizeAttachment)}`);
    }
  }
}

/**
 * Shows the browser's file-picker dialog with the given options and returns the selected files.
 */
export async function selectPicker(options: SelectFileOptions): Promise<File[]> {
  return openFilePicker(getFileDialogOptions(options));
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

/**
 * Fetches resource from a url and returns an UploadResult. Tries to fetch from the client and
 * upload the file to the server. If unsuccessful, tries to fetch directly from the server. In both
 * cases, it guesses the name of the file based on the response's content-type and the url.
 */
export async function fetchURL(
  docApi: DocAPI, docComm: DocComm, url: string, options?: FetchUrlOptions, onProgress: ProgressCB = noop,
): Promise<UploadResult> {
  if (isDriveUrl(url)) {
    // don't download from google drive, immediately fallback to server side.
    return docComm.fetchURL(url, options);
  }

  let response: Response;
  try {
    response = await window.fetch(url);
  } catch (err) {
    console.log(`Could not fetch ${url} on the Client, falling back to server fetch: ${err.message}`,
    );
    return docComm.fetchURL(url, options);
  }
  // TODO: We should probably parse response.headers.get('content-disposition') when available
  // (see content-disposition npm module).
  const fileName = basename(url);
  const mimeType = response.headers.get("content-type");
  const fileOptions = mimeType ? { type: mimeType } : {};
  const fileObj = new File([await response.blob()], fileName, fileOptions);
  checkBrowserUploadSizeLimit(fileObj, "import");
  return docApi.upload(fileObj, { onProgress: p => onProgress(p ?? 0) });
}

export function isDriveUrl(url: string) {
  if (!url) { return null; }
  const match = /^https:\/\/(docs|drive).google.com\/(spreadsheets|file)\/d\/([^/]*)/i.exec(url);
  return !!match;
}
