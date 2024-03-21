/**
 * Module to manage "active" Grist documents, i.e. those loaded in-memory, with
 * clients connected to them. It handles the incoming user actions, and outgoing
 * change events.
 */

import {ACLRuleCollection} from 'app/common/ACLRuleCollection';
import {
  getEnvContent,
  LocalActionBundle,
  SandboxActionBundle,
  SandboxRequest,
  UserActionBundle
} from 'app/common/ActionBundle';
import {ActionGroup, MinimalActionGroup} from 'app/common/ActionGroup';
import {ActionSummary} from "app/common/ActionSummary";
import {
  AclResources,
  AclTableDescription,
  ApplyUAExtendedOptions,
  ApplyUAOptions,
  ApplyUAResult,
  DataSourceTransformed,
  ForkResult,
  ImportOptions,
  ImportResult,
  ISuggestionWithValue,
  MergeOptions,
  PermissionDataWithExtraUsers,
  QueryResult,
  ServerQuery,
  TableFetchResult,
  TransformRule
} from 'app/common/ActiveDocAPI';
import {ApiError} from 'app/common/ApiError';
import {mapGetOrSet, MapWithTTL} from 'app/common/AsyncCreate';
import {AttachmentColumns, gatherAttachmentIds, getAttachmentColumns} from 'app/common/AttachmentColumns';
import {WebhookMessageType} from 'app/common/CommTypes';
import {
  BulkAddRecord,
  BulkRemoveRecord,
  BulkUpdateRecord,
  CellValue,
  DocAction,
  getTableId,
  isSchemaAction,
  TableDataAction,
  toTableDataAction,
  UserAction
} from 'app/common/DocActions';
import {DocData} from 'app/common/DocData';
import {getDataLimitRatio, getDataLimitStatus, getSeverity, LimitExceededError} from 'app/common/DocLimits';
import {DocSnapshots} from 'app/common/DocSnapshot';
import {DocumentSettings} from 'app/common/DocumentSettings';
import {
  APPROACHING_LIMIT_RATIO,
  DataLimitStatus,
  DocumentUsage,
  DocUsageSummary,
  FilteredDocUsageSummary,
  getUsageRatio,
  RowCounts,
} from 'app/common/DocUsage';
import {normalizeEmail} from 'app/common/emails';
import {Product} from 'app/common/Features';
import {FormulaProperties, getFormulaProperties} from 'app/common/GranularAccessClause';
import {isHiddenCol} from 'app/common/gristTypes';
import {commonUrls, parseUrlId} from 'app/common/gristUrls';
import {byteString, countIf, retryOnce, safeJsonParse, timeoutReached} from 'app/common/gutil';
import {InactivityTimer} from 'app/common/InactivityTimer';
import {Interval} from 'app/common/Interval';
import * as roles from 'app/common/roles';
import {schema, SCHEMA_VERSION} from 'app/common/schema';
import {MetaRowRecord, SingleCell} from 'app/common/TableData';
import {TelemetryEvent, TelemetryMetadataByLevel} from 'app/common/Telemetry';
import {FetchUrlOptions, UploadResult} from 'app/common/uploads';
import {Document as APIDocument, DocReplacementOptions, DocState, DocStateComparison} from 'app/common/UserAPI';
import {convertFromColumn} from 'app/common/ValueConverter';
import {guessColInfo} from 'app/common/ValueGuesser';
import {parseUserAction} from 'app/common/ValueParser';
import {Document} from 'app/gen-server/entity/Document';
import {Share} from 'app/gen-server/entity/Share';
import {RecordWithStringId} from 'app/plugin/DocApiTypes';
import {ParseFileResult, ParseOptions} from 'app/plugin/FileParserAPI';
import {AccessTokenOptions, AccessTokenResult, GristDocAPI, UIRowId} from 'app/plugin/GristAPI';
import {compileAclFormula} from 'app/server/lib/ACLFormula';
import {AssistanceSchemaPromptV1Context} from 'app/server/lib/Assistance';
import {AssistanceContext} from 'app/common/AssistancePrompts';
import {Authorizer, RequestWithLogin} from 'app/server/lib/Authorizer';
import {checksumFile} from 'app/server/lib/checksumFile';
import {Client} from 'app/server/lib/Client';
import {getMetaTables} from 'app/server/lib/DocApi';
import {DEFAULT_CACHE_TTL, DocManager} from 'app/server/lib/DocManager';
import {ICreateActiveDocOptions} from 'app/server/lib/ICreate';
import {makeForkIds} from 'app/server/lib/idUtils';
import {GRIST_DOC_SQL, GRIST_DOC_WITH_TABLE1_SQL} from 'app/server/lib/initialDocSql';
import {ISandbox} from 'app/server/lib/ISandbox';
import log from 'app/server/lib/log';
import {LogMethods} from "app/server/lib/LogMethods";
import {NullSandbox, UnavailableSandboxMethodError} from 'app/server/lib/NullSandbox';
import {DocRequests} from 'app/server/lib/Requests';
import {shortDesc} from 'app/server/lib/shortDesc';
import {TableMetadataLoader} from 'app/server/lib/TableMetadataLoader';
import {DocTriggers} from "app/server/lib/Triggers";
import {fetchURL, FileUploadInfo, globalUploadSet, UploadInfo} from 'app/server/lib/uploads';
import assert from 'assert';
import {Mutex} from 'async-mutex';
import * as bluebird from 'bluebird';
import {EventEmitter} from 'events';
import {IMessage, MsgType} from 'grain-rpc';
import imageSize from 'image-size';
import * as moment from 'moment-timezone';
import fetch from 'node-fetch';
import {createClient, RedisClient} from 'redis';
import tmp from 'tmp';

import {ActionHistory} from './ActionHistory';
import {ActionHistoryImpl} from './ActionHistoryImpl';
import {ActiveDocImport, FileImportOptions} from './ActiveDocImport';
import {DocClients} from './DocClients';
import {DocPluginManager} from './DocPluginManager';
import {
  DocSession,
  getDocSessionAccess,
  getDocSessionAltSessionId,
  getDocSessionUsage,
  getDocSessionUser,
  getDocSessionUserId,
  makeExceptionalDocSession,
  OptDocSession
} from './DocSession';
import {createAttachmentsIndex, DocStorage, REMOVE_UNUSED_ATTACHMENTS_DELAY} from './DocStorage';
import {expandQuery} from './ExpandedQuery';
import {GranularAccess, GranularAccessForBundle} from './GranularAccess';
import {OnDemandActions} from './OnDemandActions';
import {getLogMetaFromDocSession, getPubSubPrefix, getTelemetryMetaFromDocSession} from './serverUtils';
import {findOrAddAllEnvelope, Sharing} from './Sharing';
import cloneDeep = require('lodash/cloneDeep');
import flatten = require('lodash/flatten');
import merge = require('lodash/merge');
import pick = require('lodash/pick');
import remove = require('lodash/remove');
import sum = require('lodash/sum');
import without = require('lodash/without');
import zipObject = require('lodash/zipObject');

bluebird.promisifyAll(tmp);

const MAX_RECENT_ACTIONS = 100;

const DEFAULT_TIMEZONE = (process.versions as any).electron ? moment.tz.guess() : "UTC";
const DEFAULT_LOCALE = process.env.GRIST_DEFAULT_LOCALE || "en-US";

// Number of seconds an ActiveDoc is retained without any clients.
// In dev environment, it is convenient to keep this low for quick tests.
// In production, it is reasonable to stretch it out a bit.
const ACTIVEDOC_TIMEOUT = (process.env.NODE_ENV === 'production') ? 30 : 5;

// We'll wait this long between re-measuring sandbox memory.
const MEMORY_MEASUREMENT_INTERVAL_MS = 60 * 1000;

// Apply the UpdateCurrentTime user action every hour
const UPDATE_CURRENT_TIME_DELAY = {delayMs: 60 * 60 * 1000, varianceMs: 30 * 1000};

// Measure and broadcast data size every 5 minutes
const UPDATE_DATA_SIZE_DELAY = {delayMs: 5 * 60 * 1000, varianceMs: 30 * 1000};

// Log document metrics every hour
const LOG_DOCUMENT_METRICS_DELAY = {delayMs: 60 * 60 * 1000, varianceMs: 30 * 1000};

// For items of work that need to happen at shutdown, timeout before aborting the wait for them.
const SHUTDOWN_ITEM_TIMEOUT_MS = 5000;

// We keep a doc open while a user action is pending, but not longer than this. If it's pending
// this long, the ACTIVEDOC_TIMEOUT will still kick in afterwards, and in the absence of other
// activity, the doc would still get shut down, with the action's effect lost. This is to prevent
// indefinitely running processes in case of an infinite loop in a formula.
const KEEP_DOC_OPEN_TIMEOUT_MS = 5 * 60 * 1000;

// A hook for dependency injection.
export const Deps = {
  ACTIVEDOC_TIMEOUT,
  ACTIVEDOC_TIMEOUT_ACTION: 'shutdown' as 'shutdown'|'ignore',

  UPDATE_CURRENT_TIME_DELAY,
  SHUTDOWN_ITEM_TIMEOUT_MS,
  KEEP_DOC_OPEN_TIMEOUT_MS,
};

interface UpdateUsageOptions {
  // Whether usage should be synced to the home database. Defaults to true.
  syncUsageToDatabase?: boolean;
  // Whether usage should be broadcast to all doc clients. Defaults to true.
  broadcastUsageToClients?: boolean;
}

/**
 * Represents an active document with the given name. The document isn't actually open until
 * either .loadDoc() or .createEmptyDoc() is called.
 * @param {String} docName - The document's filename, without the '.grist' extension.
 */
export class ActiveDoc extends EventEmitter {
  /**
   * Decorator for ActiveDoc methods that prevents shutdown while the method is running, i.e.
   * until the returned promise is resolved, or KEEP_DOC_OPEN_TIMEOUT_MS passes.
   */
  public static keepDocOpen(target: ActiveDoc, propertyKey: string, descriptor: PropertyDescriptor) {
    const origFunc = descriptor.value;
    descriptor.value = function(this: ActiveDoc) {
      const result = origFunc.apply(this, arguments);
      this._inactivityTimer.disableUntilFinish(timeoutReached(Deps.KEEP_DOC_OPEN_TIMEOUT_MS, result))
        .catch(() => {});
      return result;
    };
  }

  public readonly docStorage: DocStorage;
  public readonly docPluginManager: DocPluginManager|null;
  public readonly docClients: DocClients;               // Only exposed for Sharing.ts
  public docData: DocData|null = null;
  // Used by DocApi to only allow one webhook-related endpoint to run at a time.
  public readonly triggersLock: Mutex = new Mutex();

  protected _actionHistory: ActionHistory;
  protected _docManager: DocManager;
  protected _docName: string;
  protected _sharing: Sharing;
  // This lock is used to avoid reading sandbox state while it is being modified but before
  // the result has been confirmed to pass granular access rules (which may depend on the
  // result).
  protected _modificationLock: Mutex = new Mutex();

  private _log = new LogMethods('ActiveDoc ', (s: OptDocSession | null) => this.getLogMeta(s));
  private _triggers: DocTriggers;
  private _requests: DocRequests;
  private _dataEngine: Promise<ISandbox>|null = null;
  private _activeDocImport: ActiveDocImport;
  private _onDemandActions: OnDemandActions;
  private _granularAccess: GranularAccess;
  private _tableMetadataLoader: TableMetadataLoader;
  private _muted: boolean = false;  // If set, changes to this document should not propagate
                                    // to outside world
  private _migrating: number = 0;   // If positive, a migration is in progress
  private _initializationPromise: Promise<void>|null = null;
                                    // If set, wait on this to be sure the ActiveDoc is fully
                                    // initialized.  True on success.
  private _fullyLoaded: boolean = false;  // Becomes true once all columns are loaded/computed.
  private _lastMemoryMeasurement: number = 0;    // Timestamp when memory was last measured.
  private _fetchCache = new MapWithTTL<string, Promise<TableDataAction>>(DEFAULT_CACHE_TTL);
  private _doc: Document|undefined;
  private _docUsage: DocumentUsage|null = null;
  private _product?: Product;
  private _gracePeriodStart: Date|null = null;
  private _isSnapshot: boolean;
  private _isForkOrSnapshot: boolean;
  private _onlyAllowMetaDataActionsOnDb: boolean = false;
  // Cache of which columns are attachment columns.
  private _attachmentColumns?: AttachmentColumns;

  // Client watching for 'product changed' event published by Billing to update usage
  private _redisSubscriber?: RedisClient;

  // Timer for shutting down the ActiveDoc a bit after all clients are gone.
  private _inactivityTimer = new InactivityTimer(() => {
    this._log.debug(null, 'inactivity timeout');
    return this._onInactive();
  }, Deps.ACTIVEDOC_TIMEOUT * 1000);
  private _recoveryMode: boolean = false;
  private _shuttingDown: boolean = false;
  private _afterShutdownCallback?: () => Promise<void>;
  private _doShutdown?: Promise<void>;
  private _intervals: Interval[] = [];

