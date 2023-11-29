import {parseUrlId} from 'app/common/gristUrls';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {DocManager} from 'app/server/lib/DocManager';
import {FlexServer} from 'app/server/lib/FlexServer';
import axios from 'axios';
import {assert} from 'chai';
import {toPairs} from 'lodash';
import {createInitialDb, removeConnection, setUpDB} from 'test/gen-server/seed';
import {configForUser, getGristConfig} from 'test/gen-server/testUtils';
import {createDocTools} from 'test/server/docTools';
import {openClient} from 'test/server/gristClient';
import * as testUtils from 'test/server/testUtils';
import uuidv4 from 'uuid/v4';

let serverUrl: string;
let server: FlexServer;
let dbManager: HomeDBManager;

async function activateServer(home: FlexServer, docManager: DocManager) {
  await home.loadConfig();
  await home.initHomeDBManager();
  home.addHosts();
  home.addDocWorkerMap();
  home.addAccessMiddleware();
  dbManager = home.getHomeDBManager();
  await home.loadConfig();
  home.addSessions();
  home.addHealthCheck();
  docManager.testSetHomeDbManager(dbManager);
  home.testSetDocManager(docManager);
  await home.start();
  home.addAccessMiddleware();
  home.addApiMiddleware();
  home.addJsonSupport();
  await home.addLandingPages();
  home.addHomeApi();
  await home.addTelemetry();
  await home.addDoc();
  home.addApiErrorHandlers();
  home.finalizeEndpoints();
  await home.finalizePlugins(null);
  home.ready();
  serverUrl = home.getOwnUrl();
}

const chimpy = configForUser('Chimpy');
const charon = configForUser('Charon');

const fixtures: {[docName: string]: string|null} = {
  Bananas: 'Hello.grist',
  Pluto: 'Hello.grist',
};

