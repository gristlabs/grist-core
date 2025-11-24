import { ICustomWidget } from 'app/common/CustomWidget';
import { GristDeploymentType, GristLoadConfig, LatestVersionAvailable } from 'app/common/gristUrls';
import { LocalPlugin } from 'app/common/plugin';
import { SandboxInfo } from 'app/common/SandboxInfo';
import { UserProfile } from 'app/common/UserAPI';
import { Document } from 'app/gen-server/entity/Document';
import { Organization } from 'app/gen-server/entity/Organization';
import { User } from 'app/gen-server/entity/User';
import { Workspace } from 'app/gen-server/entity/Workspace';
import { ActivationsManager } from 'app/gen-server/lib/ActivationsManager';
import { Doom } from 'app/gen-server/lib/Doom';
import { HomeDBManager, UserChange } from 'app/gen-server/lib/homedb/HomeDBManager';
import { IAccessTokens } from 'app/server/lib/AccessTokens';
import { RequestWithLogin } from 'app/server/lib/Authorizer';
import { Comm } from 'app/server/lib/Comm';
import { create } from 'app/server/lib/create';
import { DocManager } from 'app/server/lib/DocManager';
import { Hosts } from 'app/server/lib/extractOrg';
import { GristJobs } from 'app/server/lib/GristJobs';
import { IAssistant } from 'app/server/lib/IAssistant';
import { createNullAuditLogger, IAuditLogger } from 'app/server/lib/IAuditLogger';
import { IBilling } from 'app/server/lib/IBilling';
import { ICreate } from 'app/server/lib/ICreate';
import { IDocStorageManager } from 'app/server/lib/IDocStorageManager';
import { IDocNotificationManager } from 'app/server/lib/IDocNotificationManager';
import { INotifier } from 'app/server/lib/INotifier';
import { InstallAdmin } from 'app/server/lib/InstallAdmin';
import { IPermitStore } from 'app/server/lib/Permit';
import { IPubSubManager } from 'app/server/lib/PubSubManager';
import { ISendAppPageOptions } from 'app/server/lib/sendAppPage';
import { fromCallback } from 'app/server/lib/serverUtils';
import { Sessions } from 'app/server/lib/Sessions';
import { ITelemetry } from 'app/server/lib/Telemetry';
import { IWidgetRepository } from 'app/server/lib/WidgetRepository';
import { IGristCoreConfig, loadGristCoreConfig } from "app/server/lib/configCore";
import * as express from 'express';
import { IncomingMessage } from 'http';

/**
 *
 * Coordinate storage for documents across file systems,
 * external storage, and the home database.
 *
 */
export interface StorageCoordinator {
  hardDeleteDoc(docId: string): Promise<void>;
}

/**
 * Basic information about a Grist server.  Accessible in many
 * contexts, including request handlers and ActiveDoc methods.
 */
