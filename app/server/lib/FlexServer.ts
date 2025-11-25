import {ApiError} from 'app/common/ApiError';
import {ICustomWidget} from 'app/common/CustomWidget';
import {delay} from 'app/common/delay';
import {encodeUrl, getSlugIfNeeded, GristDeploymentType, GristDeploymentTypes,
        GristLoadConfig, IGristUrlState, isOrgInPathOnly, LatestVersionAvailable, parseSubdomain,
        sanitizePathTail} from 'app/common/gristUrls';
import {getOrgUrlInfo} from 'app/common/gristUrls';
import {isAffirmative} from 'app/common/gutil';
import {UserProfile} from 'app/common/LoginSessionAPI';
import {SandboxInfo} from 'app/common/SandboxInfo';
import {tbind} from 'app/common/tbind';
import * as version from 'app/common/version';
import {ApiServer, getOrgFromRequest} from 'app/gen-server/ApiServer';
import {Document} from 'app/gen-server/entity/Document';
import {Organization} from 'app/gen-server/entity/Organization';
import {User} from 'app/gen-server/entity/User';
import {Workspace} from 'app/gen-server/entity/Workspace';
import {ActivationsManager} from 'app/gen-server/lib/ActivationsManager';
import {DocApiForwarder} from 'app/gen-server/lib/DocApiForwarder';
import {getDocWorkerMap} from 'app/gen-server/lib/DocWorkerMap';
import {Doom} from 'app/gen-server/lib/Doom';
import {HomeDBManager, UserChange} from 'app/gen-server/lib/homedb/HomeDBManager';
import {Housekeeper} from 'app/gen-server/lib/Housekeeper';
import {Usage} from 'app/gen-server/lib/Usage';
import {AccessTokens, IAccessTokens} from 'app/server/lib/AccessTokens';
import {createSandbox} from 'app/server/lib/ActiveDoc';
import {attachAppEndpoint} from 'app/server/lib/AppEndpoint';
import {appSettings} from 'app/server/lib/AppSettings';
import {attachEarlyEndpoints} from 'app/server/lib/attachEarlyEndpoints';
import {
  AttachmentStoreProvider,
  checkAvailabilityAttachmentStoreOptions,
  getConfiguredAttachmentStoreConfigs,
  IAttachmentStoreProvider
} from 'app/server/lib/AttachmentStoreProvider';
import {addRequestUser, getUser, getUserId, isAnonymousUser,
        isSingleUserMode, redirectToLoginUnconditionally} from 'app/server/lib/Authorizer';
import {redirectToLogin, RequestWithLogin, signInStatusMiddleware} from 'app/server/lib/Authorizer';
import {forceSessionChange} from 'app/server/lib/BrowserSession';
import {Comm} from 'app/server/lib/Comm';
import {ConfigBackendAPI} from 'app/server/lib/ConfigBackendAPI';
import {IGristCoreConfig} from 'app/server/lib/configCore';
import {getAndClearSignupStateCookie} from 'app/server/lib/cookieUtils';
import {create} from 'app/server/lib/create';
import {createSavedDoc} from 'app/server/lib/createSavedDoc';
import {addDiscourseConnectEndpoints} from 'app/server/lib/DiscourseConnect';
import {addDocApiRoutes} from 'app/server/lib/DocApi';
import {DocManager} from 'app/server/lib/DocManager';
import {getSqliteMode} from 'app/server/lib/DocStorage';
import {DocWorker} from 'app/server/lib/DocWorker';
import {DocWorkerLoadTracker, getDocWorkerLoadTracker} from 'app/server/lib/DocWorkerLoadTracker';
import {DocWorkerInfo, IDocWorkerMap} from 'app/server/lib/DocWorkerMap';
import {expressWrap, jsonErrorHandler, secureJsonErrorHandler} from 'app/server/lib/expressWrap';
import {Hosts, RequestWithOrg} from 'app/server/lib/extractOrg';
import {addGoogleAuthEndpoint} from 'app/server/lib/GoogleAuth';
import {createGristJobs, GristJobs} from 'app/server/lib/GristJobs';
import {DocTemplate, GristLoginMiddleware, GristLoginSystem, GristServer,
  RequestWithGrist} from 'app/server/lib/GristServer';
import {initGristSessions, SessionStore} from 'app/server/lib/gristSessions';
import {IAssistant} from 'app/server/lib/IAssistant';
import {IAuditLogger} from 'app/server/lib/IAuditLogger';
import {IBilling} from 'app/server/lib/IBilling';
import {IDocNotificationManager} from 'app/server/lib/IDocNotificationManager';
import {IDocStorageManager} from 'app/server/lib/IDocStorageManager';
import {EmitNotifier, INotifier} from 'app/server/lib/INotifier';
import {InstallAdmin} from 'app/server/lib/InstallAdmin';
import log, {logAsJson} from 'app/server/lib/log';
import {disableCache, noop} from 'app/server/lib/middleware';
import {IPermitStore} from 'app/server/lib/Permit';
import {getAppPathTo, getAppRoot, getInstanceRoot, getUnpackedAppRoot} from 'app/server/lib/places';
import {addPluginEndpoints, limitToPlugins} from 'app/server/lib/PluginEndpoint';
import {PluginManager} from 'app/server/lib/PluginManager';
import { createPubSubManager, IPubSubManager } from 'app/server/lib/PubSubManager';
import {adaptServerUrl, getOrgUrl, getOriginUrl, getScope, integerParam, isParameterOn, optIntegerParam,
        optStringParam, RequestWithGristInfo, stringArrayParam, stringParam, TEST_HTTPS_OFFSET,
        trustOrigin} from 'app/server/lib/requestUtils';
import {buildScimRouter} from 'app/server/lib/scim';
import {ISendAppPageOptions, makeGristConfig, makeMessagePage, makeSendAppPage} from 'app/server/lib/sendAppPage';
import {getDatabaseUrl, listenPromise, timeoutReached} from 'app/server/lib/serverUtils';
import {Sessions} from 'app/server/lib/Sessions';
import * as shutdown from 'app/server/lib/shutdown';
import {TagChecker} from 'app/server/lib/TagChecker';
import {ITelemetry} from 'app/server/lib/Telemetry';
import {startTestingHooks} from 'app/server/lib/TestingHooks';
import {getTestLoginSystem} from 'app/server/lib/TestLogin';
import {UpdateManager} from 'app/server/lib/UpdateManager';
import {addUploadRoute} from 'app/server/lib/uploads';
import {buildWidgetRepository, getWidgetsInPlugins, IWidgetRepository} from 'app/server/lib/WidgetRepository';
import {setupLocale} from 'app/server/localization';
import axios from 'axios';
import express from 'express';
import * as fse from 'fs-extra';
import * as http from 'http';
import * as https from 'https';
import {i18n} from 'i18next';
import i18Middleware from 'i18next-http-middleware';
import mapValues = require('lodash/mapValues');
import pick = require('lodash/pick');
import morganLogger from 'morgan';
import {AddressInfo} from 'net';
import fetch from 'node-fetch';
import * as path from 'path';
import * as serveStatic from 'serve-static';

// Health checks are a little noisy in the logs, so we don't show them all.
// We show the first N health checks:
const HEALTH_CHECK_LOG_SHOW_FIRST_N = 10;
// And we show every Nth health check:
const HEALTH_CHECK_LOG_SHOW_EVERY_N = 100;

// DocID of Grist doc to collect the Welcome questionnaire responses, such
// as "GristNewUserInfo".
const DOC_ID_NEW_USER_INFO = process.env.DOC_ID_NEW_USER_INFO;

// PubSub channel we use to inform all servers when a new available Grist version is detected.
const latestVersionChannel = 'latestVersionAvailable';

export interface FlexServerOptions {
  dataDir?: string;

  // Base domain for org hostnames, starting with ".". Defaults to the base domain of APP_HOME_URL.
  baseDomain?: string;
  // Base URL for plugins, if permitted. Defaults to APP_UNTRUSTED_URL.
  pluginUrl?: string;

  // Global grist config options
  settings?: IGristCoreConfig;
}

export class FlexServer implements GristServer {
  public readonly create = create;
  public tagChecker: TagChecker;
  public app: express.Express;
  public deps: Set<string> = new Set();
  public appRoot: string;
  public host: string;
  public tag: string;
  public info = new Array<[string, any]>();
  public usage: Usage;
  public housekeeper: Housekeeper;
  public server: http.Server;
  public httpsServer?: https.Server;
  public settings?: IGristCoreConfig;
  public worker: DocWorkerInfo;
  public electronServerMethods: ElectronServerMethods;
  public readonly docsRoot: string;
  public readonly i18Instance: i18n;
  private _activations: ActivationsManager;
  private _comm: Comm;
  private _deploymentType: GristDeploymentType;
  private _dbManager: HomeDBManager;
  private _defaultBaseDomain: string|undefined;
  private _pluginUrl: string|undefined;
  private _pluginUrlReady: boolean = false;
  private _servesPlugins?: boolean;
  private _bundledWidgets?: ICustomWidget[];
  private _billing: IBilling;
  private _installAdmin: InstallAdmin;
  private _instanceRoot: string;
  private _attachmentStoreProvider: IAttachmentStoreProvider;
  private _docManager: DocManager;
  private _docWorker: DocWorker;
  private _hosts: Hosts;
  private _pluginManager: PluginManager;
  private _sessions: Sessions;
  private _sessionStore: SessionStore;
  private _storageManager: IDocStorageManager;
  private _auditLogger: IAuditLogger;
  private _telemetry: ITelemetry;
  private _processMonitorStop?: () => void;    // Callback to stop the ProcessMonitor
  private _docWorkerMap: IDocWorkerMap;
  private _docWorkerLoadTracker?: DocWorkerLoadTracker;
  private _widgetRepository: IWidgetRepository;
  private _docNotificationManager: IDocNotificationManager|undefined|false = false;
  private _pubSubManager: IPubSubManager = createPubSubManager(process.env.REDIS_URL);
  private _assistant?: IAssistant;
  private _accessTokens: IAccessTokens;
  private _internalPermitStore: IPermitStore;  // store for permits that stay within our servers
  private _externalPermitStore: IPermitStore;  // store for permits that pass through outside servers
  private _disabled: boolean = false;
  private _disableExternalStorage: boolean = false;
  private _healthy: boolean = true;  // becomes false if a serious error has occurred and
                                     // server cannot do its work.
  private _healthCheckCounter: number = 0;
  private _hasTestingHooks: boolean = false;
  private _loginMiddleware: GristLoginMiddleware;
  private _userIdMiddleware: express.RequestHandler;
  private _trustOriginsMiddleware: express.RequestHandler;
  private _docPermissionsMiddleware: express.RequestHandler;
  // This middleware redirects to signin/signup for anon, except on merged org or for
  // a team site that allows anon access.
  private _redirectToLoginWithExceptionsMiddleware: express.RequestHandler;
  // This unconditionally redirects to signin/signup for anon, for pages where anon access
  // is never desired.
  private _redirectToLoginWithoutExceptionsMiddleware: express.RequestHandler;
  // This can be called to do a redirect to signin/signup in a nuanced situation.
  private _redirectToLoginUnconditionally: express.RequestHandler | null;
  private _redirectToOrgMiddleware: express.RequestHandler;
  private _redirectToHostMiddleware: express.RequestHandler;
  private _getLoginRedirectUrl: (req: express.Request, target: URL) => Promise<string>;
  private _getSignUpRedirectUrl: (req: express.Request, target: URL) => Promise<string>;
  private _getLogoutRedirectUrl: (req: express.Request, nextUrl: URL) => Promise<string>;
  private _sendAppPage: (req: express.Request, resp: express.Response, options: ISendAppPageOptions) => Promise<void>;
  private _getLoginSystem: (dbManager: HomeDBManager) => Promise<GristLoginSystem>;
  // Set once ready() is called
  private _isReady: boolean = false;
  private _updateManager: UpdateManager;
  private _sandboxInfo: SandboxInfo;
  private _jobs?: GristJobs;
  private _emitNotifier: EmitNotifier = new EmitNotifier();
  private _latestVersionAvailable?: LatestVersionAvailable;

  constructor(public port: number, public name: string = 'flexServer',
              public readonly options: FlexServerOptions = {}) {
    this._getLoginSystem = create.getLoginSystem.bind(create);
    this.settings = options.settings;
    this.app = express();
    this.app.set('port', port);

    this.appRoot = getAppRoot();
    this.host = process.env.GRIST_HOST || "localhost";
    log.info(`== Grist version is ${version.version} (commit ${version.gitcommit})`);
    this.info.push(['appRoot', this.appRoot]);
    // Initialize locales files.
    this.i18Instance = setupLocale(this.appRoot);
    if (Array.isArray(this.i18Instance.options.preload)) {
      this.info.push(['i18:locale', this.i18Instance.options.preload.join(",")]);
    }
    if (Array.isArray(this.i18Instance.options.ns)) {
      this.info.push(['i18:namespace', this.i18Instance.options.ns.join(",")]);
    }
    // Add language detection middleware.
    this.app.use(i18Middleware.handle(this.i18Instance));
    // This directory hold Grist documents.
    let docsRoot = path.resolve((this.options && this.options.dataDir) ||
                                  process.env.GRIST_DATA_DIR ||
                                  getAppPathTo(this.appRoot, 'samples'));
    // In testing, it can be useful to separate out document roots used
    // by distinct FlexServers.
    if (process.env.GRIST_TEST_ADD_PORT_TO_DOCS_ROOT === 'true') {
      docsRoot = path.resolve(docsRoot, String(port));
    }
    // Create directory if it doesn't exist.
    // TODO: track down all dependencies on 'samples' existing in tests and
    // in dev environment, and remove them.  Then it would probably be best
    // to simply fail if the docs root directory does not exist.
    fse.mkdirpSync(docsRoot);
    this.docsRoot = fse.realpathSync(docsRoot);
    this.info.push(['docsRoot', this.docsRoot]);

    this._deploymentType = this.create.deploymentType();
    if (process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE) {
      this._deploymentType = GristDeploymentTypes.check(process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE);
    }

    const homeUrl = process.env.APP_HOME_URL;
    // The "base domain" is only a thing if orgs are encoded as a subdomain.
    if (process.env.GRIST_ORG_IN_PATH === 'true' || process.env.GRIST_SINGLE_ORG) {
      this._defaultBaseDomain = options.baseDomain || (homeUrl && new URL(homeUrl).hostname);
    } else {
      this._defaultBaseDomain = options.baseDomain || (homeUrl && parseSubdomain(new URL(homeUrl).hostname).base);
    }
    this.info.push(['defaultBaseDomain', this._defaultBaseDomain]);
    this._pluginUrl = options.pluginUrl || process.env.APP_UNTRUSTED_URL;

    // We don't bother unsubscribing because that's automatic when we close this._pubSubManager.
    void this.getPubSubManager().subscribe(latestVersionChannel, (message) => {
      const latestVersionAvailable: LatestVersionAvailable = JSON.parse(message);
      log.debug('FlexServer: setting latest version', latestVersionAvailable);
      this.setLatestVersionAvailable(latestVersionAvailable);
    });

    // The electron build is not supported at this time, but this stub
    // implementation of electronServerMethods is present to allow kicking
    // its tires.
    let userConfig: any = {
      recentItems: [],
    };
    this.electronServerMethods = {
      onDocOpen(cb) {
        // currently only a stub.
        cb('');
      },
      async getUserConfig() {
        return userConfig;
      },
      async updateUserConfig(obj: any) {
        userConfig = obj;
      },
      onBackupMade() {
        log.info('backup skipped');
      }
    };

    this.app.use((req, res, next) => {
      (req as RequestWithGrist).gristServer = this;
      next();
    });
  }

