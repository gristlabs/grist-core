import * as pidusage from '@gristlabs/pidusage';
import * as bluebird from 'bluebird';
import {EventEmitter} from 'events';
import noop = require('lodash/noop');
import * as path from 'path';

import {ApiError} from 'app/common/ApiError';
import {mapSetOrClear} from 'app/common/AsyncCreate';
import {BrowserSettings} from 'app/common/BrowserSettings';
import {DocCreationInfo, DocEntry, DocListAPI, OpenDocMode, OpenLocalDocResult} from 'app/common/DocListAPI';
import {EncActionBundleFromHub} from 'app/common/EncActionBundle';
import {Invite} from 'app/common/sharing';
import {tbind} from 'app/common/tbind';
import {NEW_DOCUMENT_CODE} from 'app/common/UserAPI';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {assertAccess, Authorizer, DocAuthorizer, DummyAuthorizer,
        isSingleUserMode} from 'app/server/lib/Authorizer';
import {Client} from 'app/server/lib/Client';
import {makeExceptionalDocSession, makeOptDocSession, OptDocSession} from 'app/server/lib/DocSession';
import * as docUtils from 'app/server/lib/docUtils';
import {GristServer} from 'app/server/lib/GristServer';
import {IDocStorageManager} from 'app/server/lib/IDocStorageManager';
import {makeForkIds, makeId} from 'app/server/lib/idUtils';
import * as log from 'app/server/lib/log';
import * as ServerMetrics from 'app/server/lib/ServerMetrics';
import {ActiveDoc} from './ActiveDoc';
import {PluginManager} from './PluginManager';
import {getFileUploadInfo, globalUploadSet, makeAccessId, UploadInfo} from './uploads';

// A TTL in milliseconds to use for material that can easily be recomputed / refetched
// but is a bit of a burden under heavy traffic.
export const DEFAULT_CACHE_TTL = 10000;

/**
 * DocManager keeps track of "active" Grist documents, i.e. those loaded
 * in-memory, with clients connected to them.
 */
export class DocManager extends EventEmitter {
  // Maps docName to promise for ActiveDoc object. Most of the time the promise
  // will be long since resolved, with the resulting document cached.
  private _activeDocs: Map<string, Promise<ActiveDoc>> = new Map();

  constructor(
    public readonly storageManager: IDocStorageManager,
    public readonly pluginManager: PluginManager,
    private _homeDbManager: HomeDBManager|null,
    public gristServer: GristServer
  ) {
    super();
  }

  // attach a home database to the DocManager.  During some tests, it
  // is awkward to have this set up at the point of construction.
  public testSetHomeDbManager(dbManager: HomeDBManager) {
    this._homeDbManager = dbManager;
  }

  /**
   * Returns an implementation of the DocListAPI for the given Client object.
   */
  public getDocListAPIImpl(client: Client): DocListAPI {
    return {
      getDocList:      tbind(this.listDocs, this, client),
      createNewDoc:    tbind(this.createNewDoc, this, client),
      importSampleDoc: tbind(this.importSampleDoc, this, client),
      importDoc:       tbind(this.importDoc, this, client),
      deleteDoc:       tbind(this.deleteDoc, this, client),
      renameDoc:       tbind(this.renameDoc, this, client),
      openDoc:         tbind(this.openDoc, this, client),
    };
  }

  /**
   * Returns the number of currently open docs.
   */
  public numOpenDocs(): number {
    return this._activeDocs.size;
  }

  /**
   * Returns a Map from docId to number of connected clients for each doc.
   */
  public async getDocClientCounts(): Promise<Map<string, number>> {
    const values = await Promise.all(Array.from(this._activeDocs.values(), async (adocPromise) => {
      const adoc = await adocPromise;
      return [adoc.docName, adoc.docClients.clientCount()] as [string, number];
    }));
    return new Map(values);
  }

  /**
   * Returns a promise for all known Grist documents and document invites to show in the doc list.
   */
  public async listDocs(client: Client): Promise<{docs: DocEntry[], docInvites: DocEntry[]}> {
    const docs = await this.storageManager.listDocs();
    return {docs, docInvites: []};
  }

