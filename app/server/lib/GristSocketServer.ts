import { GristServerSocket, GristServerSocketEIO, GristServerSocketWS } from "app/server/lib/GristServerSocket";
import log from "app/server/lib/log";
import { terminateSocketWithHttpResponse } from "app/server/lib/requestUtils";

import * as http from "http";
import * as net from "net";
import * as stream from "stream";

import * as EIO from "engine.io";
import { EngineRequest } from "engine.io/build/transport";
import * as WS from "ws";

const MAX_PAYLOAD = 100e6;

export interface GristSocketServerOptions {
  // Check if this request should be accepted. To produce a valid response (perhaps a rejection),
  // this callback should not throw.
  verifyClient?: (request: http.IncomingMessage) => Promise<boolean>;
}

export function isPollingSocketRequest(request: http.IncomingMessage): boolean {
  return /[&?]transport=polling(&|$)/.test(request.url ?? "");
}

/**
 * Adds middleware to an http.Server that intercepts incoming
 * WebSocket upgrade requests and HTTP long-polling connection requests (via Engine.io).
 *
 * Intercepted requests are verified, established, then abstracted into GristServerSocket
 * instances that are handed to the onconnection handler.
 */
export class GristSocketServer {
  private _wsServer: WS.Server;
  private _eioServer: EIO.Server;
  private _connectionHandler: (socket: GristServerSocket, req: http.IncomingMessage) => void;
  private _closed: boolean = true;

  constructor(private _options?: GristSocketServerOptions) {
    this._handleEIOConnection = this._handleEIOConnection.bind(this);
    this.listen();
  }

  public listen() {
    // Server is already listening, do nothing.
    if (!this._closed) { return; }

    this._wsServer = new WS.Server({ noServer: true, maxPayload: MAX_PAYLOAD });

    this._eioServer = new EIO.Server({
      // We only use Engine.IO for its polling transport,
      // so we disable the built-in Engine.IO upgrade mechanism.
      allowUpgrades: false,
      transports: ["polling"],
      maxHttpBufferSize: MAX_PAYLOAD,
      cors: {
        // This will cause Engine.IO to reflect any client-provided Origin into
        // the Access-Control-Allow-Origin header, essentially disabling the
        // protection offered by the Same-Origin Policy. This sounds insecure
        // but is actually the security model of native WebSockets (they are
        // not covered by SOP; any webpage can open a WebSocket connecting to
        // any other domain, including the target domain's cookies; it is up to
        // the receiving server to check the request's Origin header). Since
        // the connection attempt is validated in `verifyClient` later,
        // it is safe to let any client attempt a connection here.
        origin: true,
        // We need to allow the client to send its cookies. See above for the
        // reasoning on why it is safe to do so.
        credentials: true,
        methods: ["GET", "POST"],
      },
    });

    this._eioServer.on("connection", this._handleEIOConnection);
    this._closed = false;
  }

  public set onconnection(handler: (socket: GristServerSocket, req: http.IncomingMessage) => void) {
    this._connectionHandler = handler;
  }

  /**
   * Closes the WS / Engine.io servers and terminates their remaining client connections.
   *
   * Removal of connection handlers is done as a precaution for scenarios where
   * a new GristSocketServer is instantiated after a previous one was closed.
   * Currently, this only happens during tests where the Comm object is shut
   * down or restarted. (See `Comm.close` and `Comm.restart`.)
   *
   * If handlers are not removed, requests to the HTTP server associated with
   * this GristSocketServer will continue to be handled by listeners for a
   * previous GristSocketServer.
   */
  public close(cb: (...args: any[]) => void) {
    // Prevent double closure, e.g from the HTTP server ending AND `close` being called explicitly.
    // Run callback in case it's execution is relied on by the caller
    if (this._closed) { return cb(); }
    // Immediately mark closed to prevent incoming requests from being handled
    this._closed = true;

    this._eioServer.close();

    // Terminate all clients. WS.Server used to do it automatically in close() but no
    // longer does (see https://github.com/websockets/ws/pull/1904#discussion_r668844565).
    for (const ws of this._wsServer.clients) {
      ws.terminate();
    }
    this._wsServer.close(cb);
  }

  /**
   * Handles an incoming HTTP Upgrade request from an http.Server
   * Must be connected for this to function correctly.
   * @returns {Promise<boolean>} - true if the request was handled, false otherwise
   */
  public async handleHTTPUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): Promise<boolean> {
    return destroyOnRejection(socket, async () => {
      if (this._options?.verifyClient && !await this._options.verifyClient(req)) {
        terminateSocketWithHttpResponse(socket, 403, "forbidden");
        return true;
      }

      // If server is closed, make the response consistent by handling it here (instead of relying on this._wsServer)
      // If it reaches this point, GristSocketServer is guaranteed to be handling this request.
      if (this._closed) {
        terminateSocketWithHttpResponse(socket, 503, "socket server is closed");
        return true;
      }

      this._wsServer.handleUpgrade(req, socket, head, (client) => {
        this._connectionHandler?.(new GristServerSocketWS(client), req);
      });
      return true;
    });
  }

  /**
   * Handles an incoming HTTP request from an http.Server
   * Must be connected for this to function correctly.
   * @returns {Promise<boolean>} - true if the request was handled, false otherwise
   */
  public async handleHTTPRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    return destroyOnRejection(req.socket, async () => {
      // Intercept Engine.IO long polling requests
      if (isPollingSocketRequest(req)) {
        if (this._options?.verifyClient && !await this._options.verifyClient(req)) {
          res.writeHead(403).end();
          return true;
        }

        if (this._closed) {
          res.writeHead(503).end("socket server is closed");
          return true;
        }

        this._eioServer.handleRequest(req as EngineRequest, res);
        return true;
      }
      return false;
    });
  }

  private _handleEIOConnection(socket: EIO.Socket) {
    const req = socket.request;
    (socket as any).request = null; // Free initial request as recommended in the Engine.IO documentation
    this._connectionHandler?.(new GristServerSocketEIO(socket), req);
  }
}

/**
 * Wrapper for server event handlers that catches rejected promises, which would otherwise
 * lead to "unhandledRejection" and process exit. Instead we abort the connection, which helps
 * in testing this scenario. This is a fallback; in reality, handlers should never throw.
 */
function destroyOnRejection(socket: stream.Duplex, func: () => Promise<boolean>): Promise<boolean> {
  return func().catch((_e) => {
    log.error(`GristSocketServer: error in socket handler, aborting connection, ${_e}`);
    socket.destroy();
    // Request is handled if we destroy the socket.
    return true;
  });
}
