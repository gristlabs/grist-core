import axios, {AxiosRequestConfig, AxiosResponse} from 'axios';
import * as chai from 'chai';
import omit = require('lodash/omit');
import {configForUser, configWithPermit, getRowCounts as getRowCountsForDb} from 'test/gen-server/testUtils';
import * as testUtils from 'test/server/testUtils';

import {createEmptyOrgUsageSummary, OrgUsageSummary} from 'app/common/DocUsage';
import {Document, Workspace} from 'app/common/UserAPI';
import {Organization} from 'app/gen-server/entity/Organization';
import {Product} from 'app/gen-server/entity/Product';
import {HomeDBManager, UserChange} from 'app/gen-server/lib/HomeDBManager';
import {TestServer} from 'test/gen-server/apiUtils';

const assert = chai.assert;

let server: TestServer;
let dbManager: HomeDBManager;
let homeUrl: string;
let userCountUpdates: {[orgId: number]: number[]} = {};

const chimpy = configForUser('Chimpy');
const kiwi = configForUser('Kiwi');
const charon = configForUser('Charon');
const support = configForUser('Support');
const nobody = configForUser('Anonymous');

const chimpyEmail = 'chimpy@getgrist.com';
const kiwiEmail = 'kiwi@getgrist.com';
const charonEmail = 'charon@getgrist.com';

let chimpyRef = '';
let kiwiRef = '';
let charonRef = '';

async function getRowCounts() {
  return getRowCountsForDb(dbManager);
}

