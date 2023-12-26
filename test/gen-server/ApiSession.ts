import {UserProfile} from 'app/common/LoginSessionAPI';
import {AccessOptionWithRole} from 'app/gen-server/entity/Organization';
import axios from 'axios';
import {AxiosRequestConfig} from 'axios';
import {assert} from 'chai';
import omit = require('lodash/omit');
import {TestServer} from 'test/gen-server/apiUtils';
import * as testUtils from 'test/server/testUtils';

const nobody: AxiosRequestConfig = {
  responseType: 'json',
  validateStatus: (status: number) => true
};

describe('ApiSession', function() {

  let server: TestServer;
  let serverUrl: string;
  testUtils.setTmpLogLevel('error');

  const regular = 'chimpy@getgrist.com';

  beforeEach(async function() {
    this.timeout(5000);
    server = new TestServer(this);
    serverUrl = await server.start();
  });

  afterEach(async function() {
    await server.stop();
  });

  it('GET /api/session/access/active returns user and org (with access)', async function() {
    const cookie = await server.getCookieLogin('nasa', {email: regular, name: 'Chimpy'});

    const resp = await axios.get(`${serverUrl}/o/nasa/api/session/access/active`, cookie);
    assert.equal(resp.status, 200);
    assert.sameMembers(['user', 'org'], Object.keys(resp.data));
    assert.deepEqual(omit(resp.data.user, ['helpScoutSignature', 'ref']), {
      id: await server.dbManager.testGetId("Chimpy"),
      email: "chimpy@getgrist.com",
      name: "Chimpy",
      picture: null,
    });
    assert.deepEqual(omit(resp.data.org, ['billingAccount', 'createdAt', 'updatedAt']), {
      id: await server.dbManager.testGetId("NASA"),
      name: "NASA",
      access: "owners",
      domain: "nasa",
      host: null,
      owner: null
    });
  });

  it('GET /api/session/access/active returns org with billing account information', async function() {
    const cookie = await server.getCookieLogin('nasa', {email: regular, name: 'Chimpy'});

    // Make Chimpy a billing account manager for NASA.
    await server.addBillingManager('Chimpy', 'nasa');

    const resp = await axios.get(`${serverUrl}/o/nasa/api/session/access/active`, cookie);
    assert.equal(resp.status, 200);
    assert.hasAllKeys(resp.data.org, ['id', 'name', 'access', 'domain', 'owner', 'billingAccount',
                                      'createdAt', 'updatedAt', 'host']);
    assert.deepEqual(resp.data.org.billingAccount,
                     { id: 1, individual: false, inGoodStanding: true, status: null,
                       externalId: null, externalOptions: null,
                       isManager: true, paid: false,
                       product: { id: 1, name: 'Free', features: {workspaces: true, vanityDomain: true} } });

    // Check that internally we have access to stripe ids.
    const userId = await server.dbManager.testGetId('Chimpy') as number;
    const org2 = await server.dbManager.getOrg({userId}, 'nasa');
    assert.hasAllKeys(org2.data!.billingAccount,
                      ['id', 'individual', 'inGoodStanding', 'status', 'stripeCustomerId',
                       'stripeSubscriptionId', 'stripePlanId', 'product', 'paid', 'isManager',
                       'externalId', 'externalOptions']);
  });

  it('GET /api/session/access/active returns orgErr when org is forbidden', async function() {
    const cookie = await server.getCookieLogin('nasa', {email: 'kiwi@getgrist.com', name: 'Kiwi'});

    const resp = await axios.get(`${serverUrl}/o/nasa/api/session/access/active`, cookie);
    assert.equal(resp.status, 200);
    assert.sameMembers(['user', 'org', 'orgError'], Object.keys(resp.data));
    assert.deepEqual(omit(resp.data.user, ['helpScoutSignature', 'ref']), {
      id: await server.dbManager.testGetId("Kiwi"),
      email: "kiwi@getgrist.com",
      name: "Kiwi",
      picture: null,
    });
    assert.equal(resp.data.org, null);
    assert.deepEqual(resp.data.orgError, {
      status: 403,
      error: 'access denied'
    });
  });

  it('GET /api/session/access/active returns orgErr when org is non-existent', async function() {
    const cookie = await server.getCookieLogin('nasa', {email: 'kiwi@getgrist.com', name: 'Kiwi'});

    const resp = await axios.get(`${serverUrl}/o/boing/api/session/access/active`, cookie);
    assert.equal(resp.status, 200);
    assert.sameMembers(['user', 'org', 'orgError'], Object.keys(resp.data));
    assert.deepEqual(omit(resp.data.user, ['helpScoutSignature', 'ref']), {
      id: await server.dbManager.testGetId("Kiwi"),
      email: "kiwi@getgrist.com",
      name: "Kiwi",
      picture: null,
    });
    assert.equal(resp.data.org, null);
    assert.deepEqual(resp.data.orgError, {
      status: 404,
      error: 'organization not found'
    });
  });

  it('POST /api/session/access/active can change user', async function() {
    // add two profiles
    const cookie = await server.getCookieLogin('nasa', {email: 'charon@getgrist.com', name: 'Charon'});
    await server.getCookieLogin('pr', {email: 'kiwi@getgrist.com', name: 'Kiwi'});

    // pick kiwi profile for fish org
    let resp = await axios.post(`${serverUrl}/o/fish/api/session/access/active`, {
      email: 'kiwi@getgrist.com'
    }, cookie);
    assert.equal(resp.status, 200);

    // check kiwi profile stuck
    resp = await axios.get(`${serverUrl}/o/fish/api/session/access/active`, cookie);
    assert.equal(resp.data.user.email, 'kiwi@getgrist.com');

    // ... and that it didn't affect other org
    resp = await axios.get(`${serverUrl}/o/nasa/api/session/access/active`, cookie);
    assert.equal(resp.data.user.email, 'charon@getgrist.com');

    // pick charon profile for fish org
    resp = await axios.post(`${serverUrl}/o/fish/api/session/access/active`, {
      email: 'charon@getgrist.com'
    }, cookie);
    assert.equal(resp.status, 200);

    // check charon profile stuck
    resp = await axios.get(`${serverUrl}/o/fish/api/session/access/active`, cookie);
    assert.equal(resp.data.user.email, 'charon@getgrist.com');

    // make sure bogus profile for fish org fails
    resp = await axios.post(`${serverUrl}/o/fish/api/session/access/active`, {
      email: 'nonexistent@getgrist.com'
    }, cookie);
    assert.equal(resp.status, 403);
  });

  it('GET /api/session/access/all returns users and orgs', async function() {
    const cookie = await server.getCookieLogin('nasa', {email: 'charon@getgrist.com', name: 'Charon'});
    await server.getCookieLogin('pr', {email: 'kiwi@getgrist.com', name: 'Kiwi'});
    const resp = await axios.get(`${serverUrl}/o/pr/api/session/access/all`, cookie);
    assert.equal(resp.status, 200);
    assert.sameMembers(['users', 'orgs'], Object.keys(resp.data));
    assert.sameMembers(resp.data.users.map((user: UserProfile) => user.name),
      ['Charon', 'Kiwi']);
    // In following list, 'Kiwiland' is the the merged personal org, and Chimpyland is not
    // listed explicitly.
    assert.sameMembers(resp.data.orgs.map((org: any) => org.name),
      ['Abyss', 'Fish', 'Flightless', 'Kiwiland', 'NASA', 'Primately']);
    const fish = resp.data.orgs.find((org: any) => org.name === 'Fish');
    const accessOptions: AccessOptionWithRole[] = fish.accessOptions;
    assert.lengthOf(accessOptions, 2);
    assert.equal('editors', accessOptions.find(opt => opt.name === 'Kiwi')!.access);
    assert.equal('viewers', accessOptions.find(opt => opt.name === 'Charon')!.access);
  });

  it('GET /api/session/access/all functions with anonymous access', async function() {
    const resp = await axios.get(`${serverUrl}/o/pr/api/session/access/all`, nobody);
    assert.equal(resp.status, 200);
    // No orgs listed without access
    assert.lengthOf(resp.data.orgs, 0);
    // A single anonymous user
    assert.lengthOf(resp.data.users, 1);
    assert.equal(resp.data.users[0].anonymous, true);
  });
});
