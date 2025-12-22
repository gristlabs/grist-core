import axios, { AxiosResponse } from 'axios';
import capitalize from 'lodash/capitalize';
import { assert } from 'chai';
import Sinon from 'sinon';
import log from 'app/server/lib/log';

import { TestServer } from 'test/gen-server/apiUtils';
import { configForUser } from 'test/gen-server/testUtils';
import * as testUtils from 'test/server/testUtils';
import { Group } from 'app/gen-server/entity/Group';
import { isAffirmative } from 'app/common/gutil';
import { UserType } from 'app/common/User';

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
const charon = scimConfigForUser('Charon');
const anon = scimConfigForUser('Anonymous');

const USER_CONFIG_BY_NAME = {
  chimpy,
  kiwi,
  anon,
};

type UserConfigByName = typeof USER_CONFIG_BY_NAME;

describe('Scim', () => {
  testUtils.setTmpLogLevel('alert');

  const setupTestServer = (env: NodeJS.ProcessEnv) => {
    let homeUrl: string;
    let oldEnv: testUtils.EnvironmentSnapshot;
    let server: TestServer;

    before(async function () {
      oldEnv = new testUtils.EnvironmentSnapshot();
      Object.assign(process.env, env);
      server = new TestServer(this);
      homeUrl = await server.start();
    });

    after(async () => {
      oldEnv.restore();
      await server.stop();
    });

    return {
      scimUrl: (path: string) => (homeUrl + '/api/scim/v2' + path),
      getDbManager: () => server.dbManager,
      getServer: () => server,
    };
  };

  describe('when disabled', function () {
    const { scimUrl } = setupTestServer({});

    it('should return 501 for /api/scim/v2/Users', async function () {
      const res = await axios.get(scimUrl('/Users'), chimpy);
      assert.equal(res.status, 501);
      assert.deepEqual(res.data, { error: 'SCIM API is not enabled' });
    });
  });

  describe('when enabled using GRIST_ENABLE_SCIM=1', function () {
    const { scimUrl, getDbManager, getServer } = setupTestServer({
      GRIST_ENABLE_SCIM: '1',
      GRIST_DEFAULT_EMAIL: 'chimpy@getgrist.com',
      GRIST_SCIM_EMAIL: 'charon@getgrist.com',
    });
    const userIdByName: {[name in keyof UserConfigByName]?: number} = {};
    let logWarnStub: Sinon.SinonStub;
    let logErrorStub: Sinon.SinonStub;

    before(async function () {
      const userNames = Object.keys(USER_CONFIG_BY_NAME) as Array<keyof UserConfigByName>;
      for (const user of userNames) {
        userIdByName[user] = await getOrCreateUserId(user);
      }
    });

    beforeEach(() => {
      logWarnStub = Sinon.stub(log, 'warn');
      logErrorStub = Sinon.stub(log, 'error');
    });

    afterEach(() => {
      logWarnStub.restore();
      logErrorStub.restore();
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
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: user + '@getgrist.com',
        name: { formatted: capitalize(user) },
        displayName: capitalize(user),
        preferredLanguage: 'en',
        locale: 'en',
        emails: [{ value: user + '@getgrist.com', primary: true }]
      };
    }

    async function getOrCreateUserId(user: string, {type}: {type?: UserType} = {}) {
      const domain = type === "service" ? "serviceaccounts.invalid" : "getgrist.com";
      return (await getDbManager().getUserByLogin(`${user}@${domain}`, {}, type)).id;
    }

    async function cleanupUser(userId: number) {
      if (await getDbManager().getUser(userId)) {
        await getDbManager().deleteUser({ userId: userId }, userId);
      }
    }

    async function checkOperationOnTechUserDisallowed({op, opType}: {
      op: (id: number) => Promise<AxiosResponse>,
      opType: string
    }) {
      const db = getDbManager();
      const specialUsers = {
        'anonymous': db.getAnonymousUserId(),
        'support': db.getSupportUserId(),
        'everyone': db.getEveryoneUserId(),
        'preview': db.getPreviewerUserId(),
      };
      for (const [label, id] of Object.entries(specialUsers)) {
        const res = await op(id);
        assert.equal(res.status, 403, `should forbid ${opType} of the special user ${label}`);
        assert.deepEqual(res.data, {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '403',
          detail: `System user ${opType} not permitted.`
        });
      }
    }

    async function withUserName(userName: string, cb: (userName: string) => Promise<void>) {
      try {
        await cb(userName);
      } finally {
        const user = await getDbManager().getExistingUserByLogin(userName + "@getgrist.com");
        if (user && !isAffirmative(process.env.NO_CLEANUP)) {
          await cleanupUser(user.id);
        }
      }
    }

    function checkCommonErrors(
      method: 'get' | 'post' | 'put' | 'patch' | 'delete',
      path: string,
      validBody: object = {}
    ) {
      function makeCallWith(user: keyof UserConfigByName) {
        if (method === 'get' || method === 'delete') {
          return axios[method](scimUrl(path), USER_CONFIG_BY_NAME[user]);
        }
        return axios[method](scimUrl(path), validBody, USER_CONFIG_BY_NAME[user]);
      }

      it('should return 401 for anonymous', async function () {
        const res = await makeCallWith('anon');
        assert.equal(res.status, 401);
      });

      it('should return 403 for kiwi', async function () {
        const res = await makeCallWith('kiwi');
        assert.deepEqual(res.data, {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '403',
          detail: 'You are not authorized to access this resource'
        });
        assert.equal(res.status, 403);
      });

      it('should return a 500 in case of unknown Error', async function () {
        const sandbox = Sinon.createSandbox();
        try {
          const error = new Error('Some unexpected Error');

          // Stub all the dbManager methods called by the controller
          sandbox.stub(getDbManager(), 'getUsers').throws(error);
          sandbox.stub(getDbManager(), 'getUser').throws(error);
          sandbox.stub(getDbManager(), 'getUserByLoginWithRetry').throws(error);
          sandbox.stub(getDbManager(), 'overwriteUser').throws(error);
          sandbox.stub(getDbManager(), 'deleteUser').throws(error);
          sandbox.stub(getDbManager(), 'getGroupWithMembersById').throws(error);
          sandbox.stub(getDbManager(), 'getGroupsWithMembersByType').throws(error);
          sandbox.stub(getDbManager(), 'getGroupsWithMembers').throws(error);
          sandbox.stub(getDbManager(), 'createGroup').throws(error);
          sandbox.stub(getDbManager(), 'overwriteTeamGroup').throws(error);
          sandbox.stub(getDbManager(), 'overwriteRoleGroup').throws(error);
          sandbox.stub(getDbManager(), 'deleteGroup').throws(error);

          const res = await makeCallWith('chimpy');
          assert.deepEqual(res.data, {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '500',
            detail: error.message
          });
          assert.equal(res.status, 500);
        } finally {
          sandbox.restore();
        }
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

    describe('/Users', function () {
      describe('GET /Users/{id}', function () {

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
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '404',
            detail: 'User with ID 1000 not found'
          });
        });

        it('should return 404 when the user is not of type login', async function () {
          const serviceUserId = await getOrCreateUserId('alfred', {type: 'service'});
          const res = await axios.get(scimUrl(`/Users/${serviceUserId}`), chimpy);
          assert.deepEqual(res.data, {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '404',
            detail: `User with ID ${serviceUserId} not found`
          });
          assert.equal(res.status, 404);
        });

        checkCommonErrors('get', '/Users/1');
      });

      describe('GET /Users', function () {
        it('should return all users for chimpy', async function () {
          const res = await axios.get(scimUrl('/Users'), chimpy);
          assert.equal(res.status, 200);
          assert.isAbove(res.data.totalResults, 0, 'should have retrieved some users');
          assert.deepInclude(res.data.Resources, personaToSCIMMYUserWithId('chimpy'));
          assert.deepInclude(res.data.Resources, personaToSCIMMYUserWithId('kiwi'));
        });

        it('should handle pagination', async function () {
          const endpointPaginated = '/Users?count=1&sortBy=id';
          {
            const firstPage = await axios.get(scimUrl(endpointPaginated), chimpy);
            assert.equal(firstPage.status, 200);
            assert.lengthOf(firstPage.data.Resources, 1);
            const firstPageResourceId = parseInt(firstPage.data.Resources[0].id);
            assert.equal(firstPageResourceId, 1);
          }

          {
            const secondPage = await axios.get(scimUrl(endpointPaginated + '&startIndex=2'), chimpy);
            assert.equal(secondPage.status, 200);
            assert.lengthOf(secondPage.data.Resources, 1);
            const secondPageResourceId = parseInt(secondPage.data.Resources[0].id);
            assert.equal(secondPageResourceId, 2);
          }
        });

        it('should skip users of type other than "login"', async function () {
          const serviceUserId = await getOrCreateUserId('alfred', {type: 'service'});
          const res = await axios.get(scimUrl('/Users'), chimpy);
          assert.isEmpty(res.data.Resources.filter((user: any) => user.id === serviceUserId));
        });

        checkCommonErrors('get', '/Users');
      });

      describe('POST /Users/.search', function () {
        const SEARCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:SearchRequest';

        const searchExample = {
          schemas: [SEARCH_SCHEMA],
          sortBy: 'userName',
          sortOrder: 'descending',
        };

        it('should return all users for chimpy order by userName in descending order', async function () {
          const res = await axios.post(scimUrl('/Users/.search'), searchExample, chimpy);
          assert.equal(res.status, 200);
          assert.isAbove(res.data.totalResults, 0, 'should have retrieved some users');
          const users = res.data.Resources.map((r: any) => r.userName);
          assert.include(users, 'chimpy@getgrist.com');
          assert.include(users, 'kiwi@getgrist.com');
          const indexOfChimpy = users.indexOf('chimpy@getgrist.com');
          const indexOfKiwi = users.indexOf('kiwi@getgrist.com');
          assert.isBelow(indexOfKiwi, indexOfChimpy, 'kiwi should come before chimpy');
        });

        it('should also allow access for user Charon (the one refered in GRIST_SCIM_EMAIL)', async function () {
          const res = await axios.post(scimUrl('/Users/.search'), searchExample, charon);
          assert.equal(res.status, 200);
        });

        it('should filter the users by userName', async function () {
          const res = await axios.post(scimUrl('/Users/.search'), {
            schemas: [SEARCH_SCHEMA],
            attributes: ['userName'],
            filter: 'userName sw "chimpy"',
          }, chimpy);
          assert.equal(res.status, 200);
          assert.equal(res.data.totalResults, 1);
          assert.deepEqual(res.data.Resources[0], {
            id: String(userIdByName['chimpy']),
            userName: 'chimpy@getgrist.com'
          },
            "should have retrieved only chimpy's username and not other attribute");
        });

        checkCommonErrors('post', '/Users/.search', searchExample);
      });

      describe('POST /Users', function () { // Create a new users
        it('should create a new user', async function () {
          await withUserName('newuser1', async (userName) => {
            const res = await axios.post(scimUrl('/Users'), toSCIMUserWithoutId(userName), chimpy);
            assert.equal(res.status, 201);
            const newUserId = await getOrCreateUserId(userName);
            assert.deepEqual(res.data, toSCIMUserWithId(userName, newUserId));
            const newUser = await getDbManager().getUser(newUserId);
            assert.equal(newUser!.type, 'login');
          });
        });

        it('should allow creating a new user given only their email passed as username', async function () {
          await withUserName('new.user2', async (userName) => {
            const res = await axios.post(scimUrl('/Users'), {
              schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
              userName: 'new.user2@getgrist.com',
            }, chimpy);
            assert.equal(res.status, 201);
            assert.equal(res.data.userName, userName + '@getgrist.com');
            assert.equal(res.data.displayName, userName);
          });
        });

        it('should also allow user Charon to create a user (the one refered in GRIST_SCIM_EMAIL)', async function () {
          await withUserName('new.user.by.charon', async (userName) => {
            const res = await axios.post(scimUrl('/Users'), toSCIMUserWithoutId(userName), charon);
            assert.equal(res.status, 201);
          });
        });

        it('should warn when passed email differs from username, and ignore the username', async function () {
          await withUserName('emails.value', async (userName) => {
            const res = await axios.post(scimUrl('/Users'), {
              schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
              userName: userName,
              emails: [{ value: userName + '@getgrist.com' }],
            }, chimpy);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
              id: res.data.id,
              meta: { resourceType: 'User', location: `/api/scim/v2/Users/${res.data.id}` },
              userName: 'emails.value@getgrist.com',
              name: { formatted: 'emails.value' },
              displayName: 'emails.value',
              preferredLanguage: 'en',
              locale: 'en',
              emails: [
                { value: 'emails.value@getgrist.com', primary: true }
              ]
            });
            assert.equal(res.status, 201);
            assert.equal(logWarnStub.callCount, 1, "A warning should have been raised");
            assert.match(
              logWarnStub.getCalls()[0].args[0],
              new RegExp(`userName "${userName}" differ from passed primary email`)
            );
          });
        });

        it('should disallow creating a user with the same email', async function () {
          const res = await axios.post(scimUrl('/Users'), toSCIMUserWithoutId('chimpy'), chimpy);
          assert.deepEqual(res.data, {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '409',
            detail: 'An existing user with the passed email exist.',
            scimType: 'uniqueness'
          });
          assert.equal(res.status, 409);
        });

        checkCommonErrors('post', '/Users', toSCIMUserWithoutId('some-user'));
      });

      describe('PUT /Users/{id}', function () {
        let userToUpdateId: number;
        const userToUpdateEmailLocalPart = 'user-to-update';

        beforeEach(async function () {
          userToUpdateId = await getOrCreateUserId(userToUpdateEmailLocalPart);
        });
        afterEach(async function () {
          await cleanupUser(userToUpdateId);
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
            emails: [{ value: userToUpdateProperties.userName, primary: true }],
            name: { formatted: userToUpdateProperties.displayName },
            preferredLanguage: 'fr',
          });
        });

        it('should warn when passed email differs from username', async function () {
          const res = await axios.put(scimUrl(`/Users/${userToUpdateId}`), {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
            userName: 'whatever@getgrist.com',
            emails: [{ value: userToUpdateEmailLocalPart + '@getgrist.com', primary: true }],
          }, chimpy);
          assert.equal(res.status, 200);
          assert.equal(logWarnStub.callCount, 1, "A warning should have been raised");
          assert.match(logWarnStub.getCalls()[0].args[0], /differ from passed primary email/);
        });

        it('should disallow updating a user with the same email as another user\'s', async function () {
          const res = await axios.put(scimUrl(`/Users/${userToUpdateId}`), toSCIMUserWithoutId('chimpy'), chimpy);
          assert.deepEqual(res.data, {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '409',
            detail: 'An existing user with the passed email exist.',
            scimType: 'uniqueness'
          });
          assert.equal(res.status, 409);
        });

        it('should return 404 when the user is not found', async function () {
          const res = await axios.put(scimUrl('/Users/1000'), toSCIMUserWithoutId('whoever'), chimpy);
          assert.deepEqual(res.data, {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '404',
            detail: 'unable to find user to update'
          });
          assert.equal(res.status, 404);
        });

        it('should return 404 when the user is not of type login', async function () {
          const serviceUserId = await getOrCreateUserId('alfred', {type: 'service'});
          const res = await axios.put(scimUrl(`/Users/${serviceUserId}`), toSCIMUserWithoutId('chimpy'), chimpy);
          assert.deepEqual(res.data, {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '404',
            detail: 'unable to find user to update'
          });
          assert.equal(res.status, 404);
        });

        it('should return 403 for system users', async function () {
          const data = toSCIMUserWithoutId('whoever');
          await checkOperationOnTechUserDisallowed({
            op: id => axios.put(scimUrl(`/Users/${id}`), data, chimpy),
            opType: 'modification'
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

        it('should return 400 when the user id is malformed', async function () {
          const res = await axios.put(scimUrl('/Users/not-an-id'), toSCIMUserWithoutId('whoever'), chimpy);
          assert.deepEqual(res.data, {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '400',
            detail: 'Invalid passed user ID',
            scimType: 'invalidValue'
          });
          assert.equal(res.status, 400);
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

        checkCommonErrors('put', '/Users/1', toSCIMUserWithoutId('chimpy'));
      });

      describe('PATCH /Users/{id}', function () {
        let userToPatchId: number;
        const userToPatchEmailLocalPart = 'user-to-patch';
        beforeEach(async function () {
          userToPatchId = await getOrCreateUserId(userToPatchEmailLocalPart);
        });
        afterEach(async function () {
          await cleanupUser(userToPatchId);
        });

        const validPatchBody = (newName: string) => ({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{
            op: "replace",
            path: "displayName",
            value: newName,
          }, {
              op: "replace",
              path: "locale",
              value: 'fr'
            }],
        });

        it('should replace values of an existing user', async function () {
          const newName = 'User to Patch new Name';
          const res = await axios.patch(scimUrl(`/Users/${userToPatchId}`), validPatchBody(newName), chimpy);
          assert.equal(res.status, 200);
          const refreshedUser = await axios.get(scimUrl(`/Users/${userToPatchId}`), chimpy);
          assert.deepEqual(refreshedUser.data, {
            ...toSCIMUserWithId(userToPatchEmailLocalPart, userToPatchId),
            displayName: newName,
            name: { formatted: newName },
            locale: 'fr',
            preferredLanguage: 'fr',
          });
        });

        it('should return 404 when the user is not of type login', async function () {
          const serviceUserId = await getOrCreateUserId('alfred', {type: 'service'});
          const res = await axios.patch(scimUrl(`/Users/${serviceUserId}`), validPatchBody('whatever'), chimpy);
          assert.deepEqual(res.data, {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '404',
            detail: `User with ID ${serviceUserId} not found`
          });
          assert.equal(res.status, 404);
        });
          checkCommonErrors('patch', '/Users/1', validPatchBody('new name2'));
        });

      describe('DELETE /Users/{id}', function () {
        let userToDeleteId: number;
        const userToDeleteEmailLocalPart = 'user-to-delete';

        beforeEach(async function () {
          userToDeleteId = await getOrCreateUserId(userToDeleteEmailLocalPart);
        });
        afterEach(async function () {
          await cleanupUser(userToDeleteId);
        });

        it('should delete a user', async function () {
          const res = await axios.delete(scimUrl(`/Users/${userToDeleteId}`), chimpy);
          assert.equal(res.status, 204);
          const refreshedUser = await axios.get(scimUrl(`/Users/${userToDeleteId}`), chimpy);
          assert.equal(refreshedUser.status, 404);
        });

        it('should return 404 when the user is not found', async function () {
          const res = await axios.delete(scimUrl('/Users/1000'), chimpy);
          assert.deepEqual(res.data, {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '404',
            detail: 'user not found'
          });
          assert.equal(res.status, 404);
        });

        it('should return 404 when the user is not of type login', async function () {
          const serviceUserId = await getOrCreateUserId('alfred', {type: 'service'});
          const res = await axios.delete(scimUrl(`/Users/${serviceUserId}`), chimpy);
          assert.deepEqual(res.data, {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '404',
            detail: 'user not found'
          });
          assert.equal(res.status, 404);
        });

        it('should return 403 for system users', async function () {
          await checkOperationOnTechUserDisallowed({
            op: id => axios.delete(scimUrl(`/Users/${id}`), chimpy),
            opType: 'deletion'
          });
        });

        checkCommonErrors('delete', '/Users/1');
      });
    });

    describe('Groups and Roles', function () {
      async function cleanupGroups() {
        const groupsToDelete = await getDbManager().connection.createQueryBuilder()
          .select('groups')
          .from(Group, "groups")
          .where("groups.name like 'test-%'")
          .getMany();
        for (const {id} of groupsToDelete) {
          await getDbManager().deleteGroup(id);
        }
      }

      async function withGroupNames<T>(groupNames: string[], cb: (groupNames: string[]) => Promise<T>) {
        try {
          await cb(groupNames);
        } finally {
          if (!isAffirmative(process.env.NO_CLEANUP)) {
            await cleanupGroups();
          }
        }
      }

      async function withGroupName<T>(groupName: string, cb: (groupName: string) => Promise<T>) {
        return await withGroupNames([groupName], groupNames => cb(groupNames[0]));
      }

      function getUserMember(user: keyof UserConfigByName) {
        return { value: String(userIdByName[user]), display: capitalize(user), type: 'User' };
      }

      function getUserMemberWithRef(user: keyof UserConfigByName) {
        return { ...getUserMember(user), $ref: `/api/scim/v2/Users/${userIdByName[user]}` };
      }

      function withGroup<T>(cb: (groupId: string, group: Group) => Promise<T>) {
        return withGroupName('test-group', async (groupName) => {
          const group = await getDbManager().createGroup({
            name: groupName,
            type: Group.TEAM_TYPE,
            memberUsers: [userIdByName['chimpy']!]
          });
          return await cb(String(group.id), group);
        });
      }

      function withRole<T>(cb: (groupId: string, role: Group) => Promise<T>) {
        return withGroupName('test-role', async (groupName) => {
          const role = await getDbManager().createGroup({
            name: groupName,
            type: Group.ROLE_TYPE,
            memberUsers: [userIdByName['chimpy']!]
          });
          return await cb(String(role.id), role);
        });
      }

      describe('Groups', function () {
        describe('GET /Groups/{id}', function () {
          it(`should return a "${Group.TEAM_TYPE}" group for chimpy`, async function () {
            await withGroup(async (groupId, group) => {
              const res = await axios.get(scimUrl('/Groups/' + groupId), chimpy);

              assert.equal(res.status, 200);
              assert.deepEqual(res.data, {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                id: groupId,
                displayName: group.name,
                members: [
                  { value: '1', display: 'Chimpy', $ref: '/api/scim/v2/Users/1', type: 'User' }
                ],
                meta: { resourceType: 'Group', location: `/api/scim/v2/Groups/${groupId}` }
              });
            });
          });

          it('should return 404 when the group is not found', async function () {
            const nonExistingId = 10000000;
            const res = await axios.get(scimUrl(`/Groups/${nonExistingId}`), chimpy);
            assert.equal(res.status, 404);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '404',
              detail: `Group with ID ${nonExistingId} not found`
            });
          });

          it(`should return 404 when the group is of type ${Group.ROLE_TYPE}`, async function () {
            await withRole(async (groupId, groupName) => {
              const res = await axios.get(scimUrl('/Groups/' + groupId), chimpy);
              assert.equal(res.status, 404);
              assert.deepEqual(res.data, {
                schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
                status: '404',
                detail: `Group with ID ${groupId} not found`
              });
            });
          });

          it('should return 400 when the group id is malformed', async function () {
            const res = await axios.get(scimUrl('/Groups/not-an-id'), chimpy);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '400',
              detail: 'Invalid passed group ID',
              scimType: 'invalidValue'
            });
            assert.equal(res.status, 400);
          });

          checkCommonErrors('get', '/Groups/1');
        });

        describe('GET /Groups', function () {
          it(`should return all ${Group.TEAM_TYPE} groups for chimpy`, async function () {
            return withGroupNames(
              ['test-group1', 'test-group2', 'test-role-group'],
              async ([group1Name, group2Name, roleGroupName]) => {
                await getDbManager().createGroup({
                  name: roleGroupName,
                  type: Group.ROLE_TYPE,
                  memberUsers: [userIdByName['chimpy']!]
                });
                const group1 = await getDbManager().createGroup({
                  name: group1Name,
                  type: Group.TEAM_TYPE,
                  memberUsers: [userIdByName['chimpy']!]
                });
                const group2 = await getDbManager().createGroup({
                  name: group2Name,
                  type: Group.TEAM_TYPE,
                  memberUsers: [userIdByName['kiwi']!]
                });

                const res = await axios.get(scimUrl('/Groups'), chimpy);
                assert.equal(res.status, 200);
                assert.isAbove(res.data.totalResults, 0, 'should have retrieved some groups');
                assert.isFalse(res.data.Resources.some(
                  ({displayName}: {displayName: string}) => displayName === roleGroupName
                ), 'The API endpoint should not return role Groups');
                assert.deepEqual(res.data.Resources, [
                  {
                    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                    id: String(group1.id),
                    displayName: group1Name,
                    members: [getUserMemberWithRef('chimpy')],
                    meta: { resourceType: 'Group', location: `/api/scim/v2/Groups/${group1.id}` }
                  }, {
                    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                    id: String(group2.id),
                    displayName: group2Name,
                    members: [getUserMemberWithRef('kiwi')],
                    meta: { resourceType: 'Group', location: `/api/scim/v2/Groups/${group2.id}` }
                  }
                ]);
              }
            );
          });

          checkCommonErrors('get', '/Groups');
        });

        describe('POST /Groups', function () {
          it(`should create a new group of type "${Group.TEAM_TYPE}"`, async function () {
            await withGroupName('test-group', async (groupName) => {
              const res = await axios.post(scimUrl('/Groups'), {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                displayName: groupName,
                members: [
                  getUserMember('chimpy'),
                  getUserMember('kiwi'),
                ]
              }, chimpy);
              assert.equal(res.status, 201);
              const newGroupId = parseInt(res.data.id);
              assert.deepEqual(res.data, {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                id: String(newGroupId),
                displayName: groupName,
                members: [
                  getUserMemberWithRef('chimpy'),
                  getUserMemberWithRef('kiwi'),
                ],
                meta: { resourceType: 'Group', location: `/api/scim/v2/Groups/${newGroupId}` }
              });
            });
          });

          it('should allow to create a group without members', function () {
            return withGroupName('test-group-without-members', async (groupName) => {
              const res = await axios.post(scimUrl('/Groups'), {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                displayName: groupName,
              }, chimpy);
              assert.equal(res.status, 201);
              assert.deepEqual(res.data, {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                id: res.data.id,
                displayName: groupName,
                members: [],
                meta: { resourceType: 'Group', location: `/api/scim/v2/Groups/${res.data.id}` }
              });
            });
          });

          it('should return 400 when the group name is missing', async function () {
            const res = await axios.post(scimUrl('/Groups'), {
              schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
              members: [
                { value: String(userIdByName['chimpy']), display: 'Chimpy', type: 'User' },
              ]
            }, chimpy);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '400',
              detail: "Required attribute 'displayName' is missing",
              scimType: 'invalidValue'
            });
            assert.equal(res.status, 400);
          });

          it('should return 409 when the group name is coliding with an existing group', async function () {
            await withGroupName('test-group', async (groupName) => {
              const existingGroupCreationRes = await axios.post(scimUrl('/Groups'), {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                displayName: groupName,
              }, chimpy);
              assert.equal(existingGroupCreationRes.status, 201);
              const res = await axios.post(scimUrl('/Groups'), {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                displayName: groupName,
              }, chimpy);
              assert.equal(res.status, 409);
              assert.deepEqual(res.data, {
                schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
                status: '409',
                detail: `Group with name "${groupName}" already exists`,
                scimType: 'uniqueness'
              });
            });
          });

          it('should return 400 when the group members contain an invalid user id', async function () {
            const res = await axios.post(scimUrl('/Groups'), {
              schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
              displayName: 'test-group',
              members: [
                { value: 'not-an-id', display: 'Non-Existing User', type: 'User' },
              ]
            }, chimpy);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '400',
              detail: 'Invalid User member ID: not-an-id',
              scimType: 'invalidValue'
            });
            assert.equal(res.status, 400);
          });

          it('should return 400 when the group members contain an invalid group id', async function () {
            const res = await axios.post(scimUrl('/Groups'), {
              schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
              displayName: 'test-group',
              members: [
                { value: 'not-an-id', display: 'Non-Existing Group', type: 'Group' },
              ]
            }, chimpy);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '400',
              detail: 'Invalid Group member ID: not-an-id',
              scimType: 'invalidValue'
            });
            assert.equal(res.status, 400);
          });

          it('should return 404 when the group members contain a non-existing user id', async function () {
            const res = await axios.post(scimUrl('/Groups'), {
              schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
              displayName: 'test-group',
              members: [
                getUserMember('chimpy'),
                { value: '1000', display: 'Non-Existing User', type: 'User' },
              ]
            }, chimpy);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '404',
              detail: 'Users not found: 1000'
            });
            assert.equal(res.status, 404);
          });

          it('should return 404 when the group members contain a non-existing group id', async function () {
            const res = await axios.post(scimUrl('/Groups'), {
              schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
              displayName: 'test-group',
              members: [
                { value: '1000', display: 'Non-Existing Group', type: 'Group' },
              ]
            }, chimpy);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '404',
              detail: 'Groups not found: 1000'
            });
            assert.equal(res.status, 404);
          });

          it('should return 400 when the group members contain other groups', async function () {
            await withRole(async (groupId) => {
              const res = await axios.post(scimUrl('/Groups'), {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                displayName: 'test-group',
                members: [
                  { value: '1', type: 'User' },
                  { value: '2', type: 'User' },
                  { value: groupId, type: 'Group' },
                ]
              }, chimpy);
              assert.deepEqual(res.data, {
                schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
                status: '400',
                detail: `Groups of type "${Group.TEAM_TYPE}" cannot contain groups.`
              });
              assert.equal(res.status, 400);
            });
          });

          checkCommonErrors('post', '/Groups', {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
            displayName: 'test-group',
            // We need to differ the moment we call userIdByName['chimpy'] (set during a "before()" hook)
            get members() {
              return [
                getUserMember('chimpy'),
                getUserMember('kiwi'),
              ];
            }
          });
        });

        describe('PUT /Groups/{id}', function () {
          it('should update an existing group', async function () {
            return withGroup(async (groupId) => {
              const newGroupName = 'test-new-group-name';
              const res = await axios.put(scimUrl('/Groups/' + groupId), {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                displayName: newGroupName,
                members: [
                  getUserMember('kiwi'),
                ]
              }, chimpy);
              assert.equal(res.status, 200);
              assert.deepEqual(res.data, {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                id: groupId,
                displayName: newGroupName,
                members: [
                  getUserMemberWithRef('kiwi'),
                ],
                meta: { resourceType: 'Group', location: '/api/scim/v2/Groups/' + groupId }
              });
            });
          });

          it('should update a group with members omitted', async function () {
            return withGroup(async (groupId) => {
              const newGroupName = 'test-new-group-name';
              const res = await axios.put(scimUrl('/Groups/' + groupId), {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                displayName: newGroupName,
              }, chimpy);
              assert.equal(res.status, 200);
              assert.deepEqual(res.data, {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                id: groupId,
                displayName: newGroupName,
                members: [],
                meta: { resourceType: 'Group', location: '/api/scim/v2/Groups/' + groupId }
              });
            });
          });

          it('should refuse to alter a role', async function () {
            return withRole(async (groupId) => {
              const res = await axios.put(scimUrl('/Groups/' + groupId), {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                displayName: 'whatever',
              }, chimpy);
              assert.equal(res.status, 404);
            });
          });

          it('should return 404 when the group is not found', async function () {
            const res = await axios.put(scimUrl('/Groups/1000'), {
              schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
              displayName: 'New Group Name',
              members: [
                getUserMember('kiwi'),
              ]
            }, chimpy);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '404',
              detail: 'Group with id 1000 not found'
            });
            assert.equal(res.status, 404);
          });

          it('should return 400 when the group id is malformed', async function () {
            const res = await axios.put(scimUrl('/Groups/not-an-id'), {
              schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
              displayName: 'New Group Name',
              members: [
                getUserMember('kiwi'),
              ]
            }, chimpy);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '400',
              detail: 'Invalid passed group ID',
              scimType: 'invalidValue'
            });
            assert.equal(res.status, 400);
          });

          checkCommonErrors('put', '/Groups/1', {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
            displayName: 'New Group Name',
            // We need to differ the moment we call userIdByName['kiwi'] (set during a "before()" hook)
            get members() {
              return [getUserMember('kiwi')];
            }
          });
        });

        describe('PATCH /Groups/{id}', function () {
          it('should update an existing group name', async function () {
            return withGroup(async (groupId) => {
              const newGroupName = 'test-new-group-name';
              const res = await axios.patch(scimUrl('/Groups/' + groupId), {
                schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
                Operations: [{
                  op: 'replace', path: 'displayName', value: newGroupName
                }]
              }, chimpy);
              assert.equal(res.status, 200);
              assert.deepEqual(res.data, {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                id: groupId,
                displayName: newGroupName,
                members: [
                  getUserMemberWithRef('chimpy'),
                ],
                meta: { resourceType: 'Group', location: '/api/scim/v2/Groups/' + groupId }
              });
            });
          });

          it('should add a member to a group', async function () {
            return withGroup(async (groupId) => {
              const res = await axios.patch(scimUrl('/Groups/' + groupId), {
                schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
                Operations: [{
                  op: 'add', path: 'members', value: [getUserMember('kiwi')]
                }]
              }, chimpy);
              assert.equal(res.status, 200);
              assert.deepEqual(res.data.members, [
                getUserMemberWithRef('chimpy'),
                getUserMemberWithRef('kiwi'),
              ]);
            });
          });

          it('should refuse to alter a role', async function () {
            return withRole(async (groupId) => {
              const res = await axios.patch(scimUrl('/Groups/' + groupId), {
                schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
                Operations: [{
                  op: 'add', path: 'members', value: [getUserMember('kiwi')]
                }]
              }, chimpy);
              assert.equal(res.status, 404);
            });
          });

          checkCommonErrors('patch', '/Groups/1', {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{
              op: 'replace', path: 'displayName', value: 'Updated Group Name'
            }]
          });
        });

        describe('DELETE /Groups/{id}', function () {
          it('should delete a group', async function () {
            return withGroup(async (groupId) => {
              const res = await axios.delete(scimUrl('/Groups/' + groupId), chimpy);
              assert.equal(res.status, 204);
              const refreshedGroup = await axios.get(scimUrl('/Groups/' + groupId), chimpy);
              assert.equal(refreshedGroup.status, 404);
            });
          });

          it('should refuse to delete a role', async function () {
            return withRole(async (groupId) => {
              const res = await axios.delete(scimUrl('/Groups/' + groupId), chimpy);
              assert.equal(res.status, 404);
            });
          });

          it('should return 404 when the group is not found', async function () {
            const res = await axios.delete(scimUrl('/Groups/1000'), chimpy);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '404',
              detail: 'Group with id 1000 not found'
            });
            assert.equal(res.status, 404);
          });

          it('should return 400 when the group id is malformed', async function () {
            const res = await axios.delete(scimUrl('/Groups/not-an-id'), chimpy);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '400',
              detail: 'Invalid passed group ID',
              scimType: 'invalidValue'
            });
            assert.equal(res.status, 400);
          });

          checkCommonErrors('delete', '/Groups/1');
        });
      });

      describe('Roles', function () {
        describe('GET /Roles/{id}', function () {
          it(`should return a "${Group.ROLE_TYPE}" group for chimpy`, async function () {
            await withRole(async (roleId: string, role: Group) => {
              const res = await axios.get(scimUrl('/Roles/' + roleId), chimpy);

              assert.equal(res.status, 200);
              assert.deepEqual(res.data, {
                schemas: ['urn:ietf:params:scim:schemas:Grist:1.0:Role'],
                id: String(roleId),
                displayName: role.name,
                members: [
                  { value: '1', display: 'Chimpy', $ref: '/api/scim/v2/Users/1', type: 'User' },
                ],
                meta: { resourceType: 'Role', location: `/api/scim/v2/Roles/${roleId}` }
              });
            });
          });

          it('should return 404 when the role is not found', async function () {
            const nonExistingId = 10000000;
            const res = await axios.get(scimUrl(`/Roles/${nonExistingId}`), chimpy);
            assert.equal(res.status, 404);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '404',
              detail: `Role with ID ${nonExistingId} not found`
            });
          });

          it(`should return 404 when the role is of type ${Group.TEAM_TYPE}`, async function () {
            await withGroupName('test-group', async (groupName) => {
              const {id: roleId} = await getDbManager().createGroup({
                name: groupName,
                type: Group.TEAM_TYPE,
                memberUsers: [userIdByName['chimpy']!]
              });

              const res = await axios.get(scimUrl('/Roles/' + roleId), chimpy);
              assert.equal(res.status, 404);
              assert.deepEqual(res.data, {
                schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
                status: '404',
                detail: `Role with ID ${roleId} not found`
              });
            });
          });

          it('should return 400 when the role id is malformed', async function () {
            const res = await axios.get(scimUrl('/Roles/not-an-id'), chimpy);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '400',
              detail: 'Invalid passed role ID',
              scimType: 'invalidValue'
            });
            assert.equal(res.status, 400);
          });

          checkCommonErrors('get', '/Roles/1');
        });

        describe('GET /Roles', function () {
          it(`should return all ${Group.ROLE_TYPE} groups for chimpy`, async function () {
            return withGroupNames(
              ['test-role1', 'test-role2', 'test-group'],
              async ([role1Name, role2Name, group1Name]) => {
                const beforeAdditions = await axios.get(scimUrl('/Roles?count=300'), chimpy);
                const beforeAdditionsIds = new Set(beforeAdditions.data.Resources.map(({id}: {id: number}) => id));
                await getDbManager().createGroup({
                  name: group1Name,
                  type: Group.TEAM_TYPE,
                  memberUsers: [userIdByName['chimpy']!]
                });
                const role1 = await getDbManager().createGroup({
                  name: role1Name,
                  type: Group.ROLE_TYPE,
                  memberUsers: [userIdByName['chimpy']!]
                });
                const role2 = await getDbManager().createGroup({
                  name: role2Name,
                  type: Group.ROLE_TYPE,
                  memberUsers: [userIdByName['kiwi']!]
                });

                const res = await axios.get(scimUrl('/Roles?count=300'), chimpy);
                const newResources = res.data.Resources.filter(({id}: {id: number}) => !beforeAdditionsIds.has(id));
                assert.equal(res.status, 200);
                assert.lengthOf(newResources, 2, 'should have the newly created roles');
                assert.isFalse(res.data.Resources.some(
                  ({displayName}: {displayName: string}) => displayName === group1Name
                ), 'The API endpoint should not return resource Groups');
                assert.deepEqual(newResources, [
                  {
                    schemas: ['urn:ietf:params:scim:schemas:Grist:1.0:Role'],
                    id: String(role1.id),
                    displayName: role1Name,
                    members: [getUserMemberWithRef('chimpy')],
                    meta: { resourceType: 'Role', location: `/api/scim/v2/Roles/${role1.id}` }
                  }, {
                    schemas: ['urn:ietf:params:scim:schemas:Grist:1.0:Role'],
                    id: String(role2.id),
                    displayName: role2Name,
                    members: [getUserMemberWithRef('kiwi')],
                    meta: { resourceType: 'Role', location: `/api/scim/v2/Roles/${role2.id}` }
                  }
                ]);
              }
            );
          });

          it('should return describe the docId, workspaceId and orgId associated to the Role', async function () {
            const api = await getServer().createHomeApi('chimpy', 'docs', true);
            const newOrgId = await api.newOrg({name: 'someOrg', domain: 'testy'});
            const newWsId = await api.newWorkspace({name: 'someWs'}, newOrgId);
            const newDocId = await api.newDoc({name: 'someDoc'}, newWsId);

            const res = await axios.get(scimUrl('/Roles?count=300'), chimpy);

            assert.equal(res.status, 200);
            assert.isTrue(res.data.Resources.some((role: any) => role.orgId === newOrgId),
              'no role with orgId=' + newOrgId);
            assert.isTrue(res.data.Resources.some((role: any) => role.workspaceId === newWsId),
              'no role with workspaceId=' + newWsId);
            assert.isTrue(res.data.Resources.some((role: any) => role.docId === newDocId),
              'no role with docId=' + newDocId);
          });

          checkCommonErrors('get', '/Roles');
        });

        describe('POST /Roles', function () {
          it('should return 501 Not implemented', async function () {
            const res = await axios.post(scimUrl('/Roles'), {
              schemas: ['urn:ietf:params:scim:schemas:Grist:1.0:Role'],
              displayName: 'test-role',
              members: []
            }, chimpy);
            assert.equal(res.status, 501);
          });
        });

        describe('PUT /Roles/{id}', function () {
          it('should update the role\'s members', async function () {
            return withRole(async (roleId) => {
              const res = await axios.put(scimUrl('/Roles/' + roleId), {
                schemas: ['urn:ietf:params:scim:schemas:Grist:1.0:Role'],
                members: [
                  getUserMember('kiwi'),
                ]
              }, chimpy);
              assert.equal(res.status, 200);
              assert.deepEqual(res.data, {
                schemas: ['urn:ietf:params:scim:schemas:Grist:1.0:Role'],
                id: roleId,
                members: [
                  getUserMemberWithRef('kiwi'),
                ],
                meta: { resourceType: 'Role', location: '/api/scim/v2/Roles/' + roleId }
              });
            });
          });

          it('should not update the role name', async function () {
            return withRole(async (roleId, role) => {
              const newName = 'new-name';
              const oldName = role.name;

              const res = await axios.put(scimUrl('/Roles/' + roleId), {
                schemas: ['urn:ietf:params:scim:schemas:Grist:1.0:Role'],
                displayName: newName,
                members: [
                  getUserMember('kiwi'),
                ]
              }, chimpy);
              assert.equal(res.status, 200);
              const updatedRole = await axios.get(scimUrl('/Roles/' + roleId), chimpy);
              assert.equal(updatedRole.data.displayName, oldName, 'Role name should not have changed');
            });
          });

          it('should return 404 when the role is not found', async function () {
            const res = await axios.put(scimUrl('/Roles/1000'), {
              schemas: ['urn:ietf:params:scim:schemas:Grist:1.0:Role'],
              displayName: 'test-role',
              members: [
                getUserMember('kiwi'),
              ]
            }, chimpy);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '404',
              detail: 'Role with id 1000 not found'
            });
            assert.equal(res.status, 404);
          });

          it('should return 400 when the role id is malformed', async function () {
            const res = await axios.put(scimUrl('/Roles/not-an-id'), {
              schemas: ['urn:ietf:params:scim:schemas:Grist:1.0:Role'],
              displayName: 'test-role',
              members: [
                getUserMember('kiwi'),
              ]
            }, chimpy);
            assert.deepEqual(res.data, {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '400',
              detail: 'Invalid passed role ID',
              scimType: 'invalidValue'
            });
            assert.equal(res.status, 400);
          });

          it('should not update the docId, the wsId nor the orgId', async function () {
            return withRole(async (roleId) => {
              const res = await axios.put(scimUrl('/Roles/' + roleId), {
                schemas: ['urn:ietf:params:scim:schemas:Grist:1.0:Role'],
                docId: 1000,
                wsId: 1000,
                orgId: 1000,
                displayName: 'test-role',
                members: [
                  getUserMember('kiwi'),
                ]
              }, chimpy);
              assert.equal(res.status, 200);
              const updatedRole = await axios.get(scimUrl('/Roles/' + roleId), chimpy);
              assert.isUndefined(updatedRole.data.docId, 'docId should not have changed');
              assert.isUndefined(updatedRole.data.wsId, 'wsId should not have changed');
              assert.isUndefined(updatedRole.data.orgId, 'orgId should not have changed');
            });
          });

          checkCommonErrors('put', '/Roles/1', {
            schemas: ['urn:ietf:params:scim:schemas:Grist:1.0:Role'],
            displayName: 'test-role',
            // We need to differ the moment we call userIdByName['kiwi'] (set during a "before()" hook)
            get members() {
              return [getUserMember('kiwi')];
            }
          });
        });

        describe('PATCH /Roles/{id}', function () {
          it('should update the role\'s members', async function () {
            return withRole(async (roleId, role) => {
              const res = await axios.patch(scimUrl('/Roles/' + roleId), {
                schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
                Operations: [{
                  op: 'replace', path: 'members', value: [getUserMember('kiwi')]
                }]
              }, chimpy);
              assert.equal(res.status, 200);
              assert.deepEqual(res.data, {
                schemas: ['urn:ietf:params:scim:schemas:Grist:1.0:Role'],
                id: roleId,
                members: [
                  getUserMemberWithRef('kiwi'),
                ],
                meta: { resourceType: 'Role', location: '/api/scim/v2/Roles/' + roleId }
              });
            });
          });

          checkCommonErrors('patch', '/Roles/1', {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{
              op: 'replace', path: 'displayName', value: 'Updated Role Name'
            }]
          });
        });

        describe('DELETE /Roles/{id}', function () {
          it('should return 501 Not implemented', async function () {
            await withRole(async (roleId) => {
              const res = await axios.delete(scimUrl('/Roles/' + roleId), chimpy);
              assert.equal(res.status, 501);
            });
          });
        });
      });
    });

    describe('POST /Bulk', function () {
      let usersToCleanupEmails: string[];

      beforeEach(async function () {
        usersToCleanupEmails = [];
      });

      afterEach(async function () {
        for (const email of usersToCleanupEmails) {
          const user = await getDbManager().getExistingUserByLogin(email);
          if (user) {
            await cleanupUser(user.id);
          }
        }
      });

      it('should return statuses for each operation', async function () {
        await withUserName('bulk-user3', async (bulkUserName) => {
          const putOnUnknownResource = { method: 'PUT', path: '/Users/1000', value: toSCIMUserWithoutId('chimpy') };
          const validCreateOperation = {
            method: 'POST', path: '/Users/', data: toSCIMUserWithoutId(bulkUserName), bulkId: '1'
          };
          usersToCleanupEmails.push(bulkUserName);
          const createOperationWithUserNameConflict = {
            method: 'POST', path: '/Users/', data: toSCIMUserWithoutId('chimpy'), bulkId: '2'
          };
          const res = await axios.post(scimUrl('/Bulk'), {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
            Operations: [
              putOnUnknownResource,
              validCreateOperation,
              createOperationWithUserNameConflict,
            ],
          }, chimpy);
          assert.equal(res.status, 200);

          const newUserID = await getOrCreateUserId(bulkUserName);
          assert.deepEqual(res.data, {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:BulkResponse"],
            Operations: [
              {
                method: "PUT",
                location: "/api/scim/v2/Users/1000",
                status: "400",
                response: {
                  schemas: [
                    "urn:ietf:params:scim:api:messages:2.0:Error"
                  ],
                  status: "400",
                  scimType: "invalidSyntax",
                  detail: "Expected 'data' to be a single complex value in BulkRequest operation #1"
                }
              }, {
                method: "POST",
                bulkId: "1",
                location: "/api/scim/v2/Users/" + newUserID,
                status: "201"
              }, {
                method: "POST",
                bulkId: "2",
                status: "409",
                response: {
                  schemas: [
                    "urn:ietf:params:scim:api:messages:2.0:Error"
                  ],
                  status: "409",
                  scimType: "uniqueness",
                  detail: "An existing user with the passed email exist."
                }
              }
            ]
          });
        });
      });

      it('should return 400 when no operations are provided', async function () {
        const res = await axios.post(scimUrl('/Bulk'), {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
          Operations: [],
        }, chimpy);
        assert.equal(res.status, 400);
        assert.deepEqual(res.data, {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '400',
          detail: "BulkRequest request body must contain 'Operations' attribute with at least one operation",
          scimType: 'invalidValue'
        });
      });

      it('should disallow accessing resources to kiwi', async function () {
        const creationOperation = {
          method: 'POST', path: '/Users', data: toSCIMUserWithoutId('bulk-user4'), bulkId: '1'
        };
        usersToCleanupEmails.push('bulk-user4');
        const selfPutOperation = { method: 'PUT', path: '/Me', value: toSCIMUserWithoutId('kiwi') };
        const res = await axios.post(scimUrl('/Bulk'), {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
          Operations: [
            creationOperation,
            selfPutOperation,
          ],
        }, kiwi);
        assert.equal(res.status, 200);
        assert.deepEqual(res.data, {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:BulkResponse"],
          Operations: [
            {
              method: "POST",
              bulkId: "1",
              status: "403",
              response: {
                detail: "You are not authorized to access this resource",
                schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
                status: "403"
              }
            }, {
              // When writing this test, the SCIMMY implementation does not yet support PUT operations on /Me.
              // This reflects the current behavior, but it may change in the future.
              // Change this test if the behavior changes.
              // It is probably fine to allow altering oneself even for non-admins.
              method: "PUT",
              location: "/Me",
              status: "400",
              response: {
                schemas: [
                  "urn:ietf:params:scim:api:messages:2.0:Error"
                ],
                status: "400",
                detail: "Invalid 'path' value '/Me' in BulkRequest operation #2",
                scimType: "invalidValue"
              }
            }
          ]
        });
      });

      it('should disallow accessing resources to anonymous', async function () {
        const creationOperation = {
          method: 'POST', path: '/Users', data: toSCIMUserWithoutId('bulk-user5'), bulkId: '1'
        };
        usersToCleanupEmails.push('bulk-user5');
        const res = await axios.post(scimUrl('/Bulk'), {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
          Operations: [creationOperation],
        }, anon);
        assert.equal(res.status, 401);
      });
    });

    it('should allow fetching the Scim schema when autenticated', async function () {
      const res = await axios.get(scimUrl('/Schemas'), kiwi);
      assert.equal(res.status, 200);
      assert.deepInclude(res.data, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      });
      assert.property(res.data, 'Resources');
      assert.deepInclude(res.data.Resources[0], {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
        id: 'urn:ietf:params:scim:schemas:core:2.0:User',
        name: 'User',
        description: 'User Account',
      });
    });

    it('should allow fetching the Scim resource types when autenticated', async function () {
      const res = await axios.get(scimUrl('/ResourceTypes'), kiwi);
      assert.equal(res.status, 200);
      assert.deepInclude(res.data, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      });
      assert.property(res.data, 'Resources');
      assert.deepInclude(res.data.Resources[0], {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        name: 'User',
        endpoint: '/Users',
      });
    });

    it('should allow fetching the Scim service provider config when autenticated', async function () {
      const res = await axios.get(scimUrl('/ServiceProviderConfig'), kiwi);
      assert.equal(res.status, 200);
      assert.deepInclude(res.data, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      });
      assert.property(res.data, 'patch');
      assert.property(res.data, 'bulk');
      assert.property(res.data, 'filter');
    });
  });
});