  /**
   * Returns a promise for invites to docs which have not been downloaded.
   */
  public async getLocalInvites(client: Client): Promise<Invite[]> {
    return [];
  }

  /**
   * Creates a new document, fetches it, and adds a table to it.
   * @returns {Promise:String} The name of the new document.
   */
  public async createNewDoc(client: Client): Promise<string> {
    log.debug('DocManager.createNewDoc');
    const docSession = makeExceptionalDocSession('nascent', {client});
    const activeDoc: ActiveDoc = await this.createNewEmptyDoc(docSession, 'Untitled');
    await activeDoc.addInitialTable(docSession);
    return activeDoc.docName;
  }

  /**
   * Download a shared doc by creating a new doc and applying to it the shared doc snapshot actions.
   * Also marks the invite to the doc as ignored, since it has already been accepted.
   * @returns {Promise:String} The name of the new document.
   */
  public async downloadSharedDoc(client: Client, docId: string, docName: string): Promise<string> {
    throw new Error('downloadSharedDoc not implemented');
  }

  /**
   * Creates a new document, fetches it, and adds a table to it.
   * @param {String} sampleDocName: Doc name of a sample document.
   * @returns {Promise:String} The name of the new document.
   */
  public async importSampleDoc(client: Client, sampleDocName: string): Promise<string> {
    const sourcePath = this.storageManager.getSampleDocPath(sampleDocName);
    if (!sourcePath) {
      throw new Error(`no path available to sample ${sampleDocName}`);
    }
    log.info('DocManager.importSampleDoc importing', sourcePath);
    const basenameHint = path.basename(sampleDocName);
    const targetName = await docUtils.createNumbered(basenameHint, '-',
      (name: string) => docUtils.createExclusive(this.storageManager.getPath(name)));

    const targetPath = this.storageManager.getPath(targetName);
    log.info('DocManager.importSampleDoc saving as', targetPath);
    await docUtils.copyFile(sourcePath, targetPath);
    return targetName;
  }

  /**
   * Processes an upload, containing possibly multiple files, to create a single new document, and
   * returns the new document's name/id.
   */
  public async importDoc(client: Client, uploadId: number): Promise<string> {
    const userId = this._homeDbManager ? await client.requireUserId(this._homeDbManager) : null;
    const result = await this._doImportDoc(makeOptDocSession(client),
      globalUploadSet.getUploadInfo(uploadId, this.makeAccessId(userId)), {naming: 'classic'});
    return result.id;
  }

  // Import a document, assigning it a unique id distinct from its title. Cleans up uploadId.
  public importDocWithFreshId(docSession: OptDocSession, userId: number, uploadId: number): Promise<DocCreationInfo> {
    const accessId = this.makeAccessId(userId);
    return this._doImportDoc(docSession, globalUploadSet.getUploadInfo(uploadId, accessId),
                             {naming: 'saved'});
  }

  // Do an import targeted at a specific workspace. Cleans up uploadId.
  // UserId should correspond to the user making the request.
  // A workspaceId of null results in an import to an unsaved doc, not
  // associated with a specific workspace.
  public async importDocToWorkspace(
    userId: number, uploadId: number, workspaceId: number|null, browserSettings?: BrowserSettings,
  ): Promise<DocCreationInfo> {
    if (!this._homeDbManager) { throw new Error("HomeDbManager not available"); }

    const accessId = this.makeAccessId(userId);
    const docSession = makeExceptionalDocSession('nascent', {browserSettings});
    const result = await this._doImportDoc(docSession,
                                           globalUploadSet.getUploadInfo(uploadId, accessId), {
                                             naming: workspaceId ? 'saved' : 'unsaved',
                                             userId,
                                           });
    if (workspaceId) {
      const queryResult = await this._homeDbManager.addDocument({userId}, workspaceId,
                                                                {name: result.title}, result.id);
      if (queryResult.status !== 200) {
        // TODO The ready-to-add document is not yet in storageManager, but is in the filesystem. It
        // should get cleaned up in case of error here.
        throw new ApiError(queryResult.errMessage || 'unable to add imported document', queryResult.status);
      }
    }

    // Ship the import to S3, since it isn't associated with any particular worker at this time.
    // We could associate it with the current worker, but that is not necessarily desirable.
    await this.storageManager.addToStorage(result.id);
    return result;
  }

