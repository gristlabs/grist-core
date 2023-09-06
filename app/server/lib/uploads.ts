import {ApiError} from 'app/common/ApiError';
import {InactivityTimer} from 'app/common/InactivityTimer';
import {FetchUrlOptions, FileUploadResult, UPLOAD_URL_PATH, UploadResult} from 'app/common/uploads';
import {getDocWorkerUrl} from 'app/common/UserAPI';
import {getAuthorizedUserId, getTransitiveHeaders, getUserId, isSingleUserMode,
        RequestWithLogin} from 'app/server/lib/Authorizer';
import {expressWrap} from 'app/server/lib/expressWrap';
import {downloadFromGDrive, isDriveUrl} from 'app/server/lib/GoogleImport';
import {GristServer, RequestWithGrist} from 'app/server/lib/GristServer';
import {guessExt} from 'app/server/lib/guessExt';
import log from 'app/server/lib/log';
import {optStringParam} from 'app/server/lib/requestUtils';
import {isPathWithin} from 'app/server/lib/serverUtils';
import * as shutdown from 'app/server/lib/shutdown';
import {fromCallback} from 'bluebird';
import * as contentDisposition from 'content-disposition';
import {Application, Request, RequestHandler, Response} from 'express';
import * as fse from 'fs-extra';
import pick = require('lodash/pick');
import * as multiparty from 'multiparty';
import fetch, {Response as FetchResponse} from 'node-fetch';
import * as path from 'path';
import * as tmp from 'tmp';

// After some time of inactivity, clean up the upload. We give an hour, which seems generous,
// except that if one is toying with import options, and leaves the upload in an open browser idle
// for an hour, it will get cleaned up. TODO Address that; perhaps just with some UI messages.
const INACTIVITY_CLEANUP_MS = 60 * 60 * 1000;     // an hour, very generously.

// A hook for dependency injection.
export const Deps = {fetch, INACTIVITY_CLEANUP_MS};

// An optional UploadResult, with parameters.
export interface FormResult {
  upload?: UploadResult;
  parameters?: {[key: string]: string};
}

/**
 * Adds an upload route to the given express app, listening for POST requests at UPLOAD_URL_PATH.
 */
export function addUploadRoute(server: GristServer, expressApp: Application, ...handlers: RequestHandler[]): void {

  // When doing a cross-origin post, the browser will check for access with options prior to posting.
  // We need to reassure it that the request will be accepted before it will go ahead and post.
  expressApp.options([`/${UPLOAD_URL_PATH}`, '/copy'], ...handlers, async (req, res) => {
    // Origin is checked by middleware - if we get this far, we are ok.
    res.status(200).send();
  });

  expressApp.post(`/${UPLOAD_URL_PATH}`, ...handlers, expressWrap(async (req: Request, res: Response) => {
    try {
      const uploadResult: UploadResult = await handleUpload(req, res);
      res.status(200).send(JSON.stringify(uploadResult));
    } catch (err) {
      req.resume();
      if (err.message && /Request aborted/.test(err.message)) {
        log.warn("File upload request aborted", err);
      } else {
        log.error("Error uploading file", err);
      }
      // Respond with a JSON error like jsonErrorHandler does for API calls,
      // to make it easier for the caller to parse it.
      res.status(err.status || 500).json({error: err.message || 'internal error'});
    }
  }));

  // Like upload, but copy data from a document already known to us.
  expressApp.post(`/copy`, ...handlers, expressWrap(async (req: Request, res: Response) => {
    const docId = optStringParam(req.query.doc, 'doc');
    const name = optStringParam(req.query.name, 'name');
    if (!docId) { throw new Error('doc must be specified'); }
    const accessId = makeAccessId(req, getAuthorizedUserId(req));
    try {
      const uploadResult: UploadResult = await fetchDoc(server, docId, req, accessId,
                                                        req.query.template === '1');
      if (name) {
        globalUploadSet.changeUploadName(uploadResult.uploadId, accessId, name);
      }
      res.status(200).send(JSON.stringify(uploadResult));
    } catch(err) {
      if ((err as ApiError).status === 403) {
        res.status(403).json({error:'Insufficient access to document to copy it entirely'});
        return;
      }
      throw err;
    }
  }));
}

/**
 * Create a FileUploadInfo for the given file.
 */
export async function getFileUploadInfo(filePath: string): Promise<FileUploadInfo> {
  return {
    absPath: filePath,
    origName: path.basename(filePath),
    size: (await fse.stat(filePath)).size,
    ext: path.extname(filePath).toLowerCase(),
  };
}

/**
 * Implementation of the express /upload route.
 */
export async function handleUpload(req: Request, res: Response): Promise<UploadResult> {
  const {upload} = await handleOptionalUpload(req, res);
  if (!upload) { throw new ApiError('missing payload', 400); }
  return upload;
}

