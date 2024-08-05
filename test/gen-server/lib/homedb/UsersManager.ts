import { User } from 'app/gen-server/entity/User';
import { AclRuleOrg } from 'app/gen-server/entity/AclRule';
import { Group } from 'app/gen-server/entity/Group';
import { Organization } from 'app/gen-server/entity/Organization';
import { SUPPORT_EMAIL, UsersManager } from 'app/gen-server/lib/homedb/UsersManager';
import { GetUserOptions, NonGuestGroup, Resource } from 'app/gen-server/lib/homedb/Interfaces';
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
import { FullUser, UserProfile } from 'app/common/LoginSessionAPI';
import { ANONYMOUS_USER_EMAIL, EVERYONE_EMAIL, PREVIEWER_EMAIL, UserOptions } from 'app/common/UserAPI';
import { Login } from 'app/gen-server/entity/Login';
import { Pref } from 'app/gen-server/entity/Pref';
import { EntityManager } from 'typeorm';
import log from 'app/server/lib/log';
import winston from 'winston';
import { updateDb } from 'app/server/lib/dbUtils';

const username = process.env.USER || "nobody";
const tmpDir = path.join(tmpdir(), `grist_test_${username}_userendpoint`);

describe('UsersManager', function () {
  const NON_EXISTING_USER_ID = 10001337;
  this.timeout(30000);
  let env: EnvironmentSnapshot;
  let db: HomeDBManager;
  let sandbox: SinonSandbox;

  function getTmpDatabase(typeormDb: string) {
    return getDatabase(path.join(tmpDir, typeormDb));
  }

  /**
   * Works around lacks of type narrowing after asserting the value is defined.
   * This is fixed in latest version of @types/chai
   * FIXME: once using @types/chai > 4.3.17, remove this function
   */
  function assertExists<T>(value?: T, message?: string): asserts value is T {
    assert.exists(value, message);
  }

  /**
   * TODO: Get rid of this function after having forced getUserByLogin returing a Promise<User>
   * and not a Promise<User|undefined>
   */
  async function getOrCreateUser(uuid: string, options?: GetUserOptions) {
    const user = await db.getUserByLogin(makeEmail(uuid), options);
    assertExists(user, 'new user should be created');
    return user;
  }

  function makeEmail(uuid: string) {
    return uuid + '@getgrist.com';
  }

  async function getPersonalOrg(user: User) {
    return db.getOrg({userId: user.id}, user.personalOrg.id);
  }

  function disableLogging<T extends keyof winston.LoggerInstance>(method: T) {
    return sandbox.stub(log, method);
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

  describe('getResourceUsers()', function () {
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

  describe('getUsersWithRole()', function () {
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

  describe('getUserByKey()', function () {
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

  describe('getUser()', async function () {

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
      assertExists(user, 'Should have returned a user');
      assert.strictEqual(user.name, 'Support');
      assert.strictEqual(user.loginEmail, SUPPORT_EMAIL);
      assertExists(!user.prefs, "should not have retrieved user's prefs");
    });

    it('should retrieve a user along with their prefs with `includePrefs` set to true', async function () {
      const expectedUser = await getOrCreateUserWithPrefs();
      const user = await db.getUser(expectedUser.id, {includePrefs: true});
      assertExists(user, "Should have retrieved the user");
      assertExists(user.loginEmail);
      assert.strictEqual(user.loginEmail, expectedUser.loginEmail);
      assertExists(Array.isArray(user.prefs), "should not have retrieved user's prefs");
      assert.deepEqual(user.prefs, [{
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
      await assert.isRejected(db.getFullUser(NON_EXISTING_USER_ID), "unable to find user");
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

    beforeEach(function () {
      managerSaveSpy = sandbox.spy(EntityManager.prototype, 'save');
      userSaveSpy = sandbox.spy(User.prototype, 'save');

    });

    /**
     * Make a user profile.
     * @param uuid A hard-coded UUID (so it is unique and still can be easily retrieved in database for diagnosis)
     */
    function makeProfile(uuid: string): UserProfile {
      return {
        email: makeEmail(uuid),
        name: `NewUser ${uuid}`,
        connectId: `ConnectId-${uuid}`,
        picture: `https://mypic.com/${uuid}.png`
      };
    }

    async function checkUserInfo(profile: UserProfile) {
      const user = await db.getExistingUserByLogin(profile.email);
      assertExists(user, "the new user should be in database");
      assert.deepInclude(user, {
        isFirstTimeUser: false,
        name: profile.name,
        picture: profile.picture
      });
      assert.exists(user.logins?.[0]);
      assert.deepInclude(user.logins[0], {
        email: profile.email.toLowerCase(),
        displayEmail: profile.email
      });
    }

    it('should not do anything if the user already exists and is up to date', async function () {
      await db.ensureExternalUser({
        name: 'Chimpy',
        email: 'chimpy@getgrist.com',
      });
      assert.isFalse(userSaveSpy.called, 'user.save() should not have been called');
      assert.isFalse(managerSaveSpy.called, 'manager.save() should not have been called');
    });

    it('should save an unknown user', async function () {
      const profile = makeProfile('f6fce1ec-892e-493a-9bd7-2c4b0480e7f5');
      await db.ensureExternalUser(profile);
      assert.isTrue(userSaveSpy.called, 'user.save() should have been called');
      assert.isTrue(managerSaveSpy.called, 'manager.save() should have been called');

      await checkUserInfo(profile);
    });

    it('should update a user if they already exist in database', async function () {
      const oldProfile = makeProfile('b48b3c95-a808-43e1-9b78-9171fb6c58fd');
      await db.ensureExternalUser(oldProfile);

      let oldUser = await db.getExistingUserByLogin(oldProfile.email);
      assertExists(oldUser);

      const newProfile = {
        ...makeProfile('b6755ae0-0cb5-4a40-a54c-764d4b187c4c'),
        connectId: oldProfile.connectId,
      };

      await db.ensureExternalUser(newProfile);
      oldUser = await db.getExistingUserByLogin(oldProfile.email);
      assert.notExists(oldUser, 'we should not retrieve the user given their old email address');

      await checkUserInfo(newProfile);
    });

    it('should normalize email address', async function() {
      const profile = makeProfile('92AF6F0F-03C0-414B-9012-2C282D89512A');
      await db.ensureExternalUser(profile);
      await checkUserInfo(profile);
    });
  });

  describe('updateUser()', function () {
    let emitSpy: SinonSpy;

    before(function () {
      emitSpy = Sinon.spy();
      db.on('firstLogin', emitSpy);
    });

    after(function () {
      db.off('firstLogin', emitSpy);
    });

    afterEach(function () {
      emitSpy.resetHistory();
    });

    function checkNoEventEmitted() {
      assert.equal(emitSpy.callCount, 0, 'No event should have been emitted');
    }

    it('should reject when user is not found', async function () {
      disableLogging('debug');
      const promise = db.updateUser(NON_EXISTING_USER_ID, {name: 'foobar'});
      await assert.isRejected(promise, 'unable to find user');
    });

    it('should update a user name', async function () {
      const uuid = 'b7afd9fc-02e1-4206-93f1-b6b923319aed';
      const newUser = await getOrCreateUser(uuid);
      assert.equal(newUser.name, '');
      const userName = 'user name';
      await db.updateUser(newUser.id, {name: userName});
      checkNoEventEmitted();
      const updatedUser = await getOrCreateUser(uuid);
      assert.equal(updatedUser.name, userName);
    });

    it('should not emit any event when isFirstTimeUser value has not changed', async function () {
      const uuid = 'f94fb688-1a62-4423-b852-cbe7f7ceab27';
      const newUser = await getOrCreateUser(uuid);
      assert.equal(newUser.isFirstTimeUser, true);

      await db.updateUser(newUser.id, {isFirstTimeUser: true});
      checkNoEventEmitted();
    });

    it('should emit "firstLogin" event when isFirstTimeUser value has been toggled to false', async function () {
      const uuid = 'f04080c3-98e6-4f4d-a428-20aca006ad52';
      const userName = 'user name';
      const newUser = await getOrCreateUser(uuid);
      assert.equal(newUser.isFirstTimeUser, true);

      await db.updateUser(newUser.id, {isFirstTimeUser: false, name: userName});
      assert.equal(emitSpy.callCount, 1, '"firstLogin" event should have been emitted');

      const fullUserFromEvent = emitSpy.firstCall.args[0];
      assertExists(fullUserFromEvent, 'a FullUser object should be passed with the "firstLogin" event');
      assert.equal(fullUserFromEvent.name, userName);
      assert.equal(fullUserFromEvent.email, makeEmail(uuid));

      const updatedUser = await getOrCreateUser(uuid);
      assert.equal(updatedUser.isFirstTimeUser, false);
    });
  });

  describe('updateUserOptions()', function () {
    it('should reject when user is not found', async function () {
      disableLogging('debug');
      const promise = db.updateUserOptions(NON_EXISTING_USER_ID, {});
      await assert.isRejected(promise, 'unable to find user');
    });

    it('should update user options', async function () {
      const uuid = 'ca8a6812-12c3-473d-a063-500df4827f64';
      const newUser = await getOrCreateUser(uuid);

      assert.notExists(newUser.options);

      const options: UserOptions = {locale: 'fr', authSubject: 'subject', isConsultant: true, allowGoogleLogin: true};
      await db.updateUserOptions(newUser.id, options);

      const updatedUser = await getOrCreateUser(uuid);
      assertExists(updatedUser);
      assertExists(updatedUser.options);
      assert.deepEqual(updatedUser.options, options);
    });
  });

  describe('getExistingUserByLogin()', function () {
    it('should return an existing user', async function () {
      const uuid = '3fcc580a-567b-4786-ba5b-139c36653598';
      const newUser = await getOrCreateUser(uuid);

      const retrievedUser = await db.getExistingUserByLogin(newUser.loginEmail!);
      assertExists(retrievedUser);

      assert.equal(retrievedUser.id, newUser.id);
      assert.equal(retrievedUser.name, newUser.name);
    });

    it('should normalize the passed user email', async function () {
      const uuid = '35413bfd-961a-4429-91e0-7b3fb7c4e09f';
      const newUser = await getOrCreateUser(uuid);

      const retrievedUser = await db.getExistingUserByLogin(newUser.loginEmail!.toUpperCase());
      assertExists(retrievedUser);
    });

    it('should return undefined when the user is not found', async function () {
      const nonExistingEmail = 'i-dont-exist@getgrist.com';
      const retrievedUser = await db.getExistingUserByLogin(nonExistingEmail);
      assert.isUndefined(retrievedUser);
    });
  });

  describe('getUserByLogin()', function () {
    const callGetUserByLogin = getOrCreateUser;

    it('should create a user when none exist with the corresponding email', async function () {
      const uuid = 'a091767e-1ff9-4018-aff3-a19258bf51ac';
      const email = makeEmail(uuid);
      sandbox.useFakeTimers(42_000);
      assert.notExists(await db.getExistingUserByLogin(email));

      const user = await callGetUserByLogin(uuid.toUpperCase());

      assert.isTrue(user.isFirstTimeUser, 'should be marked as first time user');
      assert.equal(user.loginEmail, email);
      assert.equal(user.logins[0].displayEmail, makeEmail(uuid.toUpperCase()));
      assert.equal(user.name, '');
      // FIXME: why is user.lastConnectionAt actually a string and not a Date?
      // FIXME: why is user.lastConnectionAt updated here and ont firstLoginAt?
      assert.equal(String(user.lastConnectionAt), '1970-01-01 00:00:42.000');
    });

    it('should create a personnal organization for the new user', async function () {
      const uuid = '66e36443-027e-4a6a-bc58-dafd8d0cda5c';

      const user = await callGetUserByLogin(uuid);

      const org = await getPersonalOrg(user);
      assertExists(org.data, 'should have retrieved personnal org data');
      assert.equal(org.data.name, 'Personal');
    });

    it('should not create organizations for non-login emails', async function () {
      const user = await db.getUserByLogin(EVERYONE_EMAIL);
      assertExists(user);
      assert.notOk(user.personalOrg);
    });

    it('should not update user information when no profile is passed', async function () {
      const uuid = '330eb9dd-5aba-4d65-9397-88634fe448a4';
      const userFirstCall = await callGetUserByLogin(uuid);
      const userSecondCall = await callGetUserByLogin(uuid);
      assert.deepEqual(userFirstCall, userSecondCall);
    });

    // FIXME: why using Sinon.useFakeTimers() makes user.lastConnectionAt a string instead of a Date
    it.skip('should update lastConnectionAt only for different days', async function () {
      const fakeTimer = sandbox.useFakeTimers(0);
      const uuid = '174509c4-f671-4241-9c17-47df54cdc4e0';
      let user = await callGetUserByLogin(uuid);
      const epochDateTime = '1970-01-01 00:00:00.000';
      assert.equal(String(user.lastConnectionAt), epochDateTime);

      await fakeTimer.tickAsync(42_000);
      user = await callGetUserByLogin(uuid);
      assert.equal(String(user.lastConnectionAt), epochDateTime);

      await fakeTimer.tickAsync('1d');
      user = await callGetUserByLogin(uuid);
      assert.match(String(user.lastConnectionAt), /^1970-01-02/);
    });

    describe('when passing information to update (using `profile`)', function () {
      const makeProfile = (newEmail: string): UserProfile => ({
        name: 'my user name',
        email: newEmail,
        picture: 'https://mypic.com/foo.png',
        connectId: 'new-connect-id',
      });

      it('should populate the firstTimeLogin and deduce the name from the email', async function () {
        sandbox.useFakeTimers(42_000);
        const uuid = '59c4fd04-46ca-4a29-aeca-61809359f19d';
        const user = await callGetUserByLogin(uuid, {profile: {name: '', email: makeEmail(uuid)}});
        assert.equal(user.name, uuid);
        // FIXME: why using Sinon.useFakeTimers() makes user.firstLoginAt a string instead of a Date
        assert.equal(String(user.firstLoginAt), '1970-01-01 00:00:42.000');
      });

      it('should populate user with any passed information', async function () {
        const uuid = 'eea38c2d-f470-4d4f-9fee-e7c8564292d1';
        await callGetUserByLogin(uuid);

        const profile = makeProfile(makeEmail('5d3aa491-e8ae-457c-96d1-7022998148db'));
        const userOptions: UserOptions = {authSubject: 'my-auth-subject'};

        const updatedUser = await callGetUserByLogin(uuid, { profile, userOptions });
        assert.deepInclude(updatedUser, {
          name: profile.name,
          connectId: profile.connectId,
          picture: profile.picture,
        });
        assert.deepInclude(updatedUser.logins[0], {
          displayEmail: profile.email,
        });
        assert.deepInclude(updatedUser.options, {
          authSubject: userOptions.authSubject,
        });
      });
    });
  });

  describe('getUserByLoginWithRetry()', async function () {
    async function ensureGetUserByLoginWithRetryWorks(uuid: string) {
      const email = makeEmail(uuid);
      const user = await db.getUserByLoginWithRetry(email);
      assertExists(user);
      assert.equal(user.loginEmail, email);
    }

    function makeQueryFailedError() {
      const error = new Error() as any;
      error.name = 'QueryFailedError';
      error.detail = 'Key (email)=whatever@getgrist.com already exists';
      return error;
    }

    it('should work just like getUserByLogin', async function () {
      await ensureGetUserByLoginWithRetryWorks( '55bde435-2f61-477a-881a-20076232a941');
    });

    it('should make a second attempt on special error', async function () {
      sandbox.stub(UsersManager.prototype, 'getUserByLogin')
        .onFirstCall().throws(makeQueryFailedError())
        .callThrough();
      await ensureGetUserByLoginWithRetryWorks( '47c42c26-e1e0-4dbb-a042-862107eb28ce');
    });

    it('should reject after 3 attempts', async function () {
      const secondError = makeQueryFailedError();
      sandbox.stub(UsersManager.prototype, 'getUserByLogin')
        .onFirstCall().throws(makeQueryFailedError())
        .onSecondCall().throws(secondError)
        .callThrough();

      const email = makeEmail('cb5ff3d2-9d84-4b6a-b329-1b80d40e4edf');
      const promise = db.getUserByLoginWithRetry(email);
      await assert.isRejected(promise);
      await promise.catch(err => assert.equal(err, secondError));
    });

    it('should reject immediately if the error is not a QueryFailedError', async function () {
      const errorMsg = 'my error';
      sandbox.stub(UsersManager.prototype, 'getUserByLogin')
        .rejects(new Error(errorMsg))
        .callThrough();

      const email = makeEmail('cb5ff3d2-9d84-4b6a-b329-1b80d40e4edf');
      const promise = db.getUserByLoginWithRetry(email);
      await assert.isRejected(promise, errorMsg);
    });
  });

  describe('deleteUser()', function () {
    function userHasPrefs(userId: number, manager: EntityManager) {
      return manager.exists(Pref, { where: { userId: userId }});
    }

    function userHasGroupUsers(userId: number, manager: EntityManager) {
      return manager.exists('group_users', { where: {user_id: userId} });
    }

    it('should refuse to delete the account of someone else', async function () {
      const uuid = 'e5c22c05-fb3c-4e9b-b410-b9a3b72e1c03';
      const userToDelete = await getOrCreateUser(uuid);

      const promise = db.deleteUser({userId: 2}, userToDelete.id);
      await assert.isRejected(promise, 'not permitted to delete this user');
    });

    it('should refuse to delete a non existing account', async function () {
      disableLogging('debug');
      const promise = db.deleteUser({userId: NON_EXISTING_USER_ID}, NON_EXISTING_USER_ID);
      await assert.isRejected(promise, 'user not found');
    });

    it('should refuse to delete the account if the passed name is not matching', async function () {
      disableLogging('debug');
      const uuid = '317fed70-c68e-46d1-b806-92c47894911d';
      const userToDelete = await getOrCreateUser(uuid, {
        profile: {
          name: 'someone to delete',
          email: makeEmail(uuid),
        }
      });

      const promise = db.deleteUser({userId: userToDelete.id}, userToDelete.id, 'wrong name');

      await assert.isRejected(promise);
      await promise.catch(e => assert.match(e.message, /user name did not match/));
    });

    it('should remove the user and cleanup their info and personal organization', async function () {
      const uuid = '226f8de2-347d-4816-8eb6-ecdc362deb18';
      const userToDelete = await getOrCreateUser(uuid, {
        profile: {
          name: 'someone to delete',
          email: makeEmail(uuid),
        }
      });

      assertExists(await getPersonalOrg(userToDelete));

      await db.connection.transaction(async (manager) => {
        assert.isTrue(await userHasGroupUsers(userToDelete.id, manager));
        assert.isTrue(await userHasPrefs(userToDelete.id, manager));
      });

      await db.deleteUser({userId: userToDelete.id}, userToDelete.id);

      assert.notExists(await db.getUser(userToDelete.id));
      assert.deepEqual(await getPersonalOrg(userToDelete), { errMessage: 'organization not found', status: 404 });

      await db.connection.transaction(async (manager) => {
        assert.isFalse(await userHasGroupUsers(userToDelete.id, manager));
        assert.isFalse(await userHasPrefs(userToDelete.id, manager));
      });
    });

    it("should remove the user when passed name corresponds to the user's name", async function () {
      const uuid = '48a2ae1f-743a-45cc-943f-c8eb6c11ee75';
      const userName = 'someone to delete';
      const userToDelete = await getOrCreateUser(uuid, {
        profile: {
          name: userName,
          email: makeEmail(uuid),
        }
      });
      const promise = db.deleteUser({userId: userToDelete.id}, userToDelete.id, userName);
      await assert.isFulfilled(promise);
    });
  });

  describe('initializeSpecialIds()', function () {
    async function withDataBase(dbName: string, cb: (db: HomeDBManager) => Promise<void>) {
      // await prepareDatabase(tmpDir, dbName);
      const database = path.join(tmpDir, dbName);
      const localDb = new HomeDBManager();
      await localDb.createNewConnection({ name: 'special-id', database });
      await updateDb(localDb.connection);
      try {
        await cb(localDb);
      } finally {
        await localDb.connection.destroy();
      }
    }

    after(async function () {
      // HACK: This is a weird case, we have established a different connection
      // but the existing connection is also impacted.
      // A found workaround consist in destroying and creating again the connection.
      //
      // TODO: Check whether using DataSource would help and avoid this hack.
      await db.connection.destroy();
      await db.createNewConnection();
    });

    it('should initialize special ids', async function () {
      return withDataBase('test-special-ids.db', async (localDb) => {
        const specialAccounts = [
          {name: "Support", email: SUPPORT_EMAIL},
          {name: "Anonymous", email: ANONYMOUS_USER_EMAIL},
          {name: "Preview", email: PREVIEWER_EMAIL},
          {name: "Everyone", email: EVERYONE_EMAIL}
        ];
        for (const {email} of specialAccounts) {
          assert.notExists(await localDb.getExistingUserByLogin(email));
        }
        await localDb.initializeSpecialIds();
        for (const {name, email} of specialAccounts) {
          const res = await localDb.getExistingUserByLogin(email);
          assertExists(res);
          assert.equal(res.name, name);
        }
      });
    });
  });

  describe('completeProfiles()', function () {
    it('should return an empty array if no profiles are provided', async function () {
      const res = await db.completeProfiles([]);
      assert.deepEqual(res, []);
    });

    it("should complete a single user profile with looking by normalized address", async function () {
      const uuid = '0f9a8eae-4fcf-4e9b-85e8-227b2ce9cad5';
      const email = makeEmail(uuid);
      const profile = {
        name: 'complete-profile-email-normalized-user',
        email: makeEmail(uuid),
        picture: 'https://mypic.com/me.png',
      };
      const someLocale = 'fr-FR';
      const userCreated = await getOrCreateUser(uuid, { profile });
      await db.updateUserOptions(userCreated.id, {locale: someLocale});

      const res = await db.completeProfiles([{name: 'whatever', email: email.toUpperCase()}]);

      assert.deepEqual(res, [{
        ...profile,
        id: userCreated.id,
        locale: someLocale,
        anonymous: false
      }]);
    });

    it('should complete several user profiles', async function () {
      const uuidPrefix = '0f9a8eae-4fcf-4e9b-85e8-227b2ce9cad5';
      const seq = Array(10).fill(null).map((_, i) => i+1);
      const uuids = seq.map(i => `${uuidPrefix}_${i}`);
      const usersCreated = await Promise.all(
        uuids.map(uuid => getOrCreateUser(uuid))
      );

      const res = await db.completeProfiles(
        uuids.map(
          uuid => ({name: 'whatever', email: makeEmail(uuid)})
        )
      );
      assert.lengthOf(res, uuids.length);
      for (const [index, uuid] of uuids.entries()) {
        assert.deepInclude(res[index], {
          id: usersCreated[index].id,
          email: makeEmail(uuid),
        });
      }
    });
  });
});
