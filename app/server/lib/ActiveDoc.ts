/**
 * Module to manage "active" Grist documents, i.e. those loaded in-memory, with
 * clients connected to them. It handles the incoming user actions, and outgoing
 * change events.
 */

import * as assert from 'assert';
import * as bluebird from 'bluebird';
import {EventEmitter} from 'events';
import {IMessage, MsgType} from 'grain-rpc';
import * as imageSize from 'image-size';
import flatten = require('lodash/flatten');
import remove = require('lodash/remove');
import zipObject = require('lodash/zipObject');
import * as moment from 'moment-timezone';
import * as tmp from 'tmp';
import * as util from 'util';

import {getEnvContent, LocalActionBundle} from 'app/common/ActionBundle';
import {SandboxActionBundle, UserActionBundle} from 'app/common/ActionBundle';
import {ActionGroup} from 'app/common/ActionGroup';
import {ApplyUAOptions, ApplyUAResult, ForkResult} from 'app/common/ActiveDocAPI';
import {DataSourceTransformed, ImportResult, Query, QueryResult} from 'app/common/ActiveDocAPI';
import {ApiError} from 'app/common/ApiError';
import {mapGetOrSet, MapWithTTL} from 'app/common/AsyncCreate';
import {BulkColValues, CellValue, DocAction, RowRecord, TableDataAction, UserAction} from 'app/common/DocActions';
import {toTableDataAction} from 'app/common/DocActions';
import {DocData} from 'app/common/DocData';
import {EncActionBundleFromHub} from 'app/common/EncActionBundle';
import {byteString} from 'app/common/gutil';
import {InactivityTimer} from 'app/common/InactivityTimer';
import * as marshal from 'app/common/marshal';
import {Peer} from 'app/common/sharing';
import {UploadResult} from 'app/common/uploads';
import {DocReplacementOptions, DocState} from 'app/common/UserAPI';
import {Permissions} from 'app/gen-server/lib/Permissions';
import {ParseOptions} from 'app/plugin/FileParserAPI';
import {GristDocAPI} from 'app/plugin/GristAPI';
import {Authorizer} from 'app/server/lib/Authorizer';
import {checksumFile} from 'app/server/lib/checksumFile';
import {Client} from 'app/server/lib/Client';
import {DEFAULT_CACHE_TTL, DocManager} from 'app/server/lib/DocManager';
import {DocSnapshots} from 'app/server/lib/DocSnapshots';
import {makeForkIds} from 'app/server/lib/idUtils';
import {ISandbox} from 'app/server/lib/ISandbox';
import * as log from 'app/server/lib/log';
import {shortDesc} from 'app/server/lib/shortDesc';
import {fetchURL, FileUploadInfo, globalUploadSet, UploadInfo} from 'app/server/lib/uploads';

import {ActionHistory} from './ActionHistory';
import {ActionHistoryImpl} from './ActionHistoryImpl';
import {ActiveDocImport} from './ActiveDocImport';
import {DocClients} from './DocClients';
import {DocPluginManager} from './DocPluginManager';
import {DocSession, getDocSessionAccess, getDocSessionUserId, makeExceptionalDocSession,
        OptDocSession} from './DocSession';
import {DocStorage} from './DocStorage';
import {expandQuery} from './ExpandedQuery';
import {GranularAccess} from './GranularAccess';
import {OnDemandActions} from './OnDemandActions';
import {findOrAddAllEnvelope, Sharing} from './Sharing';

bluebird.promisifyAll(tmp);

const MAX_RECENT_ACTIONS = 100;

const DEFAULT_TIMEZONE = (process.versions as any).electron ? moment.tz.guess() : "UTC";

// Number of seconds an ActiveDoc is retained without any clients.
// In dev environment, it is convenient to keep this low for quick tests.
// In production, it is reasonable to stretch it out a bit.
const ACTIVEDOC_TIMEOUT = (process.env.NODE_ENV === 'production') ? 30 : 5;

// We'll wait this long between re-measuring sandbox memory.
const MEMORY_MEASUREMENT_INTERVAL_MS = 60 * 1000;

// A hook for dependency injection.
export const Deps = {ACTIVEDOC_TIMEOUT};

/**
 * Represents an active document with the given name. The document isn't actually open until
 * either .loadDoc() or .createDoc() is called.
 * @param {String} docName - The document's filename, without the '.grist' extension.
 */
export class ActiveDoc extends EventEmitter {
  /**
   * Decorator for ActiveDoc methods that prevents shutdown while the method is running, i.e.
   * until the returned promise is resolved.
   */
  public static keepDocOpen(target: ActiveDoc, propertyKey: string, descriptor: PropertyDescriptor) {
    const origFunc = descriptor.value;
    descriptor.value = function(this: ActiveDoc) {
      return this._inactivityTimer.disableUntilFinish(origFunc.apply(this, arguments));
    };
  }

  public readonly docStorage: DocStorage;
  public readonly docPluginManager: DocPluginManager;
  public readonly docClients: DocClients;               // Only exposed for Sharing.ts
  public docData: DocData|null = null;

  protected _actionHistory: ActionHistory;
  protected _docManager: DocManager;
  protected _docName: string;
  protected _sharing: Sharing;
  private readonly _dataEngine: ISandbox;
  private _activeDocImport: ActiveDocImport;
  private _onDemandActions: OnDemandActions;
  private _granularAccess: GranularAccess;
  private _muted: boolean = false;  // If set, changes to this document should not propagate
                                    // to outside world
  private _initializationPromise: Promise<boolean>|null = null;
                                    // If set, wait on this to be sure the ActiveDoc is fully
                                    // initialized.  True on success.
  private _fullyLoaded: boolean = false;  // Becomes true once all columns are loaded/computed.
  private _lastMemoryMeasurement: number = 0;   // Timestamp when memory was last measured.
  private _fetchCache = new MapWithTTL<string, Promise<TableDataAction>>(DEFAULT_CACHE_TTL);

  // Timer for shutting down the ActiveDoc a bit after all clients are gone.
  private _inactivityTimer = new InactivityTimer(() => this.shutdown(), Deps.ACTIVEDOC_TIMEOUT * 1000);

