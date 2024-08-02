import { User } from 'app/gen-server/entity/User';
import { AclRuleOrg } from 'app/gen-server/entity/AclRule';
import { Group } from 'app/gen-server/entity/Group';
import { Organization } from 'app/gen-server/entity/Organization';
import { SUPPORT_EMAIL, UsersManager } from 'app/gen-server/lib/homedb/UsersManager';
import { NonGuestGroup, Resource } from 'app/gen-server/lib/homedb/Interfaces';
import { tmpdir } from 'os';
import path from 'path';
import { prepareDatabase } from 'test/server/lib/helpers/PrepareDatabase';
import { prepareFilesystemDirectoryForTests } from 'test/server/lib/helpers/PrepareFilesystemDirectoryForTests';
import { EnvironmentSnapshot } from 'test/server/testUtils';
import { getDatabase } from 'test/testUtils';
import { Workspace } from 'app/gen-server/entity/Workspace';
import { Document } from 'app/gen-server/entity/Document';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import Sinon, { SinonSandbox, SinonSpy } from 'sinon';
import { assert } from 'chai';
import { addSeedData } from 'test/gen-server/seed';
import { FullUser, UserProfile } from 'app/common/LoginSessionAPI';
import { ANONYMOUS_USER_EMAIL } from 'app/common/UserAPI';
import { Login } from 'app/gen-server/entity/Login';
import { Pref } from 'app/gen-server/entity/Pref';
import { EntityManager } from 'typeorm';

const username = process.env.USER || "nobody";
const tmpDir = path.join(tmpdir(), `grist_test_${username}_userendpoint`);

