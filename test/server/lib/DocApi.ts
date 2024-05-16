/* eslint-disable @typescript-eslint/no-shadow */
import {ActionSummary} from 'app/common/ActionSummary';
import {BulkColValues, UserAction} from 'app/common/DocActions';
import {SHARE_KEY_PREFIX} from 'app/common/gristUrls';
import {arrayRepeat} from 'app/common/gutil';
import {WebhookSummary} from 'app/common/Triggers';
import {DocAPI, DocState, UserAPIImpl} from 'app/common/UserAPI';
import {testDailyApiLimitFeatures} from 'app/gen-server/entity/Product';
import {AddOrUpdateRecord, Record as ApiRecord, ColumnsPut, RecordWithStringId} from 'app/plugin/DocApiTypes';
import {CellValue, GristObjCode} from 'app/plugin/GristData';
import {
  applyQueryParameters,
  docApiUsagePeriods,
  docPeriodicApiUsageKey,
  getDocApiUsageKeysToIncr,
  WebhookSubscription
} from 'app/server/lib/DocApi';
import {delayAbort} from 'app/server/lib/serverUtils';
import axios, {AxiosRequestConfig, AxiosResponse} from 'axios';
import {delay} from 'bluebird';
import {assert} from 'chai';
import express from 'express';
import FormData from 'form-data';
import * as fse from 'fs-extra';
import * as _ from 'lodash';
import LRUCache from 'lru-cache';
import * as moment from 'moment';
import {AbortController} from 'node-abort-controller';
import fetch from 'node-fetch';
import {tmpdir} from 'os';
import * as path from 'path';
import {createClient, RedisClient} from 'redis';
import {configForUser} from 'test/gen-server/testUtils';
import {serveSomething, Serving} from 'test/server/customUtil';
import {prepareDatabase} from 'test/server/lib/helpers/PrepareDatabase';
import {prepareFilesystemDirectoryForTests} from 'test/server/lib/helpers/PrepareFilesystemDirectoryForTests';
import {signal} from 'test/server/lib/helpers/Signal';
import {TestServer, TestServerReverseProxy} from 'test/server/lib/helpers/TestServer';
import * as testUtils from 'test/server/testUtils';
import {waitForIt} from 'test/server/wait';
import defaultsDeep = require('lodash/defaultsDeep');
import pick = require('lodash/pick');
import { getDatabase } from 'test/testUtils';

// some doc ids
const docIds: { [name: string]: string } = {
  ApiDataRecordsTest: 'sampledocid_7',
  Timesheets: 'sampledocid_13',
  Bananas: 'sampledocid_6',
  Antartic: 'sampledocid_11'
};

// A testDir of the form grist_test_{USER}_{SERVER_NAME}
const username = process.env.USER || "nobody";
const tmpDir = path.join(tmpdir(), `grist_test_${username}_docapi`);

let dataDir: string;
let suitename: string;
let serverUrl: string;
let homeUrl: string;
let hasHomeApi: boolean;
let home: TestServer;
let docs: TestServer;
let userApi: UserAPIImpl;
let extraHeadersForConfig = {};

function makeConfig(username: string): AxiosRequestConfig {
  const originalConfig = configForUser(username);
  return {
    ...originalConfig,
    headers: {
      ...originalConfig.headers,
      ...extraHeadersForConfig
    }
  };
}

describe('DocApi', function () {
  this.timeout(30000);
  testUtils.setTmpLogLevel('error');
  let oldEnv: testUtils.EnvironmentSnapshot;

  before(async function () {
    oldEnv = new testUtils.EnvironmentSnapshot();

    await flushAllRedis();

    // Create the tmp dir removing any previous one
    await prepareFilesystemDirectoryForTests(tmpDir);


    // Let's create a sqlite db that we can share with servers that run in other processes, hence
    // not an in-memory db. Running seed.ts directly might not take in account the most recent value
    // for TYPEORM_DATABASE, because ormconfig.js may already have been loaded with a different
    // configuration (in-memory for instance). Spawning a process is one way to make sure that the
    // latest value prevail.
    await prepareDatabase(tmpDir);
  });

  after(() => {
    oldEnv.restore();
  });

  /**
   * Doc api tests are run against three different setup:
   *  - a merged server: a single server serving both as a home and doc worker
   *  - two separated servers: requests are sent to a home server which then forward them to a doc worker
   *  - a doc worker: request are sent directly to the doc worker (note that even though it is not
   *    used for testing we starts anyway a home server, needed for setting up the test cases)
   *
   *  Future tests must be added within the testDocApi() function.
   */

  describe("should work with a merged server", async () => {
    setup('merged', async () => {
      const additionalEnvConfiguration = {
        ALLOWED_WEBHOOK_DOMAINS: `example.com,localhost:${webhooksTestPort}`,
        GRIST_DATA_DIR: dataDir
      };
      home = docs = await TestServer.startServer('home,docs', tmpDir, suitename, additionalEnvConfiguration);
      homeUrl = serverUrl = home.serverUrl;
      hasHomeApi = true;
    });
    testDocApi();
  });

  describe('With GRIST_ANON_PLAYGROUND disabled', async () => {
    setup('anon-playground', async () => {
      const additionalEnvConfiguration = {
        ALLOWED_WEBHOOK_DOMAINS: `example.com,localhost:${webhooksTestPort}`,
        GRIST_DATA_DIR: dataDir,
        GRIST_ANON_PLAYGROUND: 'false'
      };
      home = docs = await TestServer.startServer('home,docs', tmpDir, suitename, additionalEnvConfiguration);
      homeUrl = serverUrl = home.serverUrl;
      hasHomeApi = true;
    });

    it('should not allow anonymous users to create new docs', async () => {
      const nobody = makeConfig('Anonymous');
      const resp = await axios.post(`${serverUrl}/api/docs`, null, nobody);
      assert.equal(resp.status, 403);
    });
  });

  // the way these tests are written, non-merged server requires redis.
  if (process.env.TEST_REDIS_URL) {
    describe("should work with a home server and a docworker", async () => {
      setup('separated', async () => {
        const additionalEnvConfiguration = {
          ALLOWED_WEBHOOK_DOMAINS: `example.com,localhost:${webhooksTestPort}`,
          GRIST_DATA_DIR: dataDir
        };

        home = await TestServer.startServer('home', tmpDir, suitename, additionalEnvConfiguration);
        docs = await TestServer.startServer('docs', tmpDir, suitename, additionalEnvConfiguration, home.serverUrl);
        homeUrl = serverUrl = home.serverUrl;
        hasHomeApi = true;
      });
      testDocApi();
    });

    describe('behind a reverse-proxy', function () {
      async function setupServersWithProxy(suitename: string, overrideEnvConf?: NodeJS.ProcessEnv) {
        const proxy = new TestServerReverseProxy();
        const additionalEnvConfiguration = {
          ALLOWED_WEBHOOK_DOMAINS: `example.com,localhost:${webhooksTestPort}`,
          GRIST_DATA_DIR: dataDir,
          APP_HOME_URL: await proxy.getServerUrl(),
          GRIST_ORG_IN_PATH: 'true',
          GRIST_SINGLE_PORT: '0',
          ...overrideEnvConf
        };
        const home = await TestServer.startServer('home', tmpDir, suitename, additionalEnvConfiguration);
        const docs = await TestServer.startServer(
          'docs', tmpDir, suitename, additionalEnvConfiguration, home.serverUrl
        );
        proxy.requireFromOutsideHeader();

        await proxy.start(home, docs);

        homeUrl = serverUrl = await proxy.getServerUrl();
        hasHomeApi = true;
        extraHeadersForConfig = {
          Origin: serverUrl,
          ...TestServerReverseProxy.FROM_OUTSIDE_HEADER,
        };

        return {proxy, home, docs};
      }

      async function tearDown(proxy: TestServerReverseProxy, servers: TestServer[]) {
        proxy.stop();
        for (const server of servers) {
          await server.stop();
        }
        await flushAllRedis();
      }

      let proxy: TestServerReverseProxy;

      describe('should run usual DocApi test', function () {
        setup('behind-proxy-testdocs', async () => {
          ({proxy, home, docs} = await setupServersWithProxy(suitename));
        });

        after(() => tearDown(proxy, [home, docs]));

        testDocApi();
      });

      async function testCompareDocs(proxy: TestServerReverseProxy, home: TestServer) {
        const chimpy = makeConfig('chimpy');
        const userApiServerUrl = await proxy.getServerUrl();
        const chimpyApi = home.makeUserApi(
          ORG_NAME, 'chimpy', { serverUrl: userApiServerUrl, headers: chimpy.headers as Record<string, string> }
        );
        const ws1 = (await chimpyApi.getOrgWorkspaces('current'))[0].id;
        const docId1 = await chimpyApi.newDoc({name: 'testdoc1'}, ws1);
        const docId2 = await chimpyApi.newDoc({name: 'testdoc2'}, ws1);
        const doc1 = chimpyApi.getDocAPI(docId1);

        return doc1.compareDoc(docId2);
      }

      describe('with APP_HOME_INTERNAL_URL', function () {
        setup('behind-proxy-with-apphomeinternalurl', async () => {
          // APP_HOME_INTERNAL_URL will be set by TestServer.
          ({proxy, home, docs} = await setupServersWithProxy(suitename));
        });
        after(() => tearDown(proxy, [home, docs]));

        it('should succeed to compare docs', async function () {
          const res = await testCompareDocs(proxy, home);
          assert.exists(res);
        });
      });

      describe('without APP_HOME_INTERNAL_URL', function () {
        setup('behind-proxy-without-apphomeinternalurl', async () => {
          ({proxy, home, docs} = await setupServersWithProxy(suitename, {APP_HOME_INTERNAL_URL: ''}));
        });
        after(() => tearDown(proxy, [home, docs]));

        it('should succeed to compare docs', async function () {
          const promise = testCompareDocs(proxy, home);
          await assert.isRejected(promise, /TestServerReverseProxy: called public URL/);
        });
      });
    });

    describe("should work directly with a docworker", async () => {
      setup('docs', async () => {
        const additionalEnvConfiguration = {
          ALLOWED_WEBHOOK_DOMAINS: `example.com,localhost:${webhooksTestPort}`,
          GRIST_DATA_DIR: dataDir
        };
        home = await TestServer.startServer('home', tmpDir, suitename, additionalEnvConfiguration);
        docs = await TestServer.startServer('docs', tmpDir, suitename, additionalEnvConfiguration, home.serverUrl);
        homeUrl = home.serverUrl;
        serverUrl = docs.serverUrl;
        hasHomeApi = false;
      });
      testDocApi();
    });
  }

  describe("QueryParameters", async () => {

    function makeExample() {
      return {
        id: [1, 2, 3, 7, 8, 9],
        color: ['red', 'yellow', 'white', 'blue', 'black', 'purple'],
        spin: ['up', 'up', 'down', 'down', 'up', 'up'],
      };
    }

    it("supports ascending sort", async function () {
      assert.deepEqual(applyQueryParameters(makeExample(), {sort: ['color']}, null), {
        id: [8, 7, 9, 1, 3, 2],
        color: ['black', 'blue', 'purple', 'red', 'white', 'yellow'],
        spin: ['up', 'down', 'up', 'up', 'down', 'up']
      });
    });

    it("supports descending sort", async function () {
      assert.deepEqual(applyQueryParameters(makeExample(), {sort: ['-id']}, null), {
        id: [9, 8, 7, 3, 2, 1],
        color: ['purple', 'black', 'blue', 'white', 'yellow', 'red'],
        spin: ['up', 'up', 'down', 'down', 'up', 'up'],
      });
    });

    it("supports multi-key sort", async function () {
      assert.deepEqual(applyQueryParameters(makeExample(), {sort: ['-spin', 'color']}, null), {
        id: [8, 9, 1, 2, 7, 3],
        color: ['black', 'purple', 'red', 'yellow', 'blue', 'white'],
        spin: ['up', 'up', 'up', 'up', 'down', 'down'],
      });
    });

    it("does not freak out sorting mixed data", async function () {
      const example = {
        id: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        mixed: ['red', 'green', 'white', 2.5, 1, null, ['zing', 3] as any, 5, 'blue']
      };
      assert.deepEqual(applyQueryParameters(example, {sort: ['mixed']}, null), {
        mixed: [1, 2.5, 5, null, ['zing', 3] as any, 'blue', 'green', 'red', 'white'],
        id: [5, 4, 8, 6, 7, 9, 2, 1, 3],
      });
    });

    it("supports limit", async function () {
      assert.deepEqual(applyQueryParameters(makeExample(), {limit: 1}),
        {id: [1], color: ['red'], spin: ['up']});
    });

    it("supports sort and limit", async function () {
      assert.deepEqual(applyQueryParameters(makeExample(), {sort: ['-color'], limit: 2}, null),
        {id: [2, 3], color: ['yellow', 'white'], spin: ['up', 'down']});
    });
  });
});