  constructor(docManager: DocManager, docName: string) {
    super();
    this._docManager = docManager;
    this._docName = docName;
    this.docStorage = new DocStorage(docManager.storageManager, docName);
    this.docClients = new DocClients(this);
    this._actionHistory = new ActionHistoryImpl(this.docStorage);
    this.docPluginManager = new DocPluginManager(docManager.pluginManager.getPlugins(),
      docManager.pluginManager.appRoot!, this, this._docManager.gristServer);

    // Our DataEngine is a separate sandboxed process (one per open document). The data engine runs
    // user-defined python code including formula calculations. It maintains all document data and
    // metadata, and applies translates higher-level UserActions into lower-level DocActions.
    this._dataEngine = this._docManager.gristServer.create.NSandbox({
      comment: docName,
      logCalls: false,
      logTimes: true,
      logMeta: {docId: docName},
    });

    this._activeDocImport = new ActiveDocImport(this);

    // Schedule shutdown immediately. If a client connects soon (normal case), it will get
    // unscheduled. If not (e.g. abandoned import, network problems after creating a doc), then
    // the ActiveDoc will get cleaned up.
    this._inactivityTimer.enable();
  }

  public get docName(): string { return this._docName; }

  // Helpers to log a message along with metadata about the request.
  public logDebug(s: OptDocSession, msg: string, ...args: any[]) { this._log('debug', s, msg, ...args); }
  public logInfo(s: OptDocSession, msg: string, ...args: any[]) { this._log('info', s, msg, ...args); }
  public logWarn(s: OptDocSession, msg: string, ...args: any[]) { this._log('warn', s, msg, ...args); }
  public logError(s: OptDocSession, msg: string, ...args: any[]) { this._log('error', s, msg, ...args); }

  // Constructs metadata for logging, given a Client or an OptDocSession.
  public getLogMeta(docSession: OptDocSession, docMethod?: string): log.ILogMeta {
    const client = docSession.client;
    const access = getDocSessionAccess(docSession);
    return {
      docId: this._docName,
      access,
      ...(docMethod ? {docMethod} : {}),
      ...(client ? client.getLogMeta() : {}),
    };
  }

  public setMuted() {
    this._muted = true;
  }

  public get muted() {
    return this._muted;
  }

  // Note that this method is only used in tests, and should be avoided in production (see note
  // in ActionHistory about getRecentActions).
  public getRecentActionsDirect(maxActions?: number): Promise<LocalActionBundle[]> {
    return this._actionHistory.getRecentActions(maxActions);
  }

  public async getRecentStates(docSession: OptDocSession, maxStates?: number): Promise<DocState[]> {
    // Doc states currently don't include user content, so it seems ok to let all
    // viewers have access to them.
    return this._actionHistory.getRecentStates(maxStates);
  }

  /**
   * Access specific actions identified by actionNum.
   * TODO: for memory reasons on large docs, would be best not to hold many actions
   * in memory at a time, so should e.g. fetch them one at a time.
   */
  public getActions(actionNums: number[]): Promise<Array<LocalActionBundle|undefined>> {
    return this._actionHistory.getActions(actionNums);
  }

  /**
   * Get the most recent actions from the history.  Results are ordered by
   * earliest actions first, later actions later.  If `summarize` is set,
   * action summaries are computed and included.
   */
  public async getRecentActions(docSession: OptDocSession, summarize: boolean): Promise<ActionGroup[]> {
    const groups = await this._actionHistory.getRecentActionGroups(MAX_RECENT_ACTIONS,
      {client: docSession.client, summarize});
    return groups.filter(actionGroup => this._granularAccess.allowActionGroup(docSession, actionGroup));
  }

  /** expose action history for tests */
  public getActionHistory(): ActionHistory {
    return this._actionHistory;
  }

  /**
   * Adds a client of this doc to the list of connected clients.
   * @param client: The client object maintaining the websocket connection.
   * @param authorizer: The authorizer for the client/doc combination.
   * @returns docSession
   */
  public addClient(client: Client, authorizer: Authorizer): DocSession {
    const docSession: DocSession = this.docClients.addClient(client, authorizer);

    // If we had a shutdown scheduled, unschedule it.
    if (this._inactivityTimer.isEnabled()) {
      this.logInfo(docSession, "will stay open");
      this._inactivityTimer.disable();
    }
    return docSession;
  }

  /**
   * Shut down the ActiveDoc, and (by default) remove it from the docManager.
   * @returns {Promise} Promise for when database and data engine are done shutting down.
   */
  public async shutdown(removeThisActiveDoc: boolean = true): Promise<void> {
    const docSession = makeExceptionalDocSession('system');
    this.logDebug(docSession, "shutdown starting");
    this._inactivityTimer.disable();
    if (this.docClients.clientCount() > 0) {
      this.logWarn(docSession, `Doc being closed with ${this.docClients.clientCount()} clients left`);
      await this.docClients.broadcastDocMessage(null, 'docShutdown', null);
      this.docClients.removeAllClients();
    }

    // Clear the MapWithTTL to remove all timers from the event loop.
    this._fetchCache.clear();

    if (removeThisActiveDoc) { await this._docManager.removeActiveDoc(this); }
    try {
      await this._docManager.storageManager.closeDocument(this.docName);
    } catch (err) {
      log.error('Problem shutting down document: %s %s', this.docName, err.message);
    }

    try {
      await Promise.all([
        this.docStorage.shutdown(),
        this.docPluginManager.shutdown(),
        this._dataEngine.shutdown()
      ]);
      // The this.waitForInitialization promise may not yet have resolved, but
      // should do so quickly now we've killed everything it depends on.
      try {
        await this.waitForInitialization();
      } catch (err) {
        // Initialization errors do not matter at this point.
      }
      this.logDebug(docSession, "shutdown complete");
    } catch (err) {
      this.logError(docSession, "failed to shutdown some resources", err);
    }
  }

  /**
   * Create a new blank document. Returns a promise for the ActiveDoc itself.
   */
  @ActiveDoc.keepDocOpen
  public async createDoc(docSession: OptDocSession): Promise<ActiveDoc> {
    this.logDebug(docSession, "createDoc");
    await this.docStorage.createFile();
    await this._dataEngine.pyCall('load_empty');
    const timezone = docSession.browserSettings ? docSession.browserSettings.timezone : DEFAULT_TIMEZONE;
    // This init action is special. It creates schema tables, and is used to init the DB, but does
    // not go through other steps of a regular action (no ActionHistory or broadcasting).
    const initBundle = await this._dataEngine.pyCall('apply_user_actions', [["InitNewDoc", timezone]]);
    await this.docStorage.execTransaction(() =>
      this.docStorage.applyStoredActions(getEnvContent(initBundle.stored)));

    await this._initDoc(docSession);
    // Makes sure docPluginManager is ready in case new doc is used to import new data
    await this.docPluginManager.ready;
    this._fullyLoaded = true;
    return this;
  }