  public getHost(): string {
    return `${this.host}:${this.getOwnPort()}`;
  }

  // Get a url for this server, based on the protocol it speaks (http), the host it
  // runs on, and the port it listens on.  The url the client uses to communicate with
  // the server may be different if there are intermediaries (such as a load-balancer
  // terminating TLS).
  public getOwnUrl(): string {
    const port = this.getOwnPort();
    return `http://${this.host}:${port}`;
  }

  /**
   * Get a url for the home server api.  Called without knowledge of a specific
   * request, so will default to a generic url.  Use of this method can render
   * code incompatible with custom base domains (currently, sendgrid notifications
   * via Notifier are incompatible for this reason).
   */
  public getDefaultHomeUrl(): string {
    const homeUrl = process.env.APP_HOME_URL || (this._has('api') && this.getOwnUrl());
    if (!homeUrl) { throw new Error("need APP_HOME_URL"); }
    return homeUrl;
  }

  /**
   * Same as getDefaultHomeUrl, but for internal use.
   */
  public getDefaultHomeInternalUrl(): string {
    return process.env.APP_HOME_INTERNAL_URL || this.getDefaultHomeUrl();
  }

  /**
   * Get a url for the home server api, adapting it to match the base domain in the
   * requested url.  This adaptation is important for cookie-based authentication.
   *
   * If relPath is given, returns that path relative to homeUrl. If omitted, note that
   * getHomeUrl() will still return a URL ending in "/".
   */
  public getHomeUrl(req: express.Request, relPath: string = ''): string {
    // Get the default home url.
    const homeUrl = new URL(relPath, this.getDefaultHomeUrl());
    adaptServerUrl(homeUrl, req as RequestWithOrg);
    return homeUrl.href;
  }

  /**
   * Same as getHomeUrl, but for requesting internally.
   */
  public getHomeInternalUrl(relPath: string = ''): string {
    const homeUrl = new URL(relPath, this.getDefaultHomeInternalUrl());
    return homeUrl.href;
  }

  /**
   * Get a home url that is appropriate for the given document.  For now, this
   * returns a default that works for all documents.  That could change in future,
   * specifically with custom domains (perhaps we might limit which docs can be accessed
   * based on domain).
   */
  public async getHomeUrlByDocId(docId: string, relPath: string = ''): Promise<string> {
    return new URL(relPath, this.getDefaultHomeInternalUrl()).href;
  }

  // Get the port number the server listens on.  This may be different from the port
  // number the client expects when communicating with the server if there are intermediaries.
  public getOwnPort(): number {
    // Get the port from the server in case it was started with port 0.
    return this.server ? (this.server.address() as AddressInfo).port : this.port;
  }

  /**
   * Get interface to job queues.
   */
  public getJobs(): GristJobs {
    return this._jobs || (this._jobs = createGristJobs());
  }

  /**
   * Get a url to an org that should be accessible by all signed-in users. For now, this
   * returns the base URL of the personal org (typically docs[-s]).
   */
  public getMergedOrgUrl(req: RequestWithLogin, pathname: string = '/'): string {
    return this._getOrgRedirectUrl(req, this._dbManager.mergedOrgDomain(), pathname);
  }

  public getPermitStore(): IPermitStore {
    if (!this._internalPermitStore) { throw new Error('no permit store available'); }
    return this._internalPermitStore;
  }

  public getExternalPermitStore(): IPermitStore {
    if (!this._externalPermitStore) { throw new Error('no permit store available'); }
    return this._externalPermitStore;
  }

  public getSessions(): Sessions {
    if (!this._sessions) { throw new Error('no sessions available'); }
    return this._sessions;
  }

  public getComm(): Comm {
    if (!this._comm) { throw new Error('no Comm available'); }
    return this._comm;
  }

  public getDeploymentType(): GristDeploymentType {
    return this._deploymentType;
  }

  public getHosts(): Hosts {
    if (!this._hosts) { throw new Error('no hosts available'); }
    return this._hosts;
  }

  public getActivations(): ActivationsManager {
    if (!this._activations) { throw new Error('no activations available'); }
    return this._activations;
  }

  public getHomeDBManager(): HomeDBManager {
    if (!this._dbManager) { throw new Error('no home db available'); }
    return this._dbManager;
  }

  public getStorageManager(): IDocStorageManager {
    if (!this._storageManager) { throw new Error('no storage manager available'); }
    return this._storageManager;
  }

  public getAuditLogger(): IAuditLogger {
    if (!this._auditLogger) { throw new Error('no audit logger available'); }
    return this._auditLogger;
  }

  public getDocManager(): DocManager {
    if (!this._docManager) { throw new Error('no document manager available'); }
    return this._docManager;
  }

  public getTelemetry(): ITelemetry {
    if (!this._telemetry) { throw new Error('no telemetry available'); }
    return this._telemetry;
  }

  public getWidgetRepository(): IWidgetRepository {
    if (!this._widgetRepository) { throw new Error('no widget repository available'); }
    return this._widgetRepository;
  }

  public hasNotifier(): boolean {
    return !this._emitNotifier.isEmpty();
  }

  public getNotifier(): INotifier {
    // We only warn if we are in a server that doesn't configure notifiers (i.e. not a home
    // server). But actually having a working notifier isn't required.
    if (!this._has('notifier')) { throw new Error('no notifier available'); }
    // Expose a wrapper around it that emits actions.
    return this._emitNotifier;
  }

  public getDocNotificationManager(): IDocNotificationManager|undefined {
    if (this._docNotificationManager === false) {
      // The special value of 'false' is used to create only on first call. Afterwards,
      // the value may be undefined, but no longer false.
      this._docNotificationManager = this.create.createDocNotificationManager(this);
    }
    return this._docNotificationManager;
  }

  public getPubSubManager(): IPubSubManager {
    return this._pubSubManager;
  }

  public getAssistant(): IAssistant | undefined {
    return this._assistant;
  }

  public getInstallAdmin(): InstallAdmin {
    if (!this._installAdmin) { throw new Error('no InstallAdmin available'); }
    return this._installAdmin;
  }

  public getAccessTokens() {
    if (this._accessTokens) { return this._accessTokens; }
    this.addDocWorkerMap();
    const cli = this._docWorkerMap.getRedisClient();
    this._accessTokens = new AccessTokens(cli);
    return this._accessTokens;
  }

  public getUpdateManager() {
    if (!this._updateManager) { throw new Error('no UpdateManager available'); }
    return this._updateManager;
  }

  public getBilling(): IBilling {
    if (!this._billing) {
      if (!this._dbManager) { throw new Error("need dbManager"); }
      this._billing = this.create.Billing(this._dbManager, this);
    }
    return this._billing;
  }

  public sendAppPage(req: express.Request, resp: express.Response, options: ISendAppPageOptions): Promise<void> {
    if (!this._sendAppPage) { throw new Error('no _sendAppPage method available'); }
    return this._sendAppPage(req, resp, options);
  }

  public addLogging() {
    if (this._check('logging')) { return; }
    if (!this._httpLoggingEnabled()) { return; }
    // Add a timestamp token that matches exactly the formatting of non-morgan logs.
    morganLogger.token('logTime', (req: Request) => log.timestamp());
    // Add an optional gristInfo token that can replace the url, if the url is sensitive.
    morganLogger.token('gristInfo', (req: RequestWithGristInfo) =>
                       req.gristInfo || req.originalUrl || req.url);
    morganLogger.token('host', (req: express.Request) => req.get('host'));
    morganLogger.token('body', (req: express.Request) =>
      req.is('application/json') ? JSON.stringify(req.body) : undefined
    );

    // For debugging, be careful not to enable logging in production (may log sensitive data)
    const shouldLogBody = isAffirmative(process.env.GRIST_LOG_HTTP_BODY);

    const msg = `:logTime :host :method :gristInfo ${shouldLogBody ? ':body ' : ''}` +
      ":status :response-time ms - :res[content-length]";
    // In hosted Grist, render json so logs retain more organization.
    function outputJson(tokens: any, req: any, res: any) {
      return JSON.stringify({
        timestamp: tokens.logTime(req, res),
        host: tokens.host(req, res),
        method: tokens.method(req, res),
        path: tokens.gristInfo(req, res),
        ...(shouldLogBody ? { body: tokens.body(req, res) } : {}),
        status: tokens.status(req, res),
        timeMs: parseFloat(tokens['response-time'](req, res)) || undefined,
        contentLength: parseInt(tokens.res(req, res, 'content-length'), 10) || undefined,
        altSessionId: req.altSessionId,
      });
    }
    this.app.use(morganLogger(logAsJson ? outputJson : msg, {
      skip: this._shouldSkipRequestLogging.bind(this)
    }));
  }

  public addHealthCheck() {
    if (this._check('health')) { return; }
    // Health check endpoint. if called with /hooks, testing hooks are required in order to be
    // considered healthy.  Testing hooks are used only in server started for tests, and
    // /status/hooks allows the tests to wait for them to be ready.
    // If db=1 query parameter is included, status will include the status of DB connection.
    // If redis=1 query parameter is included, status will include the status of the Redis connection.
    // If docWorkerRegistered=1 query parameter is included, status will include the status of the
    // doc worker registration in Redis.
    this.app.get('/status(/hooks)?', async (req, res) => {
      const checks = new Map<string, Promise<boolean>|boolean>();
      const timeout = optIntegerParam(req.query.timeout, 'timeout') || 10_000;

      // Check that the given promise resolves with no error within our timeout.
      const asyncCheck = async (promise: Promise<unknown>|undefined) => {
        if (!promise || await timeoutReached(timeout, promise) === true) {
          return false;
        }
        return promise.then(() => true, () => false);     // Success => true, rejection => false
      };

      if (req.path.endsWith('/hooks')) {
        checks.set('hooks', this._hasTestingHooks);
      }
      if (isParameterOn(req.query.db)) {
        checks.set('db', asyncCheck(this._dbManager.connection.query('SELECT 1')));
      }
      if (isParameterOn(req.query.redis)) {
        checks.set('redis', asyncCheck(this._docWorkerMap.getRedisClient()?.pingAsync()));
      }
      if (isParameterOn(req.query.docWorkerRegistered) && this.worker) {
        // Only check whether the doc worker is registered if we have a worker.
        // The Redis client may not be connected, but in this case this has to
        // be checked with the 'redis' parameter (the user may want to avoid
        // removing workers when connection is unstable).
        if (this._docWorkerMap.getRedisClient()?.connected) {
          checks.set('docWorkerRegistered', asyncCheck(
            this._docWorkerMap.isWorkerRegistered(this.worker).then(isRegistered => {
              if (!isRegistered) { throw new Error('doc worker not registered'); }
              return isRegistered;
            })
          ));
        }
      }
      if (isParameterOn(req.query.ready)) {
        checks.set('ready', this._isReady);
      }
      let extra = '';
      let ok = true;
      let statuses: string[] = [];
      // If we had any extra check, collect their status to report them.
      if (checks.size > 0) {
        const results = await Promise.all(checks.values());
        ok = ok && results.every(r => r === true);
        statuses = Array.from(checks.keys(), (key, i) => `${key} ${results[i] ? 'ok' : 'not ok'}`);
        extra = ` (${statuses.join(", ")})`;
      }

      const overallOk = ok && this._healthy;

      if ((this._healthCheckCounter % 100) === 0 || !overallOk) {
        log.rawDebug(`Healthcheck result`, {
          host: req.get('host'),
          path: req.path,
          query: req.query,
          ok,
          statuses,
          healthy: this._healthy,
          overallOk,
          previousSuccessfulChecks: this._healthCheckCounter
        });
      }

      if (overallOk) {
        this._healthCheckCounter++;
        res.status(200).send(`Grist ${this.name} is alive${extra}.`);
      } else {
        this._healthCheckCounter = 0;  // reset counter if we ever go internally unhealthy.
        res.status(500).send(`Grist ${this.name} is unhealthy${extra}.`);
      }
    });
  }