/**
 * Process form data that may contain an upload, returning that upload (if present)
 * and any parameters.
 */
export async function handleOptionalUpload(req: Request, res: Response): Promise<FormResult> {
  const {tmpDir, cleanupCallback} = await createTmpDir({});
  const mreq = req as RequestWithLogin;
  const meta = {
    org: mreq.org,
    email: mreq.user && mreq.user.loginEmail,
    userId: mreq.userId,
    altSessionId: mreq.altSessionId,
  };

  log.rawDebug(`Prepared to receive upload into tmp dir ${tmpDir}`, meta);

  // Note that we don't limit upload sizes here, since this endpoint doesn't know what kind of
  // upload it is, and some uploads are unlimited (e.g. uploading .grist files). Limits are
  // checked in the client, and should be enforced on the server where an upload is processed.
  const form = new multiparty.Form({uploadDir: tmpDir});
  const [formFields, formFiles] = await fromCallback((cb: any) => form.parse(req, cb),
    {multiArgs: true});

  // 'upload' is the name of the form field containing file data.
  let upload: UploadResult|undefined;
  if (formFiles.upload) {
    const uploadedFiles: FileUploadInfo[] = [];
    for (const file of formFiles.upload) {
      const mimeType = file.headers['content-type'];
      log.rawDebug(`Received file ${file.originalFilename} (${file.size} bytes)`, meta);
      uploadedFiles.push({
        absPath: file.path,
        origName: file.originalFilename,
        size: file.size,
        ext: await guessExt(file.path, file.originalFilename, mimeType),
      });
    }
    const accessId = makeAccessId(req, getUserId(req));
    const uploadId = globalUploadSet.registerUpload(uploadedFiles, tmpDir, cleanupCallback, accessId);
    const files: FileUploadResult[] = uploadedFiles.map(f => pick(f, ['origName', 'size', 'ext']));
    log.rawDebug(`Created uploadId ${uploadId} in tmp dir ${tmpDir}`, meta);
    upload = {uploadId, files};
  }
  const parameters: {[key: string]: string} = {};
  for (const key of Object.keys(formFields)) {
    parameters[key] = formFields[key][0];
  }
  return {upload, parameters};
}

/**
 * Represents a single uploaded file on the server side. Only the FileUploadResult part is exposed
 * to the browser for information purposes.
 */
export interface FileUploadInfo extends FileUploadResult {
  absPath: string;      // Absolute path to the file on disk.
}

/**
 * Represents a complete upload on the server side. It may be a temporary directory containing a
 * list of files (not subdirectories), or a collection of non-temporary files. The
 * cleanupCallback() is responsible for removing the temporary directory. It should be a no-op for
 * non-temporary files.
 */
export interface UploadInfo {
  uploadId: number;             // ID of the upload

  files: FileUploadInfo[];      // List of all files included in the upload.

  tmpDir: string|null;          // Temporary directory to remove, containing this upload.
                                // If present, all files must be direct children of this directory.

  cleanupCallback: CleanupCB;   // Callback to clean up this upload, including removing tmpDir.
  cleanupTimer: InactivityTimer;
  accessId: string|null;          // Optional identifier for access control purposes.
}

type CleanupCB = () => void|Promise<void>;

export class UploadSet {
  private _uploads: Map<number, UploadInfo> = new Map();
  private _nextId: number = 0;

  /**
   * Register a new upload.
   */
  public registerUpload(files: FileUploadInfo[], tmpDir: string|null, cleanupCallback: CleanupCB,
                        accessId: string|null): number {
    const uploadId = this._nextId++;
    const cleanupTimer = new InactivityTimer(() => this.cleanup(uploadId), Deps.INACTIVITY_CLEANUP_MS);
    this._uploads.set(uploadId, {uploadId, files, tmpDir, cleanupCallback, cleanupTimer, accessId});
    cleanupTimer.ping();
    return uploadId;
  }

  /**
   * Returns full info for the given uploadId, if authorized.
   */
  public getUploadInfo(uploadId: number, accessId: string|null): UploadInfo {
    const info = this._getUploadInfoWithoutAuthorization(uploadId);
    if (info.accessId !== accessId) {
      throw new ApiError('access denied', 403);
    }
    return info;
  }

  /**
   * Clean up a particular upload.
   */
  public async cleanup(uploadId: number): Promise<void> {
    log.debug("UploadSet: cleaning up uploadId %s", uploadId);
    const info = this._getUploadInfoWithoutAuthorization(uploadId);
    info.cleanupTimer.disable();
    this._uploads.delete(uploadId);
    await info.cleanupCallback();
  }