  /**
   * Loads an existing document from storage, fetching all data from the database via DocStorage and
   * loading it into the DataEngine.  User tables are not immediately loaded (see use of
   * this.waitForInitialization throughout this class to wait for that).
   * @returns {Promise} Promise for this ActiveDoc itself.
   */
  @ActiveDoc.keepDocOpen
  public async loadDoc(docSession: OptDocSession): Promise<ActiveDoc> {
    const startTime = Date.now();
    this.logDebug(docSession, "loadDoc");
    try {
      const isNew: boolean = await this._docManager.storageManager.prepareLocalDoc(this.docName,
                                                                                   docSession);
      if (isNew) {
        await this.createDoc(docSession);
        await this.addInitialTable(docSession);
      } else {
        await this.docStorage.openFile();
        const tableNames = await this._loadOpenDoc(docSession);
        const desiredTableNames = tableNames.filter(name => name.startsWith('_grist_'));
        await this._loadTables(docSession, desiredTableNames);
        const pendingTableNames = tableNames.filter(name => !name.startsWith('_grist_'));
        await this._initDoc(docSession);
        this._initializationPromise = this._finishInitialization(docSession, pendingTableNames, startTime);
      }
    } catch (err) {
      await this.shutdown();
      throw err;
    }
    return this;
  }

  /**
   * Replace this document with another, in-place so its id and other metadata does not change.
   * This operation will leave the ActiveDoc it is called for unusable.  It will mute it,
   * shut it down, and unlist it via the DocManager.  A fresh ActiveDoc can be acquired via the
   * DocManager.
   */
  public async replace(source: DocReplacementOptions) {
    // During replacement, it is important for all hands to be off the document.  So:
    //  - We set the "mute" flag.  Setting this means that any operations in progress
    //    using this ActiveDoc should be ineffective (apart from the replacement).
    //    In other words, the operations shouldn't ultimately result in any changes in S3,
    //    and any related requests should result in a failure or be retried.  TODO:
    //    review how well we do on meeting this goal.
    //  - We close the ActiveDoc, retaining its listing in DocManager but shutting down
    //    all its component parts.  We retain it in DocManager to delay another
    //    ActiveDoc being opened for the same document if someone is trying to operate
    //    on it.
    //  - We replace the document.
    //  - We remove the ActiveDoc from DocManager, opening the way for the document to be
    //    freshly opened.
    // The "mute" flag is borrowed from worker shutdown.  Note this scenario is a little
    // different, since the worker is not withdrawing from service, so fresh work may get
    // assigned to it at any time.
    this.setMuted();
    this.docClients.interruptAllClients();
    try {
      await this.shutdown(false);
      await this._docManager.storageManager.replace(this.docName, source);
    } finally {
      // Whatever happened, success or failure, there is nothing further we can do
      // with this ActiveDoc.  Unlist it.
      await this._docManager.removeActiveDoc(this);
    }
  }

  /**
   * Create a document given encrypted action bundles from the sharing hub. Part of the process
   * of downloading a shared doc.
   * TODO: Not only the snapshot but all actions shared to the hub before download are applied
   * directly to the database, meaning they cannot be undone by this instance. We may want to
   * consider applying actions following the snapshot differently.
   */
  public async downloadSharedDoc(
    docId: string,
    instanceId: string,
    encBundles: EncActionBundleFromHub[]
  ): Promise<ActiveDoc> {
    throw new Error('downloadSharedDoc not implemented');
  }

  /**
   * Finish initializing ActiveDoc, by initializing ActionHistory, Sharing, and docData.
   */
  public async _initDoc(docSession: OptDocSession|null): Promise<void> {
    const metaTableData = await this._dataEngine.pyCall('fetch_meta_tables');
    this.docData = new DocData(tableId => this.fetchTable(makeExceptionalDocSession('system'), tableId), metaTableData);
    this._onDemandActions = new OnDemandActions(this.docStorage, this.docData);

    await this._actionHistory.initialize();
    this._granularAccess = new GranularAccess(this.docData, (query) => {
      return this.fetchQuery(makeExceptionalDocSession('system'), query, true)
    });
    await this._granularAccess.update();
    this._sharing = new Sharing(this, this._actionHistory);

    await this.openSharedDoc(docSession);
  }

  public async openSharedDoc(docSession: OptDocSession|null) {
    // Doesn't do anything special in this base class.
  }

  /**
   * Adds a small table to start off a newly-created blank document.
   */
  public addInitialTable(docSession: OptDocSession) {
    return this._applyUserActions(docSession, [["AddEmptyTable"]]);
  }

  /**
   * Imports files, removes previously created temporary hidden tables and creates the new ones.
   * Param `prevTableIds` is an array of hiddenTableIds as received from previous `importFiles`
   * call, or empty if there was no previous call.
   */
  public importFiles(docSession: DocSession, dataSource: DataSourceTransformed,
                     parseOptions: ParseOptions, prevTableIds: string[]): Promise<ImportResult> {
    return this._activeDocImport.importFiles(docSession, dataSource, parseOptions, prevTableIds);
  }

  /**
   * Finishes import files, creates the new tables, and cleans up temporary hidden tables and uploads.
   * Param `prevTableIds` is an array of hiddenTableIds as received from previous `importFiles`
   * call, or empty if there was no previous call.
   */
  public finishImportFiles(docSession: DocSession, dataSource: DataSourceTransformed,
                           parseOptions: ParseOptions, prevTableIds: string[]): Promise<ImportResult> {
    return this._activeDocImport.finishImportFiles(docSession, dataSource, parseOptions, prevTableIds);
  }

  /**
   * Cancels import files, cleans up temporary hidden tables and uploads.
   * Param `prevTableIds` is an array of hiddenTableIds as received from previous `importFiles`
   * call, or empty if there was no previous call.
   */
  public cancelImportFiles(docSession: DocSession, dataSource: DataSourceTransformed,
                           prevTableIds: string[]): Promise<void> {
    return this._activeDocImport.cancelImportFiles(docSession, dataSource, prevTableIds);
  }

  /**
   * Close the current document.
   */
  public async closeDoc(docSession: DocSession): Promise<void> {
    // Note that it's async only to satisfy the Rpc interface that expects a promise.
    this.docClients.removeClient(docSession);

    // If no more clients, schedule a shutdown.
    if (this.docClients.clientCount() === 0) {
      this.logInfo(docSession, "will self-close in %ds", Deps.ACTIVEDOC_TIMEOUT);
      this._inactivityTimer.enable();
    }
  }