// Contains the tests. This is where you want to add more test.
function testDocApi() {
  let chimpy: AxiosRequestConfig, kiwi: AxiosRequestConfig,
    charon: AxiosRequestConfig, nobody: AxiosRequestConfig, support: AxiosRequestConfig;

  before(function () {
    chimpy = makeConfig('Chimpy');
    kiwi = makeConfig('Kiwi');
    charon = makeConfig('Charon');
    nobody = makeConfig('Anonymous');
    support = makeConfig('support');
  });

  async function generateDocAndUrl(docName: string = "Dummy") {
    const wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
    const docId = await userApi.newDoc({name: docName}, wid);
    const docUrl = `${serverUrl}/api/docs/${docId}`;
    const tableUrl = `${serverUrl}/api/docs/${docId}/tables/Table1`;
    return { docUrl, tableUrl, docId };
  }

  it("creator should be owner of a created ws", async () => {
    const kiwiEmail = 'kiwi@getgrist.com';
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    // Make sure kiwi isn't allowed here.
    await userApi.updateOrgPermissions(ORG_NAME, {users: {[kiwiEmail]: null}});
    const kiwiApi = home.makeUserApi(ORG_NAME, 'kiwi');
    await assert.isRejected(kiwiApi.getWorkspaceAccess(ws1), /Forbidden/);
    // Add kiwi as an editor for the org.
    await assert.isRejected(kiwiApi.getOrgAccess(ORG_NAME), /Forbidden/);
    await userApi.updateOrgPermissions(ORG_NAME, {users: {[kiwiEmail]: 'editors'}});
    // Make a workspace as Kiwi, he should be owner of it.
    const kiwiWs = await kiwiApi.newWorkspace({name: 'kiwiWs'}, ORG_NAME);
    const kiwiWsAccess = await kiwiApi.getWorkspaceAccess(kiwiWs);
    assert.equal(kiwiWsAccess.users.find(u => u.email === kiwiEmail)?.access, 'owners');
    // Delete workspace.
    await kiwiApi.deleteWorkspace(kiwiWs);
    // Remove kiwi from the org.
    await userApi.updateOrgPermissions(ORG_NAME, {users: {[kiwiEmail]: null}});
  });

  it("creator should be owner of a created doc", async () => {
    const kiwiEmail = 'kiwi@getgrist.com';
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    await userApi.updateOrgPermissions(ORG_NAME, {users: {[kiwiEmail]: null}});
    // Make sure kiwi isn't allowed here.
    const kiwiApi = home.makeUserApi(ORG_NAME, 'kiwi');
    await assert.isRejected(kiwiApi.getWorkspaceAccess(ws1), /Forbidden/);
    // Add kiwi as an editor of this workspace.
    await userApi.updateWorkspacePermissions(ws1, {users: {[kiwiEmail]: 'editors'}});
    await assert.isFulfilled(kiwiApi.getWorkspaceAccess(ws1));
    // Create a document as kiwi.
    const kiwiDoc = await kiwiApi.newDoc({name: 'kiwiDoc'}, ws1);
    // Make sure kiwi is an owner of the document.
    const kiwiDocAccess = await kiwiApi.getDocAccess(kiwiDoc);
    assert.equal(kiwiDocAccess.users.find(u => u.email === kiwiEmail)?.access, 'owners');
    await kiwiApi.deleteDoc(kiwiDoc);
    // Remove kiwi from the workspace.
    await userApi.updateWorkspacePermissions(ws1, {users: {[kiwiEmail]: null}});
    await assert.isRejected(kiwiApi.getWorkspaceAccess(ws1), /Forbidden/);
  });

  it("should allow only owners to remove a document", async () => {
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const doc1 = await userApi.newDoc({name: 'testdeleteme1'}, ws1);
    const kiwiApi = home.makeUserApi(ORG_NAME, 'kiwi');

    // Kiwi is editor of the document, so he can't delete it.
    await userApi.updateDocPermissions(doc1, {users: {'kiwi@getgrist.com': 'editors'}});
    await assert.isRejected(kiwiApi.softDeleteDoc(doc1), /Forbidden/);
    await assert.isRejected(kiwiApi.deleteDoc(doc1), /Forbidden/);

    // Kiwi is owner of the document - now he can delete it.
    await userApi.updateDocPermissions(doc1, {users: {'kiwi@getgrist.com': 'owners'}});
    await assert.isFulfilled(kiwiApi.softDeleteDoc(doc1));
    await assert.isFulfilled(kiwiApi.deleteDoc(doc1));
  });

  it("should allow only owners to rename a document", async () => {
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const doc1 = await userApi.newDoc({name: 'testrenameme1'}, ws1);
    const kiwiApi = home.makeUserApi(ORG_NAME, 'kiwi');

    // Kiwi is editor of the document, so he can't rename it.
    await userApi.updateDocPermissions(doc1, {users: {'kiwi@getgrist.com': 'editors'}});
    await assert.isRejected(kiwiApi.renameDoc(doc1, "testrenameme2"), /Forbidden/);

    // Kiwi is owner of the document - now he can rename it.
    await userApi.updateDocPermissions(doc1, {users: {'kiwi@getgrist.com': 'owners'}});
    await assert.isFulfilled(kiwiApi.renameDoc(doc1, "testrenameme2"));

    await userApi.deleteDoc(doc1);
  });

  it("guesses types of new columns", async () => {
    const userActions = [
      ['AddTable', 'GuessTypes', []],
      // Make 5 blank columns of type Any
      ['AddColumn', 'GuessTypes', 'Date', {}],
      ['AddColumn', 'GuessTypes', 'DateTime', {}],
      ['AddColumn', 'GuessTypes', 'Bool', {}],
      ['AddColumn', 'GuessTypes', 'Numeric', {}],
      ['AddColumn', 'GuessTypes', 'Text', {}],
      // Add string values from which the initial type will be guessed
      ['AddRecord', 'GuessTypes', null, {
        Date: "1970-01-02",
        DateTime: "1970-01-02 12:00",
        Bool: "true",
        Numeric: "1.2",
        Text: "hello",
      }],
    ];
    const resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/apply`, userActions, chimpy);
    assert.equal(resp.status, 200);

    // Check that the strings were parsed to typed values
    assert.deepEqual(
      (await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/GuessTypes/records`, chimpy)).data,
      {
        records: [
          {
            id: 1,
            fields: {
              Date: 24 * 60 * 60,
              DateTime: 36 * 60 * 60,
              Bool: true,
              Numeric: 1.2,
              Text: "hello",
            },
          },
        ],
      },
    );

    // Check the column types
    assert.deepEqual(
      (await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/GuessTypes/columns`, chimpy))
        .data.columns.map((col: any) => col.fields.type),
      ["Date", "DateTime:UTC", "Bool", "Numeric", "Text"],
    );
  });

  for (const content of ['with content', 'without content']) {
    for (const mode of ['logged in', 'anonymous']) {
      it(`POST /api/docs ${content} can create unsaved docs when ${mode}`, async function () {
        const user = (mode === 'logged in') ? chimpy : nobody;
        const formData = new FormData();
        formData.append('upload', 'A,B\n1,2\n3,4\n', 'table1.csv');
        const config = defaultsDeep({headers: formData.getHeaders()}, user);
        let resp = await axios.post(`${serverUrl}/api/docs`,
          ...(content === 'with content' ? [formData, config] : [null, user]));
        assert.equal(resp.status, 200);
        const urlId = resp.data;
        if (mode === 'logged in') {
          assert.match(urlId, /^new~[^~]*~[0-9]+$/);
        } else {
          assert.match(urlId, /^new~[^~]*$/);
        }

        // Access information about that document should be sane for current user
        resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, user);
        assert.equal(resp.status, 200);
        assert.equal(resp.data.name, 'Untitled');
        assert.equal(resp.data.workspace.name, 'Examples & Templates');
        assert.equal(resp.data.access, 'owners');
        if (mode === 'anonymous') {
          resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, chimpy);
          assert.equal(resp.data.access, 'owners');
        } else {
          resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, charon);
          assert.equal(resp.status, 403);
          resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, nobody);
          assert.equal(resp.status, 403);
        }

        // content was successfully stored
        resp = await axios.get(`${serverUrl}/api/docs/${urlId}/tables/Table1/data`, user);
        if (content === 'with content') {
          assert.deepEqual(resp.data, {id: [1, 2], manualSort: [1, 2], A: [1, 3], B: [2, 4]});
        } else {
          assert.deepEqual(resp.data, {id: [], manualSort: [], A: [], B: [], C: []});
        }
      });
    }

    it(`POST /api/docs ${content} can create saved docs in workspaces`, async function () {
      // Make a workspace.
      const chimpyWs = await userApi.newWorkspace({name: "Chimpy's Workspace"}, ORG_NAME);

      // Create a document in the new workspace.
      const user = chimpy;
      const body = {
        documentName: "Chimpy's Document",
        workspaceId: chimpyWs,
      };
      const formData = new FormData();
      formData.append('upload', 'A,B\n1,2\n3,4\n', 'table1.csv');
      formData.append('documentName', body.documentName);
      formData.append('workspaceId', body.workspaceId);
      const config = defaultsDeep({headers: formData.getHeaders()}, user);
      let resp = await axios.post(`${serverUrl}/api/docs`,
        ...(content === 'with content'
          ? [formData, config]
          : [body, user])
        );
      assert.equal(resp.status, 200);
      const urlId = resp.data;
      assert.notMatch(urlId, /^new~[^~]*~[0-9]+$/);
      assert.match(urlId, /^[^~]+$/);

      // Check document metadata.
      resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, user);
      assert.equal(resp.status, 200);
      assert.equal(resp.data.name, "Chimpy's Document");
      assert.equal(resp.data.workspace.name, "Chimpy's Workspace");
      assert.equal(resp.data.access, 'owners');
      resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, charon);
      assert.equal(resp.status, 200);
      resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, nobody);
      assert.equal(resp.status, 403);

      // Check document contents.
      resp = await axios.get(`${serverUrl}/api/docs/${urlId}/tables/Table1/data`, user);
      if (content === 'with content') {
        assert.deepEqual(resp.data, {id: [1, 2], manualSort: [1, 2], A: [1, 3], B: [2, 4]});
      } else {
        assert.deepEqual(resp.data, {id: [], manualSort: [], A: [], B: [], C: []});
      }

      // Delete the workspace.
      await userApi.deleteWorkspace(chimpyWs);
    });

    it(`POST /api/docs ${content} fails if workspace access is denied`, async function () {
      // Make a workspace.
      const chimpyWs = await userApi.newWorkspace({name: "Chimpy's Workspace"}, ORG_NAME);

      // Try to create a document in the new workspace as Kiwi and Charon, who do not have write access.
      for (const user of [kiwi, charon]) {
        const body = {
          documentName: "Untitled document",
          workspaceId: chimpyWs,
        };
        const formData = new FormData();
        formData.append('upload', 'A,B\n1,2\n3,4\n', 'table1.csv');
        formData.append('documentName', body.documentName);
        formData.append('workspaceId', body.workspaceId);
        const config = defaultsDeep({headers: formData.getHeaders()}, user);
        const resp = await axios.post(`${serverUrl}/api/docs`,
          ...(content === 'with content'
            ? [formData, config]
            : [body, user])
          );
        assert.equal(resp.status, 403);
        assert.equal(resp.data.error, 'access denied');
      }

      // Try to create a document in the new workspace as Chimpy, who does have write access.
      const user = chimpy;
      const body = {
        documentName: "Chimpy's Document",
        workspaceId: chimpyWs,
      };
      const formData = new FormData();
      formData.append('upload', 'A,B\n1,2\n3,4\n', 'table1.csv');
      formData.append('documentName', body.documentName);
      formData.append('workspaceId', body.workspaceId);
      const config = defaultsDeep({headers: formData.getHeaders()}, user);
      let resp = await axios.post(`${serverUrl}/api/docs`,
        ...(content === 'with content'
          ? [formData, config]
          : [body, user])
        );
      assert.equal(resp.status, 200);
      const urlId = resp.data;
      assert.notMatch(urlId, /^new~[^~]*~[0-9]+$/);
      assert.match(urlId, /^[^~]+$/);
      resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, user);
      assert.equal(resp.status, 200);
      assert.equal(resp.data.name, "Chimpy's Document");
      assert.equal(resp.data.workspace.name, "Chimpy's Workspace");
      assert.equal(resp.data.access, 'owners');

      // Delete the workspace.
      await userApi.deleteWorkspace(chimpyWs);
    });

    it(`POST /api/docs ${content} fails if workspace is soft-deleted`, async function () {
      // Make a workspace and promptly remove it.
      const chimpyWs = await userApi.newWorkspace({name: "Chimpy's Workspace"}, ORG_NAME);
      await userApi.softDeleteWorkspace(chimpyWs);

      // Try to create a document in the soft-deleted workspace.
      const user = chimpy;
      const body = {
        documentName: "Chimpy's Document",
        workspaceId: chimpyWs,
      };
      const formData = new FormData();
      formData.append('upload', 'A,B\n1,2\n3,4\n', 'table1.csv');
      formData.append('documentName', body.documentName);
      formData.append('workspaceId', body.workspaceId);
      const config = defaultsDeep({headers: formData.getHeaders()}, user);
      const resp = await axios.post(`${serverUrl}/api/docs`,
        ...(content === 'with content'
          ? [formData, config]
          : [body, user])
        );
      assert.equal(resp.status, 400);
      assert.equal(resp.data.error, 'Cannot add document to a deleted workspace');

      // Delete the workspace.
      await userApi.deleteWorkspace(chimpyWs);
    });

    it(`POST /api/docs ${content} fails if workspace does not exist`, async function () {
      // Try to create a document in a non-existent workspace.
      const user = chimpy;
      const body = {
        documentName: "Chimpy's Document",
        workspaceId: 123456789,
      };
      const formData = new FormData();
      formData.append('upload', 'A,B\n1,2\n3,4\n', 'table1.csv');
      formData.append('documentName', body.documentName);
      formData.append('workspaceId', body.workspaceId);
      const config = defaultsDeep({headers: formData.getHeaders()}, user);
      const resp = await axios.post(`${serverUrl}/api/docs`,
        ...(content === 'with content'
          ? [formData, config]
          : [body, user])
        );
      assert.equal(resp.status, 404);
      assert.equal(resp.data.error, 'workspace not found');
    });
  }

  it("GET /docs/{did}/tables/{tid}/data retrieves data in column format", async function () {
    const data = {
      id: [1, 2, 3, 4],
      A: ['hello', '', '', ''],
      B: ['', 'world', '', ''],
      C: ['', '', '', ''],
      D: [null, null, null, null],
      E: ['HELLO', '', '', ''],
      manualSort: [1, 2, 3, 4]
    };
    const respWithTableId = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
    assert.equal(respWithTableId.status, 200);
    assert.deepEqual(respWithTableId.data, data);
    const respWithTableRef = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/1/data`, chimpy);
    assert.equal(respWithTableRef.status, 200);
    assert.deepEqual(respWithTableRef.data, data);
  });

  it("GET /docs/{did}/tables/{tid}/records retrieves data in records format", async function () {
    const data = {
      records:
        [
          {
            id: 1,
            fields: {
              A: 'hello',
              B: '',
              C: '',
              D: null,
              E: 'HELLO',
            },
          },
          {
            id: 2,
            fields: {
              A: '',
              B: 'world',
              C: '',
              D: null,
              E: '',
            },
          },
          {
            id: 3,
            fields: {
              A: '',
              B: '',
              C: '',
              D: null,
              E: '',
            },
          },
          {
            id: 4,
            fields: {
              A: '',
              B: '',
              C: '',
              D: null,
              E: '',
            },
          },
        ]
    };
    const respWithTableId = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/records`, chimpy);
    assert.equal(respWithTableId.status, 200);
    assert.deepEqual(respWithTableId.data, data);
    const respWithTableRef = await axios.get(
      `${serverUrl}/api/docs/${docIds.Timesheets}/tables/1/records`, chimpy);
    assert.equal(respWithTableRef.status, 200);
    assert.deepEqual(respWithTableRef.data, data);
  });

  it('GET /docs/{did}/tables/{tid}/records honors the "hidden" param', async function () {
    const params = { hidden: true };
    const data = {
      id: 1,
      fields: {
        manualSort: 1,
        A: 'hello',
        B: '',
        C: '',
        D: null,
        E: 'HELLO',
      },
    };
    const respWithTableId = await axios.get(
      `${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/records`,
      {...chimpy, params }
    );
    assert.equal(respWithTableId.status, 200);
    assert.deepEqual(respWithTableId.data.records[0], data);
    const respWithTableRef = await axios.get(
      `${serverUrl}/api/docs/${docIds.Timesheets}/tables/1/records`,
      {...chimpy, params }
    );
    assert.equal(respWithTableRef.status, 200);
    assert.deepEqual(respWithTableRef.data.records[0], data);
  });

  it("GET /docs/{did}/tables/{tid}/records handles errors and hidden columns", async function () {
    let resp = await axios.get(`${serverUrl}/api/docs/${docIds.ApiDataRecordsTest}/tables/Table1/records`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      {
        "records": [
          {
            "id": 1,
            "fields": {
              "A": null,
              "B": "Hi",
              "C": 1,
            },
            "errors": {
              "A": "ZeroDivisionError"
            }
          }
        ]
      }
    );

    // /data format for comparison: includes manualSort, gristHelper_Display, and ["E", "ZeroDivisionError"]
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.ApiDataRecordsTest}/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      {
        "id": [
          1
        ],
        "manualSort": [
          1
        ],
        "A": [
          [
            "E",
            "ZeroDivisionError"
          ]
        ],
        "B": [
          "Hi"
        ],
        "C": [
          1
        ],
        "gristHelper_Display": [
          "Hi"
        ]
      }
    );
  });

  it("GET /docs/{did}/tables/{tid}/columns retrieves columns", async function () {
    const data = {
      columns: [
        {
          id: 'A',
          fields: {
            colRef: 2,
            parentId: 1,
            parentPos: 1,
            type: 'Text',
            widgetOptions: '',
            isFormula: false,
            formula: '',
            label: 'A',
            description: '',
            untieColIdFromLabel: false,
            summarySourceCol: 0,
            displayCol: 0,
            visibleCol: 0,
            rules: null,
            recalcWhen: 0,
            recalcDeps: null
          }
        },
        {
          id: 'B',
          fields: {
            colRef: 3,
            parentId: 1,
            parentPos: 2,
            type: 'Text',
            widgetOptions: '',
            isFormula: false,
            formula: '',
            label: 'B',
            description: '',
            untieColIdFromLabel: false,
            summarySourceCol: 0,
            displayCol: 0,
            visibleCol: 0,
            rules: null,
            recalcWhen: 0,
            recalcDeps: null
          }
        },
        {
          id: 'C',
          fields: {
            colRef: 4,
            parentId: 1,
            parentPos: 3,
            type: 'Text',
            widgetOptions: '',
            isFormula: false,
            formula: '',
            label: 'C',
            description: '',
            untieColIdFromLabel: false,
            summarySourceCol: 0,
            displayCol: 0,
            visibleCol: 0,
            rules: null,
            recalcWhen: 0,
            recalcDeps: null
          }
        },
        {
          id: 'D',
          fields: {
            colRef: 5,
            parentId: 1,
            parentPos: 3,
            type: 'Any',
            widgetOptions: '',
            isFormula: true,
            formula: '',
            label: 'D',
            description: '',
            untieColIdFromLabel: false,
            summarySourceCol: 0,
            displayCol: 0,
            visibleCol: 0,
            rules: null,
            recalcWhen: 0,
            recalcDeps: null
          }
        },
        {
          id: 'E',
          fields: {
            colRef: 6,
            parentId: 1,
            parentPos: 4,
            type: 'Any',
            widgetOptions: '',
            isFormula: true,
            formula: '$A.upper()',
            label: 'E',
            description: '',
            untieColIdFromLabel: false,
            summarySourceCol: 0,
            displayCol: 0,
            visibleCol: 0,
            rules: null,
            recalcWhen: 0,
            recalcDeps: null
          }
        }
      ]
    };
    const respWithTableId = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/columns`, chimpy);
    assert.equal(respWithTableId.status, 200);
    assert.deepEqual(respWithTableId.data, data);
    const respWithTableRef = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/1/columns`, chimpy);
    assert.equal(respWithTableRef.status, 200);
    assert.deepEqual(respWithTableRef.data, data);
  });

  it('GET /docs/{did}/tables/{tid}/columns retrieves hidden columns when "hidden" is set', async function () {
    const params = { hidden: true };
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/columns`,
      { ...chimpy, params }
    );
    assert.equal(resp.status, 200);
    const columnsMap = new Map(resp.data.columns.map(({id, fields}: {id: string, fields: object}) => [id, fields]));
    assert.include([...columnsMap.keys()], "manualSort");
    assert.deepInclude(columnsMap.get("manualSort"), {
      colRef: 1,
      type: 'ManualSortPos',
    });
  });

  it("GET/POST/PATCH /docs/{did}/tables and /columns", async function () {
    // POST /tables: Create new tables
    let resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/tables`, {
      tables: [
        {columns: [{}]},  // The minimal allowed request
        {id: "", columns: [{id: ""}]},
        {id: "NewTable1", columns: [{id: "NewCol1", fields: {}}]},
        {
          id: "NewTable2",
          columns: [
            {id: "NewCol2", fields: {label: "Label2"}},
            {id: "NewCol3", fields: {label: "Label3"}},
            {id: "NewCol3", fields: {label: "Label3"}},  // Duplicate column id
          ]
        },
        {
          id: "NewTable2",   // Create a table with duplicate tableId
          columns: [
            {id: "NewCol2", fields: {label: "Label2"}},
            {id: "NewCol3", fields: {label: "Label3"}},
          ]
        },
      ]
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      tables: [
        {id: "Table2"},
        {id: "Table3"},
        {id: "NewTable1"},
        {id: "NewTable2"},
        {id: "NewTable2_2"},  // duplicated tableId ends with _2
      ]
    });

    // POST /columns: Create new columns
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/NewTable2/columns`, {
      columns: [
        {},
        {id: ""},
        {id: "NewCol4", fields: {}},
        {id: "NewCol4", fields: {}},  // Create a column with duplicate colId
        {id: "NewCol5", fields: {label: "Label5"}},
      ],
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      columns: [
        {id: "A"},
        {id: "B"},
        {id: "NewCol4"},
        {id: "NewCol4_2"},  // duplicated colId ends with _2
        {id: "NewCol5"},
      ]
    });

    // POST /columns: Create new columns using tableRef in URL
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/5/columns`, {
      columns: [{id: "NewCol6", fields: {}}],
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {columns: [{id: "NewCol6"}]});

    // POST /columns to invalid table ID
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/NoSuchTable/columns`,
      {columns: [{}]}, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, {error: 'Table not found "NoSuchTable"'});

    // PATCH /tables: Modify a table. This is pretty much only good for renaming tables.
    resp = await axios.patch(`${serverUrl}/api/docs/${docIds.Timesheets}/tables`, {
      tables: [
        {id: "Table3", fields: {tableId: "Table3_Renamed"}},
      ]
    }, chimpy);
    assert.equal(resp.status, 200);

    // Repeat the same operation to check that it gives 404 if the table doesn't exist.
    resp = await axios.patch(`${serverUrl}/api/docs/${docIds.Timesheets}/tables`, {
      tables: [
        {id: "Table3", fields: {tableId: "Table3_Renamed"}},
      ]
    }, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, {error: 'Table not found "Table3"'});

    // PATCH /columns: Modify a column.
    resp = await axios.patch(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table2/columns`, {
      columns: [
        {id: "A", fields: {colId: "A_Renamed"}},
      ]
    }, chimpy);
    assert.equal(resp.status, 200);

    // Repeat the same operation to check that it gives 404 if the column doesn't exist.
    resp = await axios.patch(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table2/columns`, {
      columns: [
        {id: "A", fields: {colId: "A_Renamed"}},
      ]
    }, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, {error: 'Column not found "A"'});

    // Repeat the same operation to check that it gives 404 if the table doesn't exist.
    resp = await axios.patch(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table222/columns`, {
      columns: [
        {id: "A", fields: {colId: "A_Renamed"}},
      ]
    }, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, {error: 'Table not found "Table222"'});

    // Rename NewTable2.A -> B to test the name conflict resolution.
    resp = await axios.patch(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/NewTable2/columns`, {
      columns: [
        {id: "A", fields: {colId: "B"}},
      ]
    }, chimpy);
    assert.equal(resp.status, 200);

    // Hide NewTable2.NewCol5 and NewTable2_2 with ACL
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/apply`, [
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'NewTable2', colIds: 'NewCol5'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'NewTable2_2', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: '', permissionsText: '-R',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        // Don't use permissionsText: 'none' here because we need S permission to delete the table at the end.
        resource: -2, aclFormula: '', permissionsText: '-R',
      }],
    ], chimpy);
    assert.equal(resp.status, 200);

    // GET /tables: Check that the tables were created and renamed.
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      {
        "tables": [
          {
            "id": "Table1",
            "fields": {
              "rawViewSectionRef": 2,
              "recordCardViewSectionRef": 3,
              "primaryViewId": 1,
              "onDemand": false,
              "summarySourceTable": 0,
              "tableRef": 1
            }
          },
          // New tables start here
          {
            "id": "Table2",
            "fields": {
              "rawViewSectionRef": 5,
              "recordCardViewSectionRef": 6,
              "primaryViewId": 2,
              "onDemand": false,
              "summarySourceTable": 0,
              "tableRef": 2
            }
          },
          {
            "id": "Table3_Renamed",
            "fields": {
              "rawViewSectionRef": 8,
              "recordCardViewSectionRef": 9,
              "primaryViewId": 3,
              "onDemand": false,
              "summarySourceTable": 0,
              "tableRef": 3
            }
          },
          {
            "id": "NewTable1",
            "fields": {
              "rawViewSectionRef": 11,
              "recordCardViewSectionRef": 12,
              "primaryViewId": 4,
              "onDemand": false,
              "summarySourceTable": 0,
              "tableRef": 4
            }
          },
          {
            "id": "NewTable2",
            "fields": {
              "rawViewSectionRef": 14,
              "recordCardViewSectionRef": 15,
              "primaryViewId": 5,
              "onDemand": false,
              "summarySourceTable": 0,
              "tableRef": 5
            }
          },
          // NewTable2_2 is hidden by ACL
        ]
      }
    );

    // Check the created columns.
    // TODO these columns should probably be included in the GET /tables response.
    async function checkColumns(tableId: string, expected: { colId: string, label: string }[]) {
      const colsResp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/${tableId}/columns`, chimpy);
      assert.equal(colsResp.status, 200);
      const actual = colsResp.data.columns.map((c: any) => ({
        colId: c.id,
        label: c.fields.label,
      }));
      assert.deepEqual(actual, expected);
    }

    await checkColumns("Table2", [
      {colId: "A_Renamed", label: 'A'},
    ]);
    await checkColumns("Table3_Renamed", [
      {colId: "A", label: 'A'},
    ]);
    await checkColumns("NewTable1", [
      {colId: "NewCol1", label: 'NewCol1'},
    ]);
    await checkColumns("NewTable2", [
      {colId: "NewCol2", label: 'Label2'},
      {colId: "NewCol3", label: 'Label3'},
      {colId: "NewCol3_2", label: 'Label3'},
      {colId: "B2", label: 'A'},  // Result of renaming A -> B
      {colId: "B", label: 'B'},
      {colId: "NewCol4", label: 'NewCol4'},
      {colId: "NewCol4_2", label: 'NewCol4_2'},
      // NewCol5 is hidden by ACL
      {colId: "NewCol6", label: 'NewCol6'},
    ]);

    resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/NewTable2_2/columns`, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, {error: 'Table not found "NewTable2_2"'});  // hidden by ACL

    // Clean up the created tables for other tests
    // TODO add a DELETE endpoint for /tables and /columns. Probably best to do alongside DELETE /records.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/_grist_Tables/data/delete`,
      [2, 3, 4, 5, 6], chimpy);
    assert.equal(resp.status, 200);

    // Despite deleting tables (even in a more official way than above),
    // there are rules lingering relating to them. TODO: look into this.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/_grist_ACLRules/data/delete`,
      [2, 3], chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/_grist_ACLResources/data/delete`,
      [2, 3], chimpy);
    assert.equal(resp.status, 200);
  });

  describe("/docs/{did}/tables/{tid}/columns", function () {
    async function generateDocAndUrlForColumns(name: string) {
      const { tableUrl, docId } = await generateDocAndUrl(name);
      return {
        docId,
        url: `${tableUrl}/columns`,
      };
    }
    describe("PUT /docs/{did}/tables/{tid}/columns", function () {
      async function getColumnFieldsMapById(url: string, params: any) {
        const result = await axios.get(url, {...chimpy, params});
        assert.equal(result.status, 200);
        return new Map<string, object>(
            result.data.columns.map(
              ({id, fields}: {id: string, fields: object}) => [id, fields]
            )
        );
      }

      async function checkPut(
        columns: [RecordWithStringId, ...RecordWithStringId[]],
        params: Record<string, any>,
        expectedFieldsByColId: Record<string, object>,
        opts?: { getParams?: any }
      ) {
        const {url} = await generateDocAndUrlForColumns('ColumnsPut');
        const body: ColumnsPut = { columns };
        const resp = await axios.put(url, body, {...chimpy, params});
        assert.equal(resp.status, 200);
        const fieldsByColId = await getColumnFieldsMapById(url, opts?.getParams);

        assert.deepEqual(
          [...fieldsByColId.keys()],
          Object.keys(expectedFieldsByColId),
          "The updated table should have the expected columns"
        );

        for (const [colId, expectedFields] of Object.entries(expectedFieldsByColId)) {
          assert.deepInclude(fieldsByColId.get(colId), expectedFields);
        }
      }

      const COLUMN_TO_ADD = {
        id: "Foo",
        fields: {
          type: "Text",
          label: "FooLabel",
        }
      };

      const COLUMN_TO_UPDATE = {
        id: "A",
        fields: {
          type: "Numeric",
          colId: "NewA"
        }
      };

      it('should create new columns', async function () {
        await checkPut([COLUMN_TO_ADD], {}, {
          A: {}, B: {}, C: {}, Foo: COLUMN_TO_ADD.fields
        });
      });

      it('should update existing columns and create new ones', async function () {
        await checkPut([COLUMN_TO_ADD, COLUMN_TO_UPDATE], {}, {
          NewA: {type: "Numeric", label: "A"}, B: {}, C: {}, Foo: COLUMN_TO_ADD.fields
        });
      });

      it('should only update existing columns when noadd is set', async function () {
        await checkPut([COLUMN_TO_ADD, COLUMN_TO_UPDATE], {noadd: "1"}, {
          NewA: {type: "Numeric"}, B: {}, C: {}
        });
      });

      it('should only add columns when noupdate is set', async function () {
        await checkPut([COLUMN_TO_ADD, COLUMN_TO_UPDATE], {noupdate: "1"}, {
          A: {type: "Any"}, B: {}, C: {}, Foo: COLUMN_TO_ADD.fields
        });
      });

      it('should remove existing columns if replaceall is set', async function () {
        await checkPut([COLUMN_TO_ADD, COLUMN_TO_UPDATE], {replaceall: "1"}, {
          NewA: {type: "Numeric"}, Foo: COLUMN_TO_ADD.fields
        });
      });

      it('should NOT remove hidden columns even when replaceall is set', async function () {
        await checkPut([COLUMN_TO_ADD, COLUMN_TO_UPDATE], {replaceall: "1"}, {
          manualSort: {type: "ManualSortPos"}, NewA: {type: "Numeric"}, Foo: COLUMN_TO_ADD.fields
        }, { getParams: { hidden: true } });
      });

      it('should forbid update by viewers', async function () {
        // given
        const { url, docId } = await generateDocAndUrlForColumns('ColumnsPut');
        await userApi.updateDocPermissions(docId, {users: {'kiwi@getgrist.com': 'viewers'}});

        // when
        const resp = await axios.put(url, { columns: [ COLUMN_TO_ADD ] }, kiwi);

        // then
        assert.equal(resp.status, 403);
      });

      it("should return 404 when table is not found", async function() {
        // given
        const { url } = await generateDocAndUrlForColumns('ColumnsPut');
        const notFoundUrl = url.replace("Table1", "NonExistingTable");

        // when
        const resp = await axios.put(notFoundUrl, { columns: [ COLUMN_TO_ADD ] }, chimpy);

        // then
        assert.equal(resp.status, 404);
        assert.equal(resp.data.error, 'Table not found "NonExistingTable"');
      });
    });

    describe("DELETE /docs/{did}/tables/{tid}/columns/{colId}", function () {
      it('should delete some column', async function() {
        const {url} = await generateDocAndUrlForColumns('ColumnDelete');
        const deleteUrl = url + '/A';
        const resp = await axios.delete(deleteUrl, chimpy);

        assert.equal(resp.status, 200, "Should succeed in requesting column deletion");

        const listColResp = await axios.get(url, { ...chimpy, params: { hidden: true } });
        assert.equal(listColResp.status, 200, "Should succeed in listing columns");

        const columnIds = listColResp.data.columns.map(({id}: {id: string}) => id).sort();
        assert.deepEqual(columnIds, ["B", "C", "manualSort"]);
      });

      it('should return 404 if table not found', async function() {
        const {url} = await generateDocAndUrlForColumns('ColumnDelete');
        const deleteUrl = url.replace("Table1", "NonExistingTable") + '/A';
        const resp = await axios.delete(deleteUrl, chimpy);

        assert.equal(resp.status, 404);
        assert.equal(resp.data.error, 'Table or column not found "NonExistingTable.A"');
      });

      it('should return 404 if column not found', async function() {
        const {url} = await generateDocAndUrlForColumns('ColumnDelete');
        const deleteUrl = url + '/NonExistingColId';
        const resp = await axios.delete(deleteUrl, chimpy);

        assert.equal(resp.status, 404);
        assert.equal(resp.data.error, 'Table or column not found "Table1.NonExistingColId"');
      });

      it('should forbid column deletion by viewers', async function() {
        const {url, docId} = await generateDocAndUrlForColumns('ColumnDelete');
        await userApi.updateDocPermissions(docId, {users: {'kiwi@getgrist.com': 'viewers'}});
        const deleteUrl = url + '/A';
        const resp = await axios.delete(deleteUrl, kiwi);

        assert.equal(resp.status, 403);
      });
    });
  });

  it("GET /docs/{did}/tables/{tid}/data returns 404 for non-existent doc", async function () {
    const resp = await axios.get(`${serverUrl}/api/docs/typotypotypo/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /document not found/i);
  });

  it("GET /docs/{did}/tables/{tid}/data returns 404 for non-existent table", async function () {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Typo1/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /table not found/i);
  });

  it("GET /docs/{did}/tables/{tid}/columns returns 404 for non-existent doc", async function () {
    const resp = await axios.get(`${serverUrl}/api/docs/typotypotypo/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /document not found/i);
  });

  it("GET /docs/{did}/tables/{tid}/columns returns 404 for non-existent table", async function () {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Typo1/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /table not found/i);
  });

  it("GET /docs/{did}/tables/{tid}/data supports filters", async function () {
    function makeQuery(filters: { [colId: string]: any[] }) {
      const query = "filter=" + encodeURIComponent(JSON.stringify(filters));
      return axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data?${query}`, chimpy);
    }

    function checkResults(resp: AxiosResponse, expectedData: any) {
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, expectedData);
    }

    checkResults(await makeQuery({B: ['world']}), {
      id: [2], A: [''], B: ['world'], C: [''], D: [null], E: [''], manualSort: [2],
    });

    // Can query by id
    checkResults(await makeQuery({id: [1]}), {
      id: [1], A: ['hello'], B: [''], C: [''], D: [null], E: ['HELLO'], manualSort: [1],
    });

    checkResults(await makeQuery({B: [''], A: ['']}), {
      id: [3, 4], A: ['', ''], B: ['', ''], C: ['', ''], D: [null, null], E: ['', ''], manualSort: [3, 4],
    });

    // Empty filter is equivalent to no filter and should return full data.
    checkResults(await makeQuery({}), {
      id: [1, 2, 3, 4],
      A: ['hello', '', '', ''],
      B: ['', 'world', '', ''],
      C: ['', '', '', ''],
      D: [null, null, null, null],
      E: ['HELLO', '', '', ''],
      manualSort: [1, 2, 3, 4]
    });

    // An impossible filter should succeed but return an empty set of rows.
    checkResults(await makeQuery({B: ['world'], C: ['Neptune']}), {
      id: [], A: [], B: [], C: [], D: [], E: [], manualSort: [],
    });

    // An invalid filter should return an error
    {
      const resp = await makeQuery({BadCol: ['']});
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /BadCol/);
    }

    {
      const resp = await makeQuery({B: 'world'} as any);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /filter values must be arrays/);
    }
  });

  for (const mode of ['url', 'header']) {
    it(`GET /docs/{did}/tables/{tid}/data supports sorts and limits in ${mode}`, async function () {
      function makeQuery(sort: string[] | null, limit: number | null) {
        const url = new URL(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`);
        const config = makeConfig('chimpy');
        if (mode === 'url') {
          if (sort) {
            url.searchParams.append('sort', sort.join(','));
          }
          if (limit) {
            url.searchParams.append('limit', String(limit));
          }
        } else {
          if (sort) {
            config.headers!['x-sort'] = sort.join(',');
          }
          if (limit) {
            config.headers!['x-limit'] = String(limit);
          }
        }
        return axios.get(url.href, config);
      }

      function checkResults(resp: AxiosResponse, expectedData: any) {
        assert.equal(resp.status, 200);
        assert.deepEqual(resp.data, expectedData);
      }

      checkResults(await makeQuery(['-id'], null), {
        id: [4, 3, 2, 1],
        A: ['', '', '', 'hello'],
        B: ['', '', 'world', ''],
        C: ['', '', '', ''],
        D: [null, null, null, null],
        E: ['', '', '', 'HELLO'],
        manualSort: [4, 3, 2, 1]
      });

      checkResults(await makeQuery(['-id'], 2), {
        id: [4, 3],
        A: ['', ''],
        B: ['', ''],
        C: ['', ''],
        D: [null, null],
        E: ['', ''],
        manualSort: [4, 3]
      });
    });
  }

  it("GET /docs/{did}/tables/{tid}/data respects document permissions", async function () {
    // as not part of any group kiwi cannot fetch Timesheets
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`, kiwi);
    assert.equal(resp.status, 403);
  });

  it("GET /docs/{did}/tables/{tid}/data returns matches /not found/ for bad table id", async function () {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Bad_Foo_/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /not found/);
  });

  it("POST /docs/{did}/apply applies user actions", async function () {
    const userActions = [
      ['AddTable', 'Foo', [{id: 'A'}, {id: 'B'}]],
      ['BulkAddRecord', 'Foo', [1, 2], {A: ["Santa", "Bob"], B: [1, 11]}]
    ];
    const resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/apply`, userActions, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(
      (await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy)).data,
      {id: [1, 2], A: ['Santa', 'Bob'], B: ['1', '11'], manualSort: [1, 2]});
  });

  it("POST /docs/{did}/apply respects document permissions", async function () {
    const userActions = [
      ['AddTable', 'FooBar', [{id: 'A'}]]
    ];
    let resp: AxiosResponse;

    // as a guest chimpy cannot edit Bananas
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Bananas}/apply`, userActions, chimpy);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, {error: 'No write access'});

    // check that changes did not apply
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.Bananas}/tables/FooBar/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /not found/);

    // as not in any group kiwi cannot edit TestDoc
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/apply`, userActions, kiwi);
    assert.equal(resp.status, 403);

    // check that changes did not apply
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/FooBar/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /not found/);

  });

  it("POST /docs/{did}/tables/{tid}/data adds records", async function () {
    let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
      A: ['Alice', 'Felix'],
      B: [2, 22]
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, [3, 4]);
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy);
    assert.deepEqual(resp.data, {
      id: [1, 2, 3, 4],
      A: ['Santa', 'Bob', 'Alice', 'Felix'],
      B: ["1", "11", "2", "22"],
      manualSort: [1, 2, 3, 4]
    });
  });

  it("POST /docs/{did}/tables/{tid}/records adds records", async function () {
    let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`, {
      records: [
        {fields: {A: 'John', B: 55}},
        {fields: {A: 'Jane', B: 0}},
      ]
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      records: [
        {id: 5},
        {id: 6},
      ]
    });
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      {
        records:
          [
            {
              id: 1,
              fields: {
                A: 'Santa',
                B: '1',
              },
            },
            {
              id: 2,
              fields: {
                A: 'Bob',
                B: '11',
              },
            },
            {
              id: 3,
              fields: {
                A: 'Alice',
                B: '2',
              },
            },
            {
              id: 4,
              fields: {
                A: 'Felix',
                B: '22',
              },
            },
            {
              id: 5,
              fields: {
                A: 'John',
                B: '55',
              },
            },
            {
              id: 6,
              fields: {
                A: 'Jane',
                B: '0',
              },
            },
          ]
      });
  });

  it("POST /docs/{did}/tables/{tid}/data/delete deletes records", async function () {
    let resp = await axios.post(
      `${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data/delete`,
      [3, 4, 5, 6],
      chimpy,
    );
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, null);
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy);
    assert.deepEqual(resp.data, {
      id: [1, 2],
      A: ['Santa', 'Bob'],
      B: ["1", "11"],
      manualSort: [1, 2]
    });

    // restore rows
    await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
      A: ['Alice', 'Felix'],
      B: [2, 22]
    }, chimpy);
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy);
    assert.deepEqual(resp.data, {
      id: [1, 2, 3, 4],
      A: ['Santa', 'Bob', 'Alice', 'Felix'],
      B: ["1", "11", "2", "22"],
      manualSort: [1, 2, 3, 4]
    });
  });

  function checkError(status: number, test: RegExp | object, resp: AxiosResponse, message?: string) {
    assert.equal(resp.status, status);
    if (test instanceof RegExp) {
      assert.match(resp.data.error, test, message);
    } else {
      try {
        assert.deepEqual(resp.data, test, message);
      } catch (err) {
        console.log(JSON.stringify(resp.data));
        console.log(JSON.stringify(test));
        throw err;
      }
    }
  }

  // This is mostly tested in Python, but this case requires the data engine to call
  // 'external' (i.e. JS) code to do the type conversion.
  it("converts reference columns when the target table is deleted", async () => {
    // Create a test document.
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const docId = await userApi.newDoc({name: 'testdoc'}, ws1);
    const docUrl = `${serverUrl}/api/docs/${docId}`;

    // Make a new table with a reference column pointing at Table1, displaying column A.
    let resp = await axios.post(`${docUrl}/apply`, [
      ['AddTable', 'Table2', [{id: 'R', type: 'RefList:Table1'}]],
      ['ModifyColumn', 'Table2', 'R', {visibleCol: 2}],
      ['SetDisplayFormula', 'Table2', 0, 6, "$R.A"],
      ['BulkAddRecord', 'Table1', [1, 2], {A: ["Alice", "Bob"]}],
      ['BulkAddRecord', 'Table2', [1], {R: [["L", 1, 2]]}],
    ], chimpy);
    assert.equal(resp.status, 200);

    // Now delete the referenced table.
    // This action has to be separate for the test to pass.
    resp = await axios.post(`${docUrl}/apply`, [
      ['RemoveTable', 'Table1'],
    ], chimpy);
    assert.equal(resp.status, 200);

    resp = await axios.get(`${docUrl}/tables/Table2/columns`, chimpy);
    assert.deepEqual(resp.data, {
        "columns": [
          {
            "id": "R",
            "fields": {
              "colRef": 6,
              "parentId": 2,
              "parentPos": 6,
              // Type changed from RefList to Text
              "type": "Text",
              "widgetOptions": "",
              "isFormula": false,
              "formula": "",
              "label": "R",
              "description": "",
              "untieColIdFromLabel": false,
              "summarySourceCol": 0,
              // Display and visible columns cleared
              "displayCol": 0,
              "visibleCol": 0,
              "rules": null,
              "recalcWhen": 0,
              "recalcDeps": null
            }
          }
        ]
      }
    );

    resp = await axios.get(`${docUrl}/tables/Table2/records`, chimpy);
    assert.deepEqual(resp.data, {
        records:
          [
            // Reflist converted to comma separated display values.
            {id: 1, fields: {R: "Alice, Bob"}},
          ]
      }
    );
  });

  it("parses strings in user actions", async () => {
    // Create a test document.
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const docId = await userApi.newDoc({name: 'testdoc'}, ws1);
    const docUrl = `${serverUrl}/api/docs/${docId}`;
    const recordsUrl = `${docUrl}/tables/Table1/records`;

    // Make the column numeric, delete the other columns we don't care about
    await axios.post(`${docUrl}/apply`, [
      ['ModifyColumn', 'Table1', 'A', {type: 'Numeric'}],
      ['RemoveColumn', 'Table1', 'B'],
      ['RemoveColumn', 'Table1', 'C'],
    ], chimpy);

    // Add/update some records without and with string parsing
    // Specifically test:
    // 1. /apply, with an AddRecord
    // 2. POST  /records (BulkAddRecord)
    // 3. PATCH /records (BulkUpdateRecord)
    // Send strings that look like currency which need string parsing to become numbers
    for (const queryParams of ['?noparse=1', '']) {
      await axios.post(`${docUrl}/apply${queryParams}`, [
        ['AddRecord', 'Table1', null, {'A': '$1'}],
      ], chimpy);

      const response = await axios.post(`${recordsUrl}${queryParams}`,
        {
          records: [
            {fields: {'A': '$2'}},
            {fields: {'A': '$3'}},
          ]
        },
        chimpy);

      // Update $3 -> $4
      const rowId = response.data.records[1].id;
      await axios.patch(`${recordsUrl}${queryParams}`,
        {
          records: [
            {id: rowId, fields: {'A': '$4'}}
          ]
        },
        chimpy);
    }

    // Check the results
    const resp = await axios.get(recordsUrl, chimpy);
    assert.deepEqual(resp.data, {
        records:
          [
            // Without string parsing
            {id: 1, fields: {A: '$1'}},
            {id: 2, fields: {A: '$2'}},
            {id: 3, fields: {A: '$4'}},

            // With string parsing
            {id: 4, fields: {A: 1}},
            {id: 5, fields: {A: 2}},
            {id: 6, fields: {A: 4}},
          ]
      }
    );
  });

  describe("PUT /docs/{did}/tables/{tid}/records", async function () {
    it("should add or update records", async function () {
      // create sample document for testing
      const wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
      const docId = await userApi.newDoc({name: 'BlankTest'}, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;

      async function check(records: AddOrUpdateRecord[], expectedTableData: BulkColValues, params: any = {}) {
        const resp = await axios.put(url, {records}, {...chimpy, params});
        assert.equal(resp.status, 200);
        const table = await userApi.getTable(docId, "Table1");
        delete table.manualSort;
        delete table.C;
        assert.deepStrictEqual(table, expectedTableData);
      }

      // Add 3 new records, since the table is empty so nothing matches `requires`
      await check(
        [
          {
            require: {A: 1},
          },
          {
            // Since no record with A=2 is found, create a new record,
            // but `fields` overrides `require` for the value when creating,
            // so the new record has A=3
            require: {A: 2},
            fields: {A: 3},
          },
          {
            require: {A: 4},
            fields: {B: 5},
          },
        ],
        {id: [1, 2, 3], A: [1, 3, 4], B: [0, 0, 5]}
      );

      // Update all three records since they all match the `require` values here
      await check(
        [
          {
            // Does nothing
            require: {A: 1},
          },
          {
            // Changes A from 3 to 33
            require: {A: 3},
            fields: {A: 33},
          },
          {
            // Changes B from 5 to 6 in the third record where A=4
            require: {A: 4},
            fields: {B: 6},
          },
        ],
        {id: [1, 2, 3], A: [1, 33, 4], B: [0, 0, 6]}
      );

      // This would normally add a record, but noadd suppresses that
      await check([
          {
            require: {A: 100},
          },
        ],
        {id: [1, 2, 3], A: [1, 33, 4], B: [0, 0, 6]},
        {noadd: "1"},
      );

      // This would normally update A from 1 to 11, bot noupdate suppresses that
      await check([
          {
            require: {A: 1},
            fields: {A: 11},
          },
        ],
        {id: [1, 2, 3], A: [1, 33, 4], B: [0, 0, 6]},
        {noupdate: "1"},
      );

      // There are 2 records with B=0, update them both to B=1
      // Use onmany=all to specify that they should both be updated
      await check([
          {
            require: {B: 0},
            fields: {B: 1},
          },
        ],
        {id: [1, 2, 3], A: [1, 33, 4], B: [1, 1, 6]},
        {onmany: "all"}
      );

      // In contrast to the above, the default behaviour for no value of onmany
      // is to only update the first matching record,
      // so only one of the records with B=1 is updated to B=2
      await check([
          {
            require: {B: 1},
            fields: {B: 2},
          },
        ],
        {id: [1, 2, 3], A: [1, 33, 4], B: [2, 1, 6]},
      );

      // By default, strings in `require` and `fields` are parsed based on column type,
      // so these dollar amounts are treated as currency
      // and parsed as A=4 and A=44
      await check([
          {
            require: {A: "$4"},
            fields: {A: "$44"},
          },
        ],
        {id: [1, 2, 3], A: [1, 33, 44], B: [2, 1, 6]},
      );

      // Turn off the default string parsing with noparse=1
      // Now we need A=44 to actually be a number to match,
      // A="$44" wouldn't match and would create a new record.
      // Because A="$55" isn't parsed, the raw string is stored in the table.
      await check([
          {
            require: {A: 44},
            fields: {A: "$55"},
          },
        ],
        {id: [1, 2, 3], A: [1, 33, "$55"], B: [2, 1, 6]},
        {noparse: 1}
      );

      await check([
          // First three records already exist and nothing happens
          {require: {A: 1}},
          {require: {A: 33}},
          {require: {A: "$55"}},
          // Without string parsing, A="$33" doesn't match A=33 and a new record is created
          {require: {A: "$33"}},
        ],
        {id: [1, 2, 3, 4], A: [1, 33, "$55", "$33"], B: [2, 1, 6, 0]},
        {noparse: 1}
      );

      // Checking that updating by `id` works.
      await check([
          {
            require: {id: 3},
            fields: {A: "66"},
          },
        ],
        {id: [1, 2, 3, 4], A: [1, 33, 66, "$33"], B: [2, 1, 6, 0]},
      );

      // Test bulk case with a mixture of record shapes
      await check([
          {
            require: {A: 1},
            fields: {A: 111},
          },
          {
            require: {A: 33},
            fields: {A: 222, B: 444},
          },
          {
            require: {id: 3},
            fields: {A: 555, B: 666},
          },
        ],
        {id: [1, 2, 3, 4], A: [111, 222, 555, "$33"], B: [2, 444, 666, 0]},
      );

      // allow_empty_require option with empty `require` updates all records
      await check([
          {
            require: {},
            fields: {A: 99, B: 99},
          },
        ],
        {id: [1, 2, 3, 4], A: [99, 99, 99, 99], B: [99, 99, 99, 99]},
        {allow_empty_require: "1", onmany: "all"},
      );
    });

    it("should 404 for missing tables", async () => {
      checkError(404, /Table not found "Bad_Foo_"/,
        await axios.put(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Bad_Foo_/records`,
          {records: [{require: {id: 1}}]}, chimpy));
    });

    it("should 400 for missing columns", async () => {
      checkError(400, /Invalid column "no_such_column"/,
        await axios.put(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`,
          {records: [{require: {no_such_column: 1}}]}, chimpy));
    });

    it("should 400 for an incorrect onmany parameter", async function () {
      checkError(400,
        /onmany parameter foo should be one of first,none,all/,
        await axios.put(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`,
          {records: [{require: {id: 1}}]}, {...chimpy, params: {onmany: "foo"}}));
    });

    it("should 400 for an empty require without allow_empty_require", async function () {
      checkError(400,
        /require is empty but allow_empty_require isn't set/,
        await axios.put(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`,
          {records: [{require: {}}]}, chimpy));
    });

    it("should validate request schema", async function () {
      const url = `${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`;
      const test = async (payload: any, error: { error: string, details: {userError: string} }) => {
        const resp = await axios.put(url, payload, chimpy);
        checkError(400, error, resp);
      };
      await test({}, {error: 'Invalid payload', details: {userError: 'Error: body.records is missing'}});
      await test({records: 1}, {
        error: 'Invalid payload',
        details: {userError: 'Error: body.records is not an array'}});
      await test({records: [{fields: {}}]},
        {
          error: 'Invalid payload',
          details: {userError: 'Error: ' +
            'body.records[0] is not a AddOrUpdateRecord; ' +
            'body.records[0].require is missing',
         }});
      await test({records: [{require: {id: "1"}}]},
        {
          error: 'Invalid payload',
          details: {userError: 'Error: ' +
            'body.records[0] is not a AddOrUpdateRecord; ' +
            'body.records[0].require.id is not a number',
        }});
    });
  });

  describe("POST /docs/{did}/tables/{tid}/records", async function () {
    it("POST should have good errors", async () => {
      checkError(404, /not found/,
        await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Bad_Foo_/data`,
          {A: ['Alice', 'Felix'], B: [2, 22]}, chimpy));

      checkError(400, /Invalid column "Bad"/,
        await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`,
          {A: ['Alice'], Bad: ['Monthy']}, chimpy));

      // Other errors should also be maximally informative.
      checkError(400, /Error manipulating data/,
        await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`,
          {A: ['Alice'], B: null}, chimpy));
    });

    it("validates request schema", async function () {
      const url = `${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`;
      const test = async(payload: any, error: {error: string, details: {userError: string}}) => {
        const resp = await axios.post(url, payload, chimpy);
        checkError(400, error, resp);
      };
      await test({}, {error: 'Invalid payload', details: {userError: 'Error: body.records is missing'}});
      await test({records: 1}, {
        error: 'Invalid payload',
        details: {userError: 'Error: body.records is not an array'}});
      // All column types are allowed, except Arrays (or objects) without correct code.
      const testField = async (A: any) => {
        await test({records: [{ id: 1, fields: { A } }]}, {error: 'Invalid payload', details: {userError:
                    'Error: body.records[0] is not a NewRecord; '+
                    'body.records[0].fields.A is not a CellValue; '+
                    'body.records[0].fields.A is none of number, '+
                    'string, boolean, null, 1 more; body.records[0].'+
                    'fields.A[0] is not a GristObjCode; body.records[0]'+
                    '.fields.A[0] is not a valid enum value'}});
      };
      // test no code at all
      await testField([]);
      // test invalid code
      await testField(['ZZ']);
    });

    it("allows to create a blank record", async function () {
      // create sample document for testing
      const wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
      const docId = await userApi.newDoc({name: 'BlankTest'}, wid);
      // Create two blank records
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      const resp = await axios.post(url, {records: [{}, {fields: {}}]}, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, {records: [{id: 1}, {id: 2}]});
    });

    it("allows to create partial records", async function () {
      // create sample document for testing
      const wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
      const docId = await userApi.newDoc({name: 'BlankTest'}, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      // create partial records
      const resp = await axios.post(url, {records: [{fields: {A: 1}}, {fields: {B: 2}}, {}]}, chimpy);
      assert.equal(resp.status, 200);
      const table = await userApi.getTable(docId, "Table1");
      delete table.manualSort;
      assert.deepStrictEqual(
        table,
        {id: [1, 2, 3], A: [1, null, null], B: [null, 2, null], C: [null, null, null]});
    });

    it("allows CellValue as a field", async function () {
      // create sample document
      const wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
      const docId = await userApi.newDoc({name: 'PostTest'}, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      const testField = async (A?: CellValue, message?: string) => {
        const resp = await axios.post(url, {records: [{fields: {A}}]}, chimpy);
        assert.equal(resp.status, 200, message ?? `Error for code ${A}`);
      };
      // test allowed types for a field
      await testField(1); // ints
      await testField(1.2); // floats
      await testField("string"); // strings
      await testField(true); // true and false
      await testField(false);
      await testField(null); // null
      // encoded values (though not all make sense)
      for (const code of [
        GristObjCode.List,
        GristObjCode.Dict,
        GristObjCode.DateTime,
        GristObjCode.Date,
        GristObjCode.Skip,
        GristObjCode.Censored,
        GristObjCode.Reference,
        GristObjCode.ReferenceList,
        GristObjCode.Exception,
        GristObjCode.Pending,
        GristObjCode.Unmarshallable,
        GristObjCode.Versions,
      ]) {
        await testField([code]);
      }
    });
  });

  it("POST /docs/{did}/tables/{tid}/data respects document permissions", async function () {
    let resp: AxiosResponse;
    const data = {
      A: ['Alice', 'Felix'],
      B: [2, 22]
    };

    // as a viewer charon cannot edit TestDoc
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, data, charon);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, {error: 'No write access'});

    // as not part of any group kiwi cannot edit TestDoc
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, data, kiwi);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, {error: 'No view access'});

    // check that TestDoc did not change
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy);
    assert.deepEqual(resp.data, {
      id: [1, 2, 3, 4],
      A: ['Santa', 'Bob', 'Alice', 'Felix'],
      B: ["1", "11", "2", "22"],
      manualSort: [1, 2, 3, 4]
    });
  });

  describe("PATCH /docs/{did}/tables/{tid}/records", function () {
    it("updates records", async function () {
      let resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`, {
        records: [
          {
            id: 1,
            fields: {
              A: 'Father Christmas',
            },
          },
        ],
      }, chimpy);
      assert.equal(resp.status, 200);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`, chimpy);
      // check that rest of the data is left unchanged
      assert.deepEqual(resp.data, {
        records:
          [
            {
              id: 1,
              fields: {
                A: 'Father Christmas',
                B: '1',
              },
            },
            {
              id: 2,
              fields: {
                A: 'Bob',
                B: '11',
              },
            },
            {
              id: 3,
              fields: {
                A: 'Alice',
                B: '2',
              },
            },
            {
              id: 4,
              fields: {
                A: 'Felix',
                B: '22',
              },
            },
          ]
      });
    });

    it("validates request schema", async function () {
      const url = `${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`;
      async function failsWithError(payload: any, error: { error: string, details?: {userError: string} }){
        const resp = await axios.patch(url, payload, chimpy);
        checkError(400, error, resp);
      }

      await failsWithError({}, {error: 'Invalid payload', details: {userError: 'Error: body.records is missing'}});

      await failsWithError({records: 1}, {
        error: 'Invalid payload',
        details: {userError: 'Error: body.records is not an array'}});

      await failsWithError({records: []}, {error: 'Invalid payload', details: {userError:
                  'Error: body.records[0] is not a Record; body.records[0] is not an object'}});

      await failsWithError({records: [{}]}, {error: 'Invalid payload', details: {userError:
                  'Error: body.records[0] is not a Record\n    '+
                  'body.records[0].id is missing\n    '+
                  'body.records[0].fields is missing'}});

      await failsWithError({records: [{id: "1"}]}, {error: 'Invalid payload', details: {userError:
                  'Error: body.records[0] is not a Record\n' +
                  '    body.records[0].id is not a number\n' +
                  '    body.records[0].fields is missing'}});

      await failsWithError(
        {records: [{id: 1, fields: {A: 1}}, {id: 2, fields: {B: 3}}]},
        {error: 'PATCH requires all records to have same fields'});

      // Test invalid object codes
      const fieldIsNotValid = async (A: any) => {
        await failsWithError({records: [{ id: 1, fields: { A } }]}, {error: 'Invalid payload', details: {userError:
                    'Error: body.records[0] is not a Record; '+
                    'body.records[0].fields.A is not a CellValue; '+
                    'body.records[0].fields.A is none of number, '+
                    'string, boolean, null, 1 more; body.records[0].'+
                    'fields.A[0] is not a GristObjCode; body.records[0]'+
                    '.fields.A[0] is not a valid enum value'}});
      };
      await fieldIsNotValid([]);
      await fieldIsNotValid(['ZZ']);
    });

    it("allows CellValue as a field", async function () {
      // create sample document for testing
      const wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
      const docId = await userApi.newDoc({name: 'PatchTest'}, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      // create record for patching
      const id = (await axios.post(url, {records: [{}]}, chimpy)).data.records[0].id;
      const testField = async (A?: CellValue, message?: string) => {
        const resp = await axios.patch(url, {records: [{id, fields: {A}}]}, chimpy);
        assert.equal(resp.status, 200, message ?? `Error for code ${A}`);
      };
      await testField(1);
      await testField(1.2);
      await testField("string");
      await testField(true);
      await testField(false);
      await testField(null);
      for (const code of [
        GristObjCode.List,
        GristObjCode.Dict,
        GristObjCode.DateTime,
        GristObjCode.Date,
        GristObjCode.Skip,
        GristObjCode.Censored,
        GristObjCode.Reference,
        GristObjCode.ReferenceList,
        GristObjCode.Exception,
        GristObjCode.Pending,
        GristObjCode.Unmarshallable,
        GristObjCode.Versions,
      ]) {
        await testField([code]);
      }
    });
  });

  describe("PATCH /docs/{did}/tables/{tid}/data", function () {

    it("updates records", async function () {
      let resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
        id: [1],
        A: ['Santa Klaus'],
      }, chimpy);
      assert.equal(resp.status, 200);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy);
      // check that rest of the data is left unchanged
      assert.deepEqual(resp.data, {
        id: [1, 2, 3, 4],
        A: ['Santa Klaus', 'Bob', 'Alice', 'Felix'],
        B: ["1", "11", "2", "22"],
        manualSort: [1, 2, 3, 4]
      });

    });

    it("throws 400 for invalid row ids", async function () {

      // combination of valid and invalid ids fails
      let resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
        id: [1, 5],
        A: ['Alice', 'Felix']
      }, chimpy);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /Invalid row id 5/);

      // only invalid ids also fails
      resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
        id: [10, 5],
        A: ['Alice', 'Felix']
      }, chimpy);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /Invalid row id 10/);

      // check that changes related to id 1 did not apply
      assert.deepEqual((await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy)).data, {
        id: [1, 2, 3, 4],
        A: ['Santa Klaus', 'Bob', 'Alice', 'Felix'],
        B: ["1", "11", "2", "22"],
        manualSort: [1, 2, 3, 4]
      });
    });

    it("throws 400 for invalid column", async function () {
      const resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
        id: [1],
        A: ['Alice'],
        C: ['Monthy']
      }, chimpy);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /Invalid column "C"/);
    });

    it("respects document permissions", async function () {
      let resp: AxiosResponse;
      const data = {
        id: [1],
        A: ['Santa'],
      };

      // check data
      assert.deepEqual((await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy)).data, {
        id: [1, 2, 3, 4],
        A: ['Santa Klaus', 'Bob', 'Alice', 'Felix'],
        B: ["1", "11", "2", "22"],
        manualSort: [1, 2, 3, 4]
      });

      // as a viewer charon cannot patch TestDoc
      resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, data, charon);
      assert.equal(resp.status, 403);
      assert.deepEqual(resp.data, {error: 'No write access'});

      // as not part of any group kiwi cannot patch TestDoc
      resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, data, kiwi);
      assert.equal(resp.status, 403);
      assert.deepEqual(resp.data, {error: 'No view access'});

      // check that changes did not apply
      assert.deepEqual((await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy)).data, {
        id: [1, 2, 3, 4],
        A: ['Santa Klaus', 'Bob', 'Alice', 'Felix'],
        B: ["1", "11", "2", "22"],
        manualSort: [1, 2, 3, 4]
      });
    });

  });

  describe('attachments', function () {
    it("POST /docs/{did}/attachments adds attachments", async function () {
      let formData = new FormData();
      formData.append('upload', 'foobar', "hello.doc");
      formData.append('upload', '123456', "world.jpg");
      let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments`, formData,
        defaultsDeep({headers: formData.getHeaders()}, chimpy));
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, [1, 2]);

      // Another upload gets the next number.
      formData = new FormData();
      formData.append('upload', 'abcdef', "hello.png");
      resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments`, formData,
        defaultsDeep({headers: formData.getHeaders()}, chimpy));
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, [3]);
    });

    it("GET /docs/{did}/attachments lists attachment metadata", async function () {
      // Test that the usual /records query parameters like sort and filter also work
      const url = `${serverUrl}/api/docs/${docIds.TestDoc}/attachments?sort=-fileName&limit=2`;
      const resp = await axios.get(url, chimpy);
      assert.equal(resp.status, 200);
      const {records} = resp.data;
      for (const record of records) {
        assert.match(record.fields.timeUploaded, /^\d{4}-\d{2}-\d{2}T/);
        delete record.fields.timeUploaded;
      }
      assert.deepEqual(records, [
          {id: 2, fields: {fileName: "world.jpg", fileSize: 6}},
          {id: 3, fields: {fileName: "hello.png", fileSize: 6}},
        ]
      );
    });

    it("GET /docs/{did}/attachments/{id} returns attachment metadata", async function () {
      const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/2`, chimpy);
      assert.equal(resp.status, 200);
      assert.include(resp.data, {fileName: "world.jpg", fileSize: 6});
      assert.match(resp.data.timeUploaded, /^\d{4}-\d{2}-\d{2}T/);
    });

    it("GET /docs/{did}/attachments/{id}/download downloads attachment contents", async function () {
      const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/2/download`,
        {...chimpy, responseType: 'arraybuffer'});
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers['content-type'], 'image/jpeg');
      assert.deepEqual(resp.headers['content-disposition'], 'attachment; filename="world.jpg"');
      assert.deepEqual(resp.headers['cache-control'], 'private, max-age=3600');
      assert.deepEqual(resp.data, Buffer.from('123456'));
    });

    it("GET /docs/{did}/attachments/{id}/download works after doc shutdown", async function () {
      // Check that we can download when ActiveDoc isn't currently open.
      let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/force-reload`, null, chimpy);
      assert.equal(resp.status, 200);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/2/download`,
        {...chimpy, responseType: 'arraybuffer'});
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers['content-type'], 'image/jpeg');
      assert.deepEqual(resp.headers['content-disposition'], 'attachment; filename="world.jpg"');
      assert.deepEqual(resp.headers['cache-control'], 'private, max-age=3600');
      assert.deepEqual(resp.data, Buffer.from('123456'));
    });

    it("GET /docs/{did}/attachments/{id}... returns 404 when attachment not found", async function () {
      let resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/22`, chimpy);
      checkError(404, /Attachment not found: 22/, resp);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/moo`, chimpy);
      checkError(400, /parameter cannot be understood as an integer: moo/, resp);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/22/download`, chimpy);
      checkError(404, /Attachment not found: 22/, resp);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/moo/download`, chimpy);
      checkError(400, /parameter cannot be understood as an integer: moo/, resp);
    });

    it("POST /docs/{did}/attachments produces reasonable errors", async function () {
      // Check that it produces reasonable errors if we try to use it with non-form-data
      let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments`, [4, 5, 6], chimpy);
      assert.equal(resp.status, 415);     // Wrong content-type

      // Check for an error if there is no data included.
      const formData = new FormData();
      resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments`, formData,
        defaultsDeep({headers: formData.getHeaders()}, chimpy));
      assert.equal(resp.status, 400);
      // TODO The error here is "stream ended unexpectedly", which isn't really reasonable.
    });

    it("POST/GET /docs/{did}/attachments respect document permissions", async function () {
      const formData = new FormData();
      formData.append('upload', 'xyzzz', "wrong.png");
      let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments`, formData,
        defaultsDeep({headers: formData.getHeaders()}, kiwi));
      checkError(403, /No view access/, resp);

      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/3`, kiwi);
      checkError(403, /No view access/, resp);

      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/3/download`, kiwi);
      checkError(403, /No view access/, resp);
    });

    it("POST /docs/{did}/attachments respects untrusted content-type only if valid", async function () {
      const formData = new FormData();
      formData.append('upload', 'xyz', {filename: "foo", contentType: "application/pdf"});
      formData.append('upload', 'abc', {filename: "hello.png", contentType: "invalid/content-type"});
      formData.append('upload', 'def', {filename: "world.doc", contentType: "text/plain\nbad-header: 1\n\nEvil"});
      let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments`, formData,
        defaultsDeep({headers: formData.getHeaders()}, chimpy));
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, [4, 5, 6]);

      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/4/download`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers['content-type'], 'application/pdf');    // A valid content-type is respected
      assert.deepEqual(resp.headers['content-disposition'], 'attachment; filename="foo.pdf"');
      assert.deepEqual(resp.data, 'xyz');

      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/5/download`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers['content-type'], 'image/png');    // Did not pay attention to invalid header
      assert.deepEqual(resp.headers['content-disposition'], 'attachment; filename="hello.png"');
      assert.deepEqual(resp.data, 'abc');

      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/6/download`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers['content-type'], 'application/msword');    // Another invalid header ignored
      assert.deepEqual(resp.headers['content-disposition'], 'attachment; filename="world.doc"');
      assert.deepEqual(resp.headers['cache-control'], 'private, max-age=3600');
      assert.deepEqual(resp.headers['bad-header'], undefined);   // Attempt to hack in more headers didn't work
      assert.deepEqual(resp.data, 'def');
    });

    it("POST /docs/{did}/attachments/updateUsed updates timeDeleted on metadata", async function () {
      const wid = await getWorkspaceId(userApi, 'Private');
      const docId = await userApi.newDoc({name: 'TestDoc2'}, wid);

      // Apply the given user actions,
      // POST to /attachments/updateUsed
      // Check that Table1 and _grist_Attachments contain the expected rows
      async function check(
        actions: UserAction[],
        userData: { id: number, Attached: any }[],
        metaData: { id: number, deleted: boolean }[],
      ) {
        const docUrl = `${serverUrl}/api/docs/${docId}`;

        let resp = await axios.post(`${docUrl}/apply`, actions, chimpy);
        assert.equal(resp.status, 200);

        resp = await axios.post(`${docUrl}/attachments/updateUsed`, null, chimpy);
        assert.equal(resp.status, 200);

        resp = await axios.get(`${docUrl}/tables/Table1/records`, chimpy);
        const actualUserData = resp.data.records.map(
          ({id, fields: {Attached}}: ApiRecord) =>
            ({id, Attached})
        );
        assert.deepEqual(actualUserData, userData);

        resp = await axios.get(`${docUrl}/tables/_grist_Attachments/records`, chimpy);
        const actualMetaData = resp.data.records.map(
          ({id, fields: {timeDeleted}}: ApiRecord) =>
            ({id, deleted: Boolean(timeDeleted)})
        );
        assert.deepEqual(actualMetaData, metaData);
      }

      // Set up the document and initial data.
      await check(
        [
          ["AddColumn", "Table1", "Attached", {type: "Attachments"}],
          ["BulkAddRecord", "Table1", [1, 2], {Attached: [['L', 1], ['L', 2, 3]]}],
          // There's no actual attachments here but that doesn't matter
          ["BulkAddRecord", "_grist_Attachments", [1, 2, 3], {}],
        ],
        [
          {id: 1, Attached: ['L', 1]},
          {id: 2, Attached: ['L', 2, 3]},
        ],
        [
          {id: 1, deleted: false},
          {id: 2, deleted: false},
          {id: 3, deleted: false},
        ],
      );

      // Remove the record containing ['L', 2, 3], so the metadata for 2 and 3 now says deleted
      await check(
        [["RemoveRecord", "Table1", 2]],
        [
          {id: 1, Attached: ['L', 1]},
        ],
        [
          {id: 1, deleted: false},
          {id: 2, deleted: true},  // deleted here
          {id: 3, deleted: true},  // deleted here
        ],
      );

      // Add back a reference to attacument 2 to test 'undeletion', plus some junk values
      await check(
        [["BulkAddRecord", "Table1", [3, 4, 5], {Attached: [null, "foo", ['L', 2, 2, 4, 4, 5]]}]],
        [
          {id: 1, Attached: ['L', 1]},
          {id: 3, Attached: null},
          {id: 4, Attached: "foo"},
          {id: 5, Attached: ['L', 2, 2, 4, 4, 5]},
        ],
        [
          {id: 1, deleted: false},
          {id: 2, deleted: false},  // undeleted here
          {id: 3, deleted: true},
        ],
      );

      // Remove the whole column to test what happens when there's no Attachment columns
      await check(
        [["RemoveColumn", "Table1", "Attached"]],
        [
          {id: 1, Attached: undefined},
          {id: 3, Attached: undefined},
          {id: 4, Attached: undefined},
          {id: 5, Attached: undefined},
        ],
        [
          {id: 1, deleted: true},  // deleted here
          {id: 2, deleted: true},  // deleted here
          {id: 3, deleted: true},
        ],
      );

      // Test performance with a large number of records and attachments.
      // The maximum value of numRecords that doesn't return a 413 error is about 18,000.
      // In that case it took about 5.7 seconds to apply the initial user actions (i.e. add the records),
      // 0.3 seconds to call updateUsed once, and 0.1 seconds to call it again immediately after.
      // That last time roughly measures the time taken to do the SQL query
      // without having to apply any user actions after to update timeDeleted.
      // 10,000 records is a compromise so that tests aren't too slow.
      const numRecords = 10000;
      const attachmentsPerRecord = 4;
      const totalUsedAttachments = numRecords * attachmentsPerRecord;  // 40,000 attachments referenced in user data
      const totalAttachments = totalUsedAttachments * 1.1;  // 44,000 attachment IDs listed in metadata
      const attachedValues = _.chunk(_.range(1, totalUsedAttachments + 1), attachmentsPerRecord)
        .map(arr => ['L', ...arr]);
      await check(
        [
          // Reset the state: add back the removed column and delete the previously added data
          ["AddColumn", "Table1", "Attached", {type: "Attachments"}],
          ["BulkRemoveRecord", "Table1", [1, 3, 4, 5]],
          ["BulkRemoveRecord", "_grist_Attachments", [1, 2, 3]],
          ["BulkAddRecord", "Table1", arrayRepeat(numRecords, null), {Attached: attachedValues}],
          ["BulkAddRecord", "_grist_Attachments", arrayRepeat(totalAttachments, null), {}],
        ],
        attachedValues.map((Attached, index) => ({id: index + 1, Attached})),
        _.range(totalAttachments).map(index => ({id: index + 1, deleted: index >= totalUsedAttachments})),
      );
    });

    it("POST /docs/{did}/attachments/removeUnused removes unused attachments", async function () {
      const wid = await getWorkspaceId(userApi, 'Private');
      const docId = await userApi.newDoc({name: 'TestDoc3'}, wid);
      const docUrl = `${serverUrl}/api/docs/${docId}`;

      const formData = new FormData();
      formData.append('upload', 'foobar', "hello.doc");
      formData.append('upload', '123456', "world.jpg");
      formData.append('upload', 'foobar', "hello2.doc");
      let resp = await axios.post(`${docUrl}/attachments`, formData,
        defaultsDeep({headers: formData.getHeaders()}, chimpy));
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, [1, 2, 3]);

      async function checkAttachmentIds(ids: number[]) {
        resp = await axios.get(`${docUrl}/attachments`, chimpy);
        assert.equal(resp.status, 200);
        assert.deepEqual(resp.data.records.map((r: any) => r.id), ids);
      }

      resp = await axios.patch(
        `${docUrl}/tables/_grist_Attachments/records`,
        {
          records: [
            {id: 1, fields: {timeDeleted: Date.now() / 1000 - 8 * 24 * 60 * 60}},  // 8 days ago, i.e. expired
            {id: 2, fields: {timeDeleted: Date.now() / 1000 - 6 * 24 * 60 * 60}},  // 6 days ago, i.e. not expired
          ]
        },
        chimpy,
      );
      assert.equal(resp.status, 200);
      await checkAttachmentIds([1, 2, 3]);

      // Remove the expired attachment (1) by force-reloading, so it removes it during shutdown.
      // It has a duplicate (3) that hasn't expired and thus isn't removed,
      // although they share the same fileIdent and row in _gristsys_Files.
      // So for now only the metadata is removed.
      resp = await axios.post(`${docUrl}/force-reload`, null, chimpy);
      assert.equal(resp.status, 200);
      await checkAttachmentIds([2, 3]);
      resp = await axios.post(`${docUrl}/attachments/verifyFiles`, null, chimpy);
      assert.equal(resp.status, 200);

      // Remove the not expired attachments (2 and 3).
      // We didn't set a timeDeleted for 3, but it gets set automatically by updateUsedAttachmentsIfNeeded.
      resp = await axios.post(`${docUrl}/attachments/removeUnused?verifyfiles=1`, null, chimpy);
      assert.equal(resp.status, 200);
      await checkAttachmentIds([]);
    });

  });

  it("GET /docs/{did}/download serves document", async function () {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download`, chimpy);
    assert.equal(resp.status, 200);
    assert.match(resp.data, /grist_Tables_column/);
  });

  it("GET /docs/{did}/download respects permissions", async function () {
    // kiwi has no access to TestDoc
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download`, kiwi);
    assert.equal(resp.status, 403);
    assert.notMatch(resp.data, /grist_Tables_column/);
  });

  // A tiny test that /copy doesn't throw.
  it("POST /docs/{did}/copy succeeds", async function () {
    const docId = docIds.TestDoc;
    const worker1 = await userApi.getWorkerAPI(docId);
    await worker1.copyDoc(docId, undefined, 'copy');
  });

  it("POST /docs/{did} with sourceDocId copies a document", async function () {
    const chimpyWs = await userApi.newWorkspace({name: "Chimpy's Workspace"}, ORG_NAME);
    const resp = await axios.post(`${serverUrl}/api/docs`, {
      sourceDocumentId: docIds.TestDoc,
      documentName: 'copy of TestDoc',
      asTemplate: false,
      workspaceId: chimpyWs
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.isString(resp.data);
  });

  it("GET /docs/{did}/download/csv serves CSV-encoded document", async function () {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/download/csv?tableId=Table1`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data, 'A,B,C,D,E\nhello,,,,HELLO\n,world,,,\n,,,,\n,,,,\n');

    const resp2 = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/csv?tableId=Foo`, chimpy);
    assert.equal(resp2.status, 200);
    assert.equal(resp2.data, 'A,B\nSanta,1\nBob,11\nAlice,2\nFelix,22\n');
  });

  it('GET /docs/{did}/download/csv with header=colId shows columns id in the header instead of their name',
    async function () {
      const { docUrl } = await generateDocAndUrl('csvWithColIdAsHeader');
      const AColRef = 2;
      const userActions = [
        ['AddRecord', 'Table1', null, {A: 'a1', B: 'b1'}],
        ['UpdateRecord', '_grist_Tables_column', AColRef, { untieColIdFromLabel: true }],
        ['UpdateRecord', '_grist_Tables_column', AColRef, {
          label: 'Column label for A',
          colId: 'AColId'
        }]
      ];
      const resp = await axios.post(`${docUrl}/apply`, userActions, chimpy);
      assert.equal(resp.status, 200);
      const csvResp = await axios.get(`${docUrl}/download/csv?tableId=Table1&header=colId`, chimpy);
      assert.equal(csvResp.status, 200);
      assert.equal(csvResp.data, 'AColId,B,C\na1,b1,\n');
    });

  it("GET /docs/{did}/download/csv respects permissions", async function () {
    // kiwi has no access to TestDoc
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/csv?tableId=Table1`, kiwi);
    assert.equal(resp.status, 403);
    assert.notEqual(resp.data, 'A,B,C,D,E\nhello,,,,HELLO\n,world,,,\n,,,,\n,,,,\n');
  });

  it("GET /docs/{did}/download/csv returns 404 if tableId is invalid", async function () {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/csv?tableId=MissingTableId`, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, {error: 'Table MissingTableId not found.'});
  });

  it("GET /docs/{did}/download/csv returns 404 if viewSectionId is invalid", async function () {
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/csv?tableId=Table1&viewSection=9999`, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, {error: 'No record 9999 in table _grist_Views_section'});
  });

  it("GET /docs/{did}/download/csv returns 400 if tableId is missing", async function () {
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/csv`, chimpy);
    assert.equal(resp.status, 400);
    assert.deepEqual(resp.data, {error: 'tableId parameter should be a string: undefined'});
  });

  it("GET /docs/{did}/download/table-schema serves table-schema-encoded document", async function () {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/table-schema?tableId=Foo`, chimpy);
    assert.equal(resp.status, 200);
    const expected = {
      format: "csv",
      mediatype: "text/csv",
      encoding: "utf-8",
      dialect: {
        delimiter: ",",
        doubleQuote: true,
      },
      name: 'foo',
      title: 'Foo',
      schema: {
        fields: [{
          name: 'A',
          type: 'string',
          format: 'default',
        }, {
          name: 'B',
          type: 'string',
          format: 'default',
        }]
      }
    };
    assert.deepInclude(resp.data, expected);

    const resp2 = await axios.get(resp.data.path, chimpy);
    assert.equal(resp2.status, 200);
    assert.equal(resp2.data, 'A,B\nSanta,1\nBob,11\nAlice,2\nFelix,22\n');
  });

  it("GET /docs/{did}/download/table-schema serves table-schema-encoded document with header=colId", async function () {
    const { docUrl, tableUrl } = await generateDocAndUrl('tableSchemaWithColIdAsHeader');
    const columns = [
      {
        id: 'Some_ID',
        fields: {
          label: 'Some Label',
          type: 'Text',
        }
      },
    ];
    const setupColResp = await axios.put(`${tableUrl}/columns`, { columns }, {...chimpy, params: { replaceall: true }});
    assert.equal(setupColResp.status, 200);

    const resp = await axios.get(`${docUrl}/download/table-schema?tableId=Table1&header=colId`, chimpy);
    assert.equal(resp.status, 200);
    const expected = {
      format: "csv",
      mediatype: "text/csv",
      encoding: "utf-8",
      dialect: {
        delimiter: ",",
        doubleQuote: true,
      },
      name: 'table1',
      title: 'Table1',
      schema: {
        fields: [{
          name: 'Some_ID',
          type: 'string',
          format: 'default',
        }]
      }
    };
    assert.deepInclude(resp.data, expected);
  });

  it("GET /docs/{did}/download/table-schema respects permissions", async function () {
    // kiwi has no access to TestDoc
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/table-schema?tableId=Table1`, kiwi);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, {"error": "No view access"});
  });

  it("GET /docs/{did}/download/table-schema returns 404 if tableId is invalid", async function () {
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/table-schema?tableId=MissingTableId`,
      chimpy,
    );
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, {error: 'Table MissingTableId not found.'});
  });

  it("GET /docs/{did}/download/table-schema returns 400 if tableId is missing", async function () {
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/table-schema`, chimpy);
    assert.equal(resp.status, 400);
    assert.deepEqual(resp.data, {error: 'tableId parameter should be a string: undefined'});
  });


  it("GET /docs/{did}/download/xlsx serves XLSX-encoded document", async function () {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/download/xlsx?tableId=Table1`, chimpy);
    assert.equal(resp.status, 200);
    assert.notEqual(resp.data, null);
  });

  it("GET /docs/{did}/download/xlsx respects permissions", async function () {
    // kiwi has no access to TestDoc
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/xlsx?tableId=Table1`, kiwi);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, {error: 'No view access'});
  });

  it("GET /docs/{did}/download/xlsx returns 404 if tableId is invalid", async function () {
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/xlsx?tableId=MissingTableId`,
      chimpy
    );
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, {error: 'Table MissingTableId not found.'});
  });

  it("GET /docs/{did}/download/xlsx returns 404 if viewSectionId is invalid", async function () {
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/xlsx?tableId=Table1&viewSection=9999`, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, {error: 'No record 9999 in table _grist_Views_section'});
  });

  it("GET /docs/{did}/download/xlsx returns 200 if tableId is missing", async function () {
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/xlsx`, chimpy);
    assert.equal(resp.status, 200);
    assert.notEqual(resp.data, null);
  });

  it('POST /workspaces/{wid}/import handles empty filenames', async function () {
    if (!process.env.TEST_REDIS_URL || docs.proxiedServer) {
      this.skip();
    }
    const worker1 = await userApi.getWorkerAPI('import');
    const wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
    const fakeData1 = await testUtils.readFixtureDoc('Hello.grist');
    const uploadId1 = await worker1.upload(fakeData1, '.grist');
    const resp = await axios.post(`${worker1.url}/api/workspaces/${wid}/import`, {uploadId: uploadId1},
      makeConfig('Chimpy'));
    assert.equal(resp.status, 200);
    assert.equal(resp.data.title, 'Untitled upload');
    assert.equal(typeof resp.data.id, 'string');
    assert.notEqual(resp.data.id, '');
  });


  it("handles /s/ variants for shares", async function () {
    const wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
    const docId = await userApi.newDoc({name: 'BlankTest'}, wid);
    // const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
    const userActions = [
      ['AddRecord', '_grist_Shares', null, {
        linkId: 'x',
        options: '{"publish": true}'
      }],
      ['UpdateRecord', '_grist_Views_section', 1,
       {shareOptions: '{"publish": true, "form": true}'}],
      ['UpdateRecord', '_grist_Pages', 1, {shareRef: 1}],
    ];
    let resp: AxiosResponse;
    resp = await axios.post(`${serverUrl}/api/docs/${docId}/apply`, userActions, chimpy);
    assert.equal(resp.status, 200);

    const db = await getDatabase();
    const shares = await db.connection.query('select * from shares');
    const {key} = shares[0];

    resp = await axios.get(`${serverUrl}/api/docs/${docId}/tables/Table1/records`, chimpy);
    assert.equal(resp.status, 200);

    resp = await axios.get(`${serverUrl}/api/s/${key}/tables/Table1/records`, chimpy);
    assert.equal(resp.status, 200);

    resp = await axios.get(`${serverUrl}/api/docs/${key}/tables/Table1/records`, chimpy);
    assert.equal(resp.status, 404);

    resp = await axios.get(`${serverUrl}/api/docs/${SHARE_KEY_PREFIX}${key}/tables/Table1/records`, chimpy);
    assert.equal(resp.status, 200);

    resp = await axios.get(`${serverUrl}/api/s/${key}xxx/tables/Table1/records`, chimpy);
    assert.equal(resp.status, 404);
  });

  it("document is protected during upload-and-import sequence", async function () {
    if (!process.env.TEST_REDIS_URL || home.proxiedServer) {
      this.skip();
    }
    // Prepare an API for a different user.
    const kiwiApi = new UserAPIImpl(`${homeUrl}/o/Fish`, {
      headers: {Authorization: 'Bearer api_key_for_kiwi'},
      fetch: fetch as any,
      newFormData: () => new FormData() as any,
    });
    // upload something for Chimpy and something else for Kiwi.
    const worker1 = await userApi.getWorkerAPI('import');
    const fakeData1 = await testUtils.readFixtureDoc('Hello.grist');
    const uploadId1 = await worker1.upload(fakeData1, 'upload.grist');
    const worker2 = await kiwiApi.getWorkerAPI('import');
    const fakeData2 = await testUtils.readFixtureDoc('Favorite_Films.grist');
    const uploadId2 = await worker2.upload(fakeData2, 'upload2.grist');

    // Check that kiwi only has access to their own upload.
    let wid = (await kiwiApi.getOrgWorkspaces('current')).find((w) => w.name === 'Big')!.id;
    let resp = await axios.post(`${worker2.url}/api/workspaces/${wid}/import`, {uploadId: uploadId1},
      makeConfig('Kiwi'));
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, {error: "access denied"});

    resp = await axios.post(`${worker2.url}/api/workspaces/${wid}/import`, {uploadId: uploadId2},
      makeConfig('Kiwi'));
    assert.equal(resp.status, 200);

    // Check that chimpy has access to their own upload.
    wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
    resp = await axios.post(`${worker1.url}/api/workspaces/${wid}/import`, {uploadId: uploadId1},
      makeConfig('Chimpy'));
    assert.equal(resp.status, 200);
  });

  it('limits parallel requests', async function () {
    // Launch 30 requests in parallel and see how many are honored and how many
    // return 429s.  The timing of this test is a bit delicate.  We close the doc
    // to increase the odds that results won't start coming back before all the
    // requests have passed authorization.  May need to do something more sophisticated
    // if this proves unreliable.
    await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/force-reload`, null, chimpy);
    const reqs = [...Array(30).keys()].map(
      i => axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy));
    const responses = await Promise.all(reqs);
    assert.lengthOf(responses.filter(r => r.status === 200), 10);
    assert.lengthOf(responses.filter(r => r.status === 429), 20);
  });

  it('allows forced reloads', async function () {
    let resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/force-reload`, null, chimpy);
    assert.equal(resp.status, 200);
    // Check that support cannot force a reload.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/force-reload`, null, support);
    assert.equal(resp.status, 403);
    if (hasHomeApi) {
      // Check that support can force a reload through housekeeping api.
      resp = await axios.post(`${serverUrl}/api/housekeeping/docs/${docIds.Timesheets}/force-reload`, null, support);
      assert.equal(resp.status, 200);
      // Check that regular user cannot force a reload through housekeeping api.
      resp = await axios.post(`${serverUrl}/api/housekeeping/docs/${docIds.Timesheets}/force-reload`, null, chimpy);
      assert.equal(resp.status, 403);
    }
  });

  it('allows assignments', async function () {
    let resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/assign`, null, chimpy);
    assert.equal(resp.status, 200);
    // Check that support cannot force an assignment.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/assign`, null, support);
    assert.equal(resp.status, 403);
    if (hasHomeApi) {
      // Check that support can force an assignment through housekeeping api.
      resp = await axios.post(`${serverUrl}/api/housekeeping/docs/${docIds.Timesheets}/assign`, null, support);
      assert.equal(resp.status, 200);
      // Check that regular user cannot force an assignment through housekeeping api.
      resp = await axios.post(`${serverUrl}/api/housekeeping/docs/${docIds.Timesheets}/assign`, null, chimpy);
      assert.equal(resp.status, 403);
    }
  });

  it('honors urlIds', async function () {
    // Make a document with a urlId
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const doc1 = await userApi.newDoc({name: 'testdoc1', urlId: 'urlid1'}, ws1);
    try {
      // Make sure an edit made by docId is visible when accessed via docId or urlId
      await axios.post(`${serverUrl}/api/docs/${doc1}/tables/Table1/data`, {
        A: ['Apple'], B: [99]
      }, chimpy);
      let resp = await axios.get(`${serverUrl}/api/docs/${doc1}/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[0], 'Apple');
      resp = await axios.get(`${serverUrl}/api/docs/urlid1/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[0], 'Apple');
      // Make sure an edit made by urlId is visible when accessed via docId or urlId
      await axios.post(`${serverUrl}/api/docs/urlid1/tables/Table1/data`, {
        A: ['Orange'], B: [42]
      }, chimpy);
      resp = await axios.get(`${serverUrl}/api/docs/${doc1}/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[1], 'Orange');
      resp = await axios.get(`${serverUrl}/api/docs/urlid1/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[1], 'Orange');
    } finally {
      await userApi.deleteDoc(doc1);
    }
  });

  it('filters urlIds by org', async function () {
    if (home.proxiedServer) { this.skip(); }
    // Make two documents with same urlId
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const doc1 = await userApi.newDoc({name: 'testdoc1', urlId: 'urlid'}, ws1);
    const nasaApi = new UserAPIImpl(`${homeUrl}/o/nasa`, {
      headers: {Authorization: 'Bearer api_key_for_chimpy'},
      fetch: fetch as any,
      newFormData: () => new FormData() as any,
    });
    const ws2 = (await nasaApi.getOrgWorkspaces('current'))[0].id;
    const doc2 = await nasaApi.newDoc({name: 'testdoc2', urlId: 'urlid'}, ws2);
    try {
      // Place a value in "docs" doc
      await axios.post(`${serverUrl}/o/docs/api/docs/urlid/tables/Table1/data`, {
        A: ['Apple'], B: [99]
      }, chimpy);
      // Place a value in "nasa" doc
      await axios.post(`${serverUrl}/o/nasa/api/docs/urlid/tables/Table1/data`, {
        A: ['Orange'], B: [99]
      }, chimpy);
      // Check the values made it to the right places
      let resp = await axios.get(`${serverUrl}/api/docs/${doc1}/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[0], 'Apple');
      resp = await axios.get(`${serverUrl}/api/docs/${doc2}/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[0], 'Orange');
    } finally {
      await userApi.deleteDoc(doc1);
      await nasaApi.deleteDoc(doc2);
    }
  });

  it('allows docId access to any document from merged org', async function () {
    // Make two documents
    if (home.proxiedServer) { this.skip(); }
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const doc1 = await userApi.newDoc({name: 'testdoc1'}, ws1);
    const nasaApi = new UserAPIImpl(`${homeUrl}/o/nasa`, {
      headers: {Authorization: 'Bearer api_key_for_chimpy'},
      fetch: fetch as any,
      newFormData: () => new FormData() as any,
    });
    const ws2 = (await nasaApi.getOrgWorkspaces('current'))[0].id;
    const doc2 = await nasaApi.newDoc({name: 'testdoc2'}, ws2);
    try {
      // Should fail to write to a document in "docs" from "nasa" url
      let resp = await axios.post(`${serverUrl}/o/nasa/api/docs/${doc1}/tables/Table1/data`, {
        A: ['Apple'], B: [99]
      }, chimpy);
      assert.equal(resp.status, 404);
      // Should successfully write to a document in "nasa" from "docs" url
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc2}/tables/Table1/data`, {
        A: ['Orange'], B: [99]
      }, chimpy);
      assert.equal(resp.status, 200);
      // Should fail to write to a document in "nasa" from "pr" url
      resp = await axios.post(`${serverUrl}/o/pr/api/docs/${doc2}/tables/Table1/data`, {
        A: ['Orange'], B: [99]
      }, chimpy);
      assert.equal(resp.status, 404);
    } finally {
      await userApi.deleteDoc(doc1);
      await nasaApi.deleteDoc(doc2);
    }
  });

  it("GET /docs/{did}/replace replaces one document with another", async function () {
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const doc1 = await userApi.newDoc({name: 'testdoc1'}, ws1);
    const doc2 = await userApi.newDoc({name: 'testdoc2'}, ws1);
    const doc3 = await userApi.newDoc({name: 'testdoc3'}, ws1);
    const doc4 = await userApi.newDoc({name: 'testdoc4'}, ws1);
    await userApi.updateDocPermissions(doc2, {users: {'kiwi@getgrist.com': 'editors'}});
    await userApi.updateDocPermissions(doc3, {users: {'kiwi@getgrist.com': 'viewers'}});
    await userApi.updateDocPermissions(doc4, {users: {'kiwi@getgrist.com': 'owners'}});
    try {
      // Put some material in doc3
      let resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc3}/tables/Table1/data`, {
        A: ['Orange']
      }, chimpy);
      assert.equal(resp.status, 200);

      // Kiwi cannot replace doc2 with doc3, not an owner
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc2}/replace`, {
        sourceDocId: doc3
      }, kiwi);
      assert.equal(resp.status, 403);
      assert.match(resp.data.error, /Only owners can replace a document/);

      // Kiwi can't replace doc1 with doc3, no access to doc1
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc1}/replace`, {
        sourceDocId: doc3
      }, kiwi);
      assert.equal(resp.status, 403);
      assert.match(resp.data.error, /No view access/);

      // Kiwi can't replace doc2 with doc1, no read access to doc1
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc2}/replace`, {
        sourceDocId: doc1
      }, kiwi);
      assert.equal(resp.status, 403);
      assert.match(resp.data.error, /access denied/);

      // Kiwi cannot replace a doc with material they have only partial read access to.
      resp = await axios.post(`${serverUrl}/api/docs/${doc3}/apply`, [
        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: 'A'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'user.Access not in [OWNER]', permissionsText: '-R',
        }]
      ], chimpy);
      assert.equal(resp.status, 200);
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc4}/replace`, {
        sourceDocId: doc3
      }, kiwi);
      assert.equal(resp.status, 403);
      assert.match(resp.data.error, /not authorized/);
      resp = await axios.post(`${serverUrl}/api/docs/${doc3}/tables/_grist_ACLRules/data/delete`,
        [2], chimpy);
      assert.equal(resp.status, 200);
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc4}/replace`, {
        sourceDocId: doc3
      }, kiwi);
      assert.equal(resp.status, 200);
    } finally {
      await userApi.deleteDoc(doc1);
      await userApi.deleteDoc(doc2);
      await userApi.deleteDoc(doc3);
      await userApi.deleteDoc(doc4);
    }
  });

  it("GET /docs/{did}/snapshots retrieves a list of snapshots", async function () {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/snapshots`, chimpy);
    assert.equal(resp.status, 200);
    assert.isAtLeast(resp.data.snapshots.length, 1);
    assert.hasAllKeys(resp.data.snapshots[0], ['docId', 'lastModified', 'snapshotId']);
  });

  it("POST /docs/{did}/states/remove removes old states", async function () {
    // Check doc has plenty of states.
    let resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/states`, chimpy);
    assert.equal(resp.status, 200);
    const states: DocState[] = resp.data.states;
    assert.isAbove(states.length, 5);

    // Remove all but 3.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/states/remove`, {keep: 3}, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/states`, chimpy);
    assert.equal(resp.status, 200);
    assert.lengthOf(resp.data.states, 3);
    assert.equal(resp.data.states[0].h, states[0].h);
    assert.equal(resp.data.states[1].h, states[1].h);
    assert.equal(resp.data.states[2].h, states[2].h);

    // Remove all but 1.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/states/remove`, {keep: 1}, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/states`, chimpy);
    assert.equal(resp.status, 200);
    assert.lengthOf(resp.data.states, 1);
    assert.equal(resp.data.states[0].h, states[0].h);
  });

  it("GET /docs/{did1}/compare/{did2} tracks changes between docs", async function () {
    // Pass kiwi's headers as it contains both Authorization and Origin headers
    // if run behind a proxy, so we can ensure that the Origin header check is not made.
    const userApiServerUrl = docs.proxiedServer ? serverUrl : undefined;
    const chimpyApi = home.makeUserApi(
      ORG_NAME, 'chimpy', { serverUrl: userApiServerUrl, headers: chimpy.headers as Record<string, string> }
    );
    const ws1 = (await chimpyApi.getOrgWorkspaces('current'))[0].id;
    const docId1 = await chimpyApi.newDoc({name: 'testdoc1'}, ws1);
    const docId2 = await chimpyApi.newDoc({name: 'testdoc2'}, ws1);
    const doc1 = chimpyApi.getDocAPI(docId1);
    const doc2 = chimpyApi.getDocAPI(docId2);

    // Stick some content in column A so it has a defined type
    // so diffs are smaller and simpler.
    await doc2.addRows('Table1', {A: [0]});

    let comp = await doc1.compareDoc(docId2);
    assert.hasAllKeys(comp, ['left', 'right', 'parent', 'summary']);
    assert.equal(comp.summary, 'unrelated');
    assert.equal(comp.parent, null);
    assert.hasAllKeys(comp.left, ['n', 'h']);
    assert.hasAllKeys(comp.right, ['n', 'h']);
    assert.equal(comp.left.n, 1);
    assert.equal(comp.right.n, 2);

    await doc1.replace({sourceDocId: docId2});

    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, 'same');
    assert.equal(comp.left.n, 2);
    assert.deepEqual(comp.left, comp.right);
    assert.deepEqual(comp.left, comp.parent);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, {detail: true});
    assert.deepEqual(comp.details, {
      leftChanges: {tableRenames: [], tableDeltas: {}},
      rightChanges: {tableRenames: [], tableDeltas: {}}
    });

    await doc1.addRows('Table1', {A: [1]});
    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, 'left');
    assert.equal(comp.left.n, 3);
    assert.equal(comp.right.n, 2);
    assert.deepEqual(comp.right, comp.parent);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, {detail: true});
    assert.deepEqual(comp.details!.rightChanges,
      {tableRenames: [], tableDeltas: {}});
    const addA1: ActionSummary = {
      tableRenames: [],
      tableDeltas: {
        Table1: {
          updateRows: [],
          removeRows: [],
          addRows: [2],
          columnDeltas: {
            A: {[2]: [null, [1]]},
            manualSort: {[2]: [null, [2]]},
          },
          columnRenames: [],
        }
      }
    };
    assert.deepEqual(comp.details!.leftChanges, addA1);

    await doc2.addRows('Table1', {A: [1]});
    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, 'both');
    assert.equal(comp.left.n, 3);
    assert.equal(comp.right.n, 3);
    assert.equal(comp.parent!.n, 2);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, {detail: true});
    assert.deepEqual(comp.details!.leftChanges, addA1);
    assert.deepEqual(comp.details!.rightChanges, addA1);

    await doc1.replace({sourceDocId: docId2});

    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, 'same');
    assert.equal(comp.left.n, 3);
    assert.deepEqual(comp.left, comp.right);
    assert.deepEqual(comp.left, comp.parent);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, {detail: true});
    assert.deepEqual(comp.details, {
      leftChanges: {tableRenames: [], tableDeltas: {}},
      rightChanges: {tableRenames: [], tableDeltas: {}}
    });

    await doc2.addRows('Table1', {A: [2]});
    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, 'right');
    assert.equal(comp.left.n, 3);
    assert.equal(comp.right.n, 4);
    assert.deepEqual(comp.left, comp.parent);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, {detail: true});
    assert.deepEqual(comp.details!.leftChanges,
      {tableRenames: [], tableDeltas: {}});
    const addA2: ActionSummary = {
      tableRenames: [],
      tableDeltas: {
        Table1: {
          updateRows: [],
          removeRows: [],
          addRows: [3],
          columnDeltas: {
            A: {[3]: [null, [2]]},
            manualSort: {[3]: [null, [3]]},
          },
          columnRenames: [],
        }
      }
    };
    assert.deepEqual(comp.details!.rightChanges, addA2);
  });

  it("GET /docs/{did}/compare tracks changes within a doc", async function () {
    // Create a test document.
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const docId = await userApi.newDoc({name: 'testdoc'}, ws1);
    const doc = userApi.getDocAPI(docId);

    // Give the document some history.
    await doc.addRows('Table1', {A: ['a1'], B: ['b1']});
    await doc.addRows('Table1', {A: ['a2'], B: ['b2']});
    await doc.updateRows('Table1', {id: [1], A: ['A1']});

    // Examine the most recent change, from HEAD~ to HEAD.
    let comp = await doc.compareVersion('HEAD~', 'HEAD');
    assert.hasAllKeys(comp, ['left', 'right', 'parent', 'summary', 'details']);
    assert.equal(comp.summary, 'right');
    assert.deepEqual(comp.parent, comp.left);
    assert.notDeepEqual(comp.parent, comp.right);
    assert.hasAllKeys(comp.left, ['n', 'h']);
    assert.hasAllKeys(comp.right, ['n', 'h']);
    assert.equal(comp.left.n, 3);
    assert.equal(comp.right.n, 4);
    assert.deepEqual(comp.details!.leftChanges, {tableRenames: [], tableDeltas: {}});
    assert.deepEqual(comp.details!.rightChanges, {
      tableRenames: [],
      tableDeltas: {
        Table1: {
          updateRows: [1],
          removeRows: [],
          addRows: [],
          columnDeltas: {
            A: {[1]: [['a1'], ['A1']]}
          },
          columnRenames: [],
        }
      }
    });

    // Check we get the same result with actual hashes.
    assert.notMatch(comp.left.h, /HEAD/);
    assert.notMatch(comp.right.h, /HEAD/);
    const comp2 = await doc.compareVersion(comp.left.h, comp.right.h);
    assert.deepEqual(comp, comp2);

    // Check that comparing the HEAD with itself shows no changes.
    comp = await doc.compareVersion('HEAD', 'HEAD');
    assert.equal(comp.summary, 'same');
    assert.deepEqual(comp.parent, comp.left);
    assert.deepEqual(comp.parent, comp.right);
    assert.deepEqual(comp.details!.leftChanges, {tableRenames: [], tableDeltas: {}});
    assert.deepEqual(comp.details!.rightChanges, {tableRenames: [], tableDeltas: {}});

    // Examine the combination of the last two changes.
    comp = await doc.compareVersion('HEAD~~', 'HEAD');
    assert.hasAllKeys(comp, ['left', 'right', 'parent', 'summary', 'details']);
    assert.equal(comp.summary, 'right');
    assert.deepEqual(comp.parent, comp.left);
    assert.notDeepEqual(comp.parent, comp.right);
    assert.hasAllKeys(comp.left, ['n', 'h']);
    assert.hasAllKeys(comp.right, ['n', 'h']);
    assert.equal(comp.left.n, 2);
    assert.equal(comp.right.n, 4);
    assert.deepEqual(comp.details!.leftChanges, {tableRenames: [], tableDeltas: {}});
    assert.deepEqual(comp.details!.rightChanges, {
      tableRenames: [],
      tableDeltas: {
        Table1: {
          updateRows: [1],
          removeRows: [],
          addRows: [2],
          columnDeltas: {
            A: {
              [1]: [['a1'], ['A1']],
              [2]: [null, ['a2']]
            },
            B: {[2]: [null, ['b2']]},
            manualSort: {[2]: [null, [2]]},
          },
          columnRenames: [],
        }
      }
    });
  });

  it('doc worker endpoints ignore any /dw/.../ prefix', async function () {
    if (docs.proxiedServer) {
      this.skip();
    }
    const docWorkerUrl = docs.serverUrl;
    let resp = await axios.get(`${docWorkerUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 200);
    assert.containsAllKeys(resp.data, ['A', 'B', 'C']);

    resp = await axios.get(`${docWorkerUrl}/dw/zing/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 200);
    assert.containsAllKeys(resp.data, ['A', 'B', 'C']);

    if (docWorkerUrl !== homeUrl) {
      resp = await axios.get(`${homeUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
      assert.equal(resp.status, 200);
      assert.containsAllKeys(resp.data, ['A', 'B', 'C']);

      resp = await axios.get(`${homeUrl}/dw/zing/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
      assert.equal(resp.status, 404);
    }
  });

  describe('webhooks related endpoints', async function () {
    const serving: Serving = await serveSomething(app => {
      app.use(express.json());
      app.post('/200', ({body}, res) => {
        res.sendStatus(200);
        res.end();
      });
    }, webhooksTestPort);

    /*
      Regression test for old _subscribe endpoint. /docs/{did}/webhooks should be used instead to subscribe
    */
    async function oldSubscribeCheck(requestBody: any, status: number, ...errors: RegExp[]) {
      const resp = await axios.post(
        `${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/_subscribe`,
        requestBody, chimpy
        );
        assert.equal(resp.status, status);
        for (const error of errors) {
          assert.match(resp.data.details?.userError || resp.data.error, error);
        }
      }

    async function postWebhookCheck(requestBody: any, status: number, ...errors: RegExp[]) {
      const resp = await axios.post(
        `${serverUrl}/api/docs/${docIds.Timesheets}/webhooks`,
        requestBody, chimpy
      );
      assert.equal(resp.status, status);
      for (const error of errors) {
        assert.match(resp.data.details?.userError || resp.data.error, error);
      }
      return resp.data;
    }

    it("GET /docs/{did}/webhooks retrieves a list of webhooks", async function () {
      const registerResponse = await postWebhookCheck({webhooks:[{fields:{tableId: "Table1", eventTypes: ["add"], url: "https://example.com"}}]}, 200);
      const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/webhooks`, chimpy);
      try{
      assert.equal(resp.status, 200);
      assert.isAtLeast(resp.data.webhooks.length, 1);
      assert.containsAllKeys(resp.data.webhooks[0], ['id', 'fields']);
      assert.containsAllKeys(resp.data.webhooks[0].fields,
        ['enabled', 'isReadyColumn', 'memo', 'name', 'tableId', 'eventTypes', 'url']);
      }
      finally{
        //cleanup
        await deleteWebhookCheck(registerResponse.webhooks[0].id);
      }
    });

    it("POST /docs/{did}/tables/{tid}/_subscribe validates inputs", async function () {
      await oldSubscribeCheck({}, 400, /eventTypes is missing/);
      await oldSubscribeCheck({eventTypes: 0}, 400, /url is missing/, /eventTypes is not an array/);
      await oldSubscribeCheck({eventTypes: []}, 400, /url is missing/);
      await oldSubscribeCheck({eventTypes: [], url: "https://example.com"}, 400, /eventTypes must be a non-empty array/);
      await oldSubscribeCheck({eventTypes: ["foo"], url: "https://example.com"}, 400, /eventTypes\[0] is none of "add", "update"/);
      await oldSubscribeCheck({eventTypes: ["add"]}, 400, /url is missing/);
      await oldSubscribeCheck({eventTypes: ["add"], url: "https://evil.com"}, 403, /Provided url is forbidden/);
      await oldSubscribeCheck({eventTypes: ["add"], url: "http://example.com"}, 403, /Provided url is forbidden/);  // not https
      await oldSubscribeCheck({eventTypes: ["add"], url: "https://example.com", isReadyColumn: "bar"}, 404, /Column not found "bar"/);
    });

    // in this endpoint webhookID is in body, not in path, so it also should be verified
    it("POST /docs/{did}/webhooks validates inputs", async function () {

      await postWebhookCheck({webhooks:[{fields: {tableId: "Table1"}}]}, 400,
        /eventTypes is missing/);
      await postWebhookCheck({webhooks:[{fields: {tableId: "Table1", eventTypes: 0}}]}, 400,
        /url is missing/, /eventTypes is not an array/);
      await postWebhookCheck({webhooks:[{fields: {tableId: "Table1", eventTypes: []}}]},
        400, /url is missing/);
      await postWebhookCheck({webhooks:[{fields: {tableId: "Table1", eventTypes: [],
              url: "https://example.com"}}]},
        400, /eventTypes must be a non-empty array/);
      await postWebhookCheck({webhooks:[{fields: {tableId: "Table1", eventTypes: ["foo"],
              url: "https://example.com"}}]},
        400, /eventTypes\[0] is none of "add", "update"/);
      await postWebhookCheck({webhooks:[{fields: {tableId: "Table1", eventTypes: ["add"]}}]},
        400, /url is missing/);
      await postWebhookCheck({webhooks:[{fields: {tableId: "Table1", eventTypes: ["add"],
              url: "https://evil.com"}}]},
        403, /Provided url is forbidden/);
      await postWebhookCheck({webhooks:[{fields: {tableId: "Table1", eventTypes: ["add"],
              url: "http://example.com"}}]},
        403, /Provided url is forbidden/);  // not https
      await postWebhookCheck({webhooks:[{fields: {tableId: "Table1", eventTypes: ["add"],
              url: "https://example.com", isReadyColumn: "bar"}}]},
        404, /Column not found "bar"/);
      await postWebhookCheck({webhooks:[{fields: {eventTypes: ["add"], url: "https://example.com"}}]},
        400, /tableId is missing/);
      await postWebhookCheck({}, 400, /webhooks is missing/);
      await postWebhookCheck({
        webhooks: [{
          fields: {
            tableId: "Table1", eventTypes: ["update"], watchedColIds: ["notExisting"],
            url: `${serving.url}/200`
          }
        }]
      },
        403, /Column not found notExisting/);

    });

    async function userCheck(user: AxiosRequestConfig, requestBody: any, status: number, responseBody: any) {
      const resp = await axios.post(
        `${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/_unsubscribe`,
        requestBody, user
      );
      assert.equal(resp.status, status);
      if (status !== 200) {
        responseBody = {error: responseBody};
      }
      assert.deepEqual(resp.data, responseBody);
    }

    async function userDeleteCheck(user: AxiosRequestConfig, webhookId: string, status: number, ...errors: RegExp[]) {
      const resp = await axios.delete(
        `${serverUrl}/api/docs/${docIds.Timesheets}/webhooks/${webhookId}`,
        user
      );
      assert.equal(resp.status, status);
      for (const error of errors) {
        assert.match(resp.data.details?.userError || resp.data.error, error);
      }
    }

    interface SubscriptionInfo{
      unsubscribeKey: string;
      webhookId: string;
    }
    async function subscribeWebhook(): Promise<SubscriptionInfo> {
      const subscribeResponse = await axios.post(
        `${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/_subscribe`,
        {eventTypes: ["add"], url: "https://example.com"}, chimpy
      );
      assert.equal(subscribeResponse.status, 200);
      // Editor needs unsubscribeKey.
      const {unsubscribeKey, webhookId} = subscribeResponse.data;
      return {unsubscribeKey, webhookId};
    }

    it("POST /docs/{did}/tables/{tid}/_unsubscribe validates inputs for owners", async function () {
      // Owner doesn't need unsubscribeKey.
      const {webhookId} = await subscribeWebhook();

      const check = userCheck.bind(null, chimpy);

      await check({webhookId: "foo"}, 404, `Webhook not found "foo"`);
      await check({}, 404, `Webhook not found ""`);

      // Actually unsubscribe
      await check({webhookId}, 200, {success: true});

      // Trigger is now deleted!
      await check({webhookId}, 404, `Webhook not found "${webhookId}"`);
    });

    it("DELETE /docs/{did}/tables/webhooks validates inputs for owners", async function () {
      // Owner doesn't need unsubscribeKey.
      const {webhookId} = await subscribeWebhook();

      const check = userDeleteCheck.bind(null, chimpy);

      await check("foo", 404, /Webhook not found "foo"/);

      await check("", 404, /not found/, new RegExp(`/api/docs/${docIds.Timesheets}/webhooks/`));


      // Actually unsubscribe
      await check(webhookId, 200);

      // Trigger is now deleted!
      await check(webhookId, 404, new RegExp(`Webhook not found "${webhookId}"`));
    });

    async function getRegisteredWebhooks() {
      const response = await axios.get(
        `${serverUrl}/api/docs/${docIds.Timesheets}/webhooks`, chimpy);
      return response.data.webhooks;
    }

    async function deleteWebhookCheck(webhookId: any) {
      const response = await axios.delete(
        `${serverUrl}/api/docs/${docIds.Timesheets}/webhooks/${webhookId}`, chimpy);
      return response.data;
    }

    it("POST /docs/{did}/webhooks is adding new webhook to table "+
       "and DELETE /docs/{did}/webhooks/{wid} is removing new webhook from table", async function(){
        const registeredWebhook = await postWebhookCheck({webhooks:[{fields:{tableId: "Table1", eventTypes: ["add"], url: "https://example.com"}}]}, 200);
        let webhookList = await getRegisteredWebhooks();
        assert.equal(webhookList.length, 1);
        assert.equal(webhookList[0].id, registeredWebhook.webhooks[0].id);
        await deleteWebhookCheck(registeredWebhook.webhooks[0].id);
        webhookList = await getRegisteredWebhooks();
        assert.equal(webhookList.length, 0);
    });

    it("POST /docs/{did}/webhooks is adding new webhook should be able to add many webhooks at once", async function(){
      const response = await postWebhookCheck(
        {
          webhooks:[
            {fields:{tableId: "Table1", eventTypes: ["add"], url: "https://example.com"}},
            {fields:{tableId: "Table1", eventTypes: ["add"], url: "https://example.com/2"}},
            {fields:{tableId: "Table1", eventTypes: ["add"], url: "https://example.com/3"}},
          ]}, 200);
      assert.equal(response.webhooks.length, 3);
      const webhookList = await getRegisteredWebhooks();
      assert.equal(webhookList.length, 3);
    });

    it("POST /docs/{did}/tables/{tid}/_unsubscribe validates inputs for editors", async function () {

      const subscribeResponse = await subscribeWebhook();

      const delta = {
        users: {"kiwi@getgrist.com": 'editors' as string | null}
      };
      let accessResp = await axios.patch(`${homeUrl}/api/docs/${docIds.Timesheets}/access`, {delta}, chimpy);
      await flushAuth();
      assert.equal(accessResp.status, 200);

      const check = userCheck.bind(null, kiwi);

      await check({webhookId: "foo"}, 404, `Webhook not found "foo"`);
      //no unsubscribeKey - should be not accepted for role other that owner
      await check({webhookId: subscribeResponse.webhookId}, 400, 'Bad request: unsubscribeKey required');
      //wrong unsubscribeKey - it should not be accepted
      //subscribeResponse = await subscribeWebhook();
      await check({webhookId: subscribeResponse.webhookId, unsubscribeKey: "foo"},
        401, 'Wrong unsubscribeKey');
      //subscribeResponse = await subscribeWebhook();
      // Actually unsubscribe with the same unsubscribeKey that was returned by registration
      await check({webhookId: subscribeResponse.webhookId, unsubscribeKey:subscribeResponse.unsubscribeKey},
        200, {success: true});

      // Trigger is now deleted!
      await check({webhookId: subscribeResponse.webhookId, unsubscribeKey:subscribeResponse.unsubscribeKey},
        404, `Webhook not found "${subscribeResponse.webhookId}"`);

      // Remove editor access
      delta.users['kiwi@getgrist.com'] = null;
      accessResp = await axios.patch(`${homeUrl}/api/docs/${docIds.Timesheets}/access`, {delta}, chimpy);
      assert.equal(accessResp.status, 200);
      await flushAuth();
    });

    it("DELETE /docs/{did}/tables/webhooks should not be allowed for not-owner", async function () {

      const subscribeResponse = await subscribeWebhook();
      const check = userDeleteCheck.bind(null, kiwi);

      const delta = {
        users: {"kiwi@getgrist.com": 'editors' as string | null}
      };
      let accessResp = await axios.patch(`${homeUrl}/api/docs/${docIds.Timesheets}/access`, {delta}, chimpy);
      assert.equal(accessResp.status, 200);
      await flushAuth();

      // Actually unsubscribe with the same unsubscribeKey that was returned by registration - it shouldn't be accepted
      await check(subscribeResponse.webhookId, 403, /No owner access/);


      // Remove editor access
      delta.users['kiwi@getgrist.com'] = null;
      accessResp = await axios.patch(`${homeUrl}/api/docs/${docIds.Timesheets}/access`, {delta}, chimpy);
      assert.equal(accessResp.status, 200);
      await flushAuth();
    });

  });

  describe("Daily API Limit", () => {
    let redisClient: RedisClient;

    before(async function () {
      if (!process.env.TEST_REDIS_URL) {
        this.skip();
      }
      redisClient = createClient(process.env.TEST_REDIS_URL);
    });

    it("limits daily API usage", async function () {
      // Make a new document in a test product with a low daily limit
      const api = home.makeUserApi('testdailyapilimit');
      const workspaceId = await getWorkspaceId(api, 'TestDailyApiLimitWs');
      const docId = await api.newDoc({name: 'TestDoc1'}, workspaceId);
      const max = testDailyApiLimitFeatures.baseMaxApiUnitsPerDocumentPerDay;

      for (let i = 1; i <= max + 2; i++) {
        let success = true;
        try {
          // Make some doc request so that it fails or succeeds
          await api.getTable(docId, "Table1");
        } catch (e) {
          success = false;
        }

        // Usually the first `max` requests should succeed and the rest should fail having exceeded the daily limit.
        // If a new minute starts in the middle of the requests, an extra request will be allowed for that minute.
        // If a new day starts in the middle of the requests, this test will fail.
        if (success) {
          assert.isAtMost(i, max + 1);
        } else {
          assert.isAtLeast(i, max + 1);
        }
      }
    });

    it("limits daily API usage and sets the correct keys in redis", async function () {
      this.retries(3);
      // Make a new document in a free team site, currently the only real product which limits daily API usage.
      const freeTeamApi = home.makeUserApi('freeteam');
      const workspaceId = await getWorkspaceId(freeTeamApi, 'FreeTeamWs');
      const docId = await freeTeamApi.newDoc({name: 'TestDoc2'}, workspaceId);
      // Rather than making 5000 requests, set high counts directly for the current and next daily and hourly keys
      const used = 999999;
      let m = moment.utc();
      const currentDay = docPeriodicApiUsageKey(docId, true, docApiUsagePeriods[0], m);
      const currentHour = docPeriodicApiUsageKey(docId, true, docApiUsagePeriods[1], m);
      const nextDay = docPeriodicApiUsageKey(docId, false, docApiUsagePeriods[0], m);
      const nextHour = docPeriodicApiUsageKey(docId, false, docApiUsagePeriods[1], m);
      await redisClient.multi()
        .set(currentDay, String(used))
        .set(currentHour, String(used))
        .set(nextDay, String(used))
        .set(nextHour, String(used))
        .execAsync();

      // Make 9 requests. The first 4 should succeed by fitting into the allocation for the minute.
      // (Free team plans get 5000 requests per day, and 5000/24/60 ~= 3.47 which is rounded up to 4)
      // The last request should fail. Don't check the middle 4 in case we're on the boundary of a minute.
      for (let i = 1; i <= 9; i++) {
        const last = i === 9;
        m = moment.utc();  // get this before delaying to calculate accurate keys below
        const response = await axios.get(`${serverUrl}/api/docs/${docId}/tables/Table1/records`,
          chimpy);
        // Allow time for redis to be updated.
        await delay(100);
        if (i <= 4) {
          assert.equal(response.status, 200);
          // Keys of the periods we expect to be incremented.
          // For the first request, the server's usage cache is empty and it hasn't seen the redis values.
          // So it thinks there hasn't been any usage and increments the current day/hour.
          // After that it increments the next day/hour.
          // We're only checking this for the first 4 requests
          // because once the limit is exceeded the counts aren't incremented.
          const first = i === 1;
          const day = docPeriodicApiUsageKey(docId, first, docApiUsagePeriods[0], m);
          const hour = docPeriodicApiUsageKey(docId, first, docApiUsagePeriods[1], m);
          const minute = docPeriodicApiUsageKey(docId, true, docApiUsagePeriods[2], m);

          if (!first) {
            // The first request takes longer to serve because the document gets loaded,
            // so only check the TTL (which gets set before request processing starts) on subsequent requests.
            assert.deepEqual(
              await redisClient.multi()
                .ttl(minute)
                .ttl(hour)
                .ttl(day)
                .execAsync(),
              [
                2 * 60,
                2 * 60 * 60,
                2 * 60 * 60 * 24,
              ],
            );
          }

          assert.deepEqual(
            await redisClient.multi()
              .get(minute)
              .get(hour)
              .get(day)
              .execAsync(),
            [
              String(i),
              String(used + (first ? 1 : i - 1)),
              String(used + (first ? 1 : i - 1)),
            ],
          );
        }

        if (last) {
          assert.equal(response.status, 429);
          assert.deepEqual(response.data, {error: `Exceeded daily limit for document ${docId}`});
        }
      }
    });

    it("correctly allocates API requests based on the day, hour, and minute", async function () {
      const m = moment.utc("1999-12-31T23:59:59Z");
      const docId = "myDocId";
      const currentDay = docPeriodicApiUsageKey(docId, true, docApiUsagePeriods[0], m);
      const currentHour = docPeriodicApiUsageKey(docId, true, docApiUsagePeriods[1], m);
      const currentMinute = docPeriodicApiUsageKey(docId, true, docApiUsagePeriods[2], m);
      const nextDay = docPeriodicApiUsageKey(docId, false, docApiUsagePeriods[0], m);
      const nextHour = docPeriodicApiUsageKey(docId, false, docApiUsagePeriods[1], m);
      assert.equal(currentDay, `doc-myDocId-periodicApiUsage-1999-12-31`);
      assert.equal(currentHour, `doc-myDocId-periodicApiUsage-1999-12-31T23`);
      assert.equal(currentMinute, `doc-myDocId-periodicApiUsage-1999-12-31T23:59`);
      assert.equal(nextDay, `doc-myDocId-periodicApiUsage-2000-01-01`);
      assert.equal(nextHour, `doc-myDocId-periodicApiUsage-2000-01-01T00`);

      const usage = new LRUCache<string, number>({max: 1024});

      function check(expected: string[] | undefined) {
        assert.deepEqual(getDocApiUsageKeysToIncr(docId, usage, dailyMax, m), expected);
      }

      const dailyMax = 5000;
      const hourlyMax = 209;  // 5000/24    ~= 208.33
      const minuteMax = 4;    // 5000/24/60 ~= 3.47
      check([currentDay, currentHour, currentMinute]);
      usage.set(currentDay, dailyMax - 1);
      check([currentDay, currentHour, currentMinute]);
      usage.set(currentDay, dailyMax);
      check([nextDay, currentHour, currentMinute]);  // used up daily allocation
      usage.set(currentHour, hourlyMax - 1);
      check([nextDay, currentHour, currentMinute]);
      usage.set(currentHour, hourlyMax);
      check([nextDay, nextHour, currentMinute]);  // used up hourly allocation
      usage.set(currentMinute, minuteMax - 1);
      check([nextDay, nextHour, currentMinute]);
      usage.set(currentMinute, minuteMax);
      check(undefined);  // used up minutely allocation
      usage.set(currentDay, 0);
      check([currentDay, currentHour, currentMinute]);
      usage.set(currentDay, dailyMax);
      usage.set(currentHour, 0);
      check([nextDay, currentHour, currentMinute]);
    });

    after(async function () {
      if (process.env.TEST_REDIS_URL) {
        await redisClient.quitAsync();
      }
    });
  });

  describe("Webhooks", () => {
    let serving: Serving;  // manages the test webhook server

    let requests: WebhookRequests;

    let receivedLastEvent: Promise<void>;

    // Requests corresponding to adding 200 rows, sent in two batches of 100
    const expected200AddEvents = [
      _.range(100).map(i => ({
        id: 9 + i, manualSort: 9 + i, A3: 200 + i, B3: true,
      })),
      _.range(100).map(i => ({
        id: 109 + i, manualSort: 109 + i, A3: 300 + i, B3: true,
      })),
    ];

    // Every event is sent to three webhook URLs which differ by the subscribed eventTypes
    // Each request is an array of one or more events.
    // Multiple events caused by the same action bundle get batched into a single request.
    const expectedRequests: WebhookRequests = {
      "add": [
        [{id: 1, A: 1, B: true, C: null, manualSort: 1}],
        [{id: 2, A: 4, B: true, C: null, manualSort: 2}],

        // After isReady (B) went to false and then true again
        // we treat this as creation even though it's really an update
        [{id: 2, A: 7, B: true, C: null, manualSort: 2}],

        // From the big applies
        [{id: 3, A3: 13, B3: true, manualSort: 3},
          {id: 5, A3: 15, B3: true, manualSort: 5}],
        [{id: 7, A3: 18, B3: true, manualSort: 7}],

        ...expected200AddEvents,
      ],
      "update": [
        [{id: 2, A: 8, B: true, C: null, manualSort: 2}],

        // From the big applies
        [{id: 1, A3: 101, B3: true, manualSort: 1}],
      ],
      "add,update": [
        // add
        [{id: 1, A: 1, B: true, C: null, manualSort: 1}],
        [{id: 2, A: 4, B: true, C: null, manualSort: 2}],
        [{id: 2, A: 7, B: true, C: null, manualSort: 2}],

        // update
        [{id: 2, A: 8, B: true, C: null, manualSort: 2}],

        // from the big applies
        [{id: 1, A3: 101, B3: true, manualSort: 1},  // update
          {id: 3, A3: 13, B3: true, manualSort: 3},   // add
          {id: 5, A3: 15, B3: true, manualSort: 5}],  // add

        [{id: 7, A3: 18, B3: true, manualSort: 7}],  // add

        ...expected200AddEvents,
      ]
    };

    let redisMonitor: any;
    let redisCalls: any[];

    // Create couple of promises that can be used to monitor
    // if the endpoint was called.
    const successCalled = signal();
    const notFoundCalled = signal();
    const longStarted = signal();
    const longFinished = signal();
    // /probe endpoint will return this status when aborted.
    let probeStatus = 200;
    let probeMessage: string | null = "OK";

    // Create an abort controller for the latest request. We will
    // use it to abort the delay on the longEndpoint.
    let controller = new AbortController();

    async function autoSubscribe(
      endpoint: string, docId: string, options?: {
        tableId?: string,
        isReadyColumn?: string | null,
        eventTypes?: string[]
        watchedColIds?: string[],
      }) {
      // Subscribe helper that returns a method to unsubscribe.
      const data = await subscribe(endpoint, docId, options);
      return () => unsubscribe(docId, data, options?.tableId ?? 'Table1');
    }

    function unsubscribe(docId: string, data: any, tableId = 'Table1') {
      return axios.post(
        `${serverUrl}/api/docs/${docId}/tables/${tableId}/_unsubscribe`,
        data, chimpy
      );
    }

    async function subscribe(endpoint: string, docId: string, options?: {
      tableId?: string,
      isReadyColumn?: string|null,
      eventTypes?: string[],
      watchedColIds?: string[],
      name?: string,
      memo?: string,
      enabled?: boolean,
    }) {
      // Subscribe helper that returns a method to unsubscribe.
      const {data, status} = await axios.post(
        `${serverUrl}/api/docs/${docId}/tables/${options?.tableId ?? 'Table1'}/_subscribe`,
        {
          eventTypes: options?.eventTypes ?? ['add', 'update'],
          url: `${serving.url}/${endpoint}`,
          isReadyColumn: options?.isReadyColumn === undefined ? 'B' : options?.isReadyColumn,
          ...pick(options, 'name', 'memo', 'enabled', 'watchedColIds'),
        }, chimpy
      );
      assert.equal(status, 200);
      return data as WebhookSubscription;
    }

    async function clearQueue(docId: string) {
      const deleteResult = await axios.delete(
        `${serverUrl}/api/docs/${docId}/webhooks/queue`, chimpy
      );
      assert.equal(deleteResult.status, 200);
    }

    async function readStats(docId: string): Promise<WebhookSummary[]> {
      const result = await axios.get(
        `${serverUrl}/api/docs/${docId}/webhooks`, chimpy
      );
      assert.equal(result.status, 200);
      return result.data.webhooks;
    }

    before(async function () {
      this.timeout(30000);
      requests = {
        "add,update": [],
        "add": [],
        "update": [],
      };

      let resolveReceivedLastEvent: () => void;
      receivedLastEvent = new Promise<void>(r => {
        resolveReceivedLastEvent = r;
      });

      // TODO test retries on failure and slowness in a new test
      serving = await serveSomething(app => {
        app.use(express.json());
        app.post('/200', ({body}, res) => {
          successCalled.emit(body[0].A);
          res.sendStatus(200);
          res.end();
        });
        app.post('/404', ({body}, res) => {
          notFoundCalled.emit(body[0].A);
          // Webhooks treats it as an error and will retry. Probably it shouldn't work this way.
          res.sendStatus(404);
          res.end();
        });
        app.post('/probe', async ({body}, res) => {
          longStarted.emit(body.map((r: any) => r.A));
          // We are scoping the controller to this call, so any subsequent
          // call will have a new controller. Caller can save this value to abort the previous calls.
          const scoped = new AbortController();
          controller = scoped;
          try {
            await delayAbort(20000, scoped.signal); // We don't expect to wait for this, we should be aborted
            assert.fail('Should have been aborted');
          } catch (exc) {
            res.status(probeStatus);
            res.send(probeMessage);
            res.end();
            longFinished.emit(body.map((r: any) => r.A));
          }
        });
        app.post('/long', async ({body}, res) => {
          longStarted.emit(body[0].A);
          // We are scoping the controller to this call, so any subsequent
          // call will have a new controller. Caller can save this value to abort the previous calls.
          const scoped = new AbortController();
          controller = scoped;
          try {
            await delayAbort(20000, scoped.signal); // We don't expect to wait for this.
            res.sendStatus(200);
            res.end();
            longFinished.emit(body[0].A);
          } catch (exc) {
            res.sendStatus(200); // Send ok, so that it won't be seen as an error.
            res.end();
            longFinished.emit([408, body[0].A]); // We will signal that this is success but after aborting timeout.
          }
        });
        app.post('/:eventTypes', async ({body, params: {eventTypes}}, res) => {
          requests[eventTypes as keyof WebhookRequests].push(body);
          res.sendStatus(200);
          if (
            _.flattenDeep(_.values(requests)).length >=
            _.flattenDeep(_.values(expectedRequests)).length
          ) {
            resolveReceivedLastEvent();
          }
        });
      }, webhooksTestPort);
    });

    after(async function () {
      await serving.shutdown();
    });

    describe('table endpoints', function () {
      before(async function () {
        this.timeout(30000);
        // We rely on the REDIS server in this test.
        if (!process.env.TEST_REDIS_URL) {
          this.skip();
        }
        requests = {
          "add,update": [],
          "add": [],
          "update": [],
        };

        redisCalls = [];
        redisMonitor = createClient(process.env.TEST_REDIS_URL);
        redisMonitor.monitor();
        redisMonitor.on("monitor", (_time: any, args: any, _rawReply: any) => {
          redisCalls.push(args);
        });
      });

      after(async function () {
        if (process.env.TEST_REDIS_URL) {
          await redisMonitor.quitAsync();
        }
      });

      async function createWebhooks({docId, tableId, eventTypesSet, isReadyColumn, enabled}:
        {docId: string, tableId: string, eventTypesSet: string[][], isReadyColumn: string, enabled?: boolean}
      ) {
        // Ensure the isReady column is a Boolean
        await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
          ['ModifyColumn', tableId, isReadyColumn, {type: 'Bool'}],
        ], chimpy);

        const subscribeResponses = [];
        const webhookIds: Record<string, string> = {};

        for (const eventTypes of eventTypesSet) {
          const data = await subscribe(String(eventTypes), docId, {tableId, eventTypes, isReadyColumn, enabled});
          subscribeResponses.push(data);
          webhookIds[data.webhookId] = String(eventTypes);
        }
        return {subscribeResponses, webhookIds};
      }

      it("delivers expected payloads from combinations of changes, with retrying and batching",
        async function () {
        // Create a test document.
        const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
        const docId = await userApi.newDoc({name: 'testdoc'}, ws1);
        const doc = userApi.getDocAPI(docId);

        // Make a webhook for every combination of event types
        const {subscribeResponses, webhookIds} = await createWebhooks({
          docId, tableId: 'Table1', isReadyColumn: "B",
          eventTypesSet: [
            ["add"],
            ["update"],
            ["add", "update"],
          ]
        });

        // Add and update some rows, trigger some events
        // Values of A where B is true and thus the record is ready are [1, 4, 7, 8]
        // So those are the values seen in expectedEvents
        await doc.addRows("Table1", {
          A: [1, 2],
          B: [true, false], // 1  is ready, 2 is not ready yet
        });
        await doc.updateRows("Table1", {id: [2], A: [3]});  // still not ready
        await doc.updateRows("Table1", {id: [2], A: [4], B: [true]});  // ready!
        await doc.updateRows("Table1", {id: [2], A: [5], B: [false]});  // not ready again
        await doc.updateRows("Table1", {id: [2], A: [6]});  // still not ready
        await doc.updateRows("Table1", {id: [2], A: [7], B: [true]});  // ready!
        await doc.updateRows("Table1", {id: [2], A: [8]});  // still ready!

        // The end result here is additions for column A (now A3) with values [13, 15, 18]
        // and an update for 101
        await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
          ['BulkAddRecord', 'Table1', [3, 4, 5, 6], {A: [9, 10, 11, 12], B: [true, true, false, false]}],
          ['BulkUpdateRecord', 'Table1', [1, 2, 3, 4, 5, 6], {
            A: [101, 102, 13, 14, 15, 16],
            B: [true, false, true, false, true, false],
          }],

          ['RenameColumn', 'Table1', 'A', 'A3'],
          ['RenameColumn', 'Table1', 'B', 'B3'],

          ['RenameTable', 'Table1', 'Table12'],

          // FIXME a double rename A->A2->A3 doesn't seem to get summarised correctly
          // ['RenameColumn', 'Table12', 'A2', 'A3'],
          // ['RenameColumn', 'Table12', 'B2', 'B3'],

          ['RemoveColumn', 'Table12', 'C'],
        ], chimpy);

        // FIXME record changes after a RenameTable in the same bundle
        //  don't appear in the action summary
        await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
          ['AddRecord', 'Table12', 7, {A3: 17, B3: false}],
          ['UpdateRecord', 'Table12', 7, {A3: 18, B3: true}],

          ['AddRecord', 'Table12', 8, {A3: 19, B3: true}],
          ['UpdateRecord', 'Table12', 8, {A3: 20, B3: false}],

          ['AddRecord', 'Table12', 9, {A3: 20, B3: true}],
          ['RemoveRecord', 'Table12', 9],
        ], chimpy);

        // Add 200 rows. These become the `expected200AddEvents`
        await doc.addRows("Table12", {
          A3: _.range(200, 400),
          B3: arrayRepeat(200, true),
        });

        await receivedLastEvent;

        // Unsubscribe
        await Promise.all(subscribeResponses.map(async subscribeResponse => {
          const unsubscribeResponse = await axios.post(
            `${serverUrl}/api/docs/${docId}/tables/Table12/_unsubscribe`,
            subscribeResponse, chimpy
          );
          assert.equal(unsubscribeResponse.status, 200);
          assert.deepEqual(unsubscribeResponse.data, {success: true});
        }));

        // Further changes should generate no events because the triggers are gone
        await doc.addRows("Table12", {
          A3: [88, 99],
          B3: [true, false],
        });

        assert.deepEqual(requests, expectedRequests);

        // Check that the events were all pushed to the redis queue
        const queueRedisCalls = redisCalls.filter(args => args[1] === "webhook-queue-" + docId);
        const redisPushes = _.chain(queueRedisCalls)
          .filter(args => args[0] === "rpush")          // Array<["rpush", key, ...events: string[]]>
          .flatMap(args => args.slice(2))               // events: string[]
          .map(JSON.parse)                              // events: WebhookEvent[]
          .groupBy('id')                                // {[webHookId: string]: WebhookEvent[]}
          .mapKeys((_value, key) => webhookIds[key])    // {[eventTypes: 'add'|'update'|'add,update']: WebhookEvent[]}
          .mapValues(group => _.map(group, 'payload'))  // {[eventTypes: 'add'|'update'|'add,update']: RowRecord[]}
          .value();
        const expectedPushes = _.mapValues(expectedRequests, value => _.flatten(value));
        assert.deepEqual(redisPushes, expectedPushes);

        // Check that the events were all removed from the redis queue
        const redisTrims = queueRedisCalls.filter(args => args[0] === "ltrim")
          .map(([, , start, end]) => {
            assert.equal(end, '-1');
            start = Number(start);
            assert.isTrue(start > 0);
            return start;
          });
        const expectedTrims = Object.values(redisPushes).map(value => value.length);
        assert.equal(
          _.sum(redisTrims),
          _.sum(expectedTrims),
        );

      });

      [{
        itMsg: "doesn't trigger webhook that has been disabled",
        enabled: false,
      }, {
        itMsg: "does trigger webhook that has been enable",
        enabled: true,
      }].forEach((ctx) => {

        it(ctx.itMsg, async function () {
          // Create a test document.
          const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
          const docId = await userApi.newDoc({name: 'testdoc'}, ws1);
          const doc = userApi.getDocAPI(docId);

          await createWebhooks({
            docId, tableId: 'Table1', isReadyColumn: "B", eventTypesSet: [ ["add"] ], enabled: ctx.enabled
          });

          await doc.addRows("Table1", {
            A: [42],
            B: [true]
          });

          const queueRedisCalls = redisCalls.filter(args => args[1] === "webhook-queue-" + docId);
          const redisPushIndex = queueRedisCalls.findIndex(args => args[0] === "rpush");

          if (ctx.enabled) {
            assert.isAbove(redisPushIndex, 0, "Should have pushed events to the redis queue");
          } else {
            assert.equal(redisPushIndex, -1, "Should not have pushed any events to the redis queue");
          }
        });

      });
    });

    describe("/webhooks endpoint", function () {
      let docId: string;
      let doc: DocAPI;
      let stats: WebhookSummary[];
      before(async function () {
        // Create a test document.
        const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
        docId = await userApi.newDoc({name: 'testdoc2'}, ws1);
        doc = userApi.getDocAPI(docId);
        await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
          ['ModifyColumn', 'Table1', 'B', {type: 'Bool'}],
        ], chimpy);
        await userApi.applyUserActions(docId, [['AddTable', 'Table2', [{id: 'Foo'}, {id: 'Bar'}]]]);
      });

      const waitForQueue = async (length: number) => {
        await waitForIt(async () => {
          stats = await readStats(docId);
          assert.equal(length, _.sum(stats.map(x => x.usage?.numWaiting ?? 0)));
        }, 1000, 200);
      };

      it("should clear the outgoing queue", async () => {
        // Create a test document.
        const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
        const docId = await userApi.newDoc({name: 'testdoc2'}, ws1);
        const doc = userApi.getDocAPI(docId);
        await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
          ['ModifyColumn', 'Table1', 'B', {type: 'Bool'}],
        ], chimpy);

        // Try to clear the queue, even if it is empty.
        await clearQueue(docId);

        const cleanup: (() => Promise<any>)[] = [];

        // Subscribe a valid webhook endpoint.
        cleanup.push(await autoSubscribe('200', docId));
        // Subscribe an invalid webhook endpoint.
        cleanup.push(await autoSubscribe('404', docId));

        // Prepare signals, we will be waiting for those two to be called.
        successCalled.reset();
        notFoundCalled.reset();
        // Trigger both events.
        await doc.addRows("Table1", {
          A: [1],
          B: [true],
        });

        // Wait for both of them to be called (this is correct order)
        await successCalled.waitAndReset();
        await notFoundCalled.waitAndReset();

        // Broken endpoint will be called multiple times here, and any subsequent triggers for working
        // endpoint won't be called.
        await notFoundCalled.waitAndReset();

        // But the working endpoint won't be called more then once.
        assert.isFalse(successCalled.called());

        // Trigger second event.
        await doc.addRows("Table1", {
          A: [2],
          B: [true],
        });
        // Error endpoint will be called with the first row (still).
        const firstRow = await notFoundCalled.waitAndReset();
        assert.deepEqual(firstRow, 1);

        // But the working endpoint won't be called till we reset the queue.
        assert.isFalse(successCalled.called());

        // Now reset the queue.
        await clearQueue(docId);

        assert.isFalse(successCalled.called());
        assert.isFalse(notFoundCalled.called());

        // Prepare for new calls.
        successCalled.reset();
        notFoundCalled.reset();
        // Trigger them.
        await doc.addRows("Table1", {
          A: [3],
          B: [true],
        });
        // We will receive data from the 3rd row only (the second one was omitted).
        let thirdRow = await successCalled.waitAndReset();
        assert.deepEqual(thirdRow, 3);
        thirdRow = await notFoundCalled.waitAndReset();
        assert.deepEqual(thirdRow, 3);
        // And the situation will be the same, the working endpoint won't be called till we reset the queue, but
        // the error endpoint will be called with the third row multiple times.
        await notFoundCalled.waitAndReset();
        assert.isFalse(successCalled.called());

        // Cleanup everything, we will now test request timeouts.
        await Promise.all(cleanup.map(fn => fn())).finally(() => cleanup.length = 0);
        await clearQueue(docId);

        // Create 2 webhooks, one that is very long.
        cleanup.push(await autoSubscribe('200', docId));
        cleanup.push(await autoSubscribe('long', docId));
        successCalled.reset();
        longFinished.reset();
        longStarted.reset();
        // Trigger them.
        await doc.addRows("Table1", {
          A: [4],
          B: [true],
        });
        // 200 will be called immediately.
        await successCalled.waitAndReset();
        // Long will be started immediately.
        await longStarted.waitAndReset();
        // But it won't be finished.
        assert.isFalse(longFinished.called());
        // It will be aborted.
        controller.abort();
        assert.deepEqual(await longFinished.waitAndReset(), [408, 4]);

        // Trigger another event.
        await doc.addRows("Table1", {
          A: [5],
          B: [true],
        });
        // We are stuck once again on the long call. But this time we won't
        // abort it till the end of this test.
        assert.deepEqual(await successCalled.waitAndReset(), 5);
        assert.deepEqual(await longStarted.waitAndReset(), 5);
        assert.isFalse(longFinished.called());

        // Remember this controller for cleanup.
        const controller5 = controller;
        // Trigger another event.
        await doc.addRows("Table1", {
          A: [6],
          B: [true],
        });
        // We are now completely stuck on the 5th row webhook.
        assert.isFalse(successCalled.called());
        assert.isFalse(longFinished.called());
        // Clear the queue, it will free webhooks requests, but it won't cancel long handler on the external server
        // so it is still waiting.
        assert.isTrue((await axios.delete(
          `${serverUrl}/api/docs/${docId}/webhooks/queue`, chimpy
        )).status === 200);
        // Now we can release the stuck request.
        controller5.abort();
        // We will be cancelled from the 5th row.
        assert.deepEqual(await longFinished.waitAndReset(), [408, 5]);

        // We won't be called for the 6th row at all, as it was stuck and the queue was purged.
        assert.isFalse(successCalled.called());
        assert.isFalse(longStarted.called());

        // Trigger next event.
        await doc.addRows("Table1", {
          A: [7],
          B: [true],
        });
        // We will be called once again with a new 7th row.
        assert.deepEqual(await successCalled.waitAndReset(), 7);
        assert.deepEqual(await longStarted.waitAndReset(), 7);
        // But we are stuck again.
        assert.isFalse(longFinished.called());
        // And we can abort current request from 7th row (6th row was skipped).
        controller.abort();
        assert.deepEqual(await longFinished.waitAndReset(), [408, 7]);

        // Cleanup all
        await Promise.all(cleanup.map(fn => fn())).finally(() => cleanup.length = 0);
        await clearQueue(docId);
      });

      it("should not call to a deleted webhook", async () => {
        // Create a test document.
        const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
        const docId = await userApi.newDoc({name: 'testdoc4'}, ws1);
        const doc = userApi.getDocAPI(docId);
        await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
          ['ModifyColumn', 'Table1', 'B', {type: 'Bool'}],
        ], chimpy);

        // Subscribe to 2 webhooks, we will remove the second one.
        const webhook1 = await autoSubscribe('probe', docId);
        const webhook2 = await autoSubscribe('200', docId);

        probeStatus = 200;
        successCalled.reset();
        longFinished.reset();
        // Trigger them.
        await doc.addRows("Table1", {
          A: [1],
          B: [true],
        });

        // Wait for the first one to be called.
        await longStarted.waitAndReset();
        // Now why we are on the call remove the second one.
        // Check that it is queued.
        const stats = await readStats(docId);
        assert.equal(2, _.sum(stats.map(x => x.usage?.numWaiting ?? 0)));
        await webhook2();
        // Let the first one finish.
        controller.abort();
        await longFinished.waitAndReset();
        // The second one is not called.
        assert.isFalse(successCalled.called());
        // Triggering next event, we will get only calls to the probe (first webhook).
        await doc.addRows("Table1", {
          A: [2],
          B: [true],
        });
        await longStarted.waitAndReset();
        controller.abort();
        await longFinished.waitAndReset();

        // Unsubscribe.
        await webhook1();
      });

      it("should call to a webhook only when columns updated are in watchedColIds if not empty", async () => {  // eslint-disable-line max-len
        // Create a test document.
        const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
        const docId = await userApi.newDoc({ name: 'testdoc5' }, ws1);
        const doc = userApi.getDocAPI(docId);
        await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
          ['ModifyColumn', 'Table1', 'B', { type: 'Bool' }],
        ], chimpy);

        const modifyColumn = async (newValues: { [key: string]: any; } ) => {
          await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
            ['UpdateRecord', 'Table1', newRowIds[0], newValues],
          ], chimpy);
          await delay(100);
        };
        const assertSuccessNotCalled = async () => {
          assert.isFalse(successCalled.called());
          successCalled.reset();
        };
        const assertSuccessCalled = async () => {
          assert.isTrue(successCalled.called());
          await successCalled.waitAndReset();
        };

        // Webhook with only one watchedColId.
        const webhook1 = await autoSubscribe('200', docId, {
          watchedColIds: ['A'], eventTypes: ['add', 'update']
        });
        successCalled.reset();
        // Create record, that will call the webhook.
        const newRowIds = await doc.addRows("Table1", {
          A: [2],
          B: [true],
          C: ['c1']
        });
        await delay(100);
        assert.isTrue(successCalled.called());
        await successCalled.waitAndReset();
        await modifyColumn({ C: 'c2' });
        await assertSuccessNotCalled();
        await modifyColumn({ A: 19 });
        await assertSuccessCalled();
        await webhook1(); // Unsubscribe.

        // Webhook with multiple watchedColIds
        const webhook2 = await autoSubscribe('200', docId, {
          watchedColIds: ['A', 'B'], eventTypes: ['update']
        });
        successCalled.reset();
        await modifyColumn({ C: 'c3' });
        await assertSuccessNotCalled();
        await modifyColumn({ A: 20 });
        await assertSuccessCalled();
        await webhook2();

        // Check that empty string in watchedColIds are ignored
        const webhook3 = await autoSubscribe('200', docId, {
          watchedColIds: ['A', ""], eventTypes: ['update']
        });
        await modifyColumn({ C: 'c4' });
        await assertSuccessNotCalled();
        await modifyColumn({ A: 21 });
        await assertSuccessCalled();
        await webhook3();
      });

      it("should return statistics", async () => {
        await clearQueue(docId);
        // Read stats, it should be empty.
        assert.deepEqual(await readStats(docId), []);
        // Now subscribe couple of webhooks.
        const first = await subscribe('200', docId);
        const second = await subscribe('404', docId);
        // And compare stats.
        assert.deepEqual(await readStats(docId), [
          {
            id: first.webhookId,
            fields: {
              url: `${serving.url}/200`,
              unsubscribeKey: first.unsubscribeKey,
              eventTypes: ['add', 'update'],
              enabled: true,
              isReadyColumn: 'B',
              tableId: 'Table1',
              name: '',
              memo: '',
              watchedColIds: [],
            }, usage : {
              status: 'idle',
              numWaiting: 0,
              lastEventBatch: null
            }
          },
          {
            id: second.webhookId,
            fields: {
              url: `${serving.url}/404`,
              unsubscribeKey: second.unsubscribeKey,
              eventTypes: ['add', 'update'],
              enabled: true,
              isReadyColumn: 'B',
              tableId: 'Table1',
              name: '',
              memo: '',
              watchedColIds: [],
            }, usage : {
              status: 'idle',
              numWaiting: 0,
              lastEventBatch: null
            }
          },
        ]);

        // We should be able to unsubscribe using info that we got.
        await unsubscribe(docId, first);
        await unsubscribe(docId, second);
        assert.deepEqual(await readStats(docId), []);

        // Test that stats work when there is no ready column.
        let unsubscribe1 = await autoSubscribe('200', docId, {isReadyColumn: null});
        assert.isNull((await readStats(docId))[0].fields.isReadyColumn);
        await unsubscribe1();

        // Now test that we receive some useful information and the state transition works.
        unsubscribe1 = await autoSubscribe('probe', docId);
        // Test also dates update.
        let now = Date.now();
        // Webhook starts as idle (tested already). Now we will trigger it.
        longStarted.reset();
        longFinished.reset();
        await doc.addRows("Table1", {
          A: [1],
          B: [true],
        });
        // It will call our probe endpoint, so we will be able to see changes as they happen.
        await longStarted.waitAndReset();
        stats = await readStats(docId);
        assert.isNotNull(stats[0].usage);
        assert.equal(stats[0].usage?.numWaiting, 1);
        assert.equal(stats[0].usage?.status, 'sending');
        assert.isNotNull(stats[0].usage?.updatedTime);
        assert.isAbove(stats[0].usage?.updatedTime ?? 0, now);
        assert.isNull(stats[0].usage?.lastErrorMessage);
        assert.isNull(stats[0].usage?.lastSuccessTime);
        assert.isNull(stats[0].usage?.lastFailureTime);
        assert.isNull(stats[0].usage?.lastHttpStatus);
        assert.isNull(stats[0].usage?.lastEventBatch);
        // Ok, we can return success now.
        probeStatus = 200;
        controller.abort();
        await longFinished.waitAndReset();
        // After releasing the hook, we are not 100% sure stats are updated, so we will wait a bit.
        // If we are checking stats while we are holding the hook (in the probe endpoint) it is safe
        // to assume that stats are up to date.
        await waitForIt(async () => {
          stats = await readStats(docId);
          assert.equal(stats[0].usage?.numWaiting, 0);
        }, 1000, 200);
        assert.equal(stats[0].usage?.numWaiting, 0);
        assert.equal(stats[0].usage?.status, 'idle');
        assert.isAtLeast(stats[0].usage?.updatedTime ?? 0, now);
        assert.isNull(stats[0].usage?.lastErrorMessage);
        assert.isNull(stats[0].usage?.lastFailureTime);
        assert.equal(stats[0].usage?.lastHttpStatus, 200);
        assert.isAtLeast(stats[0].usage?.lastSuccessTime ?? 0, now);
        assert.deepEqual(stats[0].usage?.lastEventBatch, {
          status: 'success',
          attempts: 1,
          size: 1,
          errorMessage: null,
          httpStatus: 200,
        });

        // Now trigger the endpoint once again.
        now = Date.now();
        await doc.addRows("Table1", {
          A: [2],
          B: [true],
        });
        await longStarted.waitAndReset();
        // This time, return an error, so we will have another attempt.
        probeStatus = 404;
        probeMessage = null;
        controller.abort();
        await longFinished.waitAndReset();
        // Wait for the second attempt.
        await longStarted.waitAndReset();
        stats = await readStats(docId);
        assert.equal(stats[0].usage?.numWaiting, 1);
        assert.equal(stats[0].usage?.status, 'retrying');
        assert.isAtLeast(stats[0].usage?.updatedTime ?? 0, now);
        // There was no body in the response yet.
        assert.isNull(stats[0].usage?.lastErrorMessage);
        // Now we have a failure, and the success was before.
        assert.isAtLeast(stats[0].usage?.lastFailureTime ?? 0, now);
        assert.isBelow(stats[0].usage?.lastSuccessTime ?? 0, now);
        assert.equal(stats[0].usage?.lastHttpStatus, 404);
        // Batch contains info about last attempt.
        assert.deepEqual(stats[0].usage?.lastEventBatch, {
          status: 'failure',
          attempts: 1,
          size: 1,
          errorMessage: null,
          httpStatus: 404,
        });
        // Now make an error with some message.
        probeStatus = 500;
        probeMessage = 'Some error';
        controller.abort();
        await longFinished.waitAndReset();
        await longStarted.waitAndReset();
        // We have 3rd attempt, with an error message.
        stats = await readStats(docId);
        assert.equal(stats[0].usage?.numWaiting, 1);
        assert.equal(stats[0].usage?.status, 'retrying');
        assert.equal(stats[0].usage?.lastHttpStatus, 500);
        assert.equal(stats[0].usage?.lastErrorMessage, probeMessage);
        assert.deepEqual(stats[0].usage?.lastEventBatch, {
          status: 'failure',
          attempts: 2,
          size: 1,
          errorMessage: probeMessage,
          httpStatus: 500,
        });
        // Now we will succeed.
        probeStatus = 200;
        controller.abort();
        await longFinished.waitAndReset();
        // Give it some time to update stats.
        await waitForIt(async () => {
          stats = await readStats(docId);
          assert.equal(stats[0].usage?.numWaiting, 0);
        }, 1000, 200);
        stats = await readStats(docId);
        assert.equal(stats[0].usage?.numWaiting, 0);
        assert.equal(stats[0].usage?.status, 'idle');
        assert.equal(stats[0].usage?.lastHttpStatus, 200);
        assert.equal(stats[0].usage?.lastErrorMessage, probeMessage);
        assert.isAtLeast(stats[0].usage?.lastFailureTime ?? 0, now);
        assert.isAtLeast(stats[0].usage?.lastSuccessTime ?? 0, now);
        assert.deepEqual(stats[0].usage?.lastEventBatch, {
          status: 'success',
          attempts: 3,
          size: 1,
          // Errors are cleared.
          errorMessage: null,
          httpStatus: 200,
        });
        // Clear everything.
        await clearQueue(docId);
        stats = await readStats(docId);
        assert.isNotNull(stats[0].usage);
        assert.equal(stats[0].usage?.numWaiting, 0);
        assert.equal(stats[0].usage?.status, 'idle');
        // Now pile some events with two webhooks to the probe.
        const unsubscribe2 = await autoSubscribe('probe', docId);
        await doc.addRows("Table1", {
          A: [3],
          B: [true],
        });
        await doc.addRows("Table1", {
          A: [4],
          B: [true],
        });
        await doc.addRows("Table1", {
          A: [5],
          B: [true],
        });
        assert.deepEqual(await longStarted.waitAndReset(), [3]);
        stats = await readStats(docId);
        assert.lengthOf(stats, 2);
        // First one is pending and second one didn't have a chance to be executed yet.
        assert.equal(stats[0].usage?.status, 'sending');
        assert.equal(stats[1].usage?.status, 'idle');
        assert.isNull(stats[0].usage?.lastEventBatch);
        assert.isNull(stats[1].usage?.lastEventBatch);
        assert.equal(6, _.sum(stats.map(x => x.usage?.numWaiting ?? 0)));
        // Now let them finish in deterministic order.
        controller.abort();
        assert.deepEqual(await longFinished.waitAndReset(), [3]);
        // We had 6 events to go, we've just finished the first one.
        const nextPass = async (length: number, A: number) => {
          assert.deepEqual(await longStarted.waitAndReset(), [A]);
          stats = await readStats(docId);
          assert.equal(length, _.sum(stats.map(x => x.usage?.numWaiting ?? 0)));
          controller.abort();
          assert.deepEqual(await longFinished.waitAndReset(), [A]);
        };
        // Now we have 5 events to go.
        await nextPass(5, 3);
        await nextPass(4, 4);
        await nextPass(3, 4);
        await nextPass(2, 5);
        await nextPass(1, 5);

        await waitForQueue(0);
        await unsubscribe2();
        await unsubscribe1();
      });

      it('should not block document load (gh issue #799)', async function () {
        // Create a test document.
        const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
        const docId = await userApi.newDoc({name: 'testdoc5'}, ws1);
        const doc = userApi.getDocAPI(docId);
        // Before #799, formula of this type would block document load because of a deadlock
        // and make this test fail.
        const formulaEvaluatedAtDocLoad = 'NOW()';

        await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
          ['ModifyColumn', 'Table1', 'C', {isFormula: true, formula: formulaEvaluatedAtDocLoad}],
        ], chimpy);

        const unsubscribeWebhook1 = await autoSubscribe('probe', docId);

        // Create a first row.
        await doc.addRows("Table1", {
          A: [1],
        });

        await doc.forceReload();

        // Create a second row after document reload.
        // This should not timeout.
        await doc.addRows("Table1", {
          A: [2],
        });

        await unsubscribeWebhook1();
      });

      it("should monitor failures", async () => {
        const webhook3 = await subscribe('probe', docId);
        const webhook4 = await subscribe('probe', docId);
        // Now we have two webhooks, both will fail, but the first one will
        // be put in the idle state and server will start to send the second one.
        probeStatus = 509;
        probeMessage = "fail";
        await doc.addRows("Table1", {
          A: [5],
          B: [true],
        });

        const pass = async () => {
          await longStarted.waitAndReset();
          controller.abort();
          await longFinished.waitAndReset();
        };
        // Server will retry this 4 times (GRIST_TRIGGER_MAX_ATTEMPTS = 4)
        await pass();
        await pass();
        await pass();
        await pass();
        // And will fail, next it will call the second webhook.
        await longStarted.waitAndReset();
        // Hold it a bit (by not aborting).

        // Read stats, first one is idle and has an error message, second one is active.
        // (We don't need to wait - stats are up to date since triggers are waiting for us).
        stats = await readStats(docId);
        assert.equal(stats.length, 2);
        assert.equal(stats[0].id, webhook3.webhookId);
        assert.equal(stats[1].id, webhook4.webhookId);
        assert.equal(stats[0].usage?.status, 'postponed');
        assert.equal(stats[1].usage?.status, 'sending');
        assert.equal(stats[0].usage?.numWaiting, 1);
        assert.equal(stats[1].usage?.numWaiting, 1);
        assert.equal(stats[0].usage?.lastErrorMessage, probeMessage);
        assert.equal(stats[0].usage?.lastHttpStatus, 509);
        assert.equal(stats[0].usage?.lastEventBatch?.status, "failure");
        assert.isNull(stats[1].usage?.lastErrorMessage);

        // We will now drain the queue, using the second webhook.
        // First webhook is postponed, and the second is waiting for us. We have 2 events in total.
        // To drain the queue, and cause this webhook to fail we will need to generate 10 more events,
        // max queue since is 10, but if we generate exactly 10 events it will not work
        // as the queue size will be 9 when the triggers decide to reject them.
        await waitForQueue(2);
        const addRowProm = doc.addRows("Table1", {
          A: arrayRepeat(5, 100), // there are 2 webhooks, so 5 events per webhook.
          B: arrayRepeat(5, true)
        }).catch(() => {
        });
        // WARNING: we can't wait for it, as the Webhooks will literally stop the document, and wait
        // for the queue to drain. So we will carefully go further, and wait for the queue to drain.

        // It will try 4 times before giving up (the first call is in progress)
        probeStatus = 429;
        // First.
        controller.abort();
        await longFinished.waitAndReset();
        // Second and third.
        await pass();
        await pass();

        // Before the last one, we will wait for the add rows operation but in a different way.
        // We will count how many webhook events were added so far, we should have 10 in total.
        await waitForQueue(12);
        // We are good to go, after trying for the 4th time it will gave up and remove this
        // event from the queue.
        await pass();

        // Wait for the first webhook to start.
        await longStarted.waitAndReset();

        // And make sure we have info about rejected batch.
        stats = await readStats(docId);
        assert.equal(stats.length, 2);
        assert.equal(stats[0].id, webhook3.webhookId);
        assert.equal(stats[0].usage?.status, 'sending');
        assert.equal(stats[0].usage?.numWaiting, 6);
        assert.equal(stats[0].usage?.lastErrorMessage, probeMessage);
        assert.equal(stats[0].usage?.lastHttpStatus, 509);

        assert.equal(stats[1].id, webhook4.webhookId);
        assert.equal(stats[1].usage?.status, 'error'); // webhook is in error state, some events were lost.
        assert.equal(stats[1].usage?.lastEventBatch?.status, "rejected");
        assert.equal(stats[1].usage?.numWaiting, 5); // We skipped one event.

        // Now unfreeze document by handling all events (they are aligned so will be handled in just 2 batches, first
        // one is already waiting in our /probe endpoint).
        probeStatus = 200;
        controller.abort();
        await longFinished.waitAndReset();
        await pass();
        await waitForQueue(0);

        // Now can wait for the rows to process.
        await addRowProm;
        await unsubscribe(docId, webhook3);
        await unsubscribe(docId, webhook4);
      });

      describe('webhook update', function () {

        it('should work correctly', async function () {
          async function check(fields: any, status: number, error?: RegExp | string,
                               expectedFieldsCallback?: (fields: any) => any) {

            const origFields = {
              tableId: 'Table1',
              eventTypes: ['add'],
              isReadyColumn: 'B',
              name: 'My Webhook',
              memo: 'Sync store',
              watchedColIds: ['A']
            };

            // subscribe
            const {data} = await axios.post(
              `${serverUrl}/api/docs/${docId}/webhooks`,
              {
                webhooks: [{
                  fields: {
                    ...origFields,
                    url: `${serving.url}/foo`
                  }
                }]
              }, chimpy
            );
            const webhooks = data;

            const expectedFields = {
              url: `${serving.url}/foo`,
              eventTypes: ['add'],
              isReadyColumn: 'B',
              tableId: 'Table1',
              enabled: true,
              name: 'My Webhook',
              memo: 'Sync store',
              watchedColIds: ['A'],
            };

            let stats = await readStats(docId);
            assert.equal(stats.length, 1, 'stats=' + JSON.stringify(stats));
            assert.equal(stats[0].id, webhooks.webhooks[0].id);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const {unsubscribeKey, ...fieldsWithoutUnsubscribeKey} = stats[0].fields;
            assert.deepEqual(fieldsWithoutUnsubscribeKey, expectedFields);

            // update
            const resp = await axios.patch(
              `${serverUrl}/api/docs/${docId}/webhooks/${webhooks.webhooks[0].id}`, fields, chimpy
            );

            // check resp
            assert.equal(resp.status, status, JSON.stringify(pick(resp, ['data', 'status'])));
            if (resp.status === 200) {
              stats = await readStats(docId);
              assert.equal(stats.length, 1);
              assert.equal(stats[0].id, webhooks.webhooks[0].id);
              if (expectedFieldsCallback) {
                expectedFieldsCallback(expectedFields);
              }
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const {unsubscribeKey, ...fieldsWithoutUnsubscribeKey} = stats[0].fields;
              assert.deepEqual(fieldsWithoutUnsubscribeKey, { ...expectedFields, ...fields });
            } else {
              if (error instanceof RegExp) {
                assert.match(resp.data.details?.userError || resp.data.error, error);
              } else {
                assert.deepEqual(resp.data, {error});
              }
            }

            // finally  unsubscribe
            const unsubscribeResp = await axios.delete(
              `${serverUrl}/api/docs/${docId}/webhooks/${webhooks.webhooks[0].id}`, chimpy
            );
            assert.equal(unsubscribeResp.status, 200, JSON.stringify(pick(unsubscribeResp, ['data', 'status'])));
            stats = await readStats(docId);
            assert.equal(stats.length, 0, 'stats=' + JSON.stringify(stats));
          }

          await check({url: `${serving.url}/bar`}, 200);
          await check({url: "https://evil.com"}, 403, "Provided url is forbidden");
          await check({url: "http://example.com"}, 403, "Provided url is forbidden");  // not https

          // changing table without changing the ready column should reset the latter
          await check({tableId: 'Table2'}, 200, '', expectedFields => {
            expectedFields.isReadyColumn = null;
            expectedFields.watchedColIds = [];
          });

          await check({tableId: 'Santa'}, 404, `Table not found "Santa"`);
          await check({tableId: 'Table2', isReadyColumn: 'Foo', watchedColIds: []}, 200);

          await check({eventTypes: ['add', 'update']}, 200);
          await check({eventTypes: []}, 400, "eventTypes must be a non-empty array");
          await check({eventTypes: ["foo"]}, 400, /eventTypes\[0] is none of "add", "update"/);

          await check({isReadyColumn: null}, 200);
          await check({isReadyColumn: "bar"}, 404, `Column not found "bar"`);
        });

      });
    });
  });

  describe("Allowed Origin", () => {
    it("should respond with correct CORS headers", async function () {
      const wid = await getWorkspaceId(userApi, 'Private');
      const docId = await userApi.newDoc({name: 'CorsTestDoc'}, wid);
      await userApi.updateDocPermissions(docId, {
        users: {
          'everyone@getgrist.com': 'owners',
        }
      });

      const chimpyConfig = makeConfig("Chimpy");
      const anonConfig = makeConfig("Anonymous");
      delete chimpyConfig.headers!["X-Requested-With"];
      delete anonConfig.headers!["X-Requested-With"];

      let allowedOrigin;

      // Target a more realistic Host than "localhost:port"
      // (if behind a proxy, we already benefit from a custom and realistic host).
      if (!home.proxiedServer) {
        anonConfig.headers!.Host = chimpyConfig.headers!.Host =
          'api.example.com';
        allowedOrigin = 'http://front.example.com';
      } else {
        allowedOrigin = serverUrl;
      }

      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      const data = { records: [{ fields: {} }] };

      const forbiddenOrigin = 'http://evil.com';

      // Normal same origin requests
      anonConfig.headers!.Origin = allowedOrigin;
      let response: AxiosResponse;
      for (response of [
        await axios.post(url, data, anonConfig),
        await axios.get(url, anonConfig),
        await axios.options(url, anonConfig),
      ]) {
        assert.equal(response.status, 200);
        assert.equal(response.headers['access-control-allow-methods'], 'GET, PATCH, PUT, POST, DELETE, OPTIONS');
        assert.equal(response.headers['access-control-allow-headers'], 'Authorization, Content-Type, X-Requested-With');
        assert.equal(response.headers['access-control-allow-origin'], allowedOrigin);
        assert.equal(response.headers['access-control-allow-credentials'], 'true');
      }

      // Cross origin requests from untrusted origin.
      for (const config of [anonConfig, chimpyConfig]) {
        config.headers!.Origin = forbiddenOrigin;
        for (response of [
          await axios.post(url, data, config),
          await axios.get(url, config),
          await axios.options(url, config),
        ]) {
          if (config === anonConfig) {
            // Requests without credentials are still OK.
            assert.equal(response.status, 200);
          } else {
            assert.equal(response.status, 403);
            assert.deepEqual(response.data, {error: 'Credentials not supported for cross-origin requests'});
          }
          assert.equal(response.headers['access-control-allow-methods'], 'GET, PATCH, PUT, POST, DELETE, OPTIONS');
          // Authorization header is not allowed
          assert.equal(response.headers['access-control-allow-headers'], 'Content-Type, X-Requested-With');
          // Origin is not echoed back. Arbitrary origin is allowed, but credentials are not.
          assert.equal(response.headers['access-control-allow-origin'], '*');
          assert.equal(response.headers['access-control-allow-credentials'], undefined);
        }
      }

      // POST requests without credentials require a custom header so that a CORS preflight request is triggered.
      // One possible header is X-Requested-With, which we removed at the start of the test.
      // The other is Content-Type: application/json, which we have been using implicitly above because axios
      // automatically treats the given data object as data. Passing a string instead prevents this.
      response = await axios.post(url, JSON.stringify(data), anonConfig);
      assert.equal(response.status, 401);
      assert.deepEqual(response.data, {
        error: "Unauthenticated requests require one of the headers" +
          "'Content-Type: application/json' or 'X-Requested-With: XMLHttpRequest'"
      });

      // ^ that's for requests without credentials, otherwise we get the same 403 as earlier.
      response = await axios.post(url, JSON.stringify(data), chimpyConfig);
      assert.equal(response.status, 403);
      assert.deepEqual(response.data, {error: 'Credentials not supported for cross-origin requests'});
    });

  });


  it ("GET /docs/{did}/sql is functional", async function () {
    const query = 'select+*+from+Table1+order+by+id';
    const resp = await axios.get(`${homeUrl}/api/docs/${docIds.Timesheets}/sql?q=${query}`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      statement: 'select * from Table1 order by id',
      records: [
        {
          fields: {
            id: 1,
            manualSort: 1,
            A: 'hello',
            B: '',
            C: '',
            D: null,
            E: 'HELLO'
          },
        },
        {
          fields: { id: 2, manualSort: 2, A: '', B: 'world', C: '', D: null, E: '' }
        },
        {
          fields: { id: 3, manualSort: 3, A: '', B: '', C: '', D: null, E: '' }
        },
        {
          fields: { id: 4, manualSort: 4, A: '', B: '', C: '', D: null, E: '' }
        },
      ]
    });
  });

  it ("POST /docs/{did}/sql is functional", async function () {
    let resp = await axios.post(
      `${homeUrl}/api/docs/${docIds.Timesheets}/sql`,
      { sql: "select A from Table1 where id = ?", args: [ 1 ] },
      chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data.records, [{
      fields: {
        A: 'hello',
      }
    }]);

    resp = await axios.post(
      `${homeUrl}/api/docs/${docIds.Timesheets}/sql`,
      { nosql: "select A from Table1 where id = ?", args: [ 1 ] },
      chimpy);
    assert.equal(resp.status, 400);
    assert.deepEqual(resp.data, {
      error: 'Invalid payload',
      details: { userError: 'Error: body.sql is missing' }
    });
  });

  it ("POST /docs/{did}/sql has access control", async function () {
    // Check non-viewer doesn't have access.
    const url = `${homeUrl}/api/docs/${docIds.Timesheets}/sql`;
    const query = { sql: "select A from Table1 where id = ?", args: [ 1 ] };
    let resp = await axios.post(url, query, kiwi);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, {
      error: 'No view access',
    });

    try {
      // Check a viewer would have access.
      const delta = {
        users: { 'kiwi@getgrist.com': 'viewers' },
      };
      await axios.patch(`${homeUrl}/api/docs/${docIds.Timesheets}/access`, {delta}, chimpy);
      await flushAuth();
      resp = await axios.post(url, query, kiwi);
      assert.equal(resp.status, 200);

      // Check a viewer would not have access if there is some private material.
      await axios.post(
        `${homeUrl}/api/docs/${docIds.Timesheets}/apply`, [
          ['AddTable', 'TablePrivate', [{id: 'A', type: 'Int'}]],
          ['AddRecord', '_grist_ACLResources', -1, {tableId: 'TablePrivate', colIds: '*'}],
          ['AddRecord', '_grist_ACLRules', null, {
            resource: -1, aclFormula: '', permissionsText: 'none',
          }],
        ], chimpy);
      resp = await axios.post(url, query, kiwi);
      assert.equal(resp.status, 403);
    } finally {
      // Remove extra viewer; remove extra table.
      const delta = {
        users: { 'kiwi@getgrist.com': null },
      };
      await axios.patch(`${homeUrl}/api/docs/${docIds.Timesheets}/access`, {delta}, chimpy);
      await flushAuth();
      await axios.post(
        `${homeUrl}/api/docs/${docIds.Timesheets}/apply`, [
          ['RemoveTable', 'TablePrivate'],
        ], chimpy);
    }
  });

  it ("POST /docs/{did}/sql accepts only selects", async function () {
    async function check(accept: boolean, sql: string, ...args: any[]) {
      const resp = await axios.post(
        `${homeUrl}/api/docs/${docIds.Timesheets}/sql`,
        { sql, args },
        chimpy);
      if (accept) {
        assert.equal(resp.status, 200);
      } else {
        assert.equal(resp.status, 400);
      }
      return resp.data;
    }
    await check(true, 'select * from Table1');
    await check(true, '  SeLeCT * from Table1');
    await check(true, 'with results as (select 1) select * from results');

    // rejected quickly since no select
    await check(false, 'delete from Table1');
    await check(false, '');

    // rejected because deletes/updates/... can't be nested within a select
    await check(false, "delete from Table1 where id in (select id from Table1) and 'selecty' = 'selecty'");
    await check(false, "update Table1 set A = ? where 'selecty' = 'selecty'", 'test');
    await check(false, "pragma data_store_directory = 'selecty'");
    await check(false, "create table selecty(x, y)");
    await check(false, "attach database 'selecty' AS test");

    // rejected because ";" can't be nested
    await check(false, 'select * from Table1; delete from Table1');

    // Of course, we can get out of the wrapping select, but we can't
    // add on more statements. For example, the following runs with no
    // trouble - but only the SELECT part. The DELETE is discarded.
    // (node-sqlite3 doesn't expose enough to give an error message for
    // this, though we could extend it).
    await check(true, 'select * from Table1); delete from Table1 where id in (select id from Table1');
    const {records} = await check(true, 'select * from Table1');
    // Double-check the deletion didn't happen.
    assert.lengthOf(records, 4);
  });

  it ("POST /docs/{did}/sql timeout is effective", async function () {
    const slowQuery = 'WITH RECURSIVE r(i) AS (VALUES(0) ' +
        'UNION ALL SELECT i FROM r  LIMIT 1000000) ' +
        'SELECT i FROM r WHERE i = 1';
    const resp = await axios.post(
      `${homeUrl}/api/docs/${docIds.Timesheets}/sql`,
      { sql: slowQuery, timeout: 10 },
      chimpy);
    assert.equal(resp.status, 400);
    assert.match(resp.data.error, /database interrupt/);
  });

  // PLEASE ADD MORE TESTS HERE
}

