import * as bluebird from 'bluebird';
import * as chokidar from 'chokidar';
import * as fse from 'fs-extra';
import moment from 'moment';
import * as path from 'path';

import {DocEntry, DocEntryTag} from 'app/common/DocListAPI';
import {DocSnapshots} from 'app/common/DocSnapshot';
import {DocumentUsage} from 'app/common/DocUsage';
import * as gutil from 'app/common/gutil';
import {Comm} from 'app/server/lib/Comm';
import * as docUtils from 'app/server/lib/docUtils';
import {GristServer} from 'app/server/lib/GristServer';
import {EmptySnapshotProgress, IDocStorageManager, SnapshotProgress} from 'app/server/lib/IDocStorageManager';
import {IShell} from 'app/server/lib/IShell';
import log from 'app/server/lib/log';
import uuidv4 from "uuid/v4";


/**
 * DocStorageManager manages Grist documents. This implementation deals with files in the file
 * system. An alternative implementation could provide the same public methods to implement
 * storage management for the hosted version of Grist.
 *
 * This file-based DocStorageManager uses file path as the docName identifying a document, with
 * one exception. For files in the docsRoot directory, the basename of the document is used
 * instead, with .grist extension stripped; primarily to maintain previous behavior and keep
 * clean-looking URLs. In all other cases, the realpath of the file (including .grist extension)
 * is the canonical docName.
 *
 */
export class DocStorageManager implements IDocStorageManager {
  private _watcher: any;  // chokidar filesystem watcher
  private _shell: IShell;

  /**
   * Initialize with the given root directory, which should be a fully-resolved path (i.e. using
   * fs.realpath or docUtils.realPath).
   * The file watcher is created if the optComm argument is given.
   */
  constructor(private _docsRoot: string, private _samplesRoot?: string,
              private _comm?: Comm, gristServer?: GristServer) {
    // If we have a way to communicate with clients, watch the docsRoot for changes.
    this._watcher = null;
    this._shell = gristServer?.create.Shell?.() || {
      trashItem() { throw new Error('Unable to move document to trash'); },
      showItemInFolder() { throw new Error('Unable to show item in folder'); }
    };
    if (_comm) {
      this._initFileWatcher();
    }
  }

  /**
   * Returns the path to the given document. This is used by DocStorage.js, and is specific to the
   * file-based storage implementation.
   * @param {String} docName: The canonical docName.
   * @returns {String} path: Filesystem path.
   */
  public getPath(docName: string): string {
    docName += (path.extname(docName) === '.grist' ? '' : '.grist');
    return path.resolve(this._docsRoot, docName);
  }

  /**
   * Returns the path to the given sample document.
   */
  public getSampleDocPath(sampleDocName: string): string|null {
    return this._samplesRoot ? this.getPath(path.resolve(this._samplesRoot, sampleDocName)) : null;
  }

  /**
   * Translates a possibly non-canonical docName to a canonical one (e.g. adds .grist to a path
   * without .grist extension, and canonicalizes the path). All other functions deal with
   * canonical docNames.
   * @param {String} altDocName: docName which may not be the canonical one.
   * @returns {Promise:String} Promise for the canonical docName.
   */
  public async getCanonicalDocName(altDocName: string): Promise<string> {
    const p = await docUtils.realPath(this.getPath(altDocName));
    return path.dirname(p) === this._docsRoot ? path.basename(p, '.grist') : p;
  }

  /**
   * Prepares a document for use locally. Returns whether the document is new (needs to be
   * created). This is a no-op in the local DocStorageManager case.
   */
  public async prepareLocalDoc(docName: string): Promise<boolean> { return false; }

  public async prepareToCreateDoc(docName: string): Promise<void> {
    // nothing to do
  }

  public async prepareFork(srcDocName: string, destDocName: string): Promise<string> {
    // This is implemented only to support old tests.
    await fse.copy(this.getPath(srcDocName), this.getPath(destDocName));
    return this.getPath(destDocName);
  }

  /**
   * Returns a promise for the list of docNames to show in the doc list. For the file-based
   * storage, this will include all .grist files under the docsRoot.
   * @returns {Promise:Array<DocEntry>} Promise for an array of objects with `name`, `size`,
   * and `mtime`.
   */
  public listDocs(): Promise<DocEntry[]> {
    return bluebird.Promise.all([
      this._listDocs(this._docsRoot, ""),
      this._samplesRoot ? this._listDocs(this._samplesRoot, "sample") : [],
    ])
    .spread((docsEntries: DocEntry[], samplesEntries: DocEntry[]) => {
      return [...docsEntries, ...samplesEntries];
    });
  }