  /**
   * Import the given upload as new tables in one step.
   */
  @ActiveDoc.keepDocOpen
  public async oneStepImport(docSession: OptDocSession, uploadInfo: UploadInfo): Promise<void> {
    await this._activeDocImport.oneStepImport(docSession, uploadInfo);
  }

  /**
   * This function saves attachments from a given upload and creates an entry for them in the database.
   * It returns the list of rowIds for the rows created in the _grist_Attachments table.
   */
  public async addAttachments(docSession: OptDocSession, uploadId: number): Promise<number[]> {
    const userId = getDocSessionUserId(docSession);
    const upload: UploadInfo = globalUploadSet.getUploadInfo(uploadId, this.makeAccessId(userId));
    try {
      const userActions: UserAction[] = await Promise.all(
        upload.files.map(file => this._prepAttachment(docSession, file)));
      const result = await this._applyUserActions(docSession, userActions);
      return result.retValues;
    } finally {
      await globalUploadSet.cleanup(uploadId);
    }
  }

  /**
   * Returns the record from _grist_Attachments table for the given attachment ID,
   * or throws an error if not found.
   */
  public getAttachmentMetadata(attId: number|string): RowRecord {
    // docData should always be available after loadDoc() or createDoc().
    if (!this.docData) {
      throw new Error("No doc data");
    }
    // Parse strings into numbers to make more convenient to call from route handlers.
    const attachmentId: number = (typeof attId === 'string') ? parseInt(attId, 10) : attId;
    const attRecord = this.docData.getTable('_grist_Attachments')!.getRecord(attachmentId);
    if (!attRecord) {
      throw new ApiError(`Attachment not found: ${attId}`, 404);
    }
    return attRecord;
  }

  /**
   * Given the fileIdent of an attachment, returns a promise for the attachment data.
   * @param {String} fileIdent: The unique identifier of the attachment (as stored in fileIdent
   *    field of the _grist_Attachments table).
   * @returns {Promise<Buffer>} Promise for the data of this attachment; rejected on error.
   */
  public async getAttachmentData(docSession: OptDocSession, fileIdent: string): Promise<Buffer> {
    // We don't know for sure whether the attachment is available via a table the user
    // has access to, but at least they are presenting a SHA1 checksum of the file content,
    // and they have at least view access to the document to get to this point.  So we go ahead
    // and serve the attachment.
    const data = await this.docStorage.getFileData(fileIdent);
    if (!data) { throw new ApiError("Invalid attachment identifier", 404); }
    this.logInfo(docSession, "getAttachment: %s -> %s bytes", fileIdent, data.length);
    return data;
  }

  /**
   * Fetches the meta tables to return to the client when first opening a document.
   */
  public async fetchMetaTables(docSession: OptDocSession) {
    this.logInfo(docSession, "fetchMetaTables");
    if (!this.docData) { throw new Error("No doc data"); }
    // Get metadata from local cache rather than data engine, so that we can
    // still get it even if data engine is busy calculating.
    const tables: {[key: string]: TableDataAction} = {};
    for (const [tableId, tableData] of this.docData.getTables().entries()) {
      if (!tableId.startsWith('_grist_')) { continue; }
      tables[tableId] = tableData.getTableDataAction();
    }
    return this._granularAccess.filterMetaTables(docSession, tables);
  }

  /**
   * Makes sure document is completely initialized.  May throw if doc is broken.
   */
  public async waitForInitialization() {
    if (this._initializationPromise) {
      if (!await this._initializationPromise) {
        throw new Error('ActiveDoc initialization failed');
      }
    }
    return true;
  }

  // Check if user has rights to download this doc.
  public canDownload(docSession: OptDocSession) {
    return this._granularAccess.hasViewAccess(docSession) &&
      this._granularAccess.canReadEverything(docSession);
  }

  /**
   * Fetches a particular table from the data engine to return to the client.
   * @param {String} tableId: The string identifier of the table.
   * @param {Boolean} waitForFormulas: If true, wait for all data to be loaded/calculated.
   * @returns {Promise} Promise for the TableData object, which is a BulkAddRecord-like array of the
   *      form of the form ["TableData", table_id, row_ids, column_values].
   */
  public async fetchTable(docSession: OptDocSession, tableId: string,
                          waitForFormulas: boolean = false): Promise<TableDataAction> {
    this.logInfo(docSession, "fetchTable(%s, %s)", docSession, tableId);
    return this.fetchQuery(docSession, {tableId, filters: {}}, waitForFormulas);
  }

  /**
   * Fetches data according to the given query, which includes tableId and filters (see Query in
   * app/common/ActiveDocAPI.ts). The data is fetched from the data engine for regular tables, or
   * from the DocStorage directly for onDemand tables.
   * @param {Boolean} waitForFormulas: If true, wait for all data to be loaded/calculated.  If false,
   * special "pending" values may be returned.
   */
  public async fetchQuery(docSession: OptDocSession, query: Query,
                          waitForFormulas: boolean = false): Promise<TableDataAction> {
    this._inactivityTimer.ping();     // The doc is in active use; ping it to stay open longer.

    // If user does not have rights to access what this query is asking for, fail.
    const tableAccess = this._granularAccess.getTableAccess(docSession, query.tableId);
    if (!(tableAccess.permission & Permissions.VIEW)) {
      throw new Error('not authorized to read table');
    }

    // Some tests read _grist_ tables via the api.  The _fetchQueryFromDB method
    // currently cannot read those tables, so we load them from the data engine
    // when ready.
    // Also, if row-level access is being controlled, we wait for formula columns
    // to be populated.
    const wantFull = waitForFormulas || query.tableId.startsWith('_grist_') ||
      tableAccess.rowPermissionFunctions.length > 0;
    const onDemand = this._onDemandActions.isOnDemand(query.tableId);
    this.logInfo(docSession, "fetchQuery(%s, %s) %s", docSession, JSON.stringify(query),
      onDemand ? "(onDemand)" : "(regular)");
    let data: TableDataAction;
    if (onDemand) {
      data = await this._fetchQueryFromDB(query, onDemand);
    } else if (wantFull) {
      await this.waitForInitialization();
      data = await this._fetchQueryFromDataEngine(query);
    } else {
      if (!this._fullyLoaded) {
        data = await this._fetchQueryFromDB(query, false);
      }
      if (this._fullyLoaded) {  // Already loaded or finished loading while fetching from DB
        const key = JSON.stringify(query);
        // TODO: cache longer if the underlying fetch takes longer to do.
        data = await mapGetOrSet(this._fetchCache, key, () => this._fetchQueryFromDataEngine(query));
      }
    }
    // If row-level access is being controlled, filter the data appropriately.
    if (tableAccess.rowPermissionFunctions.length > 0) {
      this._granularAccess.filterData(data!, tableAccess);
    }
    this.logInfo(docSession, "fetchQuery -> %d rows, cols: %s",
             data![2].length, Object.keys(data![3]).join(", "));
    return data!;
  }

