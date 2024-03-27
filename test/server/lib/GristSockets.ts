import { assert } from 'chai';
import * as http from 'http';
import { GristClientSocket } from 'app/client/components/GristClientSocket';
import { GristSocketServer } from 'app/server/lib/GristSocketServer';
import { fromCallback, listenPromise } from 'app/server/lib/serverUtils';
import { AddressInfo } from 'net';
import httpProxy from 'http-proxy';

describe(`GristSockets`, function () {

  for (const webSocketsSupported of [true, false]) {
    describe(`when the networks ${webSocketsSupported ? "supports" : "does not support"} WebSockets`, function () {

      let server: http.Server | null;
      let serverPort: number;
      let socketServer: GristSocketServer | null;
      let proxy: httpProxy | null;
      let proxyServer: http.Server | null;
      let proxyPort: number;
      let wsAddress: string;

      beforeEach(async function () {
        await startSocketServer();
        await startProxyServer();
      });

      afterEach(async function () {
        await stopProxyServer();
        await stopSocketServer();
      });

      async function startSocketServer() {
        server = http.createServer((req, res) => res.writeHead(404).end());
        socketServer = new GristSocketServer(server);
        await listenPromise(server.listen(0, 'localhost'));
        serverPort = (server.address() as AddressInfo).port;
      }

      async function stopSocketServer() {
        await fromCallback(cb => socketServer?.close(cb));
        await fromCallback(cb => { server?.close(); server?.closeAllConnections(); server?.on("close", cb); });
        socketServer = server = null;
      }

      // Start an HTTP proxy that supports WebSockets or not
      async function startProxyServer() {
        proxy = httpProxy.createProxy({
          target: `http://localhost:${serverPort}`,
          ws: webSocketsSupported,
          timeout: 1000,
        });
        proxy.on('error', () => { });
        proxyServer = http.createServer();

        if (webSocketsSupported) {
          // prevent non-WebSocket requests
          proxyServer.on('request', (req, res) => res.writeHead(404).end());
          // proxy WebSocket requests
          proxyServer.on('upgrade', (req, socket, head) => proxy!.ws(req, socket, head));
        } else {
          // proxy non-WebSocket requests
          proxyServer.on('request', (req, res) => proxy!.web(req, res));
          // don't leave WebSocket connection attempts hanging
          proxyServer.on('upgrade', (req, socket, head) => socket.destroy());
        }

        await listenPromise(proxyServer.listen(0, 'localhost'));
        proxyPort = (proxyServer.address() as AddressInfo).port;
        wsAddress = `ws://localhost:${proxyPort}`;
      }

      async function stopProxyServer() {
        if (proxy) {
          proxy.close();
          proxy = null;
        }
        if (proxyServer) {
          const server = proxyServer;
          await fromCallback(cb => { server.close(cb); server.closeAllConnections(); });
        }
        proxyServer = null;
      }

      function getMessages(ws: GristClientSocket, count: number): Promise<string[]> {
        return new Promise((resolve, reject) => {
          const messages: string[] = [];
          ws.onerror = (err) => {
            ws.onerror = ws.onmessage = null;
            reject(err);
          };
          ws.onmessage = (data: string) => {
            messages.push(data);
            if (messages.length >= count) {
              ws.onerror = ws.onmessage = null;
              resolve(messages);
            }
          };
        });
      }

      /**
       * Returns a promise for the connected websocket.
       */
      function connectClient(url: string): Promise<GristClientSocket> {
        const socket = new GristClientSocket(url);
        return new Promise<GristClientSocket>((resolve, reject) => {
          socket.onopen = () => {
            socket.onerror = null;
            resolve(socket);
          };
          socket.onerror = (err) => {
            socket.onopen = null;
            reject(err);
          };
        });
      }

      it("should expose initial request", async function () {
        const connectionPromise = new Promise<http.IncomingMessage>((resolve) => {
          socketServer!.onconnection = (socket, req) => {
            resolve(req);
          };
        });
        const clientWs = new GristClientSocket(wsAddress + "/path?query=value", {
          headers: { "cookie": "session=1234" }
        });
        const req = await connectionPromise;
        clientWs.close();

        // Engine.IO may append extra query parameters, so we check only the start of the URL
        assert.match(req.url!, /^\/path\?query=value/);

        assert.equal(req.headers.cookie, "session=1234");
      });

      it("should receive and send messages", async function () {
        socketServer!.onconnection = (socket, req) => {
          socket.onmessage = (data) => {
            socket.send("hello, " + data);
          };
        };
        const clientWs = await connectClient(wsAddress);
        clientWs.send("world");
        assert.deepEqual(await getMessages(clientWs, 1), ["hello, world"]);
        clientWs.close();
      });

      it("should invoke send callbacks", async function () {
        const connectionPromise = new Promise<void>((resolve) => {
          socketServer!.onconnection = (socket, req) => {
            socket.send("hello", () => resolve());
          };
        });
        const clientWs = await connectClient(wsAddress);
        await connectionPromise;
        clientWs.close();
      });

      it("should emit close event for client", async function () {
        const clientWs = await connectClient(wsAddress);
        const closePromise = new Promise<void>(resolve => {
          clientWs.onclose = resolve;
        });
        clientWs.close();
        await closePromise;
      });

    });
  }
});