  /**
   * Deletes a document.
   * @param {String} docName: docName of the document to delete.
   * @returns {Promise} Resolved on success.
   */
  public async deleteDoc(docName: string, deletePermanently?: boolean): Promise<void> {
    const docPath = this.getPath(docName);
    // Keep this check, to protect against wiping out the whole disk or the user's home.
    if (path.extname(docPath) !== '.grist') {
      return Promise.reject(new Error("Refusing to delete path which does not end in .grist"));
    } else if (deletePermanently) {
      await fse.remove(docPath);
    } else {
      await this._shell.trashItem(docPath);
    }
  }

  /**
   * Renames a closed document. In the file-system case, moves files to reflect the new paths. For
   * a document already open, use `docStorageInstance.renameDocTo()` instead.
   * @param {String} oldName: original docName.
   * @param {String} newName: new docName.
   * @returns {Promise} Resolved on success.
   */
  public renameDoc(oldName: string, newName: string): Promise<void> {
    const oldPath = this.getPath(oldName);
    const newPath = this.getPath(newName);
    return docUtils.createExclusive(newPath)
    .catch(async (e: any) => {
      if (e.code !== 'EEXIST') { throw e; }
      const isSame = await docUtils.isSameFile(oldPath, newPath);
      if (!isSame) { throw e; }
    })
    .then(() => fse.rename(oldPath, newPath))
    // Send 'renameDocs' event immediately after the rename. Previously, this used to be sent by
    // DocManager after reopening the renamed doc. The extra delay caused issue T407, where
    // chokidar.watch() triggered 'removeDocs' before 'renameDocs'.
    .then(() => { this._sendDocListAction('renameDocs', oldPath, [oldName, newName]); })
    .catch((err: Error) => {
      log.warn("DocStorageManager: rename %s -> %s failed: %s", oldPath, newPath, err.message);
      throw err;
    });
  }

  /**
   * Should create a backup of the file
   * @param {String} docName - docName to backup
   * @param {String} backupTag - string to identify backup, like foo.grist.$DATE.$TAG.bak
   * @returns {Promise} Resolved on success, returns path to backup (to show user)
   */
  public makeBackup(docName: string, backupTag: string): Promise<string> {
    // this need to persist between calling createNumbered and
    // getting it's return value, to re-add the extension again (._.)
    let ext: string;
    let finalBakPath: string; // holds final value of path, with numbering

    return bluebird.Promise.try(() => this._generateBackupFilePath(docName, backupTag))
    .then((bakPath: string) => { // make a numbered migration if necessary

      log.debug(`DocStorageManager: trying to make backup at ${bakPath}`);

      // create a file at bakPath, adding numbers if necessary
      ext = path.extname(bakPath); // persists to makeBackup closure
      const bakPathPrefix = bakPath.slice(0, -ext.length);
      return docUtils.createNumbered(bakPathPrefix, '-',
        (pathPrefix: string) => docUtils.createExclusive(pathPrefix + ext)
      );
    }).tap((numberedBakPathPrefix: string) => { // do the copying, but return bakPath anyway
      finalBakPath = numberedBakPathPrefix + ext;
      const docPath = this.getPath(docName);
      log.info(`Backing up ${docName} to ${finalBakPath}`);
      return docUtils.copyFile(docPath, finalBakPath);
    }).then(() => {
      log.debug("DocStorageManager: Backup made successfully at: %s", finalBakPath);
      return finalBakPath;
    }).catch((err: Error) => {
      log.error("DocStorageManager: Backup %s %s failed: %s", docName, err.message);
      throw err;
    });
  }

  /**
   * Electron version only. Shows the given doc in the file explorer.
   */
  public async showItemInFolder(docName: string): Promise<void> {
    this._shell.showItemInFolder(this.getPath(docName));
  }

  public async closeStorage() {
    // nothing to do
  }

  public async closeDocument(docName: string) {
    // nothing to do
  }

  public markAsChanged(docName: string): void {
    // nothing to do
  }

  public markAsEdited(docName: string): void {
    // nothing to do
  }

  public scheduleUsageUpdate(
    docName: string,
    docUsage: DocumentUsage,
    minimizeDelay = false
  ): void {
    // nothing to do
  }

  public testReopenStorage(): void {
    // nothing to do
  }

  public async addToStorage(id: string): Promise<void> {
    // nothing to do
  }

  public prepareToCloseStorage(): void {
    // nothing to do
  }

  public async flushDoc(docName: string): Promise<void> {
    // nothing to do
  }

  public async getCopy(docName: string): Promise<string> {
    const srcPath = this.getPath(docName);
    const postfix = uuidv4();
    const tmpPath = `${srcPath}-${postfix}`;
    await docUtils.copyFile(srcPath, tmpPath);
    return tmpPath;
  }

  public async getSnapshots(docName: string, skipMetadataCache?: boolean): Promise<DocSnapshots> {
    throw new Error('getSnapshots not implemented');
  }