  /**
   * Imports file at filepath into the app by creating a new document and adding the file to
   *  the documents directory.
   * @param {String} filepath - Path to the current location of the file on the server.
   * @returns {Promise:String} The name of the new document.
   */
  public async importNewDoc(filepath: string): Promise<DocCreationInfo> {
    const uploadId = globalUploadSet.registerUpload([await getFileUploadInfo(filepath)], null, noop, null);
    return await this._doImportDoc(makeOptDocSession(null), globalUploadSet.getUploadInfo(uploadId, null),
                                   {naming: 'classic'});
  }

  /**
   * Deletes the Grist files and directories for a given document name.
   * @param {String} docName - The name of the Grist document to be deleted.
   * @returns {Promise:String} The name of the deleted Grist document.
   *
   */
  public async deleteDoc(client: Client|null, docName: string, deletePermanently: boolean): Promise<string> {
    log.debug('DocManager.deleteDoc starting for %s', docName);
    const docPromise = this._activeDocs.get(docName);
    if (docPromise) {
      // Call activeDoc's shutdown method first, to remove the doc from internal structures.
      const doc: ActiveDoc = await docPromise;
      await doc.shutdown();
    }
    await this.storageManager.deleteDoc(docName, deletePermanently);
    return docName;
  }

  /**
   * Interrupt all clients, forcing them to reconnect.  Handy when a document has changed
   * status in some major way that affects access rights, such as being deleted.
   */
  public async interruptDocClients(docName: string) {
    const docPromise = this._activeDocs.get(docName);
    if (docPromise) {
      const doc: ActiveDoc = await docPromise;
      doc.docClients.interruptAllClients();
    }
  }

  /**
   * Opens a document. Adds the client as a subscriber to the document, and fetches and returns the
   * document's metadata.
   * @returns {Promise:Object} An object with properties:
   *      `docFD` - the descriptor to use in further methods and messages about this document,
   *      `doc` - the object with metadata tables.
   */
  public async openDoc(client: Client, docId: string,
                       mode: OpenDocMode = 'default'): Promise<OpenLocalDocResult> {
    let auth: Authorizer;
    const dbManager = this._homeDbManager;
    if (!isSingleUserMode()) {
      if (!dbManager) { throw new Error("HomeDbManager not available"); }
      // Sets up authorization of the document.
      const org = client.getOrg();
      if (!org) { throw new Error('Documents can only be opened in the context of a specific organization'); }
      const userId = await client.getUserId(dbManager) || dbManager.getAnonymousUserId();

      // We use docId in the key, and disallow urlId, so we can be sure that we are looking at the
      // right doc when we re-query the DB over the life of the websocket.
      const key = {urlId: docId, userId, org};
      log.debug("DocManager.openDoc Authorizer key", key);
      const docAuth = await dbManager.getDocAuthCached(key);
      assertAccess('viewers', docAuth);

      if (docAuth.docId !== docId) {
        // The only plausible way to end up here is if we called openDoc with a urlId rather
        // than a docId.
        throw new Error(`openDoc expected docId ${docAuth.docId} not urlId ${docId}`);
      }
      auth = new DocAuthorizer(dbManager, key, mode, docAuth);
    } else {
      log.debug(`DocManager.openDoc not using authorization for ${docId} because GRIST_SINGLE_USER`);
      auth = new DummyAuthorizer('owners', docId);
    }

    // Fetch the document, and continue when we have the ActiveDoc (which may be immediately).
    const docSessionPrecursor = makeOptDocSession(client);
    docSessionPrecursor.authorizer = auth;
    const activeDoc: ActiveDoc = await this.fetchDoc(docSessionPrecursor, docId);

    if (activeDoc.muted) {
      log.debug('DocManager.openDoc interrupting, called for a muted doc', docId);
      client.interruptConnection();
      throw new Error(`document ${docId} cannot be opened right now`);
    }

    const docSession = activeDoc.addClient(client, auth);
    const [metaTables, recentActions] = await Promise.all([
      activeDoc.fetchMetaTables(docSession),
      activeDoc.getRecentActions(docSession, false)
    ]);
    this.emit('open-doc', this.storageManager.getPath(activeDoc.docName));

    ServerMetrics.get('docs.num_open').set(this._activeDocs.size);
    ServerMetrics.get('app.have_doc_open').set(true);
    ServerMetrics.get('app.doc_open_span').start();

    return {
      docFD: docSession.fd,
      clientId: docSession.client.clientId,
      doc: metaTables,
      log: recentActions,
      plugins: activeDoc.docPluginManager.getPlugins()
    };
  }

