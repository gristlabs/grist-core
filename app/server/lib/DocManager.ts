import pidusage from '@gristlabs/pidusage';
import {Document} from 'app/gen-server/entity/Document';
import {getScope} from 'app/server/lib/requestUtils';
import * as bluebird from 'bluebird';
import {EventEmitter} from 'events';
import * as path from 'path';

import {ApiError} from 'app/common/ApiError';
import {mapSetOrClear, MapWithTTL} from 'app/common/AsyncCreate';
import {BrowserSettings} from 'app/common/BrowserSettings';
import {DocCreationInfo, DocEntry, DocListAPI, OpenDocOptions, OpenLocalDocResult} from 'app/common/DocListAPI';
import {FilteredDocUsageSummary} from 'app/common/DocUsage';
import {parseUrlId} from 'app/common/gristUrls';
import {Invite} from 'app/common/sharing';
import {tbind} from 'app/common/tbind';
import {TelemetryMetadataByLevel} from 'app/common/Telemetry';
import {NEW_DOCUMENT_CODE} from 'app/common/UserAPI';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {assertAccess, Authorizer, DocAuthorizer, DummyAuthorizer, isSingleUserMode,
        RequestWithLogin} from 'app/server/lib/Authorizer';
import {Client} from 'app/server/lib/Client';
import {
  getDocSessionCachedDoc,
  makeExceptionalDocSession,
  makeOptDocSession,
  OptDocSession
} from 'app/server/lib/DocSession';
import * as docUtils from 'app/server/lib/docUtils';
import {GristServer} from 'app/server/lib/GristServer';
import {IDocStorageManager} from 'app/server/lib/IDocStorageManager';
import {makeForkIds, makeId} from 'app/server/lib/idUtils';
import {checkAllegedGristDoc} from 'app/server/lib/serverUtils';
import log from 'app/server/lib/log';
import {ActiveDoc} from './ActiveDoc';
import {PluginManager} from './PluginManager';
import {getFileUploadInfo, globalUploadSet, makeAccessId, UploadInfo} from './uploads';
import merge = require('lodash/merge');
import noop = require('lodash/noop');

// A TTL in milliseconds to use for material that can easily be recomputed / refetched
// but is a bit of a burden under heavy traffic.
export const DEFAULT_CACHE_TTL = 10000;

// How long to remember that a document has been explicitly set in a
// recovery mode.
export const RECOVERY_CACHE_TTL = 30000;

/**
 * DocManager keeps track of "active" Grist documents, i.e. those loaded
 * in-memory, with clients connected to them.
 */
export class DocManager extends EventEmitter {
  // Maps docName to promise for ActiveDoc object. Most of the time the promise
  // will be long since resolved, with the resulting document cached.
  private _activeDocs: Map<string, Promise<ActiveDoc>> = new Map();
  // Remember recovery mode of documents.
  private _inRecovery = new MapWithTTL<string, boolean>(RECOVERY_CACHE_TTL);

  constructor(
    public readonly storageManager: IDocStorageManager,
    public readonly pluginManager: PluginManager|null,
    private _homeDbManager: HomeDBManager|null,
    public gristServer: GristServer
  ) {
    super();
  }

  public setRecovery(docId: string, recovery: boolean) {
    this._inRecovery.set(docId, recovery);
  }

  // attach a home database to the DocManager.  During some tests, it
  // is awkward to have this set up at the point of construction.
  public testSetHomeDbManager(dbManager: HomeDBManager) {
    this._homeDbManager = dbManager;
  }

  public getHomeDbManager() {
    return this._homeDbManager;
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
    return this.createNamedDoc(docSession, 'Untitled');
  }

  /**
   * Add an ActiveDoc created externally. This is a hook used by
   * grist-static.
   */
  public addActiveDoc(docId: string, activeDoc: ActiveDoc) {
    this._activeDocs.set(docId, Promise.resolve(activeDoc));
  }

