import {Events as BackboneEvents} from 'backbone';
import {promisifyAll} from 'bluebird';
import {assert} from 'chai';
import * as http from 'http';
import {AddressInfo} from 'net';
import * as sinon from 'sinon';
import * as path from 'path';
import * as tmp from 'tmp';

import {GristWSConnection, GristWSSettings} from 'app/client/components/GristWSConnection';
import {GristClientSocket, GristClientSocketOptions} from 'app/client/components/GristClientSocket';
import {Comm as ClientComm} from 'app/client/components/Comm';
import * as log from 'app/client/lib/log';
import {Comm} from 'app/server/lib/Comm';
import {Client, ClientMethod} from 'app/server/lib/Client';
import {CommClientConnect} from 'app/common/CommTypes';
import {delay} from 'app/common/delay';
import {isLongerThan} from 'app/common/gutil';
import {fromCallback, listenPromise} from 'app/server/lib/serverUtils';
import {Sessions} from 'app/server/lib/Sessions';
import {TcpForwarder} from 'test/server/tcpForwarder';
import * as testUtils from 'test/server/testUtils';
import * as session from '@gristlabs/express-session';
import { Hosts, RequestOrgInfo } from 'app/server/lib/extractOrg';

const SQLiteStore = require('@gristlabs/connect-sqlite3')(session);
promisifyAll(SQLiteStore.prototype);


// Just enough implementation of Hosts to be able to fake using a custom host.
class FakeHosts {

  public isCustomHost = false;

  public get asHosts() { return this as unknown as Hosts; }

  public async addOrgInfo<T extends http.IncomingMessage>(req: T): Promise<T & RequestOrgInfo> {
    return Object.assign(req, {
      isCustomHost: this.isCustomHost,
      org: "example",
      url: req.url!
    });
  }
}