  /**
   * Fetches the generated schema for a given table.
   * @param {String} tableId: The string identifier of the table.
   * @returns {Promise} Promise for a string representing the generated table schema.
   */
  public async fetchTableSchema(docSession: DocSession): Promise<string> {
    this.logInfo(docSession, "fetchTableSchema(%s)", docSession);
    await this.waitForInitialization();
    return this._dataEngine.pyCall('fetch_table_schema');
  }

  /**
   * Makes a query (documented elsewhere) and subscribes to it, so that the client receives
   * docActions that affect this query's results.
   */
  public async useQuerySet(docSession: OptDocSession, query: Query): Promise<QueryResult> {
    this.logInfo(docSession, "useQuerySet(%s, %s)", docSession, query);
    // TODO implement subscribing to the query.
    // - Convert tableId+colIds to TableData/ColData references
    // - Return a unique identifier for unsubscribing
    // - Each call can create its own object, return own identifier.
    // - Subscription should not be affected by renames (so don't hold on to query/tableId/colIds)
    // - Table/column deletion should make subscription inactive, and unsubscribing an inactive
    //   subscription should not produce an error.
    const tableData: TableDataAction = await this.fetchQuery(docSession, query);
    return {querySubId: 0, tableData};
  }

  /**
   * Removes all subscriptions to the given query from this client, so that it stops receiving
   * docActions relevant only to this query.
   */
  public async disposeQuerySet(docSession: DocSession, querySubId: number): Promise<void> {
    this.logInfo(docSession, "disposeQuerySet(%s, %s)", docSession, querySubId);
    // TODO To-be-implemented
  }

  /**
   * Returns the most likely target column in the document for the given column.
   * @param {Array} values: An array of values to search for in columns in the document.
   * @param {Number} n: Number of results to return.
   * @param {String} optTableId: If a valid tableId, search only that table.
   * @returns {Promise} Promise for an array of colRefs describing matching columns ordered from
   *  best to worst. Match quality is determined by searching only a sample of column data.
   *  See engine.py find_col_from_values for implementation.
   */
  public async findColFromValues(docSession: DocSession, values: any[], n: number,
                                 optTableId?: string): Promise<number[]> {
    // This could leak information about private tables, so if user cannot read entire
    // document, do nothing.
    if (!this._granularAccess.canReadEverything(docSession)) { return []; }
    this.logInfo(docSession, "findColFromValues(%s, %s, %s)", docSession, values, n);
    await this.waitForInitialization();
    return this._dataEngine.pyCall('find_col_from_values', values, n, optTableId);
  }

  /**
   * Returns error message (traceback) for one invalid formula cell.
   * @param {String} tableId - Table name
   * @param {String} colId - Column name
   * @param {Integer} rowId - Row number
   * @returns {Promise} Promise for a error message
   */
  public async getFormulaError(docSession: DocSession, tableId: string, colId: string,
                               rowId: number): Promise<CellValue> {
    if (!this._granularAccess.hasTableAccess(docSession, tableId)) { return null; }
    this.logInfo(docSession, "getFormulaError(%s, %s, %s, %s)",
      docSession, tableId, colId, rowId);
    await this.waitForInitialization();
    return this._dataEngine.pyCall('get_formula_error', tableId, colId, rowId);
  }

  /**
   * Applies an array of user actions received from a browser client.
   *
   * @param {Object} docSession: The client session originating this action.
   * @param {Array} action: The user action to apply, e.g. ["UpdateRecord", tableId, rowId, etc].
   * @param {Object} options: See _applyUserActions for documentation
   * @returns {Promise:Array[Object]} Promise that's resolved when action is applied successfully.
   *                                          The array includes the retValue objects for each
   *                                          actionGroup.
   */
  public async applyUserActions(docSession: OptDocSession, actions: UserAction[],
                                options?: ApplyUAOptions): Promise<ApplyUAResult> {
    assert(Array.isArray(actions), "`actions` parameter should be an array.");
    // Be careful not to sneak into user action queue before Calculate action, otherwise
    // there'll be a deadlock.
    await this.waitForInitialization();
    const newOptions = {linkId: docSession.linkId, ...options};
    // Granular access control implemented in _applyUserActions.
    const result: ApplyUAResult = await this._applyUserActions(docSession, actions, newOptions);
    docSession.linkId = docSession.shouldBundleActions ? result.actionNum : 0;
    return result;
  }

  /**
   * A variant of applyUserActions where actions are passed in by ids (actionNum, actionHash)
   * rather than by value.
   *
   * @param docSession: The client session originating this action.
   * @param actionNums: The user actions to do/undo, by actionNum.
   * @param actionHashes: actionHash checksums for each listed actionNum.
   * @param undo: Whether the actions are to be undone.
   * @param options: As for applyUserActions.
   * @returns Promise of retValues, see applyUserActions.
   */
  public async applyUserActionsById(docSession: DocSession,
                                    actionNums: number[],
                                    actionHashes: string[],
                                    undo: boolean,
                                    options?: ApplyUAOptions): Promise<ApplyUAResult> {
    const actionBundles = await this._actionHistory.getActions(actionNums);
    for (const [index, bundle] of actionBundles.entries()) {
      const actionNum = actionNums[index];
      const actionHash = actionHashes[index];
      if (!bundle) { throw new Error(`Could not find actionNum ${actionNum}`); }
      if (actionHash !== bundle.actionHash) {
        throw new Error(`Hash mismatch for actionNum ${actionNum}: ` +
                        `expected ${actionHash} but got ${bundle.actionHash}`);
      }
    }
    let actions: UserAction[];
    if (undo) {
      actions = [['ApplyUndoActions', flatten(actionBundles.map(a => a!.undo))]];
    } else {
      actions = flatten(actionBundles.map(a => a!.userActions));
    }
    // Granular access control implemented ultimately in _applyUserActions.
    // It could be that error cases and timing etc leak some info prior to this
    // point.
    return this.applyUserActions(docSession, actions, options);
  }