  public async createNamedDoc(docSession: OptDocSession, docId: string): Promise<string> {
    const activeDoc: ActiveDoc = await this.createNewEmptyDoc(docSession, docId);
    await activeDoc.addInitialTable(docSession);
    return activeDoc.docName;
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

  /**
   * Do an import targeted at a specific workspace.
   *
   * `userId` should correspond to the user making the request.
   *
   * If workspaceId is omitted, an unsaved doc unassociated with a specific workspace
   * will be created.
   *
   * Cleans up `uploadId` and returns creation info about the imported doc.
   */
  public async importDocToWorkspace(mreq: RequestWithLogin, options: {
    userId: number,
    uploadId: number,
    documentName?: string,
    workspaceId?: number,
    browserSettings?: BrowserSettings,
    telemetryMetadata?: TelemetryMetadataByLevel,
  }): Promise<DocCreationInfo> {
    if (!this._homeDbManager) { throw new Error("HomeDbManager not available"); }

    const {userId, uploadId, documentName, workspaceId, browserSettings, telemetryMetadata} = options;
    const accessId = this.makeAccessId(userId);
    const docSession = makeExceptionalDocSession('nascent', {browserSettings});
    const register = async (docId: string, uploadBaseFilename: string) => {
      if (workspaceId === undefined || !this._homeDbManager) { return; }
      const queryResult = await this._homeDbManager.addDocument(
        {userId},
        workspaceId,
        {name: documentName ?? uploadBaseFilename},
        docId
      );
      if (queryResult.status !== 200) {
        // TODO The ready-to-add document is not yet in storageManager, but is in the filesystem. It
        // should get cleaned up in case of error here.
        throw new ApiError(queryResult.errMessage || 'unable to add imported document', queryResult.status);
      }
    };
    const uploadInfo = globalUploadSet.getUploadInfo(uploadId, accessId);
    const docCreationInfo = await this._doImportDoc(docSession, uploadInfo, {
      naming: workspaceId ? 'saved' : 'unsaved',
      register,
      userId,
    });

    this.gristServer.getTelemetry().logEvent(mreq, 'documentCreated', merge({
      limited: {
        docIdDigest: docCreationInfo.id,
        fileType: uploadInfo.files[0].ext.trim().slice(1),
        isSaved: workspaceId !== undefined,
      },
    }, telemetryMetadata));

    return docCreationInfo;
    // The imported document is associated with the worker that did the import.
    // We could break that association (see /api/docs/:docId/assign for how) if
    // we start using dedicated import workers.
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
      log.debug('DocManager.deleteDoc starting activeDoc shutdown', docName);
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
                       options?: OpenDocOptions): Promise<OpenLocalDocResult> {
    if (typeof options === 'string') {
      throw new Error('openDoc call with outdated parameter type');
    }
    const openMode = options?.openMode || 'default';
    const linkParameters = options?.linkParameters || {};
    const originalUrlId = options?.originalUrlId;
    let auth: Authorizer;
    let userId: number | undefined;
    const dbManager = this._homeDbManager;
    if (!isSingleUserMode()) {
      if (!dbManager) { throw new Error("HomeDbManager not available"); }
      // Sets up authorization of the document.
      const org = client.getOrg();
      if (!org) { throw new Error('Documents can only be opened in the context of a specific organization'); }
      userId = await client.getUserId(dbManager) || dbManager.getAnonymousUserId();
      const userRef = await client.getUserRef(dbManager);

      // We use docId in the key, and disallow urlId, so we can be sure that we are looking at the
      // right doc when we re-query the DB over the life of the websocket.
      const useShareUrlId = Boolean(originalUrlId && parseUrlId(originalUrlId).shareKey);
      const key = {
        urlId: useShareUrlId ? originalUrlId! : docId,
        userId,
        org
      };
      log.debug("DocManager.openDoc Authorizer key", key);
      const docAuth = await dbManager.getDocAuthCached(key);
      assertAccess('viewers', docAuth);

      if (docAuth.docId !== docId) {
        // The only plausible way to end up here is if we called openDoc with a urlId rather
        // than a docId.
        throw new Error(`openDoc expected docId ${docAuth.docId} not urlId ${docId}`);
      }
      auth = new DocAuthorizer({
        dbManager,
        key,
        openMode,
        linkParameters,
        userRef,
        docAuth,
        profile: client.getProfile() || undefined
      });
    } else {
      log.debug(`DocManager.openDoc not using authorization for ${docId} because GRIST_SINGLE_USER`);
      auth = new DummyAuthorizer('owners', docId);
    }

    // Fetch the document, and continue when we have the ActiveDoc (which may be immediately).
    const docSessionPrecursor = makeOptDocSession(client);
    docSessionPrecursor.authorizer = auth;

    return this._withUnmutedDoc(docSessionPrecursor, docId, async () => {
      const activeDoc: ActiveDoc = await this.fetchDoc(docSessionPrecursor, docId);

      // Get a fresh DocSession object.
      const docSession = activeDoc.addClient(client, auth);

      // If opening in (pre-)fork mode, check if it is appropriate to treat the user as
      // an owner for granular access purposes.
      if (openMode === 'fork') {
        if (await activeDoc.canForkAsOwner(docSession)) {
          // Mark the session specially and flush any cached access
          // information.  It is easier to make this a property of the
          // session than to try computing it later in the heat of
          // battle, since it introduces a loop where a user property
          // (user.Access) depends on evaluating rules, but rules need
          // the user properties in order to be evaluated.  It is also
          // somewhat justifiable even if permissions change later on
          // the theory that the fork is theoretically happening at this
          // instance).
          docSession.forkingAsOwner = true;
          activeDoc.flushAccess(docSession);
        } else {
          // TODO: it would be kind to pass on a message to the client
          // to let them know they won't be able to fork.  They'll get
          // an error when they make their first change.  But currently
          // we only have the blunt instrument of throwing an error,
          // which would prevent access to the document entirely.
        }
      }

      const [metaTables, recentActions, userOverride] = await Promise.all([
        activeDoc.fetchMetaTables(docSession),
        activeDoc.getRecentMinimalActions(docSession),
        activeDoc.getUserOverride(docSession),
      ]);

      let docUsage: FilteredDocUsageSummary | undefined;
      try {
        docUsage = await activeDoc.getFilteredDocUsageSummary(docSession);
      } catch (e) {
        log.warn("DocManager.openDoc failed to get doc usage", e);
      }

      const result: OpenLocalDocResult = {
        docFD: docSession.fd,
        clientId: docSession.client.clientId,
        doc: metaTables,
        log: recentActions,
        recoveryMode: activeDoc.recoveryMode,
        userOverride,
        docUsage,
      };

      if (!activeDoc.muted) {
        this.emit('open-doc', this.storageManager.getPath(activeDoc.docName));
      }

      this.gristServer.getTelemetry().logEvent(docSession, 'openedDoc', {
        full: {
          docIdDigest: docId,
          userId,
          altSessionId: client.getAltSessionId(),
        },
      });

      return {activeDoc, result};
    });
  }

  /**
   * Shut down all open docs. This is called, in particular, on server shutdown.
   */
  public async shutdownAll() {
    await Promise.all(Array.from(
      this._activeDocs.values(),
      adocPromise => adocPromise.then(async adoc => {
        log.debug('DocManager.shutdownAll starting activeDoc shutdown', adoc.docName);
        await adoc.shutdown();
      })));
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

  public removeActiveDoc(activeDoc: ActiveDoc): void {
    this._activeDocs.delete(activeDoc.docName);
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

  public markAsChanged(activeDoc: ActiveDoc, reason?: 'edit') {
    // Ignore changes if document is muted or in the middle of a migration.
    if (!activeDoc.muted && !activeDoc.isMigrating()) {
      this.storageManager.markAsChanged(activeDoc.docName, reason);
    }
  }

  public async makeBackup(activeDoc: ActiveDoc, name: string): Promise<string> {
    if (activeDoc.muted) { throw new Error('Document is disabled'); }
    return this.storageManager.makeBackup(activeDoc.docName, name);
  }

  /**
   * Helper function for creating a new empty document that also emits an event.
   * @param docSession The client session.
   * @param basenameHint Suggested base name to use (no directory, no extension).
   */
  public async createNewEmptyDoc(docSession: OptDocSession, basenameHint: string): Promise<ActiveDoc> {
    const docName = await this._createNewDoc(basenameHint);
    return mapSetOrClear(this._activeDocs, docName,
                         this._createActiveDoc(docSession, docName)
                         .then(newDoc => newDoc.createEmptyDoc(docSession)));
  }

  /**
   * Fetches an ActiveDoc object. Used by openDoc. If ActiveDoc is muted (for safe closing),
   * wait for another.
   */
  public async fetchDoc(docSession: OptDocSession, docName: string,
                        wantRecoveryMode?: boolean): Promise<ActiveDoc> {
    log.debug('DocManager.fetchDoc', docName);
    return this._withUnmutedDoc(docSession, docName, async () => {
      const activeDoc = await this._fetchPossiblyMutedDoc(docSession, docName, wantRecoveryMode);
      return {activeDoc, result: activeDoc};
    });
  }

  public makeAccessId(userId: number|null): string|null {
    return makeAccessId(this.gristServer, userId);
  }

  public isAnonymous(userId: number): boolean {
    if (!this._homeDbManager) { throw new Error("HomeDbManager not available"); }
    return userId === this._homeDbManager.getAnonymousUserId();
  }

  /**
   * Perform the supplied operation and return its result - unless the activeDoc it returns
   * is found to be muted, in which case we retry.
   */
  private async _withUnmutedDoc<T>(docSession: OptDocSession, docName: string,
                                   op: () => Promise<{ result: T, activeDoc: ActiveDoc }>): Promise<T> {
    // Repeat until we acquire an ActiveDoc that is not muted (shutting down).
    for (;;) {
      const { result, activeDoc } = await op();
      if (!activeDoc.muted) { return result; }
      log.debug('DocManager._withUnmutedDoc waiting because doc is muted', docName);
      await bluebird.delay(1000);
    }
  }

  // Like fetchDoc(), but doesn't check if ActiveDoc returned is unmuted.
  private async _fetchPossiblyMutedDoc(docSession: OptDocSession, docName: string,
                                       wantRecoveryMode?: boolean): Promise<ActiveDoc> {
    if (this._activeDocs.has(docName) && wantRecoveryMode !== undefined) {
      const activeDoc = await this._activeDocs.get(docName);
      if (activeDoc && activeDoc.recoveryMode !== wantRecoveryMode && await activeDoc.isOwner(docSession)) {
        // shutting doc down to have a chance to re-open in the correct mode.
        // TODO: there could be a battle with other users opening it in a different mode.
        log.debug('DocManager._fetchPossiblyMutedDoc starting activeDoc shutdown', docName);
        await activeDoc.shutdown();
      }
    }
    let activeDoc: ActiveDoc;
    if (!this._activeDocs.has(docName)) {
      activeDoc = await mapSetOrClear(
        this._activeDocs, docName,
        this._createActiveDoc(docSession, docName, wantRecoveryMode ?? this._inRecovery.get(docName))
          .then(newDoc => {
            // Propagate backupMade events from newly opened activeDocs (consolidate all to DocMan)
            newDoc.on('backupMade', (bakPath: string) => {
              this.emit('backupMade', bakPath);
            });
            return newDoc.loadDoc(docSession);
          }));
    } else {
      activeDoc = await this._activeDocs.get(docName)!;
    }
    return activeDoc;
  }

  private async _getDoc(docSession: OptDocSession, docName: string) {
    const cachedDoc = getDocSessionCachedDoc(docSession);
    if (cachedDoc) {
      return cachedDoc;
    }

    let db: HomeDBManager;
    try {
      // For the sake of existing tests, get the db from gristServer where it may not exist and we should give up,
      // rather than using this._homeDbManager which may exist and then it turns out the document itself doesn't.
      db = this.gristServer.getHomeDBManager();
    } catch (e) {
      if (e.message === "no db") {
        return;
      }
      throw e;
    }

    if (docSession.req) {
      const scope = getScope(docSession.req);
      if (scope.urlId) {
        return db.getDoc(scope);
      }
    }

    return await db.getRawDocById(docName);
  }

  private async _getDocUrls(doc: Document) {
    try {
      return {
        docUrl: await this.gristServer.getResourceUrl(doc),
        docApiUrl: await this.gristServer.getResourceUrl(doc, 'api'),
      };
    } catch (e) {
      // If there is no home url, we cannot construct links.  Accept this, for the benefit
      // of legacy tests.
      if (e.message !== "need APP_HOME_URL") {
        throw e;
      }
    }
  }

  private async _createActiveDoc(docSession: OptDocSession, docName: string, safeMode?: boolean) {
    const doc = await this._getDoc(docSession, docName);
    // Get URL for document for use with SELF_HYPERLINK().
    const docUrls = doc && await this._getDocUrls(doc);
    return new ActiveDoc(this, docName, {...docUrls, safeMode, doc});
  }

  /**
   * Helper that implements doing the actual import of an uploaded set of files to create a new
   * document.
   */
  private async _doImportDoc(docSession: OptDocSession, uploadInfo: UploadInfo,
                             options: {
                               naming: 'classic'|'saved'|'unsaved',
                               register?: (docId: string, uploadBaseFilename: string) => Promise<void>,
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
      await options.register?.(id, basename);
      if (ext === '.grist') {
        // If the import is a grist file, copy it to the docs directory.
        // TODO: We should be skeptical of the upload file to close a possible
        // security vulnerability. See https://phab.getgrist.com/T457.
        const docName = await this._createNewDoc(id);
        const docPath: string = this.storageManager.getPath(docName);
        const srcDocPath = uploadInfo.files[0].absPath;
        await checkAllegedGristDoc(docSession, srcDocPath);
        await docUtils.copyFile(srcDocPath, docPath);
        // Go ahead and claim this document. If we wanted to serve it
        // from a potentially different worker, we'd call addToStorage(docName)
        // instead (we used to do this). The upload should already be happening
        // on a randomly assigned worker due to the special treatment of the
        // 'import' assignmentId.
        await this.storageManager.prepareLocalDoc(docName);
        this.storageManager.markAsChanged(docName, 'edit');
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
    await this.pluginManager?.pluginsLoaded;
    return docName;
  }
}

// Returns the extension of fpath (from last occurrence of "." to the end of the string), even
// when the basename is empty or starts with a period.
function extname(fpath: string): string {
  return path.extname("X" + fpath);
}
