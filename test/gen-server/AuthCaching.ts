import {delay} from 'app/common/delay';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {FlexServer} from 'app/server/lib/FlexServer';
import log from 'app/server/lib/log';
import {main as mergedServerMain} from 'app/server/mergedServerMain';
import axios from 'axios';
import {assert} from 'chai';
import * as fse from 'fs-extra';
import {tmpdir} from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import {TestSession} from 'test/gen-server/apiUtils';
import {createInitialDb, removeConnection, setUpDB} from 'test/gen-server/seed';
import {configForUser, getGristConfig} from 'test/gen-server/testUtils';
import {openClient} from 'test/server/gristClient';
import * as testUtils from 'test/server/testUtils';

async function createTestDir(ident: string): Promise<string> {
  // Create a testDir of the form grist_test_{USER}_{SERVER_NAME}, removing any previous one.
  const username = process.env.USER || "nobody";
  const testDir = path.join(tmpdir(), `grist_test_${username}_${ident}`);
  await fse.remove(testDir);
  return testDir;
}

const chimpy = configForUser('Chimpy');
const kiwi = configForUser('Kiwi');
const charon = configForUser('Charon');
const chimpyEmail = 'chimpy@getgrist.com';
const kiwiEmail = 'kiwi@getgrist.com';
const charonEmail = 'charon@getgrist.com';