  /**
   * Called by Sharing class for every LocalActionBundle (of our own actions) that gets applied.
   */
  public async processActionBundle(localActionBundle: LocalActionBundle): Promise<void> {
    const docData = this.docData;
    if (!docData) { return; }  // Happens on doc creation while processing InitNewDoc action.
    localActionBundle.stored.forEach(da => docData.receiveAction(da[1]));
    localActionBundle.calc.forEach(da => docData.receiveAction(da[1]));
    const docActions = getEnvContent(localActionBundle.stored);
    // TODO: call this update less indiscriminately!
    await this._granularAccess.update();
    if (docActions.some(docAction => this._onDemandActions.isSchemaAction(docAction))) {
      const indexes = this._onDemandActions.getDesiredIndexes();
      await this.docStorage.updateIndexes(indexes);
    }
  }

  /**
   * Used by tests to force an update indexes.  We don't otherwise update indexes until
   * there is a schema change.
   */
  public async testUpdateIndexes() {
    const indexes = this._onDemandActions.getDesiredIndexes();
    await this.docStorage.updateIndexes(indexes);
  }

  /**
   * Shares the doc and invites peers.
   * @param {Array} peers - Array of peer objects with which the doc should be shared.
   * @returns {Promise} Return promise for docId on completion.
   */
  public async shareDoc(docSession: DocSession, peers: Peer[]): Promise<void> {
    throw new Error('shareDoc not implemented');
  }

  public async removeInstanceFromDoc(docSession: DocSession): Promise<void> {
    const instanceId = await this._sharing.removeInstanceFromDoc();
    await this._applyUserActions(docSession, [['RemoveInstance', instanceId]]);
  }

  public async renameDocTo(docSession: OptDocSession, newName: string): Promise<void> {
    this.logDebug(docSession, 'renameDoc', newName);
    await this.docStorage.renameDocTo(newName);
    this._docName = newName;
  }

  /**
   *  Initiates user actions bandling for undo.
   */
  public startBundleUserActions(docSession: OptDocSession) {
    if (!docSession.shouldBundleActions) {
      docSession.shouldBundleActions = true;
      docSession.linkId = 0;
    }
  }

  /**
   *  Stops user actions bandling for undo.
   */
  public stopBundleUserActions(docSession: OptDocSession) {
    docSession.shouldBundleActions = false;
    docSession.linkId = 0;
  }

  public async autocomplete(docSession: DocSession, txt: string, tableId: string): Promise<string[]> {
    // Autocompletion can leak names of tables and columns.
    if (!this._granularAccess.canReadEverything(docSession)) { return []; }
    await this.waitForInitialization();
    return this._dataEngine.pyCall('autocomplete', txt, tableId);
  }

  public fetchURL(docSession: DocSession, url: string): Promise<UploadResult> {
    return fetchURL(url, this.makeAccessId(docSession.authorizer.getUserId()));
  }

  public forwardPluginRpc(docSession: DocSession, pluginId: string, msg: IMessage): Promise<any> {
    if (this._granularAccess.hasNuancedAccess(docSession)) {
      throw new Error('cannot confirm access to plugin');
    }
    const pluginRpc = this.docPluginManager.plugins[pluginId].rpc;
    switch (msg.mtype) {
      case MsgType.RpcCall: return pluginRpc.forwardCall(msg);
      case MsgType.Custom: return pluginRpc.forwardMessage(msg);
    }
    throw new Error(`Invalid message type for forwardPluginRpc: ${msg.mtype}`);
  }

  /**
   * Reload documents plugins.
   */
  public async reloadPlugins(docSession: DocSession) {
    // refresh the list plugins found on the system
    await this._docManager.pluginManager.reloadPlugins();
    const plugins = this._docManager.pluginManager.getPlugins();
    // reload found plugins
    await this.docPluginManager.reload(plugins);
  }

  /**
   * Immediately close the document and data engine, to be reloaded from scratch, and cause all
   * browser clients to reopen it.
   */
  public async reloadDoc(docSession?: DocSession) {
    return this.shutdown();
  }

  /**
   * Fork the current document.  In fact, all that requires is calculating a good
   * ID for the fork.  TODO: reconcile the two ways there are now of preparing a fork.
   */
  public async fork(docSession: DocSession): Promise<ForkResult> {
    if (!this._granularAccess.canReadEverything(docSession)) {
      throw new Error('cannot confirm authority to copy document');
    }
    const userId = docSession.client.getCachedUserId();
    const isAnonymous = docSession.client.isAnonymous();
    // Get fresh document metadata (the cached metadata doesn't include the urlId).
    const doc = await docSession.authorizer.getDoc();
    if (!doc) { throw new Error('document id not known'); }
    const trunkDocId = doc.id;
    const trunkUrlId = doc.urlId || doc.id;
    await this.flushDoc();  // Make sure fork won't be too out of date.
    return makeForkIds({userId, isAnonymous, trunkDocId, trunkUrlId});
  }

  public getGristDocAPI(): GristDocAPI {
    return this.docPluginManager.gristDocAPI;
  }

  // Get recent actions in ActionGroup format with summaries included.
  public async getActionSummaries(docSession: DocSession): Promise<ActionGroup[]> {
    return this.getRecentActions(docSession, true);
  }

  /**
   * Applies normal actions to the data engine while processing onDemand actions separately.
   */
  public async applyActionsToDataEngine(userActions: UserAction[]): Promise<SandboxActionBundle> {
    const [normalActions, onDemandActions] = this._onDemandActions.splitByOnDemand(userActions);

    let sandboxActionBundle: SandboxActionBundle;
    if (normalActions.length > 0) {
      // For all but the special 'Calculate' action, we wait for full initialization.
      if (normalActions[0][0] !== 'Calculate') {
        await this.waitForInitialization();
      }
      sandboxActionBundle = await this._dataEngine.pyCall('apply_user_actions', normalActions);
      await this._reportDataEngineMemory();
    } else {
      // Create default SandboxActionBundle to use if the data engine is not called.
      sandboxActionBundle = createEmptySandboxActionBundle();
    }

    if (onDemandActions.length > 0) {
      const allIndex = findOrAddAllEnvelope(sandboxActionBundle.envelopes);
      await this.docStorage.execTransaction(async () => {
        for (const action of onDemandActions) {
          const {stored, undo, retValues} = await this._onDemandActions.processUserAction(action);
          // Note: onDemand stored/undo actions are arbitrarily processed/added after normal actions
          // and do not support access control.
          sandboxActionBundle.stored.push(...stored.map(a => [allIndex, a] as [number, DocAction]));
          sandboxActionBundle.undo.push(...undo.map(a => [allIndex, a] as [number, DocAction]));
          sandboxActionBundle.retValues.push(retValues);
        }
      });
    }

    return sandboxActionBundle;
  }

  public async fetchSnapshot() {
    await this.waitForInitialization();
    return this._dataEngine.pyCall('fetch_snapshot');
  }