  constructor(docManager: DocManager, docName: string, private _options?: ICreateActiveDocOptions) {
    super();
    const {forkId, snapshotId} = parseUrlId(docName);
    this._isSnapshot = Boolean(snapshotId);
    this._isForkOrSnapshot = Boolean(forkId || snapshotId);
    if (!this._isSnapshot) {
      /**
       * In cases where large numbers of documents are restarted simultaneously
       * (like during deployments), there's a tendency for scheduled intervals to
       * execute at roughly the same moment in time, which causes spikes in load.
       *
       * To mitigate this, we use randomized intervals that re-compute their delay
       * in-between calls, with a variance of 30 seconds.
       */
      this._intervals.push(
        // Cleanup expired attachments every hour (also happens when shutting down).
        new Interval(
          () => this.removeUnusedAttachments(true),
          REMOVE_UNUSED_ATTACHMENTS_DELAY,
          {onError: (e) => this._log.error(null, 'failed to remove expired attachments', e)},
        ),
        // Update the time in formulas every hour.
        new Interval(
          () => this._applyUserActions(makeExceptionalDocSession('system'), [['UpdateCurrentTime']]),
          Deps.UPDATE_CURRENT_TIME_DELAY,
          {onError: (e) => this._log.error(null, 'failed to update current time', e)},
        ),
        // Measure and broadcast data size every 5 minutes.
        new Interval(
          () => this._checkDataSizeLimitRatio(makeExceptionalDocSession('system')),
          UPDATE_DATA_SIZE_DELAY,
          {onError: (e) => this._log.error(null, 'failed to update data size', e)},
        ),
        // Log document metrics every hour.
        new Interval(
          () => this._logDocMetrics(makeExceptionalDocSession('system'), 'interval'),
          LOG_DOCUMENT_METRICS_DELAY,
          {onError: (e) => this._log.error(null, 'failed to log document metrics', e)},
        ),
      );
    }
    if (_options?.safeMode) { this._recoveryMode = true; }
    if (_options?.doc) {
      this._doc = _options.doc;
      const {gracePeriodStart, workspace, usage} = this._doc;
      const billingAccount = workspace.org.billingAccount;
      this._product = billingAccount?.product;
      this._gracePeriodStart = gracePeriodStart;

      if (process.env.REDIS_URL && billingAccount) {
        const prefix = getPubSubPrefix();
        const channel = `${prefix}-billingAccount-${billingAccount.id}-product-changed`;
        this._redisSubscriber = createClient(process.env.REDIS_URL);
        this._redisSubscriber.subscribe(channel);
        this._redisSubscriber.on("message", async () => {
          // A product change has just happened in Billing.
          // Reload the doc (causing connected clients to reload) to ensure everyone sees the effect of the change.
          this._log.debug(null, 'reload after product change');
          await this.reloadDoc();
        });
      }

      if (!this._isForkOrSnapshot) {
        /* Note: We don't currently persist usage for forks or snapshots anywhere, so
         * we need to hold off on setting _docUsage here. Normally, usage is set shortly
         * after initialization finishes, after data/attachments size has finished
         * calculating. However, this leaves a narrow window where forks can circumvent
         * delete-only restrictions and replace the trunk document (even when the trunk
         * is delete-only). This isn't very concerning today as the window is typically
         * too narrow to easily exploit, and there are other ways to work around limits,
         * like resetting gracePeriodStart by momentarily lowering usage. Regardless, it
         * would be good to fix this eventually (perhaps around the same time we close
         * up the gracePeriodStart loophole).
         *
         * TODO: Revisit this later and patch up the loophole. */
        this._docUsage = usage;
      }
    }
    this._docManager = docManager;
    this._docName = docName;
    this.docStorage = new DocStorage(docManager.storageManager, docName);
    this.docClients = new DocClients(this);
    this._triggers = new DocTriggers(this);
    this._requests = new DocRequests(this);
    this._actionHistory = new ActionHistoryImpl(this.docStorage);
    this.docPluginManager = docManager.pluginManager ?
      new DocPluginManager(docManager.pluginManager.getPlugins(),
                           docManager.pluginManager.appRoot!, this, this._docManager.gristServer) : null;
    this._tableMetadataLoader = new TableMetadataLoader({
      decodeBuffer: this.docStorage.decodeMarshalledData.bind(this.docStorage),
      fetchTable: this.docStorage.fetchTable.bind(this.docStorage),
      loadMetaTables: this._rawPyCall.bind(this, 'load_meta_tables'),
      loadTable: this._rawPyCall.bind(this, 'load_table'),
    });

    // Our DataEngine is a separate sandboxed process (one sandbox per open document,
    // corresponding to one process for pynbox, more for gvisor).
    // The data engine runs user-defined python code including formula calculations.
    // It maintains all document data and metadata, and applies translates higher-level UserActions
    // into lower-level DocActions.

    // Creation of the data engine needs to be deferred since we need to look at the document to
    // see what kind of engine it needs. This doesn't delay loading the document, but could delay
    // first calculation and modification.
    // TODO: consider caching engine requirement for doc in home db - or running python2
    // in gvisor (but would still need to look at doc to know what process to start in sandbox)

    this._activeDocImport = new ActiveDocImport(this);

    // Schedule shutdown immediately. If a client connects soon (normal case), it will get
    // unscheduled. If not (e.g. abandoned import, network problems after creating a doc), then
    // the ActiveDoc will get cleaned up.
    this._inactivityTimer.enable();
  }

  public get docName(): string { return this._docName; }

  public get recoveryMode(): boolean { return this._recoveryMode; }

  public get isShuttingDown(): boolean { return this._shuttingDown; }

  public get triggers(): DocTriggers { return this._triggers; }

  public get rowLimitRatio(): number {
    return getUsageRatio(
      this._docUsage?.rowCount?.total,
      this._product?.features.baseMaxRowsPerDocument
    );
  }

  public get dataSizeLimitRatio(): number {
    return getUsageRatio(
      this._docUsage?.dataSizeBytes,
      this._product?.features.baseMaxDataSizePerDocument
    );
  }

  public get dataLimitRatio(): number {
    return getDataLimitRatio(this._docUsage, this._product?.features);
  }

  public get dataLimitStatus(): DataLimitStatus {
    return getDataLimitStatus({
      docUsage: this._docUsage,
      productFeatures: this._product?.features,
      gracePeriodStart: this._gracePeriodStart,
    });
  }

  public getDocUsageSummary(): DocUsageSummary {
    return {
      dataLimitStatus: this.dataLimitStatus,
      rowCount: this._docUsage?.rowCount ?? 'pending',
      dataSizeBytes: this._docUsage?.dataSizeBytes ?? 'pending',
      attachmentsSizeBytes: this._docUsage?.attachmentsSizeBytes ?? 'pending',
    };
  }

  public async getFilteredDocUsageSummary(
    docSession: OptDocSession
  ): Promise<FilteredDocUsageSummary> {
    return this._granularAccess.filterDocUsageSummary(docSession, this.getDocUsageSummary());
  }

  public async getUserOverride(docSession: OptDocSession) {
    return this._granularAccess.getUserOverride(docSession);
  }

  // Constructs metadata for logging, given a Client or an OptDocSession.
  public getLogMeta(docSession: OptDocSession|null, docMethod?: string): log.ILogMeta {
    return {
      ...(docSession ? getLogMetaFromDocSession(docSession) : {}),
      docId: this._docName,
      ...(docMethod ? {docMethod} : {}),
    };
  }

  public setMuted() {
    this._muted = true;
  }

  public get muted() {
    return this._muted;
  }