  public removeSnapshots(docName: string, snapshotIds: string[]): Promise<void> {
    throw new Error('removeSnapshots not implemented');
  }

  public getSnapshotProgress(): SnapshotProgress {
    return new EmptySnapshotProgress();
  }

  public async replace(docName: string, options: any): Promise<void> {
    throw new Error('replacement not implemented');
  }

  /**
   * Returns a promise for the list of docNames for all docs in the given directory.
   * @returns {Promise:Array<Object>} Promise for an array of objects with `name`, `size`,
   * and `mtime`.
   */
  private _listDocs(dirPath: string, tag: DocEntryTag): Promise<any[]> {
    return fse.readdir(dirPath)
    // Filter out for .grist files, and strip the .grist extension.
    .then(entries => Promise.all(
      entries.filter(e => (path.extname(e) === '.grist'))
      .map(e => {
        const docPath = path.resolve(dirPath, e);
        return fse.stat(docPath)
        .then(stat => getDocListFileInfo(docPath, stat, tag));
      })
    ))
    // Sort case-insensitively.
    .then(entries => entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())))
    // If the root directory is missing, just return an empty array.
    .catch(err => {
      if (err.cause && err.cause.code === 'ENOENT') { return []; }
      throw err;
    });
  }

  /**
   * Generates the filename for the given document backup
   * Backup names should look roughly like:
   * ${basefilename}.grist.${YYYY-MM-DD}.${tag}.bak
   *
   * @returns {Promise} backup filepath (might need to createNumbered)
   */
  private _generateBackupFilePath(docName: string, backupTag: string): Promise<string> {
    const dateString = moment().format("YYYY-MM-DD");

    return docUtils.realPath(this.getPath(docName))
    .then((filePath: string) => {
      const fileName = path.basename(filePath);
      const fileDir = path.dirname(filePath);

      const bakName = `${fileName}.${dateString}.${backupTag}.bak`;
      return path.join(fileDir, bakName);
    });
  }

  /**
   * Creates the file watcher and begins monitoring the docsRoot. Returns the created watcher.
   */
  private _initFileWatcher(): void {
    // NOTE: The chokidar watcher reports file renames as unlink then add events.
    this._watcher = chokidar.watch(this._docsRoot, {
      ignoreInitial: true,  // Prevent messages for initial adds of all docs when watching begins
      depth: 0,             // Ignore changes in subdirectories of docPath
      alwaysStat: true,     // Tells the watcher to always include the stats arg
      // Waits for a file to remain constant for a short time after changing before triggering
      // an action. Prevents reporting of incomplete writes.
      awaitWriteFinish: {
        stabilityThreshold: 100,  // Waits for the file to remain constant for 100ms
        pollInterval: 10         // Polls the file every 10ms after a change
      }
    });
    this._watcher.on('add', (docPath: string, fsStats: any) => {
      this._sendDocListAction('addDocs', docPath, getDocListFileInfo(docPath, fsStats, ""));
    });
    this._watcher.on('change', (docPath: string, fsStats: any) => {
      this._sendDocListAction('changeDocs', docPath, getDocListFileInfo(docPath, fsStats, ""));
    });
    this._watcher.on('unlink', (docPath: string) => {
      this._sendDocListAction('removeDocs', docPath, getDocName(docPath));
    });
  }

  /**
   * Helper to broadcast a docListAction for a single doc to clients. If the action is not on a
   *  '.grist' file, it is not sent.
   * @param {String} actionType - DocListAction type to send, 'addDocs' | 'removeDocs' | 'changeDocs'.
   * @param {String} docPath - System path to the doc including the filename.
   * @param {Any} data - Data to send as the message.
   */
  private _sendDocListAction(actionType: string, docPath: string, data: any): void {
    if (this._comm && gutil.endsWith(docPath, '.grist')) {
      log.debug(`Sending ${actionType} action for doc ${getDocName(docPath)}`);
      this._comm.broadcastMessage('docListAction', { [actionType]: [data] });
    }
  }
}

/**
 * Helper to return the docname (without .grist) given the path to the .grist file.
 */
function getDocName(docPath: string): string {
  return path.basename(docPath, '.grist');
}

/**
 * Helper to get the stats used by the Grist DocList for a document.
 * @param {String} docPath - System path to the doc including the doc filename.
 * @param {Object} fsStat - fs.Stats object describing the file metadata.
 * @param {String} tag - The tag indicating the type of doc.
 * @return {Promise:Object} Promise for an object containing stats for the requested doc.
 */
function getDocListFileInfo(docPath: string, fsStat: any, tag: DocEntryTag): DocEntry {
  return {
    docId: undefined,                // TODO: Should include docId if it exists
    name: getDocName(docPath),
    mtime: fsStat.mtime,
    size: fsStat.size,
    tag
  };
}