  // Needed for test/server/migrations.js tests
  public async testGetVersionFromDataEngine() {
    return this._dataEngine.pyCall('get_version');
  }

  // Needed for test/server/lib/HostedStorageManager.ts tests
  public async testKeepOpen() {
    this._inactivityTimer.ping();
  }

  public async getSnapshots(): Promise<DocSnapshots> {
    // Assume any viewer can access this list.
    return this._docManager.storageManager.getSnapshots(this.docName);
  }

  /**
   * Make sure the current version of the document has been pushed to persistent
   * storage.
   */
  public async flushDoc(): Promise<void> {
    return this._docManager.storageManager.flushDoc(this.docName);
  }

  public makeAccessId(userId: number|null): string|null {
    return this._docManager.makeAccessId(userId);
  }

  /**
   * Broadcast document changes to all the document's clients.  Doesn't involve
   * ActiveDoc directly, but placed here to facilitate future work on granular
   * access control.
   */
  public async broadcastDocUpdate(client: Client|null, type: string, message: {
    actionGroup: ActionGroup,
    docActions: DocAction[]
  }) {
    await this.docClients.broadcastDocMessage(client, 'docUserAction', message,
                                              (docSession) => this._filterDocUpdate(docSession, message));
  }

  /**
   * Loads an open document from DocStorage.  Returns a list of the tables it contains.
   */
  protected async _loadOpenDoc(docSession: OptDocSession): Promise<string[]> {
    // Fetch the schema version of document and sandbox, and migrate if the sandbox is newer.
    const [schemaVersion, docInfoData] = await Promise.all([
      this._dataEngine.pyCall('get_version'),
      this.docStorage.fetchTable('_grist_DocInfo'),
    ]);

    // Migrate the document if needed.
    const values = marshal.loads(docInfoData!);
    const versionCol = values.schemaVersion;
    const docSchemaVersion = (versionCol && versionCol.length === 1 ? versionCol[0] : 0);
    if (docSchemaVersion < schemaVersion) {
      this.logInfo(docSession, "Doc needs migration from v%s to v%s", docSchemaVersion, schemaVersion);
      await this._migrate(docSession);
    } else if (docSchemaVersion > schemaVersion) {
      // We do NOT attempt to down-migrate in this case. Migration code cannot down-migrate
      // directly (since it doesn't know anything about newer documents). We could revert the
      // migration action, but that requires merging and still may not be safe. For now, doing
      // nothing seems best, as long as we follow the recommendations in migrations.py (never
      // remove/modify/rename metadata tables or columns, or change their meaning).
      this.logWarn(docSession, "Doc is newer (v%s) than this version of Grist (v%s); " +
        "proceeding with fingers crossed", docSchemaVersion, schemaVersion);
    }

    // Load the initial meta tables which determine the document schema.
    const [tablesData, columnsData] = await Promise.all([
      this.docStorage.fetchTable('_grist_Tables'),
      this.docStorage.fetchTable('_grist_Tables_column'),
    ]);

    const tableNames: string[] = await this._dataEngine.pyCall('load_meta_tables', tablesData, columnsData);

    // Figure out which tables are on-demand.
    const tablesParsed: BulkColValues = marshal.loads(tablesData!);
    const onDemandMap = zipObject(tablesParsed.tableId as string[], tablesParsed.onDemand);
    const onDemandNames = remove(tableNames, (t) => onDemandMap[t]);

    this.logDebug(docSession, "found %s tables: %s", tableNames.length,
      tableNames.join(", "));
    this.logDebug(docSession, "skipping %s on-demand tables: %s", onDemandNames.length,
      onDemandNames.join(", "));

    return tableNames;
  }

  /**
   * Applies an array of user actions to the sandbox and broadcasts the results to doc's clients.
   *
   * @private
   * @param {Object} client - The client originating this action. May be null.
   * @param {Array} actions - The user actions to apply.
   * @param {String} options.desc - Description of the action which overrides the default client
   *  description if provided. Should be used to describe bundled actions.
   * @param {Int} options.otherId - Action number for the original useraction to which this undo/redo
   *  action applies.
   * @param {Boolean} options.linkId - ActionNumber of the previous action in an undo/redo bundle.
   * @returns {Promise} Promise that's resolved when all actions are applied successfully to {
   *    actionNum: number of the action that got recorded
   *    retValues: array of return values, one for each of the passed-in user actions.
   *    isModification: true if document was changed by one or more actions.
   * }
   */
  protected async _applyUserActions(docSession: OptDocSession, actions: UserAction[],
                                    options: ApplyUAOptions = {}): Promise<ApplyUAResult> {

    if (!this._granularAccess.canApplyUserActions(docSession, actions)) {
      throw new Error('cannot perform a requested action');
    }

    const client = docSession.client;
    this.logDebug(docSession, "_applyUserActions(%s, %s)", client, shortDesc(actions));
    this._inactivityTimer.ping();     // The doc is in active use; ping it to stay open longer.

    const user = client && client.session ? (await client.session.getEmail()) : "";

    // Create the UserActionBundle.
    const action: UserActionBundle = {
      info: {
        time: Date.now(),
        user,
        inst: this._sharing.instanceId || "unset-inst",
        desc: options.desc,
        otherId: options.otherId || 0,
        linkId: options.linkId || 0,
      },
      userActions: actions,
    };

    const result: ApplyUAResult = await new Promise<ApplyUAResult>(
      (resolve, reject) =>
        this._sharing!.addUserAction({action, client, resolve, reject}));
    this.logDebug(docSession, "_applyUserActions returning %s", util.inspect(result));

    if (result.isModification) {
      this._fetchCache.clear();  // This could be more nuanced.
      this._docManager.markAsChanged(this);
      this._docManager.markAsEdited(this);
    }
    return result;
  }

