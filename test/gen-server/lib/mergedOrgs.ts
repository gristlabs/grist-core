import {Workspace} from 'app/common/UserAPI';
import {HomeDBManager} from 'app/gen-server/lib/homedb/HomeDBManager';
import {FlexServer} from 'app/server/lib/FlexServer';
import {MergedServer} from 'app/server/MergedServer';
import axios from 'axios';
import {assert} from 'chai';
import {createInitialDb, removeConnection, setUpDB} from 'test/gen-server/seed';
import {configForUser, createUser, setPlan} from 'test/gen-server/testUtils';
import * as testUtils from 'test/server/testUtils';

describe('mergedOrgs', function() {
  let mergedServer: MergedServer;
  let home: FlexServer;
  let dbManager: HomeDBManager;
  let homeUrl: string;
  let sharedOrgDomain: string;
  let sharedDocId: string;

  testUtils.setTmpLogLevel('error');

  before(async function() {
    setUpDB(this);
    await createInitialDb();
    mergedServer = await MergedServer.create(0, ["home", "docs"],
                                  {logToConsole: false, externalStorage: false});
    home = mergedServer.flexServer;
    await mergedServer.run();
    dbManager = home.getHomeDBManager();
    homeUrl = home.getOwnUrl();
  });

  after(async function() {
    await home.close();
    await removeConnection();
  });

  it('can list all shared workspaces from personal orgs', async function() {
    // Org "0" or "docs" is a special pseudo-org, with the merged results of all
    // workspaces in personal orgs that user has access to.
    let resp = await axios.get(`${homeUrl}/api/orgs/0/workspaces`, configForUser('chimpy'));
    assert.equal(resp.status, 200);
    // See only workspaces in Chimpy's personal org so far.
    assert.sameMembers(resp.data.map((w: Workspace) => w.name), ['Public', 'Private']);
    // Grant Chimpy access to Kiwi's personal org, and add a workspace to it.
    const kiwilandOrgId = await dbManager.testGetId('Kiwiland');
    resp = await axios.patch(`${homeUrl}/api/orgs/${kiwilandOrgId}/access`, {
      delta: {users: {'chimpy@getgrist.com': 'editors'}}
    }, configForUser('kiwi'));
    resp = await axios.post(`${homeUrl}/api/orgs/${kiwilandOrgId}/workspaces`, {
      name: 'Kiwidocs'
    }, configForUser('kiwi'));
    resp = await axios.get(`${homeUrl}/api/orgs/0/workspaces`, configForUser('chimpy'));
    assert.sameMembers(resp.data.map((w: Workspace) => w.name), ['Private', 'Public', 'Kiwidocs']);

    // Create a new user with two workspaces, add chimpy to a document within
    // one of them, and make sure chimpy sees that workspace.
    const samHome = await createUser(dbManager, 'Sam');
    await setPlan(dbManager, samHome, 'Free');
    sharedOrgDomain = samHome.domain;
    // A private workspace/doc that Sam won't share.
    resp = await axios.post(`${homeUrl}/api/orgs/${samHome.id}/workspaces`, {
      name: 'SamPrivateStuff'
    }, configForUser('sam'));
    assert.equal(resp.status, 200);
    let wsId = resp.data;
    resp = await axios.post(`${homeUrl}/api/workspaces/${wsId}/docs`, {
      name: 'SamPrivateDoc'
    }, configForUser('sam'));
    assert.equal(resp.status, 200);
    // A workspace/doc that Sam will share with Chimpy.
    resp = await axios.post(`${homeUrl}/api/orgs/${samHome.id}/workspaces`, {
      name: 'SamStuff'
    }, configForUser('sam'));
    assert.equal(resp.status, 200);
    wsId = resp.data!;
    resp = await axios.post(`${homeUrl}/api/workspaces/${wsId}/docs`, {
      name: 'SamDoc'
    }, configForUser('sam'));
    assert.equal(resp.status, 200);
    sharedDocId = resp.data!;
    resp = await axios.patch(`${homeUrl}/api/docs/${sharedDocId}/access`, {
      delta: {users: {'chimpy@getgrist.com': 'viewers'}}
    }, configForUser('sam'));
    assert.equal(resp.status, 200);
    resp = await axios.get(`${homeUrl}/api/orgs/0/workspaces`, configForUser('chimpy'));
    const sharedWss = ['Private', 'Public', 'Kiwidocs', 'SamStuff'];
    assert.sameMembers(resp.data.map((w: Workspace) => w.name), sharedWss);

    // Check that all this is visible from docs domain expressed in different ways.
    resp = await axios.get(`${homeUrl}/o/docs/api/orgs/current/workspaces`, configForUser('chimpy'));
    assert.sameMembers(resp.data.map((w: Workspace) => w.name), sharedWss);
    resp = await axios.get(`${homeUrl}/api/orgs/docs/workspaces`, configForUser('chimpy'));
    assert.sameMembers(resp.data.map((w: Workspace) => w.name), sharedWss);
  });

  it('can access a document under merged domain', async function() {
    let resp = await axios.get(`${homeUrl}/o/docs/api/docs/${sharedDocId}/tables/Table1/data`,
                               configForUser('chimpy'));
    assert.equal(resp.status, 200);
    resp = await axios.get(`${homeUrl}/o/${sharedOrgDomain}/api/docs/${sharedDocId}/tables/Table1/data`,
                           configForUser('chimpy'));
    assert.equal(resp.status, 200);
    resp = await axios.get(`${homeUrl}/o/nasa/api/docs/${sharedDocId}/tables/Table1/data`,
                           configForUser('chimpy'));
    assert.equal(resp.status, 404);
  });
});
