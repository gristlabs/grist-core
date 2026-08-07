import { Comm as ClientComm } from "app/client/components/Comm";
import { GristClientSocket, GristClientSocketOptions } from "app/client/components/GristClientSocket";
import { GristWSConnection, GristWSSettings } from "app/client/components/GristWSConnection";
import * as log from "app/client/lib/log";
import { CommClientConnect } from "app/common/CommTypes";
import { delay } from "app/common/delay";
import { GristLoadConfig } from "app/common/gristUrls";
import { isLongerThan } from "app/common/gutil";
import { User } from "app/gen-server/entity/User";
import { HomeDBAuth } from "app/gen-server/lib/homedb/Interfaces";
import { AccessTokenInfo, IAccessTokens } from "app/server/lib/AccessTokens";
import { Client, ClientMethod } from "app/server/lib/Client";
import { Comm } from "app/server/lib/Comm";
import { Hosts, RequestOrgInfo } from "app/server/lib/extractOrg";
import { createDummyGristServer, GristServer } from "app/server/lib/GristServer";
import { getBootKey } from "app/server/lib/gristSettings";
import { InstallAdmin } from "app/server/lib/InstallAdmin";
import { IPermitStore, Permit } from "app/server/lib/Permit";
import { terminateSocketWithHttpResponse } from "app/server/lib/requestUtils";
import { fromCallback, listenPromise } from "app/server/lib/serverUtils";
import { Sessions } from "app/server/lib/Sessions";
import { TcpForwarder } from "test/server/tcpForwarder";
import * as testUtils from "test/server/testUtils";

import * as http from "http";
import net, { AddressInfo } from "net";
import * as path from "path";

import * as session from "@gristlabs/express-session";
import { Events as BackboneEvents } from "backbone";
import { promisifyAll } from "bluebird";
import { assert } from "chai";
import * as sinon from "sinon";
import * as tmp from "tmp";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SQLiteStore = require("@gristlabs/connect-sqlite3")(session);
promisifyAll(SQLiteStore.prototype);

// Just enough implementation of Hosts to be able to fake using a custom host.
class FakeHosts {
  public isCustomHost = false;

  public get asHosts() { return this as unknown as Hosts; }

  public async addOrgInfo<T extends http.IncomingMessage>(req: T): Promise<T & RequestOrgInfo> {
    return Object.assign(req, {
      isCustomHost: this.isCustomHost,
      org: "example",
      url: req.url!,
    });
  }
}

