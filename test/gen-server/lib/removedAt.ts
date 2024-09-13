import {BaseAPI} from 'app/common/BaseAPI';
import {UserAPI, Workspace} from 'app/common/UserAPI';
import {assert} from 'chai';
import flatten = require('lodash/flatten');
import sortBy = require('lodash/sortBy');
import {TestServer} from 'test/gen-server/apiUtils';
import * as testUtils from 'test/server/testUtils';

describe('removedAt', function() {
  let home: TestServer;
  testUtils.setTmpLogLevel('error');

  before(async function() {
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
      assert.typeOf((await api.getDoc(doc11)).removedAt, 'undefined');
      assert.deepEqual(docNames(await api.getOrgWorkspaces('current')),
                       ['ws1:doc11', 'ws1:doc12', 'ws2:doc21', 'ws2:doc22', 'ws3:doc31']);
      assert.deepEqual(workspaceNames(await api.getOrgWorkspaces('current')),
                       ['ws1', 'ws2', 'ws3', 'ws4']);
      assert.deepEqual(docNames(await api.getWorkspace(ws1)), ['doc11', 'doc12']);
      assert.deepEqual(docNames(await api.getWorkspace(ws2)), ['doc21', 'doc22']);
      assert.deepEqual(docNames(await api.getWorkspace(ws3)), ['doc31']);
      assert.deepEqual(docNames(await api.getWorkspace(ws4)), []);

      // Soft-delete doc11, leaving one doc in ws1
      await api.softDeleteDoc(doc11);

      // Check that doc11 is no longer visible via regular api
      await assert.isRejected(api.getDoc(doc11), /not found/);
      assert.deepEqual(docNames(await api.getWorkspace(ws1)), ['doc12']);
      assert.deepEqual(docNames(await api.getOrgWorkspaces('current')),
                       ['ws1:doc12', 'ws2:doc21', 'ws2:doc22', 'ws3:doc31']);

      // Check that various related endpoints are forbidden
      let docApi = api.getDocAPI(doc11);
      await assert.isRejected(docApi.getSnapshots(), /404.*document is deleted/i);
      await assert.isRejected(docApi.getRows('Table1'), /404.*document is deleted/i);
      await assert.isRejected(docApi.forceReload(), /404.*document is deleted/i);

      // Check that doc11 is visible via forRemoved api
      assert.equal((await xapi.getDoc(doc11)).name, 'doc11');
      assert.typeOf((await xapi.getDoc(doc11)).removedAt, 'string');
      assert.deepEqual(docNames(await xapi.getWorkspace(ws1)), ['doc11']);
      await assert.isRejected(xapi.getWorkspace(ws2), /not found/);
      assert.deepEqual(docNames(await xapi.getOrgWorkspaces('current')),
                       ['ws1:doc11']);
      assert.deepEqual(workspaceNames(await xapi.getOrgWorkspaces('current')),
                       ['ws1']);

      docApi = xapi.getDocAPI(doc11);
      await assert.isFulfilled(docApi.getSnapshots());
      await assert.isFulfilled(docApi.getRows('Table1'));
      await assert.isFulfilled(docApi.forceReload());
    });

    it('lists workspaces even with all docs soft-deleted', async function() {
      // Soft-delete doc12, leaving ws1 empty
      await api.softDeleteDoc(doc12);
      // Soft-delete doc31, leaving ws3 empty
      await api.softDeleteDoc(doc31);

      // Check docs are not visible, but workspaces are
      await assert.isRejected(api.getDoc(doc12), /not found/);
      await assert.isRejected(api.getDoc(doc31), /not found/);
      assert.deepEqual(docNames(await api.getOrgWorkspaces('current')), ['ws2:doc21', 'ws2:doc22']);
      assert.deepEqual(workspaceNames(await api.getOrgWorkspaces('current')),
                       ['ws1', 'ws2', 'ws3', 'ws4']);
      assert.deepEqual(docNames(await api.getWorkspace(ws1)), []);
      assert.deepEqual(docNames(await api.getWorkspace(ws3)), []);

      // Check docs are visible via forRemoved api
      assert.equal((await xapi.getDoc(doc12)).name, 'doc12');
      assert.typeOf((await xapi.getDoc(doc12)).removedAt, 'string');
      assert.equal((await xapi.getDoc(doc31)).name, 'doc31');
      assert.typeOf((await xapi.getDoc(doc31)).removedAt, 'string');
      assert.equal((await xapi.getWorkspace(ws1)).name, 'ws1');
      assert.typeOf((await xapi.getWorkspace(ws1)).removedAt, 'undefined');
      assert.deepEqual(docNames(await xapi.getWorkspace(ws1)), ['doc11', 'doc12']);
      assert.deepEqual(docNames(await xapi.getWorkspace(ws3)), ['doc31']);
      await assert.isRejected(xapi.getWorkspace(ws2), /not found/);
      assert.deepEqual(docNames(await xapi.getOrgWorkspaces('current')),
                       ['ws1:doc11', 'ws1:doc12', 'ws3:doc31']);
      assert.deepEqual(workspaceNames(await xapi.getOrgWorkspaces('current')),
                       ['ws1', 'ws3']);
    });

    it('can revert soft-deleted docs', async function() {
      // Undelete docs
      await api.undeleteDoc(doc11);
      await api.undeleteDoc(doc12);
      await api.undeleteDoc(doc31);

      // Check that doc11 is visible via regular api again
      assert.equal((await api.getDoc(doc11)).name, 'doc11');
      assert.typeOf((await api.getDoc(doc11)).removedAt, 'undefined');
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

    it('hides soft-deleted workspaces from regular api', async function() {
      // Soft-delete ws1, ws3, and ws4
      await api.softDeleteWorkspace(ws1);
      await api.softDeleteWorkspace(ws3);
      await api.softDeleteWorkspace(ws4);

      // Check that workspaces are no longer visible via regular api
      await assert.isRejected(api.getDoc(doc11), /not found/);
      await assert.isRejected(api.getWorkspace(ws1), /not found/);
      assert.deepEqual(docNames(await api.getWorkspace(ws2)), ['doc21', 'doc22']);
      await assert.isRejected(api.getDoc(doc31), /not found/);
      await assert.isRejected(api.getWorkspace(ws3), /not found/);
      await assert.isRejected(api.getWorkspace(ws4), /not found/);
      assert.deepEqual(docNames(await api.getOrgWorkspaces('current')),
                       ['ws2:doc21', 'ws2:doc22']);

      // Check that workspaces are visible via forRemoved api
      assert.equal((await xapi.getWorkspace(ws1)).name, 'ws1');
      assert.typeOf((await xapi.getWorkspace(ws1)).removedAt, 'string');
      assert.equal((await xapi.getDoc(doc11)).name, 'doc11');
      assert.equal((await xapi.getWorkspace(ws3)).name, 'ws3');
      assert.typeOf((await xapi.getWorkspace(ws3)).removedAt, 'string');
      assert.equal((await xapi.getWorkspace(ws4)).name, 'ws4');
      assert.typeOf((await xapi.getWorkspace(ws4)).removedAt, 'string');
      // we may not want the following - may want to explicitly set removedAt
      // on docs within a soft-deleted workspace
      assert.typeOf((await xapi.getDoc(doc11)).removedAt, 'undefined');
      assert.typeOf((await xapi.getDoc(doc12)).removedAt, 'undefined');
      assert.typeOf((await xapi.getDoc(doc31)).removedAt, 'undefined');
      assert.deepEqual(docNames(await xapi.getWorkspace(ws1)), ['doc11', 'doc12']);
      await assert.isRejected(xapi.getWorkspace(ws2), /not found/);
      assert.deepEqual(docNames(await xapi.getWorkspace(ws3)), ['doc31']);
      assert.deepEqual(docNames(await xapi.getWorkspace(ws4)), []);
      assert.deepEqual(docNames(await xapi.getOrgWorkspaces('current')),
                       ['ws1:doc11', 'ws1:doc12', 'ws3:doc31']);
    });

    it('can combine soft-deleted workspaces and soft-deleted docs', async function() {
      // Delete a doc in an undeleted workspace, and in a soft-deleted workspace.
      await api.softDeleteDoc(doc21);
      await xapi.softDeleteDoc(doc11);
      assert.deepEqual(docNames(await api.getOrgWorkspaces('current')),
                       ['ws2:doc22']);
      assert.deepEqual(docNames(await xapi.getOrgWorkspaces('current')),
                       ['ws1:doc11', 'ws1:doc12', 'ws2:doc21', 'ws3:doc31']);
    });

    it('can revert soft-deleted workspaces', async function() {
      // Undelete workspaces and docs
      await api.undeleteWorkspace(ws1);
      await api.undeleteWorkspace(ws3);
      await api.undeleteWorkspace(ws4);
      await api.undeleteDoc(doc21);
      await api.undeleteDoc(doc11);

      // Check that docs are visible via regular api again
      assert.equal((await api.getDoc(doc11)).name, 'doc11');
      assert.typeOf((await api.getDoc(doc11)).removedAt, 'undefined');
      assert.deepEqual(docNames(await api.getOrgWorkspaces('current')),
                       ['ws1:doc11', 'ws1:doc12', 'ws2:doc21', 'ws2:doc22', 'ws3:doc31']);
      assert.deepEqual(docNames(await api.getWorkspace(ws1)), ['doc11', 'doc12']);

      // Check that no "trash" is visible anymore
      assert.deepEqual(docNames(await xapi.getOrgWorkspaces('current')), []);
    });


    // This checks that the following problem is fixed:
    //   If a document is deleted in a workspace with many other documents, the
    //   deletion used to take an unreasonable length of time.
    it('deletes documents reasonably quickly', async function() {
      this.timeout(15000);
      const ws = await api.newWorkspace({name: 'speedTest'}, 'testy');
      // Create a batch of many documents.
      const docIds = await Promise.all(new Array(50).fill(0).map(() => api.newDoc({name: 'doc'}, ws)));
      // Explicitly set users on some of the documents.
      await api.updateDocPermissions(docIds[5], {
        users: {
          'test1@getgrist.com': 'viewers',
        }
      });
      await api.updateDocPermissions(docIds[10], {
        users: {
          'test2@getgrist.com': 'owners',
          'test3@getgrist.com': 'editors',
        }
      });
      const userRef = (email: string) => home.dbManager.getUserByLogin(email).then((user) => user.ref);
      const idTest1 = (await home.dbManager.getUserByLogin("test1@getgrist.com"))!.id;
      const idTest2 = (await home.dbManager.getUserByLogin("test2@getgrist.com"))!.id;
      const idTest3 = (await home.dbManager.getUserByLogin("test3@getgrist.com"))!.id;
      // Create one extra document, with one extra user.
      const extraDocId = await api.newDoc({name: 'doc'}, ws);
      await api.updateDocPermissions(extraDocId, {
        users: { 'kiwi@getgrist.com': 'viewers' }
      });
      assert.deepEqual(await api.getWorkspaceAccess(ws), {
        "maxInheritedRole": "owners",
        "users": [
          {
            "id": 1,
            "name": "Chimpy",
            "email": "chimpy@getgrist.com",
            "ref": await userRef("chimpy@getgrist.com"),
            "picture": null,
            "access": "owners",
            "parentAccess": "owners",
            "isMember": true,
          },
          {
            "id": 2,
            "name": "Kiwi",
            "email": "kiwi@getgrist.com",
            "ref": await userRef("kiwi@getgrist.com"),
            "picture": null,
            "access": "guests",
            "parentAccess": null,
            "isMember": false,
          },
          {
            "id": idTest1,
            "name": "",
            "email": "test1@getgrist.com",
            "ref": await userRef("test1@getgrist.com"),
            "picture": null,
            "access": "guests",
            "parentAccess": null,
            "isMember": false,
          },
          {
            "id": idTest2,
            "name": "",
            "email": "test2@getgrist.com",
            "ref": await userRef("test2@getgrist.com"),
            "picture": null,
            "access": "guests",
            "parentAccess": null,
            "isMember": false,
          },
          {
            "id": idTest3,
            "name": "",
            "email": "test3@getgrist.com",
            "ref": await userRef("test3@getgrist.com"),
            "picture": null,
            "access": "guests",
            "parentAccess": null,
            "isMember": false,
          }
        ]
      });
      // Delete the batch of documents, retaining the one extra.
      await Promise.all(docIds.map(docId => api.deleteDoc(docId)));
      // Make sure the guest from the extra doc is retained, while all others evaporate.
      assert.deepEqual(await api.getWorkspaceAccess(ws), {
        "maxInheritedRole": "owners",
        "users": [
          {
            "id": 1,
            "name": "Chimpy",
            "email": "chimpy@getgrist.com",
            "ref": await userRef("chimpy@getgrist.com"),
            "picture": null,
            "access": "owners",
            "parentAccess": "owners",
            "isMember": true,
          },
          {
            "id": 2,
            "name": "Kiwi",
            "email": "kiwi@getgrist.com",
            "ref": await userRef("kiwi@getgrist.com"),
            "picture": null,
            "access": "guests",
            "parentAccess": null,
            "isMember": false,
          }
        ]
      });
    });

    it('does not interfere with DocAuthKey-based caching', async function() {
      const info = await api.getSessionActive();

      // Flush cache, then try to access doc11 as a removed doc.
      home.dbManager.flushDocAuthCache();
      await assert.isRejected(xapi.getDoc(doc11), /not found/);

      // Check that cached authentication is correct.
      const auth = await home.dbManager.getDocAuthCached({urlId: doc11, userId: info.user.id, org});
      assert.equal(auth.access, 'owners');
    });

    it('respects permanent flag on /api/docs/:did/remove', async function() {
      await bapi.testRequest(`${api.getBaseUrl()}/api/docs/${doc11}/remove`,
                             {method: 'POST'});
      await bapi.testRequest(`${api.getBaseUrl()}/api/docs/${doc12}/remove?permanent=1`,
                             {method: 'POST'});
      await api.undeleteDoc(doc11);
      await assert.isRejected(api.undeleteDoc(doc12), /not found/);
    });

    it('respects permanent flag on /api/workspaces/:wid/remove', async function() {
      await bapi.testRequest(`${api.getBaseUrl()}/api/workspaces/${ws1}/remove`,
                             {method: 'POST'});
      await bapi.testRequest(`${api.getBaseUrl()}/api/workspaces/${ws2}/remove?permanent=1`,
                             {method: 'POST'});
      await api.undeleteWorkspace(ws1);
      await assert.isRejected(api.undeleteWorkspace(ws2), /not found/);
    });

    it('can hard-delete a soft-deleted document', async function() {
      const tmp1 = await api.newDoc({name: 'tmp1'}, ws1);
      const tmp2 = await api.newDoc({name: 'tmp2'}, ws1);
      await api.softDeleteDoc(tmp1);
      await api.deleteDoc(tmp1);
      await api.softDeleteDoc(tmp2);
      await bapi.testRequest(`${api.getBaseUrl()}/api/docs/${tmp2}/remove?permanent=1`,
                             {method: 'POST'});
      await assert.isRejected(api.undeleteDoc(tmp1));
      await assert.isRejected(api.undeleteDoc(tmp2));
    });

    it('can hard-delete a soft-deleted workspace', async function() {
      const tmp1 = await api.newWorkspace({name: 'tmp1'}, 'current');
      const tmp2 = await api.newWorkspace({name: 'tmp2'}, 'current');
      await api.softDeleteWorkspace(tmp1);
      await api.deleteWorkspace(tmp1);
      await api.softDeleteWorkspace(tmp2);
      await bapi.testRequest(`${api.getBaseUrl()}/api/workspaces/${tmp2}/remove?permanent=1`,
                             {method: 'POST'});
      await assert.isRejected(api.undeleteWorkspace(tmp1));
      await assert.isRejected(api.undeleteWorkspace(tmp2));
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
      await api.softDeleteDoc(unshared);
      result = await charon.forRemoved().getOrgWorkspaces('testy');
      assert.lengthOf(result, 0);

      // Deleted the shared doc, and check the friend sees it in trash.
      // (There might be a case for only owners seeing it? i.e. you see something in
      // trash if you have the power to restore it? But in a team site it might be
      // useful to have some insight into what happened to a doc you can view.)
      await api.softDeleteDoc(shared);
      result = await charon.forRemoved().getOrgWorkspaces('testy');
      assert.deepEqual(docNames(result), ['wsWithSharing:shared']);
    });
  });
});