  /**
   *
   * Adds a /boot/$GRIST_BOOT_KEY page that shows diagnostics.
   * Accepts any /boot/... URL in order to let the front end
   * give some guidance if the user is stumbling around trying
   * to find the boot page, but won't actually provide diagnostics
   * unless GRIST_BOOT_KEY is set in the environment, and is present
   * in the URL.
   *
   * We take some steps to make the boot page available even when
   * things are going wrong, and should take more in future.
   *
   * When rendering the page a hardcoded 'boot' tag is used, which
   * is used to ensure that static assets are served locally and
   * we aren't relying on APP_STATIC_URL being set correctly.
   *
   * We use a boot key so that it is more acceptable to have this
   * boot page living outside of the authentication system, which
   * could be broken.
   *
   * TODO: there are some configuration problems that currently
   * result in Grist not running at all. ideally they would result in
   * Grist running in a limited mode that is enough to bring up the boot
   * page.
   *
   */
  public addBootPage() {
    if (this._check('boot')) { return; }
    this.app.get('/boot(/*)?', async (req, res) => {
      // Doing a good redirect is actually pretty subtle and we might
      // get it wrong, so just say /boot got moved.
      res.send('The /boot/KEY page is now /admin?boot-key=KEY');
    });
  }

  public getBootKey(): string|undefined {
    return appSettings.section('boot').flag('key').readString({
      envVar: 'GRIST_BOOT_KEY'
    });
  }

  public denyRequestsIfNotReady() {
    this.app.use((_req, res, next) => {
      if (!this._isReady) {
        // If ready() hasn't been called yet, don't continue, and
        // give a clear error. This is to avoid exposing the service
        // in a partially configured form.
        return res.status(503).json({error: 'Service unavailable during start up'});
      }
      next();
    });
  }

  public testAddRouter() {
    if (this._check('router')) { return; }
    this.app.get('/test/router', (req, res) => {
      const act = optStringParam(req.query.act, 'act') || 'none';
      const port = stringParam(req.query.port, 'port');  // port is trusted in mock; in prod it is not.
      if (act === 'add' || act === 'remove') {
        const host = `localhost:${port}`;
        return res.status(200).json({
          act,
          host,
          url: `http://${host}`,
          message: 'ok',
        });
      }
      return res.status(500).json({error: 'unrecognized action'});
    });
  }

  public addCleanup() {
    if (this._check('cleanup')) { return; }
    // Set up signal handlers. Note that nodemon sends SIGUSR2 to restart node.
    shutdown.cleanupOnSignals('SIGINT', 'SIGTERM', 'SIGHUP', 'SIGUSR2');

    // We listen for uncaughtExceptions / unhandledRejections, but do exit when they happen. It is
    // a strong recommendation, which seems best to follow
    // (https://nodejs.org/docs/latest-v18.x/api/process.html#warning-using-uncaughtexception-correctly).
    // We do try to shutdown cleanly (i.e. do any planned cleanup), which goes somewhat against
    // the recommendation to do only synchronous work.

    let counter = 0;

    // Note that this event catches also 'unhandledRejection' (origin should be either
    // 'uncaughtException' or 'unhandledRejection').
    process.on('uncaughtException', (err, origin) => {
      log.error(`UNHANDLED ERROR ${origin} (${counter}):`, err);
      if (counter === 0) {
        // Only call shutdown once. It's async and could in theory fail, in which case it would be
        // another unhandledRejection, and would get caught and reported by this same handler.
        void(shutdown.exit(1));
      }
      counter++;
    });
  }

  public addTagChecker() {
    if (this._check('tag', '!org')) { return; }
    // Handle requests that start with /v/TAG/ and set .tag property on them.
    this.tag = version.gitcommit;
    this.info.push(['tag', this.tag]);
    this.tagChecker = new TagChecker(this.tag);
    this.app.use(this.tagChecker.inspectTag);
  }

  /**
   * To allow routing to doc workers via the path, doc workers remove any
   * path prefix of the form /dw/...../ if present.  The prefix is not checked,
   * just removed unconditionally.
   * TODO: determine what the prefix should be, and check it, to catch bugs.
   */
  public stripDocWorkerIdPathPrefixIfPresent() {
    if (this._check('strip_dw', '!tag', '!org')) { return; }
    this.app.use((req, resp, next) => {
      const match = req.url.match(/^\/dw\/([-a-zA-Z0-9]+)([/?].*)?$/);
      if (match) { req.url = sanitizePathTail(match[2]); }
      next();
    });
  }

  public addOrg() {
    if (this._check('org', 'homedb', 'hosts')) { return; }
    this.app.use(this._hosts.extractOrg);
  }

  public setDirectory() {
    if (this._check('dir')) { return; }
    process.chdir(getUnpackedAppRoot(this.appRoot));
  }

  public get instanceRoot() {
    if (!this._instanceRoot) {
      this._instanceRoot = getInstanceRoot();
      this.info.push(['instanceRoot', this._instanceRoot]);
    }
    return this._instanceRoot;
  }

