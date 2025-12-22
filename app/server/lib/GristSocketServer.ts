import { GristServerSocket, GristServerSocketEIO, GristServerSocketWS } from "app/server/lib/GristServerSocket";

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

export class GristSocketServer {
  private _wsServer: WS.Server;
  private _eioServer: EIO.Server;
  private _connectionHandler: (socket: GristServerSocket, req: http.IncomingMessage) => void;
  private _originalHttpServerListeners: Function[];

  constructor(private _httpServer: http.Server, private _options?: GristSocketServerOptions) {
    this._handleEIOConnection = this._handleEIOConnection.bind(this);
    this._handleHTTPUpgrade = this._handleHTTPUpgrade.bind(this);
    this._handleHTTPRequest = this._handleHTTPRequest.bind(this);
    this._closeSocketServers = this._closeSocketServers.bind(this);

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

    this._addEIOServerListeners();

    this._addHTTPServerListeners();
  }

  public set onconnection(handler: (socket: GristServerSocket, req: http.IncomingMessage) => void) {
    this._connectionHandler = handler;
  }

  /**
   * Closes the WS servers and removes any associated connection handlers.
   *
   * Removal of connection handlers is done as a precaution for scenarios where
   * a new GristSocketServer is instantiated after a previous one was closed.
   * Currently, this only happens during tests where the Comm object is shut
   * down or restarted. (See `Comm.testServerShutdown` and
   * `Comm.testServerRestart`.)
   *
   * If handlers are not removed, requests to the HTTP server associated with
   * this GristSocketServer will continue to be handled by listeners for a
   * previous GristSocketServer.
   */
  public close(cb: (...args: any[]) => void) {
    this._removeEIOServerListeners();
    this._removeHTTPServerListeners();
    this._closeSocketServers(cb);
  }

  private _addEIOServerListeners() {
    this._eioServer.on("connection", this._handleEIOConnection);
  }

  private _addHTTPServerListeners() {
    // At this point an Express app is installed as the handler for the server's
    // "request" event. We need to install our own listener instead, to intercept
    // requests that are meant for the Engine.IO polling implementation.
    this._originalHttpServerListeners = this._httpServer.listeners("request");
    this._httpServer.removeAllListeners("request");

    this._httpServer.on("upgrade", this._handleHTTPUpgrade);
    this._httpServer.on("request", this._handleHTTPRequest);
    this._httpServer.on("close", this._closeSocketServers);
  }

  private _removeEIOServerListeners() {
    this._eioServer.off("connection", this._handleEIOConnection);
  }

  private _removeHTTPServerListeners() {
    this._httpServer.off("upgrade", this._handleHTTPUpgrade);
    this._httpServer.off("request", this._handleHTTPRequest);
    this._httpServer.off("close", this._closeSocketServers);

    for (const listener of this._originalHttpServerListeners) {
      this._httpServer.on("request", listener as any);
    }
    this._originalHttpServerListeners = [];
  }

  private _closeSocketServers(cb: (...args: any[]) => void) {
    this._eioServer.close();

    // Terminate all clients. WS.Server used to do it automatically in close() but no
    // longer does (see https://github.com/websockets/ws/pull/1904#discussion_r668844565).
    for (const ws of this._wsServer.clients) {
      ws.terminate();
    }
    this._wsServer.close(cb);
  }

  private _handleEIOConnection(socket: EIO.Socket) {
    const req = socket.request;
    (socket as any).request = null; // Free initial request as recommended in the Engine.IO documentation
    this._connectionHandler?.(new GristServerSocketEIO(socket), req);
  }

  private _handleHTTPUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer) {
    destroyOnRejection(socket, async () => {
      if (this._options?.verifyClient && !await this._options.verifyClient(req)) {
        // Because we are handling an "upgrade" event, we don't have access to
        // a "response" object, just the raw socket. We can still construct
        // a well-formed HTTP error response.
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      this._wsServer.handleUpgrade(req, socket, head, (client) => {
        this._connectionHandler?.(new GristServerSocketWS(client), req);
      });
    });
  }

  private _handleHTTPRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    destroyOnRejection(req.socket, async () => {
      // Intercept requests that have transport=polling in their querystring
      if (/[&?]transport=polling(&|$)/.test(req.url ?? "")) {
        if (this._options?.verifyClient && !await this._options.verifyClient(req)) {
          res.writeHead(403).end();
          return;
        }

        this._eioServer.handleRequest(req as EngineRequest, res);
      }
      else {
        // Otherwise fallback to the pre-existing listener(s)
        for (const listener of this._originalHttpServerListeners) {
          listener.call(this._httpServer, req, res);
        }
      }
    });
  }
}

/**
 * Wrapper for server event handlers that catches rejected promises, which would otherwise
 * lead to "unhandledRejection" and process exit. Instead we abort the connection, which helps
 * in testing this scenario. This is a fallback; in reality, handlers should never throw.
 */
function destroyOnRejection(socket: stream.Duplex, func: () => Promise<void>) {
  func().catch((_e) => {
    socket.destroy();
  });
}