describe('Authorizer', function() {

  testUtils.setTmpLogLevel('fatal');

  const docTools = createDocTools({persistAcrossCases: true, useFixturePlugins: false,
                                   server: () => (server = new FlexServer(0, 'test docWorker'))});
  const docs: {[name: string]: {id: string}} = {};

  // Loads the fixtures documents so that they are available to the doc worker under the correct
  // names.
  async function loadFixtureDocs() {
    for (const [docName, fixtureDoc] of toPairs(fixtures)) {
      const docId = String(await dbManager.testGetId(docName));
      if (fixtureDoc) {
        await docTools.loadFixtureDocAs(fixtureDoc, docId);
      } else {
        await docTools.createDoc(docId);
      }
      docs[docName] = {id: docId};
    }
  }

  let oldEnv: testUtils.EnvironmentSnapshot;
  before(async function() {
    this.timeout(5000);
    setUpDB(this);
    oldEnv = new testUtils.EnvironmentSnapshot();
    // GRIST_PROXY_AUTH_HEADER now only affects requests directly when GRIST_IGNORE_SESSION is
    // also set.
    process.env.GRIST_PROXY_AUTH_HEADER = 'X-email';
    process.env.GRIST_IGNORE_SESSION = 'true';
    await createInitialDb();
    await activateServer(server, docTools.getDocManager());
    await loadFixtureDocs();
  });

  after(async function() {
    const messages = await testUtils.captureLog('warn', async () => {
      await server.close();
      await removeConnection();
    });
    assert.lengthOf(messages, 0);
    oldEnv.restore();
  });

  // TODO XXX Is it safe to remove this support now?
  // (It used to be implemented in getDocAccessInfo() in Authorizer.ts).
  it.skip("viewer gets redirect by title", async function() {
    const resp = await axios.get(`${serverUrl}/o/pr/doc/Bananas`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(getGristConfig(resp.data).assignmentId, 'sampledocid_6');
    assert.match(resp.request.res.responseUrl, /\/doc\/sampledocid_6$/);
    const resp2 = await axios.get(`${serverUrl}/o/nasa/doc/Pluto`, chimpy);
    assert.equal(resp2.status, 200);
    assert.equal(getGristConfig(resp2.data).assignmentId, 'sampledocid_2');
    assert.match(resp2.request.res.responseUrl, /\/doc\/sampledocid_2$/);
  });

  it('viewer loads document without slug in the URL', async function () {
    const docId = docs.Bananas.id;
    const resp = await axios.get(`${serverUrl}/o/pr/${docId}`, chimpy);
    assert.equal(resp.status, 200);
  });

  it("stranger gets consistent refusal regardless of title", async function() {
    const resp = await axios.get(`${serverUrl}/o/pr/doc/Bananas`, charon);
    assert.equal(resp.status, 404);
    assert.notMatch(resp.data, /sampledocid_6/);
    const resp2 = await axios.get(`${serverUrl}/o/pr/doc/Bananas2`, charon);
    assert.equal(resp2.status, 404);
    assert.notMatch(resp.data, /sampledocid_6/);
    assert.deepEqual(withoutTimestamp(resp.data),
                     withoutTimestamp(resp2.data));
  });

  it("viewer can access title", async function() {
    const resp = await axios.get(`${serverUrl}/o/pr/doc/sampledocid_6`, chimpy);
    assert.equal(resp.status, 200);
    const config = getGristConfig(resp.data);
    assert.equal(config.getDoc![config.assignmentId!].name, 'Bananas');
  });

  it("stranger cannot access title", async function() {
    const resp = await axios.get(`${serverUrl}/o/pr/doc/sampledocid_6`, charon);
    assert.equal(resp.status, 403);
    assert.notMatch(resp.data, /Bananas/);
  });

  it("viewer cannot access document from wrong org", async function() {
    const resp = await axios.get(`${serverUrl}/o/nasa/doc/sampledocid_6`, chimpy);
    assert.equal(resp.status, 404);
  });

  it("websocket allows openDoc for viewer", async function() {
    const cli = await openClient(server, 'chimpy@getgrist.com', 'pr');
    cli.ignoreTrivialActions();
    assert.equal((await cli.readMessage()).type, 'clientConnect');
    const openDoc = await cli.send("openDoc", "sampledocid_6");
    assert.equal(openDoc.error, undefined);
    assert.match(JSON.stringify(openDoc.data), /Table1/);
    await cli.close();
  });

  it("websocket forbids openDoc for stranger", async function() {
    const cli = await openClient(server, 'charon@getgrist.com', 'pr');
    cli.ignoreTrivialActions();
    assert.equal((await cli.readMessage()).type, 'clientConnect');
    const openDoc = await cli.send("openDoc", "sampledocid_6");
    assert.match(openDoc.error!, /No view access/);
    assert.equal(openDoc.data, undefined);
    assert.match(openDoc.errorCode!, /AUTH_NO_VIEW/);
    await cli.close();
  });

  it("websocket forbids applyUserActions for viewer", async function() {
    const cli = await openClient(server, 'charon@getgrist.com', 'nasa');
    cli.ignoreTrivialActions();
    assert.equal((await cli.readMessage()).type, 'clientConnect');
    const openDoc = await cli.openDocOnConnect("sampledocid_2");
    assert.equal(openDoc.error, undefined);
    const nonce = uuidv4();
    const applyUserActions = await cli.send("applyUserActions",
                                            0,
                                            [["UpdateRecord", "Table1", 1, {A: nonce}], {}]);
    assert.lengthOf(cli.messages, 0);  // no user actions pushed to client
    assert.match(applyUserActions.error!, /No write access/);
    assert.match(applyUserActions.errorCode!, /AUTH_NO_EDIT/);
    const fetchTable = await cli.send("fetchTable", 0, "Table1");
    assert.equal(fetchTable.error, undefined);
    assert.notInclude(JSON.stringify(fetchTable.data), nonce);
    await cli.close();
  });

  it("websocket allows applyUserActions for editor", async function() {
    const cli = await openClient(server, 'chimpy@getgrist.com', 'nasa');
    cli.ignoreTrivialActions();
    assert.equal((await cli.readMessage()).type, 'clientConnect');
    const openDoc = await cli.openDocOnConnect("sampledocid_2");
    assert.equal(openDoc.error, undefined);
    const nonce = uuidv4();
    const applyUserActions = await cli.send("applyUserActions",
                                            0,
                                            [["UpdateRecord", "Table1", 1, {A: nonce}]]);
    // Skip messages with no actions (since docUsage may or may not appear by now)
    const messagesWithActions = cli.messages.filter(m => m.data.docActions);
    assert.lengthOf(messagesWithActions, 1);  // user actions pushed to client
    assert.equal(applyUserActions.error, undefined);
    const fetchTable = await cli.send("fetchTable", 0, "Table1");
    assert.equal(fetchTable.error, undefined);
    assert.include(JSON.stringify(fetchTable.data), nonce);
    await cli.close();
  });

  it("can keep different simultaneous clients of a doc straight", async function() {
    const editor = await openClient(server, 'chimpy@getgrist.com', 'nasa');
    assert.equal((await editor.readMessage()).type, 'clientConnect');
    const viewer = await openClient(server, 'charon@getgrist.com', 'nasa');
    assert.equal((await viewer.readMessage()).type, 'clientConnect');
    const stranger = await openClient(server, 'kiwi@getgrist.com', 'nasa');
    assert.equal((await stranger.readMessage()).type, 'clientConnect');

    editor.ignoreTrivialActions();
    viewer.ignoreTrivialActions();
    stranger.ignoreTrivialActions();
    assert.equal((await editor.send("openDoc", "sampledocid_2")).error, undefined);
    assert.equal((await viewer.send("openDoc", "sampledocid_2")).error, undefined);
    assert.match((await stranger.send("openDoc", "sampledocid_2")).error!, /No view access/);

    const action = [0, [["UpdateRecord", "Table1", 1, {A: "foo"}]]];
    assert.equal((await editor.send("applyUserActions", ...action)).error, undefined);
    assert.match((await viewer.send("applyUserActions", ...action)).error!, /No write access/);
    // Different message here because sending actions without a doc being open.
    assert.match((await stranger.send("applyUserActions", ...action)).error!, /Invalid/);
  });

  it("previewer has view access to docs", async function() {
    const cli = await openClient(server, 'thumbnail@getgrist.com', 'nasa');
    cli.ignoreTrivialActions();
    assert.equal((await cli.readMessage()).type, 'clientConnect');
    const openDoc = await cli.send("openDoc", "sampledocid_2");
    assert.equal(openDoc.error, undefined);
    const nonce = uuidv4();
    const applyUserActions = await cli.send("applyUserActions",
                                            0,
                                            [["UpdateRecord", "Table1", 1, {A: nonce}], {}]);
    assert.lengthOf(cli.messages, 0);  // no user actions pushed to client
    assert.match(applyUserActions.error!, /No write access/);
    assert.match(applyUserActions.errorCode!, /AUTH_NO_EDIT/);
    const fetchTable = await cli.send("fetchTable", 0, "Table1");
    assert.equal(fetchTable.error, undefined);
    assert.notInclude(JSON.stringify(fetchTable.data), nonce);
    await cli.close();
  });

  it("viewer can fork doc", async function() {
    const cli = await openClient(server, 'charon@getgrist.com', 'nasa');
    cli.ignoreTrivialActions();
    assert.equal((await cli.readMessage()).type, 'clientConnect');
    const openDoc = await cli.send("openDoc", "sampledocid_2");
    assert.equal(openDoc.error, undefined);
    const result = await cli.send("fork", 0);
    assert.equal(result.data.docId, result.data.urlId);
    const parts = parseUrlId(result.data.docId);
    assert.equal(parts.trunkId, "sampledocid_2");
    assert.isAbove(parts.forkId!.length, 4);
    assert.equal(parts.forkUserId, await dbManager.testGetId('Charon') as number);
  });

  it("anon can fork doc", async function() {
    // anon does not have access to doc initially
    const cli = await openClient(server, 'anon@getgrist.com', 'nasa');
    cli.ignoreTrivialActions();
    assert.equal((await cli.readMessage()).type, 'clientConnect');
    let openDoc = await cli.send("openDoc", "sampledocid_2");
    assert.match(openDoc.error!, /No view access/);

    // grant anon access to doc and retry
    await dbManager.updateDocPermissions({
      userId: await dbManager.testGetId('Chimpy') as number,
      urlId: 'sampledocid_2',
      org: 'nasa'
    }, {users: {"anon@getgrist.com": "viewers"}});
    dbManager.flushDocAuthCache();
    openDoc = await cli.send("openDoc", "sampledocid_2");
    assert.equal(openDoc.error, undefined);

    // make a fork
    const result = await cli.send("fork", 0);
    assert.equal(result.data.docId, result.data.urlId);
    const parts = parseUrlId(result.data.docId);
    assert.equal(parts.trunkId, "sampledocid_2");
    assert.isAbove(parts.forkId!.length, 4);
    assert.equal(parts.forkUserId, undefined);
  });

  it("can set user via GRIST_PROXY_AUTH_HEADER", async function() {
    // User can access a doc by setting header.
    const docUrl = `${serverUrl}/o/pr/api/docs/sampledocid_6`;
    const resp = await axios.get(docUrl, {
      headers: {'X-email': 'chimpy@getgrist.com'}
    });
    assert.equal(resp.data.name, 'Bananas');

    // Unknown user is denied.
    await assert.isRejected(axios.get(docUrl, {
      headers: {'X-email': 'notchimpy@getgrist.com'}
    }));

    // User can access a doc via websocket by setting header.
    let cli = await openClient(server, 'chimpy@getgrist.com', 'pr', 'X-email');
    cli.ignoreTrivialActions();
    assert.equal((await cli.readMessage()).type, 'clientConnect');
    let openDoc = await cli.send("openDoc", "sampledocid_6");
    assert.equal(openDoc.error, undefined);
    assert.match(JSON.stringify(openDoc.data), /Table1/);
    await cli.close();

    // Unknown user is denied.
    cli = await openClient(server, 'notchimpy@getgrist.com', 'pr', 'X-email');
    cli.ignoreTrivialActions();
    assert.equal((await cli.readMessage()).type, 'clientConnect');
    openDoc = await cli.send("openDoc", "sampledocid_6");
    assert.match(openDoc.error!, /No view access/);
    assert.equal(openDoc.data, undefined);
    assert.match(openDoc.errorCode!, /AUTH_NO_VIEW/);
    await cli.close();
  });
});

function withoutTimestamp(txt: string): string {
  return txt.replace(/"timestampMs":[ 0-9]+/, '"timestampMs": NNNN');
}