  /**
   * Prepares a single attachment by adding it DocStorage and returns a UserAction to apply.
   */
  private async _prepAttachment(docSession: OptDocSession, fileData: FileUploadInfo): Promise<UserAction> {
    // Check that upload size is within the configured limits.
    const limit = (Number(process.env.GRIST_MAX_UPLOAD_ATTACHMENT_MB) * 1024 * 1024) || Infinity;
    if (fileData.size > limit) {
      throw new ApiError(`Attachments must not exceed ${byteString(limit)}`, 413);
    }

    let dimensions: {width?: number, height?: number} = {};
    // imageSize returns an object with a width, height and type property if the file is an image.
    // The width and height properties are integers representing width and height in pixels.
    try {
      dimensions = await bluebird.fromCallback((cb: any) => imageSize(fileData.absPath, cb));
    } catch (err) {
      // Non-images will fail in some way, and that's OK.
      dimensions.height = 0;
      dimensions.width = 0;
    }
    const checksum = await checksumFile(fileData.absPath);
    const fileIdent = checksum + fileData.ext;
    const ret: boolean = await this.docStorage.findOrAttachFile(fileData.absPath, fileIdent);
    this.logInfo(docSession, "addAttachment: file %s (image %sx%s) %s", fileIdent,
      dimensions.width, dimensions.height, ret ? "attached" : "already exists");
    return ['AddRecord', '_grist_Attachments', null, {
      fileIdent,
      fileName: fileData.origName,
      // We used to set fileType, but it's not easily available for native types. Since it's
      // also entirely unused, we just skip it until it becomes relevant.
      fileSize: fileData.size,
      imageHeight: dimensions.height,
      imageWidth: dimensions.width,
      timeUploaded: Date.now()
    }];
  }

  /**
   * If the software is newer than the document, migrate the document by fetching all tables, and
   * giving them to the sandbox so that it can produce migration actions.
   * TODO: We haven't figured out how to do sharing between different Grist versions that
   * expect different schema versions. The returned actions at the moment aren't even shared with
   * collaborators.
   */
  private async _migrate(docSession: OptDocSession): Promise<void> {
    // TODO: makeBackup should possibly be in docManager directly.
    const backupPath = await this._docManager.storageManager.makeBackup(this._docName, "migrate");
    this.logInfo(docSession, "_migrate: backup made at %s", backupPath);
    this.emit("backupMade", backupPath);
    const allTables = await this.docStorage.fetchAllTables();
    const docActions: DocAction[] = await this._dataEngine.pyCall('create_migrations', allTables);
    this.logInfo(docSession, "_migrate: applying %d migration actions", docActions.length);
    docActions.forEach((action, i) => this.logInfo(docSession, "_migrate: docAction %s: %s", i, shortDesc(action)));
    await this.docStorage.execTransaction(() => this.docStorage.applyStoredActions(docActions));
  }

  /**
   * Load the specified tables into the data engine.
   */
  private async _loadTables(docSession: OptDocSession, tableNames: string[]) {
    this.logDebug(docSession, "loading %s tables: %s", tableNames.length,
      tableNames.join(", "));
    // Pass the resulting array to `map`, which allows parallel processing of the tables. Database
    // and DataEngine may still do things serially, but it allows them to be busy simultaneously.
    await bluebird.map(tableNames, async (tableName: string) =>
      this._dataEngine.pyCall('load_table', tableName, await this._fetchTableIfPresent(tableName)),
      // How many tables to query for and push to the data engine in parallel.
      { concurrency: 3 });
    return this;
  }

  // Fetches and returns the requested table, or null if it's missing. This allows documents to
  // load with missing metadata tables (should only matter if migrations are also broken).
  private async _fetchTableIfPresent(tableName: string): Promise<Buffer|null> {
    try {
      return await this.docStorage.fetchTable(tableName);
    } catch (err) {
      if (/no such table/.test(err.message)) { return null; }
      throw err;
    }
  }

  // It's a bit risky letting "Calculate" (and other formula-dependent calls) to disable
  // inactivityTimer, since a user formulas with an infinite loop can disable it forever.
  // TODO find a solution to this issue.
  @ActiveDoc.keepDocOpen
  private async _finishInitialization(docSession: OptDocSession, pendingTableNames: string[], startTime: number) {
    try {
      await this._loadTables(docSession, pendingTableNames);
      await this._applyUserActions(docSession, [['Calculate']]);
      await this._reportDataEngineMemory();
      this._fullyLoaded = true;
      const endTime = Date.now();
      const loadMs = endTime - startTime;
      // Adjust the inactivity timer: if the load took under 1 sec, use the regular timeout; if it
      // took longer, scale it up proportionately.
      const closeTimeout = Math.max(loadMs, 1000) * Deps.ACTIVEDOC_TIMEOUT;
      this._inactivityTimer.setDelay(closeTimeout);
      this.logDebug(docSession, `loaded in ${loadMs} ms, InactivityTimer set to ${closeTimeout} ms`);
      return true;
    } catch (err) {
      this.logWarn(docSession, "_finishInitialization stopped with %s", err);
      this._fullyLoaded = true;
      return false;
    }
  }

  private async _fetchQueryFromDB(query: Query, onDemand: boolean): Promise<TableDataAction> {
    // Expand query to compute formulas (or include placeholders for them).
    const expandedQuery = expandQuery(query, this.docData!, onDemand);
    const marshalled = await this.docStorage.fetchQuery(expandedQuery);
    const table = this.docStorage.decodeMarshalledData(marshalled, query.tableId);

    // Substitute in constant values for errors / placeholders.
    if (expandedQuery.constants) {
      for (const colId of Object.keys(expandedQuery.constants)) {
        const constant = expandedQuery.constants[colId];
        table[colId] = table[colId].map(() => constant);
      }
    }
    return toTableDataAction(query.tableId, table);
  }

  private async _fetchQueryFromDataEngine(query: Query): Promise<TableDataAction> {
    return this._dataEngine.pyCall('fetch_table', query.tableId, true, query.filters);
  }

  private async _reportDataEngineMemory() {
    const now = Date.now();
    if (now >= this._lastMemoryMeasurement + MEMORY_MEASUREMENT_INTERVAL_MS) {
      this._lastMemoryMeasurement = now;
      await this._dataEngine.reportMemoryUsage();
    }
  }

  private _log(level: string, docSession: OptDocSession, msg: string, ...args: any[]) {
    log.origLog(level, `ActiveDoc ` + msg, ...args, this.getLogMeta(docSession));
  }

  /**
   * This filters a message being broadcast to all clients to be appropriate for one
   * particular client, if that client may need some material filtered out.
   */
  private _filterDocUpdate(docSession: OptDocSession, message: {
    actionGroup: ActionGroup,
    docActions: DocAction[]
  }) {
    if (this._granularAccess.canReadEverything(docSession)) { return message; }
    const result = {
      actionGroup: this._granularAccess.filterActionGroup(docSession, message.actionGroup),
      docActions: this._granularAccess.filterOutgoingDocActions(docSession, message.docActions),
    };
    if (result.docActions.length === 0) { return null; }
    return result;
  }
}

// Helper to initialize a sandbox action bundle with no values.
function createEmptySandboxActionBundle(): SandboxActionBundle {
  return {
    envelopes: [],
    stored: [],
    calc: [],
    undo: [],
    retValues: []
  };
}
