import {UserAPI} from 'app/common/UserAPI';
import {Document} from 'app/gen-server/entity/Document';
import {assert} from 'chai';
import {TestServer} from 'test/gen-server/apiUtils';
import * as testUtils from 'test/server/testUtils';

describe('urlIds', function() {
  let home: TestServer;
  let supportWorkspaceId: number;
  testUtils.setTmpLogLevel('error');

  before(async function() {
    home = new TestServer(this);
    await home.start(["home", "docs"]);
    const api = await home.createHomeApi('chimpy', 'nasa');
    await api.updateOrgPermissions('current', {users: {
      'testuser1@getgrist.com': 'owners',
      'testuser2@getgrist.com': 'owners',
    }});

    // Share a workspace in support's personal org with everyone
    const support = await home.newSession().createHomeApi('Support', 'docs');
    await home.upgradePersonalOrg('Support');
    supportWorkspaceId = await support.newWorkspace({name: 'Examples & Templates'}, 'current');
    await support.newDoc({name: 'an example', urlId: 'example'}, supportWorkspaceId);
    await support.updateWorkspacePermissions(supportWorkspaceId, {
      users: {'everyone@getgrist.com': 'viewers',
              'anon@getgrist.com': 'viewers'}
    });
    // Update special workspace informationn
    await home.dbManager.initializeSpecialIds();
  });

  after(async function() {
    // Undo test-specific configuration
    const api = await home.createHomeApi('chimpy', 'nasa');
    await api.updateOrgPermissions('current', {users: {
      'testuser1@getgrist.com': null,
      'testuser2@getgrist.com': null,
    }});
    const support = await home.newSession().createHomeApi('Support', 'docs');
    await support.deleteWorkspace(supportWorkspaceId);
    await home.dbManager.initializeSpecialIds();

    await home.stop();
  });

  for (const org of ['docs', 'nasa']) {
    it(`cannot set two docs to the same urlId in ${org}`, async function() {
      const api1 = await home.newSession().createHomeApi('testuser1', org);
      const api2 = await home.newSession().createHomeApi('testuser2', org);
      const ws1 = await getAnyWorkspace(api1);
      const ws2 = await getAnyWorkspace(api2);
      const doc1 = await api1.newDoc({name: 'testdoc1', urlId: 'urlid-common'}, ws1);
      await assert.isRejected(api2.newDoc({name: 'testdoc2', urlId: 'urlid-common'}, ws2),
                              /urlId already in use/);
      assert((await api1.getDoc('urlid-common')).id, doc1);
      assert((await api1.getDoc('urlid-common')).urlId, 'urlid-common');
      await api1.deleteDoc(doc1);
    });

    it(`can set two docs to different urlIds in ${org}`, async function() {
      const api1 = await home.newSession().createHomeApi('testuser1', org);
      const api2 = await home.newSession().createHomeApi('testuser2', org);
      const ws1 = await getAnyWorkspace(api1);
      const ws2 = await getAnyWorkspace(api2);
      const doc1 = await api1.newDoc({name: 'testdoc1', urlId: 'urlid1'}, ws1);
      const doc2 = await api2.newDoc({name: 'testdoc2', urlId: 'urlid2'}, ws2);
      assert((await api1.getDoc('urlid1')).id, doc1);
      assert((await api1.getDoc('urlid1')).urlId, 'urlid1');
      assert((await api2.getDoc('urlid2')).id, doc2);
      assert((await api2.getDoc('urlid2')).urlId, 'urlid2');
    });

    it(`cannot reuse example urlIds in ${org}`, async function() {
      const api1 = await home.newSession().createHomeApi('testuser1', org);
      const ws1 = await getAnyWorkspace(api1);
      await assert.isRejected(api1.newDoc({name: 'my example', urlId: 'example'}, ws1),
                              /urlId already in use/);
    });

    it(`cannot use an existing docId as a urlId in ${org}`, async function() {
      const doc = await home.dbManager.connection.manager.findOneOrFail(Document, {where: {}});
      const prevDocId = doc.id;
      try {
        // Change doc id to ensure it has characters permitted for a urlId.
        // Not all docIds are like that (test doc ids have underscores; current
        // style doc ids typically have capital letters in them).
        doc.id = 'doc-id';
        await doc.save();
        const api1 = await home.newSession().createHomeApi('testuser1', org);
        const ws1 = await getAnyWorkspace(api1);
        await assert.isRejected(api1.newDoc({name: 'my example', urlId: doc.id}, ws1),
                                /urlId already in use as document id/);
      } finally {
        doc.id = prevDocId;
        await doc.save();
      }
    });

    it(`cannot reuse urlIds from ${org} in examples`, async function() {
      const api1 = await home.newSession().createHomeApi('testuser1', org);
      const ws1 = await getAnyWorkspace(api1);
      await api1.newDoc({name: 'my example', urlId: `urlid-${org}`}, ws1);
      const support = await home.newSession().createHomeApi('Support', 'docs');
      await assert.isRejected(support.newDoc({name: 'my conflicting example',
                                              urlId: `urlid-${org}`}, supportWorkspaceId),
                              /urlId already in use/);
    });
  }

  it(`correctly uses org information for urlId disambiguation`, async function() {
    const api1 = await home.newSession().createHomeApi('testuser1', 'docs');
    const api2 = await home.newSession().createHomeApi('testuser2', 'nasa');
    const ws1 = await getAnyWorkspace(api1);
    const ws2 = await getAnyWorkspace(api2);
    const doc1 = await api1.newDoc({name: 'testdoc1', urlId: 'urlid-common'}, ws1);
    const doc2 = await api2.newDoc({name: 'testdoc2', urlId: 'urlid-common'}, ws2);
    assert.equal((await api1.getDoc('urlid-common')).id, doc1);
    assert.equal((await api2.getDoc('urlid-common')).id, doc2);
    await api1.updateDoc('urlid-common', {name: 'testdoc1-updated'});
    await api2.updateDoc('urlid-common', {name: 'testdoc2-updated'});
    assert.equal((await api1.getDoc('urlid-common')).name, 'testdoc1-updated');
    assert.equal((await api2.getDoc('urlid-common')).name, 'testdoc2-updated');
  });

  async function getAnyWorkspace(api: UserAPI) {
    const workspaces = await api.getOrgWorkspaces('current');
    return workspaces[0]!.id;
  }
});