  public addStaticAndBowerDirectories() {
    if (this._check('static_and_bower', 'dir')) { return; }
    this.addTagChecker();
    // Grist has static help files, which may be useful for standalone app,
    // but for hosted grist the latest help is at support.getgrist.com.  Redirect
    // to this page for the benefit of crawlers which currently rank the static help
    // page link highly for historic reasons.
    this.app.use(/^\/help\//, expressWrap(async (req, res) => {
      res.redirect('https://support.getgrist.com');
    }));
    // If there is a directory called "static_ext", serve material from there
    // as well. This isn't used in grist-core but is handy for extensions such
    // as an Electron app.
    const staticExtDir = getAppPathTo(this.appRoot, 'static') + '_ext';
    const staticExtApp = fse.existsSync(staticExtDir) ?
      express.static(staticExtDir, serveAnyOrigin) : null;
    const staticApp = express.static(getAppPathTo(this.appRoot, 'static'), serveAnyOrigin);
    const bowerApp = express.static(getAppPathTo(this.appRoot, 'bower_components'), serveAnyOrigin);
    if (process.env.GRIST_LOCALES_DIR) {
      const locales = express.static(process.env.GRIST_LOCALES_DIR, serveAnyOrigin);
      this.app.use("/locales", this.tagChecker.withTag(locales));
    }
    if (staticExtApp) { this.app.use(this.tagChecker.withTag(staticExtApp)); }
    this.app.use(this.tagChecker.withTag(staticApp));
    this.app.use(this.tagChecker.withTag(bowerApp));
  }

  // Some tests rely on testFOO.html files being served.
  public addAssetsForTests() {
    if (this._check('testAssets', 'dir')) { return; }
    // Serve test[a-z]*.html for test purposes.
    this.app.use(/^\/(test[a-z]*.html)$/i, expressWrap(async (req, res) =>
      res.sendFile(req.params[0], {root: getAppPathTo(this.appRoot, 'static')})));
  }

  // Plugin operation relies currently on grist-plugin-api.js being available,
  // and with Grist's static assets to be also available on the untrusted
  // host.  The assets should be available without version tags, but not
  // at the root level - we nest them in /plugins/assets.
  public async addAssetsForPlugins() {
    if (this._check('pluginUntaggedAssets', 'dir')) { return; }
    this.app.use(/^\/(grist-plugin-api.js)$/, expressWrap(async (req, res) =>
      res.sendFile(req.params[0], {root: getAppPathTo(this.appRoot, 'static')})));
    // Plugins get access to static resources without a tag
    this.app.use(
      '/plugins/assets',
      limitToPlugins(this, express.static(getAppPathTo(this.appRoot, 'static'))));
    this.app.use(
      '/plugins/assets',
      limitToPlugins(this, express.static(getAppPathTo(this.appRoot, 'bower_components'))));
    // Serve custom-widget.html message for anyone.
    this.app.use(/^\/(custom-widget.html)$/, expressWrap(async (req, res) =>
      res.sendFile(req.params[0], {root: getAppPathTo(this.appRoot, 'static')})));
    this.addOrg();
    addPluginEndpoints(this, await this._addPluginManager());

    // Serve bundled custom widgets on the plugin endpoint.
    const places = getWidgetsInPlugins(this, '');
    if (places.length > 0) {
      // For all widgets served in place, replace any copies of
      // grist-plugin-api.js with this app's version of it.
      // This is perhaps a bit rude, but beats the alternative
      // of either using inconsistent bundled versions, or
      // requiring network access.
      this.app.use(/^\/widgets\/.*\/(grist-plugin-api.js)$/, expressWrap(async (req, res) =>
          res.sendFile(req.params[0], {root: getAppPathTo(this.appRoot, 'static')})));
    }
    for (const place of places) {
      this.app.use(
        '/widgets/' + place.pluginId, this.tagChecker.withTag(
          limitToPlugins(this, express.static(place.dir, serveAnyOrigin))
         )
       );
    }
  }

  // Prepare cache for managing org-to-host relationship.
  public addHosts() {
    if (this._check('hosts', 'homedb')) { return; }
    this._hosts = new Hosts(this._defaultBaseDomain, this._dbManager, this);
  }

  /**
   * Delete all the storage related to a document, across the file system,
   * external storage, and the home database. Since a doc worker may have
   * the document open, this is done via the API.
   */
  public async hardDeleteDoc(docId: string) {
    if (!this._internalPermitStore) {
      throw new Error('permit store not available');
    }
    // In general, documents can only be manipulated with the coordination of the
    // document worker to which they are assigned.
    const permitKey = await this._internalPermitStore.setPermit({docId});
    try {
      const result = await fetch(await this.getHomeUrlByDocId(docId, `/api/docs/${docId}`), {
        method: 'DELETE',
        headers: {
          Permit: permitKey
        }
      });
      if (result.status !== 200) {
        throw new ApiError((await result.json()).error, result.status);
      }
    } finally {
      await this._internalPermitStore.removePermit(permitKey);
    }
  }

  public async initHomeDBManager() {
    if (this._check('homedb')) { return; }
    this._dbManager = new HomeDBManager(this, this._emitNotifier, this._pubSubManager);
    this._dbManager.setPrefix(process.env.GRIST_ID_PREFIX || "");
    await this._dbManager.connect();
    await this._dbManager.initializeSpecialIds();
    // Report which database we are using, without sensitive credentials.
    this.info.push(['database', getDatabaseUrl(this._dbManager.connection.options, false)]);
    // If the installation appears to be new, give it an id and a creation date.
    this._activations = new ActivationsManager(this._dbManager);
    await this._activations.current();
    this._installAdmin = await this.create.createInstallAdmin(this._dbManager);
  }

  public addDocWorkerMap() {
    if (this._check('map')) { return; }
    this._docWorkerMap = getDocWorkerMap();
    this._internalPermitStore = this._docWorkerMap.getPermitStore('internal');
    this._externalPermitStore = this._docWorkerMap.getPermitStore('external');
  }

  // Set up the main express middleware used.  For a single user setup, without logins,
  // all this middleware is currently a no-op.
  public addAccessMiddleware() {
    if (this._check('middleware', 'map', 'loginMiddleware', isSingleUserMode() ? null : 'hosts')) { return; }

    if (!isSingleUserMode()) {
      const skipSession = appSettings.section('login').flag('skipSession').readBool({
        envVar: 'GRIST_IGNORE_SESSION',
      });
      // Middleware to redirect landing pages to preferred host
      this._redirectToHostMiddleware = this._hosts.redirectHost;
      // Middleware to add the userId to the express request object.
      this._userIdMiddleware = expressWrap(addRequestUser.bind(
        null, this._dbManager, this._internalPermitStore,
        {
          overrideProfile: this._loginMiddleware.overrideProfile?.bind(this._loginMiddleware),
            // Set this to false to stop Grist using a cookie for authentication purposes.
          skipSession,
          gristServer: this,
        }
      ));
      this._trustOriginsMiddleware = expressWrap(trustOriginHandler);
      // middleware to authorize doc access to the app. Note that this requires the userId
      // to be set on the request by _userIdMiddleware.
      this._docPermissionsMiddleware = expressWrap((...args) => this._docWorker.assertDocAccess(...args));
      this._redirectToLoginWithExceptionsMiddleware = redirectToLogin(true,
                                                                      this._getLoginRedirectUrl,
                                                                      this._getSignUpRedirectUrl,
                                                                      this._dbManager);
      this._redirectToLoginWithoutExceptionsMiddleware = redirectToLogin(false,
                                                                         this._getLoginRedirectUrl,
                                                                         this._getSignUpRedirectUrl,
                                                                         this._dbManager);
      this._redirectToLoginUnconditionally = redirectToLoginUnconditionally(this._getLoginRedirectUrl,
                                                                            this._getSignUpRedirectUrl);
      this._redirectToOrgMiddleware = tbind(this._redirectToOrg, this);
    } else {
      this._userIdMiddleware = noop;
      this._trustOriginsMiddleware = noop;
      // For standalone single-user Grist, documents are stored on-disk
      // with their filename equal to the document title, no document
      // aliases are possible, and there is no access control.
      // The _docPermissionsMiddleware is a no-op.
      // TODO We might no longer have any tests for isSingleUserMode, or modes of operation.
      this._docPermissionsMiddleware = noop;
      this._redirectToLoginWithExceptionsMiddleware = noop;
      this._redirectToLoginWithoutExceptionsMiddleware = noop;
      this._redirectToLoginUnconditionally = null;  // there is no way to log in.
      this._redirectToOrgMiddleware = noop;
      this._redirectToHostMiddleware = noop;
    }
  }

  /**
   * Add middleware common to all API endpoints (including forwarding ones).
   */
  public addApiMiddleware() {
    if (this._check('api-mw', 'middleware')) { return; }
    // API endpoints need req.userId and need to support requests from different subdomains.
    this.app.use("/api", this._userIdMiddleware);
    this.app.use("/api", this._trustOriginsMiddleware);
    this.app.use("/api", disableCache);
  }

  /**
   * Add error-handling middleware common to all API endpoints.
   */
  public addApiErrorHandlers() {
    if (this._check('api-error', 'api-mw')) { return; }

    // add a final not-found handler for api
    this.app.use("/api", (req, res) => {
      res.status(404).send({error: `not found: ${req.originalUrl}`});
    });

    // Add a final error handler for /api endpoints that reports errors as JSON.
    this.app.use('/api/auth', secureJsonErrorHandler);
    this.app.use('/api', jsonErrorHandler);
  }

  public addWidgetRepository() {
    if (this._check('widgets')) { return; }

    this._widgetRepository = buildWidgetRepository(this);
  }

  public addHomeApi() {
    if (this._check('api', 'homedb', 'json', 'api-mw')) { return; }

    // ApiServer's constructor adds endpoints to the app.
    // tslint:disable-next-line:no-unused-expression
    new ApiServer(this, this.app, this._dbManager);
  }

  public addScimApi() {
    if (this._check('scim', 'api', 'homedb', 'json', 'api-mw')) { return; }

    const scimRouter = isAffirmative(process.env.GRIST_ENABLE_SCIM) ?
      buildScimRouter(this._dbManager, this._installAdmin) :
      () => {
        throw new ApiError('SCIM API is not enabled', 501);
      };

    this.app.use('/api/scim', scimRouter);
  }


  public addBillingApi() {
    if (this._check('billing-api', 'homedb', 'json', 'api-mw')) { return; }
    this.getBilling().addEndpoints(this.app);
    this.getBilling().addEventHandlers();
  }

  public addBillingMiddleware() {
    if (this._check('activation', 'homedb')) { return; }
    this.getBilling().addMiddleware?.(this.app);
  }

  /**
   * Add a /api/log endpoint that simply outputs client errors to our
   * logs.  This is a minimal placeholder for a special-purpose
   * service for dealing with client errors.
   */
  public addLogEndpoint() {
    if (this._check('log-endpoint', 'json', 'api-mw')) { return; }

    this.app.post('/api/log', async (req, resp) => {
      const mreq = req as RequestWithLogin;
      log.rawWarn('client error', {
        event: req.body.event,
        docId: req.body.docId,
        page: req.body.page,
        browser: req.body.browser,
        org: mreq.org,
        email: mreq.user && mreq.user.loginEmail,
        userId: mreq.userId,
        altSessionId: mreq.altSessionId,
      });
      return resp.status(200).send();
    });
  }

  public addAuditLogger() {
    if (this._check('audit-logger', 'homedb')) { return; }

    this._auditLogger = this.create.AuditLogger(this._dbManager, this);
  }

  public async addTelemetry() {
    if (this._check('telemetry', 'homedb', 'json', 'api-mw')) { return; }

    this._telemetry = this.create.Telemetry(this._dbManager, this);
    this._telemetry.addEndpoints(this.app);
    await this._telemetry.start();

    // Start up a monitor for memory and cpu usage.
    this._processMonitorStop = this.create.startProcessMonitor(this._telemetry);
  }

  public async close() {
    this._processMonitorStop?.();
    await this._updateManager?.clear();
    if (this.usage)  { await this.usage.close(); }
    if (this._hosts) { this._hosts.close(); }
    this._emitNotifier.removeAllListeners();
    this._dbManager?.clearCaches();
    this._installAdmin?.clearCaches();
    if (this.server)      { this.server.close(); }
    if (this.httpsServer) { this.httpsServer.close(); }
    if (this.housekeeper) { await this.housekeeper.stop(); }
    if (this._jobs)       { await this._jobs.stop(); }
    await this._shutdown();
    if (this._accessTokens) { await this._accessTokens.close(); }
    // Do this after _shutdown, since DocWorkerMap is used during shutdown.
    if (this._docWorkerMap) { await this._docWorkerMap.close(); }
    if (this._sessionStore) { await this._sessionStore.close(); }
    if (this._auditLogger) { await this._auditLogger.close(); }
    if (this._billing) { await this._billing.close?.(); }
    await this._pubSubManager.close();
  }

  public addDocApiForwarder() {
    if (this._check('doc_api_forwarder', '!json', 'homedb', 'api-mw', 'map')) { return; }
    const docApiForwarder = new DocApiForwarder(this._docWorkerMap, this._dbManager, this);
    docApiForwarder.addEndpoints(this.app);
  }

  public addJsonSupport() {
    if (this._check('json')) { return; }
    this.app.use(express.json({limit: '1mb'}));  // Increase from the default 100kb
  }

  public addSessions() {
    if (this._check('sessions', 'loginMiddleware')) { return; }
    this.addTagChecker();
    this.addOrg();

    // Create the sessionStore and related objects.
    const {sessions, sessionMiddleware, sessionStore} = initGristSessions(getUnpackedAppRoot(this.instanceRoot), this);
    this.app.use(sessionMiddleware);
    this.app.use(signInStatusMiddleware);

    // Create an endpoint for making cookies during testing.
    this.app.get('/test/session', async (req, res) => {
      const mreq = req as RequestWithLogin;
      forceSessionChange(mreq.session);
      res.status(200).send(`Grist ${this.name} is alive and is interested in you.`);
    });

    this._sessions = sessions;
    this._sessionStore = sessionStore;
  }

  // Close connections and stop accepting new connections.  Remove server from any lists
  // it may be in.
  public async stopListening(mode: 'crash'|'clean' = 'clean') {
    if (!this._disabled) {
      if (mode === 'clean') {
        await this._shutdown();
        this._disabled = true;
      } else {
        this._disabled = true;
        if (this._comm) {
          this._comm.setServerActivation(false);
          this._comm.destroyAllClients();
        }
      }
      this.server.close();
      if (this.httpsServer) { this.httpsServer.close(); }
    }
  }

  public async createWorkerUrl(): Promise<{url: string, host: string}> {
    if (!process.env.GRIST_ROUTER_URL) {
      throw new Error('No service available to create worker url');
    }
    const w = await axios.get(process.env.GRIST_ROUTER_URL,
                              {params: {act: 'add', port: this.getOwnPort()}});
    log.info(`DocWorker registered itself via ${process.env.GRIST_ROUTER_URL} as ${w.data.url}`);
    const statusUrl = `${w.data.url}/status`;
    // We now wait for the worker to be available from the url that clients will
    // use to connect to it.  This may take some time.  The main delay is the
    // new target group and load balancer rule taking effect - typically 10-20 seconds.
    // If we don't wait, the worker will end up registered for work and clients
    // could end up trying to reach it to open documents - but the url they have
    // won't work.
    for (let tries = 0; tries < 600; tries++) {
      await delay(1000);
      try {
        await axios.get(statusUrl);
        return w.data;
      } catch (err) {
        log.debug(`While waiting for ${statusUrl} got error ${(err as Error).message}`);
      }
    }
    throw new Error(`Cannot connect to ${statusUrl}`);
  }

  // Accept new connections again.  Add server to any lists it needs to be in to get work.
  public async restartListening() {
    if (!this._docWorkerMap) { throw new Error('expected to have DocWorkerMap'); }
    await this.stopListening('clean');
    if (this._disabled) {
      if (this._storageManager) {
        this._storageManager.testReopenStorage();
      }
      this._comm.setServerActivation(true);
      if (this.worker) {
        await this._startServers(this.server, this.httpsServer, this.name, this.port, false);
        await this._addSelfAsWorker(this._docWorkerMap);
        this._docWorkerLoadTracker?.start();
      }
      this._disabled = false;
    }
  }

  public async addLandingPages() {
    // TODO: check if isSingleUserMode() path can be removed from this method
    if (this._check('landing', 'map', isSingleUserMode() ? null : 'homedb')) { return; }
    this.addSessions();

    // Initialize _sendAppPage helper.
    this._sendAppPage = makeSendAppPage({
      server: this,
      staticDir: getAppPathTo(this.appRoot, 'static'),
      tag: this.tag,
      testLogin: isTestLoginAllowed(),
      baseDomain: this._defaultBaseDomain,
    });

    const forceLogin = appSettings.section('login').flag('forced').readBool({
      envVar: 'GRIST_FORCE_LOGIN',
    });

    const forcedLoginMiddleware = forceLogin ? this._redirectToLoginWithoutExceptionsMiddleware : noop;

    const welcomeNewUser: express.RequestHandler = isSingleUserMode() ?
      (req, res, next) => next() :
      expressWrap(async (req, res, next) => {
        const mreq = req as RequestWithLogin;
        const user = getUser(req);
        if (user && user.isFirstTimeUser) {
          log.debug(`welcoming user: ${user.name}`);
          // Reset isFirstTimeUser flag.
          await this._dbManager.updateUser(user.id, {isFirstTimeUser: false});

          // This is a good time to set some other flags, for showing a page with welcome question(s)
          // to this new user and recording their sign-up with Google Tag Manager. These flags are also
          // scoped to the user, but isFirstTimeUser has a dedicated DB field because it predates userPrefs.
          // Note that the updateOrg() method handles all levels of prefs (for user, user+org, or org).
          await this._dbManager.updateOrg(getScope(req), 0, {userPrefs: {
            showNewUserQuestions: true,
            recordSignUpEvent: true
          }});

          // Give a chance to the login system to react to the first visit after signup.
          this._loginMiddleware.onFirstVisit?.(req);

          // If the assistant needs to perform some work (e.g. redirect to a new document with a
          // particular prompt pre-filled), do it now.
          //
          // TODO: break out this and other parts of `welcomeNewUser` into separate Express middleware.
          // `onFirstVisit` may send a response, which is why we awkwardly check `headersSent` wasn't
          // set before resuming the current middleware. This wouldn't be necessary if `onFirstVisit`
          // was a proper Express middleware that called `next` when not sending a response.
          if (this._assistant?.version === 2 && this._assistant.onFirstVisit) {
            await this._assistant.onFirstVisit(req, res);
            if (res.headersSent) {
              return;
            }
          }

          // If we need to copy an unsaved document or template as part of sign-up, do so now
          // and redirect to it.
          const docId = await this._maybeCopyDocToHomeWorkspace(mreq, res);
          if (docId) {
            return res.redirect(this.getMergedOrgUrl(mreq, `/doc/${docId}`));
          }

          const domain = mreq.org ?? null;
          if (!process.env.GRIST_SINGLE_ORG && this._dbManager.isMergedOrg(domain)) {
            // We're logging in for the first time on the merged org; if the user has
            // access to other team sites, forward the user to a page that lists all
            // the teams they have access to.
            const result = await this._dbManager.getMergedOrgs(user.id, user.id, domain);
            const orgs = this._dbManager.unwrapQueryResult(result);
            if (orgs.length > 1 && mreq.path === '/') {
              // Only forward if the request is for the home page.
              return res.redirect(this.getMergedOrgUrl(mreq, '/welcome/teams'));
            }
          }
        }
        if (mreq.org && mreq.org.startsWith('o-')) {
          // We are on a team site without a custom subdomain.
          const orgInfo = this._dbManager.unwrapQueryResult(await this._dbManager.getOrg({userId: user.id}, mreq.org));

          // If the user is a billing manager for the org, and the org
          // is supposed to have a custom subdomain, forward the user
          // to a page to set it.

          // TODO: this is more or less a hack for AppSumo signup flow,
          // and could be removed if/when signup flow is revamped.

          // If "welcomeNewUser" is ever added to billing pages, we'd need
          // to avoid a redirect loop.

          if (orgInfo.billingAccount.isManager && orgInfo.billingAccount.getFeatures().vanityDomain) {
            const prefix: string = isOrgInPathOnly(req.hostname) ? `/o/${mreq.org}` : '';
            return res.redirect(`${prefix}/billing/payment?billingTask=signUpLite`);
          }
        }
        next();
      });

    attachAppEndpoint({
      app: this.app,
      middleware: [
        this._redirectToHostMiddleware,
        this._userIdMiddleware,
        forcedLoginMiddleware,
        this._redirectToLoginWithExceptionsMiddleware,
        this._redirectToOrgMiddleware,
        welcomeNewUser
      ],
      docMiddleware: [
        // Same as middleware, except without login redirect middleware.
        this._redirectToHostMiddleware,
        this._userIdMiddleware,
        forcedLoginMiddleware,
        this._redirectToOrgMiddleware,
        welcomeNewUser
      ],
      formMiddleware: [
        this._userIdMiddleware,
        forcedLoginMiddleware,
      ],
      forceLogin: this._redirectToLoginUnconditionally,
      docWorkerMap: isSingleUserMode() ? null : this._docWorkerMap,
      sendAppPage: this._sendAppPage,
      dbManager: this._dbManager,
      plugins : (await this._addPluginManager()).getPlugins(),
      gristServer: this,
    });
  }

  public async addLoginMiddleware() {
    if (this._check('loginMiddleware', 'homedb')) { return; }

    // TODO: We could include a third mock provider of login/logout URLs for better tests. Or we
    // could create a mock SAML identity provider for testing this using the SAML flow.
    const loginSystem = await this.resolveLoginSystem();
    this._loginMiddleware = await loginSystem.getMiddleware(this);
    this._getLoginRedirectUrl = tbind(this._loginMiddleware.getLoginRedirectUrl, this._loginMiddleware);
    this._getSignUpRedirectUrl = tbind(this._loginMiddleware.getSignUpRedirectUrl, this._loginMiddleware);
    this._getLogoutRedirectUrl = tbind(this._loginMiddleware.getLogoutRedirectUrl, this._loginMiddleware);
    const wildcardMiddleware = this._loginMiddleware.getWildcardMiddleware?.();
    if (wildcardMiddleware?.length) {
        this.app.use(wildcardMiddleware);
    }
  }

  public addComm() {
    if (this._check('comm', 'start', 'homedb', 'loginMiddleware')) { return; }
    this._comm = new Comm(this.server, {
      settings: {},
      sessions: this._sessions,
      hosts: this._hosts,
      loginMiddleware: this._loginMiddleware,
      httpsServer: this.httpsServer,
      i18Instance: this.i18Instance,
      dbManager: this.getHomeDBManager(),
    });
  }
  /**
   * Add endpoint that servers a javascript file with various api keys that
   * are used by the client libraries.
   */
  public addClientSecrets() {
    if (this._check('clientSecret')) { return; }
    this.app.get('/client-secret.js', expressWrap(async (req, res) => {
      const config = this.getGristConfig();
      // Currently we are exposing only Google keys.
      // Those keys are eventually visible by the client, but should be usable
      // only from Grist's domains.
      const secrets = {
        googleClientId: config.googleClientId,
      };
      res.set('Content-Type', 'application/javascript');
      res.status(200);
      res.send(`
        window.gristClientSecret = ${JSON.stringify(secrets)}
      `);
    }));
  }

  public async addLoginRoutes() {
    if (this._check('login', 'org', 'sessions', 'homedb', 'hosts')) { return; }
    // TODO: We do NOT want Comm here at all, it's only being used for handling sessions, which
    // should be factored out of it.
    this.addComm();

    const signinMiddleware = this._loginMiddleware.getLoginOrSignUpMiddleware ?
      this._loginMiddleware.getLoginOrSignUpMiddleware() :
      [];
    this.app.get('/login', ...signinMiddleware, expressWrap(this._redirectToLoginOrSignup.bind(this, {
      signUp: false,
    })));
    this.app.get('/signup', ...signinMiddleware, expressWrap(this._redirectToLoginOrSignup.bind(this, {
      signUp: true,
    })));
    this.app.get('/signin', ...signinMiddleware, expressWrap(this._redirectToLoginOrSignup.bind(this, {})));

    if (isTestLoginAllowed()) {
      // This is an endpoint for the dev environment that lets you log in as anyone.
      // For a standard dev environment, it will be accessible at localhost:8080/test/login
      // and localhost:8080/o/<org>/test/login.  Only available when GRIST_TEST_LOGIN is set.
      // Handy when without network connectivity to reach Cognito.

      log.warn("Adding a /test/login endpoint because GRIST_TEST_LOGIN is set. " +
        "Users will be able to login as anyone.");

      this.app.get('/test/login', expressWrap(async (req, res) => {
        log.warn("Serving unauthenticated /test/login endpoint, made available because GRIST_TEST_LOGIN is set.");

        // Query parameter is called "username" for compatibility with Cognito.
        const email = optStringParam(req.query.username, 'username');
        if (email) {
          const redirect = optStringParam(req.query.next, 'next');
          const profile: UserProfile = {
            email,
            name: optStringParam(req.query.name, 'name') || email,
          };
          const url = new URL(redirect || getOrgUrl(req));
          // Make sure we update session for org we'll be redirecting to.
          const {org} = await this._hosts.getOrgInfoFromParts(url.hostname, url.pathname);
          const scopedSession = this._sessions.getOrCreateSessionFromRequest(req, { org });
          await scopedSession.updateUserProfile(req, profile);
          this._sessions.clearCacheIfNeeded({email, org});
          if (redirect) { return res.redirect(redirect); }
        }
        res.send(`<!doctype html>
          <html><body>
          <div class="modal-content-desktop">
            <h1>A Very Credulous Login Page</h1>
            <p>
              A minimal login screen to facilitate testing.
              I'll believe anything you tell me.
            </p>
            <form>
              <div>Email <input type=text name=username placeholder=email /></div>
              <div>Name <input type=text name=name placeholder=name /></div>
              <div>Dummy password <input type=text name=password placeholder=unused ></div>
              <input type=hidden name=next value="${req.query.next || ''}">
              <div><input type=submit name=signInSubmitButton value=login></div>
            </form>
          </div>
          </body></html>
       `);
      }));
    }

    this.app.get('/logout', ...this._logoutMiddleware(), expressWrap(async (req, resp) => {
      const signedOutUrl = new URL(getOrgUrl(req) + 'signed-out');
      const redirectUrl = await this._getLogoutRedirectUrl(req, signedOutUrl);
      resp.redirect(redirectUrl);
    }));

    // Add a static "signed-out" page. This is where logout typically lands (e.g. after redirecting
    // through SAML).
    this.app.get('/signed-out', expressWrap((req, resp) =>
      this._sendAppPage(req, resp, {path: 'error.html', status: 200, config: {errPage: 'signed-out'}})));

    const comment = await this._loginMiddleware.addEndpoints(this.app);
    this.info.push(['loginMiddlewareComment', comment]);

    addDiscourseConnectEndpoints(this.app, {
      userIdMiddleware: this._userIdMiddleware,
      redirectToLogin: this._redirectToLoginWithoutExceptionsMiddleware,
    });
  }

  public async addTestingHooks(workerServers?: FlexServer[]) {
    this._check('testinghooks', 'comm');
    if (process.env.GRIST_TESTING_SOCKET) {
      await startTestingHooks(process.env.GRIST_TESTING_SOCKET, this.port, this._comm, this,
                              workerServers || []);
      this._hasTestingHooks = true;
    }
  }

  // Returns a Map from docId to number of connected clients for each doc.
  public async getDocClientCounts(): Promise<Map<string, number>> {
    return this._docManager ? this._docManager.getDocClientCounts() : new Map();
  }

  // allow the document manager to be specified externally, for convenience in testing.
  public testSetDocManager(docManager: DocManager) {
    this._docManager = docManager;
  }

  // Add document-related endpoints and related support.
  public async addDoc() {
    this._check('doc', 'start', 'tag', 'json', isSingleUserMode() ?
      null : 'homedb', 'api-mw', 'map', 'telemetry');
    // add handlers for cleanup, if we are in charge of the doc manager.
    if (!this._docManager) { this.addCleanup(); }
    await this.addLoginMiddleware();
    this.addComm();
    // Check SQLite mode so it shows up in initial configuration readout
    // (even though we don't need it until opening documents).
    getSqliteMode();

    await this.create.configure?.();

    if (!isSingleUserMode()) {
      const externalStorage = appSettings.section('externalStorage');
      const haveExternalStorage = Object.values(externalStorage.nested)
        .some(storage => storage.flag('active').getAsBool());
      const disabled = externalStorage.flag('disable')
        .read({ envVar: 'GRIST_DISABLE_S3' }).getAsBool();
      if (disabled || !haveExternalStorage) {
        this._disableExternalStorage = true;
        externalStorage.flag('active').set(false);
      }
      await this.create.checkBackend?.();
      const workers = this._docWorkerMap;
      const docWorkerId = await this._addSelfAsWorker(workers);

      const storageManager = await this.create.createHostedDocStorageManager(
        this, this.docsRoot, docWorkerId, this._disableExternalStorage, workers, this._dbManager,
        this.create.ExternalStorage.bind(this.create)
      );
      this._storageManager = storageManager;
    } else {
      const samples = getAppPathTo(this.appRoot, 'public_samples');
      const storageManager = await this.create.createLocalDocStorageManager(
        this.docsRoot, samples, this._comm, undefined, this);
      this._storageManager = storageManager;
    }

    const pluginManager = await this._addPluginManager();

    const allStoreOptions = Object.values(this.create.getAttachmentStoreOptions());
    const checkedStoreOptions = await checkAvailabilityAttachmentStoreOptions(allStoreOptions);
    log.info("Attachment store backend availability", {
      available: checkedStoreOptions.available.map(option => option.name),
      unavailable: checkedStoreOptions.unavailable.map(option => option.name),
    });

    this._attachmentStoreProvider = this._attachmentStoreProvider || new AttachmentStoreProvider(
      await getConfiguredAttachmentStoreConfigs(),
      (await this.getActivations().current()).id,
    );
    this._docManager = this._docManager || new DocManager(this._storageManager,
      pluginManager,
      this._dbManager,
      this._attachmentStoreProvider,
      this);
    const docManager = this._docManager;

    shutdown.addCleanupHandler(null, this._shutdown.bind(this), 25000, 'FlexServer._shutdown');

    if (!isSingleUserMode()) {
      this._docWorkerLoadTracker = getDocWorkerLoadTracker(
        this.worker,
        this._docWorkerMap,
        docManager
      );
      if (this._docWorkerLoadTracker) {
        // Get the initial load value. If this call fails, the server will crash.
        // This is meant to check whether the admin has correctly configured
        // how to measure it.
        const initialLoadValue = await this._docWorkerLoadTracker.getLoad();
        await this._docWorkerMap.setWorkerLoad(this.worker, initialLoadValue);
        this._docWorkerLoadTracker.start();
      }
      this._comm.registerMethods({
        openDoc:                  docManager.openDoc.bind(docManager),
      });
      this._serveDocPage();
    }

    // Attach docWorker endpoints and Comm methods.
    const docWorker = new DocWorker(this._dbManager, {comm: this._comm, gristServer: this});
    this._docWorker = docWorker;

    // Register the websocket comm functions associated with the docworker.
    docWorker.registerCommCore();
    docWorker.registerCommPlugin();

    // Doc-specific endpoints require authorization; collect the relevant middleware in one list.
    const docAccessMiddleware = [
      this._userIdMiddleware,
      this._docPermissionsMiddleware,
      this.tagChecker.requireTag
    ];

    this._addSupportPaths(docAccessMiddleware);

    if (!isSingleUserMode()) {
      addDocApiRoutes(this.app, docWorker, this._docWorkerMap, docManager, this._dbManager,
                      this._attachmentStoreProvider, this);
    }
  }

  public async getSandboxInfo(): Promise<SandboxInfo> {
    if (this._sandboxInfo) { return this._sandboxInfo; }

    const flavor = process.env.GRIST_SANDBOX_FLAVOR || 'unknown';
    const info = this._sandboxInfo = {
      flavor,
      configured: flavor !== 'unsandboxed',
      functional: false,
      effective: false,
      sandboxed: false,
      lastSuccessfulStep: 'none',
    } as SandboxInfo;
    // Only meaningful on instances that handle documents.
    if (!this._docManager) { return info; }
    try {
      const sandbox = createSandbox({
        server: this,
        docId: 'test',  // The id is just used in logging - no
                        // document is created or read at this level.
        preferredPythonVersion: '3',
      });
      info.flavor = sandbox.getFlavor();
      info.configured = info.flavor !== 'unsandboxed';
      info.lastSuccessfulStep = 'create';
      const result = await sandbox.pyCall('get_version');
      if (typeof result !== 'number') {
        throw new Error(`Expected a number: ${result}`);
      }
      info.lastSuccessfulStep = 'use';
      await sandbox.shutdown();
      info.lastSuccessfulStep = 'all';
      info.functional = true;
      info.effective = ![ 'skip', 'unsandboxed' ].includes(info.flavor);
    } catch (e) {
      info.error = String(e);
    }
    return info;
  }

  public getInfo(key: string): any {
    const infoPair = this.info.find(([keyToCheck]) => key === keyToCheck);
    return infoPair?.[1];
  }

  public disableExternalStorage() {
    if (this.deps.has('doc')) {
      throw new Error('disableExternalStorage called too late');
    }
    this._disableExternalStorage = true;
  }

  public async getDoomTool() {
    const dbManager = this.getHomeDBManager();
    const permitStore = this.getPermitStore();
    const notifier = this.getNotifier();
    const loginSystem = await this.resolveLoginSystem();
    const homeUrl = this.getHomeInternalUrl().replace(/\/$/, '');
    return new Doom(dbManager, permitStore, notifier, loginSystem, homeUrl);
  }

  public addAccountPage() {
    const middleware = [
      this._redirectToHostMiddleware,
      this._userIdMiddleware,
      this._redirectToLoginWithoutExceptionsMiddleware
    ];

    this.app.get('/account', ...middleware, expressWrap(async (req, resp) => {
      return this._sendAppPage(req, resp, {path: 'app.html', status: 200, config: {}});
    }));

    if (isAffirmative(process.env.GRIST_ACCOUNT_CLOSE)) {
      this.app.delete('/api/doom/account', expressWrap(async (req, resp) => {
        // Make sure we have a valid user authenticated user here.
        const userId = getUserId(req);

        // Make sure we are deleting the correct user account (and not the anonymous user)
        const requestedUser = integerParam(req.query.userid, 'userid');
        if (requestedUser !== userId || isAnonymousUser(req))  {
          // This probably shouldn't happen, but if user has already deleted the account and tries to do it
          // once again in a second tab, we might end up here. In that case we are returning false to indicate
          // that account wasn't deleted.
          return resp.status(200).json(false);
        }

        // We are a valid user, we can proceed with the deletion. Note that we will
        // delete user as an admin, as we need to remove other resources that user
        // might not have access to.

        // Reuse Doom cli tool for account deletion. It won't allow to delete account if it has access
        // to other (not public) team sites.
        const doom = await this.getDoomTool();
        const {data} = await doom.deleteUser(userId);
        if (data) { this._logDeleteUserEvents(req as RequestWithLogin, data); }
        return resp.status(200).json(true);
      }));

      this.app.get('/account-deleted', ...this._logoutMiddleware(), expressWrap((req, resp) => {
        return this._sendAppPage(req, resp, {path: 'error.html', status: 200, config: {errPage: 'account-deleted'}});
      }));

      this.app.delete('/api/doom/org', expressWrap(async (req, resp) => {
        const mreq = req as RequestWithLogin;
        const orgDomain = getOrgFromRequest(req);
        if (!orgDomain) { throw new ApiError("Cannot determine organization", 400); }

        if (this._dbManager.isMergedOrg(orgDomain)) {
          throw new ApiError("Cannot delete a personal site", 400);
        }

        // Get org from the server.
        const query = await this._dbManager.getOrg(getScope(mreq), orgDomain);
        const org = this._dbManager.unwrapQueryResult(query);

        if (!org || org.ownerId) {
          // This shouldn't happen, but just in case test it.
          throw new ApiError("Cannot delete an org with an owner", 400);
        }

        if (!org.billingAccount.isManager) {
          throw new ApiError("Only billing manager can delete a team site", 403);
        }

        // Reuse Doom cli tool for org deletion. Note, this removes everything as a super user.
        const deletedOrg = structuredClone(org);
        const doom = await this.getDoomTool();
        await doom.deleteOrg(org.id);
        this._logDeleteSiteEvents(mreq, deletedOrg);
        return resp.status(200).send();
      }));
    }
  }

  public addBillingPages() {
    const middleware = [
      this._redirectToHostMiddleware,
      this._userIdMiddleware,
      this._redirectToLoginWithoutExceptionsMiddleware
    ];

    this.getBilling().addPages(this.app, middleware);
  }

  /**
   * Add billing webhooks.  Strip signatures sign the raw body of the message, so
   * we need to get these webhooks in before the bodyParser is added to parse json.
   */
  public addEarlyWebhooks() {
    if (this._check('webhooks', 'homedb', '!json')) { return; }
    this.getBilling().addWebhooks(this.app);
  }

  public addWelcomePaths() {
    const middleware = [
      this._redirectToHostMiddleware,
      this._userIdMiddleware,
      this._redirectToLoginWithoutExceptionsMiddleware,
    ];

    // These are some special-purpose welcome pages, with no middleware.
    this.app.get(/\/welcome\/(signup|verify|teams|select-account)/, expressWrap(async (req, resp, next) => {
      return this._sendAppPage(req, resp, {path: 'app.html', status: 200, config: {}, googleTagManager: 'anon'});
    }));

    /**
     * A nuanced redirecting endpoint. For example, on docs.getgrist.com it does:
     * 1) If logged in and no team site -> https://docs.getgrist.com/
     * 2) If logged in and has team sites -> https://docs.getgrist.com/welcome/teams
     * 3) If logged out but has a cookie -> /login, then 1 or 2
     * 4) If entirely unknown -> /signup
     */
    this.app.get('/welcome/start', [
      this._redirectToHostMiddleware,
      this._userIdMiddleware,
    ], expressWrap(async (req, resp, next) => {
      if (isAnonymousUser(req)) {
        return this._redirectToLoginOrSignup({
          nextUrl: new URL(getOrgUrl(req, '/welcome/start')),
        }, req, resp);
      }

      await this._redirectToHomeOrWelcomePage(req as RequestWithLogin, resp);
    }));

    /**
     * Like /welcome/start, but doesn't redirect anonymous users to sign in.
     *
     * Used by the client when the last site the user visited is unknown, and
     * a suitable site is needed for the home page.
     *
     * For example, on templates.getgrist.com it does:
     * 1) If logged in and no team site -> https://docs.getgrist.com/
     * 2) If logged in and has team sites -> https://docs.getgrist.com/welcome/teams
     * 3) If logged out -> https://docs.getgrist.com/
     */
    this.app.get('/welcome/home', [
      this._redirectToHostMiddleware,
      this._userIdMiddleware,
    ], expressWrap(async (req, resp) => {
      const mreq = req as RequestWithLogin;
      if (isAnonymousUser(req)) {
        return resp.redirect(this.getMergedOrgUrl(mreq));
      }

      await this._redirectToHomeOrWelcomePage(mreq, resp, {redirectToMergedOrg: true});
    }));

    this.app.post('/welcome/info', ...middleware, expressWrap(async (req, resp, next) => {
      const userId = getUserId(req);
      const user = getUser(req);
      const orgName = stringParam(req.body.org_name, 'org_name');
      const orgRole = stringParam(req.body.org_role, 'org_role');
      const useCases = stringArrayParam(req.body.use_cases, 'use_cases');
      const useOther = stringParam(req.body.use_other, 'use_other');
      const row = {
        UserID: userId,
        Name: user.name,
        Email: user.loginEmail,
        org_name: orgName,
        org_role: orgRole,
        use_cases: ['L', ...useCases],
        use_other: useOther,
      };
      try {
        await this._recordNewUserInfo(row);
      } catch (e) {
        // If we failed to record, at least log the data, so we could potentially recover it.
        log.rawWarn(`Failed to record new user info: ${e.message}`, {newUserQuestions: row});
      }
      const nonOtherUseCases = useCases.filter(useCase => useCase !== 'Other');
      for (const useCase of [...nonOtherUseCases, ...(useOther ? [`Other - ${useOther}`] : [])]) {
        this.getTelemetry().logEvent(req as RequestWithLogin, 'answeredUseCaseQuestion', {
          full: {
            userId,
            useCase,
          },
        });
      }

      resp.status(200).send();
    }), jsonErrorHandler); // Add a final error handler that reports errors as JSON.
  }

  public finalizeEndpoints() {
    this.addApiErrorHandlers();

    // add a final non-found handler for other content.
    this.app.use("/", expressWrap((req, resp) => {
      if (this._sendAppPage) {
        return this._sendAppPage(req, resp, {path: 'error.html', status: 404, config: {errPage: 'not-found'}});
      } else {
        return resp.status(404).json({error: 'not found'});
      }
    }));

    // add a final error handler
    this.app.use(async (err: any, req: express.Request, resp: express.Response, next: express.NextFunction) => {
      // Delegate to default error handler when headers have already been sent, as express advises
      // at https://expressjs.com/en/guide/error-handling.html#the-default-error-handler.
      // Also delegates if no _sendAppPage method has been configured.
      if (resp.headersSent || !this._sendAppPage) { return next(err); }
      try {
        const errPage = (
          err.status === 403 ? 'access-denied' :
          err.status === 404 ? 'not-found' :
          'other-error'
        );
        const config = {errPage, errMessage: err.message || err};
        await this._sendAppPage(req, resp, {path: 'error.html', status: err.status || 400, config});
      } catch (error) {
        return next(error);
      }
    });
  }

  /**
   * Check whether there's a local plugin port.
   */
  public servesPlugins() {
    if (this._servesPlugins === undefined) {
      throw new Error('do not know if server will serve plugins');
    }
    return this._servesPlugins;
  }

  /**
   * Declare that there will be a local plugin port.
   */
  public setServesPlugins(flag: boolean) {
    this._servesPlugins = flag;
  }

  /**
   * Get the base URL for plugins. Throws an error if the URL is not
   * yet available.
   */
  public getPluginUrl() {
    if (!this._pluginUrlReady) {
      throw new Error('looked at plugin url too early');
    }
    return this._pluginUrl;
  }

  public getPlugins() {
    if (!this._pluginManager) {
      throw new Error('plugin manager not available');
    }
    return this._pluginManager.getPlugins();
  }

  public async finalizePlugins(userPort: number|null) {
    if (isAffirmative(process.env.GRIST_TRUST_PLUGINS)) {
      this._pluginUrl = this.getDefaultHomeUrl();
    } else if (userPort !== null) {
      // If plugin content is served from same host but on different port,
      // run webserver on that port
      const ports = await this.startCopy('pluginServer', userPort);
      // If Grist is running on a desktop, directly on the host, it
      // can be convenient to leave the user port free for the OS to
      // allocate by using GRIST_UNTRUSTED_PORT=0. But we do need to
      // remember how to contact it.
      if (process.env.APP_UNTRUSTED_URL === undefined) {
        const url = new URL(this.getOwnUrl());
        url.port = String(userPort || ports.serverPort);
        this._pluginUrl = url.href;
      }
    }
    this.info.push(['pluginUrl', this._pluginUrl]);
    this.info.push(['willServePlugins', this._servesPlugins]);
    this._pluginUrlReady = true;
    const repo = buildWidgetRepository(this, { localOnly: true });
    this._bundledWidgets = await repo.getWidgets();
  }

  public getBundledWidgets(): ICustomWidget[] {
    if (!this._bundledWidgets) {
      throw new Error('bundled widgets accessed too early');
    }
    return this._bundledWidgets;
  }

  public summary() {
    for (const [label, value] of this.info) {
      log.info("== %s: %s", label, value);
    }
    for (const item of appSettings.describeAll()) {
      const txt =
        ((item.value !== undefined) ? String(item.value) : '-') +
        (item.foundInEnvVar ? ` [${item.foundInEnvVar}]` : '') +
        (item.usedDefault ? ' [default]' : '') +
        ((item.wouldFindInEnvVar && !item.foundInEnvVar) ? ` [${item.wouldFindInEnvVar}]` : '');
      log.info("== %s: %s", item.name, txt);
    }
  }

  public setReady(value: boolean) {
    if(value) {
      log.debug('FlexServer is ready');
    } else {
      log.debug('FlexServer is no longer ready');
    }
    this._isReady = value;
  }

  public checkOptionCombinations() {
    // Check for some bad combinations we should warn about.
    const allowedWebhookDomains = appSettings.section('integrations').flag('allowedWebhookDomains').readString({
      envVar: 'ALLOWED_WEBHOOK_DOMAINS',
    });
    const proxy = appSettings.section('integrations').flag('proxy').readString({
      envVar: 'GRIST_HTTPS_PROXY',
    });
    // If all webhook targets are accepted, and no proxy is defined, issue
    // a warning. This warning can be removed by explicitly setting the proxy
    // to the empty string.
    if (allowedWebhookDomains === '*' && proxy === undefined) {
      log.warn("Setting an ALLOWED_WEBHOOK_DOMAINS wildcard without a GRIST_HTTPS_PROXY exposes your internal network");
    }
  }

  public async start() {
    if (this._check('start')) { return; }

    const servers = this._createServers();
    this.server = servers.server;
    this.httpsServer = servers.httpsServer;
    await this._startServers(this.server, this.httpsServer, this.name, this.port, true);
  }

  public addNotifier() {
    if (this._check('notifier', 'start', 'homedb')) { return; }
    // TODO: make Notifier aware of base domains, rather than sending emails with default
    // base domain.
    // Most notifications are ultimately triggered by requests with a base domain in them,
    // and all that is needed is a refactor to pass that info along.  But there is also the
    // case of notification(s) from stripe.  May need to associate a preferred base domain
    // with org/user and persist that?
    const primaryNotifier = this.create.Notifier(this._dbManager, this);
    if (primaryNotifier) {
      this._emitNotifier.setPrimaryNotifier(primaryNotifier);
    }

    // For doc notifications, if we are a home server, initialize endpoints and job handling.
    this.getDocNotificationManager()?.initHomeServer(this.app);
  }

  public addAssistant() {
    if (this._check('assistant')) { return; }
    this._assistant = this.create.Assistant(this);
    if (this._assistant?.version === 2) {
      this._assistant?.addEndpoints?.(this.app);
    }
  }

  public getGristConfig(): GristLoadConfig {
    return makeGristConfig({
      homeUrl: this.getDefaultHomeUrl(),
      extra: {},
      baseDomain: this._defaultBaseDomain,
    });
  }

  /**
   * Get a url for a team site.
   */
  public async getOrgUrl(orgKey: string|number): Promise<string> {
    const org = await this.getOrg(orgKey);
    return this.getResourceUrl(org);
  }

  public async getOrg(orgKey: string|number) {
    if (!this._dbManager) { throw new Error('database missing'); }
    const org = await this._dbManager.getOrg({
      userId: this._dbManager.getPreviewerUserId(),
      showAll: true
    }, orgKey);
    return this._dbManager.unwrapQueryResult(org);
  }

  /**
   * Get a url for an organization, workspace, or document.
   */
  public async getResourceUrl(resource: Organization|Workspace|Document,
                              purpose?: 'api'|'html'): Promise<string> {
    if (!this._dbManager) { throw new Error('database missing'); }
    const gristConfig = this.getGristConfig();
    const state: IGristUrlState = {};
    let org: Organization;
    if (resource instanceof Organization) {
      org = resource;
    } else if (resource instanceof Workspace) {
      org = resource.org;
      state.ws = resource.id;
    } else {
      org = resource.workspace.org;
      state.doc = resource.urlId || resource.id;
      state.slug = getSlugIfNeeded(resource);
    }
    state.org = this._dbManager.normalizeOrgDomain(org.id, org.domain, org.ownerId);
    state.api = purpose === 'api';
    if (!gristConfig.homeUrl) { throw new Error('Computing a resource URL requires a home URL'); }
    return encodeUrl(gristConfig, state, new URL(gristConfig.homeUrl));
  }

  public addUsage() {
    if (this._check('usage', 'start', 'homedb')) { return; }
    this.usage = new Usage(this._dbManager);
  }

  public async addHousekeeper() {
    if (this._check('housekeeper', 'start', 'homedb', 'map', 'json', 'api-mw')) { return; }
    const store = this._docWorkerMap;
    this.housekeeper = new Housekeeper(this._dbManager, this, this._internalPermitStore, store);
    this.housekeeper.addEndpoints(this.app);
    await this.housekeeper.start();
  }

  public async startCopy(name2: string, port2: number): Promise<{
    serverPort: number,
    httpsServerPort?: number,
  }>{
    const servers = this._createServers();
    return this._startServers(servers.server, servers.httpsServer, name2, port2, true);
  }

  public addGoogleAuthEndpoint() {
    if (this._check('google-auth')) { return; }
    const messagePage = makeMessagePage(getAppPathTo(this.appRoot, 'static'));
    addGoogleAuthEndpoint(this.app, messagePage);
  }

  /**
   * Adds early API.
   *
   * These API endpoints are intentionally added before other middleware to
   * minimize the impact of failures during startup. This includes, for
   * example, endpoints used by the Admin Panel for status checks.
   *
   * It's also desirable for some endpoints to be loaded early so that they
   * can set their own middleware, before any defaults are added.
   * For example, `addJsonSupport` enforces strict parsing of JSON, but a
   * handful of endpoints need relaxed parsing (e.g. /configs).
   */
  public addEarlyApi() {
    if (this._check('early-api', 'api-mw', 'homedb', '!json')) { return; }

    attachEarlyEndpoints({
      app: this.app,
      gristServer: this,
      userIdMiddleware: this._userIdMiddleware,
    });
  }

  public addConfigEndpoints() {
    // Need to be an admin to change the Grist config
    const requireInstallAdmin = this.getInstallAdmin().getMiddlewareRequireAdmin();

    const configBackendAPI = new ConfigBackendAPI();
    configBackendAPI.addEndpoints(this.app, requireInstallAdmin);

    // Some configurations may add extra endpoints. This seems a fine time to add them.
    this.create.addExtraHomeEndpoints(this, this.app);
  }

  public getLatestVersionAvailable() {
    return this._latestVersionAvailable;
  }

  public setLatestVersionAvailable(latestVersionAvailable: LatestVersionAvailable): void {
    log.info(`Setting ${latestVersionAvailable.version} as the latest available version`);
    this._latestVersionAvailable = latestVersionAvailable;
  }

  public async publishLatestVersionAvailable(latestVersionAvailable: LatestVersionAvailable): Promise<void> {
    log.info(`Publishing ${latestVersionAvailable.version} as the latest available version`);

    try {
      await this.getPubSubManager().publish(latestVersionChannel, JSON.stringify(latestVersionAvailable));
    } catch(error) {
      log.error(`Error publishing latest version`, {error, latestVersionAvailable});
    }
  }

  // Get the HTML template sent for document pages.
  public async getDocTemplate(): Promise<DocTemplate> {
    const page = await fse.readFile(path.join(getAppPathTo(this.appRoot, 'static'),
                                              'app.html'), 'utf8');
    return {
      page,
      tag: this.tag
    };
  }

  public getTag(): string {
    if (!this.tag) {
      throw new Error('getTag called too early');
    }
    return this.tag;
  }

  /**
   * Close all documents currently held open.
   */
  public async testCloseDocs(): Promise<void> {
    if (this._docManager) {
      return this._docManager.shutdownDocs();
    }
  }

  /**
   * Make sure external storage of all docs is up to date.
   */
  public async testFlushDocs() {
    const assignments = await this._docWorkerMap.getAssignments(this.worker.id);
    for (const assignment of assignments) {
      await this._storageManager.flushDoc(assignment);
    }
  }

  public resolveLoginSystem() {
    return isTestLoginAllowed() ?
      getTestLoginSystem() : this._getLoginSystem(this.getHomeDBManager());
  }

  public addUpdatesCheck() {
    if (this._check('update', 'json')) { return; }

    // For now we only are active for sass deployments.
    if (this._deploymentType !== 'saas') { return; }

    this._updateManager = new UpdateManager(this.app, this);
    this._updateManager.addEndpoints();
  }

  public setRestrictedMode(restrictedMode = true) {
    this.getHomeDBManager().setReadonly(restrictedMode);
  }

  public isRestrictedMode() {
    return this.getHomeDBManager().isReadonly();
  }

  public onUserChange(callback: (change: UserChange) => Promise<void>) {
    this._emitNotifier.on('userChange', callback);
  }

  public onStreamingDestinationsChange(callback: (orgId?: number) => Promise<void>) {
    this._emitNotifier.on('streamingDestinationsChange', callback);
  }

  public async getSigninUrl(
    req: express.Request,
    options: {
      signUp?: boolean;
      nextUrl?: URL;
      params?: Record<string, string | undefined>;
    }
  ) {
    let {nextUrl, signUp} = options;
    const {params = {}} = options;

    const mreq = req as RequestWithLogin;

    // This will ensure that express-session will set our cookie if it hasn't already -
    // we'll need it when we redirect back.
    forceSessionChange(mreq.session);

    // Redirect to the requested URL after successful login.
    if (!nextUrl) {
      const nextPath = optStringParam(req.query.next, 'next');
      nextUrl = new URL(getOrgUrl(req, nextPath));
    }
    if (signUp === undefined) {
      // Like redirectToLogin in Authorizer, redirect to sign up if it doesn't look like the
      // user has ever logged in on this browser.
      signUp = (mreq.session.users === undefined);
    }
    const getRedirectUrl = signUp ? this._getSignUpRedirectUrl : this._getLoginRedirectUrl;
    const url = new URL(await getRedirectUrl(req, nextUrl));
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
    return url.href;
  }

  /**
   * Returns middleware that adds information about the user to the request.
   *
   * Specifically, sets:
   *   - req.userId: the id of the user in the database users table
   *   - req.userIsAuthorized: set if user has presented credentials that were accepted
   *     (the anonymous user has a userId but does not have userIsAuthorized set if,
   *     as would typically be the case, credentials were not presented)
   *   - req.users: set for org-and-session-based logins, with list of profiles in session
   */
  public getUserIdMiddleware(): express.RequestHandler {
    return this._userIdMiddleware;
  }

  // Adds endpoints that support imports and exports.
  private _addSupportPaths(docAccessMiddleware: express.RequestHandler[]) {
    if (!this._docWorker) { throw new Error("need DocWorker"); }

    const basicMiddleware = [this._userIdMiddleware, this.tagChecker.requireTag];

    // Add the handling for the /upload route. Most uploads are meant for a DocWorker: they are put
    // in temporary files, and the DocWorker needs to be on the same machine to have access to them.
    // This doesn't check for doc access permissions because the request isn't tied to a document.
    addUploadRoute(this, this.app, this._docWorkerMap, this._trustOriginsMiddleware, ...basicMiddleware);

    this.app.get('/attachment', ...docAccessMiddleware,
      expressWrap(async (req, res) => this._docWorker.getAttachment(req, res)));
  }

  private _check(part: Part, ...precedents: Array<CheckKey|null>) {
    if (this.deps.has(part)) { return true; }
    for (const precedent of precedents) {
      if (!precedent) { continue; }
      if (precedent[0] === '!') {
        const antecedent = precedent.slice(1);
        if (this._has(antecedent)) {
          throw new Error(`${part} is needed before ${antecedent}`);
        }
      } else if (!this._has(precedent)) {
        throw new Error(`${precedent} is needed before ${part}`);
      }
    }
    this.deps.add(part);
    return false;
  }

  private _has(part: string) {
    return this.deps.has(part);
  }

  private async _addSelfAsWorker(workers: IDocWorkerMap): Promise<string> {
    try {
      this._healthy = true;
      // Check if this is the first time calling this method.  In production,
      // it always will be.  In testing, we may disconnect and reconnect the
      // worker.  We only need to determine docWorkerId and this.worker once.
      if (!this.worker) {

        if (process.env.GRIST_ROUTER_URL) {
          // register ourselves with the load balancer first.
          const w = await this.createWorkerUrl();
          const url = `${w.url}/v/${this.tag}/`;
          // TODO: we could compute a distinct internal url here.
          this.worker = {
            id: w.host,
            publicUrl: url,
            internalUrl: url,
          };
        } else {
          const url = (process.env.APP_DOC_URL || this.getOwnUrl()) + `/v/${this.tag}/`;
          this.worker = {
            // The worker id should be unique to this worker.
            id: process.env.GRIST_DOC_WORKER_ID || `testDocWorkerId_${this.port}`,
            publicUrl: url,
            internalUrl: process.env.APP_DOC_INTERNAL_URL || url,
          };
        }
        this.info.push(['docWorkerId', this.worker.id]);

        if (process.env.GRIST_WORKER_GROUP) {
          this.worker.group = process.env.GRIST_WORKER_GROUP;
        }
      } else {
        if (process.env.GRIST_ROUTER_URL) {
          await this.createWorkerUrl();
        }
      }
      await workers.addWorker(this.worker);
      await workers.setWorkerAvailability(this.worker.id, true);
    } catch (err) {
      this._healthy = false;
      throw err;
    }
    return this.worker.id;
  }

  private async _removeSelfAsWorker(workers: IDocWorkerMap, docWorkerId: string) {
    this._healthy = false;
    this._docWorkerLoadTracker?.stop();
    await workers.removeWorker(docWorkerId);
    if (process.env.GRIST_ROUTER_URL) {
      await axios.get(process.env.GRIST_ROUTER_URL,
                      {params: {act: 'remove', port: this.getOwnPort()}});
      log.info(`DocWorker unregistered itself via ${process.env.GRIST_ROUTER_URL}`);
    }
  }

  // Called when server is shutting down.  Save any state that needs saving, and
  // disentangle ourselves from outside world.
  private async _shutdown(): Promise<void> {
    if (!this.worker) { return; }
    if (!this._storageManager) { return; }
    if (!this._docWorkerMap) { return; }  // but this should never happen.

    const workers = this._docWorkerMap;

    // Pick up the pace on saving documents.
    this._storageManager.prepareToCloseStorage();

    // We urgently want to disable any new assignments.
    await workers.setWorkerAvailability(this.worker.id, false);

    // Enumerate the documents we are responsible for.
    let assignments = await workers.getAssignments(this.worker.id);
    let retries: number = 0;
    while (assignments.length > 0 && retries < 3) {
      await Promise.all(assignments.map(async assignment => {
        log.info("FlexServer shutdown assignment", assignment);
        try {
        // Start sending the doc to S3 if needed.
          const flushOp = this._storageManager.closeDocument(assignment);

          // Get access to the clients of this document.  This has the side
          // effect of waiting for the ActiveDoc to finish initialization.
          // This could include loading it from S3, an operation we could
          // potentially abort as an optimization.
          // TODO: abort any s3 loading as an optimization.
          const docPromise = this._docManager.getActiveDoc(assignment);
          const doc = docPromise && await docPromise;

          await flushOp;
          // At this instant, S3 and local document should be the same.

          // We'd now like to make sure (synchronously) that:
          //  - we never output anything new to S3 about this document.
          //  - we never output anything new to user about this document.
          // There could be asynchronous operations going on related to
          // these documents, but if we can make sure that their effects
          // do not reach the outside world then we can ignore them.
          if (doc) {
            doc.docClients.interruptAllClients();
            doc.setMuted();
          }

          // Release this document for other workers to pick up.
          // There is a small window of time here in which a client
          // could reconnect to us.  The muted ActiveDoc will result
          // in them being dropped again.
          await workers.releaseAssignment(this.worker.id, assignment);
        } catch (err) {
          log.info("problem dealing with assignment", assignment, err);
        }
      }));
      // Check for any assignments that slipped through at the last minute.
      assignments = await workers.getAssignments(this.worker.id);
      retries++;
    }
    if (assignments.length > 0) {
      log.error("FlexServer shutdown failed to release assignments:", assignments);
    }

    await this._removeSelfAsWorker(workers, this.worker.id);
    try {
      await this._docManager.shutdownAll();
    } catch (err) {
      log.error("FlexServer shutdown problem", err);
    }
    if (this._comm) {
      this._comm.destroyAllClients();
    }
    log.info("FlexServer shutdown is complete");
  }

  /**
   * Middleware that redirects a request with a userId but without an org to an org-specific URL,
   * after looking up the first org for this userId in DB.
   */
  private async _redirectToOrg(req: express.Request, resp: express.Response, next: express.NextFunction) {
    const mreq = req as RequestWithLogin;
    if (mreq.org || !mreq.userId) { return next(); }

    // Redirect anonymous users to the merged org.
    if (!mreq.userIsAuthorized) {
      const redirectUrl = this.getMergedOrgUrl(mreq);
      log.debug(`Redirecting anonymous user to: ${redirectUrl}`);
      return resp.redirect(redirectUrl);
    }

    // We have a userId, but the request is for an unknown org. Redirect to an org that's
    // available to the user. This matters in dev, and in prod when visiting a generic URL, which
    // will here redirect to e.g. the user's personal org.
    const result = await this._dbManager.getMergedOrgs(mreq.userId, mreq.userId, null);
    const orgs = (result.status === 200) ? result.data : null;
    const subdomain = orgs && orgs.length > 0 ? orgs[0].domain : null;
    const redirectUrl = subdomain && this._getOrgRedirectUrl(mreq, subdomain);
    if (redirectUrl) {
      log.debug(`Redirecting userId ${mreq.userId} to: ${redirectUrl}`);
      return resp.redirect(redirectUrl);
    }
    next();
  }

  /**
   * Given a Request and a desired subdomain, returns a URL for a similar request that specifies that
   * subdomain either in the hostname or in the path. Optionally passing pathname overrides url's
   * path.
   */
  private _getOrgRedirectUrl(req: RequestWithLogin, subdomain: string, pathname: string = req.originalUrl): string {
    const config = this.getGristConfig();
    const {hostname, orgInPath} = getOrgUrlInfo(subdomain, req.get('host')!, config);
    const redirectUrl = new URL(pathname, getOriginUrl(req));
    if (hostname) {
      redirectUrl.hostname = hostname;
    }
    if (orgInPath) {
      redirectUrl.pathname = `/o/${orgInPath}` + redirectUrl.pathname;
    }
    return redirectUrl.href;
  }


  // Create and initialize the plugin manager
  private async _addPluginManager() {
    if (this._pluginManager) { return this._pluginManager; }
    // Only used as {userRoot}/plugins as a place for plugins in addition to {appRoot}/plugins
    const userRoot = path.resolve(process.env.GRIST_USER_ROOT || getAppPathTo(this.appRoot, '.grist'));
    this.info.push(['userRoot', userRoot]);
    // Some custom widgets may be included as an npm package called @gristlabs/grist-widget.
    // The package doesn't actually  contain node code, but should be in the same vicinity
    // as other packages that do, so we can use require.resolve on one of them to find it.
    // This seems a little overcomplicated, but works well when grist-core is bundled within
    // a larger project like grist-electron.
    // TODO: maybe add a little node code to @gristlabs/grist-widget so it can be resolved
    // directly?
    const gristLabsModules = path.dirname(path.dirname(require.resolve('@gristlabs/express-session')));
    const bundledRoot = isAffirmative(process.env.GRIST_SKIP_BUNDLED_WIDGETS) ? undefined : path.join(
      gristLabsModules, 'grist-widget', 'dist'
    );
    this.info.push(['bundledRoot', bundledRoot]);
    const pluginManager = new PluginManager(this.appRoot, userRoot, bundledRoot);
    // `initialize()` is asynchronous and reads plugins manifests; if PluginManager is used before it
    // finishes, it will act as if there are no plugins.
    // ^ I think this comment was here to justify calling initialize without waiting for
    // the result.  I'm just going to wait, for determinism.
    await pluginManager.initialize();
    this._pluginManager = pluginManager;
    return pluginManager;
  }

  // Serve the static app.html proxied for a document.
  private _serveDocPage() {
    // Serve the static app.html file.
    // TODO: We should be the ones to fill in the base href here to ensure that the browser fetches
    // the correct version of static files for this app.html.
    this.app.get('/:docId/app.html', this._userIdMiddleware, expressWrap(async (req, res) => {
      res.json(await this.getDocTemplate());
    }));
  }

  // Check whether logger should skip a line.  Careful, req and res are morgan-specific
  // types, not Express.
  private _shouldSkipRequestLogging(req: {url: string}, res: {statusCode: number}) {
    if (req.url === '/status' && [200, 304].includes(res.statusCode) &&
        this._healthCheckCounter > HEALTH_CHECK_LOG_SHOW_FIRST_N &&
        this._healthCheckCounter % HEALTH_CHECK_LOG_SHOW_EVERY_N !== 1) {
      return true;
    }
    return false;
  }

  private _createServers() {
    // Start the app.
    const server = logServer(http.createServer(getServerFlags(), this.app));
    let httpsServer;
    if (TEST_HTTPS_OFFSET) {
      const certFile = process.env.GRIST_TEST_SSL_CERT;
      const privateKeyFile = process.env.GRIST_TEST_SSL_KEY;
      if (!certFile) { throw new Error('Set GRIST_TEST_SSL_CERT to location of certificate file'); }
      if (!privateKeyFile) { throw new Error('Set GRIST_TEST_SSL_KEY to location of private key file'); }
      log.debug(`https support: reading cert from ${certFile}`);
      log.debug(`https support: reading private key from ${privateKeyFile}`);
      httpsServer = logServer(https.createServer({
        ...getServerFlags(),
        key: fse.readFileSync(privateKeyFile, 'utf8'),
        cert: fse.readFileSync(certFile, 'utf8'),
      }, this.app));
    }
    return {server, httpsServer};
  }

  private async _startServers(server: http.Server, httpsServer: https.Server|undefined,
                              name: string, port: number, verbose: boolean) {
    await listenPromise(server.listen(port, this.host));
    const serverPort = (server.address() as AddressInfo).port;
    if (verbose) { log.info(`${name} available at ${this.host}:${serverPort}`); }
    let httpsServerPort: number|undefined;
    if (TEST_HTTPS_OFFSET && httpsServer) {
      if (port === 0) { throw new Error('cannot use https with OS-assigned port'); }
      httpsServerPort = port + TEST_HTTPS_OFFSET;
      await listenPromise(httpsServer.listen(httpsServerPort, this.host));
      if (verbose) { log.info(`${name} available at https://${this.host}:${httpsServerPort}`); }
    }
    return {
      serverPort,
      httpsServerPort,
    };
  }

  private async _recordNewUserInfo(row: object) {
    const urlId = DOC_ID_NEW_USER_INFO;
    // If nowhere to record data, return immediately.
    if (!urlId) { return; }
    let body: string|undefined;
    let permitKey: string|undefined;
    try {
      body = JSON.stringify(mapValues(row, value => [value]));

      // Take an extra step to translate the special urlId to a docId. This is helpful to
      // allow the same urlId to be used in production and in test. We need the docId for the
      // specialPermit below, which we need to be able to write to this doc.
      //
      // TODO With proper forms support, we could give an origin-based permission to submit a
      // form to this doc, and do it from the client directly.
      const previewerUserId = this._dbManager.getPreviewerUserId();
      const docAuth = await this._dbManager.getDocAuthCached({urlId, userId: previewerUserId});
      const docId = docAuth.docId;
      if (!docId) {
        throw new Error(`Can't resolve ${urlId}: ${docAuth.error}`);
      }

      permitKey = await this._internalPermitStore.setPermit({docId});
      const res = await fetch(await this.getHomeUrlByDocId(docId, `/api/docs/${docId}/tables/Responses/data`), {
        method: 'POST',
        headers: {'Permit': permitKey, 'Content-Type': 'application/json'},
        body,
      });
      if (res.status !== 200) {
        throw new Error(`API call failed with ${res.status}`);
      }
    } finally {
      if (permitKey) {
        await this._internalPermitStore.removePermit(permitKey);
      }
    }
  }

  /**
   * If signUp is true, redirect to signUp.
   * If signUp is false, redirect to login.
   * If signUp is not set, redirect to signUp if no cookie found, else login.
   *
   * If nextUrl is not supplied, it will be constructed from a path in
   * the "next" query parameter.
   */
  private async _redirectToLoginOrSignup(
    options: {
      signUp?: boolean;
      nextUrl?: URL;
      params?: Record<string, string | undefined>;
    },
    req: express.Request, resp: express.Response,
  ) {
    const url = await this.getSigninUrl(req, options);
    resp.redirect(url);
  }

  private async _redirectToHomeOrWelcomePage(
    mreq: RequestWithLogin,
    resp: express.Response,
    options: {redirectToMergedOrg?: boolean} = {}
  ) {
    const {redirectToMergedOrg} = options;
    const userId = getUserId(mreq);
    const domain = getOrgFromRequest(mreq);
    const orgs = this._dbManager.unwrapQueryResult(
      await this._dbManager.getOrgs(userId, domain, {
        ignoreEveryoneShares: true,
      })
    );
    if (orgs.length > 1) {
      resp.redirect(getOrgUrl(mreq, '/welcome/teams'));
    } else {
      resp.redirect(redirectToMergedOrg ? this.getMergedOrgUrl(mreq) : getOrgUrl(mreq));
    }
  }

  /**
   * If a valid cookie was set during sign-up to copy a document to the
   * user's Home workspace, copy it and return the id of the new document.
   *
   * If a valid cookie wasn't set or copying failed, return `null`.
   */
  private async _maybeCopyDocToHomeWorkspace(
    req: RequestWithLogin,
    resp: express.Response
  ): Promise<string|null> {
    const state = getAndClearSignupStateCookie(req, resp);
    if (!state) {
      return null;
    }

    const {srcDocId} = state;
    if (!srcDocId) { return null; }

    let newDocId: string | null = null;
    try {
      newDocId = await createSavedDoc(this, req, {srcDocId});
    } catch (e) {
      log.error(`FlexServer failed to copy doc ${srcDocId} to Home workspace`, e);
    }
    return newDocId;
  }

  /**
   * Creates set of middleware for handling logout requests and clears session. Used in any endpoint
   * or a page that needs to log out the user and clear the session.
   */
  private _logoutMiddleware() {
    const sessionClearMiddleware = expressWrap(async (req, resp, next) => {
      const scopedSession = this._sessions.getOrCreateSessionFromRequest(req);
      // Clear session so that user needs to log in again at the next request.
      // SAML logout in theory uses userSession, so clear it AFTER we compute the URL.
      // Express-session will save these changes.
      const expressSession = (req as RequestWithLogin).session;
      if (expressSession) { expressSession.users = []; expressSession.orgToUser = {}; }
      await scopedSession.clearScopedSession(req);
      // TODO: limit cache clearing to specific user.
      this._sessions.clearCacheIfNeeded();
      next();
    });
    const pluggedMiddleware = this._loginMiddleware.getLogoutMiddleware ?
      this._loginMiddleware.getLogoutMiddleware() :
      [];
    return [...pluggedMiddleware, sessionClearMiddleware];
  }

  /**
   * Returns true if GRIST_LOG_HTTP="true" (or any truthy value).
   * Returns true if GRIST_LOG_SKIP_HTTP="" (empty string).
   * Returns false otherwise.
   *
   * Also displays a deprecation warning if GRIST_LOG_SKIP_HTTP is set to any value ("", "true", whatever...),
   * and throws an exception if GRIST_LOG_SKIP_HTTP and GRIST_LOG_HTTP are both set to make the server crash.
   */
  private _httpLoggingEnabled(): boolean {
    const deprecatedOptionEnablesLog = process.env.GRIST_LOG_SKIP_HTTP === '';
    const isGristLogHttpEnabled = isAffirmative(process.env.GRIST_LOG_HTTP);

    if (process.env.GRIST_LOG_HTTP !== undefined && process.env.GRIST_LOG_SKIP_HTTP !== undefined) {
      throw new Error('Both GRIST_LOG_HTTP and GRIST_LOG_SKIP_HTTP are set. ' +
        'Please remove GRIST_LOG_SKIP_HTTP and set GRIST_LOG_HTTP to the value you actually want.');
    }

    if (process.env.GRIST_LOG_SKIP_HTTP !== undefined) {
      const expectedGristLogHttpVal = deprecatedOptionEnablesLog ? "true" : "false";

      log.warn(`Setting env variable GRIST_LOG_SKIP_HTTP="${process.env.GRIST_LOG_SKIP_HTTP}" `
        + `is deprecated in favor of GRIST_LOG_HTTP="${expectedGristLogHttpVal}"`);
    }

    return isGristLogHttpEnabled || deprecatedOptionEnablesLog;
  }

  private _logDeleteUserEvents(req: RequestWithLogin, user: User) {
    this.getAuditLogger().logEvent(req, {
      action: "user.delete",
      details: {
        user: {
          ...pick(user, "id", "name"),
          email: user.loginEmail,
        },
      },
    });
    this.getTelemetry().logEvent(req, "deletedAccount");
  }

  private _logDeleteSiteEvents(req: RequestWithLogin, org: Organization) {
    this.getAuditLogger().logEvent(req, {
      action: "site.delete",
      details: {
        site: pick(org, "id", "name", "domain"),
      },
    });
    this.getTelemetry().logEvent(req, "deletedSite", {
      full: {
        siteId: org.id,
        userId: req.userId,
      },
    });
  }
}