interface WebhookRequests {
  add: object[][];
  update: object[][];
  "add,update": object[][];
}

const ORG_NAME = 'docs-1';

function setup(name: string, cb: () => Promise<void>) {
  let api: UserAPIImpl;

  before(async function () {
    suitename = name;
    dataDir = path.join(tmpDir, `${suitename}-data`);
    await flushAllRedis();
    await fse.mkdirs(dataDir);
    await setupDataDir(dataDir);
    await cb();

    // create TestDoc as an empty doc into Private workspace
    userApi = api = home.makeUserApi(ORG_NAME);
    const wid = await getWorkspaceId(api, 'Private');
    docIds.TestDoc = await api.newDoc({name: 'TestDoc'}, wid);
  });

  after(async function () {
    // remove TestDoc
    await api.deleteDoc(docIds.TestDoc);
    delete docIds.TestDoc;

    // stop all servers
    await home.stop();
    await docs.stop();
    extraHeadersForConfig = {};
  });
}

async function getWorkspaceId(api: UserAPIImpl, name: string) {
  const workspaces = await api.getOrgWorkspaces('current');
  return workspaces.find((w) => w.name === name)!.id;
}

const webhooksTestPort = Number(process.env.WEBHOOK_TEST_PORT || 34365);

async function setupDataDir(dir: string) {
  // we'll be serving Hello.grist content for various document ids, so let's make copies of it in
  // tmpDir
  await testUtils.copyFixtureDoc('Hello.grist', path.resolve(dir, docIds.Timesheets + '.grist'));
  await testUtils.copyFixtureDoc('Hello.grist', path.resolve(dir, docIds.Bananas + '.grist'));
  await testUtils.copyFixtureDoc('Hello.grist', path.resolve(dir, docIds.Antartic + '.grist'));

  await testUtils.copyFixtureDoc(
    'ApiDataRecordsTest.grist',
    path.resolve(dir, docIds.ApiDataRecordsTest + '.grist'));
}

// The access control level of a user on a document may be cached for a
// few seconds. This method flushes that cache.
async function flushAuth() {
  await home.testingHooks.flushAuthorizerCache();
  await docs.testingHooks.flushAuthorizerCache();
}

async function flushAllRedis() {
  // Clear redis test database if redis is in use.
  if (process.env.TEST_REDIS_URL) {
    const cli = createClient(process.env.TEST_REDIS_URL);
    await cli.flushdbAsync();
    await cli.quitAsync();
  }
}
