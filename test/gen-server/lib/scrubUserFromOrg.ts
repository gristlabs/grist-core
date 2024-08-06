import {Role} from 'app/common/roles';
import {PermissionData} from 'app/common/UserAPI';
import {assert} from 'chai';
import {TestServer} from 'test/gen-server/apiUtils';
import * as testUtils from 'test/server/testUtils';

describe('scrubUserFromOrg', function() {

  let server: TestServer;
  testUtils.setTmpLogLevel('error');

  beforeEach(async function() {
    this.timeout(5000);
    server = new TestServer(this);
    await server.start();
    // Use an empty org called "org1" created by "user1" for these tests.
    const user1 = (await server.dbManager.getUserByLogin('user1@getgrist.com'))!;
    await server.dbManager.addOrg(user1, {name: 'org1', domain: 'org1'}, {
      setUserAsOwner: false,
      useNewPlan: true
    });
  });

  afterEach(async function() {
    await server.stop();
  });

  // count how many rows there are in the group_users table, for sanity checks.
  async function countGroupUsers() {
    return await server.dbManager.connection.manager.count('group_users');
  }

  // get the home api, making sure the user's api key is set.
  async function getApi(userName: string, orgName: string) {
    const user = (await server.dbManager.getUserByLogin(`${userName}@getgrist.com`))!;
    user.apiKey = `api_key_for_${userName}`;
    await user.save();
    return server.createHomeApi(userName, orgName, true);
  }

  // check what role is listed for the given user in the results of an ACL endpoint.
  function getRole(access: PermissionData, email: string): string|null|undefined {
    const row = access.users.find(u => u.email === email);
    if (!row) { return undefined; }
    return row.access;
  }

  // list emails of all users with the given role for the given org.
  async function listOrg(domain: string, role: Role|null): Promise<string[]> {
    return (await server.listOrgMembership(domain, role))
      .map(user => user.logins[0].email);
  }

  // list emails of all users with the given role for the given workspace, via
  // directly granted access to the workspace (inherited access not considered).
  async function listWs(wsId: number, role: Role|null): Promise<string[]> {
    return (await server.listWorkspaceMembership(wsId, role))
      .map(user => user.logins[0].email);
  }

  // list all resources a user has directly been granted access to, as a list
  // of strings, each of the form "role:resource-name", such as "guests:org1".
  async function listUser(email: string) {
    return (await server.listUserMemberships(email))
      .map(membership => `${membership.role}:${membership.res.name}`).sort();
  }

  it('can remove users from orgs while preserving doc access', async function() {
    this.timeout(5000);  // takes about a second locally, so give more time to
                         // avoid occasional slow runs on jenkins.
    // In test org "org1", create a test workspace "ws1" and a test document "doc1"
    const user1 = await getApi('user1', 'org1');
    const wsId = await user1.newWorkspace({name: 'ws1'}, 'current');
    const docId = await user1.newDoc({name: 'doc1'}, wsId);

    // Initially the org has only 1 guest - the creator.
    assert.sameMembers(await listOrg('org1', 'guests'), ['user1@getgrist.com']);

    // Add a set of users to doc1
    await user1.updateDocPermissions(docId, {
      maxInheritedRole: 'viewers',
      users: {
        'user2@getgrist.com': 'owners',
        'user3@getgrist.com': 'owners',
        'user4@getgrist.com': 'editors',
        'user5@getgrist.com': 'owners',
      }
    });

    // Check that the org now has the expected guests.  Even user1, who has
    // direct access to the org, will be listed as a guest as well.
    assert.sameMembers(await listOrg('org1', 'guests'),
                       ['user1@getgrist.com', 'user2@getgrist.com', 'user3@getgrist.com',
                        'user4@getgrist.com', 'user5@getgrist.com']);
    // Check the the workspace also has the expected guests.
    assert.sameMembers(await listWs(wsId, 'guests'),
                       ['user1@getgrist.com', 'user2@getgrist.com', 'user3@getgrist.com',
                        'user4@getgrist.com', 'user5@getgrist.com']);

    // Get the home api from user2's perspective (so we can tweak user1's access to doc1).
    const user2 = await getApi('user2', 'org1');

    // Confirm that user3's maximal role on the org currently is as a guest.
    let access = await user1.getOrgAccess('current');
    assert.equal(getRole(access, 'user3@getgrist.com'), 'guests');

    // Check that user1 is an owner on the doc (this happens when the doc's permissions
    // were updated by user1, since the user changing access must remain an owner).
    access = await user1.getDocAccess(docId);
    assert.equal(getRole(access, 'user1@getgrist.com'), 'owners');

    // Lower user1's access to the doc.
    await user2.updateDocPermissions(docId, {
      users: { 'user1@getgrist.com': 'viewers' }
    });
    access = await user2.getDocAccess(docId);
    assert.equal(getRole(access, 'user1@getgrist.com'), 'viewers');

    // Have user1 change user3's access to the org.
    await user1.updateOrgPermissions('current', {
      users: { 'user3@getgrist.com': 'viewers' }
    });
    access = await user2.getDocAccess(docId);
    assert.equal(getRole(access, 'user1@getgrist.com'), 'viewers');
    assert.equal(getRole(access, 'user3@getgrist.com'), 'owners');

    // Ok, that has all been preamble.  Now to test user removal.
    // Have user1 remove user3's access to the org, checking user1+user3's access before and after.
    let countBefore = await countGroupUsers();
    assert.sameMembers(await listUser('user3@getgrist.com'),
                       ['viewers:org1', 'guests:org1', 'guests:ws1', 'owners:Personal', 'owners:doc1']);
    assert.sameMembers(await listUser('user1@getgrist.com'),
                       ['owners:org1', 'guests:org1', 'owners:ws1', 'guests:ws1', 'owners:Personal', 'viewers:doc1']);
    await user1.updateOrgPermissions('current', {
      users: { 'user3@getgrist.com': null }
    });
    let countAfter = await countGroupUsers();
    // The only resource user3 has access to now is their personal org.
    assert.sameMembers(await listUser('user3@getgrist.com'), ['owners:Personal']);
    assert.sameMembers(await listUser('user1@getgrist.com'),
                       ['owners:org1', 'guests:org1', 'guests:ws1', 'owners:ws1', 'owners:Personal', 'owners:doc1']);
    assert.sameMembers(await listOrg('org1', 'guests'),
                       ['user1@getgrist.com', 'user2@getgrist.com',
                        'user4@getgrist.com', 'user5@getgrist.com']);
    assert.sameMembers(await listWs(wsId, 'guests'),
                       ['user1@getgrist.com', 'user2@getgrist.com',
                        'user4@getgrist.com', 'user5@getgrist.com']);
    // For overall count of rows in group_users table, here are the changes:
    //  - Drops: user3 as owner of doc, editor on org, guest on ws and org.
    //  - Changes: user1 from editor to owner of doc.
    assert.equal(countAfter, countBefore - 4);

    // Check view API that user3 is removed from the doc, and Owner1 promoted to owner.
    access = await user2.getDocAccess(docId);
    assert.equal(getRole(access, 'user3@getgrist.com'), undefined);
    assert.equal(getRole(access, 'user1@getgrist.com'), 'owners');

    // Lower user1's access to the doc again.
    await user2.updateDocPermissions(docId, {
      users: { 'user1@getgrist.com': 'viewers' }
    });
    access = await user2.getDocAccess(docId);
    assert.equal(getRole(access, 'user1@getgrist.com'), 'viewers');

    // Now have user1 remove user4's access to the org.
    countBefore = await countGroupUsers();
    await user1.updateOrgPermissions('current', {
      users: { 'user4@getgrist.com': null }
    });
    countAfter = await countGroupUsers();

    // Drops: user4 as editor of doc, guest on ws and org.
    // Adds: nothing.
    assert.equal(countAfter, countBefore - 3);
    assert.sameMembers(await listOrg('org1', 'guests'),
                       ['user1@getgrist.com', 'user2@getgrist.com', 'user5@getgrist.com']);

    // User4 should be removed from the doc, and user1's access unchanged (since user4 was
    // not an owner)
    access = await user2.getDocAccess(docId);
    assert.equal(getRole(access, 'user4@getgrist.com'), undefined);
    assert.equal(getRole(access, 'user1@getgrist.com'), 'viewers');

    // Now have a fresh user remove user5's access to the org.
    await user1.updateOrgPermissions('current', {
      users: {
        'user6@getgrist.com': 'owners',
      }
    });
    const user6 = await getApi('user6', 'org1');
    countBefore = await countGroupUsers();
    await user6.updateOrgPermissions('current', {
      users: { 'user5@getgrist.com': null }
    });
    countAfter = await countGroupUsers();

    // Drops: user5 as owner of doc, guest on ws and org.
    // Adds: user6 as owner of doc, guest on ws and org.
    assert.equal(countAfter, countBefore);
    assert.sameMembers(await listOrg('org1', 'guests'),
                       ['user1@getgrist.com', 'user2@getgrist.com', 'user6@getgrist.com']);
    assert(getRole(await user1.getWorkspaceAccess(wsId), 'user6@getgrist.com'), 'guests');
  });

  it('can remove users from orgs while preserving workspace access', async function() {
    this.timeout(5000);  // takes about a second locally, so give more time to
                         // avoid occasional slow runs on jenkins.
    // In test org "org1", create a test workspace "ws1"
    const user1 = await getApi('user1', 'org1');
    const wsId = await user1.newWorkspace({name: 'ws1'}, 'current');

    // Initially the org has 1 guest - the creator.
    assert.sameMembers(await listOrg('org1', 'guests'), ['user1@getgrist.com' ]);

    // Add a set of users to ws1
    await user1.updateWorkspacePermissions(wsId, {
      maxInheritedRole: 'viewers',
      users: {
        'user2@getgrist.com': 'owners',
        'user3@getgrist.com': 'owners',
        'user4@getgrist.com': 'editors',
        'user5@getgrist.com': 'owners',
      }
    });

    // Check that the org now has the expected guests.  Even user1, who has
    // direct access to the org, will be listed as a guest as well.
    assert.sameMembers(await listOrg('org1', 'guests'),
                       ['user1@getgrist.com', 'user2@getgrist.com', 'user3@getgrist.com',
                        'user4@getgrist.com', 'user5@getgrist.com']);
    // Check the the workspace has no guests.
    assert.sameMembers(await listWs(wsId, 'guests'), []);

    // Get the home api from user2's perspective (so we can tweak user1's access to ws1).
    const user2 = await getApi('user2', 'org1');

    // Confirm that user3's maximal role on the org currently is as a guest.
    let access = await user1.getOrgAccess('current');
    assert.equal(getRole(access, 'user3@getgrist.com'), 'guests');

    // Check that user1 is an owner on ws1 (this happens when the workspace's permissions
    // were updated by user1, since the user changing access must remain an owner).
    access = await user1.getWorkspaceAccess(wsId);
    assert.equal(getRole(access, 'user1@getgrist.com'), 'owners');

    // Lower user1's access to the workspace.
    await user2.updateWorkspacePermissions(wsId, {
      users: { 'user1@getgrist.com': 'viewers' }
    });
    access = await user2.getWorkspaceAccess(wsId);
    assert.equal(getRole(access, 'user1@getgrist.com'), 'viewers');

    // Have user1 change user3's access to the org.
    await user1.updateOrgPermissions('current', {
      users: { 'user3@getgrist.com': 'viewers' }
    });
    access = await user2.getWorkspaceAccess(wsId);
    assert.equal(getRole(access, 'user1@getgrist.com'), 'viewers');
    assert.equal(getRole(access, 'user3@getgrist.com'), 'owners');

    // Ok, that has all been preamble.  Now to test user removal.
    // Have user1 remove user3's access to the org, checking user1+user3's access before and after.
    let countBefore = await countGroupUsers();
    assert.sameMembers(await listUser('user3@getgrist.com'),
                       ['viewers:org1', 'guests:org1', 'owners:Personal', 'owners:ws1']);
    assert.sameMembers(await listUser('user1@getgrist.com'),
                       ['owners:org1', 'guests:org1', 'owners:Personal', 'viewers:ws1']);
    await user1.updateOrgPermissions('current', {
      users: { 'user3@getgrist.com': null }
    });
    let countAfter = await countGroupUsers();
    // The only resource user3 has access to now is their personal org.
    assert.sameMembers(await listUser('user3@getgrist.com'), ['owners:Personal']);
    assert.sameMembers(await listUser('user1@getgrist.com'),
                       ['owners:org1', 'guests:org1', 'owners:Personal', 'owners:ws1']);
    assert.sameMembers(await listOrg('org1', 'guests'),
                       ['user1@getgrist.com', 'user2@getgrist.com',
                        'user4@getgrist.com', 'user5@getgrist.com']);
    assert.sameMembers(await listWs(wsId, 'guests'), []);
    // For overall count of rows in group_users table, here are the changes:
    //  - Drops: user3 as owner of ws, editor on org, guest on org.
    //  - Changes: user1 from editor to owner of ws.
    assert.equal(countAfter, countBefore - 3);

    // Check view API that user3 is removed from the workspace, and Owner1 promoted to owner.
    access = await user2.getWorkspaceAccess(wsId);
    assert.equal(getRole(access, 'user3@getgrist.com'), undefined);
    assert.equal(getRole(access, 'user1@getgrist.com'), 'owners');

    // Lower user1's access to the workspace again.
    await user2.updateWorkspacePermissions(wsId, {
      users: { 'user1@getgrist.com': 'viewers' }
    });
    access = await user2.getWorkspaceAccess(wsId);
    assert.equal(getRole(access, 'user1@getgrist.com'), 'viewers');

    // Now have user1 remove user4's access to the org.
    countBefore = await countGroupUsers();
    await user1.updateOrgPermissions('current', {
      users: { 'user4@getgrist.com': null }
    });
    countAfter = await countGroupUsers();

    // Drops: user4 as editor of ws, guest on org.
    // Adds: nothing.
    assert.equal(countAfter, countBefore - 2);
    assert.sameMembers(await listOrg('org1', 'guests'),
                       ['user1@getgrist.com', 'user2@getgrist.com', 'user5@getgrist.com']);

    // User4 should be removed from the workspace, and user1's access unchanged (since user4 was
    // not an owner)
    access = await user2.getWorkspaceAccess(wsId);
    assert.equal(getRole(access, 'user4@getgrist.com'), undefined);
    assert.equal(getRole(access, 'user1@getgrist.com'), 'viewers');

    // Now have a fresh user remove user5's access to the org.
    await user1.updateOrgPermissions('current', {
      users: {
        'user6@getgrist.com': 'owners',
      }
    });
    const user6 = await getApi('user6', 'org1');
    countBefore = await countGroupUsers();
    await user6.updateOrgPermissions('current', {
      users: { 'user5@getgrist.com': null }
    });
    countAfter = await countGroupUsers();

    // Drops: user5 as owner of workspace, guest on org.
    // Adds: user6 as owner of workspace, guest on org.
    assert.equal(countAfter, countBefore);
    assert.sameMembers(await listOrg('org1', 'guests'),
                       ['user1@getgrist.com', 'user2@getgrist.com', 'user6@getgrist.com']);
  });

  it('cannot remove users from orgs without permission', async function() {
    // In test org "org1", create a test workspace "ws1" and a test document "doc1".
    const user1 = await getApi('user1', 'org1');
    const wsId = await user1.newWorkspace({name: 'ws1'}, 'current');
    const docId = await user1.newDoc({name: 'doc1'}, wsId);

    // Add user2 and user3 as owners of doc1
    await user1.updateDocPermissions(docId, {
      users: {
        'user2@getgrist.com': 'owners',
        'user3@getgrist.com': 'owners',
      }
    });

    // Add user2 and user3 as owners of ws1
    await user1.updateWorkspacePermissions(wsId, {
      users: {
        'user2@getgrist.com': 'owners',
        'user3@getgrist.com': 'owners',
      }
    });

    // Add user2 as member of org, add user3 as editor of org
    await user1.updateOrgPermissions('current', {
      users: {
        'user2@getgrist.com': 'members',
        'user3@getgrist.com': 'editors',
      }
    });

    // user3 should not have the right to remove user2 from org
    const user3 = await getApi('user3', 'org1');
    await assert.isRejected(user3.updateOrgPermissions('current', {
      users: { 'user2@getgrist.com': null }
    }));

    // user2 should not have the right to remove user3 from org
    const user2 = await getApi('user2', 'org1');
    await assert.isRejected(user2.updateOrgPermissions('current', {
      users: { 'user3@getgrist.com': null }
    }));

    // user2 and user3 should still have same access as before
    assert.sameMembers(await listUser('user2@getgrist.com'),
                       ['owners:Personal', 'members:org1', 'owners:ws1', 'owners:doc1',
                        'guests:org1', 'guests:ws1']);
    assert.sameMembers(await listUser('user3@getgrist.com'),
                       ['owners:Personal', 'editors:org1', 'owners:ws1', 'owners:doc1',
                        'guests:org1', 'guests:ws1']);
  });

  it('does not scrub user for removal from workspace or doc', async function() {
    // In test org "org1", create a test workspace "ws1" and a test document "doc1".
    const user1 = await getApi('user1', 'org1');
    const wsId = await user1.newWorkspace({name: 'ws1'}, 'current');
    const docId = await user1.newDoc({name: 'doc1'}, wsId);

    // Add user2 and user3 as owners of doc1
    await user1.updateDocPermissions(docId, {
      users: {
        'user2@getgrist.com': 'owners',
        'user3@getgrist.com': 'owners',
      }
    });

    // Add user2 and user3 as owners of ws1
    await user1.updateWorkspacePermissions(wsId, {
      users: {
        'user2@getgrist.com': 'owners',
        'user3@getgrist.com': 'owners',
      }
    });

    // Add user2 as member of org, add user3 as editor of org
    await user1.updateOrgPermissions('current', {
      users: {
        'user2@getgrist.com': 'members',
        'user3@getgrist.com': 'editors',
      }
    });

    // user3 can removed user2 from workspace
    const user3 = await getApi('user3', 'org1');
    await user3.updateWorkspacePermissions(wsId, {
      users: { 'user2@getgrist.com': null }
    });

    // user3's access should be unchanged
    assert.sameMembers(await listUser('user3@getgrist.com'),
                       ['owners:Personal', 'editors:org1', 'owners:ws1', 'owners:doc1',
                        'guests:org1', 'guests:ws1']);
    // user2's access should be changed just as requested
    assert.sameMembers(await listUser('user2@getgrist.com'),
                       ['owners:Personal', 'members:org1', 'owners:doc1',
                        'guests:org1', 'guests:ws1']);

    // put user2 back in workspace
    await user3.updateWorkspacePermissions(wsId, {
      users: { 'user2@getgrist.com': 'owners' }
    });
    assert.sameMembers(await listUser('user2@getgrist.com'),
                       ['owners:Personal', 'members:org1', 'owners:ws1', 'owners:doc1',
                        'guests:org1', 'guests:ws1']);

    // user3 can removed user2 from doc
    await user3.updateDocPermissions(docId, {
      users: { 'user2@getgrist.com': null }
    });

    // user3's access should be unchanged
    assert.sameMembers(await listUser('user3@getgrist.com'),
                       ['owners:Personal', 'editors:org1', 'owners:ws1', 'owners:doc1',
                        'guests:org1', 'guests:ws1']);
    // user2's access should be changed just as requested
    assert.sameMembers(await listUser('user2@getgrist.com'),
                       ['owners:Personal', 'members:org1', 'owners:ws1', 'guests:org1']);
  });
});
