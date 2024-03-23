import { ICustomWidget } from 'app/common/CustomWidget';
import { GristDeploymentType, GristLoadConfig } from 'app/common/gristUrls';
import { LocalPlugin } from 'app/common/plugin';
import { UserProfile } from 'app/common/UserAPI';
import { Document } from 'app/gen-server/entity/Document';
import { Organization } from 'app/gen-server/entity/Organization';
import { User } from 'app/gen-server/entity/User';
import { Workspace } from 'app/gen-server/entity/Workspace';
import { Activations } from 'app/gen-server/lib/Activations';
import { HomeDBManager } from 'app/gen-server/lib/HomeDBManager';
import { IAccessTokens } from 'app/server/lib/AccessTokens';
import { RequestWithLogin } from 'app/server/lib/Authorizer';
import { Comm } from 'app/server/lib/Comm';
import { create } from 'app/server/lib/create';
import { Hosts } from 'app/server/lib/extractOrg';
import { ICreate } from 'app/server/lib/ICreate';
import { IDocStorageManager } from 'app/server/lib/IDocStorageManager';
import { INotifier } from 'app/server/lib/INotifier';
import { InstallAdmin } from 'app/server/lib/InstallAdmin';
import { IPermitStore } from 'app/server/lib/Permit';
import { ISendAppPageOptions } from 'app/server/lib/sendAppPage';
import { fromCallback } from 'app/server/lib/serverUtils';
import { Sessions } from 'app/server/lib/Sessions';
import { ITelemetry } from 'app/server/lib/Telemetry';
import * as express from 'express';
import { IncomingMessage } from 'http';

/**
 * Basic information about a Grist server.  Accessible in many
 * contexts, including request handlers and ActiveDoc methods.
 */
export interface GristServer {
  readonly create: ICreate;
  settings?: Readonly<Record<string, unknown>>;
  getHost(): string;
  getHomeUrl(req: express.Request, relPath?: string): string;
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
  getActivations(): Activations;
  getInstallAdmin(): InstallAdmin;
  getHomeDBManager(): HomeDBManager;
  getStorageManager(): IDocStorageManager;
  getTelemetry(): ITelemetry;
  getNotifier(): INotifier;
  getDocTemplate(): Promise<DocTemplate>;
  getTag(): string;
  sendAppPage(req: express.Request, resp: express.Response, options: ISendAppPageOptions): Promise<void>;
  getAccessTokens(): IAccessTokens;
  resolveLoginSystem(): Promise<GristLoginSystem>;
  getPluginUrl(): string|undefined;
  getPlugins(): LocalPlugin[];
  servesPlugins(): boolean;
  getBundledWidgets(): ICustomWidget[];
  hasBoot(): boolean;
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
    settings: {},
    getHost() { return 'localhost:4242'; },
    getHomeUrl() { return 'http://localhost:4242'; },
    getHomeUrlByDocId() { return Promise.resolve('http://localhost:4242'); },
    getMergedOrgUrl() { return 'http://localhost:4242'; },
    getOwnUrl() { return 'http://localhost:4242'; },
    getPermitStore() { throw new Error('no permit store'); },
    getExternalPermitStore() { throw new Error('no external permit store'); },
    getGristConfig() { return { homeUrl: '', timestampMs: 0 }; },
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
    getTelemetry() { return createDummyTelemetry(); },
    getNotifier() { throw new Error('no notifier'); },
    getDocTemplate() { throw new Error('no doc template'); },
    getTag() { return 'tag'; },
    sendAppPage() { return Promise.resolve(); },
    getAccessTokens() { throw new Error('no access tokens'); },
    resolveLoginSystem() { throw new Error('no login system'); },
    getPluginUrl() { return undefined; },
    servesPlugins() { return false; },
    getPlugins() { return []; },
    getBundledWidgets() { return []; },
    hasBoot() { return false; },
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
