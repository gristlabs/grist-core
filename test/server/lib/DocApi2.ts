import {UserAPI} from 'app/common/UserAPI';
import axios from 'axios';
import {assert} from 'chai';
import * as fse from 'fs-extra';
import {TestServer} from 'test/gen-server/apiUtils';
import {configForUser} from 'test/gen-server/testUtils';
import {createTmpDir} from 'test/server/docTools';
import {openClient} from 'test/server/gristClient';
import * as testUtils from 'test/server/testUtils';

const chimpy = configForUser('Chimpy');
const kiwi = configForUser('Kiwi');

describe('DocApi2', function() {
  this.timeout(40000);
  let server: TestServer;
  let homeUrl: string;
  let owner: UserAPI;
  let wsId: number;
  testUtils.setTmpLogLevel('error');
  let oldEnv: testUtils.EnvironmentSnapshot;

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    const tmpDir = await createTmpDir();
    process.env.GRIST_DATA_DIR = tmpDir;
    process.env.STRIPE_ENDPOINT_SECRET = 'TEST_WITHOUT_ENDPOINT_SECRET';
    // Use the TEST_REDIS_URL as the global redis url, if supplied.
    if (process.env.TEST_REDIS_URL && !process.env.REDIS_URL) {
      process.env.REDIS_URL = process.env.TEST_REDIS_URL;
    }

    server = new TestServer(this);
    homeUrl = await server.start(['home', 'docs']);
    const api = await server.createHomeApi('chimpy', 'docs', true);
    await api.newOrg({name: 'testy', domain: 'testy'});
    owner = await server.createHomeApi('chimpy', 'testy', true);
    wsId = await owner.newWorkspace({name: 'ws'}, 'current');
  });

  after(async function() {
    const api = await server.createHomeApi('chimpy', 'docs');
    await api.deleteOrg('testy');
    await server.stop();
    oldEnv.restore();
  });

  describe('DELETE /docs/{did}', async () => {
    it('permanently deletes a document and all of its forks', async function() {
      // Create a new document and fork it twice.
      const docId = await owner.newDoc({name: 'doc'}, wsId);
      const session = await owner.getSessionActive();
      const client = await openClient(server.server, session.user.email, session.org?.domain || 'docs');
      await client.openDocOnConnect(docId);
      const forkDocResponse1 = await client.send('fork', 0);
      const forkDocResponse2 = await client.send('fork', 0);

      // Check that files were created for the trunk and forks.
      const docPath = server.server.getStorageManager().getPath(docId);
      const forkPath1 = server.server.getStorageManager().getPath(forkDocResponse1.data.docId);
      const forkPath2 = server.server.getStorageManager().getPath(forkDocResponse2.data.docId);
      assert.equal(await fse.pathExists(docPath), true);
      assert.equal(await fse.pathExists(forkPath1), true);
      assert.equal(await fse.pathExists(forkPath2), true);

      // Delete the trunk via API.
      const deleteDocResponse = await axios.delete(`${homeUrl}/api/docs/${docId}`, chimpy);
      assert.equal(deleteDocResponse.status, 200);

      // Check that files for the trunk and forks were deleted.
      assert.equal(await fse.pathExists(docPath), false);
      assert.equal(await fse.pathExists(forkPath1), false);
      assert.equal(await fse.pathExists(forkPath2), false);
    });
  });

  describe('/docs/{did}/timing', async () => {
    let docId: string;
    before(async function() {
      docId = await owner.newDoc({name: 'doc2'}, wsId);
    });

    after(async function() {
      await owner.deleteDoc(docId);
    });

    // There are two endpoints here /timing/start and /timing/stop.
    // Here we just test that it is operational, available only for owners
    // and that it returns sane results. Exact tests are done in python.

    // Smoke test.
    it('POST /docs/{did}/timing smoke tests', async function() {
      // We are disabled.
      let resp = await axios.get(`${homeUrl}/api/docs/${docId}/timing`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, {status: 'disabled'});

      // Start it.
      resp = await axios.post(`${homeUrl}/api/docs/${docId}/timing/start`, {}, chimpy);
      assert.equal(resp.status, 200);

      // Stop it.
      resp = await axios.post(`${homeUrl}/api/docs/${docId}/timing/stop`, {}, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, []);
    });

    it('POST /docs/{did}/timing/start', async function() {
      // Start timing as non owner, should fail.
      let resp = await axios.post(`${homeUrl}/api/docs/${docId}/timing/start`, {}, kiwi);
      assert.equal(resp.status, 403);

      // Query status as non owner, should fail.
      resp = await axios.get(`${homeUrl}/api/docs/${docId}/timing`, kiwi);
      assert.equal(resp.status, 403);

      // Check as owner.
      resp = await axios.get(`${homeUrl}/api/docs/${docId}/timing`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, {status: 'disabled'});

      // Start timing as owner.
      resp = await axios.post(`${homeUrl}/api/docs/${docId}/timing/start`, {}, chimpy);
      assert.equal(resp.status, 200);

      // Check we are started.
      resp = await axios.get(`${homeUrl}/api/docs/${docId}/timing`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, {status: 'active', timing: []});

      // Starting timing again works as expected, returns 400 as this is already.
      resp = await axios.post(`${homeUrl}/api/docs/${docId}/timing/start`, {}, chimpy);
      assert.equal(resp.status, 400);

      // As non owner
      resp = await axios.post(`${homeUrl}/api/docs/${docId}/timing/stop`, {}, kiwi);
      assert.equal(resp.status, 403);
    });

    it('POST /docs/{did}/timing/stop', async function() {
      // Timings are turned on, so we can stop them.
      // First as non owner, we should fail.
      let resp = await axios.post(`${homeUrl}/api/docs/${docId}/timing/stop`, {}, kiwi);
      assert.equal(resp.status, 403);

      // Next as owner.
      resp = await axios.post(`${homeUrl}/api/docs/${docId}/timing/stop`, {}, chimpy);
      assert.equal(resp.status, 200);

      // Now do it once again, we should got 400, as we are not timing.
      resp = await axios.post(`${homeUrl}/api/docs/${docId}/timing/stop`, {}, chimpy);
      assert.equal(resp.status, 400);
    });

    it('GET /docs/{did}/timing', async function() {
      // Now we can check the results. Start timing and check that we got [] in response.
      let resp =  await axios.post(`${homeUrl}/api/docs/${docId}/timing/start`, {}, chimpy);
      assert.equal(resp.status, 200);

      resp = await axios.post(`${homeUrl}/api/docs/${docId}/timing/stop`, {}, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, []);

      // Now create a table with a formula column and make sure we see it in the results.
      resp = await axios.post(`${homeUrl}/api/docs/${docId}/apply`, [
        ['AddTable', 'Timings', [
          {id: 'A', formula: '$id' }
        ]],
      ], chimpy);
      assert.equal(resp.status, 200);

      // Now start it again,
      resp = await axios.post(`${homeUrl}/api/docs/${docId}/timing/start`, {}, chimpy);
      assert.equal(resp.status, 200);

      // Make sure we see that it is active and we have some intermediate results
      resp = await axios.get(`${homeUrl}/api/docs/${docId}/timing`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, {status: 'active', timing: []});

      // And trigger some formula calculations.
      resp = await axios.post(`${homeUrl}/api/docs/${docId}/apply`, [
        ['BulkAddRecord', 'Timings', [null, null], {}],
      ], chimpy);
      assert.equal(resp.status, 200, JSON.stringify(resp.data));

      // Make sure we can't stop it as non owner.
      resp = await axios.post(`${homeUrl}/api/docs/${docId}/timing/stop`, {}, kiwi);
      assert.equal(resp.status, 403);

      // Now stop it as owner and make sure the result is sane.
      resp = await axios.post(`${homeUrl}/api/docs/${docId}/timing/stop`, {}, chimpy);
      assert.equal(resp.status, 200, JSON.stringify(resp.data));
      const data = resp.data as Array<{
        tableId: string;
        colId: string;
        sum: number;
        count: number;
        average: number;
        max: number;
        markers?: Array<{
          name: string;
          sum: number;
          count: number;
          average: number;
          max: number;
        }>
      }>;

      assert.isAbove(data.length, 0);
      assert.equal(data[0].tableId, 'Timings');
      assert.isTrue(typeof data[0].sum === 'number');
      assert.isTrue(typeof data[0].count === 'number');
      assert.isTrue(typeof data[0].average === 'number');
      assert.isTrue(typeof data[0].max === 'number');
    });

    it('POST /docs/{did}/timing/start remembers state after reload', async function() {
      // Make sure we are off.
      let resp = await axios.get(`${homeUrl}/api/docs/${docId}/timing`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, {status: 'disabled'});

      // Now start it.
      resp = await axios.post(`${homeUrl}/api/docs/${docId}/timing/start`, {}, chimpy);
      assert.equal(resp.status, 200);

      // Now reload document.
      resp = await axios.post(`${homeUrl}/api/docs/${docId}/force-reload`, {}, chimpy);
      assert.equal(resp.status, 200);

      // And check that we are still on.
      resp = await axios.get(`${homeUrl}/api/docs/${docId}/timing`, chimpy);
      assert.equal(resp.status, 200, JSON.stringify(resp.data));
      assert.equal(resp.data.status, 'active');
      assert.isNotEmpty(resp.data.timing);
    });
  });
});
