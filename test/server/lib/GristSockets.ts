import { assert } from 'chai';
import * as http from 'http';
import { GristClientSocket } from 'app/client/components/GristClientSocket';
import { GristSocketServer } from 'app/server/lib/GristSocketServer';
import { fromCallback, listenPromise } from 'app/server/lib/serverUtils';
import { AddressInfo } from 'net';
import httpProxy from 'http-proxy';

describe(`GristSockets`, function () {

  beforeEach(async function () {
    await startSocketServer();
  });

  afterEach(async function () {
    await stopSocketServer();
  });

  let server: http.Server | null;
  let serverPort: number;
  let wsAddress: string;
  let socketServer: GristSocketServer | null;

  async function startSocketServer() {
    server = http.createServer((req, res) => res.writeHead(404).end());
    socketServer = new GristSocketServer(server);
    await listenPromise(server.listen(0, 'localhost'));
    serverPort = (server.address() as AddressInfo).port;
    wsAddress = 'ws://localhost:' + serverPort;
  }

  async function stopSocketServer() {
    //await delay(90_000);
    await fromCallback(cb => socketServer?.close(cb));
    await fromCallback(cb => { server?.close(); server?.closeAllConnections(); server?.on("close", cb); });
    socketServer = server = null;
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
    const ws = new GristClientSocket(url);
    return new Promise<GristClientSocket>((resolve, reject) => {
      ws.onopen = () => {
        ws.onerror = null;
        resolve(ws);
      };
      ws.onerror = (err) => {
        ws.onopen = null;
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
    new GristClientSocket(wsAddress + "/path?query=value", {
      headers: { "cookie": "session=1234" }
    });
    const req = await connectionPromise;

    // Engine.IO may append extra query parameters, so we check only the start of the URL
    assert.match(req.url!, /^\/path\?query=value/);

    assert.equal(req.headers.cookie, "session=1234");
  });

  it("should receive and send messages", async function () {
    socketServer!.onconnection = (socket, req) => {
      socket.onmessage = (data) => {
        socket.send("hello, " + data);
        socket.close();
      };
    };
    const clientWs = await connectClient(wsAddress);
    clientWs.send("world");
    assert.deepEqual(await getMessages(clientWs, 1), ["hello, world"]);
  });

  it("should invoke send callbacks", async function () {
    const connectionPromise = new Promise<void>((resolve) => {
      socketServer!.onconnection = (socket, req) => {
        socket.send("hello", () => resolve());
      };
    });
    await connectClient(wsAddress);
    await connectionPromise;
  });

  let proxy: httpProxy | null;
  let proxyServer: http.Server | null;
  let proxyPort: number;

  // Start an HTTP proxy that does not support WebSockets
  async function startProxyServer() {
    proxy = httpProxy.createProxy({
      target: `http://localhost:${serverPort}`,
      ws: false,
      timeout: 1000,
    });
    proxy.on('error', () => { });
    proxyServer = http.createServer(proxy.web.bind(proxy));
    proxyServer.on('upgrade', (req, socket) => socket.destroy());

    await listenPromise(proxyServer.listen(0, 'localhost'));
    proxyPort = (proxyServer.address() as AddressInfo).port;
  }

  async function stopProxyServer() {
    proxy?.close();
    await fromCallback(cb => { proxyServer?.close(cb); proxyServer?.closeAllConnections(); });
    proxyServer = proxy = null;
  }

  beforeEach(async function () {
    await startProxyServer();
  });

  afterEach(async function () {
    await stopProxyServer();
  });

  describe("GristClientSocket", function () {
    it("can fall back to polling", async function () {
      socketServer!.onconnection = (socket, req) => {
        socket.onmessage = (data) => {
          socket.send("hello, " + data);
        };
      };
      const clientWs = await connectClient(`ws://localhost:${proxyPort}`);
      clientWs.send("world");
      assert.deepEqual(await getMessages(clientWs, 1), ["hello, world"]);
      clientWs.close();
    });
  });
});