  /**
   * Shut down all open docs. This is called, in particular, on server shutdown.
   */
  public async shutdownAll() {
    await Promise.all(Array.from(this._activeDocs.values(),
      adocPromise => adocPromise.then(adoc => adoc.shutdown())));
    try {
      await this.storageManager.closeStorage();
    } catch (err) {
      log.error('DocManager had problem shutting down storage: %s', err.message);
    }

    // Clear the setInterval that the pidusage module sets up internally.
    pidusage.clear();
  }

  // Access a document by name.
  public getActiveDoc(docName: string): Promise<ActiveDoc>|undefined {
    return this._activeDocs.get(docName);
  }

  public async removeActiveDoc(activeDoc: ActiveDoc): Promise<void> {
    this._activeDocs.delete(activeDoc.docName);
    ServerMetrics.get('docs.num_open').set(this._activeDocs.size);
    ServerMetrics.get('app.have_doc_open').set(this._activeDocs.size > 0);
    ServerMetrics.get('app.doc_open_span').setRunning(this._activeDocs.size > 0);
  }

  public async renameDoc(client: Client, oldName: string, newName: string): Promise<void> {
    log.debug('DocManager.renameDoc %s -> %s', oldName, newName);
    const docPromise = this._activeDocs.get(oldName);
    if (docPromise) {
      const adoc: ActiveDoc = await docPromise;
      await adoc.renameDocTo({client}, newName);
      this._activeDocs.set(newName, docPromise);
      this._activeDocs.delete(oldName);
    } else {
      await this.storageManager.renameDoc(oldName, newName);
    }
  }

  public markAsChanged(activeDoc: ActiveDoc) {
    if (!activeDoc.muted) {
      this.storageManager.markAsChanged(activeDoc.docName);
    }
  }

  public markAsEdited(activeDoc: ActiveDoc) {
    if (!activeDoc.muted) {
      this.storageManager.markAsEdited(activeDoc.docName);
    }
  }

  /**
   * Helper function for creating a new empty document that also emits an event.
   * @param docSession The client session.
   * @param basenameHint Suggested base name to use (no directory, no extension).
   */
  public async createNewEmptyDoc(docSession: OptDocSession, basenameHint: string): Promise<ActiveDoc> {
    const docName = await this._createNewDoc(basenameHint);
    return mapSetOrClear(this._activeDocs, docName,
                         this.gristServer.create.ActiveDoc(this, docName).createDoc(docSession));
  }

  /**
   * Fetches an ActiveDoc object. Used by openDoc.
   */
  public async fetchDoc(docSession: OptDocSession, docName: string): Promise<ActiveDoc> {
    log.debug('DocManager.fetchDoc', docName);
    // Repeat until we acquire an ActiveDoc that is not muted (shutting down).
    for (;;) {
      if (!this._activeDocs.has(docName)) {
        const newDoc = this.gristServer.create.ActiveDoc(this, docName);
        // Propagate backupMade events from newly opened activeDocs (consolidate all to DocMan)
        newDoc.on('backupMade', (bakPath: string) => {
          this.emit('backupMade', bakPath);
        });
        return mapSetOrClear(this._activeDocs, docName, newDoc.loadDoc(docSession));
      }
      const activeDoc = await this._activeDocs.get(docName)!;
      if (!activeDoc.muted) { return activeDoc; }
      log.debug('DocManager.fetchDoc waiting because doc is muted', docName);
      await bluebird.delay(1000);
    }
  }