  public isMigrating() {
    return this._migrating;
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
      {clientId: docSession.client?.clientId, summarize});
    const permittedGroups: ActionGroup[] = [];
    // Process groups serially since the work is synchronous except for some
    // possible db accesses that will be serialized in any case.
    for (const group of groups) {
      if (await this._granularAccess.allowActionGroup(docSession, group)) {
        permittedGroups.push(group);
      }
    }
    return permittedGroups;
  }

  public async getRecentMinimalActions(docSession: OptDocSession): Promise<MinimalActionGroup[]> {
    return this._actionHistory.getRecentMinimalActionGroups(
      MAX_RECENT_ACTIONS, docSession.client?.clientId);
  }

  /** expose action history for tests */
  public getActionHistory(): ActionHistory {
    return this._actionHistory;
  }

  public handleTriggers(localActionBundle: LocalActionBundle): Promise<ActionSummary> {
    return this._triggers.handle(localActionBundle);
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
      this._log.info(docSession, "will stay open");
      this._inactivityTimer.disable();
    }
    return docSession;
  }

  /**
   * Shut down the ActiveDoc, and remove it from the DocManager. An optional
   * afterShutdown operation can be provided, which will be run once the ActiveDoc
   * is completely shut down but before it is removed from the DocManager, ensuring
   * that the operation will not overlap with a new ActiveDoc starting up for the
   * same document.
   */
  public async shutdown(options: {
    afterShutdown?: () => Promise<void>
  } = {}): Promise<void> {
    if (options.afterShutdown) {
      this._afterShutdownCallback = options.afterShutdown;
    }
    this._doShutdown ||= this._doShutdownImpl();
    await this._doShutdown;
  }

  /**
   * Create a new blank document (no "Table1") using the data engine. This is used only
   * to generate the SQL saved to initialDocSql.ts
   *
   * It does not set documentSettings.engine.  When a document is created during normal
   * operation, documentSettings.engine gets set after the SQL is used to seed it, in
   * _createDocFile()
   *
   */
  @ActiveDoc.keepDocOpen
  public async createEmptyDocWithDataEngine(docSession: OptDocSession): Promise<ActiveDoc> {
    this._log.debug(docSession, "createEmptyDocWithDataEngine");
    await this._docManager.storageManager.prepareToCreateDoc(this.docName);
    await this.docStorage.createFile();
    await this._rawPyCall('load_empty');
    // This init action is special. It creates schema tables, and is used to init the DB, but does
    // not go through other steps of a regular action (no ActionHistory or broadcasting).
    const initBundle = await this._rawPyCall('apply_user_actions', [["InitNewDoc"]]);
    await this.docStorage.execTransaction(() =>
      this.docStorage.applyStoredActions(getEnvContent(initBundle.stored)));
    // DocStorage can't create this index in the initial schema
    // because the table _grist_Attachments doesn't exist at that point - it's created by InitNewDoc.
    await createAttachmentsIndex(this.docStorage);

    await this._initDoc(docSession);
    await this._tableMetadataLoader.clean();
    // Makes sure docPluginManager is ready in case new doc is used to import new data
    await this.docPluginManager?.ready;
    this._fullyLoaded = true;
    return this;
  }

  /**
   * Create a new blank document (no "Table1"), used as a stub when importing.
   */
  @ActiveDoc.keepDocOpen
  public async createEmptyDoc(docSession: OptDocSession,
                              options?: { useExisting?: boolean }): Promise<ActiveDoc> {
    await this.loadDoc(docSession, {forceNew: true,
                                    skipInitialTable: true,
                                    ...options});
    // Makes sure docPluginManager is ready in case new doc is used to import new data
    await this.docPluginManager?.ready;
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
  public async loadDoc(docSession: OptDocSession, options?: {
    forceNew?: boolean,          // If set, document will be created.
    skipInitialTable?: boolean,  // If set, and document is new, "Table1" will not be added.
    useExisting?: boolean,       // If set, document can be created as an overlay on
                                 // an existing sqlite file.
  }): Promise<ActiveDoc> {
    const startTime = Date.now();
    this._log.debug(docSession, "loadDoc");
    try {
      const isNew: boolean = options?.forceNew || await this._docManager.storageManager.prepareLocalDoc(this.docName);
      if (isNew) {
        await this._createDocFile(docSession, {
          skipInitialTable: options?.skipInitialTable,
          useExisting: options?.useExisting,
        });
      } else {
        await this.docStorage.openFile({
          beforeMigration: async (currentVersion, newVersion) => {
            return this._beforeMigration(docSession, 'storage', currentVersion, newVersion);
          },
          afterMigration: async (newVersion, success) => {
            return this._afterMigration(docSession, 'storage',  newVersion, success);
          },
        });
      }
      const [tableNames, onDemandNames] = await this._loadOpenDoc(docSession);
      const desiredTableNames = tableNames.filter(name => name.startsWith('_grist_'));
      this._startLoadingTables(docSession, desiredTableNames);
      const pendingTableNames = tableNames.filter(name => !name.startsWith('_grist_'));
      await this._initDoc(docSession);
      this._initializationPromise = this._finishInitialization(docSession, pendingTableNames,
                                                               onDemandNames, startTime).catch(async (err) => {
        await this.docClients.broadcastDocMessage(null, 'docError', {
          when: 'initialization',
          message: String(err),
        });
      });
    } catch (err) {
      const level = err.status === 404 ? "warn" : "error";
      this._log.log(level, docSession, "Failed to load document", err);
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
  public async replace(docSession: OptDocSession, source: DocReplacementOptions) {
    if (parseUrlId(this._docName).snapshotId) {
      throw new ApiError('Snapshots cannot be replaced.', 400);
    }
    if (!await this._granularAccess.isOwner(docSession)) {
      throw new ApiError('Only owners can replace a document.', 403);
    }
    this._log.debug(docSession, 'ActiveDoc.replace starting shutdown');

    // During replacement, it is important for all hands to be off the document. So we
    // ask the shutdown method to do the replacement when the ActiveDoc is shutdown but
    // before a new one could be opened.
    return this.shutdown({
      afterShutdown: () => this._docManager.storageManager.replace(this.docName, source)
    });
  }

  /**
   * Finish initializing ActiveDoc, by initializing ActionHistory, Sharing, and docData.
   */
  public async _initDoc(docSession: OptDocSession): Promise<void> {
    const metaTableData = await this._tableMetadataLoader.fetchTablesAsActions();
    this.docData = new DocData(tableId => this.fetchTable(makeExceptionalDocSession('system'), tableId), metaTableData);
    this._onDemandActions = new OnDemandActions(this.docStorage, this.docData,
                                                this._recoveryMode);

    await this._actionHistory.initialize();
    this._granularAccess = new GranularAccess(this.docData, this.docStorage, this.docClients, (query) => {
      return this._fetchQueryFromDB(query, false);
    }, this.recoveryMode, this.getHomeDbManager(), this.docName);
    await this._granularAccess.update();
    this._sharing = new Sharing(this, this._actionHistory, this._modificationLock);
    // Make sure there is at least one item in action history. The document will be perfectly
    // functional without it, but comparing documents would need updating if history can
    // be empty. For example, comparing an empty document immediately forked with the
    // original would fail. So far, we have treated documents without a common history
    // as incomparible, and we'd need to weaken that to allow comparisons with a document
    // with nothing in action history.
    if (this._actionHistory.getNextLocalActionNum() === 1) {
      await this._actionHistory.recordNextShared({
        userActions: [],
        undo: [],
        info: [0, this._makeInfo(makeExceptionalDocSession('system'))],
        actionNum: 1,
        actionHash: null,       // set by ActionHistory
        parentActionHash: null,
        stored: [],
        calc: [],
        envelopes: [],
      });
    }
  }

  public getHomeDbManager() {
    return this._docManager.getHomeDbManager();
  }

  /**
   * Adds a small table to start off a newly-created blank document.
   */
  public addInitialTable(docSession: OptDocSession) {
    // Use a non-client-specific session, so that this action is not part of anyone's undo history.
    const newDocSession = makeExceptionalDocSession('nascent');
    return this.applyUserActions(newDocSession, [["AddEmptyTable", null]]);
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
                           prevTableIds: string[], importOptions: ImportOptions): Promise<ImportResult> {
    return this._activeDocImport.finishImportFiles(docSession, dataSource, prevTableIds, importOptions);
  }

  /**
   * Cancels import files, cleans up temporary hidden tables and uploads.
   * Param `prevTableIds` is an array of hiddenTableIds as received from previous `importFiles`
   * call, or empty if there was no previous call.
   */
  public cancelImportFiles(docSession: DocSession, uploadId: number,
                           prevTableIds: string[]): Promise<void> {
    return this._activeDocImport.cancelImportFiles(docSession, uploadId, prevTableIds);
  }

  /**
   * Returns a diff of changes that will be applied to the destination table from `transformRule`
   * if the data from `hiddenTableId` is imported with the specified `mergeOptions`.
   *
   * The diff is returned as a `DocStateComparison` of the same doc, with the `rightChanges`
   * containing the updated cell values. Old values are pulled from the destination record (if
   * a match was found), and new values are the result of merging in the new cell values with
   * the merge strategy from `mergeOptions`.
   *
   * No distinction is currently made for added records vs. updated existing records; instead,
   * we treat added records as an updated record in `hiddenTableId` where all the column
   * values changed from blank to the original column values from `hiddenTableId`.
   */
  public generateImportDiff(_docSession: DocSession, hiddenTableId: string, transformRule: TransformRule,
                            mergeOptions: MergeOptions): Promise<DocStateComparison> {
    return this._activeDocImport.generateImportDiff(hiddenTableId, transformRule, mergeOptions);
  }

  /**
   * Close the current document.
   */
  public async closeDoc(docSession: DocSession): Promise<void> {
    // Note that it's async only to satisfy the Rpc interface that expects a promise.
    this.docClients.removeClient(docSession);

    // If no more clients, schedule a shutdown.
    if (this.docClients.clientCount() === 0) {
      this._log.info(docSession, "will self-close in %d ms", this._inactivityTimer.getDelay());
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
   * Import data resulting from parsing a file into a new table.
   * In normal circumstances this is only used internally.
   * It's exposed publicly for use by grist-static which doesn't use the plugin system.
   */
  public async importParsedFileAsNewTable(
    docSession: OptDocSession, optionsAndData: ParseFileResult, importOptions: FileImportOptions
  ): Promise<ImportResult> {
    return this._activeDocImport.importParsedFileAsNewTable(docSession, optionsAndData, importOptions);
  }

  /**
   * This function saves attachments from a given upload and creates an entry for them in the database.
   * It returns the list of rowIds for the rows created in the _grist_Attachments table.
   */
  public async addAttachments(docSession: OptDocSession, uploadId: number): Promise<number[]> {
    const userId = getDocSessionUserId(docSession);
    const upload: UploadInfo = globalUploadSet.getUploadInfo(uploadId, this.makeAccessId(userId));
    try {
      // We'll assert that the upload won't cause limits to be exceeded, retrying once after
      // soft-deleting any unused attachments.
      await retryOnce(
        () => this._assertUploadSizeBelowLimit(upload),
        async (e) => {
          if (!(e instanceof LimitExceededError)) { throw e; }

          // Check if any attachments are unused and can be soft-deleted to reduce the existing
          // total size. We could do this from the beginning, but updateUsedAttachmentsIfNeeded
          // is potentially expensive, so this optimises for the common case of not exceeding the limit.
          const hadChanges = await this.updateUsedAttachmentsIfNeeded();
          if (hadChanges) {
            await this._updateAttachmentsSize({syncUsageToDatabase: false});
          } else {
            // No point in retrying if nothing changed.
            throw new LimitExceededError("Exceeded attachments limit for document");
          }
        }
      );
      const userActions: UserAction[] = await Promise.all(
        upload.files.map(file => this._prepAttachment(docSession, file)));
      const result = await this._applyUserActionsWithExtendedOptions(docSession, userActions, {
        attachment: true,
      });
      this._updateAttachmentsSize().catch(e => {
        this._log.warn(docSession, 'failed to update attachments size', e);
      });
      await this._granularAccess.noteUploads(docSession, result.retValues);
      return result.retValues;
    } finally {
      await globalUploadSet.cleanup(uploadId);
    }
  }

  /**
   * Returns the record from _grist_Attachments table for the given attachment ID,
   * or throws an error if not found.
   */
  public getAttachmentMetadata(attId: number): MetaRowRecord<'_grist_Attachments'> {
    // docData should always be available after loadDoc() or createDoc().
    if (!this.docData) {
      throw new Error("No doc data");
    }
    const attRecord = this.docData.getMetaTable('_grist_Attachments').getRecord(attId);
    if (!attRecord) {
      throw new ApiError(`Attachment not found: ${attId}`, 404);
    }
    return attRecord;
  }

  /**
   * Given a _gristAttachments record, returns a promise for the attachment data.
   * Can optionally take a cell in which the attachment is expected to be
   * referenced, and/or a `maybeNew` flag which, when set, specifies that the
   * attachment may be a recent upload that is not yet referenced in the document.
   * @returns {Promise<Buffer>} Promise for the data of this attachment; rejected on error.
   */
  public async getAttachmentData(docSession: OptDocSession, attRecord: MetaRowRecord<"_grist_Attachments">,
                                 options?: {
                                   cell?: SingleCell,
                                   maybeNew?: boolean,
                                 }): Promise<Buffer> {
    const attId = attRecord.id;
    const fileIdent = attRecord.fileIdent;
    const cell = options?.cell;
    const maybeNew = options?.maybeNew;
    if (
      await this._granularAccess.canReadEverything(docSession) ||
      await this.canDownload(docSession)
    ) {
      // Do not need to sweat over access to attachments if user can
      // read everything or download everything.
    } else {
      if (maybeNew && await this._granularAccess.isAttachmentUploadedByUser(docSession, attId)) {
        // Fine, this is an attachment the user uploaded (recently).
      } else if (cell) {
        // Only provide the download if the user has access to the cell
        // they specified, and that cell is in an attachment column,
        // and the cell contains the specified attachment.
        await this._granularAccess.assertAttachmentAccess(docSession, cell, attId);
      } else {
        if (!await this._granularAccess.findAttachmentCellForUser(docSession, attId)) {
          // We found no reason to allow this user to access the attachment.
          throw new ApiError('Cannot access attachment', 403);
        }
      }
    }
    const data = await this.docStorage.getFileData(fileIdent);
    if (!data) { throw new ApiError("Invalid attachment identifier", 404); }
    this._log.info(docSession, "getAttachment: %s -> %s bytes", fileIdent, data.length);
    return data;
  }

  /**
   * Fetches the meta tables to return to the client when first opening a document.
   */
  public async fetchMetaTables(docSession: OptDocSession) {
    this._log.info(docSession, "fetchMetaTables");
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
    await this._initializationPromise;
  }

  // Check if user has rights to download this doc.
  public async canDownload(docSession: OptDocSession) {
    return this._granularAccess.canCopyEverything(docSession);
  }

  // Check if user has rights to read everything in this doc.
  public async canCopyEverything(docSession: OptDocSession) {
    return this._granularAccess.canCopyEverything(docSession);
  }

  // Check if it is appropriate for the user to be treated as an owner of
  // the document for granular access purposes when in "prefork" mode
  // (meaning a document has been opened with the intent to fork it, but
  // an initial modification has not yet been made).
  // Currently, we decide it is appropriate if the user has access to all
  // the data in the document, either directly or via the special
  // "FullCopies" permission.
  public async canForkAsOwner(docSession: OptDocSession) {
    return this._granularAccess.canCopyEverything(docSession);
  }

  // Remove cached access information for a given session.
  public flushAccess(docSession: OptDocSession) {
    return this._granularAccess.flushAccess(docSession);
  }

  /**
   * Fetches a particular table from the data engine to return to the client.
   * @param {String} tableId: The string identifier of the table.
   * @param {Boolean} waitForFormulas: If true, wait for all data to be loaded/calculated.
   * @returns {Promise} Promise for the TableData object, which is a BulkAddRecord-like array of the
   *      form of the form ["TableData", table_id, row_ids, column_values].
   */
  public async fetchTable(docSession: OptDocSession, tableId: string,
                          waitForFormulas: boolean = false): Promise<TableFetchResult> {
    return this.fetchQuery(docSession, {tableId, filters: {}}, waitForFormulas);
  }

  /**
   * Fetches data according to the given query, which includes tableId and filters (see Query in
   * app/common/ActiveDocAPI.ts). The data is fetched from the data engine for regular tables, or
   * from the DocStorage directly for onDemand tables.
   * @param {Boolean} waitForFormulas: If true, wait for all data to be loaded/calculated.  If false,
   * special "pending" values may be returned.
   */
  public async fetchQuery(docSession: OptDocSession, query: ServerQuery,
                          waitForFormulas: boolean = false): Promise<TableFetchResult> {
    this._inactivityTimer.ping();     // The doc is in active use; ping it to stay open longer.

    // If user does not have rights to access what this query is asking for, fail.
    const tableAccess = await this._granularAccess.getTableAccess(docSession, query.tableId);

    this._granularAccess.assertCanRead(tableAccess);

    if (query.tableId.startsWith('_gristsys_')) {
      throw new Error('Cannot fetch _gristsys tables');
    }

    if (query.tableId.startsWith('_grist_') && !await this._granularAccess.canReadEverything(docSession)) {
      // Metadata tables may need filtering, and this can't be done by looking at a single
      // table.  So we pick out the table we want from fetchMetaTables (which has applied
      // filtering).
      const tables = await this.fetchMetaTables(docSession);
      const tableData = tables[query.tableId];
      if (tableData) { return {tableData}; }
      // If table not found, continue, to give a consistent error for a table not found.
    }

    // Some tests read _grist_ tables via the api.  The _fetchQueryFromDB method
    // currently cannot read those tables, so we load them from the data engine
    // when ready.
    // Also, if row-level access is being controlled, we wait for formula columns
    // to be populated.
    const wantFull = waitForFormulas || query.tableId.startsWith('_grist_') ||
      this._granularAccess.getReadPermission(tableAccess) === 'mixed';
    const onDemand = this._onDemandActions.isOnDemand(query.tableId);
    this._log.info(docSession, "fetchQuery %s %s", JSON.stringify(query),
      onDemand ? "(onDemand)" : "(regular)");
    let data: TableDataAction;
    if (onDemand || this._isSnapshot) {
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
    // Likewise if column-level access is being controlled.
    if (this._granularAccess.getReadPermission(tableAccess) !== 'allow') {
      data = cloneDeep(data!);  // Clone since underlying fetch may be cached and shared.
      await this._granularAccess.filterData(docSession, data);
    }

    // Consider whether we need to add attachment metadata.
    // TODO: it might be desirable to always send attachment data, or allow
    // this to be an option in api calls related to fetching.
    let attachments: BulkAddRecord | undefined;
    const attachmentColumns = this._getCachedAttachmentColumns();
    if (attachmentColumns?.size && await this._granularAccess.needAttachmentControl(docSession)) {
      const attIds = gatherAttachmentIds(attachmentColumns, data!);
      if (attIds.size > 0) {
        attachments = this.docData!.getMetaTable('_grist_Attachments')
          .getBulkAddRecord([...attIds]);
      }
    }

    this._log.info(docSession, "fetchQuery -> %d rows, cols: %s",
             data![2].length, Object.keys(data![3]).join(", "));
    return {tableData: data!, ...(attachments && {attachments})};
  }

  /**
   * Fetches the generated schema for a given table.
   * @param {String} tableId: The string identifier of the table.
   * @returns {Promise} Promise for a string representing the generated table schema.
   */
  public async fetchTableSchema(docSession: DocSession): Promise<string> {
    this._log.info(docSession, "fetchTableSchema(%s)", docSession);
    // Permit code view if user can read everything, or can download/copy (perhaps
    // via an exceptional permission for sample documents)
    if (!(await this._granularAccess.canReadEverything(docSession) ||
          await this.canDownload(docSession))) {
      throw new ApiError('Cannot view code, it may contain private material', 403);
    }
    await this.waitForInitialization();
    return this._pyCall('fetch_table_schema');
  }

  /**
   * Makes a query (documented elsewhere) and subscribes to it, so that the client receives
   * docActions that affect this query's results.
   */
  public async useQuerySet(docSession: OptDocSession, query: ServerQuery): Promise<QueryResult> {
    this._log.info(docSession, "useQuerySet(%s, %s)", docSession, query);
    // TODO implement subscribing to the query.
    // - Convert tableId+colIds to TableData/ColData references
    // - Return a unique identifier for unsubscribing
    // - Each call can create its own object, return own identifier.
    // - Subscription should not be affected by renames (so don't hold on to query/tableId/colIds)
    // - Table/column deletion should make subscription inactive, and unsubscribing an inactive
    //   subscription should not produce an error.
    const tableFetchResult = await this.fetchQuery(docSession, query);
    return {querySubId: 0, ...tableFetchResult};
  }

  /**
   * Removes all subscriptions to the given query from this client, so that it stops receiving
   * docActions relevant only to this query.
   */
  public async disposeQuerySet(docSession: DocSession, querySubId: number): Promise<void> {
    this._log.info(docSession, "disposeQuerySet(%s, %s)", docSession, querySubId);
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
    // This could leak information about private tables, so check for permission.
    if (!await this._granularAccess.canScanData(docSession)) { return []; }
    this._log.info(docSession, "findColFromValues(%s, %s, %s)", docSession, values, n);
    await this.waitForInitialization();
    return this._pyCall('find_col_from_values', values, n, optTableId);
  }

  /**
   * Returns column metadata for all visible columns from `tableId`.
   *
   * @param {string} tableId Table to retrieve column metadata for.
   * @returns {Promise<TableRecordValue[]>} Records containing metadata about the visible columns
   * from `tableId`.
   */
  public async getTableCols(
    docSession: OptDocSession,
    tableId: string,
    includeHidden = false): Promise<RecordWithStringId[]> {
    const metaTables = await this.fetchMetaTables(docSession);
    const tableRef = tableIdToRef(metaTables, tableId);
    const [, , colRefs, columnData] = metaTables._grist_Tables_column;

    // colId is pulled out of fields and used as the root id
    const fieldNames = without(Object.keys(columnData), "colId");

    const columns: RecordWithStringId[] = [];
    (columnData.colId as string[]).forEach((id, index) => {
      const hasNoId = !id;
      const isHidden = hasNoId || id === "manualSort" || id.startsWith("gristHelper_");
      const fromDifferentTable = columnData.parentId[index] !== tableRef;
      const skip = (isHidden && !includeHidden) || hasNoId || fromDifferentTable;
      if (skip) {
        return;
      }
      const column: RecordWithStringId = { id, fields: { colRef: colRefs[index] } };
      for (const key of fieldNames) {
        column.fields[key] = columnData[key][index];
      }
      columns.push(column);
    });
    return columns;
  }

  /**
   * Returns error message (traceback) for one invalid formula cell.
   * @param {String} tableId - Table name
   * @param {String} colId - Column name
   * @param {Integer} rowId - Row number
   * @returns {Promise} Promise for a error message
   */
  public async getFormulaError(docSession: OptDocSession, tableId: string, colId: string,
                               rowId: number): Promise<CellValue> {
    // Throw an error if the user doesn't have access to read this cell.
    await this._granularAccess.getCellValue(docSession, {tableId, colId, rowId});

    this._log.info(docSession, "getFormulaError(%s, %s, %s, %s)",
      docSession, tableId, colId, rowId);
    await this.waitForInitialization();
    return this._pyCall('get_formula_error', tableId, colId, rowId);
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
                                unsanitizedOptions?: ApplyUAOptions): Promise<ApplyUAResult> {
    const options = sanitizeApplyUAOptions(unsanitizedOptions);
    return this._applyUserActionsWithExtendedOptions(docSession, actions, options);
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
  public async applyUserActionsById(docSession: OptDocSession,
                                    actionNums: number[],
                                    actionHashes: string[],
                                    undo: boolean,
                                    unsanitizedOptions?: ApplyUAOptions): Promise<ApplyUAResult> {
    const options = sanitizeApplyUAOptions(unsanitizedOptions);
    const actionBundles = await this._actionHistory.getActions(actionNums);
    let fromOwnHistory: boolean = true;
    const user = getDocSessionUser(docSession);
    let oldestSource: number = Date.now();
    for (const [index, bundle] of actionBundles.entries()) {
      const actionNum = actionNums[index];
      const actionHash = actionHashes[index];
      if (!bundle) { throw new Error(`Could not find actionNum ${actionNum}`); }
      const info = bundle.info[1];
      const bundleEmail = info.user || '';
      const sessionEmail = user?.email || '';
      if (normalizeEmail(sessionEmail) !== normalizeEmail(bundleEmail)) {
        fromOwnHistory = false;
      }
      if (info.time && info.time < oldestSource) {
        oldestSource = info.time;
      }
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
    // Undos are best effort now by default.
    return this._applyUserActionsWithExtendedOptions(
      docSession, actions, {bestEffort: undo,
                            oldestSource,
                            fromOwnHistory, ...(options||{})});
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
    if (docActions.some(docAction => this._onDemandActions.isSchemaAction(docAction))) {
      const indexes = this._onDemandActions.getDesiredIndexes();
      await this.docStorage.updateIndexes(indexes);
      // TODO: should probably add indexes for user attribute tables.
    }
    if (docActions.some(docAction => isSchemaAction(docAction))) {
      this._attachmentColumns = undefined;
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

  public async removeInstanceFromDoc(docSession: DocSession): Promise<void> {
    await this._sharing.removeInstanceFromDoc();
  }

  public async renameDocTo(docSession: OptDocSession, newName: string): Promise<void> {
    this._log.debug(docSession, 'renameDoc', newName);
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

  public async autocomplete(
    docSession: DocSession, txt: string, tableId: string, columnId: string, rowId: UIRowId
  ): Promise<ISuggestionWithValue[]> {
    // Autocompletion can leak names of tables and columns.
    if (!await this._granularAccess.canScanData(docSession)) { return []; }
    await this.waitForInitialization();
    const user = await this._granularAccess.getCachedUser(docSession);
    return this._pyCall('autocomplete', txt, tableId, columnId, rowId, user.toJSON());
  }

  // Callback to generate a prompt containing schema info for assistance.
  public async assistanceSchemaPromptV1(
    docSession: OptDocSession,
    context: AssistanceSchemaPromptV1Context
  ): Promise<string> {
    // Making a prompt leaks names of tables and columns etc.
    if (!await this._granularAccess.canScanData(docSession)) {
      throw new Error("Permission denied");
    }

    return await this._pyCall(
      'get_formula_prompt',
      context.tableId,
      context.colId,
      context.docString,
      context.includeAllTables ?? true,
      context.includeLookups ?? true
    );
  }

  // Callback to make a data-engine formula tweak for assistance.
  public assistanceFormulaTweak(txt: string) {
    return this._pyCall('convert_formula_completion', txt);
  }

  // Callback to compute an existing formula and return the result along with recorded values
  // of (possibly nested) attributes of `rec`.
  // Used by AI assistance to fix an incorrect formula.
  public assistanceEvaluateFormula(options: AssistanceContext) {
    if (!options.evaluateCurrentFormula) {
      throw new Error('evaluateCurrentFormula must be true');
    }
    return this._pyCall('evaluate_formula', options.tableId, options.colId, options.rowId);
  }

  public fetchURL(docSession: DocSession, url: string, options?: FetchUrlOptions): Promise<UploadResult> {
    return fetchURL(url, this.makeAccessId(docSession.authorizer.getUserId()), options);
  }

  public async forwardPluginRpc(docSession: DocSession, pluginId: string, msg: IMessage): Promise<any> {
    if (await this._granularAccess.hasNuancedAccess(docSession)) {
      throw new Error('cannot confirm access to plugin');
    }
    if (!this.docPluginManager) { throw new Error('no plugin manager available'); }
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
    if (!this._docManager.pluginManager || !this.docPluginManager) { return; }
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
    this._log.debug(docSession || null, 'ActiveDoc.reloadDoc starting shutdown');
    return this.shutdown();
  }

  public isOwner(docSession: OptDocSession): Promise<boolean> {
    return this._granularAccess.isOwner(docSession);
  }

  /**
   * Fork the current document.
   *
   * TODO: reconcile the two ways there are now of preparing a fork.
   */
  public async fork(docSession: OptDocSession): Promise<ForkResult> {
    const dbManager = this._getHomeDbManagerOrFail();
    const user = getDocSessionUser(docSession);
    // For now, fork only if user can read everything (or is owner).
    // TODO: allow forks with partial content.
    if (!user || !await this.canDownload(docSession)) {
      throw new ApiError('Insufficient access to document to copy it entirely', 403);
    }
    const userId = user.id;
    const isAnonymous = this._docManager.isAnonymous(userId);

    // Get fresh document metadata (the cached metadata doesn't include the urlId).
    let doc: Document | undefined;
    if (docSession.authorizer) {
      doc = await docSession.authorizer.getDoc();
    } else if (docSession.req) {
      doc = await dbManager.getDoc(docSession.req);
    }
    if (!doc) { throw new Error('Document not found'); }

    // Don't allow creating forks of forks (for now).
    if (doc.trunkId) { throw new ApiError("Cannot fork a document that's already a fork", 400); }

    const trunkDocId = doc.id;
    const trunkUrlId = doc.urlId || doc.id;
    await this.flushDoc();  // Make sure fork won't be too out of date.
    const forkIds = makeForkIds({userId, isAnonymous, trunkDocId, trunkUrlId});

    // To actually create the fork, we call an endpoint.  This is so the fork
    // can be associated with an arbitrary doc worker, rather than tied to the
    // same worker as the trunk.  We use a Permit for authorization.
    const permitStore = this._docManager.gristServer.getPermitStore();
    const permitKey = await permitStore.setPermit({docId: forkIds.docId,
                                                   otherDocId: this.docName});
    try {
      const url = await this._docManager.gristServer.getHomeUrlByDocId(
        forkIds.docId, `/api/docs/${forkIds.docId}/create-fork`);
      const resp = await fetch(url, {
        method: 'POST',
        body: JSON.stringify({ srcDocId: this.docName }),
        headers: {
          'Permit': permitKey,
          'Content-Type': 'application/json',
        },
      });
      if (resp.status !== 200) {
        throw new ApiError(resp.statusText, resp.status);
      }

      await dbManager.forkDoc(userId, doc, forkIds.forkId);

      const isTemplate = doc.type === 'template';
      this.logTelemetryEvent(docSession, 'documentForked', {
        limited: {
          forkIdDigest: forkIds.forkId,
          forkDocIdDigest: forkIds.docId,
          trunkIdDigest: doc.trunkId,
          isTemplate,
          lastActivity: doc.updatedAt,
        },
      });
    } finally {
      await permitStore.removePermit(permitKey);
    }

    return forkIds;
  }

  public async getAccessToken(docSession: OptDocSession, options: AccessTokenOptions): Promise<AccessTokenResult> {
    const tokens = this._docManager.gristServer.getAccessTokens();
    const userId = getDocSessionUserId(docSession);
    const docId = this.docName;
    const access = getDocSessionAccess(docSession);
    // If we happen to be using a "readOnly" connection, max out at "readOnly"
    // even if user could do more.
    if (roles.getStrongestRole('viewers', access) === 'viewers') {
      options.readOnly = true;
    }
    // Return a token that can be used to authorize as the given user.
    if (!userId) { throw new Error('creating access token requires a user'); }
    const token = await tokens.sign({
      readOnly: options.readOnly,
      userId,  // definitely do not want userId overridable by options.
      docId,   // likewise for docId.
    });
    const ttlMsecs = tokens.getNominalTTLInMsec();
    const baseUrl = this._options?.docApiUrl;
    if (!baseUrl) { throw new Error('cannot create token without URLs'); }
    return {
      token,
      baseUrl,
      ttlMsecs,
    };
  }

  /**
   * Check if an ACL formula is valid. If not, will throw an error with an explanation.
   */
  public async checkAclFormula(docSession: DocSession, text: string): Promise<FormulaProperties> {
    // Checks can leak names of tables and columns.
    if (await this._granularAccess.hasNuancedAccess(docSession)) { return {}; }
    await this.waitForInitialization();
    try {
      const parsedAclFormula = await this._pyCall('parse_acl_formula', text);
      compileAclFormula(parsedAclFormula);
      // TODO We also need to check the validity of attributes, and of tables and columns
      // mentioned in resources and userAttribute rules.
      return getFormulaProperties(parsedAclFormula);
    } catch (e) {
      e.message = e.message?.replace('[Sandbox] ', '');
      throw e;
    }
  }

  /**
   * Returns the full set of tableIds, with basic metadata for each table. This is intended
   * for editing ACLs. It is only available to users who can edit ACLs, and lists all resources
   * regardless of rules that may block access to them.
   *
   * Also returns information about resources mentioned in rules that no longer
   * exist.
   */
  public async getAclResources(docSession: DocSession): Promise<AclResources> {
    if (!this.docData || !await this._granularAccess.hasAccessRulesPermission(docSession)) {
      throw new Error('Cannot list ACL resources');
    }
    const result: {[tableId: string]: AclTableDescription} = {};
    const tables = this.docData.getMetaTable('_grist_Tables');
    const sections = this.docData.getMetaTable('_grist_Views_section');
    const columns = this.docData.getMetaTable('_grist_Tables_column');
    for (const table of tables.getRecords()) {
      const sourceTable = table.summarySourceTable ? tables.getRecord(table.summarySourceTable)! : table;
      const rawSection = sections.getRecord(sourceTable.rawViewSectionRef)!;
      result[table.tableId] = {
        title: rawSection.title || sourceTable.tableId,
        colIds: ['id'],
        groupByColLabels: table.summarySourceTable ? [] : null,
      };
    }
    for (const col of columns.getRecords()) {
      const tableId = tables.getValue(col.parentId, 'tableId')!;
      result[tableId].colIds.push(col.colId);
      if (col.summarySourceCol) {
        const sourceCol = columns.getRecord(col.summarySourceCol)!;
        result[tableId].groupByColLabels!.push(sourceCol.label);
      }
    }
    const ruleCollection = new ACLRuleCollection();
    await ruleCollection.update(this.docData, {log});
    const problems = ruleCollection.findRuleProblems(this.docData);
    return {tables: result, problems};
  }

  /**
   * Get users that are worth proposing to "View As" for access control purposes.
   * User are drawn from the following sources:
   *   - Users document is shared with.
   *   - Users mentioned in user attribute tables keyed by email address.
   *   - Some predefined example users.
   *
   * The users the document is shared with are only available if the
   * user is an owner of the document (or, in a fork, an owner of the
   * trunk document). For viewers or editors, only the user calling
   * the method will be included as users the document is shared with.
   *
   * Users mentioned in user attribute tables will be available to any user with
   * the right to view access rules.
   *
   * Example users are always included.
   */
  public async getUsersForViewAs(docSession: OptDocSession): Promise<PermissionDataWithExtraUsers> {
    // Make sure we have rights to view access rules.
    if (!await this._granularAccess.hasAccessRulesPermission(docSession)) {
      throw new Error('Cannot list ACL users');
    }

    // Prepare a stub for the collected results.
    const result: PermissionDataWithExtraUsers = {
      users: [],
      attributeTableUsers: [],
      exampleUsers: [],
    };
    const isShared = new Set<string>();

    // Collect users the document is shared with.
    const userId = getDocSessionUserId(docSession);
    if (!userId) { throw new Error('Cannot determine user'); }
    const db = this.getHomeDbManager();
    if (db) {
      const access = db.unwrapQueryResult(
        await db.getDocAccess({userId, urlId: this.docName}, {
          flatten: true, excludeUsersWithoutAccess: true,
        }));
      result.users = access.users;
      result.users.forEach(user => isShared.add(normalizeEmail(user.email)));
    }

    // Collect users from user attribute tables. Omit duplicates with users the document is
    // shared with.
    const usersFromUserAttributes = await this._granularAccess.collectViewAsUsersFromUserAttributeTables();
    for (const user of usersFromUserAttributes) {
      if (!user.email) { continue; }
      const email = normalizeEmail(user.email);
      if (!isShared.has(email)) {
        result.attributeTableUsers.push({email: user.email, name: user.name || '',
                                         id: 0, access: user.access === undefined ? 'editors' : user.access});
      }
    }

    // Add some example users.
    result.exampleUsers = this._granularAccess.getExampleViewAsUsers();
    return result;
  }

  public getGristDocAPI(): GristDocAPI {
    if (!this.docPluginManager) { throw new Error('no plugin manager available'); }
    return this.docPluginManager.gristDocAPI;
  }

  // Get recent actions in ActionGroup format with summaries included.
  public async getActionSummaries(docSession: DocSession): Promise<ActionGroup[]> {
    return this.getRecentActions(docSession, true);
  }

  /**
   * Applies normal actions to the data engine while processing onDemand actions separately.
   * Should only be called by a Sharing object, with this._modificationLock held, since the
   * actions may need to be rolled back if final access control checks fail.
   */
  public async applyActionsToDataEngine(
    docSession: OptDocSession|null,
    userActions: UserAction[]
  ): Promise<SandboxActionBundle> {
    const [normalActions, onDemandActions] = this._onDemandActions.splitByStorage(userActions);

    let sandboxActionBundle: SandboxActionBundle;
    if (normalActions.length > 0) {
      // For all but the special 'Calculate' action, we wait for full initialization.
      if (normalActions[0][0] !== 'Calculate') {
        await this.waitForInitialization();
      }
      const user = docSession ? await this._granularAccess.getCachedUser(docSession) : undefined;
      sandboxActionBundle = await this._rawPyCall('apply_user_actions', normalActions, user?.toJSON());
      const {requests} = sandboxActionBundle;
      if (requests) {
        this._requests.handleRequestsBatchFromUserActions(requests).catch(e => console.error(e));
      }
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
          sandboxActionBundle.direct.push(...stored.map(a => [allIndex, true] as [number, boolean]));
          sandboxActionBundle.undo.push(...undo.map(a => [allIndex, a] as [number, DocAction]));
          sandboxActionBundle.retValues.push(retValues);
        }
      });
    }

    return sandboxActionBundle;
  }

  /**
   * Check which attachments in the _grist_Attachments metadata are actually used,
   * i.e. referenced by some cell in an Attachments type column.
   * Set timeDeleted to the current time on newly unused attachments,
   * 'soft deleting' them so that they get cleaned up automatically from _gristsys_Files after enough time has passed.
   * Set timeDeleted to null on used attachments that were previously soft deleted,
   * so that undo can 'undelete' attachments.
   * Returns true if any changes were made, i.e. some row(s) of _grist_Attachments were updated.
   */
  public async updateUsedAttachmentsIfNeeded() {
    const changes = await this.docStorage.scanAttachmentsForUsageChanges();
    if (!changes.length) {
      return false;
    }
    const rowIds = changes.map(r => r.id);
    const now = Date.now() / 1000;
    const timeDeleted = changes.map(r => r.used ? null : now);
    const action: BulkUpdateRecord = ["BulkUpdateRecord", "_grist_Attachments", rowIds, {timeDeleted}];
    // Don't use applyUserActions which may block the update action in delete-only mode
    await this._applyUserActions(makeExceptionalDocSession('system'), [action]);
    return true;
  }

  /**
   * Delete unused attachments from _grist_Attachments and gristsys_Files.
   * @param expiredOnly: if true, only delete attachments that were soft-deleted sufficiently long ago.
   * @param options.syncUsageToDatabase: if true, schedule an update to the usage column of the docs table, if
   * any unused attachments were soft-deleted. defaults to true.
   * @param options.broadcastUsageToClients: if true, broadcast updated doc usage to all clients, if
   * any unused attachments were soft-deleted. defaults to true.
   */
  public async removeUnusedAttachments(expiredOnly: boolean, options?: UpdateUsageOptions) {
    const hadChanges = await this.updateUsedAttachmentsIfNeeded();
    if (hadChanges) {
      await this._updateAttachmentsSize(options);
    }
    const rowIds = await this.docStorage.getSoftDeletedAttachmentIds(expiredOnly);
    if (rowIds.length) {
      const action: BulkRemoveRecord = ["BulkRemoveRecord", "_grist_Attachments", rowIds];
      await this.applyUserActions(makeExceptionalDocSession('system'), [action]);
    }
    try {
      await this.docStorage.removeUnusedAttachments();
    } catch (e) {
      // If document doesn't have _gristsys_Files, don't worry about it;
      // if this is an error it will have already been reported, and the
      // document can be in this state when updating initial SQL code after
      // a schema change.
      if (!String(e).match(/no such table: _gristsys_Files/)) {
        throw e;
      }
    }
  }

  // Needed for test/server/migrations.js tests
  public async testGetVersionFromDataEngine() {
    return this._pyCall('get_version');
  }

  // Needed for test/server/lib/HostedStorageManager.ts tests
  public async testKeepOpen() {
    this._inactivityTimer.ping();
  }

  public async getSnapshots(docSession: OptDocSession, skipMetadataCache?: boolean): Promise<DocSnapshots> {
    if (await this._granularAccess.hasNuancedAccess(docSession)) {
      throw new Error('cannot confirm access to snapshots because of access rules');
    }
    return this._docManager.storageManager.getSnapshots(this.docName, skipMetadataCache);
  }

  public async removeSnapshots(docSession: OptDocSession, snapshotIds: string[]): Promise<void> {
    if (!await this.isOwner(docSession)) {
      throw new Error('cannot remove snapshots, access denied');
    }
    return this._docManager.storageManager.removeSnapshots(this.docName, snapshotIds);
  }

  public async deleteActions(docSession: OptDocSession, keepN: number): Promise<void> {
    if (!await this.isOwner(docSession)) {
      throw new Error('cannot delete actions, access denied');
    }
    await this._actionHistory.deleteActions(keepN);
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
   * Apply actions that have already occurred in the data engine to the
   * database also.
   */
  public async applyStoredActionsToDocStorage(docActions: DocAction[]): Promise<void> {
    // When "gristifying" an sqlite database, we may take create tables and
    // columns in the data engine that already exist in the sqlite database.
    // During that process, _onlyAllowMetaDataActionsOnDb will be turned on,
    // and we silently swallow any non-metadata actions.
    if (this._onlyAllowMetaDataActionsOnDb) {
      docActions = docActions.filter(a => getTableId(a).startsWith('_grist'));
    }
    await this.docStorage.applyStoredActions(docActions);
  }

  // Set a flag that controls whether user data can be changed in the database,
  // or only grist-managed tables (those whose names start with _grist)
  public onlyAllowMetaDataActionsOnDb(flag: boolean) {
    this._onlyAllowMetaDataActionsOnDb = flag;
  }

  /**
   * Called by Sharing manager when working on modifying the document.
   * Called when DocActions have been produced from UserActions, but
   * before those DocActions have been applied to the DB. GranularAccessBundle
   * methods can confirm that those DocActions are legal according to any
   * granular access rules.
   */
  public getGranularAccessForBundle(docSession: OptDocSession, docActions: DocAction[], undo: DocAction[],
                                    userActions: UserAction[], isDirect: boolean[],
                                    options: ApplyUAOptions|null): GranularAccessForBundle {
    this._granularAccess.getGranularAccessForBundle(docSession, docActions, undo, userActions, isDirect, options);
    return this._granularAccess;
  }

  public async updateRowCount(rowCount: RowCounts, docSession: OptDocSession | null) {
    // Up-to-date row counts are included in every DocUserAction, so we can skip broadcasting here.
    await this._updateDocUsage({rowCount}, {broadcastUsageToClients: false});
    log.rawInfo('Sandbox row count', {...this.getLogMeta(docSession), rowCount: rowCount.total});
    await this._checkDataLimitRatio();

    // Calculating data size is potentially expensive, so skip calculating it unless the
    // user is currently being warned specifically about approaching or exceeding the data
    // size limit, but not the row count limit; we don't need to warn about both limits at
    // the same time.
    if (
      this.dataSizeLimitRatio > APPROACHING_LIMIT_RATIO && this.rowLimitRatio <= APPROACHING_LIMIT_RATIO ||
      this.dataSizeLimitRatio > 1.0 && this.rowLimitRatio <= 1.0
    ) {
      await this._checkDataSizeLimitRatio(docSession);
    }
  }

  /**
   * Clears all outgoing webhook requests queued for this document.
   */
  public async clearWebhookQueue() {
    await this._triggers.clearWebhookQueue();
  }

  public async clearSingleWebhookQueue(webhookId: string) {
    await this._triggers.clearSingleWebhookQueue(webhookId);
  }

  /**
   * Returns the list of outgoing webhook for a table in this document.
   */
  public async webhooksSummary() {
    return this._triggers.summary();
  }

  /**
   * Send a message to clients connected to the document that something
   * webhook-related has happened (a change in configuration, a delivery,
   * or an error). It passes information about the type of event (currently data being updated in some way
   * or an OverflowError, i.e., too many events waiting to be sent). More data may be added when necessary.
   */
  public async sendWebhookNotification(type: WebhookMessageType = WebhookMessageType.Update) {
    await this.docClients.broadcastDocMessage(null, 'docChatter', {
      webhooks: {type},
    });
  }

  public logTelemetryEvent(
    docSession: OptDocSession | null,
    event: TelemetryEvent,
    metadata?: TelemetryMetadataByLevel
  ) {
    this._docManager.gristServer.getTelemetry().logEvent(docSession, event, merge(
      this._getTelemetryMeta(docSession),
      metadata,
    ));
  }

  /**
   * Make sure the shares listed for the doc in the home db and the
   * shares listed within the doc itself are in sync. If skipIfNoShares
   * is set, we skip checking the home db if there are no shares listed
   * within the doc, as a small optimization.
   */
  public async syncShares(docSession: OptDocSession, options: {
    skipIfNoShares?: boolean,
  } = {}) {
    const metaTables = await this.fetchMetaTables(docSession);
    const shares = metaTables['_grist_Shares'];
    const ids = shares[2];
    const vals = shares[3];
    const goodShares = ids.map((id, idx) => {
      return {
        id,
        linkId: String(vals['linkId'][idx]),
        options: String(vals['options'][idx]),
      };
    });
    if (goodShares.length > 0 || !options.skipIfNoShares) {
      await this._getHomeDbManagerOrFail().syncShares(this.docName, goodShares);
    }
    return goodShares;
  }

  public async getShare(_docSession: OptDocSession, linkId: string): Promise<Share|null> {
    return await this._getHomeDbManagerOrFail().getShareByLinkId(this.docName, linkId);
  }

  /**
   * Loads an open document from DocStorage.  Returns a list of the tables it contains.
   */
  protected async _loadOpenDoc(docSession: OptDocSession): Promise<string[][]> {
    // Check the schema version of document and sandbox, and migrate if the sandbox is newer.
    const schemaVersion = SCHEMA_VERSION;

    // Migrate the document if needed.
    const docInfo = await this._tableMetadataLoader.fetchBulkColValuesWithoutIds('_grist_DocInfo');
    const versionCol = docInfo.schemaVersion;
    const docSchemaVersion = (versionCol && versionCol.length === 1 ? versionCol[0] : 0) as number;
    if (docSchemaVersion < schemaVersion) {
      this._log.info(docSession, "Doc needs migration from v%s to v%s", docSchemaVersion, schemaVersion);
      await this._beforeMigration(docSession, 'schema', docSchemaVersion, schemaVersion);
      let success: boolean = false;
      try {
        await this._withDataEngine(() => this._migrate(docSession), {
          shutdownAfter: this._isSnapshot,
        });
        success = true;
      } finally {
        await this._afterMigration(docSession, 'schema', schemaVersion, success);
        await this._tableMetadataLoader.clean();  // _grist_DocInfo may have changed.
      }
    } else if (docSchemaVersion > schemaVersion) {
      // We do NOT attempt to down-migrate in this case. Migration code cannot down-migrate
      // directly (since it doesn't know anything about newer documents). We could revert the
      // migration action, but that requires merging and still may not be safe. For now, doing
      // nothing seems best, as long as we follow the recommendations in migrations.py (never
      // remove/modify/rename metadata tables or columns, or change their meaning).
      this._log.warn(docSession, "Doc is newer (v%s) than this version of Grist (v%s); " +
        "proceeding with fingers crossed", docSchemaVersion, schemaVersion);
    }

    if (!this._isSnapshot) {
      this._tableMetadataLoader.startStreamingToEngine();
    }

    // Start loading the initial meta tables which determine the document schema.
    this._tableMetadataLoader.startFetchingTable('_grist_Tables');
    this._tableMetadataLoader.startFetchingTable('_grist_Tables_column');

    // Get names of remaining tables.
    const tablesParsed = await this._tableMetadataLoader.fetchBulkColValuesWithoutIds('_grist_Tables');
    const tableNames = (tablesParsed.tableId as string[])
      .concat(Object.keys(schema))
      .filter(tableId => tableId !== '_grist_Tables' && tableId !== '_grist_Tables_column')
      .sort();

    // Figure out which tables are on-demand.
    const onDemandMap = zipObject(tablesParsed.tableId as string[], tablesParsed.onDemand);
    const onDemandNames = remove(tableNames, (t) => (onDemandMap[t] ||
      (this._recoveryMode && !t.startsWith('_grist_'))));

    this._log.debug(docSession, "Loading %s normal tables, skipping %s on-demand tables",
      tableNames.length, onDemandNames.length);
    this._log.debug(docSession, "Normal tables: %s", tableNames.join(", "));
    this._log.debug(docSession, "On-demand tables: %s",  onDemandNames.join(", "));

    return [tableNames, onDemandNames];
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
  @ActiveDoc.keepDocOpen
  protected async _applyUserActions(docSession: OptDocSession, actions: UserAction[],
                                    options: ApplyUAExtendedOptions = {}): Promise<ApplyUAResult> {

    const client = docSession.client;
    this._log.debug(docSession, "_applyUserActions(%s, %s)%s", client, shortDesc(actions),
      options.parseStrings ? ' (will parse)' : '');
    this._inactivityTimer.ping();     // The doc is in active use; ping it to stay open longer.

    if (options.parseStrings) {
      actions = actions.map(ua => parseUserAction(ua, this.docData!));
    }

    if (options?.bestEffort) {
      actions = await this._granularAccess.prefilterUserActions(docSession, actions, options);
    }
    await this._granularAccess.checkUserActions(docSession, actions);

    // Create the UserActionBundle.
    const action: UserActionBundle = {
      info: this._makeInfo(docSession, options),
      options,
      userActions: actions,
    };

    const result: ApplyUAResult = await new Promise<ApplyUAResult>(
      (resolve, reject) =>
        this._sharing.addUserAction({action, docSession, resolve, reject}));
    this._log.debug(docSession, "_applyUserActions returning %s", shortDesc(result));

    if (result.isModification) {
      this._fetchCache.clear();  // This could be more nuanced.
      this._docManager.markAsChanged(this, 'edit');
    }
    return result;
  }

  private async _doShutdownImpl(): Promise<void> {
    const docSession = makeExceptionalDocSession('system');
    this._log.debug(docSession, "shutdown starting");

    const safeCallAndWait = async (funcDesc: string, func: () => Promise<unknown>) => {
      try {
        if (await timeoutReached(Deps.SHUTDOWN_ITEM_TIMEOUT_MS, func())) {
          this._log.error(docSession, `${funcDesc} timed out`);
        }
      } catch (err) {
        this._log.error(docSession, `${funcDesc} failed`, err);
      }
    };

    try {
      this.setMuted();
      this._inactivityTimer.disable();
      if (this.docClients.clientCount() > 0) {
        this._log.warn(docSession, `Doc being closed with ${this.docClients.clientCount()} clients left`);
        await this.docClients.broadcastDocMessage(null, 'docShutdown', null);
        this.docClients.interruptAllClients();
        this.docClients.removeAllClients();
      }

      this._triggers.shutdown();

      this._redisSubscriber?.quitAsync()
        .catch(e => this._log.warn(docSession, "Failed to quit redis subscriber", e));

      // Clear the MapWithTTL to remove all timers from the event loop.
      this._fetchCache.clear();

      await Promise.all(this._intervals.map(interval =>
        safeCallAndWait("interval.disableAndFinish", () => interval.disableAndFinish())));

      // We'll defer syncing usage until everything is calculated.
      const usageOptions = {syncUsageToDatabase: false, broadcastUsageToClients: false};

      // This cleanup requires docStorage, which may have failed to start up.
      // We don't want to log pointless errors in that case.
      if (this.docStorage.isInitialized()) {
        // Remove expired attachments, i.e. attachments that were soft deleted a while ago. This
        // needs to happen periodically, and doing it here means we can guarantee that it happens
        // even if the doc is only ever opened briefly, without having to slow down startup.
        await safeCallAndWait("removeUnusedAttachments", () => this.removeUnusedAttachments(true, usageOptions));

        if (this._dataEngine && this._fullyLoaded) {
          // Note that this must happen before `this._shuttingDown = true` because of this line in Sharing.ts:
          //     if (this._activeDoc.isShuttingDown && isCalculate) {
          await safeCallAndWait("removeTransformColumns",
            () => this.applyUserActions(docSession, [["RemoveTransformColumns"]])
          );
        }

        // Update data size; we'll be syncing both it and attachments size to the database soon.
        await safeCallAndWait("_updateDataSize", () => this._updateDataSize(usageOptions));
      }

      this._syncDocUsageToDatabase(true);
      this._logDocMetrics(docSession, 'docClose');

      await safeCallAndWait("storageManager.closeDocument",
        () => this._docManager.storageManager.closeDocument(this.docName));

      try {
        const dataEngine = this._dataEngine ? await this._getEngine() : null;
        this._shuttingDown = true;  // Block creation of engine if not yet in existence.
        if (dataEngine) {
          // Give a small grace period for finishing initialization if we are being shut
          // down while initialization is still in progress, and we don't have an easy
          // way yet to cancel it cleanly. This is mainly for the benefit of automated
          // tests.
          await timeoutReached(3000, this.waitForInitialization());
        }
        await Promise.all([
          this.docStorage.shutdown(),
          this.docPluginManager?.shutdown(),
          this._isSnapshot ? undefined : dataEngine?.shutdown(),
        ]);
        // The this.waitForInitialization promise may not yet have resolved, but
        // should do so quickly now we've killed everything it depends on.
        await safeCallAndWait("waitForInitialization", () => this.waitForInitialization());
      } catch (err) {
        this._log.error(docSession, "failed to shutdown some resources", err);
      }
      // No timeout on this callback: if it hangs, it will make the document unusable.
      await this._afterShutdownCallback?.();
    } finally {
      this._docManager.removeActiveDoc(this);
    }
    await safeCallAndWait("_granularAccess.close", () => this._granularAccess.close());
    this._log.debug(docSession, "shutdown complete");
  }

  private async _applyUserActionsWithExtendedOptions(docSession: OptDocSession, actions: UserAction[],
                                                     options?: ApplyUAExtendedOptions): Promise<ApplyUAResult> {
    assert(Array.isArray(actions), "`actions` parameter should be an array.");
    // Be careful not to sneak into user action queue before Calculate action, otherwise
    // there'll be a deadlock.
    await this.waitForInitialization();

    if (
      this.dataLimitStatus === "deleteOnly" &&
      !actions.every(action => [
          'RemoveTable', 'RemoveColumn', 'RemoveRecord', 'BulkRemoveRecord',
          'RemoveViewSection', 'RemoveView', 'ApplyUndoActions', 'RespondToRequests',
        ].includes(action[0] as string))
    ) {
      throw new Error("Document is in delete-only mode");
    }

    // Granular access control implemented in _applyUserActions.
    return await this._applyUserActions(docSession, actions, options);
  }

  /**
   * Create a new document file without using or initializing the data engine.
   */
  @ActiveDoc.keepDocOpen
  private async _createDocFile(docSession: OptDocSession, options?: {
    skipInitialTable?: boolean,  // If set, "Table1" will not be added.
    useExisting?: boolean,       // If set, an existing sqlite db is permitted.
                                 // Useful for "gristifying" an existing db.
  }): Promise<void> {
    this._log.debug(docSession, "createDoc");
    await this._docManager.storageManager.prepareToCreateDoc(this.docName);
    await this.docStorage.createFile(options);
    const sql = options?.skipInitialTable ? GRIST_DOC_SQL : GRIST_DOC_WITH_TABLE1_SQL;
    await this.docStorage.exec(sql);
    const timezone = docSession.browserSettings?.timezone ?? DEFAULT_TIMEZONE;
    const locale = docSession.browserSettings?.locale ?? DEFAULT_LOCALE;
    const documentSettings: DocumentSettings = { locale };
    const pythonVersion = process.env.PYTHON_VERSION_ON_CREATION;
    if (pythonVersion) {
      if (pythonVersion !== '2' && pythonVersion !== '3') {
        throw new Error(`PYTHON_VERSION_ON_CREATION must be 2 or 3, not: ${pythonVersion}`);
      }
      documentSettings.engine = (pythonVersion === '2') ? 'python2' : 'python3';
    }
    await this.docStorage.run('UPDATE _grist_DocInfo SET timezone = ?, documentSettings = ?',
                              timezone, JSON.stringify(documentSettings));
  }

  private _makeInfo(docSession: OptDocSession, options: ApplyUAOptions = {}) {
    const client = docSession.client;
    const user = docSession.mode === 'system' ? 'grist' :
      (client?.getProfile()?.email || '');
    return {
      time: Date.now(),
      user,
      inst: this._sharing.instanceId || "unset-inst",
      desc: options.desc,
      otherId: options.otherId || 0,
      linkId: options.linkId || 0,
    };
  }

  /**
   * Applies all metrics from `usage` to the current document usage state.
   *
   * Allows specifying `options` for toggling whether usage is synced to
   * the home database and/or broadcast to clients.
   */
  private async _updateDocUsage(usage: Partial<DocumentUsage>, options: UpdateUsageOptions = {}) {
    const {syncUsageToDatabase = true, broadcastUsageToClients = true} = options;
    const oldStatus = this.dataLimitStatus;
    this._docUsage = {...(this._docUsage || {}), ...usage};
    if (syncUsageToDatabase) {
      /* If status decreased, we'll update usage in the database with minimal delay, so site usage
       * banners show up-to-date statistics. If status increased or stayed the same, we'll schedule
       * a delayed update, since it's less critical for banners to update immediately. */
      const didStatusDecrease = getSeverity(this.dataLimitStatus) < getSeverity(oldStatus);
      this._syncDocUsageToDatabase(didStatusDecrease);
    }
    if (broadcastUsageToClients) {
      await this._broadcastDocUsageToClients();
    }
  }

  private _syncDocUsageToDatabase(minimizeDelay = false) {
    this._docManager.storageManager.scheduleUsageUpdate(this._docName, this._docUsage, minimizeDelay);
  }

  private async _broadcastDocUsageToClients() {
    if (this.muted || this.docClients.clientCount() === 0) { return; }

    await this.docClients.broadcastDocMessage(
      null,
      'docUsage',
      {docUsage: this.getDocUsageSummary(), product: this._product},
      async (session, data) => {
        return {...data, docUsage: await this.getFilteredDocUsageSummary(session)};
      },
    );
  }

  private async _updateGracePeriodStart(gracePeriodStart: Date | null) {
    this._gracePeriodStart = gracePeriodStart;
    if (!this._isForkOrSnapshot) {
      await this.getHomeDbManager()?.setDocGracePeriodStart(this.docName, gracePeriodStart);
    }
  }

  private async _checkDataLimitRatio() {
    const exceedingDataLimit = this.dataLimitRatio > 1;
    if (exceedingDataLimit && !this._gracePeriodStart) {
      await this._updateGracePeriodStart(new Date());
    } else if (!exceedingDataLimit && this._gracePeriodStart) {
      await this._updateGracePeriodStart(null);
    }
  }

  private async _checkDataSizeLimitRatio(docSession: OptDocSession | null) {
    const start = Date.now();
    if (!this.docStorage.isInitialized()) {
      return;
    }
    const dataSizeBytes = await this._updateDataSize();
    const timeToMeasure = Date.now() - start;
    log.rawInfo('Data size from dbstat...', {
      ...this.getLogMeta(docSession),
      dataSizeBytes,
      timeToMeasure,
    });
    await this._checkDataLimitRatio();
  }

  /**
   * Calculates the total data size in bytes, sets it in _docUsage, and returns it.
   *
   * Allows specifying `options` for toggling whether usage is synced to
   * the home database and/or broadcast to clients.
   */
  private async _updateDataSize(options?: UpdateUsageOptions): Promise<number> {
    const dataSizeBytes = await this.docStorage.getDataSize();
    await this._updateDocUsage({dataSizeBytes}, options);
    return dataSizeBytes;
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
    this._log.info(docSession, "addAttachment: file %s (image %sx%s) %s", fileIdent,
      dimensions.width, dimensions.height, ret ? "attached" : "already exists");
    return ['AddRecord', '_grist_Attachments', null, {
      fileIdent,
      fileName: fileData.origName,
      // We used to set fileType, but it's not easily available for native types. Since it's
      // also entirely unused, we just skip it until it becomes relevant.
      fileSize: fileData.size,
      fileExt: fileData.ext,
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
    const tableNames = await this.docStorage.getAllTableNames();

    // Fetch only metadata tables first, and try to migrate with only those.
    const tableData: {[key: string]: Buffer|null} = {};
    for (const tableName of tableNames) {
      if (tableName.startsWith('_grist_')) {
        tableData[tableName] = await this.docStorage.fetchTable(tableName);
      }
    }

    let docActions: DocAction[];
    try {
      // The last argument tells create_migrations() that only metadata is included.
      docActions = await this._rawPyCall('create_migrations', tableData, true);
    } catch (e) {
      if (!/need all tables/.test(e.message)) {
        throw e;
      }
      // If the migration failed because it needs all tables (i.e. involves changes to data), then
      // fetch them all. TODO: This is used for some older migrations, and is relied on by tests.
      // If a new migration needs this flag, more work is needed. The current approach creates
      // more memory pressure than usual since full data is present in memory at once both in node
      // and in Python; and it doesn't skip onDemand tables. This is liable to cause crashes.
      this._log.warn(docSession, "_migrate: retrying with all tables");
      for (const tableName of tableNames) {
        if (!tableData[tableName] && !tableName.startsWith('_gristsys_')) {
          tableData[tableName] = await this.docStorage.fetchTable(tableName);
        }
      }
      docActions = await this._rawPyCall('create_migrations', tableData);
    }

    const processedTables = Object.keys(tableData);
    const numSchema = countIf(processedTables, t => t.startsWith("_grist_"));
    const numUser = countIf(processedTables, t => !t.startsWith("_grist_"));
    this._log.info(docSession, "_migrate: applying %d migration actions (processed %s schema, %s user tables)",
      docActions.length, numSchema, numUser);

    docActions.forEach((action, i) => this._log.info(docSession, "_migrate: docAction %s: %s", i, shortDesc(action)));
    await this.docStorage.execTransaction(() => this.docStorage.applyStoredActions(docActions));
  }

  /**
   * Load the specified tables into the data engine.
   */
  private async _loadTables(docSession: OptDocSession, tableNames: string[]) {
    this._log.debug(docSession, "loading %s tables: %s", tableNames.length,
      tableNames.join(", "));
    // Pass the resulting array to `map`, which allows parallel processing of the tables. Database
    // and DataEngine may still do things serially, but it allows them to be busy simultaneously.
    await bluebird.map(tableNames, async (tableName: string) =>
      this._pyCall('load_table', tableName, await this._fetchTableIfPresent(tableName)),
      // How many tables to query for and push to the data engine in parallel.
      { concurrency: 3 });
    return this;
  }

  /**
   * Start loading the specified tables from the db, without waiting for completion.
   * The loader can be directed to stream the tables on to the engine.
   */
  private _startLoadingTables(docSession: OptDocSession, tableNames: string[]) {
    this._log.debug(docSession, "starting to load %s tables: %s", tableNames.length,
                  tableNames.join(", "));
    for (const tableId of tableNames) {
      this._tableMetadataLoader.startFetchingTable(tableId);
    }
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
  private async _finishInitialization(
    docSession: OptDocSession, pendingTableNames: string[], onDemandNames: string[], startTime: number
  ): Promise<void> {
    try {
      await this._tableMetadataLoader.wait();
      await this._tableMetadataLoader.clean();

      if (this._isSnapshot) {
        log.rawInfo("Loading complete", {
          ...this.getLogMeta(docSession),
          num_on_demand_tables: onDemandNames.length,
        });
      } else {
        await this._loadTables(docSession, pendingTableNames);
        const tableStats = await this._pyCall('get_table_stats');
        log.rawInfo("Loading complete, table statistics retrieved...", {
          ...this.getLogMeta(docSession),
          ...tableStats,
          num_on_demand_tables: onDemandNames.length,
        });
        await this._pyCall('initialize', this._options?.docUrl);

        // Calculations are not associated specifically with the user opening the document.
        // TODO: be careful with which users can create formulas.
        await this._applyUserActions(makeExceptionalDocSession('system'), [['Calculate']]);
        await this._reportDataEngineMemory();
      }

      this._fullyLoaded = true;
      const endTime = Date.now();
      const loadMs = endTime - startTime;
      // Adjust the inactivity timer: if the load took under 1 sec, use the regular timeout; if it
      // took longer, scale it up proportionately.
      const closeTimeout = Math.max(loadMs, 1000) * Deps.ACTIVEDOC_TIMEOUT;
      this._inactivityTimer.setDelay(closeTimeout);
      log.rawDebug('ActiveDoc load timing', {
        ...this.getLogMeta(docSession),
        loadMs,
        closeTimeout,
      });
      const docUsage = getDocSessionUsage(docSession);
      if (!docUsage) {
        // This looks be the first time this installation of Grist is touching
        // the document. If it has any shares, the home db needs to know.
        // TODO: could offer a UI to control whether shares are activated.
        await this.syncShares(docSession, { skipIfNoShares: true });
      }
      void this._initializeDocUsage(docSession);

      // Start the periodic work, unless this doc has already started shutting down.
      if (!this.muted) {
        for (const interval of this._intervals) {
          interval.enable();
        }
      }
    } catch (err) {
      this._fullyLoaded = true;
      if (!this._shuttingDown) {
        this._log.warn(docSession, "_finishInitialization stopped with %s", err);
        throw new Error('ActiveDoc initialization failed: ' + String(err));
      }
    }
  }

  private _logDocMetrics(docSession: OptDocSession, triggeredBy: 'docOpen' | 'interval'| 'docClose') {
    this.logTelemetryEvent(docSession, 'documentUsage', {
      limited: {
        triggeredBy,
        isPublic: ((this._doc as unknown) as APIDocument)?.public ?? false,
        rowCount: this._docUsage?.rowCount?.total,
        dataSizeBytes: this._docUsage?.dataSizeBytes,
        attachmentsSize: this._docUsage?.attachmentsSizeBytes,
        ...this._getAccessRuleMetrics(),
        ...this._getAttachmentMetrics(),
        ...this._getChartMetrics(),
        ...this._getWidgetMetrics(),
        ...this._getColumnMetrics(),
        ...this._getTableMetrics(),
        ...this._getCustomWidgetMetrics(),
      },
    });
  }

  private _getAccessRuleMetrics() {
    const accessRules = this.docData?.getMetaTable('_grist_ACLRules');
    const numAccessRules = accessRules?.numRecords() ?? 0;
    const numUserAttributes = accessRules?.getRecords().filter(r => r.userAttributes).length ?? 0;

    return {
      numAccessRules,
      numUserAttributes,
    };
  }

  private _getAttachmentMetrics() {
    const attachments = this.docData?.getMetaTable('_grist_Attachments');
    const numAttachments = attachments?.numRecords() ?? 0;
    const attachmentTypes = attachments?.getRecords()
      // Exclude the leading ".", if any.
      .map(r => r.fileExt?.trim()?.slice(1))
      .filter(ext => Boolean(ext));
    const uniqueAttachmentTypes = [...new Set(attachmentTypes ?? [])];
    return {
      numAttachments,
      attachmentTypes: uniqueAttachmentTypes,
    };
  }

  private _getChartMetrics() {
    const viewSections = this.docData?.getMetaTable('_grist_Views_section');
    const viewSectionRecords = viewSections?.getRecords() ?? [];
    const chartRecords = viewSectionRecords?.filter(r => r.parentKey === 'chart') ?? [];
    const chartTypes = chartRecords.map(r => r.chartType || 'bar');
    const numCharts = chartRecords.length;
    const numLinkedCharts = chartRecords.filter(r => r.linkSrcSectionRef).length;

    return {
      numCharts,
      chartTypes,
      numLinkedCharts,
    };
  }

  private _getWidgetMetrics() {
    const viewSections = this.docData?.getMetaTable('_grist_Views_section');
    const viewSectionRecords = viewSections?.getRecords() ?? [];
    const numLinkedWidgets = viewSectionRecords.filter(r => r.linkSrcSectionRef).length;

    return {
      numLinkedWidgets,
    };
  }

  private _getColumnMetrics() {
    const columns = this.docData?.getMetaTable('_grist_Tables_column');
    const columnRecords = columns?.getRecords().filter(r => !isHiddenCol(r.colId)) ?? [];
    const numColumns = columnRecords.length;
    const numColumnsWithConditionalFormatting = columnRecords.filter(r => r.rules).length;
    const numFormulaColumns = columnRecords.filter(r => r.isFormula && r.formula).length;
    const numTriggerFormulaColumns = columnRecords.filter(r => !r.isFormula && r.formula).length;

    const tables = this.docData?.getMetaTable('_grist_Tables');
    const tableRecords = tables?.getRecords().filter(r =>
      r.tableId && !r.tableId.startsWith('GristHidden_')) ?? [];
    const summaryTables = tableRecords.filter(r => r.summarySourceTable);
    const summaryTableIds = new Set([...summaryTables.map(t => t.id)]);
    const numSummaryFormulaColumns = columnRecords.filter(r =>
      r.isFormula && summaryTableIds.has(r.parentId)).length;

    const viewSectionFields = this.docData?.getMetaTable('_grist_Views_section_field');
    const viewSectionFieldRecords = viewSectionFields?.getRecords() ?? [];
    const numFieldsWithConditionalFormatting = viewSectionFieldRecords.filter(r => r.rules).length;

    return {
      numColumns,
      numColumnsWithConditionalFormatting,
      numFormulaColumns,
      numTriggerFormulaColumns,
      numSummaryFormulaColumns,
      numFieldsWithConditionalFormatting,
    };
  }

  private _getTableMetrics() {
    const tables = this.docData?.getMetaTable('_grist_Tables');
    const tableRecords = tables?.getRecords().filter(r =>
      r.tableId && !r.tableId.startsWith('GristHidden_')) ?? [];
    const numTables = tableRecords.length;
    const numOnDemandTables = tableRecords.filter(r => r.onDemand).length;

    const viewSections = this.docData?.getMetaTable('_grist_Views_section');
    const viewSectionRecords = viewSections?.getRecords() ?? [];
    const numTablesWithConditionalFormatting = viewSectionRecords.filter(r => r.rules).length;

    const summaryTables = tableRecords.filter(r => r.summarySourceTable);
    const numSummaryTables = summaryTables.length;

    return {
      numTables,
      numOnDemandTables,
      numTablesWithConditionalFormatting,
      numSummaryTables,
    };
  }

  private _getCustomWidgetMetrics() {
    const viewSections = this.docData?.getMetaTable('_grist_Views_section');
    const viewSectionRecords = viewSections?.getRecords() ?? [];
    const customWidgetIds: string[] = [];
    for (const r of viewSectionRecords) {
      const {customView} = safeJsonParse(r.options, {});
      if (!customView) { continue; }

      const {pluginId, url} = safeJsonParse(customView, {});
      if (!url) { continue; }

      const isGristLabsWidget = url.startsWith(commonUrls.gristLabsCustomWidgets);
      customWidgetIds.push(isGristLabsWidget ? pluginId : 'externalId');
    }
    const numCustomWidgets = customWidgetIds.length;

    return {
      numCustomWidgets,
      customWidgetIds,
    };
  }

  private async _fetchQueryFromDB(query: ServerQuery, onDemand: boolean): Promise<TableDataAction> {
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

  private async _fetchQueryFromDataEngine(query: ServerQuery): Promise<TableDataAction> {
    return this._pyCall('fetch_table', query.tableId, true, query.filters);
  }

  private async _reportDataEngineMemory() {
    const now = Date.now();
    if (now >= this._lastMemoryMeasurement + MEMORY_MEASUREMENT_INTERVAL_MS) {
      this._lastMemoryMeasurement = now;
      if (this._dataEngine && !this._shuttingDown) {
        const dataEngine = await this._getEngine();
        await dataEngine.reportMemoryUsage();
      }
    }
  }

  private async _initializeDocUsage(docSession: OptDocSession) {
    const promises: Promise<unknown>[] = [];
    // We'll defer syncing/broadcasting usage until everything is calculated.
    const options = {syncUsageToDatabase: false, broadcastUsageToClients: false};
    if (this._docUsage?.dataSizeBytes === undefined) {
      promises.push(this._updateDataSize(options));
    }
    if (this._docUsage?.attachmentsSizeBytes === undefined) {
      promises.push(this._updateAttachmentsSize(options));
    }
    if (promises.length === 0) {
      this._logDocMetrics(docSession, 'docOpen');
      return;
    }

    try {
      await Promise.all(promises);
      this._syncDocUsageToDatabase();
      await this._broadcastDocUsageToClients();
    } catch (e) {
      this._log.warn(docSession, 'failed to initialize doc usage', e);
    }

    this._logDocMetrics(docSession, 'docOpen');
  }

  private _getTelemetryMeta(docSession: OptDocSession|null): TelemetryMetadataByLevel {
    const altSessionId = docSession ? getDocSessionAltSessionId(docSession) : undefined;
    return merge(
      docSession ? getTelemetryMetaFromDocSession(docSession) : {},
      altSessionId ? {altSessionId} : {},
      {
        limited: {
          docIdDigest: this._docName,
        },
        full: {
          siteId: this._doc?.workspace.org.id,
          siteType: this._product?.name,
        },
      },
    );
  }

  /**
   * Called before a migration.  Makes sure a back-up is made.
   */
  private async _beforeMigration(docSession: OptDocSession, versionType: 'storage' | 'schema',
                                 currentVersion: number, newVersion: number) {
    this._migrating++;
    const label = `migrate-${versionType}-last-v${currentVersion}-before-v${newVersion}`;
    this._docManager.markAsChanged(this);  // Give backup current time.
    const location = await this._docManager.makeBackup(this, label);
    this._log.info(docSession, "_beforeMigration: backup made with label %s at %s", label, location);
    this.emit("backupMade", location);
  }

  /**
   * Called after a migration.
   */
  private async _afterMigration(docSession: OptDocSession, versionType: 'storage' | 'schema',
                                newVersion: number, success: boolean) {
    this._migrating--;
    // Mark as changed even if migration is not successful, out of caution.
    if (!this._migrating) { this._docManager.markAsChanged(this); }
  }

  /**
   * Call a method in the sandbox, without checking the _modificationLock.  Calls to
   * the sandbox are naturally serialized.
   */
  private async _rawPyCall(funcName: string, ...varArgs: unknown[]): Promise<any> {
    const dataEngine = await this._getEngine();
    try {
      return await dataEngine.pyCall(funcName, ...varArgs);
    } catch (e) {
      if (e instanceof UnavailableSandboxMethodError && this._isSnapshot) {
        throw new UnavailableSandboxMethodError('pyCall is not available in snapshots');
      }

      throw e;
    }
  }

  /**
   * Call a method in the sandbox, while checking on the _modificationLock.  If the
   * lock is held, the call will wait until the lock is released, and then hold
   * the lock itself while operating.
   */
  private _pyCall(funcName: string, ...varArgs: unknown[]): Promise<any> {
    return this._modificationLock.runExclusive(() => this._rawPyCall(funcName, ...varArgs));
  }

  private async _getEngine(): Promise<ISandbox> {
    if (this._shuttingDown) { throw new Error('shutting down, data engine unavailable'); }
    if (this._dataEngine) { return this._dataEngine; }

    this._dataEngine = this._isSnapshot ? this._makeNullEngine() : this._makeEngine();
    return this._dataEngine;
  }

  private async _makeEngine(): Promise<ISandbox> {
    // Figure out what kind of engine we need for this document.
    let preferredPythonVersion: '2' | '3' = process.env.PYTHON_VERSION === '3' ? '3' : '2';

    // Careful, migrations may not have run on this document and it may not have a
    // documentSettings column.  Failures are treated as lack of an engine preference.
    const docInfo = await this.docStorage.get('SELECT documentSettings FROM _grist_DocInfo').catch(e => undefined);
    const docSettingsString = docInfo?.documentSettings;
    if (docSettingsString) {
      const docSettings: DocumentSettings|undefined = safeJsonParse(docSettingsString, undefined);
      const engine = docSettings?.engine;
      if (engine) {
        if (engine === 'python2') {
          preferredPythonVersion = '2';
        } else if (engine === 'python3') {
          preferredPythonVersion = '3';
        } else {
          throw new Error(`engine type not recognized: ${engine}`);
        }
      }
    }
    return this._docManager.gristServer.create.NSandbox({
      comment: this._docName,
      logCalls: false,
      logTimes: true,
      logMeta: {docId: this._docName},
      preferredPythonVersion,
      sandboxOptions: {
        exports: {
          request: (key: string, args: SandboxRequest) => this._requests.handleSingleRequestWithCache(key, args),
          guessColInfo,
          convertFromColumn,
        }
      },
    });
  }

  private async _makeNullEngine(): Promise<ISandbox> {
    return new NullSandbox();
  }

  /**
   * Throw an error if the provided upload would exceed the total attachment filesize limit for this document.
   */
  private async _assertUploadSizeBelowLimit(upload: UploadInfo) {
    // Minor flaw: while we don't double-count existing duplicate files in the total size,
    // we don't check here if any of the uploaded files already exist and could be left out of the calculation.
    const uploadSizeBytes = sum(upload.files.map(f => f.size));
    if (await this._isUploadSizeBelowLimit(uploadSizeBytes)) { return; }

    // TODO probably want a nicer error message here.
    throw new LimitExceededError("Exceeded attachments limit for document");
  }

  /**
   * Returns true if an upload with size `uploadSizeBytes` won't cause attachment size
   * limits to be exceeded.
   */
  private async _isUploadSizeBelowLimit(uploadSizeBytes: number): Promise<boolean> {
    const maxSize = this._product?.features.baseMaxAttachmentsBytesPerDocument;
    if (!maxSize) { return true; }

    let currentSize = this._docUsage?.attachmentsSizeBytes;
    currentSize = currentSize ?? await this._updateAttachmentsSize({syncUsageToDatabase: false});
    return currentSize + uploadSizeBytes <= maxSize;
  }

  /**
   * Calculates the total attachments size in bytes, sets it in _docUsage, and returns it.
   *
   * Allows specifying `options` for toggling whether usage is synced to
   * the home database and/or broadcast to clients.
   */
  private async _updateAttachmentsSize(options?: UpdateUsageOptions): Promise<number> {
    const attachmentsSizeBytes = await this.docStorage.getTotalAttachmentFileSizes();
    await this._updateDocUsage({attachmentsSizeBytes}, options);
    return attachmentsSizeBytes;
  }

  private _getCachedAttachmentColumns(): AttachmentColumns {
    if (!this.docData) { return new Map(); }
    if (!this._attachmentColumns) {
      this._attachmentColumns = getAttachmentColumns(this.docData);
    }
    return this._attachmentColumns;
  }

  /**
   * Waits for the data engine to be ready before calling `cb`, creating the
   * engine if needed.
   *
   * Optionally shuts down and removes the engine after.
   *
   * NOTE: This method should be used with care, particularly when `shutdownAfter`
   * is set. Currently, it's only used to run migrations on snapshots (which don't
   * normally start the data engine).
   */
  private async _withDataEngine(
    cb: () => Promise<void>,
    options: {shutdownAfter?: boolean} = {}
  ) {
    const {shutdownAfter} = options;
    this._dataEngine = this._dataEngine || this._makeEngine();
    let engine = await this._dataEngine;
    if (engine instanceof NullSandbox) {
      // Make sure the current engine isn't a stub, which may be the case when the
      // document is a snapshot. Normally, `shutdownAfter` will be true in such
      // scenarios, so we'll revert back to using a stubbed engine after calling `cb`.
      this._dataEngine = this._makeEngine();
      engine = await this._dataEngine;
    }

    try {
      await cb();
    } finally {
      if (shutdownAfter) {
        await (await this._dataEngine)?.shutdown();
        this._dataEngine = null;
      }
    }
  }

  private async _onInactive() {
    if (Deps.ACTIVEDOC_TIMEOUT_ACTION === 'shutdown') {
      await this.shutdown();
    }
  }

  private _getHomeDbManagerOrFail() {
    const dbManager = this.getHomeDbManager();
    if (!dbManager) {
      throw new Error('HomeDbManager not available');
    }

    return dbManager;
  }

}

// Helper to initialize a sandbox action bundle with no values.
function createEmptySandboxActionBundle(): SandboxActionBundle {
  return {
    envelopes: [],
    stored: [],
    direct: [],
    calc: [],
    undo: [],
    retValues: [],
    rowCount: {total: 0},
  };
}

// Helper that converts a Grist table id to a ref.
export function tableIdToRef(metaTables: { [p: string]: TableDataAction }, tableId: string) {
  const [, , tableRefs, tableData] = metaTables._grist_Tables;
  const tableRowIndex = tableData.tableId.indexOf(tableId);
  if (tableRowIndex === -1) {
    throw new ApiError(`Table not found "${tableId}"`, 404);
  }
  return tableRefs[tableRowIndex];
}

// Helper that converts a Grist column colId to a ref given the corresponding table.
export function colIdToRef(metaTables: {[p: string]: TableDataAction}, tableId: string, colId: string) {
  const tableRef = tableIdToRef(metaTables, tableId);

  const [, , colRefs, columnData] = metaTables._grist_Tables_column;
  const colRowIndex = columnData.colId.findIndex((_, i) => (
    columnData.colId[i] === colId && columnData.parentId[i] === tableRef
  ));
  if (colRowIndex === -1) {
    throw new ApiError(`Column not found "${colId}"`, 404);
  }
  return colRefs[colRowIndex];
}

// Helper that check if tableRef is used instead of tableId and return real tableId
// If metaTables is not define, activeDoc and req allow it to be created
interface MetaTables {
  metaTables: { [p: string]: TableDataAction }
}
interface ActiveDocAndReq {
  activeDoc: ActiveDoc, req: RequestWithLogin
}
export async function getRealTableId(
  tableId: string,
  options:  MetaTables | ActiveDocAndReq
  ): Promise<string> {
  if (parseInt(tableId)) {
    const metaTables = "metaTables" in options
      ? options.metaTables
      : await getMetaTables(options.activeDoc, options.req);
    const [, , tableRefs, tableData] = metaTables._grist_Tables;
    if (tableRefs.indexOf(parseInt(tableId)) >= 0) {
      const tableRowIndex = tableRefs.indexOf(parseInt(tableId));
      return tableData.tableId[tableRowIndex]!.toString();
    }
  }
  return tableId;
}

export function sanitizeApplyUAOptions(options?: ApplyUAOptions): ApplyUAOptions {
  return pick(options||{}, ['desc', 'otherId', 'linkId', 'parseStrings']);
}