export interface GristServer extends StorageCoordinator {
  readonly create: ICreate;
  settings?: IGristCoreConfig;
  getHost(): string;
  getHomeUrl(req: express.Request, relPath?: string): string;
  getHomeInternalUrl(relPath?: string): string;
  getHomeUrlByDocId(docId: string, relPath?: string): Promise<string>;
  getOwnUrl(): string;
  getOrgUrl(orgKey: string|number): Promise<string>;
  getMergedOrgUrl(req: RequestWithLogin, pathname?: string): string;
  getResourceUrl(resource: Organization|Workspace|Document,
                 purpose?: 'api'|'html'): Promise<string>;
  getGristConfig(): GristLoadConfig;
  getPermitStore(): IPermitStore;
  getExternalPermitStore(): IPermitStore;
  getSessions(): Sessions;
  getComm(): Comm;
  getDeploymentType(): GristDeploymentType;
  getHosts(): Hosts;
  getActivations(): ActivationsManager;
  getInstallAdmin(): InstallAdmin;
  getHomeDBManager(): HomeDBManager;
  getStorageManager(): IDocStorageManager;
  getAuditLogger(): IAuditLogger;
  getTelemetry(): ITelemetry;
  getWidgetRepository(): IWidgetRepository;
  hasNotifier(): boolean;
  getNotifier(): INotifier;
  getDocNotificationManager(): IDocNotificationManager|undefined;
  getPubSubManager(): IPubSubManager;
  getAssistant(): IAssistant|undefined;
  getDocTemplate(): Promise<DocTemplate>;
  getTag(): string;
  sendAppPage(req: express.Request, resp: express.Response, options: ISendAppPageOptions): Promise<void>;
  getAccessTokens(): IAccessTokens;
  resolveLoginSystem(): Promise<GristLoginSystem>;
  getPluginUrl(): string|undefined;
  getPlugins(): LocalPlugin[];
  servesPlugins(): boolean;
  getBundledWidgets(): ICustomWidget[];
  getBootKey(): string|undefined;
  getSandboxInfo(): Promise<SandboxInfo>;
  getInfo(key: string): any;
  getJobs(): GristJobs;
  getBilling(): IBilling;
  getDoomTool(): Promise<Doom>;
  getLatestVersionAvailable(): LatestVersionAvailable|undefined;
  setLatestVersionAvailable(latestVersionAvailable: LatestVersionAvailable): void
  publishLatestVersionAvailable(latestVersionAvailable: LatestVersionAvailable): Promise<void>;
  setRestrictedMode(restrictedMode?: boolean): void;
  getDocManager(): DocManager;
  isRestrictedMode(): boolean;
  onUserChange(callback: (change: UserChange) => Promise<void>): void;
  onStreamingDestinationsChange(callback: (orgId?: number) => Promise<void>): void;
  setReady(value: boolean): void;
  getSigninUrl(req: express.Request, options: {
    signUp?: boolean;
    nextUrl?: URL;
    params?: Record<string, string | undefined>;
  }): Promise<string>;
  getUserIdMiddleware(): express.RequestHandler;
}

export interface GristLoginSystem {
  getMiddleware(gristServer: GristServer): Promise<GristLoginMiddleware>;
  deleteUser(user: User): Promise<void>;
}

export interface GristLoginMiddleware {
  getLoginRedirectUrl(req: express.Request, target: URL): Promise<string>;
  getSignUpRedirectUrl(req: express.Request, target: URL): Promise<string>;
  getLogoutRedirectUrl(req: express.Request, nextUrl: URL): Promise<string>;
  // Optional middleware for the GET /login, /signup, and /signin routes.
  getLoginOrSignUpMiddleware?(): express.RequestHandler[];
  // Optional middleware for the GET /logout route.
  getLogoutMiddleware?(): express.RequestHandler[];
  // Optional middleware for all routes.
  getWildcardMiddleware?(): express.RequestHandler[];
  // Returns arbitrary string for log.
  addEndpoints(app: express.Express): Promise<string>;
  // Normally, the profile is obtained from the user's session object, which is set at login, and
  // is identified by a session cookie. When given, overrideProfile() will be called first to
  // extract the profile from each request. Result can be a profile, or null if anonymous
  // (sessions will then not be used), or undefined to fall back to using session info.
  overrideProfile?(req: express.Request|IncomingMessage): Promise<UserProfile|null|undefined>;
  // Called on first visit to an app page after a signup, for reporting or telemetry purposes.
  onFirstVisit?(req: express.Request): void;
}

/**
 * Set the user in the current session.
 */
export async function setUserInSession(req: express.Request, gristServer: GristServer, profile: UserProfile) {
  const scopedSession = gristServer.getSessions().getOrCreateSessionFromRequest(req);
  // Make sure session is up to date before operating on it.
  // Behavior on a completely fresh session is a little awkward currently.
  const reqSession = (req as any).session;
  if (reqSession?.save) {
    await fromCallback(cb => reqSession.save(cb));
  }
  await scopedSession.updateUserProfile(req, profile);
}

