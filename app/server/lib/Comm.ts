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

import { ApiError } from "app/common/ApiError";
import { parseFirstUrlPart } from "app/common/gristUrls";
import { safeJsonParse } from "app/common/gutil";
import * as version from "app/common/version";
import { HomeDBAuth } from "app/gen-server/lib/homedb/Interfaces";
import { resolveIdentity } from "app/server/lib/Authorizer";
import { AuthSession } from "app/server/lib/AuthSession";
import { ScopedSession } from "app/server/lib/BrowserSession";
import { Client, ClientMethod } from "app/server/lib/Client";
import { Hosts, RequestWithOrg } from "app/server/lib/extractOrg";
import { GristLoginMiddleware, GristServer } from "app/server/lib/GristServer";
import { GristServerSocket } from "app/server/lib/GristServerSocket";
import { GristSocketServer } from "app/server/lib/GristSocketServer";
import log from "app/server/lib/log";
import { IPermitStore } from "app/server/lib/Permit";
import { trustOrigin } from "app/server/lib/requestUtils";
import { localeFromRequest } from "app/server/lib/ServerLocale";
import { fromCallback } from "app/server/lib/serverUtils";
import { Sessions } from "app/server/lib/Sessions";

import { EventEmitter } from "events";
import * as http from "http";
import net from "net";

import { i18n } from "i18next";

export interface CommOptions {
  sessions: Sessions;                   // A collection of all sessions for this instance of Grist
  dbManager?: HomeDBAuth;                // HomeDBManager, just the part needed for auth.
  settings?: { [key: string]: unknown };  // The config object containing instance settings including features.
  hosts?: Hosts;  // If set, we use hosts.getOrgInfo(req) to extract an organization from a (possibly versioned) url.
  loginMiddleware?: GristLoginMiddleware; // If set, use custom getProfile method if available
  i18Instance?: i18n;           // The i18next instance to use for translations.
  gristServer?: GristServer;            // The GristServer instance, needed for resolveIdentity.
  permitStore?: IPermitStore;            // Permit store, needed for resolveIdentity.
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
  private _socketServer: GristSocketServer;

  private _clients = new Map<string, Client>();   // Maps clientIds to Client objects.

  private _methods = new Map<string, ClientMethod>();  // Maps method names to their implementation.

  // For testing, we need a way to override the server version reported.
  // For upgrading, we use this to set the server version for a defunct server
  // to "dead" so that a client will know that it needs to periodically recheck
  // for a valid server.
  private _serverVersion: string | null = null;

  constructor(private _options: CommOptions) {
    super();
    this._socketServer = this._createSocketServer();
  }

  /**
   * Registers server methods.
   * @param {Object[String:Function]} Mapping of method name to their implementations. All methods
   *      receive the client as the first argument, and the arguments from the request.
   */
  public registerMethods(serverMethods: { [name: string]: ClientMethod }): void {
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
    if (!client) { throw new Error("Unrecognized clientId"); }
    return client;
  }

  /**
   * Broadcasts an app-level message to all clients. Only suitable for non-doc-specific messages.
   */
  public broadcastMessage(type: "docListAction", data: unknown) {
    for (const client of this._clients.values()) {
      client.sendMessage({ type, data }).catch(() => {});
    }
  }

  public removeClient(client: Client) {
    this._clients.delete(client.clientId);
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
  public setServerVersion(serverVersion: string | null) {
    this._serverVersion = serverVersion;
  }

  /**
   * Mark the server as active or inactive.  If inactive, any client that manages to
   * connect to it will read a server version of "dead".
   */
  public setServerActivation(active: boolean) {
    this._serverVersion = active ? null : "dead";
  }

  public async close(): Promise<void> {
    await fromCallback(cb => this._socketServer.close(cb));
  }

  public listen() {
    this._socketServer.listen();
  }

  public async restart(): Promise<void> {
    await this.close();
    this.listen();
  }

  /**
   * Handles an incoming HTTP request from an http.Server or https.Server.
   * Must be connected for this to function correctly.
   * @returns {Promise<boolean>} - true if the request was handled, false otherwise
   */
  public async handleHTTPRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    return this._socketServer.handleHTTPRequest(req, res);
  }

