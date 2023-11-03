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

describe('DocApi2', function() {
  this.timeout(40000);
  let server: TestServer;
  let serverUrl: string;
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
    serverUrl = await server.start(['home', 'docs']);
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
      const deleteDocResponse = await axios.delete(`${serverUrl}/api/docs/${docId}`, chimpy);
      assert.equal(deleteDocResponse.status, 200);

      // Check that files for the trunk and forks were deleted.
      assert.equal(await fse.pathExists(docPath), false);
      assert.equal(await fse.pathExists(forkPath1), false);
      assert.equal(await fse.pathExists(forkPath2), false);
    });
  });
});