describe("Comm", function() {
  testUtils.setTmpLogLevel(process.env.VERBOSE ? "debug" : "warn");

  // Allow test cases to register afterEach callbacks here for easier cleanup.
  const cleanup: (() => Promise<void>)[] = [];

  let server: http.Server;
  let sessions: Sessions;
  let fakeHosts: FakeHosts;
  let comm: Comm | null = null;
  const sandbox = sinon.createSandbox();

  before(async function() {
    const sessionDB = tmp.fileSync();
    const sessionStore = new SQLiteStore({
      dir: path.dirname(sessionDB.name),
      db: path.basename(sessionDB.name),
      table: "sessions",
    });
    // Random string to use for the test session secret.
    const sessionSecret = "xkwriagasaqystubgkkbwhqtyyncwqjemyncnmetjpkiwtfzvllejpfneldmoyri";
    sessions = new Sessions(sessionSecret, sessionStore);
  });

  function startComm(methods: { [name: string]: ClientMethod }) {
    server = http.createServer();
    fakeHosts = new FakeHosts();
    comm = new Comm({ sessions, hosts: fakeHosts.asHosts });
    server.on("request", (...args) => comm?.handleHTTPRequest(...args));
    server.on("upgrade",
      (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => comm?.handleHTTPUpgrade(req, socket, head),
    );
    server.on("close", () => comm?.close());
    comm.registerMethods(methods);
    return listenPromise(server.listen(0, "localhost"));
  }

  async function stopComm() {
    comm?.destroyAllClients();
    await comm?.close();
    await fromCallback((cb) => {
      server.close(cb);
      server.closeAllConnections();
    });
  }

  const assortedMethods: { [name: string]: ClientMethod } = {
    methodSync: async function(client, x, y) {
      return { x: x, y: y, name: "methodSync" };
    },
    methodError: async function(client, x, y) {
      throw new Error("fake error");
    },
    methodAsync: async function(client, x, y) {
      await delay(20);
      return { x: x, y: y, name: "methodAsync" };
    },
    methodSend: async function(client, docFD) {
      void (client.sendMessage({ docFD, type: "fooType" as any, data: "foo" }));
      void (client.sendMessage({ docFD, type: "barType" as any, data: "bar" }));
    },
  };

  afterEach(async function() {
    // Run the cleanup callbacks registered in cleanup().
    await Promise.all(cleanup.splice(0).map(callback => callback()));

    sandbox.restore();
  });

  function getMessages(ws: GristClientSocket, count: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const messages: object[] = [];
      ws.onerror = (err) => {
        ws.onmessage = null;
        reject(err);
      };
      ws.onmessage = (data: string) => {
        messages.push(JSON.parse(data));
        if (messages.length >= count) {
          ws.onerror = null;
          ws.onmessage = null;
          resolve(messages);
        }
      };
    });
  }

  /**
   * Returns a promise for the connected websocket.
   */
  function connect(options?: GristClientSocketOptions): Promise<GristClientSocket> {
    const ws = new GristClientSocket("ws://localhost:" + (server.address() as AddressInfo).port, options);
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

  // Open a socket with explicit query params (e.g. clientId/newClient), to exercise reconnects.
  function openSocket(query: Record<string, string>, options?: GristClientSocketOptions) {
    const port = (server.address() as AddressInfo).port;
    const qs = new URLSearchParams(query).toString();
    return new GristClientSocket(`ws://localhost:${port}/?${qs}`, options);
  }

  // As openSocket, but returns the socket together with the server's first message. The message
  // handler is attached synchronously, before the socket opens: a needReload reconnect gets a
  // single clientConnect followed immediately by a close, so a handler attached afterwards (as
  // connect()+getMessages() does) would miss it.
  async function connectWithParams(query: Record<string, string>, options?: GristClientSocketOptions) {
    const ws = openSocket(query, options);
    const msg = await new Promise<CommClientConnect>((resolve, reject) => {
      ws.onmessage = (data: string) => resolve(JSON.parse(data));
      ws.onerror = (err: Error) => reject(err);
    });
    return { ws, msg };
  }

  // Wait until the server has released clientId's websocket, so it is eligible for reconnect.
  async function waitForSocketRelease(clientId: string) {
    const client = comm!.getClient(clientId);
    for (let i = 0; i < 200 && client.isConnected(); i++) {
      await delay(10);
    }
    // Say so here rather than letting the reconnect that follows fail for reasons of its own.
    assert.isFalse(client.isConnected(), `Client ${clientId} still held a websocket after 2s`);
  }

  describe("server methods", function() {
    let ws: GristClientSocket;
    beforeEach(async function() {
      await startComm(assortedMethods);
      ws = await connect();
      await getMessages(ws, 1);  // consume a clientConnect message
    });

    afterEach(async function() {
      await stopComm();
    });

    it("should return data for valid calls", async function() {
      ws.send(JSON.stringify({ reqId: 10, method: "methodSync", args: ["hello", "world"] }));
      const messages = await getMessages(ws, 1);
      const resp = messages[0];
      assert.equal(resp.reqId, 10, `Messages received instead: ${JSON.stringify(messages)}`);
      assert.deepEqual(resp.data, { x: "hello", y: "world", name: "methodSync" });
    });

    it("should work for async calls", async function() {
      ws.send(JSON.stringify({ reqId: 20, method: "methodAsync", args: ["hello", "world"] }));
      const messages = await getMessages(ws, 1);
      const resp = messages[0];
      assert.equal(resp.reqId, 20);
      assert.deepEqual(resp.data, { x: "hello", y: "world", name: "methodAsync" });
    });

    it("should work for out-of-order calls", async function() {
      ws.send(JSON.stringify({ reqId: 30, method: "methodAsync", args: [1, 2] }));
      ws.send(JSON.stringify({ reqId: 31, method: "methodSync", args: [3, 4] }));
      const messages = await getMessages(ws, 2);
      assert.equal(messages[0].reqId, 31);
      assert.deepEqual(messages[0].data, { x: 3, y: 4, name: "methodSync" });
      assert.equal(messages[1].reqId, 30);
      assert.deepEqual(messages[1].data, { x: 1, y: 2, name: "methodAsync" });
    });

    it("should return error when a call fails", async function() {
      const logMessages = await testUtils.captureLog("warn", async () => {
        ws.send(JSON.stringify({ reqId: 40, method: "methodError", args: ["hello"] }));
        const messages = await getMessages(ws, 1);
        const resp = messages[0];
        assert.equal(resp.reqId, 40);
        assert.equal(resp.data, undefined);
        assert(resp.error.indexOf("fake error") >= 0);
      });
      testUtils.assertMatchArray(logMessages, [
        /^warn: Client.* Error: fake error[^]+at methodError/,
        /^warn: Client.* responding to .* ERROR fake error/,
      ]);
    });

    it("should return error for unknown methods", async function() {
      const logMessages  = await testUtils.captureLog("warn", async () => {
        ws.send(JSON.stringify({ reqId: 50, method: "someUnknownMethod", args: [] }));
        const messages = await getMessages(ws, 1);
        const resp = messages[0];
        assert.equal(resp.reqId, 50);
        assert.equal(resp.data, undefined);
        assert(resp.error.indexOf("Unknown method") >= 0);
      });
      testUtils.assertMatchArray(logMessages, [
        /^warn: Client.* Unknown method.*someUnknownMethod/,
      ]);
    });

    it("should only log warning for malformed JSON data", async function() {
      const logMessages  = await testUtils.captureLog("warn", async () => {
        ws.send("foobar");
      }, { waitForFirstLog: true });
      testUtils.assertMatchArray(logMessages, [
        /^warn: Client.* Unexpected token.*/,
      ]);
    });

    it("should log warning when null value is passed", async function() {
      const logMessages  = await testUtils.captureLog("warn", async () => {
        ws.send("null");
      }, { waitForFirstLog: true });
      testUtils.assertMatchArray(logMessages, [
        /^warn: Client.*Cannot read properties of null*/,
      ]);
    });

    it("should support app-level events correctly", async function() {
      comm!.broadcastMessage("fooType" as any, "hello");
      comm!.broadcastMessage("barType" as any, "world");
      const messages = await getMessages(ws, 2);
      assert.equal(messages[0].type, "fooType");
      assert.equal(messages[0].data, "hello");
      assert.equal(messages[1].type, "barType");
      assert.equal(messages[1].data, "world");
    });

    it("should support doc-level events", async function() {
      ws.send(JSON.stringify({ reqId: 60, method: "methodSend", args: [13] }));
      const messages = await getMessages(ws, 3);
      assert.equal(messages[0].type, "fooType");
      assert.equal(messages[0].data, "foo");
      assert.equal(messages[0].docFD, 13);
      assert.equal(messages[1].type, "barType");
      assert.equal(messages[1].data, "bar");
      assert.equal(messages[1].docFD, 13);
      assert.equal(messages[2].reqId, 60);
      assert.equal(messages[2].data, undefined);
      assert.equal(messages[2].error, undefined);
    });
  });

  describe("reconnects", function() {
    const docId = "docId_abc";
    this.timeout(10000);

    // GristWSConnection declines to connect unless the page config names a worker for the doc.
    function stubWorkerConfig() {
      (global as any).window = undefined;
      const partialConfig: Pick<GristLoadConfig, "getWorkerFull" | "assignmentId"> = {
        getWorkerFull: { [docId]: { selfPrefix: "STUB", docWorkerUrl: null, docWorkerId: null } },
        assignmentId: docId,
      };
      sandbox.stub(global as any, "window").value({ gristConfig: partialConfig });
    }

    // Helper to set up a Comm server, a Comm client, and a forwarder between them that allows
    // simulating disconnects.
    async function startManagedConnection(methods: { [name: string]: ClientMethod }) {
      // Start the server Comm, providing a few methods.
      await startComm(methods);
      cleanup.push(() => stopComm());

      // Create a forwarder, which we use to test disconnects.
      const serverPort = (server.address() as AddressInfo).port;
      const forwarder = new TcpForwarder(serverPort);
      const forwarderPort = await forwarder.pickForwarderPort();
      await forwarder.connect();
      cleanup.push(() => forwarder.disconnect());

      stubWorkerConfig();

      // We also need to get GristWSConnection to use a custom GristWSSettings object, and to
      // connect to the forwarder's port.
      const docWorkerUrl = `http://localhost:${forwarderPort}`;
      const settings = getWSSettings(docWorkerUrl);
      const stubGristWsCreate = sandbox.stub(GristWSConnection, "create").callsFake(function(this: any, owner) {
        return (stubGristWsCreate as any).wrappedMethod.call(this, owner, settings);
      });

      // Cast with BackboneEvents to allow using cliComm.on().
      const cliComm = ClientComm.create() as ClientComm & BackboneEvents;
      cliComm.useDocConnection(docId);
      cleanup.push(async () => cliComm.dispose());      // Dispose after this test ends.

      return { cliComm, forwarder };
    }

    it("should forward calls on a normal connection", async function() {
      const { cliComm } = await startManagedConnection(assortedMethods);

      // A couple of regular requests.
      const resp1 = await cliComm._makeRequest(null, null, "methodSync", "foo", 1);
      assert.deepEqual(resp1, { name: "methodSync", x: "foo", y: 1 });
      const resp2 = await cliComm._makeRequest(null, null, "methodAsync", "foo", 2);
      assert.deepEqual(resp2, { name: "methodAsync", x: "foo", y: 2 });

      // Try calls that return out of order.
      const [resp3, resp4] = await Promise.all([
        cliComm._makeRequest(null, null, "methodAsync", "foo", 3),
        cliComm._makeRequest(null, null, "methodSync", "foo", 4),
      ]);
      assert.deepEqual(resp3, { name: "methodAsync", x: "foo", y: 3 });
      assert.deepEqual(resp4, { name: "methodSync", x: "foo", y: 4 });
    });

    it("should forward missed responses when a server send fails", async function() {
      await testMissedResponses(true);
    });
    it("should forward missed responses when a server send is queued", async function() {
      await testMissedResponses(false);
    });

    async function testMissedResponses(sendShouldFail: boolean) {
      let failedSendCount = 0;

      const { cliComm, forwarder } = await startManagedConnection({ ...assortedMethods,
        // An extra method that simulates a lost connection on server side prior to response.
        testDisconnect: async function(client, x, y) {
          setTimeout(() => forwarder.disconnectServerSide(), 0);
          if (!sendShouldFail) {
            // Add a delay to let the 'close' event get noticed first.
            await delay(20);
          }
          return { x: x, y: y, name: "testDisconnect" };
        },
      });

      const resp1 = await cliComm._makeRequest(null, null, "methodSync", "foo", 1);
      assert.deepEqual(resp1, { name: "methodSync", x: "foo", y: 1 });

      if (sendShouldFail) {
        // In Node 18, the socket is closed during the call to 'testDisconnect'.
        // In prior versions of Node, the socket was still disconnecting.
        // This test is sensitive to timing and only passes in the latter, unless we
        // stub the method below to produce similar behavior in the former.
        sandbox.stub(Client.prototype as any, "_sendToWebsocket")
          .onFirstCall()
          .callsFake(() => {
            failedSendCount += 1;
            throw new Error("WebSocket is not open");
          })
          .callThrough();
      }

      // Make more calls, with a disconnect before they return. The server should queue up responses.
      const resp2Promise = cliComm._makeRequest(null, null, "testDisconnect", "foo", 2);
      const resp3Promise = cliComm._makeRequest(null, null, "methodAsync", "foo", 3);
      assert.equal(await isLongerThan(resp2Promise, 250), true);

      // Once we reconnect, the response should arrive.
      await forwarder.connect();
      assert.deepEqual(await resp2Promise, { name: "testDisconnect", x: "foo", y: 2 });
      assert.deepEqual(await resp3Promise, { name: "methodAsync", x: "foo", y: 3 });

      // Check that we saw the situation we were hoping to test.
      assert.equal(failedSendCount, sendShouldFail ? 1 : 0, "Expected to see a failed send");
    }

    // A server method the test drives: `started` resolves once the server has begun running it,
    // and `finish()` lets it return.
    function makeControlledMethod() {
      let notifyStarted!: () => void;
      let finish!: () => void;
      const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
      const finished = new Promise<void>((resolve) => { finish = resolve; });
      const methods = {
        methodControlled: async function(client: Client, x: any) {
          notifyStarted();
          await finished;
          return { x, name: "methodControlled" };
        },
      };
      return { methods, started, finish };
    }

    // How many messages the server is holding for a client that was not there to receive them.
    function queuedMessageCount(clientId: string) {
      return (comm!.getClient(clientId) as any)._missedMessages.size;
    }

    // The client's next clientConnect, which is how it learns a connection is up. Waiting for the
    // next one rather than for any at all is what tells a reconnect from the connection before it.
    function nextClientConnect(cliComm: ClientComm & BackboneEvents): Promise<CommClientConnect> {
      return new Promise(resolve => cliComm.once("clientConnect", resolve));
    }

    // Let the server lose the next request that reaches it, as a network on its way out does.
    function swallowNextRequest() {
      let notifyLost!: () => void;
      const lost = new Promise<void>((resolve) => { notifyLost = resolve; });
      const stub: sinon.SinonStub = sandbox.stub(Client.prototype as any, "_onMessage")
        .callsFake(async function(this: any, ...args: unknown[]): Promise<unknown> {
          const message = args[0] as string;
          if (JSON.parse(message).reqId !== undefined) {
            stub.restore();
            notifyLost();
            return;
          }
          return stub.wrappedMethod.call(this, message);
        });
      return lost;
    }

    it("should deliver the response to a request that outlives a reconnect", async function() {
      const { methods, started, finish } = makeControlledMethod();
      const { cliComm, forwarder } = await startManagedConnection({ ...assortedMethods, ...methods });

      // Start a request, and wait until the server has actually begun processing it.
      const respPromise = cliComm._makeRequest(null, null, "methodControlled", "foo");
      await started;

      // The connection drops and comes back while the server is still working. The server kept
      // our Client object, so it can say on reconnect that the request is in hand.
      const reconnected = nextClientConnect(cliComm);
      await forwarder.disconnectServerSide();
      await forwarder.connect();
      await reconnected;

      // Only now let the server finish, so the answer is worked out after the reconnect.
      finish();
      assert.deepEqual(await respPromise, { x: "foo", name: "methodControlled" });
    });

    it("should reject a request the server cannot vouch for", async function() {
      const { methods, started, finish } = makeControlledMethod();
      const { cliComm, forwarder } = await startManagedConnection({ ...assortedMethods, ...methods });

      const respPromise = cliComm._makeRequest(null, null, "methodControlled", "foo");
      await started;

      // The server forgets us while we are away, so on reconnect it can say nothing about the
      // request it had in hand. Asking again could repeat work already done, and waiting would
      // be waiting for nobody, so the request is rejected and the caller told.
      await forwarder.disconnectServerSide();
      comm!.destroyAllClients();
      await forwarder.connect();
      await assert.isRejected(respPromise, /interrupted by reconnect/);
      finish();
    });

    it("should ask again for a request that never reached the server", async function() {
      const { cliComm, forwarder } = await startManagedConnection(assortedMethods);

      // One request that does arrive, so the server has a request id to report.
      assert.deepEqual(await cliComm._makeRequest(null, null, "methodSync", "foo", 1),
        { x: "foo", y: 1, name: "methodSync" });

      // The next one is lost on its way in, as one in flight when the network goes is.
      const lost = swallowNextRequest();
      const respPromise = cliComm._makeRequest(null, null, "methodSync", "bar", 2);
      await lost;

      // On reconnect the server names the earlier request as the last it read, so this one cannot
      // have arrived and cannot have had any effect. Asking again is safe, and better than
      // failing a request that provably never landed.
      await forwarder.disconnectServerSide();
      await forwarder.connect();
      assert.deepEqual(await respPromise, { x: "bar", y: 2, name: "methodSync" });
    });

    it("should deliver a response prepared while the connection was down", async function() {
      const { methods, started, finish } = makeControlledMethod();
      const { cliComm, forwarder } = await startManagedConnection({ ...assortedMethods, ...methods });
      const { clientId } = await nextClientConnect(cliComm);

      // The client's first request, so it has received nothing numbered, and has no place in the
      // message stream to reconnect from.
      const respPromise = cliComm._makeRequest(null, null, "methodControlled", "foo");
      await started;

      // Finish only once the server has noticed the socket is gone, so it has to queue the answer.
      await forwarder.disconnectServerSide();
      await waitForSocketRelease(clientId);
      finish();
      await waitForCondition(() => (queuedMessageCount(clientId) > 0), 2000);

      await forwarder.connect();
      assert.deepEqual(await respPromise, { x: "foo", name: "methodControlled" });
    });

    // Leave the server holding an answer the client has never had a chance to receive: it asked a
    // question and went away. It has received nothing numbered, so it cannot say where to resume.
    async function queueAnswerForAbsentClient() {
      const { methods, started, finish } = makeControlledMethod();
      await startComm({ ...assortedMethods, ...methods });
      cleanup.push(() => stopComm());

      const ws1 = await connect();
      const [msg1] = await getMessages(ws1, 1) as CommClientConnect[];
      const clientId = msg1.clientId;
      ws1.send(JSON.stringify({ reqId: 0, method: "methodControlled", args: ["foo"] }));
      await started;

      ws1.close();
      await waitForSocketRelease(clientId);
      finish();
      await waitForCondition(() => (queuedMessageCount(clientId) > 0), 2000);
      return clientId;
    }

    // Connect, ask one question, take the answer, and go away. The answer goes out while the
    // client is there to receive it, so the server is left holding no copy of it.
    async function connectAskAndLeave(reqId: number) {
      await startComm(assortedMethods);
      cleanup.push(() => stopComm());

      const ws = await connect();
      const [msg] = await getMessages(ws, 1) as CommClientConnect[];
      const clientId = msg.clientId;
      ws.send(JSON.stringify({ reqId, method: "methodSync", args: ["foo", 1] }));
      await getMessages(ws, 1);
      ws.close();
      await waitForSocketRelease(clientId);
      return clientId;
    }

    // Connect, wait for the server to lose the clientConnect it sends in reply, and go away again.
    async function connectAndLoseClientConnect(clientId: string, how: "failSend" | "swallow") {
      const lost = loseNextClientConnect(how);
      const ws = openSocket({ clientId, newClient: "0", counter: "c1" });
      await new Promise<void>((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
      await lost;
      ws.close();
      await waitForSocketRelease(clientId);
    }

    // Stop the next clientConnect from reaching the client. "failSend" is a socket that dies as
    // the server answers it; "swallow" is one that takes the message and goes quiet. The
    // difference matters: only the second leaves the server thinking it delivered something.
    function loseNextClientConnect(how: "failSend" | "swallow") {
      let notifyLost!: () => void;
      const lost = new Promise<void>((resolve) => { notifyLost = resolve; });
      const stub: sinon.SinonStub = sandbox.stub(Client.prototype as any, "_sendToWebsocket")
        .callsFake(async function(this: any, ...args: unknown[]): Promise<unknown> {
          const message = args[0] as string;
          if (message.includes(`"clientConnect"`)) {
            stub.restore();
            notifyLost();
            if (how === "failSend") { throw new Error("WebSocket is not open"); }
            return;
          }
          return stub.wrappedMethod.call(this, message);
        });
      return lost;
    }

    it("should keep hold of missed messages if clientConnect cannot be sent", async function() {
      const clientId = await queueAnswerForAbsentClient();

      // The tab reconnects, but the clientConnect carrying the answer never makes it out.
      await connectAndLoseClientConnect(clientId, "failSend");

      // The client learned nothing, so the server must still hold the answer for it.
      const { ws, msg } = await connectWithParams({ clientId, newClient: "0", counter: "c1" });
      assert.isFalse(msg.needReload);
      assert.deepEqual((msg.missedMessages || []).map(m => JSON.parse(m).data),
        [{ x: "foo", name: "methodControlled" }]);
      ws.close();
    });

    it("should let a client carry on once it has taken its missed messages", async function() {
      const clientId = await queueAnswerForAbsentClient();

      // The tab reconnects and takes the answer it missed.
      const { ws: ws1, msg: msg1 } = await connectWithParams({ clientId, newClient: "0", counter: "c1" });
      assert.isFalse(msg1.needReload);
      const seqIds = (msg1.missedMessages || []).map(m => JSON.parse(m).seqId);
      assert.lengthOf(seqIds, 1);
      ws1.close();
      await waitForSocketRelease(clientId);

      // The connection blips again, and this time the tab can say where it got to. Having taken
      // what we handed over, it must not be sent back to the start for it.
      const { ws: ws2, msg: msg2 } = await connectWithParams(
        { clientId, newClient: "0", counter: "c1", lastSeqId: String(seqIds[0]) });
      assert.isFalse(msg2.needReload);
      ws2.close();
      await waitForSocketRelease(clientId);

      // A later blip has nothing to report, since nothing was sent in between. A quiet
      // connection is not a client failing to account for the handover, which is settled by now.
      const { ws: ws3, msg: msg3 } = await connectWithParams({ clientId, newClient: "0", counter: "c1" });
      assert.isFalse(msg3.needReload, "expected a confirmed handover to stop being held against it");
      ws3.close();
    });

    it("should stop demanding a reload once the client has started over", async function() {
      const clientId = await connectAskAndLeave(0);
      await connectAndLoseClientConnect(clientId, "swallow");

      const { ws: ws1, msg: msg1 } = await connectWithParams({ clientId, newClient: "0", counter: "c1" });
      assert.isTrue(msg1.needReload, "expected the server to be asking for a reload");
      ws1.close();
      await waitForSocketRelease(clientId);

      // The tab reloads, as asked. It keeps its clientId, and the server has nothing more to say.
      const { ws: ws2, msg: msg2 } = await connectWithParams({ clientId, newClient: "1", counter: "c2" });
      assert.isFalse(msg2.needReload);
      ws2.close();
      await waitForSocketRelease(clientId);

      // A blip after that resumes as normal, rather than sending the tab round again.
      const { ws: ws3, msg: msg3 } = await connectWithParams({ clientId, newClient: "0", counter: "c2" });
      assert.isFalse(msg3.needReload);
      ws3.close();
    });

    it("should not report request ids from before a browser tab started over", async function() {
      // A tab connects and gets a fair way through its requests.
      const clientId = await connectAskAndLeave(42);

      // The tab is reloaded. It takes its clientId along, since that lives in sessionStorage, but
      // it is a fresh page numbering its requests from zero again.
      const { ws: ws2, msg: msg2 } = await connectWithParams({ clientId, newClient: "1", counter: "c2" });
      assert.equal(msg2.clientId, clientId, "expected the Client to be reused");
      ws2.close();
      await waitForSocketRelease(clientId);

      // The connection blips and the reloaded tab reconnects. The server must not claim to have
      // received request #42 of a page that has not got past #0, or the tab would sit waiting for
      // answers to requests that never reached anyone.
      const { ws: ws3, msg: msg3 } = await connectWithParams({ clientId, newClient: "0", counter: "c2" });
      assert.isFalse(msg3.needReload);
      assert.equal(msg3.lastReceivedReqId, "none");
      ws3.close();
    });

    it("should back off when the server accepts a connection and then drops it", async function() {
      this.timeout(20000);
      await startComm(assortedMethods);
      cleanup.push(() => stopComm());

      // Accept the websocket and then immediately drop it, as the server does when something goes
      // wrong while setting the connection up, such as a failure to look the user up.
      sandbox.stub(Comm.prototype as any, "_onWebSocketConnection")
        .callsFake(async (websocket: any) => { websocket.terminate(); });

      // Count how often the client tries.
      let attempts = 0;
      const port = (server.address() as AddressInfo).port;
      const settings = getWSSettings(`http://localhost:${port}`);
      const counted: GristWSSettings = {
        ...settings,
        makeWebSocket(url: string) { attempts++; return settings.makeWebSocket(url); },
      };

      stubWorkerConfig();
      const connection = GristWSConnection.create(null, counted);
      cleanup.push(async () => connection.dispose());
      connection.initialize(docId);

      // Left to retry at the shortest interval, the client would get through about one attempt a
      // second. Backing off, it should manage only a handful in this time.
      await delay(8000);
      assert.isAtMost(attempts, 6, `Expected the client to back off, but it tried ${attempts} times`);
    });

    it("should receive all server messages (small) in order when send doesn't fail", async function() {
      await testSendOrdering({ noFailedSend: true, useSmallMsgs: true });
    });

    it("should receive all server messages (large) in order when send doesn't fail", async function() {
      await testSendOrdering({ noFailedSend: true });
    });

    it("should order server messages correctly with failedSend before close", async function() {
      await testSendOrdering({ closeHappensFirst: false });
    });

    it("should order server messages correctly with close before failedSend", async function() {
      await testSendOrdering({ closeHappensFirst: true });
    });

    async function testSendOrdering(
      options: { noFailedSend?: boolean, closeHappensFirst?: boolean, useSmallMsgs?: boolean },
    ) {
      const eventsSeen: ("failedSend" | "close")[] = [];

      // Server-side Client object.
      let ssClient!: Client;

      const { cliComm, forwarder } = await startManagedConnection(assortedMethods);

      // Intercept the call to _onClose to know when it occurs, since we are trying to hit a
      // situation where 'close' and 'failedSend' events happen in either order.
      const stubOnClose: any = sandbox.stub(Client.prototype as any, "_onClose")
        .callsFake(function(this: Client) {
          eventsSeen.push("close");
          return stubOnClose.wrappedMethod.apply(this, arguments);
        });

      // Intercept calls to client.sendMessage(), to know when it fails, and possibly to delay the
      // failures to hit a particular order in which 'close' and 'failedSend' events are seen by
      // Client.ts. This is the only reliable way I found to reproduce this order of events.
      const stubSendToWebsocket: any = sandbox.stub(Client.prototype as any, "_sendToWebsocket")
        .callsFake(async function(this: Client) {
          try {
            return await stubSendToWebsocket.wrappedMethod.apply(this, arguments);
          } catch (err) {
            if (options.closeHappensFirst) { await delay(100); }
            eventsSeen.push("failedSend");
            throw err;
          }
        });

      // Watch the events received all the way on the client side.
      const eventSpy = sinon.spy();
      const clientConnectSpy = sinon.spy();
      cliComm.on("docUserAction", eventSpy);
      cliComm.on("clientConnect", clientConnectSpy);

      // We need to simulate an important property of the browser client: when needReload is set
      // in the clientConnect message, we are expected to reload the app. In the test, we replace
      // the GristWSConnection.
      cliComm.on("clientConnect", async (msg: CommClientConnect) => {
        ssClient = comm!.getClient(msg.clientId);
        if (msg.needReload) {
          await delay(0);
          cliComm.releaseDocConnection(docId);
          cliComm.useDocConnection(docId);
        }
      });

      // Wait for a connect call, which we rely on to get access to the Client object (ssClient).
      await waitForCondition(() => (clientConnectSpy.callCount > 0), 1000);

      // Send large buffers, to fill up the socket's buffers to get it to block.
      const data = "x".repeat(options.useSmallMsgs ? 100_000 : 10_000_000);
      const makeMessage = (n: number) => ({ type: "docUserAction", n, data });

      let n = 0;
      const sendPromises: Promise<void>[] = [];
      const sendNextMessage = () => sendPromises.push(ssClient.sendMessage(makeMessage(n++) as any));

      await testUtils.captureLog("warn", async () => {
        // Make a few sends. These are big enough not to return immediately. Keep the first two
        // successful (by awaiting them). And keep a few more that will fail. This is to test the
        // ordering of successful and failed messages that may be missed.
        sendNextMessage();
        sendNextMessage();
        sendNextMessage();
        await sendPromises[0];
        await sendPromises[1];

        sendNextMessage();
        sendNextMessage();

        // Forcibly close the forwarder, so that the server sees a 'close' event. But first let
        // some messages get to the client. In case we want all sends to succeed, let them all get
        // forwarded before disconnect; otherwise, disconnect after 2 are fowarded.
        const countToWaitFor = options.noFailedSend ? 5 : 2;
        await waitForCondition(() => eventSpy.callCount >= countToWaitFor);

        void (forwarder.disconnectServerSide());

        // Wait less than the delay that we add for delayFailedSend, and send another message. There
        // used to be a bug that such a message would get recorded into missedMessages out of order.
        await delay(50);
        sendNextMessage();

        // Now reconnect, and collect the messages that the client sees.
        clientConnectSpy.resetHistory();
        await forwarder.connect();

        // Wait until we get a clientConnect message that does not require a reload. (Except with
        // noFailedSend, the first one would have needReload set; and after the reconnect, we should
        // get one without.)
        await waitForCondition(() =>
          (clientConnectSpy.callCount > 0 && clientConnectSpy.lastCall.args[0].needReload === false),
        3000);
      });

      // This test helper is used for 3 different situations. Check that we observed that
      // situations we were trying to hit.
      if (options.noFailedSend) {
        if (options.useSmallMsgs) {
          assert.deepEqual(eventsSeen, ["close"]);
        } else {
          // Make sure to have waited long enough for the 'close' event we may have delayed
          await delay(20);

          // Large messages now cause a send to fail, after filling up buffer, and close the socket.
          assert.deepEqual(eventsSeen, ["close", "close"]);
        }
      } else if (options.closeHappensFirst) {
        assert.equal(eventsSeen[0], "close");
        assert.include(eventsSeen, "failedSend");
      } else {
        assert.equal(eventsSeen[0], "failedSend");
        assert.include(eventsSeen, "close");
      }

      // After a successful reconnect, subsequent calls should work normally.
      assert.deepEqual(await cliComm._makeRequest(null, null, "methodSync", 1, 2),
        { name: "methodSync", x: 1, y: 2 });

      // Check that all the received messages are in order.
      const messageNums = eventSpy.getCalls().map(call => call.args[0].n);
      assert.isAtLeast(messageNums.length, 2);
      assert.deepEqual(messageNums, nrange(0, messageNums.length),
        `Unexpected message sequence ${JSON.stringify(messageNums)}`);

      // Subsequent messages should work normally too.
      eventSpy.resetHistory();
      sendNextMessage();
      await waitForCondition(() => eventSpy.callCount > 0);
      assert.deepEqual(eventSpy.getCalls().map(call => call.args[0].n), [n - 1]);
    }

    // The seqIds of the messages the server is holding for a client.
    function queuedSeqIds(clientId: string): number[] {
      return [...(comm!.getClient(clientId) as any)._missedMessages.keys()].sort((a, b) => a - b);
    }

    // What the server tells a client that turns up asking to carry on. Each row puts the server
    // in a state and reconnects with given parameters. Past the stated outcome, every row is held
    // to two rules that must hold whatever the state, since between them they are what stops a
    // client waiting on an answer that is never coming.
    describe("what to tell a client that reconnects", function() {
      // The server volunteers a request id only when offering to resume. A fresh page is not
      // resuming, however little it is being asked to do.
      function assertOfferIsConsistent(resuming: boolean, msg: CommClientConnect) {
        assert.equal(msg.lastReceivedReqId !== undefined, resuming,
          resuming ? "a resume should say what it read" : "only a resume may say what it read");
      }

      // A resume must hand over every message the client has not accounted for, unbroken. A hole
      // would leave it waiting; a message left behind would leave it a message short.
      function assertNothingLeftBehind(resuming: boolean, held: number[], lastSeqId: number | undefined,
        msg: CommClientConnect) {
        if (!resuming) { return; }
        const delivered = (msg.missedMessages || []).map(m => JSON.parse(m).seqId);
        for (let i = 1; i < delivered.length; i++) {
          assert.equal(delivered[i], delivered[i - 1] + 1, `hole in delivery: ${delivered}`);
        }
        if (lastSeqId !== undefined && delivered.length) {
          assert.equal(delivered[0], lastSeqId + 1, "delivery should carry on where the client left off");
        }
        const owed = held.filter(seqId => lastSeqId === undefined || seqId > lastSeqId);
        assert.deepEqual(delivered, owed, "a resume should hand over exactly what the client is owed");
      }

      const cases: {
        state: "holding an answer" | "answered while connected" | "handed over unconfirmed" |
          "reload demanded but lost",
        newClient: string,
        lastSeqId?: number,
        needReload: boolean,
        why: string,
      }[] = [
        { state: "holding an answer", newClient: "0", needReload: false,
          why: "the answer is still here to hand over" },
        { state: "holding an answer", newClient: "0", lastSeqId: 0, needReload: false,
          why: "the client already has it" },
        { state: "holding an answer", newClient: "1", needReload: false,
          why: "a fresh page needs nothing and is told to reload nothing" },

        { state: "answered while connected", newClient: "0", needReload: true,
          why: "the answer went out live and is gone, and the client cannot account for it" },
        { state: "answered while connected", newClient: "0", lastSeqId: 0, needReload: false,
          why: "the client accounts for everything" },

        { state: "handed over unconfirmed", newClient: "0", needReload: true,
          why: "we let go of messages this client says it never received" },
        { state: "handed over unconfirmed", newClient: "0", lastSeqId: 0, needReload: false,
          why: "the client can show it received them after all" },

        { state: "reload demanded but lost", newClient: "0", needReload: true,
          why: "it never heard the demand, and we have moved past what it missed" },
        { state: "reload demanded but lost", newClient: "0", lastSeqId: 0, needReload: true,
          why: "accounting for messages is no help once the demand has gone unheard" },
        { state: "reload demanded but lost", newClient: "1", needReload: false,
          why: "the page started over, which is all we were waiting for" },
      ];

      for (const c of cases) {
        const params = `newClient=${c.newClient}` + (c.lastSeqId === undefined ? "" : `, lastSeqId=${c.lastSeqId}`);
        it(`${c.needReload ? "should demand a reload" : "should let it carry on"} ` +
          `(${c.state}, ${params}): ${c.why}`, async function() {
          let clientId: string;
          switch (c.state) {
            case "holding an answer":
              clientId = await queueAnswerForAbsentClient();
              break;
            case "answered while connected":
              clientId = await connectAskAndLeave(0);
              break;
            case "handed over unconfirmed":
              clientId = await queueAnswerForAbsentClient();
              await connectAndLoseClientConnect(clientId, "swallow");
              break;
            case "reload demanded but lost":
              clientId = await connectAskAndLeave(0);
              await connectAndLoseClientConnect(clientId, "swallow");
              break;
          }

          const held = queuedSeqIds(clientId);
          const query: Record<string, string> = { clientId, newClient: c.newClient, counter: "c1" };
          if (c.lastSeqId !== undefined) { query.lastSeqId = String(c.lastSeqId); }
          const { ws, msg } = await connectWithParams(query);

          assert.equal(msg.needReload, c.needReload, c.why);
          const resuming = c.newClient === "0" && !msg.needReload;
          assertOfferIsConsistent(resuming, msg);
          assertNothingLeftBehind(resuming, held, c.lastSeqId, msg);
          ws.close();
        });
      }
    });

    // What the client does with a request left in flight when a clientConnect arrives. The three
    // outcomes are: wait for an answer the server says is coming, send it again because it
    // provably never landed, or reject it because nobody can say what became of it. Rejecting one
    // that never arrived costs the user an error for nothing; re-sending one that did arrive
    // could repeat work already done. So each row is worth stating.
    describe("what to do with a request in flight", function() {
      const RESEND = "resend", WAIT = "wait";

      // A request numbered 4, so rows can put the server's last-read id either side of it.
      const REQ_ID = 4;

      const cases: {
        name: string,
        sent?: boolean,              // did the request go out?
        elsewhere?: boolean,         // did it go out on some other connection?
        needReload?: boolean,        // is the server telling us to start over?
        lastReceivedReqId?: number | "none",  // what the server read, undefined for "did not say"
        boundClientId?: string,      // the request is only valid for this clientId
        expected: string,            // RESEND, WAIT, or the error the caller should see
      }[] = [
        // Never sent, so it has had no effect and asking is always safe.
        { name: "never sent, server up to date", lastReceivedReqId: 9, expected: RESEND },
        { name: "never sent, server silent", expected: RESEND },
        { name: "never sent, reload demanded", needReload: true, expected: RESEND },
        { name: "never sent, bound to an older clientId", boundClientId: "stale",
          expected: "pending with outdated clientId" },

        // Sent, and the server accounts for it: it is in hand, and the answer cannot go astray.
        { name: "sent, server read past it", sent: true, lastReceivedReqId: REQ_ID + 1, expected: WAIT },
        { name: "sent, server read exactly it", sent: true, lastReceivedReqId: REQ_ID, expected: WAIT },

        // Sent, and the server read on past without seeing it, so it never arrived.
        { name: "sent, server stopped short of it", sent: true, lastReceivedReqId: REQ_ID - 1, expected: RESEND },
        { name: "sent, server read nothing at all", sent: true, lastReceivedReqId: "none", expected: RESEND },

        // Sent, and nothing the server said covers it.
        { name: "sent, server did not say", sent: true, expected: "interrupted by reconnect" },
        { name: "sent, reload demanded", sent: true, needReload: true, lastReceivedReqId: REQ_ID,
          expected: "interrupted by reconnect" },
        { name: "sent on another connection", sent: true, elsewhere: true, lastReceivedReqId: REQ_ID,
          expected: "interrupted by reconnect" },

        // An outdated clientId only bites a request that is still ours to hold back.
        { name: "in hand, though bound to an older clientId", sent: true, lastReceivedReqId: REQ_ID,
          boundClientId: "stale", expected: WAIT },
        { name: "never arrived, and bound to an older clientId", sent: true, lastReceivedReqId: REQ_ID - 1,
          boundClientId: "stale", expected: "pending with outdated clientId" },
      ];

      for (const c of cases) {
        it(`should ${c.expected === RESEND ? "send again" : c.expected === WAIT ? "wait" : "reject"}: ` +
          `${c.name}`, function() {
          stubWorkerConfig();
          const cliComm = ClientComm.create() as ClientComm & BackboneEvents;
          cleanup.push(async () => cliComm.dispose());

          // The connection the clientConnect arrived on, and another the request may have used.
          const send = sinon.stub().returns(true);
          const dispose = sinon.stub();
          const reconnected = { clientId: "current", send, dispose } as unknown as GristWSConnection;
          const other = {
            clientId: "current", send: sinon.stub().returns(true), dispose,
          } as unknown as GristWSConnection;
          (cliComm as any)._connections.set(null, reconnected);

          const reject = sinon.stub();
          const request = {
            resolve: sinon.stub(), reject,
            clientId: c.boundClientId ?? null,
            docId: null,
            methodName: "methodSync",
            requestMsg: "the request",
            sent: Boolean(c.sent),
            sentOn: c.sent ? (c.elsewhere ? other : reconnected) : null,
          };
          cliComm.pendingRequests.set(REQ_ID, request as any);

          // A row that leaves lastReceivedReqId out is testing "the server did not say", which is
          // not the same as a row that sets it to "none", so the field is only added when named.
          const connectMsg: CommClientConnect = {
            type: "clientConnect", clientId: "current", needReload: Boolean(c.needReload),
            ...("lastReceivedReqId" in c ? { lastReceivedReqId: c.lastReceivedReqId } : {}),
          } as CommClientConnect;
          (cliComm as any)._resendPendingRequest(REQ_ID, request, connectMsg, reconnected);

          if (c.expected === RESEND) {
            assert.deepEqual(send.args, [["the request"]], "expected the request to go out again");
            assert.equal(reject.callCount, 0, "expected no rejection");
            assert.isTrue(cliComm.pendingRequests.has(REQ_ID), "expected the request to stay pending");
          } else if (c.expected === WAIT) {
            assert.equal(send.callCount, 0, "expected nothing to be sent");
            assert.equal(reject.callCount, 0, "expected no rejection");
            assert.isTrue(cliComm.pendingRequests.has(REQ_ID), "expected the request to stay pending");
          } else {
            assert.equal(send.callCount, 0, "expected nothing to be sent");
            assert.match(reject.args[0]?.[0]?.message ?? "", new RegExp(c.expected));
            assert.isFalse(cliComm.pendingRequests.has(REQ_ID), "expected the request to be dropped");
          }
        });
      }
    });
  });

  describe("websocket auth", function() {
    const ANONYMOUS_ID = 1;

    function makeUser(id: number, name: string, extra?: Partial<User>): User {
      return { id, name, disabledAt: null, type: "login", ...extra } as User;
    }

    const anonymous = makeUser(ANONYMOUS_ID, "Anonymous");
    const chimpy = makeUser(10, "Chimpy", { loginEmail: "chimpy@getgrist.com" });
    const ham = makeUser(99, "Ham", { loginEmail: "ham@getgrist.com" });

    function makeDbManager(overrides?: Partial<HomeDBAuth>): HomeDBAuth {
      return {
        getAnonymousUserId: () => ANONYMOUS_ID,
        getSupportUserId: () => 2,
        getAnonymousUser: () => anonymous,
        getUser: async () => undefined,
        getUserByKey: async () => undefined,
        getUserByLogin: async () => chimpy,
        getUserByLoginWithRetry: async () => chimpy,
        getBestUserForOrg: async () => null,
        getServiceAccountByLoginWithOwner: async () => null,
        makeFullUser: (user: User) => ({
          id: user.id, name: user.name, email: user.loginEmail || "", loginEmail: user.loginEmail || "",
          ...(user.id === ANONYMOUS_ID ? { anonymous: true } : {}),
        }),
        ...overrides,
      } as HomeDBAuth;
    }

    function makePermitStore(overrides?: Partial<IPermitStore>): IPermitStore {
      return {
        getPermit: async () => null,
        setPermit: async () => "",
        removePermit: async () => {},
        close: async () => {},
        getKeyPrefix: () => "test",
        ...overrides,
      };
    }

    function startAuthComm(db: HomeDBAuth, options?: {
      gristServer?: GristServer,
      permitStore?: IPermitStore,
    }) {
      server = http.createServer();
      fakeHosts = new FakeHosts();
      comm = new Comm({
        sessions,
        hosts: fakeHosts.asHosts,
        dbManager: db,
        gristServer: options?.gristServer ?? createDummyGristServer(),
        permitStore: options?.permitStore ?? makePermitStore(),
      });
      server.on("request", (...args) => comm?.handleHTTPRequest(...args));
      server.on("upgrade",
        (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => comm?.handleHTTPUpgrade(req, socket, head),
      );
      comm.registerMethods(assortedMethods);
      return listenPromise(server.listen(0, "localhost"));
    }

    // Wait for the websocket to be closed by the server (e.g. after an auth error).
    function waitForClose(ws: GristClientSocket): Promise<void> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("expected connection to be terminated")), 2000);
        ws.onclose = () => { clearTimeout(timer); resolve(); };
        ws.onerror = () => { clearTimeout(timer); resolve(); };
      });
    }

    afterEach(async function() {
      await stopComm();
    });

    it("should authenticate via API key", async function() {
      const db = makeDbManager({
        getUserByKey: async key => key === "api_key_for_chimpy" ? chimpy : undefined,
      });
      await startAuthComm(db);

      const ws = await connect({ headers: { authorization: "Bearer api_key_for_chimpy" } });
      const msgs = await getMessages(ws, 1);
      assert.equal(msgs[0].type, "clientConnect");
      const client = comm!.getClient(msgs[0].clientId);
      assert.equal(client.authSession.userId, chimpy.id);
      assert.isTrue(client.authSession.userIsAuthorized);
      assert.isTrue(client.authSession.isApiKeyAuth);
    });

    it("should terminate connection on invalid API key", async function() {
      const db = makeDbManager({ getUserByKey: async () => undefined });
      await startAuthComm(db);
      await testUtils.captureLog("error", async () => {
        const ws = await connect({ headers: { authorization: "Bearer bad-key" } });
        await waitForClose(ws);
      });
    });

    it("should terminate connection for disabled user", async function() {
      const kiwi = makeUser(20, "Kiwi", { disabledAt: new Date(), loginEmail: "kiwi@getgrist.com" });
      const db = makeDbManager({ getUserByKey: async () => kiwi });
      await startAuthComm(db);
      await testUtils.captureLog("error", async () => {
        const ws = await connect({ headers: { authorization: "Bearer api_key_for_kiwi" } });
        await waitForClose(ws);
      });
    });

    it("should fall back to anonymous without credentials", async function() {
      await startAuthComm(makeDbManager());
      const ws = await connect();
      const msgs = await getMessages(ws, 1);
      assert.equal(msgs[0].type, "clientConnect");
      const client = comm!.getClient(msgs[0].clientId);
      assert.equal(client.authSession.userId, ANONYMOUS_ID);
      assert.isFalse(client.authSession.userIsAuthorized);
      assert.isFalse(client.authSession.isApiKeyAuth);
    });

    it("should authenticate via boot key", async function() {
      const oldBootKey = process.env.GRIST_BOOT_KEY;
      try {
        process.env.GRIST_BOOT_KEY = "secret-boot";
        getBootKey.cache.clear();
        const gristServer: GristServer = {
          ...createDummyGristServer(),
          getInstallAdmin: () => ({ getAdminUser: async () => ham } as InstallAdmin),
        };
        await startAuthComm(makeDbManager(), { gristServer });
        const ws = await connect({ headers: { "x-boot-key": "secret-boot" } });
        const msgs = await getMessages(ws, 1);
        assert.equal(msgs[0].type, "clientConnect");
        const client = comm!.getClient(msgs[0].clientId);
        assert.equal(client.authSession.userId, ham.id);
        assert.isTrue(client.authSession.userIsAuthorized);
        assert.isFalse(client.authSession.isApiKeyAuth);
      } finally {
        if (oldBootKey === undefined) {
          delete process.env.GRIST_BOOT_KEY;
        } else {
          process.env.GRIST_BOOT_KEY = oldBootKey;
        }
        getBootKey.cache.clear();
      }
    });

    it("should authenticate via permit header", async function() {
      const permit: Permit = { docId: "doc1" };
      const permitStore = makePermitStore({
        getPermit: async key => key === "pk" ? permit : null,
      });
      await startAuthComm(makeDbManager(), { permitStore });
      const ws = await connect({ headers: { permit: "pk" } });
      const msgs = await getMessages(ws, 1);
      assert.equal(msgs[0].type, "clientConnect");
      const client = comm!.getClient(msgs[0].clientId);
      assert.equal(client.authSession.userId, ANONYMOUS_ID);
    });

    it("should not let a different identity reuse a clientId on reconnect", async function() {
      const db = makeDbManager({
        getUserByKey: async key => key === "api_key_for_chimpy" ? chimpy : undefined,
      });
      await startAuthComm(db);

      // Chimpy connects and is assigned a clientId.
      const ws1 = await connect({ headers: { authorization: "Bearer api_key_for_chimpy" } });
      const [msg1] = await getMessages(ws1, 1) as CommClientConnect[];
      const clientId = msg1.clientId;
      assert.equal(comm!.getClient(clientId).authSession.userId, chimpy.id);

      // Chimpy's socket drops, but the Client lingers and becomes available for reconnect.
      ws1.close();
      await waitForSocketRelease(clientId);

      // An anonymous reconnect guessing the clientId must NOT reuse Chimpy's Client: it gets a fresh
      // anonymous Client (new clientId) and is told to reload, and Chimpy's Client is left intact.
      const { ws: wsAnon, msg: anonMsg } = await connectWithParams({ clientId, newClient: "0", counter: "c1" });
      assert.notEqual(anonMsg.clientId, clientId);
      assert.isTrue(anonMsg.needReload);
      assert.equal(comm!.getClient(anonMsg.clientId).authSession.userId, ANONYMOUS_ID);
      assert.equal(comm!.getClient(clientId).authSession.userId, chimpy.id);
      wsAnon.close();
    });

    it("should let the same identity reuse a clientId on reconnect", async function() {
      const db = makeDbManager({
        getUserByKey: async key => key === "api_key_for_chimpy" ? chimpy : undefined,
      });
      await startAuthComm(db);

      const ws1 = await connect({ headers: { authorization: "Bearer api_key_for_chimpy" } });
      const [msg1] = await getMessages(ws1, 1) as CommClientConnect[];
      const clientId = msg1.clientId;

      ws1.close();
      await waitForSocketRelease(clientId);

      // The same user reconnecting with the clientId reuses the Client seamlessly (no reload).
      const { ws: ws2, msg: msg2 } = await connectWithParams({ clientId, newClient: "0", counter: "c1" },
        { headers: { authorization: "Bearer api_key_for_chimpy" } },
      );
      assert.equal(msg2.clientId, clientId);
      assert.isFalse(msg2.needReload);
      ws2.close();
    });

    it("should not let a credentialed session reuse a clientId", async function() {
      // Access tokens (?auth=) and OAuth tokens authenticate as the anonymous user, carrying the
      // real identity in a credential. Check that those don't allow unwanted clientId reuse.
      const db = makeDbManager({
        getUser: async (id: number) => (id === chimpy.id ? chimpy : undefined),
      });
      const accessTokens: IAccessTokens = {
        verify: async (token: string): Promise<AccessTokenInfo> =>
          ({ userId: token === "token_chimpy" ? chimpy.id : ANONYMOUS_ID, docId: "doc1" }),
        sign: async () => "",
        getNominalTTLInMsec: () => 0,
        close: async () => {},
      };
      await startAuthComm(db, {
        gristServer: { ...createDummyGristServer(), getAccessTokens: () => accessTokens },
      });

      // Chimpy connects with an access token and is assigned a clientId: anonymous at the session
      // level, but Chimpy via the credential's identifiedUser.
      const { ws: ws1, msg: msg1 } = await connectWithParams({ auth: "token_chimpy" });
      const clientId = msg1.clientId;
      assert.equal(comm!.getClient(clientId).authSession.userId, ANONYMOUS_ID);
      assert.equal(comm!.getClient(clientId).authSession.identifiedUser!.id, chimpy.id);

      // Chimpy's socket drops, but the Client lingers and becomes available for reconnect.
      ws1.close();
      await waitForSocketRelease(clientId);

      // An anonymous reconnect guessing the clientId must NOT reuse Chimpy's Client, even though
      // Chimpy's session also uses the anonymous userId. The presence of the credential should
      // force a fresh Client + reload.
      const { ws: wsAnon, msg: anonMsg } = await connectWithParams({ clientId, newClient: "0", counter: "c1" });
      assert.notEqual(anonMsg.clientId, clientId);
      assert.isTrue(anonMsg.needReload);
      assert.equal(comm!.getClient(anonMsg.clientId).authSession.userId, ANONYMOUS_ID);
      assert.equal(comm!.getClient(clientId).authSession.userId, ANONYMOUS_ID);
      assert.equal(comm!.getClient(clientId).authSession.identifiedUser!.id, chimpy.id);
      wsAnon.close();

      // An Access-token request, even for Chimpy also must not reuse Chimpy's client (because
      // that's safer: to allow reuse, we'd need to respect AuthCredential-specific restrictions).
      const { ws: ws2, msg: msg2 } = await connectWithParams(
        { clientId, newClient: "0", counter: "c1", auth: "token_chimpy" });
      assert.notEqual(msg2.clientId, clientId);
      assert.isTrue(msg2.needReload);
      assert.equal(comm!.getClient(msg2.clientId).authSession.userId, ANONYMOUS_ID);
      assert.equal(comm!.getClient(msg2.clientId).authSession.identifiedUser!.id, chimpy.id);
      assert.equal(comm!.getClient(clientId).authSession.userId, ANONYMOUS_ID);
      assert.equal(comm!.getClient(clientId).authSession.identifiedUser!.id, chimpy.id);
      ws2.close();
    });
  });

  describe("Allowed Origin", function() {
    beforeEach(async function() {
      await startComm(assortedMethods);
    });

    afterEach(async function() {
      await stopComm();
    });

    async function checkOrigin(headers: { origin: string, host: string }, allowed: boolean) {
      const promise = connect({ headers });
      if (allowed) {
        await assert.isFulfilled(promise, `${headers.host} should allow ${headers.origin}`);
      } else {
        await assert.isRejected(promise, /.*/, `${headers.host} should reject ${headers.origin}`);
      }
    }

    it("origin should match base domain of host", async () => {
      await checkOrigin({ origin: "https://www.toto.com", host: "worker.example.com" }, false);
      await checkOrigin({ origin: "https://badexample.com", host: "worker.example.com" }, false);
      await checkOrigin({ origin: "https://bad.com/example.com", host: "worker.example.com" }, false);
      await checkOrigin({ origin: "https://front.example.com", host: "worker.example.com" }, true);
      await checkOrigin({ origin: "https://front.example.com:3000", host: "worker.example.com" }, true);
      await checkOrigin({ origin: "https://example.com", host: "example.com" }, true);
    });

    it("with custom domains, origin should match the full hostname", async () => {
      fakeHosts.isCustomHost = true;

      // For a request to a custom domain, the full hostname must match.
      await checkOrigin({ origin: "https://front.example.com", host: "worker.example.com" }, false);
      await checkOrigin({ origin: "https://front.example.com", host: "front.example.com" }, true);
      await checkOrigin({ origin: "https://front.example.com:3000", host: "front.example.com" }, true);
    });
  });

  describe("upgrade fallthrough on servers without Comm", function() {
    // Ensures incoming upgrade requests that aren't handled by socket proxy or Comm (e.g. on a static-only server)
    // are explicitly terminated, to avoid sockets sitting half-open.

    let fallthroughServer: http.Server;
    let fallthroughPort: number;

    beforeEach(async function() {
      fallthroughServer = http.createServer((_req, res) => { res.writeHead(404).end(); });
      fallthroughServer.on("upgrade", (_req, socket: net.Socket) => {
        terminateSocketWithHttpResponse(socket, 404);
      });
      await listenPromise(fallthroughServer.listen(0, "127.0.0.1"));
      fallthroughPort = (fallthroughServer.address() as AddressInfo).port;
    });

    afterEach(async function() {
      await fromCallback((cb) => {
        fallthroughServer.close(cb);
        fallthroughServer.closeAllConnections();
      });
    });

    it("responds 404 and closes the socket instead of leaving it hanging", async function() {
      // Short overall timeout — a regression here would hang the socket until the OS gives up,
      // so we want the test to fail fast rather than the whole suite stall.
      this.timeout(2000);

      const client = net.createConnection(fallthroughPort, "127.0.0.1");
      try {
        await new Promise<void>((resolve, reject) => {
          client.once("connect", resolve);
          client.once("error", reject);
        });

        client.write(
          "GET / HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${fallthroughPort}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n",
        );

        // Collect the full response, then wait for close. If the server ever regresses to
        // leaving the socket half-open, the "close" event never fires and the test's 2s
        // timeout kicks in.
        const chunks: Buffer[] = [];
        client.on("data", chunk => chunks.push(chunk));
        await new Promise<void>((resolve, reject) => {
          client.once("close", resolve);
          client.once("error", reject);
        });

        const response = Buffer.concat(chunks).toString("utf8");
        assert.match(response, /^HTTP\/1\.1 404\b/, `expected 404, got: ${response.split("\r\n")[0]}`);
      } finally {
        client.destroy();
      }
    });
  });
});