export interface RequestWithGrist extends express.Request {
  gristServer?: GristServer;
}

export interface DocTemplate {
  page: string,
  tag: string,
}

/**
 * A very minimal GristServer object that throws an error if its bluff is
 * called.
 */
export function createDummyGristServer(): GristServer {
  return {
    create,
    settings: loadGristCoreConfig(),
    getHost() { return 'localhost:4242'; },
    getHomeUrl() { return 'http://localhost:4242'; },
    getHomeInternalUrl() { return 'http://localhost:4242'; },
    getHomeUrlByDocId() { return Promise.resolve('http://localhost:4242'); },
    getMergedOrgUrl() { return 'http://localhost:4242'; },
    getOwnUrl() { return 'http://localhost:4242'; },
    getPermitStore() { throw new Error('no permit store'); },
    getExternalPermitStore() { throw new Error('no external permit store'); },
    getGristConfig() { return { homeUrl: '', timestampMs: 0, serveSameOrigin: true, checkForLatestVersion: false }; },
    getOrgUrl() { return Promise.resolve(''); },
    getResourceUrl() { return Promise.resolve(''); },
    getSessions() { throw new Error('no sessions'); },
    getComm() { throw new Error('no comms'); },
    getDeploymentType() { return 'core'; },
    getHosts() { throw new Error('no hosts'); },
    getActivations() { throw new Error('no activations'); },
    getInstallAdmin() { throw new Error('no install admin'); },
    getHomeDBManager() { throw new Error('no db'); },
    getStorageManager() { throw new Error('no storage manager'); },
    getAuditLogger() { return createNullAuditLogger(); },
    getTelemetry() { return createDummyTelemetry(); },
    getWidgetRepository() { throw new Error('no widget repository'); },
    getNotifier() { throw new Error('no notifier'); },
    getDocNotificationManager(): IDocNotificationManager|undefined { return undefined; },
    getPubSubManager(): IPubSubManager { throw new Error('no PubSubManager'); },
    hasNotifier() { return false; },
    getAssistant() { return undefined; },
    getDocTemplate() { throw new Error('no doc template'); },
    getTag() { return 'tag'; },
    sendAppPage() { return Promise.resolve(); },
    getAccessTokens() { throw new Error('no access tokens'); },
    resolveLoginSystem() { throw new Error('no login system'); },
    getPluginUrl() { return undefined; },
    servesPlugins() { return false; },
    getPlugins() { return []; },
    getBundledWidgets() { return []; },
    getBootKey() { return undefined; },
    getSandboxInfo() { throw new Error('no sandbox'); },
    getInfo(key: string) { return undefined; },
    getJobs(): GristJobs { throw new Error('no job system'); },
    getBilling() { throw new Error('no billing'); },
    getDoomTool() { throw new Error('no doom tool'); },
    getLatestVersionAvailable() { throw new Error('no version checking'); },
    setLatestVersionAvailable() { /* do nothing */ },
    publishLatestVersionAvailable() { return Promise.resolve(); },
    setRestrictedMode() { /* do nothing */ },
    getDocManager() { throw new Error('no DocManager'); },
    isRestrictedMode() { return false; },
    onUserChange() { /* do nothing */ },
    onStreamingDestinationsChange() { /* do nothing */ },
    hardDeleteDoc() { return Promise.resolve(); },
    setReady() { /* do nothing */ },
    getSigninUrl() { return Promise.resolve(''); },
    getUserIdMiddleware() { throw new Error('no user id middleware'); },
  };
}

export function createDummyTelemetry(): ITelemetry {
  return {
    addEndpoints() { /* do nothing */ },
    start() { return Promise.resolve(); },
    logEvent() { /* do nothing */ },
    logEventAsync() { return Promise.resolve(); },
    shouldLogEvent() { return false; },
    getTelemetryConfig() { return undefined; },
    fetchTelemetryPrefs() { return Promise.resolve(); },
  };
}