/**
 * Set flags on the server, related to timeouts.
 * Note if you try to set very long timeouts, e.g. for a gnarly
 * import, you may run into browser limits. In firefox a relevant
 * configuration variable is network.http.response.timeout -
 * if you set that high, and set the flags here high, and
 * set everything right in your reverse proxy, you should
 * be able to have very long imports. (Clearly, it would be
 * better if long imports were made using a mechanism that
 * isn't just a single http request)
 */
function getServerFlags(): https.ServerOptions {
  const flags: https.ServerOptions = {};

  // We used to set the socket timeout to 0, but that has been
  // the default now since Node 13.

  // The default timeouts that follow have a convoluted history.
  // Basically, Grist Labs had a SaaS with a load balancer
  // configured to have a 5 min idle timeout. It starts there.

  // Then, there was a complicated issue:
  //   https://adamcrowder.net/posts/node-express-api-and-aws-alb-502/
  // which meant that the Grist server's keepAlive timeout should be
  // longer than the load-balancer's. Otherwise it would produce occasional
  // 502 errors when it sends a request to node just as node closes a
  // connection.
  // So keepAliveTimeout was set to 5*60+5 seconds.

  // Then, there was another complicated issue:
  //   https://github.com/nodejs/node/issues/27363
  // which meant that the headersTimeout should be set higher than
  // the keepAliveTimeout.
  // So headersTimeout was set to 5*60+6 seconds.

  // Node 18 introduced a requestTimeout that defaults to 5 minutes.
  // That timeout is supposed to be longer than or same as headersTimeout.
  // So requestTimeout is set to 5*60+6 seconds.

  // Long story short, it is good to have these timeouts be longish
  // so imports don't get interrupted too early (but Grist should
  // probably change how long uploads are done).

  const requestTimeoutMs = appSettings.section('server').flag('requestTimeoutMs').requireInt({
    envVar: 'GRIST_REQUEST_TIMEOUT_MS',
    defaultValue: 306000,
  });
  flags.requestTimeout = requestTimeoutMs;

  const headersTimeoutMs = appSettings.section('server').flag('headersTimeoutMs').requireInt({
    envVar: 'GRIST_HEADERS_TIMEOUT_MS',
    defaultValue: 306000,
  });
  flags.headersTimeout = headersTimeoutMs;

  // Likewise keepAlive
  const keepAliveTimeoutMs = appSettings.section('server').flag('keepAliveTimeoutMs').requireInt({
    envVar: 'GRIST_KEEP_ALIVE_TIMEOUT_MS',
    defaultValue: 305000,
  });
  flags.keepAliveTimeout = keepAliveTimeoutMs;

  return flags;
}