describe('AuthCaching', function() {
  this.timeout(10000);
  testUtils.setTmpLogLevel('error');

  let homeServer: FlexServer, docsServer: FlexServer;
  let session: TestSession;
  let homeUrl: string;
  let helloDocId: string;

  const sandbox = sinon.createSandbox();

  before(async function() {
    const testDir = process.env.TESTDIR || await createTestDir('authcaching');
    const testDocDir = path.join(testDir, "data");
    await fse.mkdirs(testDocDir);
    log.warn(`Test logs and data are at: ${testDir}/`);
    setUpDB();
    await createInitialDb();
    process.env.GRIST_DATA_DIR = testDocDir;
    homeServer = await mergedServerMain(0, ['home'],
      {logToConsole: false, externalStorage: false});
    homeUrl = homeServer.getOwnUrl();
    process.env.APP_HOME_URL = homeUrl;
    docsServer = await mergedServerMain(0, ['docs'],
      {logToConsole: false, externalStorage: false});

    // Helpers for getting cookie-based logins.
    session = new TestSession(homeServer);

    // Copy a fixture doc to make it accessible with the given docId.
    helloDocId = (await homeServer.getHomeDBManager().testGetId('Jupiter')) as string;
    const srcPath = path.resolve(testUtils.fixturesRoot, 'docs', 'Hello.grist');
    await fse.copy(srcPath, path.resolve(docsServer.docsRoot, `${helloDocId}.grist`),
                   { dereference: true });

    // Add Kiwi to 'viewers' for this doc.
    const resp = await axios.patch(`${homeUrl}/api/docs/${helloDocId}/access`,
      {delta: {users: {[kiwiEmail]: 'viewers'}}},
      chimpy);
    assert.equal(resp.status, 200);
  });

  after(async function() {
    delete process.env.GRIST_DATA_DIR;
    delete process.env.APP_HOME_URL;
    sandbox.restore();
    await testUtils.captureLog('warn', async () => {
      await docsServer.close();
      await homeServer.close();
      await removeConnection();
    });
  });

  afterEach(async function() {
    sandbox.restore();
  });

  function getDocTracker(dbManager: HomeDBManager) {
    const forced = sandbox.spy(dbManager, "getDoc");
    const cached = sandbox.spy(dbManager, "getDocAuthCached");
    const impl = sandbox.spy(dbManager, "getDocImpl");
    function getCallCounts() {
      return {
        forced: forced.callCount,
        misses: impl.callCount - forced.callCount,
        hits: cached.callCount - (impl.callCount - forced.callCount),
      };
    }
    function reset() {
      forced.resetHistory();
      cached.resetHistory();
      impl.resetHistory();
    }
    function getAndReset() {
      const res = getCallCounts();
      reset();
      return res;
    }
    return {getCallCounts, reset, getAndReset};
  }

  function flushCache() {
    homeServer.getHomeDBManager().flushDocAuthCache();
    docsServer.getHomeDBManager().flushDocAuthCache();
  }

  function getDocCallTracker() {
    return {
      home: getDocTracker(homeServer.getHomeDBManager()),
      docs: getDocTracker(docsServer.getHomeDBManager()),
    };
  }

  it('should not cache direct call for doc metadata', async function() {
    flushCache();
    const getDocCalls = getDocCallTracker();

    const resp = await axios.get(`${homeUrl}/api/docs/${helloDocId}`, chimpy);
    assert.equal(resp.data.name, 'Jupiter');

    // This is a metadata-only call, so only home server is involved.
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 1, misses: 0, hits: 0});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 0});

    const resp2 = await axios.get(`${homeUrl}/api/docs/${helloDocId}`, chimpy);
    assert.deepEqual(resp2.data, resp.data);
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 1, misses: 0, hits: 0});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 0});
  });

  it('should cache DocApi + DocApiForwarder calls', async function() {
    flushCache();
    const getDocCalls = getDocCallTracker();
    const resp = await axios.get(`${homeUrl}/api/docs/${helloDocId}/tables/Table1/data`, chimpy);
    assert.deepInclude(resp.data, {E: ["HELLO", "", "", ""]});

    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 0, misses: 1, hits: 0});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 1, hits: 0});

    // Try an endpoint requiring editing permissions.
    const resp2 = await axios.post(`${homeUrl}/api/docs/${helloDocId}/tables/Table1/data`, {A: ['Foo']}, chimpy);
    assert.equal(resp2.status, 200);
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 0, misses: 0, hits: 1});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 1});

    const resp3 = await axios.get(`${homeUrl}/api/docs/${helloDocId}/tables/Table1/data`, chimpy);
    assert.deepInclude(resp3.data, {E: ["HELLO", "", "", "", "FOO"]});

    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 0, misses: 0, hits: 1});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 1});
  });

  it('should cache DocAPI + DocApiForwarder no-access calls', async function() {
    flushCache();
    const getDocCalls = getDocCallTracker();

    // Kiwi has view-only access. Check that it's checked, and is cached too.
    let resp = await axios.post(`${homeUrl}/api/docs/${helloDocId}/tables/Table1/data`, {A: ['Bar']}, kiwi);
    assert.equal(resp.status, 403);
    assert.match(resp.data.error, /No write access/);
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 0, misses: 1, hits: 0});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 1, hits: 0});

    // Second call is cached, but otherwise identical.
    resp = await axios.post(`${homeUrl}/api/docs/${helloDocId}/tables/Table1/data`, {A: ['Bar']}, kiwi);
    assert.equal(resp.status, 403);
    assert.match(resp.data.error, /No write access/);
    // The read/write distinction isn't checked by DocApiForwarder, so docsServer sees the request.
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 0, misses: 0, hits: 1});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 1});

    // View access works.
    resp = await axios.get(`${homeUrl}/api/docs/${helloDocId}/tables/Table1/data`, kiwi);
    assert.deepInclude(resp.data, {E: ["HELLO", "", "", "", "FOO"]});
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 0, misses: 0, hits: 1});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 1});

    // Charon has no access.
    resp = await axios.get(`${homeUrl}/api/docs/${helloDocId}/tables/Table1/data`, charon);
    assert.equal(resp.status, 403);
    assert.match(resp.data.error, /No view access/);
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 0, misses: 1, hits: 0});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 0});

    // ...or write access (but the check is cached).
    resp = await axios.post(`${homeUrl}/api/docs/${helloDocId}/tables/Table1/data`, {A: ['Bar']}, charon);
    assert.equal(resp.status, 403);
    assert.match(resp.data.error, /No view access/);
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 0, misses: 0, hits: 1});
    // docsServer never sees the request.
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 0});
  });

  it('should not cache app.html endpoint', async function() {
    flushCache();
    const getDocCalls = getDocCallTracker();
    const cookie = await session.getCookieLogin('nasa', {email: chimpyEmail, name: 'Chimpy'});

    const resp1 = await axios.get(`${homeUrl}/o/nasa/doc/${helloDocId}`, cookie);

    // gristConfig should include results of the getDoc call.
    const gristConfig = getGristConfig(resp1.data);
    assert.hasAnyKeys(gristConfig.getDoc, [helloDocId]);
    assert.deepInclude(gristConfig.getDoc![helloDocId], {name: 'Jupiter', id: helloDocId});

    // All authentication and getDoc() call are made by homeServer, docsServer not yet in play
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 1, misses: 0, hits: 1});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 0});

    // No caching on subsequent call because we force a fresh fetch for this endpoint.
    const resp2 = await axios.get(`${homeUrl}/o/nasa/doc/${helloDocId}`, cookie);
    assert.deepEqual(getGristConfig(resp2.data).getDoc, gristConfig.getDoc);
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 1, misses: 0, hits: 1});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 0});
  });

  it('should cache openDoc and websocket methods', async function() {
    flushCache();
    const getDocCalls = getDocCallTracker();

    const cli = await openClient(docsServer, chimpyEmail, 'nasa');
    assert.equal((await cli.readMessage()).type, 'clientConnect');
    const openDoc = await cli.send("openDoc", helloDocId);
    assert.equal(openDoc.error, undefined);
    assert.match(JSON.stringify(openDoc.data), /Table1/);

    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 1, hits: 0});

    // Read access
    const table = await cli.send("fetchTable", 0, "Table1");
    assert.includeMembers(table.data.tableData, ['TableData', 'Table1']);
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 1});

    // Write access
    const auaResult = await cli.send("applyUserActions", 0,
      [["UpdateRecord", "Table1", 1, {A: "auth-caching1"}]]);
    await delay(200); // give a little time for change broadcast.
    assert.isNumber(auaResult.data.actionNum);
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 2});

    await cli.close();
  });

  it('should cache openDoc and websocket methods with access failures', async function() {
    flushCache();
    const getDocCalls = getDocCallTracker();

    // Repeat with a view-only user (Kiwi)
    let cli = await openClient(docsServer, kiwiEmail, 'nasa');
    assert.equal((await cli.readMessage()).type, 'clientConnect');
    let openDoc = await cli.send("openDoc", helloDocId);
    assert.equal(openDoc.error, undefined);
    assert.match(JSON.stringify(openDoc.data), /Table1/);

    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 1, hits: 0});

    // Kiwi has read access
    const table = await cli.send("fetchTable", 0, "Table1");
    assert.includeMembers(table.data.tableData, ['TableData', 'Table1']);
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 1});

    // Kiwi has NO write access.
    const auaResult = await cli.send("applyUserActions", 0,
      [["UpdateRecord", "Table1", 1, {A: "auth-caching2"}]]);
    assert.deepEqual(auaResult.error, 'No write access');
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 1});

    // Charon has no access at all
    cli = await openClient(docsServer, charonEmail, 'nasa');
    assert.equal((await cli.readMessage()).type, 'clientConnect');
    openDoc = await cli.send("openDoc", helloDocId);
    assert.equal(openDoc.error, 'No view access');

    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 1, hits: 0});
    await cli.send("openDoc", helloDocId);
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 1});

    // Home server wasn't involved in this test case at all.
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 0, misses: 0, hits: 0});
  });

  it('should cache across different kinds of calls', async function() {
    // Fetch the document endpoint and follow with openDoc. Caching should apply.
    flushCache();
    const getDocCalls = getDocCallTracker();
    const cookie = await session.getCookieLogin('nasa', {email: chimpyEmail, name: 'Chimpy'});

    // app.html endpoint warms the cache for the home server.
    const resp1 = await axios.get(`${homeUrl}/o/nasa/doc/${helloDocId}`, cookie);
    const gristConfig = getGristConfig(resp1.data);
    assert.hasAnyKeys(gristConfig.getDoc, [helloDocId]);
    assert.deepInclude(gristConfig.getDoc![helloDocId], {name: 'Jupiter', id: helloDocId});

    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 1, misses: 0, hits: 1});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 0});

    // openDoc call warms the cache for the doc-worker.
    const cli = await openClient(docsServer, chimpyEmail, 'nasa');
    assert.equal((await cli.readMessage()).type, 'clientConnect');
    const openDoc = await cli.send("openDoc", helloDocId);
    assert.equal(openDoc.error, undefined);
    assert.match(JSON.stringify(openDoc.data), /Table1/);

    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 0, misses: 0, hits: 0});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 1, hits: 0});

    // the caching applies to API calls for the same doc/user/org combination.
    const resp = await axios.get(`${homeUrl}/o/nasa/api/docs/${helloDocId}/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 0, misses: 0, hits: 1});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 1});
  });

  it('should expire the cache after a timeout', async function() {
    this.timeout(10000);

    // Make an API call; change access; check that after a while, the change is noticed.
    flushCache();
    const getDocCalls = getDocCallTracker();

    // Connect up websockets for Kiwi and Charon.
    const kiwiCli = await openClient(docsServer, kiwiEmail, 'nasa');
    assert.equal((await kiwiCli.readMessage()).type, 'clientConnect');
    const charonCli = await openClient(docsServer, charonEmail, 'nasa');
    assert.equal((await charonCli.readMessage()).type, 'clientConnect');

    // Kiwi has access, Charon doesn't.
    let resp1 = await axios.get(`${homeUrl}/o/nasa/api/docs/${helloDocId}/tables/Table1/data`, kiwi);
    let resp2 = await axios.get(`${homeUrl}/o/nasa/api/docs/${helloDocId}/tables/Table1/data`, charon);
    assert.equal(resp1.status, 200);
    assert.equal(resp2.status, 403);

    // home server sees both calls, but only forwards one to the doc-worker.
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 0, misses: 2, hits: 0});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 1, hits: 0});

    assert.equal((await kiwiCli.send("openDoc", helloDocId)).error, undefined);
    assert.equal((await charonCli.send("openDoc", helloDocId)).error, 'No view access');
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 0, misses: 0, hits: 0});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 1, hits: 1});

    // Use Chimpy's access to change access for both.
    const resp = await axios.patch(`${homeUrl}/o/nasa/api/docs/${helloDocId}/access`,
      {delta: {users: {[kiwiEmail]: null, [charonEmail]: 'viewers'}}},
      chimpy);
    assert.equal(resp.status, 200);

    // Home's UserAPI methods don't call to getDoc() to check doc-level access, so access checks
    // for Chimpy's patch-access call do not affect our counts.
    assert.deepEqual(getDocCalls.home.getAndReset(), {forced: 0, misses: 0, hits: 0});
    assert.deepEqual(getDocCalls.docs.getAndReset(), {forced: 0, misses: 0, hits: 0});

    // The change isn't visible immediately.
    resp1 = await axios.get(`${homeUrl}/o/nasa/api/docs/${helloDocId}/tables/Table1/data`, kiwi);
    resp2 = await axios.get(`${homeUrl}/o/nasa/api/docs/${helloDocId}/tables/Table1/data`, charon);
    assert.equal(resp1.status, 200);
    assert.equal(resp2.status, 403);

    // But eventually it is. Should be within 5 seconds, we try up to 10.
    let passed = false;
    for (let i = 0; i < 50; i++) {
      await delay(200);
      try {
        // Check if access changes are visible yet.
        resp1 = await axios.get(`${homeUrl}/o/nasa/api/docs/${helloDocId}/tables/Table1/data`, kiwi);
        resp2 = await axios.get(`${homeUrl}/o/nasa/api/docs/${helloDocId}/tables/Table1/data`, charon);
        assert.equal(resp1.status, 403);
        assert.equal(resp2.status, 200);
        assert.equal((await kiwiCli.send("openDoc", helloDocId)).error, 'No view access');
        assert.equal((await charonCli.send("openDoc", helloDocId)).error, undefined);
        passed = true;
        break;
      } catch (err) {
        continue;
      }
    }
    assert.isTrue(passed);

    const homeCalls = getDocCalls.home.getAndReset();
    const docsCalls = getDocCalls.docs.getAndReset();
    // There are many cache hits, but one set of misses that discovers the access changes.
    assert.deepInclude(homeCalls, {forced: 0, misses: 2});
    assert.deepInclude(docsCalls, {forced: 0, misses: 2});
    assert.isAbove(homeCalls.hits, 10);
    assert.isAbove(docsCalls.hits, 10);
  });
});
