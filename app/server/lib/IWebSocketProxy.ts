import { IDocWorkerMap } from "app/server/lib/DocWorkerMap";

import * as http from "http";
import * as net from "net";

/**
 * Interface for a WebSocket proxy provided by ext/.
 *
 * If ICreate supplies one of these and isActive() returns true,
 * GristSocketServer will call its hooks before normal WebSocket/HTTP
 * handling, and clients will be told to connect through the load
 * balancer rather than directly to a specific doc worker.
 *
 * If isActive() returns false, the proxy is ignored entirely — as if
 * ICreate had not supplied one.
 */
export interface IWebSocketProxy {
  /**
   * Whether this proxy is currently active. When false, the proxy
   * is treated as if it doesn't exist: no hooks are called, and
   * clients connect directly to doc workers as usual.
   */
  isActive(): boolean;

  /**
   * Attempts to forward a socket request (e.g. Engine.IO polling) if a different doc worker should handle it.
   * Return true if the request was handled.
   */
  handleHTTPRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean>;

  /**
   * Attempts to proxy an Upgrade request and the resulting Websocket connection.
   * Return true if the request has been handled.
   */
  handleHTTPUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): Promise<boolean>;
}

export interface IWebSocketProxyOptions {
  docWorkerMap: IDocWorkerMap;
  getOwnWorkerId: () => string | null;
  // Check if this request should be accepted. To produce a valid response (perhaps a rejection),
  // this callback should not throw.
  verifyClient: (request: http.IncomingMessage) => Promise<boolean>;
}