  public makeAccessId(userId: number|null): string|null {
    return makeAccessId(this.gristServer, userId);
  }

  /**
   * Helper function for creating a new shared document given the doc snapshot bundles received
   * from the sharing hub.
   * @param {String} basenameHint: Suggested base name to use (no directory, no extension).
   * @param {String} docId: The docId of the doc received from the hub.
   * @param {String} instanceId: The user instanceId creating the doc.
   * @param {EncActionBundleFromHub[]} encBundles: The action bundles making up the doc snapshot.
   * @returns {Promise:ActiveDoc} ActiveDoc for the newly created document.
   */
  protected async _createNewSharedDoc(basenameHint: string, docId: string, instanceId: string,
                                      encBundles: EncActionBundleFromHub[]): Promise<ActiveDoc> {
    const docName = await this._createNewDoc(basenameHint);
    return mapSetOrClear(this._activeDocs, docName,
      this.gristServer.create.ActiveDoc(this, docName).downloadSharedDoc(docId, instanceId, encBundles));
  }

  /**
   * Helper that implements doing the actual import of an uploaded set of files to create a new
   * document.
   */
  private async _doImportDoc(docSession: OptDocSession, uploadInfo: UploadInfo,
                             options: {
                               naming: 'classic'|'saved'|'unsaved',
                               userId?: number,
                             }): Promise<DocCreationInfo> {
    try {
      const fileCount = uploadInfo.files.length;
      const hasGristDoc = Boolean(uploadInfo.files.find(f => extname(f.origName) === '.grist'));
      if (hasGristDoc && fileCount > 1) {
        throw new Error('Grist docs must be uploaded individually');
      }
      const first = uploadInfo.files[0].origName;
      const ext = extname(first);
      const basename = path.basename(first, ext).trim() || "Untitled upload";
      let id: string;
      switch (options.naming) {
        case 'saved':
          id = makeId();
          break;
        case 'unsaved': {
          const {userId} = options;
          if (!userId) { throw new Error('unsaved import requires userId'); }
          if (!this._homeDbManager) { throw new Error("HomeDbManager not available"); }
          const isAnonymous = userId === this._homeDbManager.getAnonymousUserId();
          id = makeForkIds({userId, isAnonymous, trunkDocId: NEW_DOCUMENT_CODE,
                            trunkUrlId: NEW_DOCUMENT_CODE}).docId;
          break;
        }
        case 'classic':
          id = basename;
          break;
        default:
          throw new Error('naming mode not recognized');
      }
      if (ext === '.grist') {
        // If the import is a grist file, copy it to the docs directory.
        // TODO: We should be skeptical of the upload file to close a possible
        // security vulnerability. See https://phab.getgrist.com/T457.
        const docName = await this._createNewDoc(id);
        const docPath = await this.storageManager.getPath(docName);
        await docUtils.copyFile(uploadInfo.files[0].absPath, docPath);
        return {title: basename, id: docName};
      } else {
        const doc = await this.createNewEmptyDoc(docSession, id);
        await doc.oneStepImport(docSession, uploadInfo);
        return {title: basename, id: doc.docName};
      }
    } catch (err) {
      throw new ApiError(err.message, err.status || 400, {
        tips: [{action: 'ask-for-help', message: 'Ask for help'}]
      });
    } finally {
      await globalUploadSet.cleanup(uploadInfo.uploadId);
    }
  }

  // Returns the name for a new doc, based on basenameHint.
  private async _createNewDoc(basenameHint: string): Promise<string> {
    const docName: string = await docUtils.createNumbered(basenameHint, '-', async (name: string) => {
      if (this._activeDocs.has(name)) {
        throw new Error("Existing entry in active docs for: " + name);
      }
      return docUtils.createExclusive(this.storageManager.getPath(name));
    });
    log.debug('DocManager._createNewDoc picked name', docName);
    await this.pluginManager.pluginsLoaded;
    return docName;
  }
}

// Returns the extension of fpath (from last occurrence of "." to the end of the string), even
// when the basename is empty or starts with a period.
function extname(fpath: string): string {
  return path.extname("X" + fpath);
}