describe('UsersManager', function () {
  this.timeout(30000);
  let env: EnvironmentSnapshot;
  let db: HomeDBManager;
  let sandbox: SinonSandbox;

  function getTmpDatabase(typeormDb: string) {
    return getDatabase(path.join(tmpDir, typeormDb));
  }

  before(async function () {
    env = new EnvironmentSnapshot();
    await prepareFilesystemDirectoryForTests(tmpDir);
    await prepareDatabase(tmpDir);
    db = await getDatabase();
  });

  after(async function () {
    env.restore();
  });

  beforeEach(function () {
    sandbox = Sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });


  function* makeIdxIterator() {
    for (let i = 0; i < 500; i++) {
      yield i;
    }
  }

  function makeUsers(nbUsers: number, idxIt = makeIdxIterator()) {
    return Array(nbUsers).fill(null).map(() => {
      const user = new User();
      const index = idxIt.next();
      if (index.done) {
        throw new Error('Excessive number of users created');
      }
      user.id = index.value;
      user.name = `User ${index.value}`;
      return user;
    });
  }

  function makeUsersList(usersListLength: number) {
    const nbUsersByGroups = 5; // arbitrary value
    const idxIt = makeIdxIterator();
    return Array(usersListLength).fill(null).map(_ => makeUsers(nbUsersByGroups, idxIt));
  }

  describe('getResourceUsers', function () {
    function populateResourceWithMembers(res: Resource, members: User[], groupName?: string) {
      const aclRule = new AclRuleOrg();
      const group = new Group();
      if (groupName) {
        group.name = groupName;
      }
      group.memberUsers = members;
      aclRule.group = group;
      res.aclRules = [
        aclRule
      ];
    }

    it('should return all users from a single organization ACL', function () {
      const resource = new Organization();
      const users = makeUsers(5);
      populateResourceWithMembers(resource, users);
      const result = UsersManager.getResourceUsers(resource);
      assert.deepEqual(result, users);
    });

    it('should return all users from all resources ACL', function () {
      const resources: Resource[] = [new Organization(), new Workspace(), new Document()];
      const usersList = makeUsersList(3);
      for (const [idx, resource] of resources.entries()) {
        populateResourceWithMembers(resource, usersList[idx]);
      }
      const result = UsersManager.getResourceUsers(resources);
      assert.deepEqual(result, usersList.flat());
    });

    it('should return users matching group names from all resources ACL', function () {
      const resources: Resource[] = [new Organization(), new Workspace(), new Document()];
      const usersList = makeUsersList(3);
      const allGroupNames = ['Grp1', 'Grp2', 'Grp3'];
      const filteredGroupNames = allGroupNames.slice(1);
      for (const [idx, resource] of resources.entries()) {
        populateResourceWithMembers(resource, usersList[idx], allGroupNames[idx]);
      }
      const result = UsersManager.getResourceUsers(resources, filteredGroupNames);
      assert.deepEqual(result, usersList.slice(1).flat(), 'should discard the users from the first resource');
    });
  });

  describe('getUsersWithRole', function () {
    function makeGroups(groupDefinition: {[k in NonGuestGroup['name']]?: User[] | undefined}){
      return (Object.entries(groupDefinition) as [NonGuestGroup['name'], User[] | undefined][])
        .map(([groupName, users], index) => {
          const group = new Group() as NonGuestGroup;
          group.id = index;
          group.name = groupName;
          if (users) {
            group.memberUsers = users;
          }
          return group;
        });
    }

    it('should retrieve no users if passed groups do not contain any', function () {
      const groups = makeGroups({
        'members': undefined
      });
      assert.deepEqual(UsersManager.getUsersWithRole(groups), new Map([['members', undefined]] as any));
    });

    it('should retrieve users of passed groups', function () {
      const idxIt = makeIdxIterator();
      const groupsUsersMap = {
        'editors': makeUsers(3, idxIt),
        'owners': makeUsers(4, idxIt),
        'members': makeUsers(5, idxIt),
        'viewers': []
      };
      const groups = makeGroups(groupsUsersMap);
      assert.deepEqual(UsersManager.getUsersWithRole(groups), new Map(Object.entries(groupsUsersMap)));
    });

    it('should exclude users of given IDs', function () {
      const groupUsersMap = {
        'editors': makeUsers(5),
      };
      const excludedUsersId = [1, 2, 3, 4];
      const expectedUsers = [groupUsersMap.editors[0]];
      const groups = makeGroups(groupUsersMap);

      assert.deepEqual(
        UsersManager.getUsersWithRole(groups, excludedUsersId),
        new Map([
          ['editors', expectedUsers]
        ])
      );
    });
  });

  describe('Special User Ids', function () {
    const ANONYMOUS_USER_ID = 6;
    const PREVIEWER_USER_ID = 7;
    const EVERYONE_USER_ID = 8;
    const SUPPORT_USER_ID = 5;
    it('getAnonymousUserId() should retrieve anonymous user id', function () {
      assert.strictEqual(db.getAnonymousUserId(), ANONYMOUS_USER_ID);
    });

    it('getPreviewerUserId() should retrieve previewer user id', function () {
      assert.strictEqual(db.getPreviewerUserId(), PREVIEWER_USER_ID);
    });

    it("getEveryoneUserId() should retrieve 'everyone' user id", function () {
      assert.strictEqual(db.getEveryoneUserId(), EVERYONE_USER_ID);
    });

    it("getSupportUserId() should retrieve 'support' user id", function () {
      assert.strictEqual(db.getSupportUserId(), SUPPORT_USER_ID);
    });

    describe('Without special id initialization', function () {
      async function createDatabaseWithoutSpecialIds() {
        const stub = sandbox.stub(HomeDBManager.prototype, 'initializeSpecialIds').resolves(undefined);
        const localDb = await getTmpDatabase('without-special-ids.db');
        stub.restore();
        return localDb;
      }

      it('should throw an error', async function () {
        const localDb = await createDatabaseWithoutSpecialIds();
        assert.throws(() => localDb.getAnonymousUserId(), "Anonymous user not available");
        assert.throws(() => localDb.getPreviewerUserId(), "Previewer user not available");
        assert.throws(() => localDb.getEveryoneUserId(), "'everyone' user not available");
        assert.throws(() => localDb.getSupportUserId(), "'support' user not available");
      });
    });
  });

  describe('getUserByKey', function () {
    it('should return the user given their API Key', async function () {
      const user = await db.getUserByKey('api_key_for_chimpy');
      assert.strictEqual(user?.name, 'Chimpy', 'should retrieve Chimpy by their API key');
      assert.strictEqual(user?.logins?.[0].email, 'chimpy@getgrist.com');
    });

    it('should return undefined if no user matches the API key', async function () {
      const user = await db.getUserByKey('non-existing API key');
      assert.strictEqual(user, undefined);
    });
  });

  describe('getUser', async function () {

    const userWithPrefsEmail = 'userwithprefs@getgrist.com';
    async function getOrCreateUserWithPrefs() {
      const user = await db.getUserByLogin(userWithPrefsEmail);
      if (!user) {
        throw new Error('getOrCreateUserWithPrefs: User not created!');
      }
      return user;
    }

    it('should retrieve a user by their ID', async function () {
      const user = await db.getUser(db.getSupportUserId());
      assert.ok(user, 'Should have returned a user');
      assert.strictEqual(user!.name, 'Support');
      assert.strictEqual(user!.loginEmail, SUPPORT_EMAIL);
      assert.ok(!user!.prefs, "should not have retrieved user's prefs");
    });

    it('should retrieve a user along with their prefs with `includePrefs` set to true', async function () {
      const expectedUser = await getOrCreateUserWithPrefs();
      const user = await db.getUser(expectedUser.id, {includePrefs: true});
      assert.ok(user, "Should have retrieved the user");
      assert.ok(user!.loginEmail);
      assert.strictEqual(user!.loginEmail, expectedUser.loginEmail);
      assert.ok(Array.isArray(user!.prefs), "should not have retrieved user's prefs");
      assert.deepEqual(user!.prefs, [{
        userId: expectedUser.id,
        orgId: expectedUser.personalOrg.id,
        prefs: { showGristTour: true } as any
      }]);
    });
  });

  describe('getFullUser()', function () {
    it('should return the support user', async function () {
      const supportId = db.getSupportUserId();
      const user = await db.getFullUser(supportId);
      const expectedResult: FullUser = {
        isSupport: true,
        email: SUPPORT_EMAIL,
        id: supportId,
        name: 'Support'
      };
      assert.deepInclude(user, expectedResult);
      assert.ok(!user.anonymous, 'anonymous property should be falsy');
    });

    it('should return the anonymous user', async function () {
      const anonId = db.getAnonymousUserId();
      const user = await db.getFullUser(anonId);
      const expectedResult: FullUser = {
        anonymous: true,
        email: ANONYMOUS_USER_EMAIL,
        id: anonId,
        name: 'Anonymous',
      };
      assert.deepInclude(user, expectedResult);
      assert.ok(!user.isSupport, 'support property should be falsy');
    });

    it('should throw when user is not found', async function () {
      await assert.isRejected(db.getFullUser(1337), "unable to find user");
    });
  });

  describe('makeFullUser()', function () {
    const someUserDisplayEmail = 'SomeUser@getgrist.com';
    const normalizedSomeUserEmail = 'someuser@getgrist.com';
    const someUserLocale = 'en-US';
    const SOME_USER_ID = 42;
    const prefWithOrg: Pref = {
      prefs: {placeholder: 'pref-with-org'},
      orgId: 43,
      user: new User(),
      userId: SOME_USER_ID,
    };
    const prefWithoutOrg: Pref = {
      prefs: {placeholder: 'pref-without-org'},
      orgId: null,
      user: new User(),
      userId: SOME_USER_ID
    };


    function makeSomeUser() {
      return User.create({
        id: SOME_USER_ID,
        ref: 'some ref',
        name: 'some user',
        picture: 'https://grist.com/mypic',
        options: {
          locale: someUserLocale
        },
        logins: [
          Login.create({
            userId: SOME_USER_ID,
            email: normalizedSomeUserEmail,
            displayEmail: someUserDisplayEmail,
          }),
        ],
        prefs: [
          prefWithOrg,
          prefWithoutOrg
        ]
      });
    }

    it('creates a FullUser from a User entity', function () {
      const input = makeSomeUser();
      const fullUser = db.makeFullUser(input);
      assert.deepEqual(fullUser, {
        id: SOME_USER_ID,
        email: someUserDisplayEmail,
        loginEmail: normalizedSomeUserEmail,
        name: input.name,
        picture: input.picture,
        ref: input.ref,
        locale: someUserLocale,
        prefs: prefWithoutOrg.prefs
      });
    });

    it('sets `anonymous` property to true for anon@getgrist.com', function () {
      const anon = db.getAnonymousUser();
      const fullUser = db.makeFullUser(anon);
      assert.isTrue(fullUser.anonymous, "`anonymous` property should be set to true");
      assert.ok(!fullUser.isSupport, "`isSupport` should be falsy");
    });

    it('sets `isSupport` property to true for support account', async function () {
      const support = await db.getUser(db.getSupportUserId());
      const fullUser = db.makeFullUser(support!);
      assert.isTrue(fullUser.isSupport, "`isSupport` property should be set to true");
      assert.ok(!fullUser.anonymous, "`anonymouse` should be falsy");
    });

    it('should throw when no displayEmail exist for this user', function () {
      const input = makeSomeUser();
      input.logins[0].displayEmail = '';
      assert.throws(() => db.makeFullUser(input), "unable to find mandatory user email");
      input.logins = [];
      assert.throws(() => db.makeFullUser(input), "unable to find mandatory user email");
    });
  });

  describe('ensureExternalUser()', function () {
    let managerSaveSpy: SinonSpy;
    let userSaveSpy: SinonSpy;
    let localDb: HomeDBManager;

    before(async function () {
      localDb = await getTmpDatabase('ensureExternalUser.db');
      await addSeedData(localDb.connection);
    });
    beforeEach(function () {
      managerSaveSpy = sandbox.spy(EntityManager.prototype, 'save');
      userSaveSpy = sandbox.spy(User.prototype, 'save');

    });

    function makeProfile(uuid: string): UserProfile {
      return {
        email: `${uuid}@getgrist.com`,
        name: `NewUser ${uuid}`,
        connectId: `ConnectId-${uuid}`,
        picture: `https://mypic.com/${uuid}.png`
      };
    }

    async function checkUserInfo(profile: UserProfile) {
      const user = await localDb.getExistingUserByLogin(profile.email);
      assert.exists(user, "the new user should be in database");
      assert.deepInclude(user, {
        isFirstTimeUser: false,
        name: profile.name,
        picture: profile.picture
      });
      assert.exists(user!.logins?.[0]);
      assert.deepInclude(user!.logins[0], {
        email: profile.email.toLowerCase(),
        displayEmail: profile.email
      });
    }

    it('should not do anything if the user already exists and is up to date', async function () {
      await localDb.ensureExternalUser({
        name: 'Chimpy',
        email: 'chimpy@getgrist.com',
      });
      assert.isFalse(userSaveSpy.called, 'user.save() should not have been called');
      assert.isFalse(managerSaveSpy.called, 'manager.save() should not have been called');
    });

    it('should save an unknown user', async function () {
      const profile = makeProfile('f6fce1ec-892e-493a-9bd7-2c4b0480e7f5');
      await localDb.ensureExternalUser(profile);
      assert.isTrue(userSaveSpy.called, 'user.save() should have been called');
      assert.isTrue(managerSaveSpy.called, 'manager.save() should have been called');

      await checkUserInfo(profile);
    });

    it('should update a user if they already exist in database', async function () {
      const oldProfile = makeProfile('b48b3c95-a808-43e1-9b78-9171fb6c58fd');
      await localDb.ensureExternalUser(oldProfile);

      let oldUser = await localDb.getExistingUserByLogin(oldProfile.email);
      assert.exists(oldUser);

      const newProfile = {
        ...makeProfile('b6755ae0-0cb5-4a40-a54c-764d4b187c4c'),
        connectId: oldProfile.connectId,
      };

      await localDb.ensureExternalUser(newProfile);
      oldUser = await localDb.getExistingUserByLogin(oldProfile.email);
      assert.notExists(oldUser, 'we should not retrieve the user given their old email address');

      await checkUserInfo(newProfile);
    });

    it('should normalize email address', async function() {
      const profile = makeProfile('92AF6F0F-03C0-414B-9012-2C282D89512A');
      await localDb.ensureExternalUser(profile);
      await checkUserInfo(profile);
    });

    it('FIXME', function () {
      throw new Error('TODO: only use `db` and no localDb variable anymore');
    });
  });
});