/**
 * log some properties of the server.
 */
function logServer<T extends https.Server|http.Server>(server: T): T {
  log.info("Server timeouts: requestTimeout %s keepAliveTimeout %s headersTimeout %s",
           server.requestTimeout, server.keepAliveTimeout, server.headersTimeout);
  return server;
}

// Returns true if environment is configured to allow unauthenticated test logins.
function isTestLoginAllowed() {
  return isAffirmative(process.env.GRIST_TEST_LOGIN);
}

// Check OPTIONS requests for allowed origins, and return heads to allow the browser to proceed
// with a POST (or other method) request.
function trustOriginHandler(req: express.Request, res: express.Response, next: express.NextFunction) {
  res.header("Access-Control-Allow-Methods", "GET, PATCH, PUT, POST, DELETE, OPTIONS");
  if (trustOrigin(req, res)) {
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With");
  } else {
    // Any origin is allowed, but if it isn't trusted, then we don't allow credentials,
    // i.e. no Cookie or Authorization header.
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
    if (req.get("Cookie") || req.get("Authorization")) {
      // In practice we don't expect to actually reach this point,
      // as the browser should not include credentials in preflight (OPTIONS) requests,
      // and should block real requests with credentials based on the preflight response.
      // But having this means not having to rely on our understanding of browsers and CORS too much.
      throw new ApiError("Credentials not supported for cross-origin requests", 403);
    }
  }
  if ('OPTIONS' === req.method) {
    res.sendStatus(200);
  } else {
    next();
  }
}

