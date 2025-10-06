import {BaseAPI} from 'app/common/BaseAPI';
import {UserAPI, Workspace} from 'app/common/UserAPI';
import {assert} from 'chai';
import flatten = require('lodash/flatten');
import sortBy = require('lodash/sortBy');
import {TestServer} from 'test/gen-server/apiUtils';
import * as testUtils from 'test/server/testUtils';

describe('disabledAt', function() {
  let home: TestServer;
  let oldEnv: testUtils.EnvironmentSnapshot;

  testUtils.setTmpLogLevel('error');

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    // Ham (as in, dramatic actor) is the admin
    process.env.GRIST_DEFAULT_EMAIL = 'ham@getgrist.com';

    home = new TestServer(this);
    await home.start(['home', 'docs']);
    const api = await home.createHomeApi('chimpy', 'docs');
    await api.newOrg({name: 'testy', domain: 'testy'});
  });

  after(async function() {
    this.timeout(100000);
    const api = await home.createHomeApi('chimpy', 'docs');
    await api.deleteOrg('testy');
    await home.stop();
    oldEnv.restore();
  });

  function docNames(data: Workspace|Workspace[]) {
    if ('docs' in data) {
      return data.docs.map(doc => doc.name).sort();
    }
    return flatten(
      sortBy(data, 'name')
        .map(ws => ws.docs.map(d => `${ws.name}:${d.name}`).sort()));
  }

  function workspaceNames(data: Workspace[]) {
    return data.map(ws => ws.name).sort();
  }

  describe('scenario', function() {
    const org: string = 'testy';
    let admin: UserAPI;// admin API
    let api: UserAPI;  // regular api
    let xapi: UserAPI; // api for soft-deleted resources
    let bapi: BaseAPI; // api cast to allow custom requests
    let ws1: number;
    let ws2: number;
    let ws3: number;
    let ws4: number;
    let doc11: string;
    let doc21: string;
    let doc12: string;
    let doc31: string;

    before(async function() {
      admin = await home.createHomeApi('ham', org, true, false);
      api = await home.createHomeApi('chimpy', org);
      xapi = api.forRemoved();
      bapi = api as unknown as BaseAPI;
      // Get rid of home workspace
      for (const ws of await api.getOrgWorkspaces('current')) {
        await api.deleteWorkspace(ws.id);
      }
      // Make two workspaces with two docs apiece, one workspace with one doc,
      // and one empty workspace
      ws1 = await api.newWorkspace({name: 'ws1'}, 'current');
      ws2 = await api.newWorkspace({name: 'ws2'}, 'current');
      ws3 = await api.newWorkspace({name: 'ws3'}, 'current');
      ws4 = await api.newWorkspace({name: 'ws4'}, 'current');
      doc11 = await api.newDoc({name: 'doc11'}, ws1);
      doc12 = await api.newDoc({name: 'doc12'}, ws1);
      doc21 = await api.newDoc({name: 'doc21'}, ws2);
      await api.newDoc({name: 'doc22'}, ws2);
      doc31 = await api.newDoc({name: 'doc31'}, ws3);
    });

    it('hides soft-deleted docs from regular api', async function() {
      // This can be too low for running this test directly (when database needs to be created).
      this.timeout(10000);

      // Check that doc11 is visible via regular api
      assert.equal((await api.getDoc(doc11)).name, 'doc11');
      assert.typeOf((await api.getDoc(doc11)).disabledAt, 'undefined');
      assert.deepEqual(docNames(await api.getOrgWorkspaces('current')),
                       ['ws1:doc11', 'ws1:doc12', 'ws2:doc21', 'ws2:doc22', 'ws3:doc31']);
      assert.deepEqual(workspaceNames(await api.getOrgWorkspaces('current')),
                       ['ws1', 'ws2', 'ws3', 'ws4']);
      assert.deepEqual(docNames(await api.getWorkspace(ws1)), ['doc11', 'doc12']);
      assert.deepEqual(docNames(await api.getWorkspace(ws2)), ['doc21', 'doc22']);
      assert.deepEqual(docNames(await api.getWorkspace(ws3)), ['doc31']);
      assert.deepEqual(docNames(await api.getWorkspace(ws4)), []);

      // Soft-delete doc11, leaving one doc in ws1
      await admin.disableDoc(doc11);

      // Check that doc11 is no longer visible via regular api
      await assert.isRejected(api.getDoc(doc11), /access denied/);
      assert.deepEqual(docNames(await api.getWorkspace(ws1)), ['doc12']);
      assert.deepEqual(docNames(await api.getOrgWorkspaces('current')),
                       ['ws1:doc12', 'ws2:doc21', 'ws2:doc22', 'ws3:doc31']);

      // Check that various related endpoints are forbidden
      const docApi = api.getDocAPI(doc11);
      await assert.isRejected(docApi.getSnapshots(), /403.*no view access/i);
      await assert.isRejected(docApi.getRows('Table1'), /403.*no view access/i);
      await assert.isRejected(docApi.forceReload(), /403.*no view access/i);

      // Check that doc11 is not visible via forRemoved api
      await assert.isRejected(xapi.getDoc(doc11), /403.*access denied/i);
      await assert.isRejected(xapi.getWorkspace(ws2), /not found/);
      assert.deepEqual(docNames(await xapi.getOrgWorkspaces('current')), []);
      assert.deepEqual(workspaceNames(await xapi.getOrgWorkspaces('current')), []);

      // Verify that other docs and workspaces are still there
      assert.deepEqual(docNames(await api.getOrgWorkspaces('current')),
                       ['ws1:doc12', 'ws2:doc21', 'ws2:doc22', 'ws3:doc31']);
      assert.deepEqual(workspaceNames(await api.getOrgWorkspaces('current')),
                       ['ws1', 'ws2', 'ws3', 'ws4']);
    });

    it('lists workspaces even with all docs soft-deleted', async function() {
      // Disable doc12, leaving ws1 empty
      await admin.disableDoc(doc12);
      // Disable doc31, leaving ws3 empty
      await admin.disableDoc(doc31);

      // Check docs are not visible, but workspaces are
      await assert.isRejected(api.getDoc(doc12), /access denied/);
      await assert.isRejected(api.getDoc(doc31), /access denied/);
      assert.deepEqual(docNames(await api.getOrgWorkspaces('current')), ['ws2:doc21', 'ws2:doc22']);
      assert.deepEqual(workspaceNames(await api.getOrgWorkspaces('current')),
                       ['ws1', 'ws2', 'ws3', 'ws4']);
      assert.deepEqual(docNames(await api.getWorkspace(ws1)), []);
      assert.deepEqual(docNames(await api.getWorkspace(ws3)), []);

      // Check docs are not visible via forRemoved api
      await assert.isRejected(xapi.getDoc(doc12), /access denied/);
      await assert.isRejected(xapi.getDoc(doc31), /access denied/);
      await assert.isRejected(xapi.getWorkspace(ws2), /not found/);
      assert.deepEqual(docNames(await xapi.getOrgWorkspaces('current')), []);
      assert.deepEqual(workspaceNames(await xapi.getOrgWorkspaces('current')), []);
    });

    it('can revert disabled docs', async function() {
      // Only admin can re-enable docs
      await assert.isRejected(api.enableDoc(doc11));
      await assert.isRejected(api.enableDoc(doc12));
      await assert.isRejected(api.enableDoc(doc31));
      await admin.enableDoc(doc11);
      await admin.enableDoc(doc12);
      await admin.enableDoc(doc31);

      // Check that doc11 is visible via regular api again
      assert.equal((await api.getDoc(doc11)).name, 'doc11');
      assert.typeOf((await api.getDoc(doc11)).disabledAt, 'undefined');
      assert.deepEqual(docNames(await api.getOrgWorkspaces('current')),
                       ['ws1:doc11', 'ws1:doc12', 'ws2:doc21', 'ws2:doc22', 'ws3:doc31']);
      assert.deepEqual(docNames(await api.getWorkspace(ws1)), ['doc11', 'doc12']);

      // Check that no "trash" is visible anymore
      assert.deepEqual(docNames(await xapi.getOrgWorkspaces('current')), []);
      await assert.isRejected(xapi.getWorkspace(ws1), /not found/);
      await assert.isRejected(xapi.getWorkspace(ws2), /not found/);
      await assert.isRejected(xapi.getWorkspace(ws3), /not found/);
      await assert.isRejected(xapi.getWorkspace(ws4), /not found/);
    });

    it('can combine soft-deleted workspaces and disabled docs', async function() {
      await api.softDeleteWorkspace(ws1);
      await api.softDeleteWorkspace(ws3);
      await api.softDeleteWorkspace(ws4);

      // Disable a doc in an undeleted workspace, and in a soft-deleted workspace.
      await admin.disableDoc(doc11);
      await admin.disableDoc(doc21);
      assert.deepEqual(docNames(await api.getOrgWorkspaces('current')),
                       ['ws2:doc22']);
      assert.deepEqual(docNames(await xapi.getOrgWorkspaces('current')),
                       ['ws1:doc12', 'ws3:doc31']);

      await api.undeleteWorkspace(ws1);
      await api.undeleteWorkspace(ws3);
      await api.undeleteWorkspace(ws4);
    });

    it('does not interfere with DocAuthKey-based caching', async function() {
      const info = await api.getSessionActive();

      // Flush cache, then try to access doc11 as a removed doc.
      home.dbManager.flushDocAuthCache();
      await assert.isRejected(xapi.getDoc(doc11), /access denied/);

      // Check that cached authentication is correct.
      const auth = await home.dbManager.getDocAuthCached({urlId: doc11, userId: info.user.id, org});
      assert.equal(auth.access, null);
    });

    it('cannot hard-delete a disabled document', async function() {
      const tmp1 = await api.newDoc({name: 'tmp1'}, ws1);
      const tmp2 = await api.newDoc({name: 'tmp2'}, ws1);
      await admin.disableDoc(tmp1);
      await assert.isRejected(api.deleteDoc(tmp1));
      await admin.disableDoc(tmp2);
      await assert.isRejected(bapi.testRequest(`${api.getBaseUrl()}/api/docs/${tmp2}/remove?permanent=1`,
                             {method: 'POST'}));
      await assert.isRejected(api.enableDoc(tmp1));
      await assert.isRejected(api.enableDoc(tmp2));
      await assert.isFulfilled(admin.enableDoc(tmp1));
      await assert.isFulfilled(admin.enableDoc(tmp2));
    });

    // This checks that the following problem is fixed:
    //   If I shared a doc with a friend, and then soft-deleted a doc in the same workspace,
    //   that friend used to see the workspace in their trash (empty, but there).
    it('does not show workspaces for docs user does not have access to', async function() {
      // Make two docs in a workspace, and share one with a friend.
      const ws = await api.newWorkspace({name: 'wsWithSharing'}, 'testy');
      const shared = await api.newDoc({name: 'shared'}, ws);
      const unshared = await api.newDoc({name: 'unshared'}, ws);
      await api.updateDocPermissions(shared, {
        users: { 'charon@getgrist.com': 'viewers' }
      });

      // Check the friend sees nothing in their trash.
      const charon = await home.createHomeApi('charon', 'docs');
      let result = await charon.forRemoved().getOrgWorkspaces('testy');
      assert.lengthOf(result, 0);

      // Deleted the unshared doc, and check the friend still sees nothing in their trash.
      await admin.disableDoc(unshared);
      result = await charon.forRemoved().getOrgWorkspaces('testy');
      assert.lengthOf(result, 0);

      // Deleted the shared doc. The friend has no other reason to have any org access, so
      // should lose access.
      await admin.disableDoc(shared);
      await assert.isRejected(charon.forRemoved().getOrgWorkspaces('testy'), /access denied/);
    });
  });
});
