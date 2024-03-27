import * as http from 'http';
import * as WS from 'ws';
import * as EIO from 'engine.io';
import {GristServerSocket, GristServerSocketEIO, GristServerSocketWS} from './GristServerSocket';
import * as net from 'net';

const MAX_PAYLOAD = 100e6;

export interface GristSocketServerOptions {
  verifyClient?: (request: http.IncomingMessage) => Promise<boolean>;
}

export class GristSocketServer {
  private _wsServer: WS.Server;
  private _eioServer: EIO.Server;
  private _connectionHandler: (socket: GristServerSocket, req: http.IncomingMessage) => void;

  constructor(server: http.Server, private _options?: GristSocketServerOptions) {
    this._wsServer = new WS.Server({ noServer: true, maxPayload: MAX_PAYLOAD });

    this._eioServer = new EIO.Server({
      // We only use Engine.IO for its polling transport,
      // so we disable the built-in Engine.IO upgrade mechanism.
      allowUpgrades: false,
      transports: ['polling'],
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

    this._eioServer.on('connection', this._onEIOConnection.bind(this));

    this._attach(server);
  }

  public set onconnection(handler: (socket: GristServerSocket, req: http.IncomingMessage) => void) {
    this._connectionHandler = handler;
  }

  public close(cb: (...args: any[]) => void) {
    this._eioServer.close();

    // Terminate all clients. WS.Server used to do it automatically in close() but no
    // longer does (see https://github.com/websockets/ws/pull/1904#discussion_r668844565).
    for (const ws of this._wsServer.clients) {
      ws.terminate();
    }
    this._wsServer.close(cb);
  }

  private _attach(server: http.Server) {
    // Forward all WebSocket upgrade requests to WS
    server.on('upgrade', async (request, socket, head) => {
      if (this._options?.verifyClient && !await this._options.verifyClient(request)) {
        // Because we are handling an "upgrade" event, we don't have access to
        // a "response" object, just the raw socket. We can still construct
        // a well-formed HTTP error response.
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      this._wsServer.handleUpgrade(request, socket as net.Socket, head, (client) => {
        this._connectionHandler?.(new GristServerSocketWS(client), request);
      });
    });

    // At this point an Express app is installed as the handler for the server's
    // "request" event. We need to install our own listener instead, to intercept
    // requests that are meant for the Engine.IO polling implementation.
    const listeners = [...server.listeners("request")];
    server.removeAllListeners("request");
    server.on("request", async (req, res) => {
      // Intercept requests that have transport=polling in their querystring
      if (/[&?]transport=polling(&|$)/.test(req.url ?? '')) {
        if (this._options?.verifyClient && !await this._options.verifyClient(req)) {
          res.writeHead(403).end();
          return;
        }

        this._eioServer.handleRequest(req, res);
      } else {
        // Otherwise fallback to the pre-existing listener(s)
        for (const listener of listeners) {
          listener.call(server, req, res);
        }
      }
    });

    server.on("close", this.close.bind(this));
  }

  private _onEIOConnection(socket: EIO.Socket) {
    const req = socket.request;
    (socket as any).request = null; // Free initial request as recommended in the Engine.IO documentation
    this._connectionHandler?.(new GristServerSocketEIO(socket), req);
  }
}