// Methods that Electron app relies on.
export interface ElectronServerMethods {
  onDocOpen(cb: (filePath: string) => void): void;
  getUserConfig(): Promise<any>;
  updateUserConfig(obj: any): Promise<void>;
  onBackupMade(cb: () => void): void;
}

// Allow static files to be requested from any origin.
const serveAnyOrigin: serveStatic.ServeStaticOptions = {
  setHeaders: (res, filepath, stat) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
};

type Part =
  'activation'
  | 'api'
  | 'api-error'
  | 'api-mw'
  | 'assistant'
  | 'audit-logger'
  | 'billing-api'
  | 'boot'
  | 'cleanup'
  | 'clientSecret'
  | 'comm'
  | 'dir'
  | 'doc'
  | 'doc_api_forwarder'
  | 'early-api'
  | 'google-auth'
  | 'health'
  | 'homedb'
  | 'hosts'
  | 'housekeeper'
  | 'json'
  | 'landing'
  | 'log-endpoint'
  | 'logging'
  | 'login'
  | 'loginMiddleware'
  | 'map'
  | 'middleware'
  | 'notifier'
  | 'org'
  | 'pluginUntaggedAssets'
  | 'router'
  | 'scim'
  | 'sessions'
  | 'start'
  | 'static_and_bower'
  | 'strip_dw'
  | 'tag'
  | 'telemetry'
  | 'testAssets'
  | 'testinghooks'
  | 'update'
  | 'usage'
  | 'webhooks'
  | 'widgets';

type CheckKey = Part | `!${Part}`;
