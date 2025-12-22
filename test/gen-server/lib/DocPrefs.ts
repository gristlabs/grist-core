import {assert} from 'chai';
import {DocPrefs} from 'app/common/Prefs';
import {DocScope, HomeDBManager} from 'app/gen-server/lib/homedb/HomeDBManager';
import {FullUser} from 'app/common/LoginSessionAPI';
import {TestServer} from 'test/gen-server/apiUtils';
import * as testUtils from 'test/server/testUtils';

describe('DocPrefs', function() {

  this.timeout(60000);
  testUtils.setTmpLogLevel('error');

  const org = 'docprefs';
  let dbManager: HomeDBManager;
  let server: TestServer;

  const everyoneEmail = 'everyone@getgrist.com';
  const users = {
    owner: {email: 'chimpy@getgrist.com'} as FullUser,
    editor: {email: 'kiwi@getgrist.com'} as FullUser,
    viewer: {email: 'charon@getgrist.com'} as FullUser,
    nonmember: {email: 'ham@getgrist.com'} as FullUser,
  };

  const docs: {
    privateDoc: string;
    publicDoc: string;
  } = {} as any;

  before(async function setUp(this: Mocha.Context) {
    server = new TestServer(this);
    await server.start(['home', 'docs']);
    dbManager = server.dbManager;

    // Fill in user info, to use throughout the test.
    for (const profile of Object.values(users)) {
      Object.assign(profile, await dbManager.getExistingUserByLogin(profile.email));
    }

    // Create an org, with a couple of documents with different sharing.
    const api = await server.createHomeApi('chimpy', 'docs');
    await api.newOrg({name: 'docprefs', domain: org});
    const ws1 = await api.newWorkspace({name: 'ws1'}, org);
    docs.privateDoc = await api.newDoc({name: 'docPrivate'}, ws1);
    docs.publicDoc = await api.newDoc({name: 'docPublic'}, ws1);

    await api.updateDocPermissions(docs.privateDoc, {
      users: {
        [users.viewer.email]: 'viewers',
        [users.editor.email]: 'editors',
      },
    });
    await api.updateDocPermissions(docs.publicDoc, {
      users: {
        [users.viewer.email]: 'viewers',
        [users.editor.email]: 'editors',
        [everyoneEmail]: 'editors',
      },
    });
  });

  after(async function tearDown() {
    const api = await server.createHomeApi('chimpy', 'docs');
    await api.deleteOrg(org);
    await server.stop();
  });

  function samplePrefs(num: number): DocPrefs {
    return {foo: {num}} as DocPrefs;
  }

  for (const docName of ['privateDoc', 'publicDoc'] as const) {
    describe(docName, function() {

      function getScope(user: keyof typeof users): DocScope {
        return {userId: users[user].id, org, urlId: docs[docName]};
      }

      it('should support default and per-user prefs', async function() {
        await dbManager.setDocPrefs(getScope('owner'),
          {docDefaults: samplePrefs(1), currentUser: samplePrefs(2)});

        // Check that a viewer can see this, and can set their own overrides.
        assert.deepEqual(await dbManager.getDocPrefs(getScope('viewer')),
          {docDefaults: samplePrefs(1), currentUser: {}});
        await dbManager.setDocPrefs(getScope('viewer'), {currentUser: samplePrefs(3)});

        // Check that various users see correct state.
        assert.deepEqual(await dbManager.getDocPrefs(getScope('owner')),
          {docDefaults: samplePrefs(1), currentUser: samplePrefs(2)});
        assert.deepEqual(await dbManager.getDocPrefs(getScope('editor')),
          {docDefaults: samplePrefs(1), currentUser: {}});
        assert.deepEqual(await dbManager.getDocPrefs(getScope('viewer')),
          {docDefaults: samplePrefs(1), currentUser: samplePrefs(3)});
      });

      it('should fetch correctly merged prefs for a list of users', async function() {
        // Note: this is stateful: we are starting with the prefs set by the previous test case.
        const userIds = [users.owner.id, users.editor.id, users.viewer.id];
        assert.deepEqual(Array.from(await dbManager.getDocPrefsForUsers(docs[docName], userIds)), [
          [null, samplePrefs(1)], // doc defaults
          [users.owner.id, samplePrefs(2)],
          [users.viewer.id, samplePrefs(3)],
        ]);

        assert.deepEqual(Array.from(await dbManager.getDocPrefsForUsers(docs[docName], [users.editor.id])), [
          [null, samplePrefs(1)], // doc defaults
        ]);

        assert.deepEqual(Array.from(await dbManager.getDocPrefsForUsers(docs[docName], 'any')), [
          [null, samplePrefs(1)], // doc defaults
          [users.owner.id, samplePrefs(2)],
          [users.viewer.id, samplePrefs(3)],
        ]);
      });

      it('should check access for prefs', async function() {
        // Note: this is stateful: we are starting with the prefs set by the previous test case.
        const updateRej = /Only document owners may update document prefs/;

        // Non-owners cannot change defaults.
        await assert.isRejected(dbManager.setDocPrefs(getScope('viewer'), {docDefaults: samplePrefs(4)}),
          updateRej);
        await assert.isRejected(dbManager.setDocPrefs(
          getScope('viewer'), {docDefaults: samplePrefs(5), currentUser: samplePrefs(6)}),
        updateRej);
        await assert.isRejected(dbManager.setDocPrefs(getScope('editor'), {docDefaults: samplePrefs(7)}),
          updateRej);

        // Non-collaborators cannot do anything.
        await assert.isRejected(dbManager.getDocPrefs(getScope('nonmember')),
          /access denied/);
        await assert.isRejected(dbManager.setDocPrefs(getScope('nonmember'), {docDefaults: samplePrefs(8)}),
          /access denied/);
        await assert.isRejected(dbManager.setDocPrefs(getScope('nonmember'), {currentUser: samplePrefs(9)}),
          /access denied/);

        if (docName === 'publicDoc') {
          // Check that we are testing what we intend: nonMemberScope CAN access the document here.
          assert.equal((await dbManager.getDoc(getScope('nonmember'))).access, 'editors');
        }

        // Ensure that failed attempts didn't affect what we stored (see previous test case).
        assert.deepEqual(await dbManager.getDocPrefs(getScope('owner')),
          {docDefaults: samplePrefs(1), currentUser: samplePrefs(2)});
        assert.deepEqual(await dbManager.getDocPrefs(getScope('editor')),
          {docDefaults: samplePrefs(1), currentUser: {}});
        assert.deepEqual(await dbManager.getDocPrefs(getScope('viewer')),
          {docDefaults: samplePrefs(1), currentUser: samplePrefs(3)});
      });
    });
  }
});
