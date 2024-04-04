import {GristWSConnection} from 'app/client/components/GristWSConnection';
import {TableFetchResult} from 'app/common/ActiveDocAPI';
import {UserAPIImpl} from 'app/common/UserAPI';
import {delay} from 'app/common/delay';
import {cookieName} from 'app/server/lib/gristSessions';
import * as log from 'app/server/lib/log';
import {getGristConfig} from 'test/gen-server/testUtils';
import {prepareDatabase} from 'test/server/lib/helpers/PrepareDatabase';
import {TestServer} from 'test/server/lib/helpers/TestServer';
import {waitForIt} from 'test/server/wait';
import {createTestDir, EnvironmentSnapshot, setTmpLogLevel} from 'test/server/testUtils';
import {assert} from 'chai';
import * as cookie from 'cookie';
import fetch from 'node-fetch';
import {GristClientSocket} from 'app/client/components/GristClientSocket';

describe('ManyFetches', function() {
  this.timeout(30000);

  setTmpLogLevel('warn');   // Set to 'info' to see what heap size actually is.
  let oldEnv: EnvironmentSnapshot;

  const userName = 'chimpy';
  const email = 'chimpy@getgrist.com';
  const org = 'docs';

  let home: TestServer;
  let docs: TestServer;
  let userApi: UserAPIImpl;

  beforeEach(async function() {
    oldEnv = new EnvironmentSnapshot();   // Needed for prepareDatabase, which changes process.env
    log.info("Starting servers");
    const testDir = await createTestDir("ManyFetches");
    await prepareDatabase(testDir);
    home = await TestServer.startServer('home', testDir, "home");
    docs = await TestServer.startServer('docs', testDir, "docs", {
      // The test verifies memory usage by checking heap sizes. The line below limits doc-worker
      // process so that it crashes when memory management is wrong. With fetch sizes
      // in this test, doc-worker's heap size goes from ~90M to ~330M without memory management;
      // this limit is in the middle as another way to verify that memory management helps.
      // Without this limit, there is no pressure on node to garbage-collect, so it may use more
      // memory than we expect, making the test less reliable.
      NODE_OPTIONS: '--max-old-space-size=210',
    }, home.serverUrl);
    userApi = home.makeUserApi(org, userName);
  });

  afterEach(async function() {
    // stop all servers
    await home.stop();
    await docs.stop();
    oldEnv.restore();
  });

  // Assert and log; helpful for working on the test (when setTmpLogLevel is 'info').
  function assertIsBelow(value: number, expected: number) {
    log.info("HeapMB", value, `(expected < ${expected})`);
    assert.isBelow(value, expected);
  }

  it('should limit the memory used to respond to many simultaneuous fetches', async function() {
    // Here we create a large document, and fetch it in parallel 200 times, without reading
    // responses. This test relies on the fact that the server caches the fetched data, so only
    // the serialized responses to clients are responsible for large memory use. This is the
    // memory use limited in Client.ts by jsonMemoryPool.

    // Reduce the limit controlling memory for JSON responses from the default of 500MB to 50MB.
    await docs.testingHooks.commSetClientJsonMemoryLimits({totalSize: 50 * 1024 * 1024});

    // Create a large document where fetches would have a noticeable memory footprint.
    // 40k rows should produce ~2MB fetch response.
    const {docId} = await createLargeDoc({rows: 40_000});

    // When we get results, here's a checker that it looks reasonable.
    function checkResults(results: TableFetchResult[]) {
      assert.lengthOf(results, 100);
      for (const res of results) {
        assert.lengthOf(res.tableData[2], 40_000);
        assert.lengthOf(res.tableData[3].Num, 40_000);
        assert.lengthOf(res.tableData[3].Text, 40_000);
      }
    }

    // Prepare to make N requests. For N=100, doc-worker should need ~200M of additional memory
    // without memory management.
    const N = 100;

    // Helper to get doc-worker's heap size.
    // If the server dies, testingHooks calls may hang. This wrapper prevents that.
    const serverErrorPromise = docs.getExitPromise().then(() => { throw new Error("server exited"); });
    const getMemoryUsage = () => Promise.race([docs.testingHooks.getMemoryUsage(), serverErrorPromise]);
    const getHeapMB = async () => Math.round((await getMemoryUsage() as NodeJS.MemoryUsage).heapUsed /1024/1024);

    assertIsBelow(await getHeapMB(), 120);

    // Create all the connections, but don't make the fetches just yet.
    const createConnectionFunc = await prepareGristWSConnection(docId);
    const connectionsA = Array.from(Array(N), createConnectionFunc);
    const fetchersA = await Promise.all(connectionsA.map(c => connect(c, docId)));

    const connectionsB = Array.from(Array(N), createConnectionFunc);
    const fetchersB = await Promise.all(connectionsB.map(c => connect(c, docId)));

    try {
      assertIsBelow(await getHeapMB(), 120);

      // Start fetches without reading responses. This is a step that should push memory limits.
      fetchersA.map(f => f.startPausedFetch());

      // Give it a few seconds, enough for server to use what memory it can.
      await delay(2000);
      assertIsBelow(await getHeapMB(), 200);

      // Make N more requests. See that memory hasn't spiked.
      fetchersB.map(f => f.startPausedFetch());
      await delay(2000);
      assertIsBelow(await getHeapMB(), 200);

      // Complete the first batch of requests. This allows for the fetches to complete, and for
      // memory to get released. Also check that results look reasonable.
      checkResults(await Promise.all(fetchersA.map(f => f.completeFetch())));

      assertIsBelow(await getHeapMB(), 200);

      // Complete the outstanding requests. Memory shouldn't spike.
      checkResults(await Promise.all(fetchersB.map(f => f.completeFetch())));

      assertIsBelow(await getHeapMB(), 200);

    } finally {
      fetchersA.map(f => f.end());
      fetchersB.map(f => f.end());
    }
  });

  it('should cope gracefully when client messages fail', async function() {
    // It used to be that sending data to the client could produce uncaught errors (in particular,
    // for exceeding V8 JSON limits). This test case fakes errors to make sure they get handled.

    // Create a document, initially empty. We'll add lots of rows later.
    const {docId} = await createLargeDoc({rows: 0});

    // If the server dies, testingHooks calls may hang. This wrapper prevents that.
    const serverErrorPromise = docs.getExitPromise().then(() => { throw new Error("server exited"); });

    // Make a connection.
    const createConnectionFunc = await prepareGristWSConnection(docId);
    const connectionA = createConnectionFunc();
    const fetcherA = await connect(connectionA, docId);

    // We'll expect 20k rows, taking up about 1MB. Set a lower limit for a fake exception.
    const prev = await docs.testingHooks.commSetClientJsonMemoryLimits({
      jsonResponseReservation: 100 * 1024,
      maxReservationSize: 200 * 1024,
    });

    try {
      // Adding lots of rows will produce an action that gets sent to the connected client.
      // We've arranged for this send to fail. Promise.race helps notice if the server exits.
      assert.equal(connectionA.established, true);
      await Promise.race([serverErrorPromise, addRows(docId, 20_000, 20_000)]);

      // Check that the send in fact failed, and the connection did get interrupted.
      await waitForIt(() =>
        assert.equal(connectionA.established, false, "Failed message should interrupt connection"),
        1000, 100);

      // Restore limits, so that fetch works below.
      await docs.testingHooks.commSetClientJsonMemoryLimits(prev);

      // Fetch data to make sure that the "addRows" call itself succeeded.
      const connectionB = createConnectionFunc();
      const fetcherB = await connect(connectionB, docId);
      try {
        fetcherB.startPausedFetch();
        const data = await Promise.race([serverErrorPromise, fetcherB.completeFetch()]);
        assert.lengthOf(data.tableData[2], 20_000);
        assert.lengthOf(data.tableData[3].Num, 20_000);
        assert.lengthOf(data.tableData[3].Text, 20_000);
      } finally {
        fetcherB.end();
      }

    } finally {
      fetcherA.end();
    }
  });

  // Creates a document with the given number of rows, and about 50 bytes per row.
  async function createLargeDoc({rows}: {rows: number}): Promise<{docId: string}> {
    log.info("Preparing a doc of %s rows", rows);
    const ws = (await userApi.getOrgWorkspaces('current'))[0].id;
    const docId = await userApi.newDoc({name: 'testdoc'}, ws);
    await userApi.applyUserActions(docId, [['AddTable', 'TestTable', [
      {id: 'Num', type: 'Numeric'},
      {id: 'Text', type: 'Text'}
    ]]]);
    await addRows(docId, rows);
    return {docId};
  }

  async function addRows(docId: string, rows: number, chunk = 10_000): Promise<void> {
    for (let i = 0; i < rows; i += chunk) {
      const currentNumRows = Math.min(chunk, rows - i);
      await userApi.getDocAPI(docId).addRows('TestTable', {
        // Roughly 8 bytes per row
        Num: Array.from(Array(currentNumRows), (_, n) => (i + n) * 100),
        // Roughly 40 bytes per row
        Text: Array.from(Array(currentNumRows), (_, n) => `Hello, world, again for the ${i + n}th time.`),
      });
    }
  }

  // Get all the info for how to create a GristWSConnection, and returns a connection-creating
  // function.
  async function prepareGristWSConnection(docId: string): Promise<() => GristWSConnection> {
    // Use cookies for access to stay as close as possible to regular operation.
    const resp = await fetch(`${home.serverUrl}/test/session`);
    const sid = cookie.parse(resp.headers.get('set-cookie'))[cookieName];
    if (!sid) { throw new Error('no session available'); }
    await home.testingHooks.setLoginSessionProfile(sid, {name: userName, email}, org);

    // Load the document html.
    const pageUrl = `${home.serverUrl}/o/docs/doc/${docId}`;
    const headers = {Cookie: `${cookieName}=${sid}`};
    const doc = await fetch(pageUrl, {headers});
    const pageBody = await doc.text();

    // Pull out the configuration object embedded in the html.
    const gristConfig = getGristConfig(pageBody);
    const {assignmentId, getWorker, homeUrl} = gristConfig;
    if (!homeUrl) { throw new Error('no homeUrl'); }
    if (!assignmentId) { throw new Error('no assignmentId'); }
    const docWorkerUrl = getWorker && getWorker[assignmentId];
    if (!docWorkerUrl) { throw new Error('no docWorkerUrl'); }

    // Place the config object in window.gristConfig as if we were a
    // real browser client.  GristWSConnection expects to find it there.
    globalThis.window = globalThis.window || {};
    (globalThis.window as any).gristConfig = gristConfig;

    // We return a function that constructs a GristWSConnection.
    return function createConnectionFunc() {
      let clientId: string = '0';
      return GristWSConnection.create(null, {
        makeWebSocket(url: string)  { return new GristClientSocket(url, { headers }); },
        getTimezone()               { return Promise.resolve('UTC'); },
        getPageUrl()                { return pageUrl; },
        getDocWorkerUrl()           { return Promise.resolve(docWorkerUrl); },
        getClientId(did)            { return clientId; },
        getUserSelector()           { return ''; },
        updateClientId(did: string, cid: string) { clientId = cid; },
        advanceCounter(): string    { return '0'; },
        log(msg, ...args)           {},
        warn(msg, ...args)          {},
      });
    };
  }

  // Actually connect GristWSConnection, open the doc, and return a few methods for next steps.
  async function connect(connection: GristWSConnection, docId: string) {
    async function getMessage<T>(eventType: string, filter: (msg: T) => boolean): Promise<T> {
      return new Promise<T>(resolve => {
        function callback(msg: T) {
          if (filter(msg)) { connection.off(eventType, callback); resolve(msg); }
        }
        connection.on(eventType, callback);
      });
    }

    // Launch the websocket
    const connectionPromise = getMessage('connectState', (isConnected: boolean) => isConnected);
    connection.initialize(null);
    await connectionPromise;  // Wait for connection to succeed.

    const openPromise = getMessage('serverMessage', ({reqId}: {reqId?: number}) => (reqId === 0));
    connection.send(JSON.stringify({reqId: 0, method: 'openDoc', args: [docId]}));
    await openPromise;

    let fetchPromise: Promise<TableFetchResult>;
    return {
      startPausedFetch: () => {
        fetchPromise = getMessage<any>('serverMessage', ({reqId}: {reqId?: number}) => (reqId === 1));
        (connection as any)._ws.pause();
        connection.send(JSON.stringify({reqId: 1, method: 'fetchTable', args: [0, 'TestTable']}));
      },

      completeFetch: async (): Promise<TableFetchResult> => {
        (connection as any)._ws.resume();
        return (await fetchPromise as any).data;
      },

      end: () => {
        connection.dispose();
      },
    };
  }
});