describe('Comm', function() {

  testUtils.setTmpLogLevel(process.env.VERBOSE ? 'debug' : 'warn');

  // Allow test cases to register afterEach callbacks here for easier cleanup.
  const cleanup: Array<() => void> = [];

  let server: http.Server;
  let sessions: Sessions;
  let fakeHosts: FakeHosts;
  let comm: Comm|null = null;
  const sandbox = sinon.createSandbox();

  before(async function() {
    const sessionDB = tmp.fileSync();
    const sessionStore = new SQLiteStore({
      dir: path.dirname(sessionDB.name),
      db: path.basename(sessionDB.name),
      table: 'sessions'
    });
    // Random string to use for the test session secret.
    const sessionSecret = 'xkwriagasaqystubgkkbwhqtyyncwqjemyncnmetjpkiwtfzvllejpfneldmoyri';
    sessions = new Sessions(sessionSecret, sessionStore);
  });

  function startComm(methods: {[name: string]: ClientMethod}) {
    server = http.createServer();
    fakeHosts = new FakeHosts();
    comm = new Comm(server, {sessions, hosts: fakeHosts.asHosts});
    comm.registerMethods(methods);
    return listenPromise(server.listen(0, 'localhost'));
  }

  async function stopComm() {
    comm?.destroyAllClients();
    await comm?.testServerShutdown();
    await fromCallback(cb => {
      server.close(cb);
      server.closeAllConnections();
    });
  }

  const assortedMethods: {[name: string]: ClientMethod} = {
    methodSync: async function(client, x, y) {
      return {x: x, y: y, name: "methodSync"};
    },
    methodError: async function(client, x, y) {
      throw new Error("fake error");
    },
    methodAsync: async function(client, x, y) {
      await delay(20);
      return {x: x, y: y, name: "methodAsync"};
    },
    methodSend: async function(client, docFD) {
      void(client.sendMessage({docFD, type: "fooType" as any, data: "foo"}));
      void(client.sendMessage({docFD, type: "barType" as any, data: "bar"}));
    }
  };

  beforeEach(function() {
    // Silence console messages from client-side Comm.ts.
    if (!process.env.VERBOSE) {
      // TODO: This no longer works, now that 'log' is a more proper "module" object rather than
      // an arbitrary JS object. Also used in a couple other tests where logs are no longer
      // silenced.
      sandbox.stub(log, 'debug');
    }
  });

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
    const ws = new GristClientSocket('ws://localhost:' + (server.address() as AddressInfo).port, options);
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
      ws.send(JSON.stringify({reqId: 10, method: "methodSync", args: ["hello", "world"]}));
      const messages = await getMessages(ws, 1);
      const resp = messages[0];
      assert.equal(resp.reqId, 10, `Messages received instead: ${JSON.stringify(messages)}`);
      assert.deepEqual(resp.data, {x: "hello", y: "world", name: "methodSync"});
    });

    it("should work for async calls", async function() {
      ws.send(JSON.stringify({reqId: 20, method: "methodAsync", args: ["hello", "world"]}));
      const messages = await getMessages(ws, 1);
      const resp = messages[0];
      assert.equal(resp.reqId, 20);
      assert.deepEqual(resp.data, {x: "hello", y: "world", name: "methodAsync"});
    });

    it("should work for out-of-order calls", async function() {
      ws.send(JSON.stringify({reqId: 30, method: "methodAsync", args: [1, 2]}));
      ws.send(JSON.stringify({reqId: 31, method: "methodSync", args: [3, 4]}));
      const messages = await getMessages(ws, 2);
      assert.equal(messages[0].reqId, 31);
      assert.deepEqual(messages[0].data, {x: 3, y: 4, name: "methodSync"});
      assert.equal(messages[1].reqId, 30);
      assert.deepEqual(messages[1].data, {x: 1, y: 2, name: "methodAsync"});
    });

    it("should return error when a call fails", async function() {
      const logMessages = await testUtils.captureLog('warn', async () => {
        ws.send(JSON.stringify({reqId: 40, method: "methodError", args: ["hello"]}));
        const messages = await getMessages(ws, 1);
        const resp = messages[0];
        assert.equal(resp.reqId, 40);
        assert.equal(resp.data, undefined);
        assert(resp.error.indexOf('fake error') >= 0);
      });
      testUtils.assertMatchArray(logMessages, [
        /^warn: Client.* Error: fake error[^]+at methodError/,
        /^warn: Client.* responding to .* ERROR fake error/,
      ]);
    });

    it("should return error for unknown methods", async function() {
      const logMessages  = await testUtils.captureLog('warn', async () => {
        ws.send(JSON.stringify({reqId: 50, method: "someUnknownMethod", args: []}));
        const messages = await getMessages(ws, 1);
        const resp = messages[0];
        assert.equal(resp.reqId, 50);
        assert.equal(resp.data, undefined);
        assert(resp.error.indexOf('Unknown method') >= 0);
      });
      testUtils.assertMatchArray(logMessages, [
        /^warn: Client.* Unknown method.*someUnknownMethod/
      ]);
    });

    it('should only log warning for malformed JSON data', async function () {
      const logMessages  = await testUtils.captureLog('warn', async () => {
        ws.send('foobar');
      }, {waitForFirstLog: true});
      testUtils.assertMatchArray(logMessages, [
        /^warn: Client.* Unexpected token.*/
      ]);
    });

    it('should log warning when null value is passed', async function () {
      const logMessages  = await testUtils.captureLog('warn', async () => {
        ws.send('null');
      }, {waitForFirstLog: true});
      testUtils.assertMatchArray(logMessages, [
        /^warn: Client.*Cannot read properties of null*/
      ]);
    });

    it("should support app-level events correctly", async function() {
      comm!.broadcastMessage('fooType' as any, 'hello');
      comm!.broadcastMessage('barType' as any, 'world');
      const messages = await getMessages(ws, 2);
      assert.equal(messages[0].type, 'fooType');
      assert.equal(messages[0].data, 'hello');
      assert.equal(messages[1].type, 'barType');
      assert.equal(messages[1].data, 'world');
    });

    it("should support doc-level events", async function() {
      ws.send(JSON.stringify({reqId: 60, method: "methodSend", args: [13]}));
      const messages = await getMessages(ws, 3);
      assert.equal(messages[0].type, 'fooType');
      assert.equal(messages[0].data, 'foo');
      assert.equal(messages[0].docFD, 13);
      assert.equal(messages[1].type, 'barType');
      assert.equal(messages[1].data, 'bar');
      assert.equal(messages[1].docFD, 13);
      assert.equal(messages[2].reqId, 60);
      assert.equal(messages[2].data, undefined);
      assert.equal(messages[2].error, undefined);
    });
  });

  describe("reconnects", function() {
    const docId = "docId_abc";
    this.timeout(10000);

    // Helper to set up a Comm server, a Comm client, and a forwarder between them that allows
    // simulating disconnects.
    async function startManagedConnection(methods: {[name: string]: ClientMethod}) {
      // Start the server Comm, providing a few methods.
      await startComm(methods);
      cleanup.push(() => stopComm());

      // Create a forwarder, which we use to test disconnects.
      const serverPort = (server.address() as AddressInfo).port;
      const forwarder = new TcpForwarder(serverPort);
      const forwarderPort = await forwarder.pickForwarderPort();
      await forwarder.connect();
      cleanup.push(() => forwarder.disconnect());

      // To create a client-side Comm object, we need to trick GristWSConnection's check for
      // whether there is a worker to connect to.
      (global as any).window = undefined;
      sandbox.stub(global as any, 'window').value({gristConfig: {getWorker: 'STUB', assignmentId: docId}});

      // We also need to get GristWSConnection to use a custom GristWSSettings object, and to
      // connect to the forwarder's port.
      const docWorkerUrl = `http://localhost:${forwarderPort}`;
      const settings = getWSSettings(docWorkerUrl);
      const stubGristWsCreate = sandbox.stub(GristWSConnection, 'create').callsFake(function(this: any, owner) {
        return (stubGristWsCreate as any).wrappedMethod.call(this, owner, settings);
      });

      // Cast with BackboneEvents to allow using cliComm.on().
      const cliComm = ClientComm.create() as ClientComm & BackboneEvents;
      cliComm.useDocConnection(docId);
      cleanup.push(() => cliComm.dispose());      // Dispose after this test ends.

      return {cliComm, forwarder};
    }

    it('should forward calls on a normal connection', async function() {
      const {cliComm} = await startManagedConnection(assortedMethods);

      // A couple of regular requests.
      const resp1 = await cliComm._makeRequest(null, null, "methodSync", "foo", 1);
      assert.deepEqual(resp1, {name: 'methodSync', x: "foo", y: 1});
      const resp2 = await cliComm._makeRequest(null, null, "methodAsync", "foo", 2);
      assert.deepEqual(resp2, {name: 'methodAsync', x: "foo", y: 2});

      // Try calls that return out of order.
      const [resp3, resp4] = await Promise.all([
        cliComm._makeRequest(null, null, "methodAsync", "foo", 3),
        cliComm._makeRequest(null, null, "methodSync", "foo", 4),
      ]);
      assert.deepEqual(resp3, {name: 'methodAsync', x: "foo", y: 3});
      assert.deepEqual(resp4, {name: 'methodSync', x: "foo", y: 4});
    });

    it('should forward missed responses when a server send fails', async function() {
      await testMissedResponses(true);
    });
    it('should forward missed responses when a server send is queued', async function() {
      await testMissedResponses(false);
    });

    async function testMissedResponses(sendShouldFail: boolean) {
      let failedSendCount = 0;

      const {cliComm, forwarder} = await startManagedConnection({...assortedMethods,
        // An extra method that simulates a lost connection on server side prior to response.
        testDisconnect: async function(client, x, y) {
          setTimeout(() => forwarder.disconnectServerSide(), 0);
          if (!sendShouldFail) {
            // Add a delay to let the 'close' event get noticed first.
            await delay(20);
          }
          return {x: x, y: y, name: "testDisconnect"};
        },
      });

      const resp1 = await cliComm._makeRequest(null, null, "methodSync", "foo", 1);
      assert.deepEqual(resp1, {name: 'methodSync', x: "foo", y: 1});

      if (sendShouldFail) {
        // In Node 18, the socket is closed during the call to 'testDisconnect'.
        // In prior versions of Node, the socket was still disconnecting.
        // This test is sensitive to timing and only passes in the latter, unless we
        // stub the method below to produce similar behavior in the former.
        sandbox.stub(Client.prototype as any, '_sendToWebsocket')
          .onFirstCall()
          .callsFake(() => {
            failedSendCount += 1;
            throw new Error('WebSocket is not open');
          })
          .callThrough();
      }

      // Make more calls, with a disconnect before they return. The server should queue up responses.
      const resp2Promise = cliComm._makeRequest(null, null, "testDisconnect", "foo", 2);
      const resp3Promise = cliComm._makeRequest(null, null, "methodAsync", "foo", 3);
      assert.equal(await isLongerThan(resp2Promise, 250), true);

      // Once we reconnect, the response should arrive.
      await forwarder.connect();
      assert.deepEqual(await resp2Promise, {name: 'testDisconnect', x: "foo", y: 2});
      assert.deepEqual(await resp3Promise, {name: 'methodAsync', x: "foo", y: 3});

      // Check that we saw the situation we were hoping to test.
      assert.equal(failedSendCount, sendShouldFail ? 1 : 0, 'Expected to see a failed send');
    }

    it("should receive all server messages (small) in order when send doesn't fail", async function() {
      await testSendOrdering({noFailedSend: true, useSmallMsgs: true});
    });

    it("should receive all server messages (large) in order when send doesn't fail", async function() {
      await testSendOrdering({noFailedSend: true});
    });

    it("should order server messages correctly with failedSend before close", async function() {
      await testSendOrdering({closeHappensFirst: false});
    });

    it("should order server messages correctly with close before failedSend", async function() {
      await testSendOrdering({closeHappensFirst: true});
    });

    async function testSendOrdering(
      options: {noFailedSend?: boolean, closeHappensFirst?: boolean, useSmallMsgs?: boolean}
    ) {
      const eventsSeen: Array<'failedSend'|'close'> = [];

      // Server-side Client object.
      let ssClient!: Client;

      const {cliComm, forwarder} = await startManagedConnection(assortedMethods);

      // Intercept the call to _onClose to know when it occurs, since we are trying to hit a
      // situation where 'close' and 'failedSend' events happen in either order.
      const stubOnClose = sandbox.stub(Client.prototype as any, '_onClose')
        .callsFake(async function(this: Client) {
          if (!options.closeHappensFirst) { await delay(10); }
          eventsSeen.push('close');
          return (stubOnClose as any).wrappedMethod.apply(this, arguments);
        });

      // Intercept calls to client.sendMessage(), to know when it fails, and possibly to delay the
      // failures to hit a particular order in which 'close' and 'failedSend' events are seen by
      // Client.ts. This is the only reliable way I found to reproduce this order of events.
      const stubSendToWebsocket = sandbox.stub(Client.prototype as any, '_sendToWebsocket')
        .callsFake(async function(this: Client) {
          try {
            return await (stubSendToWebsocket as any).wrappedMethod.apply(this, arguments);
          } catch (err) {
            if (options.closeHappensFirst) { await delay(100); }
            eventsSeen.push('failedSend');
            throw err;
          }
        });

      // Watch the events received all the way on the client side.
      const eventSpy = sinon.spy();
      const clientConnectSpy = sinon.spy();
      cliComm.on('docUserAction', eventSpy);
      cliComm.on('clientConnect', clientConnectSpy);

      // We need to simulate an important property of the browser client: when needReload is set
      // in the clientConnect message, we are expected to reload the app. In the test, we replace
      // the GristWSConnection.
      cliComm.on('clientConnect', async (msg: CommClientConnect) => {
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
      const makeMessage = (n: number) => ({type: 'docUserAction', n, data});

      let n = 0;
      const sendPromises: Array<Promise<void>> = [];
      const sendNextMessage= () => sendPromises.push(ssClient.sendMessage(makeMessage(n++) as any));

      await testUtils.captureLog('warn', async () => {
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

        void(forwarder.disconnectServerSide());

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
          assert.deepEqual(eventsSeen, ['close']);
        } else {
          // Make sure to have waited long enough for the 'close' event we may have delayed
          await delay(20);

          // Large messages now cause a send to fail, after filling up buffer, and close the socket.
          assert.deepEqual(eventsSeen, ['close', 'close']);
        }
      } else if (options.closeHappensFirst) {
        assert.equal(eventsSeen[0], 'close');
        assert.include(eventsSeen, 'failedSend');
      } else {
        assert.equal(eventsSeen[0], 'failedSend');
        assert.include(eventsSeen, 'close');
      }

      // After a successful reconnect, subsequent calls should work normally.
      assert.deepEqual(await cliComm._makeRequest(null, null, "methodSync", 1, 2),
        {name: 'methodSync', x: 1, y: 2});

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
  });

  describe("Allowed Origin", function() {
    beforeEach(async function () {
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

    it('origin should match base domain of host', async () => {
      await checkOrigin({origin: "https://www.toto.com", host: "worker.example.com"}, false);
      await checkOrigin({origin: "https://badexample.com", host: "worker.example.com"}, false);
      await checkOrigin({origin: "https://bad.com/example.com", host: "worker.example.com"}, false);
      await checkOrigin({origin: "https://front.example.com", host: "worker.example.com"}, true);
      await checkOrigin({origin: "https://front.example.com:3000", host: "worker.example.com"}, true);
      await checkOrigin({origin: "https://example.com", host: "example.com"}, true);
    });

    it('with custom domains, origin should match the full hostname', async () => {
      fakeHosts.isCustomHost = true;

      // For a request to a custom domain, the full hostname must match.
      await checkOrigin({origin: "https://front.example.com", host: "worker.example.com"}, false);
      await checkOrigin({origin: "https://front.example.com", host: "front.example.com"}, true);
      await checkOrigin({origin: "https://front.example.com:3000", host: "front.example.com"}, true);
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
  let clientId: string = 'clientid-abc';
  let counter: number = 0;
  return {
    makeWebSocket(url: string): any { return new GristClientSocket(url); },
    async getTimezone()         { return 'UTC'; },
    getPageUrl()                { return "http://localhost"; },
    async getDocWorkerUrl()     { return docWorkerUrl; },
    getClientId(did: any)       { return clientId; },
    getUserSelector()           { return ''; },
    updateClientId(did: string, cid: string) { clientId = cid; },
    advanceCounter(): string    { return String(counter++); },
    log()                       { (log as any).debug(...arguments); },
    warn()                      { (log as any).warn(...arguments); },
  };
}
