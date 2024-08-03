import {Workspace} from 'app/common/UserAPI';
import {assert} from 'chai';
import {TestServer} from 'test/gen-server/apiUtils';
import * as testUtils from 'test/server/testUtils';

describe('everyone', function() {
  let home: TestServer;
  testUtils.setTmpLogLevel('error');

  before(async function() {
    home = new TestServer(this);
    await home.start();
  });

  after(async function() {
    await home.stop();
  });

  /**
   * Assert that the specified workspaces and their material are public,
   * and that all other workspaces are not.
   */
  async function assertPublic(wss: Workspace[], publicWorkspaces: string[]) {
    for (const ws of wss) {
      const expectedPublic = publicWorkspaces.includes(ws.name) || undefined;
      assert.equal(ws.public, expectedPublic);
      for (const doc of ws.docs) {
        assert.equal(doc.public, expectedPublic);
      }
    }
  }

  it('support account can share a listed workspace with all users', async function() {

    // Share a workspace in support's personal org with everyone
    let api = await home.createHomeApi('Support', 'docs');
    await home.upgradePersonalOrg('Support');
    const wsId = await api.newWorkspace({name: 'Samples'}, 'current');
    const docId = await api.newDoc({name: 'an example'}, wsId);
    await api.updateWorkspacePermissions(wsId, {
      users: {'everyone@getgrist.com': 'viewers',
              'anon@getgrist.com': 'viewers'}
    });

    // Check a fresh user can see that workspace
    const altApi = await home.createHomeApi('testuser', 'docs');
    let wss = await altApi.getOrgWorkspaces('current');
    assert.deepEqual(wss.map(ws => ws.name), ['Home', 'Samples']);
    assert.deepEqual(wss[1].docs.map(doc => doc.id), [docId]);

    // Check that public flag is set in everything the fresh user can see outside its Home.
    await assertPublic(wss, ['Samples']);

    // Check existing users can see that workspace
    const chimpyApi = await home.createHomeApi('Chimpy', 'docs');
    wss = await chimpyApi.getOrgWorkspaces('current');
    assert.deepEqual(wss.map(ws => ws.name), ['Private', 'Public', 'Samples']);
    assert.deepEqual(wss.map(ws => ws.isSupportWorkspace), [false, false, true]);
    // Public and Private could be in either order, but Samples should be last
    // (api returns workspaces in chronological order).
    assert.equal(wss[2].name, 'Samples');
    assert.deepEqual(wss[2].docs.map(doc => doc.id), [docId]);
    await assertPublic(wss, ['Samples']);

    // Check that workspace also shows up in regular orgs
    const nasaApi = await home.createHomeApi('Chimpy', 'nasa');
    wss = await nasaApi.getOrgWorkspaces('current');
    assert.deepEqual(wss.map(ws => ws.name), ['Horizon', 'Rovers', 'Samples']);
    assert.deepEqual(wss.map(ws => ws.isSupportWorkspace), [false, false, true]);
    await assertPublic(wss, ['Samples']);

    // Need to recreate api because of cookies
    api = await home.createHomeApi('Support', 'docs');
    await api.deleteWorkspace(wsId);
  });

  it('can share unlisted docs in personal org with all users', async function() {
    const api = await home.createHomeApi('Supportish', 'docs');
    await home.upgradePersonalOrg('Supportish');
    const wsId = await api.newWorkspace({name: 'Samples2'}, 'current');
    const docId = await api.newDoc({name: 'an example'}, wsId);
    // Check other users cannot access the doc yet
    const chimpyApi = await home.createHomeApi('Chimpy', 'docs', true);
    await assert.isRejected(chimpyApi.getDoc(docId), /access denied/);
    // Share doc with everyone
    await api.updateDocPermissions(docId, {
      users: {'everyone@getgrist.com': 'viewers'}
    });
    // Check other users can access the doc now
    assert.equal((await chimpyApi.getDoc(docId)).access, 'viewers');
    // Check that doc is marked as public
    assert.equal((await chimpyApi.getDoc(docId)).public, true);
    // Check they don't see doc listed
    let wss = await chimpyApi.getOrgWorkspaces('current');
    assert.deepEqual(wss.map(ws => ws.name), ['Private', 'Public']);

    // Share every way possible via api
    await api.updateWorkspacePermissions(wsId, {
      users: {'everyone@getgrist.com': 'viewers'}
    });
    await assert.isRejected(api.updateOrgPermissions(0, {
      users: {'everyone@getgrist.com': 'viewers'}
    }), /cannot share with everyone at top level/);
    // Check existing users still don't see doc listed
    wss = await chimpyApi.getOrgWorkspaces('current');
    assert.deepEqual(wss.map(ws => ws.name), ['Private', 'Public']);
  });

  it('can share unlisted docs in team sites with all users', async function() {
    const chimpyApi = await home.createHomeApi('Chimpy', 'nasa', true);
    const wsId = await chimpyApi.newWorkspace({name: 'Samples'}, 'current');
    const docId = await chimpyApi.newDoc({name: 'an example'}, wsId);

    // Check a fresh user cannot see that doc
    const altApi = await home.createHomeApi('testuser', 'nasa', false, false);
    await assert.isRejected(altApi.getDoc(docId), /access denied/i);

    // Share doc with everyone
    await chimpyApi.updateDocPermissions(docId, {
      users: {'everyone@getgrist.com': 'viewers'}
    });

    // Check a fresh user can now see that doc
    await assert.isFulfilled(altApi.getDoc(docId));

    // Check that doc is marked as public
    assert.equal((await altApi.getDoc(docId)).public, true);

    // But can't list that doc in team site
    await assert.isRejected(altApi.getOrgWorkspaces('current'), /access denied/);

    // Also can't list the doc in workspace
    await assert.isRejected(altApi.getWorkspace(wsId), /access denied/);
  });

  it('can share public docs without them being listed indirectly', async function() {
    const chimpyApi = await home.createHomeApi('Chimpy', 'nasa', true);
    const wsId = await chimpyApi.newWorkspace({name: 'Samples'}, 'current');
    const docId = await chimpyApi.newDoc({name: 'an example'}, wsId);
    const docId2 = await chimpyApi.newDoc({name: 'another example'}, wsId);

    // Share one doc with everyone
    await chimpyApi.updateDocPermissions(docId, {
      users: {'everyone@getgrist.com': 'viewers'}
    });

    // Share one doc with everyone, the other with a specific test user at the doc level
    const altApi = await home.createHomeApi('testuser', 'nasa', false, false);
    await chimpyApi.updateDocPermissions(docId, {
      users: {'everyone@getgrist.com': 'viewers'}
    });
    await chimpyApi.updateDocPermissions(docId2, {
      users: {'testuser@getgrist.com': 'viewers'}
    });

    // Check test user can access both docs
    await assert.isFulfilled(altApi.getDoc(docId));
    await assert.isFulfilled(altApi.getDoc(docId2));

    // Check test user can only list the documents shared with them
    // through a route other than public sharing
    assert.deepEqual((await altApi.getOrgWorkspaces('current'))[0].docs.map(doc => doc.name),
                     ['another example']);
    assert.deepEqual((await altApi.getWorkspace(wsId)).docs.map(doc => doc.name),
                     ['another example']);

    // Check that a viewer at org level can see all docs listed, and access them
    // (there was a bug where a doc shared with everyone@ as viewer would get hidden
    // from top-level viewers)
    await chimpyApi.updateOrgPermissions('current', {
      users: {'testuser2@getgrist.com': 'viewers'}
    });
    const altApi2 = await home.createHomeApi('testuser2', 'nasa', false, false);
    await assert.isFulfilled(altApi2.getDoc(docId));
    await assert.isFulfilled(altApi2.getDoc(docId2));
    assert.sameMembers((await altApi2.getWorkspace(wsId)).docs.map(doc => doc.name),
                       ['an example', 'another example']);
  });
});
