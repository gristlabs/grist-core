import {UserAPI} from 'app/common/UserAPI';
import {assert} from 'chai';
import {TestServer} from 'test/gen-server/apiUtils';
import * as testUtils from 'test/server/testUtils';

/**
 * Tests details of listing workspaces or documents via API.
 */
describe('listing', function() {
  this.timeout(10000);
  let home: TestServer;
  testUtils.setTmpLogLevel('error');

  const org: string = 'testy';
  let api: UserAPI;
  let viewer: UserAPI;
  let editor: UserAPI;
  let ws1: number;
  let ws2: number;
  let ws3: number;
  let doc12: string;
  let doc13: string;

  before(async function() {
    home = new TestServer(this);
    await home.start(['home', 'docs']);

    // Create a test org with some workspaces and docs
    api = await home.createHomeApi('chimpy', 'docs', true);
    await api.newOrg({name: org, domain: org});
    api = await home.createHomeApi('chimpy', org, true);
    ws1 = await api.newWorkspace({name: 'ws1'}, 'current');
    ws2 = await api.newWorkspace({name: 'ws2'}, 'current');
    ws3 = await api.newWorkspace({name: 'ws3'}, 'current');
    await api.newDoc({name: 'doc11'}, ws1);
    doc12 = await api.newDoc({name: 'doc12'}, ws1);
    doc13 = await api.newDoc({name: 'doc13'}, ws1);
    const doc21 = await api.newDoc({name: 'doc21'}, ws2);

    // add an editor and a viewer to the org.
    await api.updateOrgPermissions('current', {
      users: {
        'kiwi@getgrist.com': 'viewers',
        'support@getgrist.com': 'editors',
      }
    });
    viewer = await home.createHomeApi('kiwi', org, true);
    editor = await home.createHomeApi('support', org, true);

    // add another user as an owner of two docs and two workspaces.
    await api.updateDocPermissions(doc12, {
      users: {'charon@getgrist.com': 'owners'}
    });
    await api.updateDocPermissions(doc13, {
      users: {'charon@getgrist.com': 'owners'}
    });
    await api.updateWorkspacePermissions(ws2, {
      users: {'charon@getgrist.com': 'owners'}
    });
    await api.updateWorkspacePermissions(ws3, {
      users: {'charon@getgrist.com': 'owners'}
    });

    // Have that user remove or limit everyone else's access to those docs and workspaces.
    const charon = await home.createHomeApi('charon', org, true);
    await charon.updateWorkspacePermissions(ws2, {
      users: {'chimpy@getgrist.com': null} // remove chimpy from ws2
    });
    await charon.updateDocPermissions(doc12, {
      maxInheritedRole: null,
      users: {'chimpy@getgrist.com': null} // remove chimpy's direct access
    });
    await charon.updateDocPermissions(doc13, {
      maxInheritedRole: 'viewers',
      users: {'chimpy@getgrist.com': null} // remove chimpy's direct access
    });
    await charon.updateDocPermissions(doc21, {
      users: {'chimpy@getgrist.com': null} // remove chimpy's direct access
    });
    await charon.updateWorkspacePermissions(ws2, {
      maxInheritedRole: null,
      users: {'chimpy@getgrist.com': null} // remove chimpy's direct access
    });
    await charon.updateWorkspacePermissions(ws3, {
      maxInheritedRole: 'viewers',
      users: {'chimpy@getgrist.com': null} // remove chimpy's direct access
    });
  });

  after(async function() {
    await api.deleteOrg('testy');
    await home.stop();
  });

  // Check lists acquired via getWorkspace or via getOrgWorkspaces.
  for (const method of ['getWorkspace', 'getOrgWorkspaces'] as const) {

    it(`editors and owners can list docs they cannot view with ${method}`, async function() {
      async function list(user: UserAPI) {
        if (method === 'getWorkspace') { return user.getWorkspace(ws1); }
        return (await user.getOrgWorkspaces('current')).find(ws => ws.name === 'ws1')!;
      }

      // Check owner of a workspace can see a doc they don't have access to listed (doc12).
      let listing = await list(api);
      assert.lengthOf(listing.docs, 3);
      assert.equal(listing.docs[0].name, 'doc11');
      assert.equal(listing.docs[0].access, 'owners');
      assert.equal(listing.docs[1].name, 'doc12');
      assert.equal(listing.docs[1].access, null);
      assert.equal(listing.docs[2].name, 'doc13');
      assert.equal(listing.docs[2].access, 'viewers');

      // Editor's perspective should be like the owner.
      listing = await list(editor);
      assert.lengthOf(listing.docs, 3);
      assert.equal(listing.docs[0].name, 'doc11');
      assert.equal(listing.docs[0].access, 'editors');
      assert.equal(listing.docs[1].name, 'doc12');
      assert.equal(listing.docs[1].access, null);
      assert.equal(listing.docs[2].name, 'doc13');
      assert.equal(listing.docs[2].access, 'viewers');

      // Viewer's perspective should omit docs user has no access to.
      listing = await list(viewer);
      assert.lengthOf(listing.docs, 2);
      assert.equal(listing.docs[0].name, 'doc11');
      assert.equal(listing.docs[0].access, 'viewers');
      assert.equal(listing.docs[1].name, 'doc13');
      assert.equal(listing.docs[1].access, 'viewers');
    });
  }

  it('editors and owners CANNOT list workspaces they cannot view', async function() {
    async function list(user: UserAPI) {
      return (await user.getOrgWorkspaces('current')).filter(ws => ws.name.startsWith('ws'));
    }

    // Check owner of an org CANNOT see a workspace they don't have access to listed (ws2).
    let listing = await list(api);
    assert.lengthOf(listing, 2);
    assert.equal(listing[0].name, 'ws1');
    assert.equal(listing[0].access, 'owners');
    assert.equal(listing[1].name, 'ws3');
    assert.equal(listing[1].access, 'viewers');

    // Viewer's perspective should be similar.
    listing = await list(viewer);
    assert.lengthOf(listing, 2);
    assert.equal(listing[0].name, 'ws1');
    assert.equal(listing[0].access, 'viewers');
    assert.equal(listing[1].name, 'ws3');
    assert.equal(listing[1].access, 'viewers');
  });

  // Make sure empty workspaces do not get filtered out of listings.
  it('lists empty workspaces', async function() {
    // We'll need a second user for some operations.
    const charon = await home.createHomeApi('charon', org, true);

    // Make an empty workspace.
    await api.newWorkspace({name: 'wsEmpty'}, 'current');

    // Make a workspace with a single, inaccessible doc.
    const wsWithDoc = await api.newWorkspace({name: 'wsWithDoc'}, 'current');
    const docInaccessible = await api.newDoc({name: 'inaccessible'}, wsWithDoc);
    // Add another user as an owner of the doc.
    await api.updateDocPermissions(docInaccessible, {
      users: {'charon@getgrist.com': 'owners'}
    });
    // Now remove everyone else's access.
    await charon.updateDocPermissions(docInaccessible, {
      maxInheritedRole: null
    });

    // Make an inaccessible workspace.
    const wsInaccessible = await api.newWorkspace({name: 'wsInaccessible'}, 'current');
    // Add another user as an owner of the workspace.
    await api.updateWorkspacePermissions(wsInaccessible, {
      users: {'charon@getgrist.com': 'owners'}
    });
    // Now remove everyone else's access.
    await charon.updateWorkspacePermissions(wsInaccessible, {
      maxInheritedRole: null
    });

    for (const user of [api, editor, viewer]) {
      // Make sure both accessible workspaces are present in getOrgWorkspaces list,
      // and don't get filtered out just because they are empty.
      const listing = await user.getOrgWorkspaces('current');
      const names = listing.map(ws => ws.name);
      assert.includeMembers(names, ['wsEmpty', 'wsWithDoc']);
      assert.notInclude(names, ['wsInaccessible']);
    }
  });
});
