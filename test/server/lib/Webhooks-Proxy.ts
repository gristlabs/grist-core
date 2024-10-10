import {UserAPIImpl} from 'app/common/UserAPI';
import {WebhookSubscription} from 'app/server/lib/DocApi';
import axios from 'axios';
import {assert} from 'chai';
import * as express from 'express';
import {tmpdir} from 'os';
import * as path from 'path';
import {createClient} from 'redis';
import {configForUser} from 'test/gen-server/testUtils';
import {serveSomething, Serving} from 'test/server/customUtil';
import {prepareDatabase} from 'test/server/lib/helpers/PrepareDatabase';
import {prepareFilesystemDirectoryForTests} from 'test/server/lib/helpers/PrepareFilesystemDirectoryForTests';
import {signal} from 'test/server/lib/helpers/Signal';
import {TestProxyServer} from 'test/server/lib/helpers/TestProxyServer';
import {TestServer} from 'test/server/lib/helpers/TestServer';
import * as testUtils from 'test/server/testUtils';

const chimpy = configForUser('Chimpy');


// some doc ids
const docIds: { [name: string]: string } = {
  ApiDataRecordsTest: 'sampledocid_7',
  Timesheets: 'sampledocid_13',
  Bananas: 'sampledocid_6',
  Antartic: 'sampledocid_11',
};

let dataDir: string;
let suitename: string;
let serverUrl: string;
let userApi: UserAPIImpl;

async function cleanRedisDatabase() {
  const cli = createClient(process.env.TEST_REDIS_URL);
  await cli.flushdbAsync();
  await cli.quitAsync();
}

function backupEnvironmentVariables() {
  let oldEnv: testUtils.EnvironmentSnapshot;
  before(() => {
    oldEnv = new testUtils.EnvironmentSnapshot();
  });
  after(() => {
    oldEnv.restore();
  });
}

const webhooksTestPort = Number(process.env.WEBHOOK_TEST_PORT || 34365);
const webhooksTestProxyPort = Number(process.env.WEBHOOK_TEST_PROXY_PORT || 22335);

