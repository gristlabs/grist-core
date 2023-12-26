import axios from 'axios';
import * as chai from 'chai';

import {configForUser} from 'test/gen-server/testUtils';
import * as testUtils from 'test/server/testUtils';

import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';

import {TestServer} from 'test/gen-server/apiUtils';

const assert = chai.assert;

let server: TestServer;
let dbManager: HomeDBManager;
let homeUrl: string;

const charon = configForUser('Charon');
const chimpy = configForUser('Chimpy');
const kiwi = configForUser('Kiwi');

const chimpyEmail = 'chimpy@getgrist.com';
const kiwiEmail = 'kiwi@getgrist.com';
const charonEmail = 'charon@getgrist.com';

// Tests specific complex scenarios that may have previously resulted in wrong behavior.
describe('ApiServerBugs', function() {

  testUtils.setTmpLogLevel('error');
  let userRef: (email: string) => Promise<string>;

  before(async function() {
    server = new TestServer(this);
    homeUrl = await server.start();
    dbManager = server.dbManager;
    userRef = (email) => server.dbManager.getUserByLogin(email).then((user) => user!.ref);
  });

  after(async function() {
    await server.stop();
  });

  // Re-create a bug scenario in which users being in normal groups and guests groups at the
  // same time resulted in them being dropped from groups arbitrarily on subsequent patches.
  it('should properly handle users in multiple groups at once', async function() {
    // Add Chimpy/Charon/Kiwi to 'Herring' doc and set inheritance to none. They
    // will become guests in the 'Fish' org along with their owner/viewer roles.
    const fishOrg = await dbManager.testGetId('Fish');
    const herringDoc = await dbManager.testGetId('Herring');
    const delta1 = {
      maxInheritedRole: null,
      users: {
        [kiwiEmail]: 'editors',
        [charonEmail]: 'viewers'
      }
    };
    let resp = await axios.patch(`${homeUrl}/api/docs/${herringDoc}/access`, {
      delta: delta1
    }, chimpy);
    assert.equal(resp.status, 200);
    // Ensure that the doc access is as expected.
    resp = await axios.get(`${homeUrl}/api/docs/${herringDoc}/access`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      maxInheritedRole: null,
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: await userRef(chimpyEmail),
        picture: null,
        parentAccess: "owners",
        access: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: await userRef(kiwiEmail),
        picture: null,
        parentAccess: "editors",
        access: "editors",
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: await userRef(charonEmail),
        picture: null,
        parentAccess: "viewers",
        access: "viewers",
        isMember: true,
      }]
    });

    // Remove Charon from the 'Fish' org and ensure that Chimpy and Kiwi still have
    // owner/editor roles on 'Fish'. Charon should no longer have guest access to the org.
    const delta2 = {
      users: {
        [charonEmail]: null
      }
    };
    resp = await axios.patch(`${homeUrl}/api/orgs/${fishOrg}/access`, {
      delta: delta2
    }, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${homeUrl}/api/orgs/${fishOrg}/access`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: await userRef(chimpyEmail),
        picture: null,
        access: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: await userRef(kiwiEmail),
        picture: null,
        access: "editors",
        isMember: true,
      }]
    });

    // Charon should no longer have access to the 'Herring' doc, now that user access
    // is wiped entirely when removed from org.
    resp = await axios.get(`${homeUrl}/api/docs/${herringDoc}`, charon);
    assert.equal(resp.status, 403);
    resp = await axios.get(`${homeUrl}/api/orgs/${fishOrg}`, charon);
    assert.equal(resp.status, 403);

    // Remove Kiwi as an editor from the 'Fish' org and ensure that Kiwi no longer has
    // access to 'Fish' or 'Herring'
    const delta3 = {
      users: {
        [kiwiEmail]: null
      }
    };
    resp = await axios.patch(`${homeUrl}/api/orgs/${fishOrg}/access`, {
      delta: delta3
    }, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${homeUrl}/api/docs/${herringDoc}`, kiwi);
    assert.equal(resp.status, 403);
    resp = await axios.get(`${homeUrl}/api/orgs/${fishOrg}`, kiwi);
    assert.equal(resp.status, 403);

    // Restore initial access.
    const delta4 = {
      maxInheritedRole: "owners",
      users: {
        [charonEmail]: null,
        [kiwiEmail]: null
      }
    };
    resp = await axios.patch(`${homeUrl}/api/docs/${herringDoc}/access`, {
      delta: delta4
    }, chimpy);
    assert.equal(resp.status, 200);
    const delta5 = {
      users: {
        [kiwiEmail]: "editors",
        [charonEmail]: "viewers"
      }
    };
    resp = await axios.patch(`${homeUrl}/api/orgs/${fishOrg}/access`, {
      delta: delta5
    }, chimpy);
    assert.equal(resp.status, 200);
  });
});
