import {PermissionData, PermissionDelta} from 'app/common/UserAPI';
import axios from 'axios';
import {assert} from 'chai';
import {TestServer} from 'test/gen-server/apiUtils';
import {configForUser} from 'test/gen-server/testUtils';
import * as testUtils from 'test/server/testUtils';

describe('emails', function() {

  let server: TestServer;
  let serverUrl: string;
  testUtils.setTmpLogLevel('error');

  const regular = 'chimpy@getgrist.com';
  const variant = 'Chimpy@GETgrist.com';
  const apiKey = configForUser('Chimpy');
  let ref: (email: string) => Promise<string>;

  beforeEach(async function() {
    this.timeout(5000);
    server = new TestServer(this);
    ref = (email: string) => server.dbManager.getUserByLogin(email).then((user) => user.ref);
    serverUrl = await server.start();
  });

  afterEach(async function() {
    await server.stop();
  });

  it('email capitalization from provider is sticky', async function() {
    let cookie = await server.getCookieLogin('nasa', {email: regular, name: 'Chimpy'});
    const userRef = await ref(regular);
    // profile starts off with chimpy@ email
    let resp = await axios.get(`${serverUrl}/o/nasa/api/profile/user`, cookie);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      id: 1, email: regular, name: "Chimpy", ref: userRef, picture: null, allowGoogleLogin: true, disabledAt: null,
    });

    // now we log in with simulated provider giving a Chimpy@ capitalization.
    cookie = await server.getCookieLogin('nasa', {email: variant, name: 'Chimpy'});
    resp = await axios.get(`${serverUrl}/o/nasa/api/profile/user`, cookie);
    assert.equal(resp.status, 200);
    // Chimpy@ is now what we see in our profile, but our id is still the same.
    assert.deepEqual(resp.data, {
      id: 1,
      email: variant,
      loginEmail: regular,
      name: "Chimpy",
      ref: userRef,
      picture: null,
      allowGoogleLogin: true,
      disabledAt: null,
    });

    // read our profile with api key (no session involved) and make sure result is the same.
    resp = await axios.get(`${serverUrl}/api/profile/user`, apiKey);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      id: 1,
      email: variant,
      loginEmail: regular,
      name: "Chimpy",
      ref: userRef,
      picture: null,
      allowGoogleLogin: true,
      disabledAt: null,
    });

  });

  it('access endpoints show and accept display emails', async function() {
    // emails are used in access endpoints - make sure they provide the display email.

    const resources = [
      { type: 'orgs', id: await server.dbManager.testGetId('NASA') },
      { type: 'workspaces', id: await server.dbManager.testGetId('Horizon') },
      { type: 'docs', id: await server.dbManager.testGetId('Jupiter') },
    ] as const;

    for (const res of resources) {
      // initially, should report regular chimpy address
      const resp = await axios.get(`${serverUrl}/api/${res.type}/${res.id}/access`, apiKey);
      assert.equal(resp.status, 200);
      const delta: PermissionData = resp.data;
      assert.notInclude(delta.users.map(u => u.email), variant);
      assert.include(delta.users.map(u => u.email), regular);
    }

    const cookie = await server.getCookieLogin('nasa', {email: variant, name: 'Chimpy'});
    await axios.get(`${serverUrl}/o/nasa/api/orgs`, cookie);

    for (const res of resources) {
      // now, should report variant chimpy address
      let resp = await axios.get(`${serverUrl}/api/${res.type}/${res.id}/access`, apiKey);
      assert.equal(resp.status, 200);
      const delta: PermissionData = resp.data;
      assert.include(delta.users.map(u => u.email), variant);
      assert.notInclude(delta.users.map(u => u.email), regular);

      // and make sure arbitrary capitalization is accepted and effective.
      const delta2: {delta: PermissionDelta} = {
        delta: {
          users: {
            'chImPy@getGRIst.com': 'viewers'
          }
        }
      };
      resp = await axios.patch(`${serverUrl}/api/${res.type}/${res.id}/access`, delta2, apiKey);
      // expect an error complaining about not being able to change own permissions.
      assert.match(resp.data.error, /own permissions/);
    }
  });

  it('PATCH access endpoints behave reasonably when multiple versions of email given', async function() {
    const orgId = await server.dbManager.testGetId('NASA');

    let resp = await axios.get(`${serverUrl}/api/orgs/${orgId}/access`, apiKey);
    assert.deepEqual(resp.data, { users: [
      {
        id: 1,
        name: 'Chimpy',
        email: 'chimpy@getgrist.com',
        ref: await ref('chimpy@getgrist.com'),
        picture: null,
        access: 'owners',
        isMember: true,
        disabledAt: null,
      },
      {
        id: 3,
        name: 'Charon',
        email: 'charon@getgrist.com',
        ref: await ref('charon@getgrist.com'),
        picture: null,
        access: 'guests',
        isMember: false,
        disabledAt: null,
      },
    ]});

    const delta: {delta: PermissionDelta} = {
      delta: {
        users: {
          'kiWI@getGRIst.com': 'viewers',
          'KIwi@getgrist.com': 'editors',
          'charON@getgrist.com': null,
        }
      }
    };
    resp = await axios.patch(`${serverUrl}/api/orgs/${orgId}/access`, delta, apiKey);
    assert.equal(resp.status, 200);

    resp = await axios.get(`${serverUrl}/api/orgs/${orgId}/access`, apiKey);
    assert.deepEqual(resp.data, { users: [
      {
        id: 1,
        name: 'Chimpy',
        email: 'chimpy@getgrist.com',
        ref: await ref('chimpy@getgrist.com'),
        picture: null,
        access: 'owners',
        isMember: true,
        disabledAt: null,
      },
      {
        id: 2,
        name: 'Kiwi',
        email: 'kiwi@getgrist.com',
        ref: await ref('kiwi@getgrist.com'),
        picture: null,
        access: 'editors',
        isMember: true,
        disabledAt: null,
      },
    ]});
  });
});