describe('Webhooks-Proxy', function () {
  // A testDir of the form grist_test_{USER}_{SERVER_NAME}
  // - its a directory that will be base for all test related files and activities
  const username = process.env.USER || "nobody";
  const tmpDir = path.join(tmpdir(), `grist_test_${username}_docapi_webhooks_proxy`);
  let home: TestServer;
  let docs: TestServer;

  this.timeout(30000);
  testUtils.setTmpLogLevel('debug');
  // test might override environment values, therefore we need to backup current ones to restore them later
  backupEnvironmentVariables();

  function setupMockServers(name: string, tmpDir: string, cb: () => Promise<void>) {
    let api: UserAPIImpl;

    before(async function () {
      suitename = name;
      await cb();

      // create TestDoc as an empty doc into Private workspace
      userApi = api = await home.makeUserApi(ORG_NAME);
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
    });
  }


  describe('Proxy is configured', function () {
    runServerConfigurations({GRIST_HTTPS_PROXY:`http://localhost:${webhooksTestProxyPort}`}, ()=>testWebhookProxy(true));
  });

  describe('Proxy not configured', function () {
    runServerConfigurations({GRIST_HTTPS_PROXY:undefined}, ()=>testWebhookProxy(false));

  });


  function runServerConfigurations(additionaEnvConfiguration: NodeJS.ProcessEnv, subTestCall: Function) {
    additionaEnvConfiguration = {
      ALLOWED_WEBHOOK_DOMAINS: `example.com,localhost:${webhooksTestPort}`,
      GRIST_DATA_DIR: dataDir,
      ...additionaEnvConfiguration
    };

    before(async function () {
      // Clear redis test database if redis is in use.
      if (process.env.TEST_REDIS_URL) {
        await cleanRedisDatabase();
      }
      await prepareFilesystemDirectoryForTests(tmpDir);
      await prepareDatabase(tmpDir);
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
      setupMockServers('merged', tmpDir, async () => {
        home = docs = await TestServer.startServer('home,docs', tmpDir, suitename, additionaEnvConfiguration);
        serverUrl = await home.getServerUrl();
      });
      subTestCall();
    });

    // the way these tests are written, non-merged server requires redis.
    if (process.env.TEST_REDIS_URL) {
      describe("should work with a home server and a docworker", async () => {
        setupMockServers('separated', tmpDir, async () => {
          home = await TestServer.startServer('home', tmpDir, suitename, additionaEnvConfiguration);
          const homeUrl = await home.getServerUrl();
          docs = await TestServer.startServer('docs', tmpDir, suitename, additionaEnvConfiguration, homeUrl);
          serverUrl = homeUrl;
        });
        subTestCall();
      });


      describe("should work directly with a docworker", async () => {
        setupMockServers('docs', tmpDir, async () => {
          home = await TestServer.startServer('home', tmpDir, suitename, additionaEnvConfiguration);
          const homeUrl = await home.getServerUrl();
          docs = await TestServer.startServer('docs', tmpDir, suitename, additionaEnvConfiguration, homeUrl);
          serverUrl = await docs.getServerUrl();
        });
        subTestCall();
      });
    }
  }

  function testWebhookProxy(shouldProxyBeCalled: boolean) {
    describe('calling registered webhooks after data update', function () {

      let serving: Serving;  // manages the test webhook server
      let testProxyServer: TestProxyServer;  // manages the test webhook server


      let redisMonitor: any;


      // Create couple of promises that can be used to monitor
      // if the endpoint was called.
      const successCalled = signal();
      const notFoundCalled = signal();


      async function autoSubscribe(
        endpoint: string, docId: string, options?: {
          tableId?: string,
          isReadyColumn?: string | null,
          eventTypes?: string[]
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
        isReadyColumn?: string | null,
        eventTypes?: string[]
      }) {
        // Subscribe helper that returns a method to unsubscribe.
        const {data, status} = await axios.post(
          `${serverUrl}/api/docs/${docId}/tables/${options?.tableId ?? 'Table1'}/_subscribe`,
          {
            eventTypes: options?.eventTypes ?? ['add', 'update'],
            url: `${serving.url}/${endpoint}`,
            isReadyColumn: options?.isReadyColumn === undefined ? 'B' : options?.isReadyColumn
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


      before(async function () {
        this.timeout(30000);
        serving = await serveSomething(app => {

          app.use(express.json());
          app.post('/200', ({body}, res) => {
            successCalled.emit(body[0].A);
            res.sendStatus(200);
            res.end();
          });
          app.post('/404', ({body}, res) => {
            notFoundCalled.emit(body[0].A);
            res.sendStatus(404); // Webhooks treats it as an error and will retry. Probably it shouldn't work this way.
            res.end();
          });
        }, webhooksTestPort);
        testProxyServer = await TestProxyServer.Prepare(webhooksTestProxyPort);
      });

      after(async function () {
        await serving.shutdown();
        await testProxyServer.dispose();
      });

      before(async function () {
        this.timeout(30000);

        if (process.env.TEST_REDIS_URL) {

          redisMonitor = createClient(process.env.TEST_REDIS_URL);
        }
      });

      after(async function () {
        if (process.env.TEST_REDIS_URL) {
          await redisMonitor.quitAsync();
        }
      });

      if (shouldProxyBeCalled) {
        it("Should call proxy", async function () {
          //Run standard subscribe-modify data-check response - unsubscribe scenario, we are not mutch
          // intrested in it, only want to check if proxy was used
          await runTestCase();
          assert.isTrue(testProxyServer.wasProxyCalled());
        });
      } else {
        it("Should not call proxy", async function () {
          //Run standard subscribe-modify data-check response - unsubscribe scenario, we are not mutch
          // intrested in it, only want to check if proxy was used
          await runTestCase();
          assert.isFalse(testProxyServer.wasProxyCalled());
        });
      }


      async function runTestCase() {
        //Create a test document.
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
        successCalled.assertNotCalled();

        //Cleanup all
        await Promise.all(cleanup.map(fn => fn())).finally(() => cleanup.length = 0);
        await clearQueue(docId);
      }
    });
  }
});

const ORG_NAME = 'docs-1';

async function getWorkspaceId(api: UserAPIImpl, name: string) {
  const workspaces = await api.getOrgWorkspaces('current');
  return workspaces.find((w) => w.name === name)!.id;
}