  /**
   * Handles an incoming HTTP Upgrade request from an http.Server or https.Server.
   * Must be connected for this to function correctly.
   * @returns {Promise<boolean>} - true if the request was handled, false otherwise
   */
  public async handleHTTPUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): Promise<boolean> {
    return this._socketServer.handleHTTPUpgrade(req, socket, head);
  }

  /**
   * Processes a new websocket connection, and associates the websocket and a Client object.
   */
  private async _onWebSocketConnection(websocket: GristServerSocket, req: http.IncomingMessage) {
    const params = new URL(req.url!, `ws://${req.headers.host}`).searchParams;
    const existingClientId = params.get("clientId");
    const browserSettings = safeJsonParse(params.get("browserSettings") || "", {});
    const newClient = (params.get("newClient") !== "0");  // Treat omitted as new, for the sake of tests.
    const lastSeqIdStr = params.get("lastSeqId");
    const lastSeqId = lastSeqIdStr ? parseInt(lastSeqIdStr) : null;
    const counter = params.get("counter");
    const userSelector = params.get("user") || "";

    const dbManager = this._options.dbManager;
    let authSession: AuthSession;
    if (!dbManager || !this._options.gristServer || !this._options.permitStore) {
      authSession = AuthSession.unauthenticated();
    } else {
      let scopedSession: ScopedSession | undefined;
      const identity = await resolveIdentity(req, dbManager, {
        gristServer: this._options.gristServer,
        permitStore: this._options.permitStore,
        overrideProfile: this._options.loginMiddleware?.overrideProfile,
        getSessionProfile: async () => {
          const sessionId = this.sessions.getSessionIdFromRequest(req);
          scopedSession = this.sessions.getOrCreateSession(
            sessionId!, (req as RequestWithOrg).org, userSelector);
          // Use scopedSession directly — overrideProfile is passed separately
          // to resolveIdentity and checked there, so we don't call
          // _getSessionProfile here (which would check it a second time).
          const profile = await scopedSession.getSessionProfile();
          return { profile };
        },
      });

      if (identity.user.disabledAt) {
        throw new ApiError("User is disabled", 403);
      }

      const org = (req as RequestWithOrg).org || "";
      const fullUser = dbManager.makeFullUser(identity.user);
      const altSessionId = scopedSession?.getAltSessionId();
      authSession = AuthSession.fromUser(fullUser, org, altSessionId, identity.credential, identity.hasApiKey);
    }

    // Associate an ID with each websocket, reusing the supplied one if it's valid and for the same user.
    let client: Client | undefined = this._clients.get(existingClientId!);
    let reuseClient = true;
    if (!client?.canAcceptConnection(authSession)) {
      reuseClient = false;
      client = new Client(this, this._methods, localeFromRequest(req), this._options.i18Instance);
      this._clients.set(client.clientId, client);
    }

    log.rawInfo("Comm: Got Websocket connection", { ...client.getLogMeta(), urlPath: req.url, reuseClient });

    client.setConnection({ websocket, req, counter, browserSettings, authSession });

    await client.sendConnectMessage(newClient, reuseClient, lastSeqId, {
      serverVersion: this._serverVersion || version.gitcommit,
      settings: this._options.settings,
    });
  }

  private _createSocketServer() {
    const socketServer = new GristSocketServer({
      verifyClient: req => verifyCommHttpRequest(req, this._options.hosts, { preserveOriginalUrl: false }),
    });

    socketServer.onconnection = async (websocket: GristServerSocket, req) => {
      try {
        await this._onWebSocketConnection(websocket, req);
      } catch (e) {
        log.error("Comm connection for %s threw exception: %s", req.url, e.message);
        websocket.terminate();  // close() is inadequate when ws routed via loadbalancer
      }
    };

    return socketServer;
  }
}

export async function verifyCommHttpRequest(
  req: http.IncomingMessage, hosts?: Hosts, { preserveOriginalUrl = false } = {},
): Promise<boolean> {
  const originalUrl = req.url;
  try {
    // Req should be the raw request from the HTTP Server (no express or middleware applied)
    // DocWorker ID (/dw/) and version tag (/v/) may be present, as well as organization (/o/)
    if (hosts) {
      // Strip DocWorker ID and version tags so `addOrgInfo` can fetch the org it needs.
      req.url = parseFirstUrlPart("dw", req.url || "").path;
      req.url = parseFirstUrlPart("v", req.url).path;
      // This will strip `/o/ORG` from the URL, but organization *must* be forwarded.
      await hosts.addOrgInfo(req);
    }

    // This would be cleaner with a function that verifies the org / origin without altering the original request.
    return trustOrigin(req);
  } catch (err) {
    // Consider exceptions (e.g. in parsing unexpected hostname) as failures to verify.
    // In practice, we only see this happening for spammy/illegitimate traffic; there is
    // no particular reason to log these.
    return false;
  } finally {
    if (preserveOriginalUrl) {
      // Restore the original URL - needed for transparent proxying use cases that require DW ID / tag / organization
      req.url = originalUrl;
    }
  }
}
