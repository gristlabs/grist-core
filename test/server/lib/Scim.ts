import axios from 'axios';
import capitalize from 'lodash/capitalize';
import { assert } from 'chai';
import { TestServer } from 'test/gen-server/apiUtils';
import { configForUser } from 'test/gen-server/testUtils';
import * as testUtils from 'test/server/testUtils';

function scimConfigForUser(user: string) {
  const config = configForUser(user);
  return {
    ...config,
    headers: {
      ...config.headers,
      'Content-Type': 'application/scim+json'
    }
  };
}

const chimpy = scimConfigForUser('Chimpy');
const kiwi = scimConfigForUser('Kiwi');
const anon = configForUser('Anonymous');

const USER_CONFIG_BY_NAME = {
  chimpy,
  kiwi,
  anon,
};

type UserConfigByName = typeof USER_CONFIG_BY_NAME;

describe('Scim', () => {
  let oldEnv: testUtils.EnvironmentSnapshot;
  let server: TestServer;
  let homeUrl: string;
  const userIdByName: {[name in keyof UserConfigByName]?: number} = {};

  const scimUrl = (path: string) => (homeUrl + '/api/scim/v2' + path);

  before(async function () {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_DEFAULT_EMAIL = 'chimpy@getgrist.com';
    process.env.TYPEORM_DATABASE = ':memory:';
    server = new TestServer(this);
    homeUrl = await server.start();
    const userNames = Object.keys(USER_CONFIG_BY_NAME) as Array<keyof UserConfigByName>;
    for (const user of userNames) {
      userIdByName[user] = await getUserId(user);
    }
  });

  after(async () => {
    oldEnv.restore();
    await server.stop();
  });

  function personaToSCIMMYUserWithId(user: keyof UserConfigByName) {
    return toSCIMUserWithId(user, userIdByName[user]!);
  }

  function toSCIMUserWithId(user: string, id: number) {
    return {
      ...toSCIMUserWithoutId(user),
      id: String(id),
      meta: { resourceType: 'User', location: '/api/scim/v2/Users/' + id },
    };
  }

  function toSCIMUserWithoutId(user: string) {
    return {
      schemas: [ 'urn:ietf:params:scim:schemas:core:2.0:User' ],
      userName: user + '@getgrist.com',
      name: { formatted: capitalize(user) },
      displayName: capitalize(user),
      preferredLanguage: 'en',
      locale: 'en',
      emails: [ { value: user + '@getgrist.com', primary: true } ]
    };
  }

  async function getUserId(user: string) {
    return (await server.dbManager.getUserByLogin(user + '@getgrist.com'))!.id;
  }

  function checkEndpointNotAccessibleForNonAdminUsers(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string
  ) {
    function makeCallWith(user: keyof UserConfigByName) {
      if (method === 'get' || method === 'delete') {
        return axios[method](scimUrl(path), USER_CONFIG_BY_NAME[user]);
      }
      return axios[method](scimUrl(path), {}, USER_CONFIG_BY_NAME[user]);
    }
    it('should return 401 for anonymous', async function () {
      const res: any = await makeCallWith('anon');
      assert.equal(res.status, 401);
    });

    it('should return 401 for kiwi', async function () {
      const res: any = await makeCallWith('kiwi');
      assert.equal(res.status, 401);
    });
  }

  describe('/Me', function () {
    async function checkGetMeAs(user: keyof UserConfigByName, expected: any) {
      const res = await axios.get(scimUrl('/Me'), USER_CONFIG_BY_NAME[user]);
      assert.equal(res.status, 200);
      assert.deepInclude(res.data, expected);
    }

    it(`should return the current user for chimpy`, async function () {
      return checkGetMeAs('chimpy', personaToSCIMMYUserWithId('chimpy'));
    });

    it(`should return the current user for kiwi`, async function () {
      return checkGetMeAs('kiwi', personaToSCIMMYUserWithId('kiwi'));
    });

    it('should return 401 for anonymous', async function () {
      const res = await axios.get(scimUrl('/Me'), anon);
      assert.equal(res.status, 401);
    });
  });

  describe('/Users/{id}', function () {

    it('should return the user of id=1 for chimpy', async function () {
      const res = await axios.get(scimUrl('/Users/1'), chimpy);

      assert.equal(res.status, 200);
      assert.deepInclude(res.data, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: '1',
        displayName: 'Chimpy',
        userName: 'chimpy@getgrist.com'
      });
    });

    it('should return 404 when the user is not found', async function () {
      const res = await axios.get(scimUrl('/Users/1000'), chimpy);
      assert.equal(res.status, 404);
      assert.deepEqual(res.data, {
        schemas: [ 'urn:ietf:params:scim:api:messages:2.0:Error' ],
        status: '404',
        detail: 'User with ID 1000 not found'
      });
    });

    checkEndpointNotAccessibleForNonAdminUsers('get', '/Users/1');
  });

  describe('GET /Users', function () {
    it('should return all users for chimpy', async function () {
      const res = await axios.get(scimUrl('/Users'), chimpy);
      assert.equal(res.status, 200);
      assert.isAbove(res.data.totalResults, 0, 'should have retrieved some users');
      assert.deepInclude(res.data.Resources, personaToSCIMMYUserWithId('chimpy'));
      assert.deepInclude(res.data.Resources, personaToSCIMMYUserWithId('kiwi'));
    });

    checkEndpointNotAccessibleForNonAdminUsers('get', '/Users');
  });

  describe('POST /Users/.search', function () {
    const SEARCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:SearchRequest';
    it('should return all users for chimpy order by userName in descending order', async function () {
      const res = await axios.post(scimUrl('/Users/.search'), {
        schemas: [SEARCH_SCHEMA],
        sortBy: 'userName',
        sortOrder: 'descending',
      }, chimpy);
      assert.equal(res.status, 200);
      assert.isAbove(res.data.totalResults, 0, 'should have retrieved some users');
      const users = res.data.Resources.map((r: any) => r.userName);
      assert.include(users, 'chimpy@getgrist.com');
      assert.include(users, 'kiwi@getgrist.com');
      const indexOfChimpy = users.indexOf('chimpy@getgrist.com');
      const indexOfKiwi = users.indexOf('kiwi@getgrist.com');
      assert.isBelow(indexOfKiwi, indexOfChimpy, 'kiwi should come before chimpy');
    });

    it('should filter the users by userName', async function () {
      const res = await axios.post(scimUrl('/Users/.search'), {
        schemas: [SEARCH_SCHEMA],
        attributes: ['userName'],
        filter: 'userName sw "chimpy"',
      }, chimpy);
      assert.equal(res.status, 200);
      assert.equal(res.data.totalResults, 1);
      assert.deepEqual(res.data.Resources[0], { id: String(userIdByName['chimpy']), userName: 'chimpy@getgrist.com' },
        "should have retrieved only chimpy's username and not other attribute");
    });

    checkEndpointNotAccessibleForNonAdminUsers('post', '/Users/.search');
  });

  describe('POST /Users', function () { // Create a new users
    it('should create a new user', async function () {
      const res = await axios.post(scimUrl('/Users'), toSCIMUserWithoutId('newuser1'), chimpy);
      assert.equal(res.status, 201);
      const newUserId = await getUserId('newuser1');
      assert.deepEqual(res.data, toSCIMUserWithId('newuser1', newUserId));
    });

    it('should allow creating a new user given only their email passed as username', async function () {
      const res = await axios.post(scimUrl('/Users'), {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'new.user2@getgrist.com',
      }, chimpy);
      assert.equal(res.status, 201);
      assert.equal(res.data.userName, 'new.user2@getgrist.com');
      assert.equal(res.data.displayName, 'new.user2');
    });

    it('should reject when passed email differs from username', async function () {
      const res = await axios.post(scimUrl('/Users'), {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'username@getgrist.com',
        emails: [{ value: 'emails.value@getgrist.com' }],
      }, chimpy);
      assert.equal(res.status, 400);
      assert.deepEqual(res.data, {
        schemas: [ 'urn:ietf:params:scim:api:messages:2.0:Error' ],
        status: '400',
        detail: 'Email and userName must be the same',
        scimType: 'invalidValue'
      });
    });

    it('should disallow creating a user with the same email', async function () {
      const res = await axios.post(scimUrl('/Users'), toSCIMUserWithoutId('chimpy'), chimpy);
      assert.equal(res.status, 409);
      assert.deepEqual(res.data, {
        schemas: [ 'urn:ietf:params:scim:api:messages:2.0:Error' ],
        status: '409',
        detail: 'An existing user with the passed email exist.',
        scimType: 'uniqueness'
      });
    });

    checkEndpointNotAccessibleForNonAdminUsers('post', '/Users');
  });

  describe('PUT /Users/{id}', function () {
    let userToUpdateId: number;
    const userToUpdateEmailLocalPart = 'user-to-update';

    beforeEach(async function () {
      userToUpdateId = await getUserId(userToUpdateEmailLocalPart);
    });
    afterEach(async function () {
      await server.dbManager.deleteUser({ userId: userToUpdateId }, userToUpdateId);
    });

    it('should update an existing user', async function () {
      const userToUpdateProperties = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: userToUpdateEmailLocalPart + '-now-updated@getgrist.com',
        displayName: 'User to Update',
        photos: [{ value: 'https://example.com/photo.jpg', type: 'photo', primary: true }],
        locale: 'fr',
      };
      const res = await axios.put(scimUrl(`/Users/${userToUpdateId}`), userToUpdateProperties, chimpy);
      assert.equal(res.status, 200);
      const refreshedUser = await axios.get(scimUrl(`/Users/${userToUpdateId}`), chimpy);
      assert.deepEqual(refreshedUser.data, {
        ...userToUpdateProperties,
        id: String(userToUpdateId),
        meta: { resourceType: 'User', location: `/api/scim/v2/Users/${userToUpdateId}` },
        emails: [ { value: userToUpdateProperties.userName, primary: true } ],
        name: { formatted: userToUpdateProperties.displayName },
        preferredLanguage: 'fr',
      });
    });

    it('should reject when passed email differs from username', async function () {
      const res = await axios.put(scimUrl(`/Users/${userToUpdateId}`), {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: userToUpdateEmailLocalPart + '@getgrist.com',
        emails: [{ value: 'whatever@getgrist.com', primary: true }],
      }, chimpy);
      assert.equal(res.status, 400);
      assert.deepEqual(res.data, {
        schemas: [ 'urn:ietf:params:scim:api:messages:2.0:Error' ],
        status: '400',
        detail: 'Email and userName must be the same',
        scimType: 'invalidValue'
      });
    });

    it('should disallow updating a user with the same email', async function () {
      const res = await axios.put(scimUrl(`/Users/${userToUpdateId}`), toSCIMUserWithoutId('chimpy'), chimpy);
      assert.equal(res.status, 409);
      assert.deepEqual(res.data, {
        schemas: [ 'urn:ietf:params:scim:api:messages:2.0:Error' ],
        status: '409',
        detail: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: logins.email',
        scimType: 'uniqueness'
      });
    });

    it('should return 404 when the user is not found', async function () {
      const res = await axios.put(scimUrl('/Users/1000'), toSCIMUserWithoutId('chimpy'), chimpy);
      assert.equal(res.status, 404);
      assert.deepEqual(res.data, {
        schemas: [ 'urn:ietf:params:scim:api:messages:2.0:Error' ],
        status: '404',
        detail: 'unable to find user to update'
      });
    });

    it('should deduce the name from the displayEmail when not provided', async function () {
      const res = await axios.put(scimUrl(`/Users/${userToUpdateId}`), {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'my-email@getgrist.com',
      }, chimpy);
      assert.equal(res.status, 200);
      assert.deepInclude(res.data, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: String(userToUpdateId),
        userName: 'my-email@getgrist.com',
        displayName: 'my-email',
      });
    });

    it('should normalize the passed email for the userName and keep the case for email.value', async function () {
      const newEmail = 'my-EMAIL@getgrist.com';
      const res = await axios.put(scimUrl(`/Users/${userToUpdateId}`), {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: newEmail,
      }, chimpy);
      assert.equal(res.status, 200);
      assert.deepInclude(res.data, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: String(userToUpdateId),
        userName: newEmail.toLowerCase(),
        displayName: 'my-EMAIL',
        emails: [{ value: newEmail, primary: true }]
      });
    });

    checkEndpointNotAccessibleForNonAdminUsers('put', '/Users/1');
  });

  describe('PATCH /Users/{id}', function () {
    it('should update the user of id=1', async function () {
      throw new Error("This is a reminder :)");
    });
    checkEndpointNotAccessibleForNonAdminUsers('patch', '/Users/1');
  });

  describe('DELETE /Users/{id}', function () {
    it('should delete the user of id=1', async function () {
      throw new Error("This is a reminder :)");
    });
    checkEndpointNotAccessibleForNonAdminUsers('delete', '/Users/1');
  });

  it('should fix the 401 response for authenticated users', function () {
    throw new Error("This is a reminder :)");
  });
});