describe('ApiServer', function() {
  let oldEnv: testUtils.EnvironmentSnapshot;

  testUtils.setTmpLogLevel('error');

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_TEMPLATE_ORG = 'templates';
    server = new TestServer(this);
    homeUrl = await server.start(['home', 'docs']);
    dbManager = server.dbManager;

    chimpyRef = await dbManager.getUserByLogin(chimpyEmail).then((user) => user!.ref);
    kiwiRef = await dbManager.getUserByLogin(kiwiEmail).then((user) => user!.ref);
    charonRef = await dbManager.getUserByLogin(charonEmail).then((user) => user!.ref);

    // Listen to user count updates and add them to an array.
    dbManager.on('userChange', ({org, countBefore, countAfter}: UserChange) => {
      if (countBefore === countAfter) { return; }
      userCountUpdates[org.id] = userCountUpdates[org.id] || [];
      userCountUpdates[org.id].push(countAfter);
    });
  });

  afterEach(async function() {
    userCountUpdates = {};
    await server.sanityCheck();
  });

  after(async function() {
    oldEnv.restore();
    await server.stop();
  });

  it('GET /api/orgs reports nothing for anonymous without org in url', async function() {
    const resp = await axios.get(`${homeUrl}/api/orgs`, nobody);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, []);
  });

  it('GET /api/orgs reports nothing for anonymous with unavailable org', async function() {
    const resp = await axios.get(`${homeUrl}/o/deep/api/orgs`, nobody);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, []);
  });

  for (const users of [['anon'], ['anon', 'everyone'], ['everyone']]) {
    it(`GET /api/orgs reports something for anonymous with org available to ${users.join(', ')}`, async function() {
      const addUsers: {[key: string]: 'viewers'|'owners'} = {};
      const removeUsers: {[key: string]: null} = {};
      for (const user of users) {
        const email = `${user}@getgrist.com`;
        addUsers[email] = 'viewers';
        removeUsers[email] = null;
      }

      // Get id of "Abyss" org (domain name: "deep")
      const oid = await dbManager.testGetId('Abyss');

      try {
        // Only support user has right currently to add/remove everyone@
        let resp = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {
          delta: { users: { 'support@getgrist.com': 'owners' }}
        }, charon);
        assert.equal(resp.status, 200);

        // Make anon@/everyone@ a viewer of Abyss org
        resp = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {
          delta: {users: addUsers}
        }, support);
        assert.equal(resp.status, 200);

        // Confirm that anon now sees this org when using a url mentioning the org
        resp = await axios.get(`${homeUrl}/o/deep/api/orgs`, nobody);
        assert.equal(resp.status, 200);
        assert.deepEqual(["Abyss"], resp.data.map((o: any) => o.name));
        // Org is marked as public
        assert.equal(resp.data[0].public, true);

        // Confirm that anon doesn't see this org from other urls
        resp = await axios.get(`${homeUrl}/o/nasa/api/orgs`, nobody);
        assert.equal(resp.status, 200);
        assert.deepEqual([], resp.data.map((o: any) => o.name));

        // Confirm that anon doesn't see this org from /session/access/all
        resp = await axios.get(`${homeUrl}/api/session/access/all`,
                               await server.getCookieLogin('nasa', null));
        assert.equal(resp.status, 200);
        assert.deepEqual([], resp.data.orgs.map((o: any) => o.name));

        // Confirm that regular users don't see this org listed from other domains,
        // either via api/orgs or api/session/access/all.
        resp = await axios.get(`${homeUrl}/o/nasa/api/orgs`, chimpy);
        assert.equal(resp.status, 200);
        let orgs = resp.data.map((o: any) => o.name);
        assert.notInclude(orgs, 'Abyss');
        resp = await axios.get(`${homeUrl}/o/nasa/api/session/access/all`,
                               await server.getCookieLogin('nasa', {email: 'chimpy@getgrist.com',
                                                                    name: 'Chimpy'}));
        assert.equal(resp.status, 200);
        orgs = resp.data.orgs.map((o: any) => o.name);
        assert.notInclude(orgs, 'Abyss');

        // Confirm that regular users see this org only via api/orgs,
        // and only when on the right domain, and only when shared with "everyone@".
        resp = await axios.get(`${homeUrl}/o/deep/api/orgs`, chimpy);
        assert.equal(resp.status, 200);
        orgs = resp.data.map((o: any) => o.name);
        if (users.includes('everyone')) {
          assert.include(orgs, 'Abyss');
        } else {
          assert.notInclude(orgs, 'Abyss');
        }
        resp = await axios.get(`${homeUrl}/o/deep/api/session/access/all`,
                               await server.getCookieLogin('deep', {email: 'chimpy@getgrist.com',
                                                                    name: 'Chimpy'}));
        assert.equal(resp.status, 200);
        orgs = resp.data.orgs.map((o: any) => o.name);
        assert.notInclude(orgs, 'Abyss');
      } finally {
        // Cleanup: remove anon from org
        let resp = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {
          delta: {users: removeUsers}
        }, support);
        assert.equal(resp.status, 200);
        resp = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {
          delta: { users: { 'support@getgrist.com': null }}
        }, charon);
        assert.equal(resp.status, 200);

        // Confirm that access has gone away
        resp = await axios.get(`${homeUrl}/o/deep/api/orgs`, nobody);
        assert.equal(resp.status, 200);
        assert.deepEqual([], resp.data.map((o: any) => o.name));
      }
    });
  }

  it('GET /api/orgs is operational', async function() {
    const resp = await axios.get(`${homeUrl}/api/orgs`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data.map((org: any) => org.name),
      ['Chimpyland', 'EmptyOrg', 'EmptyWsOrg', 'Fish', 'Flightless',
        'FreeTeam', 'NASA', 'Primately', 'TestDailyApiLimit']);
    // personal orgs should have an owner and no domain
    // createdAt and updatedAt are omitted since exact times cannot be predicted.
    assert.deepEqual(omit(resp.data[0], 'createdAt', 'updatedAt'), {
      id: await dbManager.testGetId('Chimpyland'),
      name: 'Chimpyland',
      access: 'owners',
      // public is not set.
      domain: 'docs-1',
      host: null,
      owner: {
        id: await dbManager.testGetId('Chimpy'),
        ref: await dbManager.testGetRef('Chimpy'),
        name: 'Chimpy',
        picture: null
      }
    });
    assert.isNotNull(resp.data[0].updatedAt);
    // regular orgs should have a domain and no owner
    assert.equal(resp.data[1].domain, 'blankiest');
    assert.equal(resp.data[1].owner, null);
  });

  it('GET /api/orgs respects permissions', async function() {
    const resp = await axios.get(`${homeUrl}/api/orgs`, kiwi);
    assert.equal(resp.status, 200);
    assert.equal(resp.data[0].name, 'Kiwiland');
    assert.equal(resp.data[0].owner.name, 'Kiwi');
    assert.deepEqual(resp.data.map((org: any) => org.name),
                     ['Kiwiland', 'Fish', 'Flightless', 'Primately']);
  });

  it('GET /api/orgs/{oid} is operational', async function() {
    const oid = await dbManager.testGetId('NASA');
    const resp = await axios.get(`${homeUrl}/api/orgs/${oid}`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.name, 'NASA');
  });

  it('GET /api/orgs/{oid} accepts domains', async function() {
    const resp = await axios.get(`${homeUrl}/api/orgs/nasa`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.name, 'NASA');
  });

  it('GET /api/orgs/{oid} accepts current keyword', async function() {
    const resp = await axios.get(`${homeUrl}/o/nasa/api/orgs/current`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.name, 'NASA');
  });

  it('GET /api/orgs/{oid} fails with current keyword if no domain active', async function() {
    const resp = await axios.get(`${homeUrl}/api/orgs/current`, chimpy);
    assert.equal(resp.status, 400);
  });

  it('GET /api/orgs/{oid} returns owner when available', async function() {
    const oid = await dbManager.testGetId('Chimpyland');
    const resp = await axios.get(`${homeUrl}/api/orgs/${oid}`, chimpy);
    assert.equal(resp.status, 200);
    // billingAccount is omitted since it isn't focus of this test.
    assert.deepEqual(omit(resp.data, 'createdAt', 'updatedAt', 'billingAccount'), {
      id: oid,
      name: 'Chimpyland',
      domain: 'docs-1',
      host: null,
      access: 'owners',
      owner: {
        id: await dbManager.testGetId('Chimpy'),
        ref: await dbManager.testGetRef('Chimpy'),
        name: 'Chimpy',
        picture: null
      }
    });
    assert.isNotNull(resp.data.updatedAt);
  });

  it('GET /api/orgs/{oid} respects permissions', async function() {
    const oid = await dbManager.testGetId('Kiwiland');
    const resp = await axios.get(`${homeUrl}/api/orgs/${oid}`, chimpy);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, {error: "access denied"});
  });

  it('GET /api/orgs/{oid} returns 404 appropriately', async function() {
    const resp = await axios.get(`${homeUrl}/api/orgs/9999`, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, {error: "organization not found"});
  });

  it('GET /api/orgs/{oid}/workspaces is operational', async function() {
    const oid = await dbManager.testGetId('NASA');
    const resp = await axios.get(`${homeUrl}/api/orgs/${oid}/workspaces`, chimpy);
    assert.equal(resp.status, 200);
    assert.lengthOf(resp.data, 2);
    assert.deepEqual(resp.data.map((ws: any) => ws.name), ['Horizon', 'Rovers']);
    assert.equal(resp.data[0].id, await dbManager.testGetId('Horizon'));
    assert.equal(resp.data[1].id, await dbManager.testGetId('Rovers'));
    assert.deepEqual(resp.data[0].docs.map((doc: any) => doc.name),
                     ['Jupiter', 'Pluto', 'Beyond']);
    // Check that Primately access is as expected.
    const oid2 = await dbManager.testGetId('Primately');
    const resp2 = await axios.get(`${homeUrl}/api/orgs/${oid2}/workspaces`, kiwi);
    assert.equal(resp2.status, 200);
    assert.lengthOf(resp2.data, 2);
    assert.deepEqual(resp2.data.map((ws: any) => ws.name), ['Fruit', 'Trees']);
    assert.deepEqual(resp2.data[0].docs.map((doc: any) => omit(doc, 'createdAt', 'updatedAt')), [{
      access: "viewers",
      // public is not set
      id: "sampledocid_6",
      name: "Bananas",
      isPinned: false,
      urlId: null,
      trunkId: null,
      type: null,
      forks: [],
    }, {
      access: "viewers",
      // public is not set
      id: "sampledocid_7",
      name: "Apples",
      isPinned: false,
      urlId: null,
      trunkId: null,
      type: null,
      forks: [],
    }]);
    assert.deepEqual(resp2.data[1].docs.map((doc: any) => omit(doc, 'createdAt', 'updatedAt')), [{
      access: "viewers",
      id: "sampledocid_8",
      name: "Tall",
      isPinned: false,
      urlId: null,
      trunkId: null,
      type: null,
      forks: [],
    }, {
      access: "viewers",
      id: "sampledocid_9",
      name: "Short",
      isPinned: false,
      urlId: null,
      trunkId: null,
      type: null,
      forks: [],
    }]);
    // Assert that updatedAt values are present.
    resp2.data[0].docs.map((doc: any) => assert.isNotNull(doc.updatedAt));
    resp2.data[1].docs.map((doc: any) => assert.isNotNull(doc.updatedAt));
  });

  it('GET /api/orgs/{oid}/workspaces accepts domains', async function() {
    const resp = await axios.get(`${homeUrl}/api/orgs/nasa/workspaces`, chimpy);
    assert.equal(resp.status, 200);
    assert.lengthOf(resp.data, 2);
    assert.deepEqual(resp.data.map((ws: any) => ws.name), ['Horizon', 'Rovers']);
  });

  it('GET /api/orgs/{oid}/workspaces accepts current keyword', async function() {
    const resp = await axios.get(`${homeUrl}/o/nasa/api/orgs/current/workspaces`, chimpy);
    assert.equal(resp.status, 200);
    assert.lengthOf(resp.data, 2);
    assert.deepEqual(resp.data.map((ws: any) => ws.name), ['Horizon', 'Rovers']);
  });

  it('GET /api/orgs/{oid}/workspaces returns 403 appropriately', async function() {
    const oid = await dbManager.testGetId('Kiwiland');
    const resp = await axios.get(`${homeUrl}/api/orgs/${oid}/workspaces`, chimpy);
    assert.equal(resp.status, 403);
  });

  it('GET /api/orgs/{oid}/workspaces lists individually shared workspaces', async function() {
    const oid = await dbManager.testGetId('Primately');
    const resp = await axios.get(`${homeUrl}/api/orgs/${oid}/workspaces`, chimpy);
    assert.equal(resp.status, 200);
    assert.lengthOf(resp.data, 1);  // 1 of 2 workspaces should be present
    assert.equal(resp.data[0].name, 'Fruit');
  });

  it('GET /api/orgs/{oid}/workspaces lists individually shared docs', async function() {
    const oid = await dbManager.testGetId('Flightless');
    const resp = await axios.get(`${homeUrl}/api/orgs/${oid}/workspaces`, chimpy);
    assert.equal(resp.status, 200);
    assert.lengthOf(resp.data, 1);
    assert.equal(resp.data[0].name, 'Media');
    assert.lengthOf(resp.data[0].docs, 1);  // 1 of 2 docs should be available
    assert.equal(resp.data[0].docs[0].name, 'Antartic');
  });

  it('GET /api/orgs/{wid}/workspaces gives results when workspace is empty', async function() {
    const oid = await dbManager.testGetId('EmptyWsOrg');
    const resp = await axios.get(`${homeUrl}/api/orgs/${oid}/workspaces`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data[0].name, 'Vacuum');
    assert.lengthOf(resp.data[0].docs, 0);  // No docs present
  });

  it('GET /api/workspaces/{wid} is operational', async function() {
    const wid = await dbManager.testGetId('Horizon');
    const resp = await axios.get(`${homeUrl}/api/workspaces/${wid}`, chimpy);
    assert.deepEqual(resp.data.docs.map((doc: any) => doc.name),
                     ['Jupiter', 'Pluto', 'Beyond']);
    assert.equal(resp.data.org.name, 'NASA');
    assert.equal(resp.data.org.owner, null);
  });

  it('GET /api/workspaces/{wid} lists individually shared docs', async function() {
    const wid = await dbManager.testGetId('Media');
    const resp = await axios.get(`${homeUrl}/api/workspaces/${wid}`, chimpy);
    assert.equal(resp.status, 200);
    assert.lengthOf(resp.data.docs, 1);  // 1 of 2 docs should be available
    assert.equal(resp.data.docs[0].name, 'Antartic');
  });

  it('GET /api/workspaces/{wid} gives results when empty', async function() {
    const wid = await dbManager.testGetId('Vacuum');
    const resp = await axios.get(`${homeUrl}/api/workspaces/${wid}`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.name, 'Vacuum');
    assert.lengthOf(resp.data.docs, 0);  // No docs present
  });

  it('GET /api/workspaces/{wid} respects permissions', async function() {
    const wid = await dbManager.testGetId('Deep');
    const resp = await axios.get(`${homeUrl}/api/workspaces/${wid}`, chimpy);
    assert.equal(resp.status, 403);
  });

  it('GET /api/workspaces/{wid} returns 404 appropriately', async function() {
    const resp = await axios.get(`${homeUrl}/api/workspaces/9999`, chimpy);
    assert.equal(resp.status, 404);
  });

  it('GET /api/workspaces/{wid} gives owner of org', async function() {
    const wid = await dbManager.testGetId('Private');
    const resp = await axios.get(`${homeUrl}/api/workspaces/${wid}`, charon);
    assert.equal(resp.data.org.owner.name, 'Chimpy');
  });

  it('POST /api/orgs/{oid}/workspaces is operational', async function() {
    // Add a 'Planets' workspace to the 'NASA' org.
    const oid = await dbManager.testGetId('NASA');
    const wid = await getNextId(dbManager, 'workspaces');
    const resp = await axios.post(`${homeUrl}/api/orgs/${oid}/workspaces`, {
      name: 'Planets'
    }, chimpy);
    // Assert that the response is successful and contains the next available workspace id.
    assert.equal(resp.status, 200);
    assert.equal(resp.data, wid);
    // Assert that the added workspace can be fetched and returns as expected.
    const fetchResp = await axios.get(`${homeUrl}/api/workspaces/${resp.data}`, chimpy);
    const workspace = omit(fetchResp.data, 'createdAt', 'updatedAt');
    workspace.org = omit(workspace.org, 'createdAt', 'updatedAt');
    assert.deepEqual(workspace, {
      id: wid,
      name: 'Planets',
      access: 'owners',
      docs: [],
      isSupportWorkspace: false,
      org: {
        id: 1,
        name: 'NASA',
        domain: 'nasa',
        host: null,
        owner: null
      }
    });
  });

  it('POST /api/orgs/{oid}/workspaces returns 404 appropriately', async function() {
    // Attempt to add to an org that doesn't exist.
    const resp = await axios.post(`${homeUrl}/api/orgs/9999/workspaces`, {
      name: 'Planets'
    }, chimpy);
    assert.equal(resp.status, 404);
  });

  it('POST /api/orgs/{oid}/workspaces returns 403 appropriately', async function() {
    // Attempt to add to an org that chimpy doesn't have write permission on.
    const oid = await dbManager.testGetId('Primately');
    const resp = await axios.post(`${homeUrl}/api/orgs/${oid}/workspaces`, {
      name: 'Apes'
    }, chimpy);
    assert.equal(resp.status, 403);
  });

  it('POST /api/orgs/{oid}/workspaces returns 400 appropriately', async function() {
    // Use an unknown property and check that the operation fails with status 400.
    const oid = await dbManager.testGetId('NASA');
    const resp = await axios.post(`${homeUrl}/api/orgs/${oid}/workspaces`, {x: 1}, chimpy);
    assert.equal(resp.status, 400);
  });

  it('PATCH /api/workspaces/{wid} is operational', async function() {
    // Rename the 'Horizons' workspace to 'Horizons2'.
    const wid = await dbManager.testGetId('Horizon');
    const resp = await axios.patch(`${homeUrl}/api/workspaces/${wid}`, {
      name: 'Horizon2'
    }, chimpy);
    // Assert that the response is successful.
    assert.equal(resp.status, 200);
    // Assert that the workspace was renamed as expected.
    const fetchResp = await axios.get(`${homeUrl}/api/workspaces/${wid}`, chimpy);
    const workspace = fetchResp.data;
    assert.equal(workspace.name, 'Horizon2');

    // Change the name back.
    const wid2 = await dbManager.testGetId('Horizon2');
    const resp2 = await axios.patch(`${homeUrl}/api/workspaces/${wid2}`, {
      name: 'Horizon'
    }, chimpy);
    assert.equal(resp2.status, 200);
  });

  it('PATCH /api/workspaces/{wid} returns 404 appropriately', async function() {
    // Attempt to rename a workspace that doesn't exist.
    const resp = await axios.patch(`${homeUrl}/api/workspaces/9999`, {
      name: 'Rename'
    }, chimpy);
    assert.equal(resp.status, 404);
  });

  it('PATCH /api/workspaces/{wid} returns 403 appropriately', async function() {
    // Attempt to rename a workspace without UPDATE access.
    const wid = await dbManager.testGetId('Fruit');
    const resp = await axios.patch(`${homeUrl}/api/workspaces/${wid}`, {
      name: 'Fruit2'
    }, chimpy);
    assert.equal(resp.status, 403);
  });

  it('PATCH /api/workspaces/{wid} returns 400 appropriately', async function() {
    // Use an unavailable property and check that the operation fails with 400.
    const wid = await dbManager.testGetId('Rovers');
    const resp = await axios.patch(`${homeUrl}/api/workspaces/${wid}`, {x: 1}, chimpy);
    assert.equal(resp.status, 400);
  });

  it('DELETE /api/workspaces/{wid} is operational', async function() {
    // Add Kiwi to 'Public' workspace.
    const oid = await dbManager.testGetId('Chimpyland');
    let wid = await dbManager.testGetId('Public');

    // Assert that the number of users in the org has not been updated.
    assert.deepEqual(userCountUpdates[oid as number], undefined);

    const delta = {
      users: {[kiwiEmail]: 'viewers'}
    };
    const accessResp = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`, {delta}, chimpy);
    assert.equal(accessResp.status, 200);

    // Assert that Kiwi is a guest of the org.
    const orgResp = await axios.get(`${homeUrl}/api/orgs/${oid}/access`, chimpy);
    assert.equal(orgResp.status, 200);
    assert.deepEqual(orgResp.data, {
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: "guests",
        isMember: false,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: "viewers",
        isMember: true,
      }]
    });

    // Assert that the number of non-guest users in the org is unchanged.
    assert.deepEqual(userCountUpdates[oid as number], undefined);

    const beforeDelCount = await getRowCounts();

    // Delete 'Public' workspace.
    const resp = await axios.delete(`${homeUrl}/api/workspaces/${wid}`, chimpy);
    // Assert that the response is successful.
    assert.equal(resp.status, 200);
    // Assert that the workspace is no longer in the database.
    const fetchResp = await axios.get(`${homeUrl}/api/workspaces/${wid}`, chimpy);
    assert.equal(fetchResp.status, 404);

    // Assert that Kiwi is no longer a guest of the org.
    const orgResp2 = await axios.get(`${homeUrl}/api/orgs/${oid}/access`, chimpy);
    assert.equal(orgResp2.status, 200);
    assert.deepEqual(orgResp2.data, {
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: "viewers",
        isMember: true,
      }]
    });

    // Assert that the number of non-guest users in the org remains unchanged.
    assert.deepEqual(userCountUpdates[oid as number], undefined);

    const afterDelCount1 = await getRowCounts();
    // Assert that one workspace was removed.
    assert.equal(afterDelCount1.workspaces, beforeDelCount.workspaces - 1);
    // Assert that Kiwi's workspace viewer and org guest items were removed.
    assert.equal(afterDelCount1.groupUsers, beforeDelCount.groupUsers - 2);

    // Re-add 'Public'
    const addWsResp = await axios.post(`${homeUrl}/api/orgs/${oid}/workspaces`, {
      name: 'Public'
    }, chimpy);
    // Assert that the response is successful
    assert.equal(addWsResp.status, 200);
    wid = addWsResp.data;

    // Add a doc to 'Public'
    const addDocResp1 = await axios.post(`${homeUrl}/api/workspaces/${wid}/docs`, {
      name: 'PublicDoc1'
    }, chimpy);

    // Add another workspace, 'Public2'
    const addWsResp2 = await axios.post(`${homeUrl}/api/orgs/${oid}/workspaces`, {
      name: 'Public2'
    }, chimpy);
    assert.equal(addWsResp2.status, 200);

    // Get 'Public2' workspace.
    const wid2 = addWsResp2.data;

    // Add a doc to 'Public2'
    const addDocResp2 = await axios.post(`${homeUrl}/api/workspaces/${wid2}/docs`, {
      name: 'PublicDoc2'
    }, chimpy);
    assert.equal(addDocResp2.status, 200);

    // Get both doc's ids.
    const did1 = addDocResp1.data;
    const did2 = addDocResp2.data;

    const beforeAddCount = await getRowCounts();

    // Add Kiwi to the docs
    const docAccessResp1 = await axios.patch(`${homeUrl}/api/docs/${did1}/access`, {delta}, chimpy);
    assert.equal(docAccessResp1.status, 200);
    const docAccessResp2 = await axios.patch(`${homeUrl}/api/docs/${did2}/access`, {delta}, chimpy);
    assert.equal(docAccessResp2.status, 200);

    // Assert that Kiwi is a guest of the org.
    const orgResp3 = await axios.get(`${homeUrl}/api/orgs/${oid}/access`, chimpy);
    assert.equal(orgResp3.status, 200);
    assert.deepEqual(orgResp3.data, {
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: "guests",
        isMember: false,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: "viewers",
        isMember: true,
      }]
    });

    // Assert that the number of non-guest users in the org remains unchanged.
    assert.deepEqual(userCountUpdates[oid as number], undefined);

    const afterAddCount = await getRowCounts();
    // Assert that Kiwi's 2 doc viewer, 2 workspace guest and 1 org guest items were added.
    assert.equal(afterAddCount.groupUsers, beforeAddCount.groupUsers + 5);

    // Delete 'Public2' workspace.
    const deleteResp2 = await axios.delete(`${homeUrl}/api/workspaces/${wid2}`, chimpy);
    assert.equal(deleteResp2.status, 200);

    const afterDelCount2 = await getRowCounts();
    // Assert that one workspace was removed.
    assert.equal(afterDelCount2.workspaces, afterAddCount.workspaces - 1);
    // Assert that one doc was removed.
    assert.equal(afterDelCount2.docs, afterAddCount.docs - 1);
    // Assert that one of Kiwi's doc viewer items and one of Kiwi's workspace guest items were removed
    // and guest chimpy assignment to org and chimpy owner assignment to doc and ws.
    assert.equal(afterDelCount2.groupUsers, afterAddCount.groupUsers - 2 - 3);

    // Assert that Kiwi is STILL a guest of the org, since Kiwi is still in the 'Public' doc.
    const orgResp4 = await axios.get(`${homeUrl}/api/orgs/${oid}/access`, chimpy);
    assert.equal(orgResp4.status, 200);
    assert.deepEqual(orgResp4.data, {
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: "guests",
        isMember: false,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: "viewers",
        isMember: true,
      }]
    });

    // Assert that the number of non-guest users in the org remains unchanged.
    assert.deepEqual(userCountUpdates[oid as number], undefined);
    // Delete 'Public' workspace.
    const deleteResp3 = await axios.delete(`${homeUrl}/api/workspaces/${wid}`, chimpy);
    // Assert that the response is successful.
    assert.equal(deleteResp3.status, 200);

    const afterDelCount3 = await getRowCounts();
    // Assert that another workspace was removed.
    assert.equal(afterDelCount3.workspaces, afterDelCount2.workspaces - 1);
    // Assert that another doc was removed.
    assert.equal(afterDelCount3.docs, afterDelCount2.docs - 1);
    // Assert that Kiwi's doc viewer item, workspace guest and org guest items were removed, and Chimpy was
    // removed from doc as owner, ws as guest and owner, and org as guest.
    assert.equal(afterDelCount3.groupUsers, afterDelCount2.groupUsers - 7);

    // Assert that Kiwi is no longer a guest of the org.
    const orgResp5 = await axios.get(`${homeUrl}/api/orgs/${oid}/access`, chimpy);
    assert.equal(orgResp5.status, 200);
    assert.deepEqual(orgResp5.data, {
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: "viewers",
        isMember: true,
      }]
    });

    // Assert that the number of non-guest users in the org remains unchanged.
    assert.deepEqual(userCountUpdates[oid as number], undefined);

    // Re-add 'Public' finally
    const addWsResp3 = await axios.post(`${homeUrl}/api/orgs/${oid}/workspaces`, {
      name: 'Public'
    }, chimpy);
    // Assert that the response is successful
    assert.equal(addWsResp3.status, 200);
  });

  it('DELETE /api/workspaces/{wid} returns 404 appropriately', async function() {
    // Attempt to delete a workspace that doesn't exist.
    const resp = await axios.delete(`${homeUrl}/api/workspaces/9999`, chimpy);
    assert.equal(resp.status, 404);
  });

  it('DELETE /api/workspaces/{wid} returns 403 appropriately', async function() {
    // Attempt to delete a workspace without REMOVE access.
    const wid = await dbManager.testGetId('Fruit');
    const resp = await axios.delete(`${homeUrl}/api/workspaces/${wid}`, chimpy);
    assert.equal(resp.status, 403);
  });

  it('POST /api/workspaces/{wid}/docs is operational', async function() {
    // Add a 'Surprise' doc to the 'Rovers' workspace.
    const wid = await dbManager.testGetId('Rovers');
    const resp = await axios.post(`${homeUrl}/api/workspaces/${wid}/docs`, {
      name: 'Surprise'
    }, chimpy);
    // Assert that the response is successful and contains the doc id.
    assert.equal(resp.status, 200);
    assert.equal(resp.data.length, 22); // The length of a short-uuid string
    // Assert that the added doc can be fetched and returns as expected.
    const fetchResp = await axios.get(`${homeUrl}/api/workspaces/${wid}`, chimpy);
    const workspace = fetchResp.data;
    assert.deepEqual(workspace.name, 'Rovers');
    assert.deepEqual(workspace.docs.map((d: any) => d.name),
      ['Curiosity', 'Apathy', 'Surprise']);
  });

  it('POST /api/workspaces/{wid}/docs handles urlIds', async function() {
    // Add a 'Boredom' doc to the 'Rovers' workspace.
    const wid = await dbManager.testGetId('Rovers');
    let resp = await axios.post(`${homeUrl}/api/workspaces/${wid}/docs`, {
      name: 'Boredom',
      urlId: 'Hohum'
    }, chimpy);
    // Assert that the response is successful
    assert.equal(resp.status, 200);
    assert.equal(resp.data.length, 22); // The length of a short-uuid string
    const docId = resp.data;
    // Assert that the added doc can be fetched and returns as expected using urlId.
    resp = await axios.get(`${homeUrl}/api/docs/Hohum`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.id, docId);
    // Adding a new doc with the same urlId should fail.
    resp = await axios.post(`${homeUrl}/api/workspaces/${wid}/docs`, {
      name: 'NonEnthusiasm',
      urlId: 'Hohum'
    }, chimpy);
    assert.equal(resp.status, 400);
    // Change Boredom doc to use a different urlId
    // Also, use the existing urlId in the endpoint just to check that works
    resp = await axios.patch(`${homeUrl}/api/docs/Hohum`, {
      urlId: 'sigh'
    }, chimpy);
    assert.equal(resp.status, 200);
    // Hohum still resolves to Boredom for the moment
    resp = await axios.get(`${homeUrl}/api/docs/Hohum`, chimpy);
    assert.equal(resp.data.id, docId);
    // Adding a new doc with the Hohum urlId should now succeed.
    resp = await axios.post(`${homeUrl}/api/workspaces/${wid}/docs`, {
      name: 'NonEnthusiasm',
      urlId: 'Hohum'
    }, chimpy);
    assert.equal(resp.status, 200);
    const docId2 = resp.data;
    // Hohum now resolves to the new doc.
    resp = await axios.get(`${homeUrl}/api/docs/Hohum`, chimpy);
    assert.equal(resp.data.id, docId2);
    // Delete the new doc.  Use urlId to check that works.
    await axios.delete(`${homeUrl}/api/docs/Hohum`, chimpy);
  });

  it('POST /api/workspaces/{wid}/docs returns 404 appropriately', async function() {
    // Attempt to add to an workspace that doesn't exist.
    const resp = await axios.post(`${homeUrl}/api/workspaces/9999/docs`, {
      name: 'Mercury'
    }, chimpy);
    assert.equal(resp.status, 404);
  });

  it('POST /api/workspaces/{wid}/docs returns 403 without access', async function() {
    // Attempt to add to a workspace that chimpy doesn't have any access to.
    const wid = await dbManager.testGetId('Trees');
    const resp = await axios.post(`${homeUrl}/api/workspaces/${wid}/docs`, {
      name: 'Bushy'
    }, chimpy);
    assert.equal(resp.status, 403);
  });

  it('POST /api/workspaces/{wid}/docs returns 403 with view access', async function() {
    // Attempt to add to a workspace that chimpy has only view access to.
    const wid = await dbManager.testGetId('Fruit');
    const resp = await axios.post(`${homeUrl}/api/workspaces/${wid}/docs`, {
      name: 'Oranges'
    }, chimpy);
    assert.equal(resp.status, 403);
  });

  it('POST /api/workspaces/{wid}/docs returns 400 appropriately', async function() {
    // Omit the new doc name and check that the operation fails with status 400.
    const wid = await dbManager.testGetId('Rovers');
    const resp = await axios.post(`${homeUrl}/api/workspaces/${wid}/docs`, {}, chimpy);
    assert.equal(resp.status, 400);
  });

  it('POST /api/orgs is operational', async function() {
    const oid = await getNextId(dbManager, 'orgs');
    // Add a 'Magic' org.
    const resp = await axios.post(`${homeUrl}/api/orgs`, {
      name: 'Magic',
      domain: 'magic',
    }, chimpy);
    // Assert that the response is successful and contains the next available org id.
    assert.equal(resp.status, 200);
    assert.equal(resp.data, oid);
    // Assert that the added org can be fetched and returns as expected.
    let fetchResp = await axios.get(`${homeUrl}/api/orgs/${resp.data}`, chimpy);
    const org = fetchResp.data;
    assert.deepEqual(omit(org, 'createdAt', 'updatedAt'), {
      id: oid,
      name: 'Magic',
      access: 'owners',
      domain: `o-${oid}`,    // default product suppresses vanity domains
      host: null,
      owner: null,
      billingAccount: {
        id: oid,
        inGoodStanding: true,
        individual: false,
        isManager: true,
        paid: false,
        product: {
          id: await dbManager.testGetId('stub'),
          features: {},
          name: 'stub',
        },
        status: null,
        externalId: null,
        externalOptions: null,
      },
    });
    assert.isNotNull(org.updatedAt);

    // Upgrade this org to a fancier plan, and check that vanity domain starts working
    const db = dbManager.connection.manager;
    const dbOrg = await db.findOne(Organization,
                                   {where: {name: 'Magic'},
                                    relations: ['billingAccount', 'billingAccount.product']});
    if (!dbOrg) { throw new Error('cannot find Magic'); }
    const product = await db.findOne(Product, {where: {name: 'team'}});
    if (!product) { throw new Error('cannot find product'); }
    dbOrg.billingAccount.product = product;
    await dbOrg.billingAccount.save();
    // Check that we now get the vanity domain
    fetchResp = await axios.get(`${homeUrl}/api/orgs/${oid}`, chimpy);
    assert.equal(fetchResp.data.domain, 'magic');
  });

  it('POST /api/orgs returns 400 appropriately', async function() {
    // Omit the new org name and check that the operation fails with status 400.
    const resp = await axios.post(`${homeUrl}/api/orgs`, {
      domain: 'invalid-req'
    }, chimpy);
    assert.equal(resp.status, 400);
  });

  it('PATCH /api/orgs/{oid} is operational', async function() {
    // Rename the 'Magic' org to 'Holiday' with domain 'holiday'.
    const oid = await dbManager.testGetId('Magic');
    const resp = await axios.patch(`${homeUrl}/api/orgs/${oid}`, {
      name: 'Holiday',
      domain: 'holiday'
    }, chimpy);
    // Assert that the response is successful.
    assert.equal(resp.status, 200);
    // Assert that the org was renamed as expected.
    const fetchResp = await axios.get(`${homeUrl}/api/orgs/${oid}`, chimpy);
    const org = fetchResp.data;
    assert.equal(org.name, 'Holiday');
    assert.equal(org.domain, 'holiday');
    // Update the org domain to 'holiday2'.
    const resp2 = await axios.patch(`${homeUrl}/api/orgs/${oid}`, {
      domain: 'holiday2'
    }, chimpy);
    // Assert that the response is successful.
    assert.equal(resp2.status, 200);
    // Assert that the org was updated as expected.
    const fetchResp2 = await axios.get(`${homeUrl}/api/orgs/${oid}`, chimpy);
    assert.equal(fetchResp2.data.name, 'Holiday');
    assert.equal(fetchResp2.data.domain, 'holiday2');
  });

  it('PATCH /api/orgs/{oid} returns 404 appropriately', async function() {
    // Attempt to rename an org that doesn't exist.
    const resp = await axios.patch(`${homeUrl}/api/orgs/9999`, {
      name: 'Rename'
    }, chimpy);
    assert.equal(resp.status, 404);
  });

  it('PATCH /api/orgs/{oid} returns 403 appropriately', async function() {
    // Attempt to rename an org without UPDATE access.
    const oid = await dbManager.testGetId('Primately');
    const resp = await axios.patch(`${homeUrl}/api/orgs/${oid}`, {
      name: 'Primately2'
    }, chimpy);
    assert.equal(resp.status, 403);
  });

  it('PATCH /api/orgs/{oid} returns 400 appropriately', async function() {
    // Use an unavailable property and check that the operation fails with 400.
    const oid = await dbManager.testGetId('Holiday');
    const resp = await axios.patch(`${homeUrl}/api/orgs/${oid}`, {x: 1}, chimpy);
    assert.equal(resp.status, 400);
    assert.match(resp.data.error, /unrecognized property/);
  });

  it('DELETE /api/orgs/{oid} is operational', async function() {
    // Delete the 'Holiday' org.
    const oid = await dbManager.testGetId('Holiday');
    const resp = await axios.delete(`${homeUrl}/api/orgs/${oid}`, chimpy);
    // Assert that the response is successful.
    assert.equal(resp.status, 200);
    // Assert that the org is no longer in the database.
    const fetchResp = await axios.get(`${homeUrl}/api/orgs/${oid}`, chimpy);
    assert.equal(fetchResp.status, 404);
  });

  it('DELETE /api/orgs/{oid} returns 404 appropriately', async function() {
    // Attempt to delete an org that doesn't exist.
    const resp = await axios.delete(`${homeUrl}/api/orgs/9999`, chimpy);
    assert.equal(resp.status, 404);
  });

  it('DELETE /api/orgs/{oid} returns 403 appropriately', async function() {
    // Attempt to delete an org without REMOVE access.
    const oid = await dbManager.testGetId('Primately');
    const resp = await axios.delete(`${homeUrl}/api/orgs/${oid}`, chimpy);
    assert.equal(resp.status, 403);
  });

  it('GET /api/docs/{did} is operational', async function() {
    const did = await dbManager.testGetId('Jupiter');
    const resp = await axios.get(`${homeUrl}/api/docs/${did}`, chimpy);
    assert.equal(resp.status, 200);
    const doc: Document = resp.data;
    assert.equal(doc.name, 'Jupiter');
    assert.equal(doc.workspace.name, 'Horizon');
    assert.equal(doc.workspace.org.name, 'NASA');
    assert.equal(doc.public, undefined);
  });

  it('GET /api/docs/{did} returns 404 for nonexistent doc', async function() {
    const resp = await axios.get(`${homeUrl}/api/docs/typotypotypo`, chimpy);
    assert.equal(resp.status, 404);
  });

  it('GET /api/docs/{did} returns 403 without access', async function() {
    const did = await dbManager.testGetId('Jupiter');
    const resp = await axios.get(`${homeUrl}/api/docs/${did}`, kiwi);
    assert.equal(resp.status, 403);
  });

  // Unauthorized folks can currently check if a document uuid exists and that's ok,
  // arguably, because uuids don't leak anything sensitive.
  it('GET /api/docs/{did} returns 404 without org access for nonexistent doc', async function() {
    const resp = await axios.get(`${homeUrl}/api/docs/typotypotypo`, kiwi);
    assert.equal(resp.status, 404);
  });

  it('GET /api/docs/{did} returns 404 for doc accessed from wrong org', async function() {
    const did = await dbManager.testGetId('Jupiter');
    const resp = await axios.get(`${homeUrl}/o/pr/api/docs/${did}`, chimpy);
    assert.equal(resp.status, 404);
  });

  it('GET /api/docs/{did} works for doc accessed from correct org', async function() {
    const did = await dbManager.testGetId('Jupiter');
    const resp = await axios.get(`${homeUrl}/o/nasa/api/docs/${did}`, chimpy);
    assert.equal(resp.status, 200);
  });

  it('PATCH /api/docs/{did} is operational', async function() {
    // Rename the 'Surprise' doc to 'Surprise2'.
    const did = await dbManager.testGetId('Surprise');
    const resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      name: 'Surprise2'
    }, chimpy);
    // Assert that the response is successful.
    assert.equal(resp.status, 200);
    // Assert that the doc was renamed as expected.
    const wid = await dbManager.testGetId('Rovers');
    const fetchResp = await axios.get(`${homeUrl}/api/workspaces/${wid}`, chimpy);
    const workspace = fetchResp.data;
    assert.deepEqual(workspace.name, 'Rovers');
    assert.deepEqual(workspace.docs.map((d: any) => d.name),
      ['Curiosity', 'Apathy', 'Surprise2', 'Boredom']);
  });

  it('PATCH /api/docs/{did} works for urlIds', async function() {
    // Check that 'curio' is not yet a valid id for anything
    let resp = await axios.get(`${homeUrl}/api/docs/curio`, chimpy);
    assert.equal(resp.status, 404);
    // Make 'curio' a urlId for document named 'Curiosity'
    const did = await dbManager.testGetId('Curiosity');
    resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      urlId: 'curio'
    }, chimpy);
    // Assert that the response is successful.
    assert.equal(resp.status, 200);
    // Check we can now access same doc via urlId.
    resp = await axios.get(`${homeUrl}/api/docs/curio`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.id, did);
    assert.equal(resp.data.urlId, 'curio');
    // Check that we still have access via docId.
    resp = await axios.get(`${homeUrl}/api/docs/${did}`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.id, did);
    assert.equal(resp.data.urlId, 'curio');
    // Add another urlId for the same doc
    resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      urlId: 'hmm'
    }, chimpy);
    // Check we can now access same doc via this new urlId.
    resp = await axios.get(`${homeUrl}/api/docs/hmm`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.id, did);
    assert.equal(resp.data.urlId, 'hmm');
    // Check that urlIds accumulate, and previous urlId still works.
    resp = await axios.get(`${homeUrl}/api/docs/curio`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.id, did);
    assert.equal(resp.data.urlId, 'hmm');
    // Check that we still have access via docId.
    resp = await axios.get(`${homeUrl}/api/docs/${did}`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.id, did);
    assert.equal(resp.data.urlId, 'hmm');
  });

  it('PATCH /api/docs/{did} handles urlIds for different orgs independently', async function() {
    // set a urlId with the same name on two docs in different orgs
    const did = await dbManager.testGetId('Curiosity');  // part of NASA org
    const did2 = await dbManager.testGetId('Herring');   // part of Fish org
    let resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      urlId: 'example'
    }, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.patch(`${homeUrl}/api/docs/${did2}`, {
      urlId: 'example'
    }, chimpy);
    assert.equal(resp.status, 200);
    // Check that we get the right doc in the right org.
    resp = await axios.get(`${homeUrl}/o/nasa/api/docs/example`, chimpy);
    assert.equal(resp.data.id, did);
    resp = await axios.get(`${homeUrl}/o/fish/api/docs/example`, chimpy);
    assert.equal(resp.data.id, did2);
    // For a url that isn't associated with an org, the result is ambiguous for this user.
    resp = await axios.get(`${homeUrl}/api/docs/example`, chimpy);
    assert.equal(resp.status, 400);
    // For user Kiwi, who has no NASA access, the result is not ambiguous.
    resp = await axios.get(`${homeUrl}/api/docs/example`, kiwi);
    assert.equal(resp.status, 200);
  });

  it('PATCH /api/docs/{did} can reuse urlIds within an org', async function() {
    // Make 'puzzler' a urlId for document named 'Curiosity'
    const did = await dbManager.testGetId('Curiosity');
    let resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {urlId: 'puzzler'}, chimpy);
    // Assert that the response is successful.
    assert.equal(resp.status, 200);
    // Check we can now access same doc via urlId.
    resp = await axios.get(`${homeUrl}/api/docs/puzzler`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.id, did);
    assert.equal(resp.data.urlId, 'puzzler');
    // Try to make 'puzzler' a urlId for document within same org.
    const did2 = await dbManager.testGetId('Apathy');
    resp = await axios.patch(`${homeUrl}/api/docs/${did2}`, {urlId: 'puzzler'}, chimpy);
    // Not allowed, since there's a live doc in the org using this urlId.
    assert.equal(resp.status, 400);
    // Remove the urlId from first doc
    resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {urlId: null}, chimpy);
    assert.equal(resp.status, 200);
    // The urlId should still forward (until we reuse it later).
    resp = await axios.get(`${homeUrl}/api/docs/puzzler`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.id, did);
    // Try to make 'puzzler' a urlId for second document again, it should work this time.
    resp = await axios.patch(`${homeUrl}/api/docs/${did2}`, {urlId: 'puzzler'}, chimpy);
    assert.equal(resp.status, 200);
    // Check we can now access new doc via urlId.
    resp = await axios.get(`${homeUrl}/api/docs/puzzler`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.id, did2);
    assert.equal(resp.data.urlId, 'puzzler');
    // Check that the first doc is accessible via its docId.
    resp = await axios.get(`${homeUrl}/api/docs/${did}`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.id, did);
    assert.equal(resp.data.urlId, null);
  });

  it('PATCH /api/docs/{did} forbids funky urlIds', async function() {
    const badUrlIds = new Set(['sp/ace', 'sp ace', 'space!', 'spa.ce', '']);
    const goodUrlIds = new Set(['sp-ace', 'spAace', 'SPac3', 's']);
    const did = await dbManager.testGetId('Curiosity');
    let resp;
    for (const urlId of [...badUrlIds, ...goodUrlIds]) {
      resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {urlId}, chimpy);
      assert.equal(resp.status, goodUrlIds.has(urlId) ? 200 : 400);
    }
    for (const urlId of [...badUrlIds, ...goodUrlIds]) {
      resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, chimpy);
      assert.equal(resp.status, goodUrlIds.has(urlId) ? 200 : 404);
    }
    // It is permissible to reset urlId to null
    resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {urlId: null}, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${homeUrl}/api/docs/sp-ace`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.urlId, null);
  });

  it('PATCH /api/docs/{did} supports options', async function() {
    // Set some options on the 'Surprise2' doc.
    const did = await dbManager.testGetId('Surprise2');
    let resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      options: { description: 'boo', openMode: 'fork' }
    }, chimpy);
    assert.equal(resp.status, 200);

    // Check they show up in a workspace request.
    const wid = await dbManager.testGetId('Rovers');
    resp = await axios.get(`${homeUrl}/api/workspaces/${wid}`, chimpy);
    const workspace: Workspace = resp.data;
    const doc = workspace.docs.find(d => d.name === 'Surprise2');
    assert.deepEqual(doc?.options, {description: 'boo', openMode: 'fork'});

    // Check setting one option preserves others.
    resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      options: { description: 'boo!' }
    }, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${homeUrl}/api/docs/${did}`, chimpy);
    assert.deepEqual(resp.data?.options, {description: 'boo!', openMode: 'fork'});

    // Check setting to null removes an option.
    resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      options: { openMode: null }
    }, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${homeUrl}/api/docs/${did}`, chimpy);
    assert.deepEqual(resp.data?.options, {description: 'boo!'});

    // Check setting options object to null wipes it completely.
    resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      options: null
    }, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${homeUrl}/api/docs/${did}`, chimpy);
    assert.deepEqual(resp.data?.options, undefined);

    // Check setting icon works.
    resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      options: { icon: 'https://grist-static.com/icons/foo.png' }
    }, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${homeUrl}/api/docs/${did}`, chimpy);
    assert.deepEqual(resp.data?.options, {icon: 'https://grist-static.com/icons/foo.png'});

    // Check random urls are not supported.
    resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      options: { icon: 'https://not-grist-static.com/icons/evil.exe' }
    }, chimpy);
    assert.equal(resp.status, 400);
    resp = await axios.get(`${homeUrl}/api/docs/${did}`, chimpy);
    assert.deepEqual(resp.data?.options, {icon: 'https://grist-static.com/icons/foo.png'});

    // Check removing icon works.
    resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      options: { icon: null },
    }, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${homeUrl}/api/docs/${did}`, chimpy);
    assert.deepEqual(resp.data?.options, undefined);
  });

  it('PATCH /api/docs/{did} returns 404 appropriately', async function() {
    // Attempt to rename a doc that doesn't exist.
    const resp = await axios.patch(`${homeUrl}/api/docs/9999`, {
      name: 'Rename'
    }, chimpy);
    assert.equal(resp.status, 404);
  });

  it('PATCH /api/docs/{did} returns 403 with view access', async function() {
    // Attempt to rename a doc without UPDATE access.
    const did = await dbManager.testGetId('Bananas');
    const resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      name: 'Bananas2'
    }, chimpy);
    assert.equal(resp.status, 403);
  });

  it('PATCH /api/docs/{did} returns 400 appropriately', async function() {
    // Use an unavailable property and check that the operation fails with 400.
    const did = await dbManager.testGetId('Surprise2');
    const resp = await axios.patch(`${homeUrl}/api/docs/${did}`, {x: 1}, chimpy);
    assert.equal(resp.status, 400);
  });

  it('DELETE /api/docs/{did} is operational', async function() {
    const oid = await dbManager.testGetId('NASA');
    const wid = await dbManager.testGetId('Rovers');
    const did = await dbManager.testGetId('Surprise2');

    // Assert that the number of users in the org has not been updated.
    assert.deepEqual(userCountUpdates[oid as number], undefined);

    // Add Kiwi to the 'Surprise2' doc.
    const delta = {
      users: {[kiwiEmail]: 'viewers'}
    };
    const accessResp = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta}, chimpy);
    assert.equal(accessResp.status, 200);

    // Assert that Kiwi is a guest of the ws.
    const wsResp = await axios.get(`${homeUrl}/api/workspaces/${wid}/access`, chimpy);
    assert.equal(wsResp.status, 200);
    assert.deepEqual(wsResp.data, {
      maxInheritedRole: "owners",
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: 'guests',
        parentAccess: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: "guests",
        parentAccess: null,
        isMember: false,
      }, {
        // Note that Charon is listed despite lacking access since Charon is a guest of the org.
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: null,
        parentAccess: null,
        isMember: false,
      }]
    });

    // Assert that the number of non-guest users in the org is unchanged.
    assert.deepEqual(userCountUpdates[oid as number], undefined);

    // Assert that Kiwi is a guest of the org.
    const orgResp = await axios.get(`${homeUrl}/api/orgs/${oid}/access`, chimpy);
    assert.equal(orgResp.status, 200);
    assert.deepEqual(orgResp.data, {
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: "guests",
        isMember: false,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: "guests",
        isMember: false,
      }]
    });

    const beforeDelCount = await getRowCounts();

    // Delete the 'Surprise2' doc.
    const deleteResp = await axios.delete(`${homeUrl}/api/docs/${did}`, chimpy);
    // Assert that the response is successful.
    assert.equal(deleteResp.status, 200);
    // Assert that the doc is no longer in the database.
    const fetchResp = await axios.get(`${homeUrl}/api/workspaces/${wid}`, chimpy);
    const workspace = fetchResp.data;
    assert.deepEqual(workspace.name, 'Rovers');
    assert.deepEqual(workspace.docs.map((d: any) => d.name),
      ['Curiosity', 'Apathy', 'Boredom']);

    // Assert that Kiwi is no longer a guest of the ws.
    const wsResp2 = await axios.get(`${homeUrl}/api/workspaces/${wid}/access`, chimpy);
    assert.equal(wsResp2.status, 200);
    assert.deepEqual(wsResp2.data, {
      maxInheritedRole: "owners",
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: 'guests',
        parentAccess: "owners",
        isMember: true,
      }, {
        // Note that Charon is listed despite lacking access since Charon is a guest of the org.
        id: 3,
        email: charonEmail,
        ref: charonRef,
        name: "Charon",
        picture: null,
        access: null,
        parentAccess: null,
        isMember: false,
      }]
    });

    // Assert that Kiwi is no longer a guest of the org.
    const orgResp2 = await axios.get(`${homeUrl}/api/orgs/${oid}/access`, chimpy);
    assert.equal(orgResp2.status, 200);
    assert.deepEqual(orgResp2.data, {
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: "guests",
        isMember: false,
      }]
    });

    // Assert that the number of non-guest users in the org is unchanged.
    assert.deepEqual(userCountUpdates[oid as number], undefined);

    const afterDelCount = await getRowCounts();
    // Assert that the doc was removed.
    assert.equal(afterDelCount.docs, beforeDelCount.docs - 1);
    // Assert that Chimpy doc owner item, Kiwi's doc viewer item, workspace guest and org guest items were removed.
    assert.equal(afterDelCount.groupUsers, beforeDelCount.groupUsers - 4);
  });

  it('DELETE /api/docs/{did} returns 404 appropriately', async function() {
    // Attempt to delete a doc that doesn't exist.
    const resp = await axios.delete(`${homeUrl}/api/docs/9999`, chimpy);
    assert.equal(resp.status, 404);
  });

  it('DELETE /api/docs/{did} returns 403 with view access', async function() {
    // Attempt to delete a doc without REMOVE access.
    const did = await dbManager.testGetId('Bananas');
    const resp = await axios.delete(`${homeUrl}/api/docs/${did}`, chimpy);
    assert.equal(resp.status, 403);
  });

  it('GET /api/zig is a 404', async function() {
    const resp = await axios.get(`${homeUrl}/api/zig`, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, {error: "not found: /api/zig"});
  });

  it('PATCH /api/docs/{did}/move is operational within the same org', async function() {
    const did = await dbManager.testGetId('Jupiter');
    const wsId1 = await dbManager.testGetId('Horizon');
    const wsId2 = await dbManager.testGetId('Rovers');
    const orgId = await dbManager.testGetId('NASA');

    // Check that move returns 200
    const resp1 = await axios.patch(`${homeUrl}/api/docs/${did}/move`,
      {workspace: wsId2}, chimpy);
    assert.equal(resp1.status, 200);
    // Check that the doc is removed from the source workspace
    const verifyResp1 = await axios.get(`${homeUrl}/api/workspaces/${wsId1}`, chimpy);
    assert.deepEqual(verifyResp1.data.docs.map((doc: any) => doc.name), ['Pluto', 'Beyond']);
    // Check that the doc is added to the dest workspace
    const verifyResp2 = await axios.get(`${homeUrl}/api/workspaces/${wsId2}`, chimpy);
    assert.deepEqual(verifyResp2.data.docs.map((doc: any) => doc.name),
      ['Jupiter', 'Curiosity', 'Apathy', 'Boredom']);

    // Try a complex case - give a user special access to the doc then move it back
    // Make Kiwi a doc editor for Jupiter
    const delta1 = {
      users: {[kiwiEmail]: 'editors'}
    };
    const accessResp1 = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta: delta1}, chimpy);
    assert.equal(accessResp1.status, 200);
    // Check that Kiwi is a guest of the workspace/org
    const kiwiResp1 = await axios.get(`${homeUrl}/api/workspaces/${wsId2}`, kiwi);
    assert.equal(kiwiResp1.status, 200);
    const kiwiResp2 = await axios.get(`${homeUrl}/api/orgs/${orgId}`, kiwi);
    assert.equal(kiwiResp2.status, 200);
    // Assert that the number of non-guest users in the org is unchanged.
    assert.deepEqual(userCountUpdates[orgId as number], undefined);
    // Move the doc back to Horizon
    const resp2 = await axios.patch(`${homeUrl}/api/docs/${did}/move`,
      {workspace: wsId1}, chimpy);
    assert.equal(resp2.status, 200);
    // Assert that the number of non-guest users in the org is unchanged.
    assert.deepEqual(userCountUpdates[orgId as number], undefined);
    // Check that the doc is removed from the source workspace
    const verifyResp3 = await axios.get(`${homeUrl}/api/workspaces/${wsId2}`, chimpy);
    assert.deepEqual(verifyResp3.data.docs.map((doc: any) => doc.name),
      ['Curiosity', 'Apathy', 'Boredom']);
    // Check that the doc is added to the dest workspace
    const verifyResp4 = await axios.get(`${homeUrl}/api/workspaces/${wsId1}`, chimpy);
    assert.deepEqual(verifyResp4.data.docs.map((doc: any) => doc.name),
      ['Jupiter', 'Pluto', 'Beyond']);
    // Check that Kiwi is NO LONGER a guest of the source workspace
    const kiwiResp3 = await axios.get(`${homeUrl}/api/workspaces/${wsId2}`, kiwi);
    assert.equal(kiwiResp3.status, 403);
    // Check that Kiwi is a guest of the destination workspace
    const kiwiResp5 = await axios.get(`${homeUrl}/api/workspaces/${wsId1}`, kiwi);
    assert.equal(kiwiResp5.status, 200);
    // Finish by revoking Kiwi's access
    const delta2 = {
      users: {[kiwiEmail]: null}
    };
    const accessResp2 = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta: delta2}, chimpy);
    assert.equal(accessResp2.status, 200);
    // Assert that the number of non-guest users in the org is unchanged.
    assert.deepEqual(userCountUpdates[orgId as number], undefined);

    // Test adding a doc and moving it to a workspace with less access
    const fishOrg = await dbManager.testGetId('Fish');
    const bigWs = await dbManager.testGetId('Big');
    const resp = await axios.post(`${homeUrl}/api/workspaces/${bigWs}/docs`, {
      name: 'Magic'
    }, chimpy);
    // Assert that the response is successful and contains the doc id.
    assert.equal(resp.status, 200);
    const magicDocId = resp.data;
    // Remove chimpy's direct owner permission on this document. Chimpy is added directly as an owner.
    // We need to do it as a different user.
    assert.equal((await axios.patch(`${homeUrl}/api/docs/${magicDocId}/access`, {delta: {
      users: {[charonEmail]: 'owners'}
    }}, chimpy)).status, 200);
    assert.equal((await axios.patch(`${homeUrl}/api/docs/${magicDocId}/access`, {delta: {
      users: {[chimpyEmail]: null}
    }}, charon)).status, 200);
    // Create a workspace and limit Chimpy's access to that workspace.
    const addMediumWsResp = await axios.post(`${homeUrl}/api/orgs/${fishOrg}/workspaces`, {
      name: 'Medium'
    }, chimpy);
    assert.equal(addMediumWsResp.status, 200);
    const mediumWs = addMediumWsResp.data;
    // Limit all access to it expect for Kiwi.
    const delta3 = {
      maxInheritedRole: null,
      users: {[kiwiEmail]: 'owners'}
    };
    const accessResp3 = await axios.patch(`${homeUrl}/api/workspaces/${mediumWs}/access`,
      {delta: delta3}, chimpy);
    assert.equal(accessResp3.status, 200);
    // Chimpy's access must be removed by Kiwi, since Chimpy would have been granted access
    // by being unable to limit his own access.
    const delta4 = {
      users: {[chimpyEmail]: 'editors'}
    };
    const accessResp4 = await axios.patch(`${homeUrl}/api/workspaces/${mediumWs}/access`,
      {delta: delta4}, kiwi);
    assert.equal(accessResp4.status, 200);

    // Move the doc to the new 'Medium' workspace.
    const moveMagicResp = await axios.patch(`${homeUrl}/api/docs/${magicDocId}/move`,
      {workspace: mediumWs}, chimpy);
    assert.equal(moveMagicResp.status, 200);
    // Check that doc access on magic can no longer be edited by chimpy
    const delta = {
      users: {
        [kiwiEmail]: 'editors'
      }
    };
    const accessResp = await axios.patch(`${homeUrl}/api/docs/${magicDocId}/access`,
      {delta}, chimpy);
    assert.equal(accessResp.status, 403);
    // Finish by removing the added workspace
    const removeResp = await axios.delete(`${homeUrl}/api/workspaces/${mediumWs}`, chimpy);
    // Assert that the response is successful.
    assert.equal(removeResp.status, 200);
  });

  it('PATCH /api/docs/{did}/move is operational between orgs', async function() {
    const did = await dbManager.testGetId('Jupiter');
    const srcWsId = await dbManager.testGetId('Horizon');
    const srcOrgId = await dbManager.testGetId('NASA');
    const dstWsId = await dbManager.testGetId('Private');
    const dstOrgId = await dbManager.testGetId('Chimpyland');

    // Check that move returns 200
    const resp1 = await axios.patch(`${homeUrl}/api/docs/${did}/move`,
      {workspace: dstWsId}, chimpy);
    assert.equal(resp1.status, 200);
    // Check that the doc is removed from the source workspace
    const verifyResp1 = await axios.get(`${homeUrl}/api/workspaces/${srcWsId}`, chimpy);
    assert.deepEqual(verifyResp1.data.docs.map((doc: any) => doc.name), ['Pluto', 'Beyond']);
    // Check that the doc is added to the dest workspace
    const verifyResp2 = await axios.get(`${homeUrl}/api/workspaces/${dstWsId}`, chimpy);
    assert.deepEqual(verifyResp2.data.docs.map((doc: any) => doc.name),
      ['Jupiter', 'Timesheets', 'Appointments']);

    // Assert that the number of non-guest users in the org is unchanged.
    assert.deepEqual(userCountUpdates[srcOrgId as number], undefined);
    assert.deepEqual(userCountUpdates[dstOrgId as number], undefined);

    // Try a complex case - give a user special access to the doc then move it back
    // Make Kiwi a doc editor for Jupiter
    const delta1 = {
      users: {[kiwiEmail]: 'editors'}
    };
    const accessResp1 = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta: delta1}, chimpy);
    assert.equal(accessResp1.status, 200);
    // Check that Kiwi is a guest of the workspace/org
    const kiwiResp1 = await axios.get(`${homeUrl}/api/workspaces/${dstWsId}`, kiwi);
    assert.equal(kiwiResp1.status, 200);
    const kiwiResp2 = await axios.get(`${homeUrl}/api/orgs/${dstOrgId}`, kiwi);
    assert.equal(kiwiResp2.status, 200);
    // Assert that the number of non-guest users in 'Chimpyland' is unchanged.
    assert.deepEqual(userCountUpdates[srcOrgId as number], undefined);
    assert.deepEqual(userCountUpdates[dstOrgId as number], undefined);
    // Move the doc back to Horizon
    const resp2 = await axios.patch(`${homeUrl}/api/docs/${did}/move`,
      {workspace: srcWsId}, chimpy);
    assert.equal(resp2.status, 200);
    // Check that the doc is removed from the source workspace
    const verifyResp3 = await axios.get(`${homeUrl}/api/workspaces/${dstWsId}`, chimpy);
    assert.deepEqual(verifyResp3.data.docs.map((doc: any) => doc.name),
      ['Timesheets', 'Appointments']);
    // Check that the doc is added to the dest workspace
    const verifyResp4 = await axios.get(`${homeUrl}/api/workspaces/${srcWsId}`, chimpy);
    assert.deepEqual(verifyResp4.data.docs.map((doc: any) => doc.name),
      ['Jupiter', 'Pluto', 'Beyond']);
    // Check that Kiwi is NO LONGER a guest of the workspace/org
    const kiwiResp3 = await axios.get(`${homeUrl}/api/workspaces/${dstWsId}`, kiwi);
    assert.equal(kiwiResp3.status, 403);
    const kiwiResp4 = await axios.get(`${homeUrl}/api/orgs/${dstOrgId}`, kiwi);
    assert.equal(kiwiResp4.status, 403);
    // Check that Kiwi is a guest of the new workspace/org
    const kiwiResp5 = await axios.get(`${homeUrl}/api/workspaces/${srcWsId}`, kiwi);
    assert.equal(kiwiResp5.status, 200);
    const kiwiResp6 = await axios.get(`${homeUrl}/api/orgs/${srcOrgId}`, kiwi);
    assert.equal(kiwiResp6.status, 200);
    // Assert that the number of non-guest users in the orgs have not changed.
    assert.deepEqual(userCountUpdates[srcOrgId as number], undefined);
    assert.deepEqual(userCountUpdates[dstOrgId as number], undefined);
    // Finish by revoking Kiwi's access
    const delta2 = {
      users: {[kiwiEmail]: null}
    };
    const accessResp2 = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta: delta2}, chimpy);
    assert.equal(accessResp2.status, 200);
    // Assert that the number of non-guest users in the orgs have not changed.
    assert.deepEqual(userCountUpdates[srcOrgId as number], undefined);
    assert.deepEqual(userCountUpdates[dstOrgId as number], undefined);

    // Add a doc and move it to a workspace with less access
    const publicWs = await dbManager.testGetId('Public');
    const resp = await axios.post(`${homeUrl}/api/workspaces/${publicWs}/docs`, {
      name: 'Magic'
    }, chimpy);
    // Assert that the response is successful and contains the doc id.
    assert.equal(resp.status, 200);
    const magicDocId = resp.data;
    // Remove chimpy's direct owner permission on this document. Chimpy is added directly as an owner.
    // We need to do it as a different user.
    assert.equal((await axios.patch(`${homeUrl}/api/docs/${magicDocId}/access`, {delta: {
      users: {[charonEmail]: 'owners'}
    }}, chimpy)).status, 200);
    assert.equal((await axios.patch(`${homeUrl}/api/docs/${magicDocId}/access`, {delta: {
      users: {[chimpyEmail]: null}
    }}, charon)).status, 200);
    // Move the doc to Vacuum
    const vacuum = await dbManager.testGetId('Vacuum');
    const moveMagicResp = await axios.patch(`${homeUrl}/api/docs/${magicDocId}/move`,
      {workspace: vacuum}, chimpy);
    assert.equal(moveMagicResp.status, 200);
    // Check that doc access on magic can no longer be edited by chimpy
    const delta = {
      users: {
        [kiwiEmail]: 'editors'
      }
    };
    const accessResp = await axios.patch(`${homeUrl}/api/docs/${magicDocId}/access`,
      {delta}, chimpy);
    assert.equal(accessResp.status, 403);
    // Finish by removing the added doc
    let removeResp = await axios.delete(`${homeUrl}/api/docs/${magicDocId}`, chimpy);
    // Assert that the response is a failure - we are only editors.
    assert.equal(removeResp.status, 403);
    const store = server.getWorkStore().getPermitStore('internal');
    const goodDocPermit = await store.setPermit({docId: magicDocId});
    removeResp = await axios.delete(`${homeUrl}/api/docs/${magicDocId}`, configWithPermit(chimpy, goodDocPermit));
    assert.equal(removeResp.status, 200);
  });

  it('PATCH /api/docs/{did}/move returns 404 appropriately', async function() {
    const workspace = await dbManager.testGetId('Private');
    const resp = await axios.patch(`${homeUrl}/api/docs/9999/move`,  {workspace}, chimpy);
    assert.equal(resp.status, 404);
  });

  it('PATCH /api/docs/{did}/move returns 403 appropriately', async function() {
    // Attempt moving a doc that the caller does not own, assert that it fails.
    const did = await dbManager.testGetId('Bananas');
    const workspace = await dbManager.testGetId('Private');
    const resp = await axios.patch(`${homeUrl}/api/docs/${did}/move`, {workspace}, chimpy);
    assert.equal(resp.status, 403);
    // Attempt moving a doc that the caller owns to a workspace to which they do not
    // have ADD access. Assert that it fails.
    const did2 = await dbManager.testGetId('Timesheets');
    const workspace2 = await dbManager.testGetId('Fruit');
    const resp2 = await axios.patch(`${homeUrl}/api/docs/${did2}/move`,
      {workspace: workspace2}, chimpy);
    assert.equal(resp2.status, 403);
  });

  it('PATCH /api/docs/{did}/move returns 400 appropriately', async function() {
    // Assert that attempting to move a doc to the workspace it starts in
    // returns 400
    const did = await dbManager.testGetId('Jupiter');
    const srcWsId = await dbManager.testGetId('Horizon');
    const resp = await axios.patch(`${homeUrl}/api/docs/${did}/move`,
      {workspace: srcWsId}, chimpy);
    assert.equal(resp.status, 400);
  });

  it('PATCH /api/docs/:did/pin is operational', async function() {
    const nasaOrgId = await dbManager.testGetId('NASA');
    const chimpylandOrgId = await dbManager.testGetId('Chimpyland');
    const plutoDocId = await dbManager.testGetId('Pluto');
    const timesheetsDocId = await dbManager.testGetId('Timesheets');
    const appointmentsDocId = await dbManager.testGetId('Appointments');
    // Pin 3 docs in 2 different orgs.
    const resp1 = await axios.patch(`${homeUrl}/api/docs/${plutoDocId}/pin`, {}, chimpy);
    assert.equal(resp1.status, 200);
    const resp2 = await axios.patch(`${homeUrl}/api/docs/${timesheetsDocId}/pin`, {}, chimpy);
    assert.equal(resp2.status, 200);
    const resp3 = await axios.patch(`${homeUrl}/api/docs/${appointmentsDocId}/pin`, {}, chimpy);
    assert.equal(resp3.status, 200);
    // Assert that the docs are set as pinned when retrieved.
    const fetchResp1 = await axios.get(`${homeUrl}/api/orgs/${nasaOrgId}/workspaces`, charon);
    assert.equal(fetchResp1.status, 200);
    assert.deepEqual(fetchResp1.data[0].docs.map((doc: any) => omit(doc, 'createdAt', 'updatedAt')), [{
      id: await dbManager.testGetId('Pluto'),
      name: 'Pluto',
      access: 'viewers',
      isPinned: true,
      urlId: null,
      trunkId: null,
      type: null,
      forks: [],
    }]);
    const fetchResp2 = await axios.get(`${homeUrl}/api/orgs/${chimpylandOrgId}/workspaces`, charon);
    assert.equal(fetchResp2.status, 200);
    const privateWs = fetchResp2.data.find((ws: any) => ws.name === 'Private');
    assert.deepEqual(privateWs.docs.map((doc: any) => omit(doc, 'createdAt', 'updatedAt')), [{
      id: timesheetsDocId,
      name: 'Timesheets',
      access: 'viewers',
      isPinned: true,
      urlId: null,
      trunkId: null,
      type: null,
      forks: [],
    }, {
      id: appointmentsDocId,
      name: 'Appointments',
      access: 'viewers',
      isPinned: true,
      urlId: null,
      trunkId: null,
      type: null,
      forks: [],
    }]);
    // Pin a doc that is already pinned and assert that it returns 200.
    const resp4 = await axios.patch(`${homeUrl}/api/docs/${appointmentsDocId}/pin`, {}, chimpy);
    assert.equal(resp4.status, 200);
  });

  it('PATCH /api/docs/:did/pin returns 404 appropriately', async function() {
    // Attempt to pin a doc that doesn't exist.
    const resp1 = await axios.patch(`${homeUrl}/api/docs/9999/pin`, {}, charon);
    assert.equal(resp1.status, 404);
  });

  it('PATCH /api/docs/:did/pin returns 403 appropriately', async function() {
    const antarticDocId = await dbManager.testGetId('Antartic');
    const sharkDocId = await dbManager.testGetId('Shark');

    // Attempt to pin a doc with only view access (should fail).
    const resp1 = await axios.patch(`${homeUrl}/api/docs/${antarticDocId}/pin`, {}, chimpy);
    assert.equal(resp1.status, 403);

    // Attempt to pin a doc with org edit access but no doc access (should succeed).
    const delta1 = { maxInheritedRole: 'viewers' };
    const setupResp1 = await axios.patch(`${homeUrl}/api/docs/${sharkDocId}/access`, {delta: delta1}, chimpy);
    assert.equal(setupResp1.status, 200);
    // Check that access to shark is as expected.
    const setupResp2 = await axios.get(`${homeUrl}/api/docs/${sharkDocId}/access`, chimpy);
    assert.equal(setupResp2.status, 200);
    assert.deepEqual(setupResp2.data, {
      maxInheritedRole: 'viewers',
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",  // Chimpy's access is explicit since he is the owner who set access.
        parentAccess: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: null,
        parentAccess: "editors",
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: null,
        parentAccess: "viewers",
        isMember: true,
      }]
    });
    // Perform the pin.
    const resp2 = await axios.patch(`${homeUrl}/api/docs/${sharkDocId}/pin`, {}, kiwi);
    assert.equal(resp2.status, 200);
    // And unpin and restore access to keep the state consistent.
    const setupResp3 = await axios.patch(`${homeUrl}/api/docs/${sharkDocId}/unpin`, {}, kiwi);
    assert.equal(setupResp3.status, 200);

    // Attempt to pin a doc with viewer org access but edit doc access (should fail).
    const delta2 = {
      maxInheritedRole: 'owners',
      users: {
        [charonEmail]: 'editors'
      }
    };
    const setupResp4 = await axios.patch(`${homeUrl}/api/docs/${sharkDocId}/access`, {delta: delta2}, chimpy);
    assert.equal(setupResp4.status, 200);
    // Check that access to shark is as expected.
    const setupResp5 = await axios.get(`${homeUrl}/api/docs/${sharkDocId}/access`, chimpy);
    assert.equal(setupResp5.status, 200);
    assert.deepEqual(setupResp5.data, {
      maxInheritedRole: 'owners',
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: 'owners',
        parentAccess: 'owners',
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: null,
        parentAccess: 'editors',
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: 'editors',
        parentAccess: 'viewers',
        isMember: true,
      }]
    });
    // Attempt the pin.
    const resp3 = await axios.patch(`${homeUrl}/api/docs/${sharkDocId}/pin`, {}, charon);
    assert.equal(resp3.status, 403);
    // Restore access to keep the state consistent.
    const delta4 = {
      users: {
        [charonEmail]: null
      }
    };
    const setupResp6 = await axios.patch(`${homeUrl}/api/docs/${sharkDocId}/access`, {delta: delta4}, chimpy);
    assert.equal(setupResp6.status, 200);
  });

  it('PATCH /api/docs/:did/unpin is operational', async function() {
    const chimpylandOrgId = await dbManager.testGetId('Chimpyland');
    const plutoDocId = await dbManager.testGetId('Pluto');
    const timesheetsDocId = await dbManager.testGetId('Timesheets');
    const appointmentsDocId = await dbManager.testGetId('Appointments');

    // Unpin 3 previously pinned docs.
    const resp1 = await axios.patch(`${homeUrl}/api/docs/${plutoDocId}/unpin`, {}, chimpy);
    assert.equal(resp1.status, 200);
    const resp2 = await axios.patch(`${homeUrl}/api/docs/${timesheetsDocId}/unpin`, {}, chimpy);
    assert.equal(resp2.status, 200);
    const resp3 = await axios.patch(`${homeUrl}/api/docs/${appointmentsDocId}/unpin`, {}, chimpy);
    assert.equal(resp3.status, 200);

    // Fetch pinned docs to ensure the docs are no longer pinned.
    const fetchResp1 = await axios.get(`${homeUrl}/api/orgs/${chimpylandOrgId}/workspaces`, charon);
    assert.equal(fetchResp1.status, 200);
    const privateWs = fetchResp1.data.find((ws: any) => ws.name === 'Private');
    assert.deepEqual(privateWs.docs.map((doc: any) => omit(doc, 'createdAt', 'updatedAt')), [{
      id: timesheetsDocId,
      name: 'Timesheets',
      access: 'viewers',
      isPinned: false,
      urlId: null,
      trunkId: null,
      type: null,
      forks: [],
    }, {
      id: appointmentsDocId,
      name: 'Appointments',
      access: 'viewers',
      isPinned: false,
      urlId: null,
      trunkId: null,
      type: null,
      forks: [],
    }]);
    // Unpin doc that is already not pinned and assert that it returns 200.
    const resp4 = await axios.patch(`${homeUrl}/api/docs/${plutoDocId}/unpin`, {}, chimpy);
    assert.equal(resp4.status, 200);
  });

  it('PATCH /api/docs/:did/unpin returns 404 appropriately', async function() {
    // Attempt to unpin a doc that doesn't exist.
    const resp1 = await axios.patch(`${homeUrl}/api/docs/9999/unpin`, {}, charon);
    assert.equal(resp1.status, 404);
  });

  it('PATCH /api/docs/:did/unpin returns 403 appropriately', async function() {
    const antarticDocId = await dbManager.testGetId('Antartic');
    // Attempt to pin a doc with only view access (should fail).
    const resp1 = await axios.patch(`${homeUrl}/api/docs/${antarticDocId}/pin`, {}, chimpy);
    assert.equal(resp1.status, 403);
  });

  it('GET /api/profile/user returns user info', async function() {
    const resp = await axios.get(`${homeUrl}/api/profile/user`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      id: 1,
      email: chimpyEmail,
      ref: chimpyRef,
      name: "Chimpy",
      picture: null,
      allowGoogleLogin: true,
    });
  });

  it('GET /api/profile/user can return anonymous user', async function() {
    const resp = await axios.get(`${homeUrl}/api/profile/user`, nobody);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.email, "anon@getgrist.com");
    assert.equal(resp.data.anonymous, true);
  });

  it('POST /api/profile/user/name updates user\' name', async function() {

    let resp: AxiosResponse<any>;
    async function getName(config: AxiosRequestConfig = chimpy) {
      return (await axios.get(`${homeUrl}/api/profile/user`, config)).data.name;
    }

    // name should 'Chimpy' initially
    assert.equal(await getName(), 'Chimpy');

    // let's change it
    resp = await axios.post(`${homeUrl}/api/profile/user/name`, {name: 'babaganoush'}, chimpy);
    assert.equal(resp.status, 200);


    // check
    assert.equal(await getName(), "babaganoush");

    // revert to 'Chimpy'
    resp = await axios.post(`${homeUrl}/api/profile/user/name`, {name: 'Chimpy'}, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(await getName(), "Chimpy");

    // requests treated as bad unless it has name provided
    resp = await axios.post(`${homeUrl}/api/profile/user/name`, null, chimpy);
    assert.equal(resp.status, 400);
    assert.match(resp.data.error, /name expected/i);

    // anonymous user not allowed to set name
    resp = await axios.post(`${homeUrl}/api/profile/user/name`, {name: 'Testy'}, nobody);
    assert.equal(resp.status, 401);
    assert.match(resp.data.error, /not authorized/i);
    assert.equal(await getName(nobody), "Anonymous");
  });

  it('POST /api/profile/allowGoogleLogin updates Google login preference', async function() {
    let loginCookie: AxiosRequestConfig = await server.getCookieLogin('nasa', {
      email: 'chimpy@getgrist.com',
      name: 'Chimpy',
      loginMethod: 'Email + Password',
    });

    async function isGoogleLoginAllowed() {
      return (await axios.get(`${homeUrl}/api/profile/user`, loginCookie)).data.allowGoogleLogin;
    }

    // Should be set to true by default.
    assert(await isGoogleLoginAllowed());

    // Setting it via an email/password session should work.
    let resp = await axios.post(`${homeUrl}/api/profile/allowGoogleLogin`, {allowGoogleLogin: false}, loginCookie);
    assert.equal(resp.status, 200);
    assert.equal(await isGoogleLoginAllowed(), false);

    // Setting it without the body param should fail.
    resp = await axios.post(`${homeUrl}/api/profile/allowGoogleLogin`, null, loginCookie);
    assert.equal(resp.status, 400);
    assert.equal(resp.data.error, 'Missing body param: allowGoogleLogin');

    // Setting it via API or a Google login session should fail.
    loginCookie = chimpy;
    resp = await axios.post(`${homeUrl}/api/profile/allowGoogleLogin`, {allowGoogleLogin: false}, loginCookie);
    assert.equal(resp.status, 401);
    assert.equal(resp.data.error, 'Only users signed in via email can enable/disable Google login');
    assert.equal(await isGoogleLoginAllowed(), false);

    loginCookie = await server.getCookieLogin('nasa', {
      email: 'chimpy@getgrist.com',
      name: 'Chimpy',
      loginMethod: 'Google',
    });
    resp = await axios.post(`${homeUrl}/api/profile/allowGoogleLogin`, {allowGoogleLogin: false}, loginCookie);
    assert.equal(resp.status, 401);
    assert.equal(resp.data.error, 'Only users signed in via email can enable/disable Google login');
    assert.equal(await isGoogleLoginAllowed(), false);

    // Setting it as an anonymous user should fail.
    resp = await axios.post(`${homeUrl}/api/profile/allowGoogleLogin`, {allowGoogleLogin: false}, nobody);
    assert.equal(resp.status, 401);
    assert.match(resp.data.error, /not authorized/i);
  });

  it('DELETE /api/user/:uid can delete a user', async function() {
    const countsBefore = await getRowCounts();

    // create a new user
    const profile = {email: 'meep@getgrist.com', name: 'Meep'};
    const user = await dbManager.getUserByLogin('meep@getgrist.com', {profile});
    assert(user);
    const userId = user!.id;
    // set up an api key
    await dbManager.connection.query("update users set api_key = 'api_key_for_meep' where id = $1", [userId]);

    // make sure we have at least one extra user, a login, an org, a group_user entry,
    // a billing account, a billing account manager.
    const countsWithMeep = await getRowCounts();
    assert.isAbove(countsWithMeep.users, countsBefore.users);
    assert.isAbove(countsWithMeep.logins, countsBefore.logins);
    assert.isAbove(countsWithMeep.orgs, countsBefore.orgs);
    assert.isAbove(countsWithMeep.groupUsers, countsBefore.groupUsers);
    assert.isAbove(countsWithMeep.billingAccounts, countsBefore.billingAccounts);
    assert.isAbove(countsWithMeep.billingAccountManagers, countsBefore.billingAccountManagers);

    // requests treated as bad unless it has name provided
    let resp = await axios.delete(`${homeUrl}/api/users/${userId}`, configForUser("meep"));
    assert.equal(resp.status, 400);
    assert.match(resp.data.error, /provide their name/);

    // others cannot delete this user
    resp = await axios.delete(`${homeUrl}/api/users/${userId}`,
                              {data: {name: "Meep"}, ...configForUser("chimpy")});
    assert.equal(resp.status, 403);
    assert.match(resp.data.error, /not permitted/);

    // user cannot delete themselves if they get their name wrong
    resp = await axios.delete(`${homeUrl}/api/users/${userId}`,
                              {data: {name: "Moop"}, ...configForUser("meep")});
    assert.equal(resp.status, 400);
    assert.match(resp.data.error, /user name did not match/);

    // user can delete themselves if they get the name right
    resp = await axios.delete(`${homeUrl}/api/users/${userId}`,
                              {data: {name: "Meep"}, ...configForUser("meep")});
    assert.equal(resp.status, 200);

    // create a user with a blank name
    const userBlank = await dbManager.getUserByLogin('blank@getgrist.com',
                                                     {profile: {email: 'blank@getgrist.com',
                                                      name: ''}});
    assert(userBlank);
    await dbManager.connection.query("update users set api_key = 'api_key_for_blank' where id = $1", [userBlank!.id]);

    // check that user can delete themselves
    resp = await axios.delete(`${homeUrl}/api/users/${userBlank!.id}`,
                              {data: {name: ""}, ...configForUser("blank")});
    assert.equal(resp.status, 200);

    const countsAfter = await getRowCounts();
    assert.deepEqual(countsAfter, countsBefore);
  });

  describe('GET /api/orgs/{oid}/usage', function() {
    let freeTeamOrgId: number;
    let freeTeamWorkspaceId: number;

    async function assertOrgUsage(
      orgId: string | number,
      user: AxiosRequestConfig,
      expected: OrgUsageSummary | 'denied'
    ) {
      const resp = await axios.get(`${homeUrl}/api/orgs/${orgId}/usage`, user);
      if (expected === 'denied') {
        assert.equal(resp.status, 403);
        assert.deepEqual(resp.data, {error: 'access denied'});
      } else {
        assert.equal(resp.status, 200);
        assert.deepEqual(resp.data, expected);
      }
    }

    before(async () => {
      // Set up a free team site for testing usage. Avoid using billing endpoints,
      // which may not be available in all test environments.
      await axios.post(`${homeUrl}/api/orgs`, {
        name: 'best-friends-squad',
        domain: 'best-friends-squad',
      }, chimpy);
      freeTeamOrgId = await dbManager.testGetId('best-friends-squad') as number;
      const prevAccount = await dbManager.getBillingAccount(
        {userId: dbManager.getPreviewerUserId()},
        'best-friends-squad', false);
      await dbManager.connection.query(
        'update billing_accounts set product_id = (select id from products where name = $1) where id = $2',
        ['teamFree', prevAccount.id]
      );

      const resp = await axios.post(`${homeUrl}/api/orgs/${freeTeamOrgId}/workspaces`, {
        name: 'TestUsage'
      }, chimpy);
      freeTeamWorkspaceId = resp.data;
    });

    after(async () => {
      // Remove the free team site.
      await axios.delete(`${homeUrl}/api/orgs/${freeTeamOrgId}`, chimpy);
    });

    it('is operational', async function() {
      await assertOrgUsage(freeTeamOrgId, chimpy, createEmptyOrgUsageSummary());

      const nasaOrgId = await dbManager.testGetId('NASA');
      await assertOrgUsage(nasaOrgId, chimpy, createEmptyOrgUsageSummary());
    });

    it('requires owners access', async function() {
      await assertOrgUsage(freeTeamOrgId, kiwi, 'denied');

      const kiwilandOrgId = await dbManager.testGetId('Kiwiland');
      await assertOrgUsage(kiwilandOrgId, kiwi, createEmptyOrgUsageSummary());
    });

    it('fails if user is anon', async function() {
      await assertOrgUsage(freeTeamOrgId, nobody, 'denied');

      const primatelyOrgId = await dbManager.testGetId('Primately');
      await assertOrgUsage(primatelyOrgId, nobody, 'denied');
    });

    it('reports count of docs approaching/exceeding limits', async function() {
      // Add a handful of documents to the TestUsage workspace.
      const promises = [];
      for (const name of ['GoodStanding', 'ApproachingLimits', 'GracePeriod', 'DeleteOnly']) {
        promises.push(axios.post(`${homeUrl}/api/workspaces/${freeTeamWorkspaceId}/docs`, {name}, chimpy));
      }
      const docIds: string[] = (await Promise.all(promises)).map(resp => resp.data);

      // Prepare one of each usage type.
      const goodStanding = {rowCount: {total: 100}, dataSizeBytes: 1024, attachmentsSizeBytes: 4096};
      const approachingLimits = {rowCount: {total: 4501}, dataSizeBytes: 4501 * 2 * 1024, attachmentsSizeBytes: 4096};
      const gracePeriod = {rowCount: {total: 5001}, dataSizeBytes: 5001 * 2 * 1024, attachmentsSizeBytes: 4096};
      const deleteOnly = gracePeriod;

      // Set usage for each document. (This is normally done by ActiveDoc, but we
      // facilitate here to keep the tests simple.)
      const docUsage = [goodStanding, approachingLimits, gracePeriod, deleteOnly];
      const idsAndUsage = docIds.map((id, i) => [id, docUsage[i]] as const);
      for (const [id, usage] of idsAndUsage) {
        await server.dbManager.setDocsMetadata({[id]: {usage}});
      }
      await server.dbManager.setDocGracePeriodStart(docIds[docIds.length - 1], new Date(2000, 1, 1));

      // Check that what's reported by /usage is accurate.
      await assertOrgUsage(freeTeamOrgId, chimpy, {
        approachingLimit: 1,
        gracePeriod: 1,
        deleteOnly: 1,
      });
    });

    it('only counts documents from org in path', async function() {
      // Check NASA's usage once more, and make sure everything is still 0. This test is mostly
      // a sanity check that results are in fact scoped by org.
      const nasaOrgId = await dbManager.testGetId('NASA');
      await assertOrgUsage(nasaOrgId, chimpy, createEmptyOrgUsageSummary());
    });

    it('excludes soft-deleted documents from count', async function() {
      // Add another document that's exceeding limits.
      const docId: string = (await axios.post(`${homeUrl}/api/workspaces/${freeTeamWorkspaceId}/docs`, {
        name: 'SoftDeleted'
      }, chimpy)).data;
      await server.dbManager.setDocsMetadata({[docId]: {usage: {
        rowCount: {total: 9999},
        dataSizeBytes: 999999999,
        attachmentsSizeBytes: 999999999,
      }}});

      // Check that /usage includes that document in the count.
      await assertOrgUsage(freeTeamOrgId, chimpy, {
        approachingLimit: 1,
        gracePeriod: 2,
        deleteOnly: 1,
      });

      // Now soft-delete the newly added document; make sure /usage no longer counts it.
      await axios.post(`${homeUrl}/api/docs/${docId}/remove`, {}, chimpy);
      await assertOrgUsage(freeTeamOrgId, chimpy, {
        approachingLimit: 1,
        gracePeriod: 1,
        deleteOnly: 1,
      });
    });

    it('excludes soft-deleted workspaces from count', async function() {
      // Remove the workspace containing all docs.
      await axios.post(`${homeUrl}/api/workspaces/${freeTeamWorkspaceId}/remove`, {}, chimpy);

      // Check that /usage now reports a count of zero for all status types.
      await assertOrgUsage(freeTeamOrgId, chimpy, createEmptyOrgUsageSummary());
    });
  });

  // Template test moved to the end, since it deletes an org and makes
  // predicting ids a little trickier.
  it('GET /api/templates is operational', async function() {
    let oid;

    try {
      // Add a 'Grist Templates' org.
      await axios.post(`${homeUrl}/api/orgs`, {
        name: 'Grist Templates',
        domain: 'templates',
      }, support);
      oid = await dbManager.testGetId('Grist Templates');
      // Add some workspaces and templates (documents) to Grist Templates.
      const crmWsId = (await axios.post(`${homeUrl}/api/orgs/${oid}/workspaces`, {name: 'CRM'}, support)).data;
      const invoiceWsId = (await axios.post(`${homeUrl}/api/orgs/${oid}/workspaces`, {name: 'Invoice'}, support)).data;
      const crmDocId = (await axios.post(`${homeUrl}/api/workspaces/${crmWsId}/docs`,
        {name: 'Lightweight CRM', isPinned: true}, support)).data;
      const reportDocId = (await axios.post(`${homeUrl}/api/workspaces/${invoiceWsId}/docs`,
        {name: 'Expense Report'}, support)).data;
      const timesheetDocId = (await axios.post(`${homeUrl}/api/workspaces/${invoiceWsId}/docs`,
        {name: 'Timesheet'}, support)).data;
      // Make anon@/everyone@ a viewer of the public docs on Grist Templates.
      for (const id of [crmDocId, reportDocId, timesheetDocId]) {
        await axios.patch(`${homeUrl}/api/docs/${id}/access`, {
          delta: {users: {'anon@getgrist.com': 'viewers', 'everyone@getgrist.com': 'viewers'}}
        }, support);
      }

      // Make a request to retrieve all templates as an anonymous user.
      const resp = await axios.get(`${homeUrl}/api/templates`, nobody);
      // Assert that the response contains the right workspaces and template documents.
      assert.equal(resp.status, 200);
      assert.lengthOf(resp.data, 2);
      assert.deepEqual(resp.data.map((ws: any) => ws.name), ['CRM', 'Invoice']);
      assert.deepEqual(resp.data[0].docs.map((doc: any) => doc.name), ['Lightweight CRM']);
      assert.deepEqual(resp.data[1].docs.map((doc: any) => doc.name), ['Expense Report', 'Timesheet']);

      // Make a request to retrieve only the featured (pinned) templates.
      const resp2 = await axios.get(`${homeUrl}/api/templates/?onlyFeatured=1`, nobody);
      // Assert that the response includes only pinned documents.
      assert.equal(resp2.status, 200);
      assert.lengthOf(resp2.data, 2);
      assert.deepEqual(resp.data.map((ws: any) => ws.name), ['CRM', 'Invoice']);
      assert.deepEqual(resp2.data[0].docs.map((doc: any) => doc.name), ['Lightweight CRM']);
      assert.deepEqual(resp2.data[1].docs, []);

      // Add a new document to the CRM workspace, but don't share it with everyone.
      await axios.post(`${homeUrl}/api/workspaces/${crmWsId}/docs`,
        {name: 'Draft CRM Template', isPinned: true}, support);
      // Make another request to retrieve all templates as an anonymous user.
      const resp3 = await axios.get(`${homeUrl}/api/templates`, nobody);
      // Assert that the response does not include the new document.
      assert.lengthOf(resp3.data, 2);
      assert.deepEqual(resp3.data[0].docs.map((doc: any) => doc.name), ['Lightweight CRM']);
    } finally {
      // Remove the 'Grist Templates' org.
      if (oid) {
        await axios.delete(`${homeUrl}/api/orgs/${oid}`, support);
      }
    }
  });

  it('GET /api/templates returns 404 appropriately', async function() {
    // The 'Grist Templates' org currently doesn't exist.
    const resp = await axios.get(`${homeUrl}/api/templates`, nobody);
    // Assert that the response status is 404 because the templates org doesn't exist.
    assert.equal(resp.status, 404);
  });
});


// Predict the next id that will be used for a table.
// Only reliable if we haven't been deleting records in that table.
// Could make reliable by using sqlite_sequence in sqlite and the equivalent
// in postgres.
async function getNextId(dbManager: HomeDBManager, table: 'orgs'|'workspaces') {
  // Check current top org id.
  const row = await dbManager.connection.query(`select max(id) as id from ${table}`);
  const id = row[0]['id'];
  return id + 1;
}
