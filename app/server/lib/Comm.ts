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
 */

import {EventEmitter} from 'events';
import * as http from 'http';
import * as https from 'https';
import * as WebSocket from 'ws';

import {CommDocEventType, CommMessage} from 'app/common/CommTypes';
import {parseFirstUrlPart} from 'app/common/gristUrls';
import {safeJsonParse} from 'app/common/gutil';
import {UserProfile} from 'app/common/LoginSessionAPI';
import * as version from 'app/common/version';
import {getRequestProfile} from 'app/server/lib/Authorizer';
import {ScopedSession} from "app/server/lib/BrowserSession";
import {Client, ClientMethod} from "app/server/lib/Client";
import {Hosts, RequestWithOrg} from 'app/server/lib/extractOrg';
import * as log from 'app/server/lib/log';
import {localeFromRequest} from 'app/server/lib/ServerLocale';
import {fromCallback} from 'app/server/lib/serverUtils';
import {Sessions} from 'app/server/lib/Sessions';

export interface CommOptions {
  sessions: Sessions;                   // A collection of all sessions for this instance of Grist
  settings?: {[key: string]: unknown};  // The config object containing instance settings including features.
  hosts?: Hosts;  // If set, we use hosts.getOrgInfo(req) to extract an organization from a (possibly versioned) url.
  httpsServer?: https.Server;   // An optional HTTPS server to listen on too.
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
  public readonly sessions: Sessions;
  private _wss: WebSocket.Server[]|null = null;

  // The config object containing instance settings including features.
  private _settings?: {[key: string]: unknown};

  // If set, we use hosts.getOrgInfo(req) to extract an organization from a (possibly versioned) url.
  private _hosts?: Hosts;

  // An optional HTTPS server to listen on too.
  private _httpsServer?: https.Server;

  private _clients = new Map<string, Client>();   // Maps clientIds to Client objects.

  private _methods = new Map<string, ClientMethod>();  // Maps method names to their implementation.

  // For testing, we need a way to override the server version reported.
  // For upgrading, we use this to set the server version for a defunct server
  // to "dead" so that a client will know that it needs to periodically recheck
  // for a valid server.
  private _serverVersion: string|null = null;

  constructor(private _server: http.Server, options: CommOptions) {
    super();
    this._httpsServer = options.httpsServer;
    this._wss = this._startServer();

    this.sessions = options.sessions;
    this._settings = options.settings;
    this._hosts = options.hosts;
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
    return getRequestProfile(req) || scopedSession.getSessionProfile();
  }

  /**
   * Processes a new websocket connection, and associates the websocket and a Client object.
   */
  private async _onWebSocketConnection(websocket: WebSocket, req: http.IncomingMessage) {
    log.info("Comm: Got WebSocket connection: %s", req.url);
    if (this._hosts) {
      // DocWorker ID (/dw/) and version tag (/v/) may be present in this request but are not
      // needed. addOrgInfo assumes req.url starts with /o/ if present.
      req.url = parseFirstUrlPart('dw', req.url!).path;
      req.url = parseFirstUrlPart('v', req.url).path;
      await this._hosts.addOrgInfo(req);
    }

    // Parse the cookie in the request to get the sessionId.
    const sessionId = this.sessions.getSessionIdFromRequest(req);

    const params = new URL(req.url!, `http://${req.headers.host}`).searchParams;
    const existingClientId = params.get('clientId');
    const browserSettings = safeJsonParse(params.get('browserSettings') || '', {});
    const newClient = (params.get('newClient') === '1');
    const counter = params.get('counter');
    const userSelector = params.get('user') || '';

    // Associate an ID with each websocket, reusing the supplied one if it's valid.
    let client: Client|undefined = this._clients.get(existingClientId!);
    if (!client || !await client.reconnect(counter, newClient)) {
      client = new Client(this, this._methods, localeFromRequest(req), counter);
      this._clients.set(client.clientId, client);
    }
    // Add a Session object to the client.
    log.info(`Comm ${client}: using session ${sessionId}`);
    const scopedSession = this.getOrCreateSession(sessionId!, req as RequestWithOrg, userSelector);
    client.setSession(scopedSession);

    // Associate the client with this websocket.
    client.setConnection(websocket, browserSettings);

    const profile = await this._getSessionProfile(scopedSession, req);
    client.setOrg((req as RequestWithOrg).org || "");
    client.setProfile(profile);

    client.sendConnectMessage({
      serverVersion: this._serverVersion || version.gitcommit,
      settings: this._settings,
    })
    .catch(err => {
      log.error(`Comm ${client}: failed to prepare or send clientConnect:`, err);
    });
  }

  private _startServer() {
    const servers = [this._server];
    if (this._httpsServer) { servers.push(this._httpsServer); }
    const wss = [];
    for (const server of servers) {
      const wssi = new WebSocket.Server({server});
      wssi.on('connection', async (websocket: WebSocket, req) => {
        try {
          await this._onWebSocketConnection(websocket, req);
        } catch (e) {
          log.error("Comm connection for %s threw exception: %s", req.url, e.message);
          websocket.removeAllListeners();
          websocket.terminate();  // close() is inadequate when ws routed via loadbalancer
        }
      });
      wss.push(wssi);
    }
    return wss;
  }
}

/**
 * Sends a per-doc message to the given client.
 * @param {Object} client - The client object, as passed to all per-doc methods.
 * @param {Number} docFD - The document's file descriptor in the given client.
 * @param {String} type - The type of the message, e.g. 'docUserAction'.
 * @param {Object} messageData - The data for this type of message.
 * @param {Boolean} fromSelf - Whether `client` is the originator of this message.
 */
export function sendDocMessage(
  client: Client, docFD: number, type: CommDocEventType, data: unknown, fromSelf?: boolean
) {
  // TODO Warning disabled to preserve past behavior, but perhaps better to return the Promise?
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  client.sendMessage({type, docFD, data, fromSelf} as CommMessage);
}