// Waits for condFunc() to return true, for up to timeoutMs milliseconds, sleeping for stepMs
// between checks. Returns if succeeded, throws if failed.
async function waitForCondition(condFunc: () => boolean, timeoutMs = 1000, stepMs = 10): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (condFunc()) { return; }
    await delay(stepMs);
  }
  throw new Error(`Condition not met after ${timeoutMs}ms: ${condFunc.toString()}`);
}

// Returns a range of count consecutive numbers starting with start.
function nrange(start: number, count: number): number[] {
  return Array.from(Array(count), (_, i) => start + i);
}

// Returns a GristWSSettings object, for use with GristWSConnection.
function getWSSettings(docWorkerUrl: string): GristWSSettings {
  let clientId: string = "clientid-abc";
  let counter: number = 0;
  return {
    makeWebSocket(url: string): any { return new GristClientSocket(url); },
    async getTimezone()         { return "UTC"; },
    getPageUrl()                { return "http://localhost"; },
    async getDocWorkerUrl()     { return docWorkerUrl; },
    getClientId(did: any)       { return clientId; },
    getUserSelector()           { return ""; },
    updateClientId(did: string, cid: string) { clientId = cid; },
    advanceCounter(): string    { return String(counter++); },
    log()                       { (log as any).debug(...arguments); },
    warn()                      { (log as any).warn(...arguments); },
  };
}
