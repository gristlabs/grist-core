import { assert } from 'chai';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { EnvironmentSnapshot } from 'test/server/testUtils';
import { createInitialDb, removeConnection, setUpDB } from 'test/gen-server/seed';
import { Group } from 'app/gen-server/entity/Group';
import omit from 'lodash/omit';
import { User } from 'app/gen-server/entity/User';

describe("GroupsManager", function () {
  this.timeout('3m');
  let env: EnvironmentSnapshot;
  let db: HomeDBManager;

  before(async function () {
    env = new EnvironmentSnapshot();
    process.env.TEST_CLEAN_DATABASE = 'true';
    setUpDB(this);
    db = new HomeDBManager();
    await createInitialDb();
    await db.connect();
    await db.initializeSpecialIds();
  });

  after(async function () {
    env?.restore();
    await removeConnection();
  });

  function sanitizeUserPropertiesForMembership(user: User) {
    return omit(user, 'logins', 'personalOrg');
  }

  describe('createGroup()', function () {
    it('should create a new resource users group', async function () {
      const chimpy = (await db.getExistingUserByLogin('chimpy@getgrist.com'))!;
      const group = await db.createGroup({
        name: 'test-creategroup',
        type: Group.RESOURCE_USERS_TYPE,
        memberUsers: [chimpy.id],
      });
      assert.equal(group.name, 'test-creategroup');
      assert.equal(group.type, 'resource users');
      assert.deepEqual(group.memberUsers, [sanitizeUserPropertiesForMembership(chimpy)]);
    });

    it('should create a new resource users group with groupMembers', async function () {
      const kiwi = (await db.getExistingUserByLogin('kiwi@getgrist.com'))!;
      const innerGroup = await db.createGroup({
        name: 'test-creategroup-innerGroup',
        type: Group.RESOURCE_USERS_TYPE,
      });
      const group = await db.createGroup({
        name: 'test-creategroup-with-groupMembers',
        type: Group.RESOURCE_USERS_TYPE,
        memberUsers: [kiwi.id],
        memberGroups: [innerGroup.id],
      });
      assert.equal(group.name, 'test-creategroup-with-groupMembers');
      assert.equal(group.type, 'resource users');
      assert.deepEqual(group.memberUsers, [sanitizeUserPropertiesForMembership(kiwi)]);
      assert.equal(group.memberGroups.length, 1);
      assert.equal(group.memberGroups[0].name, innerGroup.name);
    });
  });

  describe('getGroupsWithMembers()', function () {
    it('should return groups and members for roles', async function () {
      const groups = await db.getGroupsWithMembers(Group.ROLE_TYPE);
      assert.isNotEmpty(groups, 'should return roles');
      const groupsNames = new Set(groups.map(group => group.name));
      assert.deepEqual(groupsNames, new Set(['owners', 'editors', 'viewers', 'guests', 'members']));
      assert.isTrue(groups.some(g => g.memberUsers.length > 0), "memberUsers should be populated");
      assert.isTrue(groups.some(g => g.memberGroups.length > 0), "memberGroups should be populated");
      assert.isTrue(groups.every(g => g.type === Group.ROLE_TYPE), 'some groups retrieved are not of type ' +
        Group.ROLE_TYPE);
    });

    it('should return groups and members for resource users', async function () {
      const chimpy = (await db.getExistingUserByLogin('chimpy@getgrist.com'))!;
      const kiwi = (await db.getExistingUserByLogin('kiwi@getgrist.com'))!;
      const innerGroupName = 'test-getGroupsWithMembers-inner';
      const groupName = 'test-getGroupsWithMembers';

      const innerGroup = await db.createGroup({
        name: innerGroupName,
        type: Group.RESOURCE_USERS_TYPE,
        memberUsers: [kiwi.id],
      });
      await db.createGroup({
        name: groupName,
        type: Group.RESOURCE_USERS_TYPE,
        memberUsers: [chimpy.id],
        memberGroups: [innerGroup.id]
      });
      const groups = await db.getGroupsWithMembers(Group.RESOURCE_USERS_TYPE);
      assert.isTrue(groups.every(g => g.type === Group.RESOURCE_USERS_TYPE),
        `some groups retrieved are not of type "${Group.RESOURCE_USERS_TYPE}"`);
      const group = groups.find(g => g.name === groupName);
      assert.exists(group, 'group not found');
      assert.deepEqual(group!.memberUsers, [sanitizeUserPropertiesForMembership(chimpy)]);
      assert.exists(groups.find(g => g.name === innerGroupName), 'inner group not found');
    });
  });

  describe('getGroupWithMembersById()', function () {
    it('should return null when the group is not found', async function () {
      const nonExistingGroup = await db.getGroupWithMembersById(999);
      assert.isNull(nonExistingGroup);
    });

    it('should return a group and with its members given an ID', async function () {
      // FIXME: factorize this piece of code
      const chimpy = (await db.getExistingUserByLogin('chimpy@getgrist.com'))!;
      const kiwi = (await db.getExistingUserByLogin('kiwi@getgrist.com'))!;
      const innerGroupName = 'test-getGroupWithMembers-inner';
      const groupName = 'test-getGroupWithMembers';

      const innerGroup = await db.createGroup({
        name: innerGroupName,
        type: Group.RESOURCE_USERS_TYPE,
        memberUsers: [kiwi.id],
      });
      const createdGroup = await db.createGroup({
        name: groupName,
        type: Group.RESOURCE_USERS_TYPE,
        memberUsers: [chimpy.id],
        memberGroups: [innerGroup.id]
      });

      const group = (await db.getGroupWithMembersById(createdGroup.id))!;
      assert.exists(group, 'group not found');
      assert.equal(group.name, groupName);
      assert.equal(group.type, Group.RESOURCE_USERS_TYPE);
      assert.deepEqual(group.memberUsers, [sanitizeUserPropertiesForMembership(chimpy)]);
      assert.equal(group.memberGroups.length, 1);
      assert.equal(group.memberGroups[0].name, innerGroup.name);
    });
  });
});