  /**
   * Clean up all uploads in this UploadSet. It may be used again after this call (it's called
   * multiple times in tests).
   */
  public async cleanupAll(): Promise<void> {
    log.info("UploadSet: cleaning up all %d uploads in set", this._uploads.size);
    const uploads = Array.from(this._uploads.values());
    this._uploads.clear();
    this._nextId = 0;
    for (const info of uploads) {
      try {
        info.cleanupTimer.disable();
        await info.cleanupCallback();
      } catch (err) {
        log.warn(`Error cleaning upload ${info.uploadId}: ${err}`);
      }
    }
  }

  /**
   * Changes the name of an uploaded file. It is an error to use if the upload set has more than one
   * file and it will throw.
   */
  public changeUploadName(uploadId: number, accessId: string|null, name: string) {
    const info = this.getUploadInfo(uploadId, accessId);
    if (info.files.length > 1) {
      throw new Error("UploadSet.changeUploadName cannot operate on multiple files");
    }
    info.files[0].origName = name;
  }

  /**
   * Returns full info for the given uploadId, without checking authorization.
   */
  private _getUploadInfoWithoutAuthorization(uploadId: number): UploadInfo {
    const info = this._uploads.get(uploadId);
    if (!info) { throw new ApiError(`Unknown upload ${uploadId}`, 404); }
    // If the upload is being used, reschedule the inactivity timeout.
    info.cleanupTimer.ping();
    return info;
  }
}

// Maintains uploads created on this host.
export const globalUploadSet: UploadSet = new UploadSet();

// Registers a handler to clean up on exit. We do this intentionally: even though module `tmp` has
// its own logic to clean up, that logic isn't triggered when the server is killed with a signal.
shutdown.addCleanupHandler(null, () => globalUploadSet.cleanupAll());

/**
 * Moves this upload to a new directory. A new temporary subdirectory is created there first. If
 * the upload contained temporary files, those are moved; if non-temporary files, those are
 * copied. Aside from new file locations, the rest of the upload info stays unchanged.
 *
 * In any case, the previous cleanupCallback is run, and a new one created for the new tmpDir.
 *
 * This is used specifically for placing uploads into a location accessible by sandboxed code.
 */
export async function moveUpload(uploadInfo: UploadInfo, newDir: string): Promise<void> {
  if (uploadInfo.tmpDir && isPathWithin(newDir, uploadInfo.tmpDir)) {
    // Upload is already within newDir.
    return;
  }
  log.debug("UploadSet: moving uploadId %s to %s", uploadInfo.uploadId, newDir);
  const {tmpDir, cleanupCallback} = await createTmpDir({dir: newDir});
  const move: boolean = Boolean(uploadInfo.tmpDir);
  const files: FileUploadInfo[] = [];
  for (const f of uploadInfo.files) {
    const absPath = path.join(tmpDir, path.basename(f.absPath));
    await (move ? fse.move(f.absPath, absPath) : fse.copy(f.absPath, absPath));
    files.push({...f, absPath});
  }
  try {
    await uploadInfo.cleanupCallback();
  } catch (err) {
    // This is unexpected, but if the move succeeded, let's warn but not fail on cleanup error.
    log.warn(`Error cleaning upload ${uploadInfo.uploadId} after move: ${err}`);
  }
  Object.assign(uploadInfo, {files, tmpDir, cleanupCallback});
}


interface TmpDirResult {
  tmpDir: string;
  cleanupCallback: CleanupCB;
}

/**
 * Helper to create a temporary directory. It's a simple wrapper around tmp.dir, but replaces the
 * cleanup callback with an asynchronous version.
 */
export async function createTmpDir(options: tmp.Options): Promise<TmpDirResult> {
  const fullOptions = {prefix: 'grist-upload-', unsafeCleanup: true, ...options};

  const [tmpDir, tmpCleanup]: [string, CleanupCB] = await fromCallback(
    (cb: any) => tmp.dir(fullOptions, cb), {multiArgs: true});

  async function cleanupCallback() {
    // Using fs-extra is better because it's asynchronous.
    await fse.remove(tmpDir);
    try {
      // Still call the original callback, so that `tmp` module doesn't keep remembering about
      // this directory and doesn't try to delete it again on exit.
      await tmpCleanup();
    } catch (err) {
      // OK if it fails because the dir is already removed.
    }
  }
  return {tmpDir, cleanupCallback};
}

/**
 * Register a new upload with resource fetched from a public url. Returns corresponding UploadInfo.
 */
export async function fetchURL(url: string, accessId: string|null, options?: FetchUrlOptions): Promise<UploadResult> {
  return _fetchURL(url, accessId, { fileName: path.basename(url), ...options});
}

/**
 * Register a new upload with resource fetched from a url, optionally including credentials in request.
 * Returns corresponding UploadInfo.
 */
