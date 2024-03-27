/**
 * The server's Comm object implements communication with the client.
 *
 * The server receives requests, to which it sends a response (or an error). The server can
 * also send asynchronous messages to the client. Available methods should be provided via
 * comm.registerMethods().
 *
 * To send async messages, you may call broadcastMessage() or sendDocMessage().
 *
 * See app/client/components/Comm.ts for other details of the communication protocol.
 *
 *
 * This module relies on the concept of a "Client" (see Client.ts). A Client corresponds to a
 * browser window, and should persist across brief disconnects. A Client has a 'clientId'
 * property, which uniquely identifies a client within the currently running server. Method
 * registered with Comm always receive a Client object as the first argument.
 *
 * NOTES:
 *
 * The communication setup involves primarily the modules app/server/lib/{Comm,Client}.ts, and
 * app/client/components/{Comm,GristWSConnection}.ts. In particular, these implement reconnect
 * logic, which is particularly confusing as done here because it combines two layers:
 *
 * - Websocket-level reconnects, where an existing browser tab may reconnect and attempt to
 *   restore state seamlessly by recovering any missed messages.
 *
 * - Application-level reconnects, where even in case of a failed websocket-level reconnect (e.g.
 *   a reloaded browser tab, or existing tab that can't recover missed messages), the tab may
 *   connect to existing state. This matters for undo/redo history (to allow a user to undo after
 *   reloading a browser tab), but the only thing this relies on is preserving the clientId.
 *
 * In other words, there is an opportunity for untangling and simplifying.
 */

import {EventEmitter} from 'events';
import * as http from 'http';
import * as https from 'https';
import {GristSocketServer} from 'app/server/lib/GristSocketServer';
import {GristServerSocket} from 'app/server/lib/GristServerSocket';

import {parseFirstUrlPart} from 'app/common/gristUrls';
import {firstDefined, safeJsonParse} from 'app/common/gutil';
import {UserProfile} from 'app/common/LoginSessionAPI';
import * as version from 'app/common/version';
import {ScopedSession} from "app/server/lib/BrowserSession";
import {Client, ClientMethod} from "app/server/lib/Client";
import {Hosts, RequestWithOrg} from 'app/server/lib/extractOrg';
import {GristLoginMiddleware} from 'app/server/lib/GristServer';
import log from 'app/server/lib/log';
import {localeFromRequest} from 'app/server/lib/ServerLocale';
import {fromCallback} from 'app/server/lib/serverUtils';
import {Sessions} from 'app/server/lib/Sessions';
import {i18n} from 'i18next';
import { trustOrigin } from './requestUtils';

export interface CommOptions {
  sessions: Sessions;                   // A collection of all sessions for this instance of Grist
  settings?: {[key: string]: unknown};  // The config object containing instance settings including features.
  hosts?: Hosts;  // If set, we use hosts.getOrgInfo(req) to extract an organization from a (possibly versioned) url.
  loginMiddleware?: GristLoginMiddleware; // If set, use custom getProfile method if available
  httpsServer?: https.Server;   // An optional HTTPS server to listen on too.
  i18Instance?: i18n;           // The i18next instance to use for translations.
}

/**
 * Constructs a Comm object.
 * @param {Object} server - The HTTP server.
 * @param {Object} options.sessions - A collection of sessions
 * @param {Object} options.settings - The config object containing instance settings
 *  including features.
 * @param {Object} options.instanceManager - Instance manager, giving access to InstanceStore
 *  and per-instance objects. If null, HubUserClient will not be created.
 * @param {Object} options.hosts - Hosts object from extractOrg.ts. if set, we use
 *  hosts.getOrgInfo(req) to extract an organization from a (possibly versioned) url.
 */
export class Comm extends EventEmitter {
  // Collection of all sessions; maps sessionIds to ScopedSession objects.
  public readonly sessions: Sessions = this._options.sessions;
  private _wss: GristSocketServer[]|null = null;

  private _clients = new Map<string, Client>();   // Maps clientIds to Client objects.

  private _methods = new Map<string, ClientMethod>();  // Maps method names to their implementation.

  // For testing, we need a way to override the server version reported.
  // For upgrading, we use this to set the server version for a defunct server
  // to "dead" so that a client will know that it needs to periodically recheck
  // for a valid server.
  private _serverVersion: string|null = null;

  constructor(private _server: http.Server, private _options: CommOptions) {
    super();
    this._wss = this._startServer();
  }

  /**
   * Registers server methods.
   * @param {Object[String:Function]} Mapping of method name to their implementations. All methods
   *      receive the client as the first argument, and the arguments from the request.
   */
  public registerMethods(serverMethods: {[name: string]: ClientMethod}): void {
    // Wrap methods to translate return values and exceptions to promises.
    for (const methodName in serverMethods) {
      this._methods.set(methodName, serverMethods[methodName]);
    }
  }

  /**
   * Returns the Client object associated with the given clientId, or throws an Error if not found.
   */
  public getClient(clientId: string): Client {
    const client = this._clients.get(clientId);
    if (!client) { throw new Error('Unrecognized clientId'); }
    return client;
  }