async function _fetchURL(url: string, accessId: string|null, options?: FetchUrlOptions): Promise<UploadResult> {
  try {
    const code = options?.googleAuthorizationCode;
    let fileName = options?.fileName ?? '';
    const headers = options?.headers;
    let response: FetchResponse;
    if (isDriveUrl(url)) {
      response = await downloadFromGDrive(url, code);
      fileName = ''; // Read the file name from headers.
    } else {
      response = await Deps.fetch(url, {
        redirect: 'follow',
        follow: 10,
        headers
      });
    }
    await _checkForError(response);
    if (fileName === '') {
      const disposition = response.headers.get('content-disposition') || '';
      fileName = contentDisposition.parse(disposition).parameters.filename || 'document.grist';
    }
    const mimeType = response.headers.get('content-type');
    const {tmpDir, cleanupCallback} = await createTmpDir({});
    // Any name will do for the single file in tmpDir, but note that fileName may not be valid.
    const destPath = path.join(tmpDir, 'upload-content');
    await new Promise((resolve, reject) => {
      const dest = fse.createWriteStream(destPath, {autoClose: true});
      response.body.on('error', reject);
      dest.on('error', reject);
      dest.on('finish', resolve);
      response.body.pipe(dest);
    });
    const uploadedFile: FileUploadInfo = {
      absPath: path.resolve(destPath),
      origName: fileName,
      size: (await fse.stat(destPath)).size,
      ext: await guessExt(destPath, fileName, mimeType),
    };
    log.debug(`done fetching url: ${url} to ${destPath}`);
    const uploadId = globalUploadSet.registerUpload([uploadedFile], tmpDir, cleanupCallback, accessId);
    return {uploadId, files: [pick(uploadedFile, ['origName', 'size', 'ext'])]};
  } catch(err) {
    if (err?.code === "EPROTO" || // https vs http error
        err?.code === "ECONNREFUSED" || // server does not listen
        err?.code === "ENOTFOUND") { // could not resolve domain
      throw new ApiError(`Can't connect to the server. The URL seems to be invalid. Error code ${err.code}`, 400);
    }
    throw err;
  }
}

/**
 * Fetches a Grist doc potentially managed by a different doc worker.  Passes on credentials
 * supplied in the current request.
 */
export async function fetchDoc(server: GristServer, docId: string, req: Request, accessId: string|null,
                        template: boolean): Promise<UploadResult> {
  // Prepare headers that preserve credentials of current user.
  const headers = getTransitiveHeaders(req);

  // Find the doc worker responsible for the document we wish to copy.
  // The backend needs to be well configured for this to work.
  const homeUrl = server.getHomeUrl(req);
  const fetchUrl = new URL(`/api/worker/${docId}`, homeUrl);
  const response: FetchResponse = await Deps.fetch(fetchUrl.href, {headers});
  await _checkForError(response);
  const docWorkerUrl = getDocWorkerUrl(server.getOwnUrl(), await response.json());
  // Download the document, in full or as a template.
  const url = new URL(`api/docs/${docId}/download?template=${Number(template)}`,
                      docWorkerUrl.replace(/\/*$/, '/'));
  return _fetchURL(url.href, accessId, {headers});
}

// Re-issue failures as exceptions.
async function _checkForError(response: FetchResponse) {
  if (response.status === 403) {
    throw new ApiError("Access to this resource was denied.", response.status);
  }
  if (response.ok) {
    const contentType = response.headers.get("content-type");
    if (contentType?.startsWith("text/html")) {
      // Probably we hit some login page
      if (response.url.startsWith("https://accounts.google.com")) {
        throw new ApiError("Importing directly from a Google Drive URL is not supported yet. " +
        'Use the "Import from Google Drive" menu option instead.', 403);
      } else {
        throw new ApiError("Could not import the requested file, check if you have all required permissions.", 403);
      }
    }
    return;
   }
  const body = await response.json().catch(() => ({}));
  if (response.status === 404) {
    throw new ApiError("File can't be found at the requested URL.", 404);
  } else if (response.status >= 500 && response.status < 600) {
    throw new ApiError(`Remote server returned an error (${body.error || response.statusText})`,
      response.status, body.details);
  } else {
    throw new ApiError(body.error || response.statusText, response.status, body.details);
  }
}

/**
 * Create an access identifier, combining the userId supplied with the host of the
 * doc worker.  Returns null if userId is null or in standalone mode.
 * Adding host information makes workers sharing a process more useful models of
 * full-blown isolated workers.
 */
export function makeAccessId(worker: string|Request|GristServer, userId: number|null): string|null {
  if (isSingleUserMode()) { return null; }
  if (userId === null) { return null; }
  let host: string;
  if (typeof worker === 'string') {
    host = worker;
  } else if ('getHost' in worker) {
    host = worker.getHost();
  } else {
    const gristServer = (worker as RequestWithGrist).gristServer;
    if (!gristServer) { throw new Error('Problem accessing server with upload'); }
    host = gristServer.getHost();
  }
  return `${userId}:${host}`;
}