  /**
   * Returns a ScopedSession object with the given session id from the list of sessions,
   *  or adds a new one and returns that.
   */
  public getOrCreateSession(sessionId: string, req: {org?: string}, userSelector: string = ''): ScopedSession {
    // ScopedSessions are specific to a session id / org combination.
    const org = req.org || "";
    return this.sessions.getOrCreateSession(sessionId, org, userSelector);
  }


  /**
   * Returns the sessionId from the signed grist cookie.
   */
  public getSessionIdFromCookie(gristCookie: string): string|null {
    return this.sessions.getSessionIdFromCookie(gristCookie) || null;
  }

  /**
   * Broadcasts an app-level message to all clients. Only suitable for non-doc-specific messages.
   */
  public broadcastMessage(type: 'docListAction', data: unknown) {
    for (const client of this._clients.values()) {
      client.sendMessage({type, data}).catch(() => {});
    }
  }

  public removeClient(client: Client) {
    this._clients.delete(client.clientId);
  }

  public async testServerShutdown() {
    if (this._wss) {
      for (const wssi of this._wss) {
        await fromCallback((cb) => wssi.close(cb));
      }
      this._wss = null;
    }
  }

  public async testServerRestart() {
    await this.testServerShutdown();
    this._wss = this._startServer();
  }

  /**
   * Destroy all clients, forcing reconnections.
   */
  public destroyAllClients() {
    // Iterate over all clients.  Take a copy of the list of clients since it will be changing
    // during the loop as we remove them one by one.
    for (const client of Array.from(this._clients.values())) {
      client.interruptConnection();
      client.destroy();
    }
  }

  /**
   * Override the version string Comm will report to clients.
   * Call with null to reset the override.
   *
   */
  public setServerVersion(serverVersion: string|null) {
    this._serverVersion = serverVersion;
  }

  /**
   * Mark the server as active or inactive.  If inactive, any client that manages to
   * connect to it will read a server version of "dead".
   */
  public setServerActivation(active: boolean) {
    this._serverVersion = active ? null : 'dead';
  }

  /**
   * Returns a profile based on the request or session.
   */
  private async _getSessionProfile(scopedSession: ScopedSession, req: http.IncomingMessage): Promise<UserProfile|null> {
    return await firstDefined(
      async () => this._options.loginMiddleware?.overrideProfile?.(req),
      async () => scopedSession.getSessionProfile(),
    ) || null;
  }

  /**
   * Processes a new websocket connection, and associates the websocket and a Client object.
   */
  private async _onWebSocketConnection(websocket: GristServerSocket, req: http.IncomingMessage) {

    // Parse the cookie in the request to get the sessionId.
    const sessionId = this.sessions.getSessionIdFromRequest(req);

    const params = new URL(req.url!, `ws://${req.headers.host}`).searchParams;
    const existingClientId = params.get('clientId');
    const browserSettings = safeJsonParse(params.get('browserSettings') || '', {});
    const newClient = (params.get('newClient') !== '0');  // Treat omitted as new, for the sake of tests.
    const lastSeqIdStr = params.get('lastSeqId');
    const lastSeqId = lastSeqIdStr ? parseInt(lastSeqIdStr) : null;
    const counter = params.get('counter');
    const userSelector = params.get('user') || '';

    const scopedSession = this.getOrCreateSession(sessionId!, req as RequestWithOrg, userSelector);
    const profile = await this._getSessionProfile(scopedSession, req);

    // Associate an ID with each websocket, reusing the supplied one if it's valid.
    let client: Client|undefined = this._clients.get(existingClientId!);
    let reuseClient = true;
    if (!client?.canAcceptConnection()) {
      reuseClient = false;
      client = new Client(this, this._methods, localeFromRequest(req), this._options.i18Instance);
      this._clients.set(client.clientId, client);
    }

    log.rawInfo('Comm: Got Websocket connection', {...client.getLogMeta(), urlPath: req.url, reuseClient});

    client.setSession(scopedSession);                 // Add a Session object to the client.
    client.setOrg((req as RequestWithOrg).org || "");
    client.setProfile(profile);
    client.setConnection(websocket, counter, browserSettings);

    await client.sendConnectMessage(newClient, reuseClient, lastSeqId, {
      serverVersion: this._serverVersion || version.gitcommit,
      settings: this._options.settings,
    });
  }

  private _startServer() {
    const servers = [this._server];
    if (this._options.httpsServer) { servers.push(this._options.httpsServer); }
    const wss = [];
    for (const server of servers) {
      const wssi = new GristSocketServer(server, {
        verifyClient: async (req: http.IncomingMessage) => {
          if (this._options.hosts) {
            // DocWorker ID (/dw/) and version tag (/v/) may be present in this request but are not
            // needed. addOrgInfo assumes req.url starts with /o/ if present.
            req.url = parseFirstUrlPart('dw', req.url!).path;
            req.url = parseFirstUrlPart('v', req.url).path;
            await this._options.hosts.addOrgInfo(req);
          }

          return trustOrigin(req);
        }
      });

      wssi.onconnection = async (websocket: GristServerSocket, req) => {
        try {
          await this._onWebSocketConnection(websocket, req);
        } catch (e) {
          log.error("Comm connection for %s threw exception: %s", req.url, e.message);
          websocket.terminate();  // close() is inadequate when ws routed via loadbalancer
        }
      };
      wss.push(wssi);
    }
    return wss;
  }
}
