import { assert } from 'chai';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { EnvironmentSnapshot, setTmpLogLevel } from 'test/server/testUtils';
import { createInitialDb, removeConnection, setUpDB } from 'test/gen-server/seed';
import { Group } from 'app/gen-server/entity/Group';
import omit from 'lodash/omit';
import { User } from 'app/gen-server/entity/User';
import { GroupWithMembersDescriptor } from 'app/gen-server/lib/homedb/Interfaces';

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

  afterEach(cleanupTestGroups);

  async function cleanupTestGroups() {
    const { connection } = db;
    await connection.transaction(async manager => {
      const groupsToDelete = await manager.createQueryBuilder()
        .select('groups')
        .from(Group, "groups")
        .where("groups.name like 'test-%'")
        .getMany();
      if (groupsToDelete.length > 0) {
        const groupsToDeleteIds = groupsToDelete.map(g => g.id);
        await manager.createQueryBuilder()
          .delete()
          .from("group_groups")
          .where("subgroup_id in (:...groupsToDeleteIds)", { groupsToDeleteIds })
          .execute();
        await manager.remove(groupsToDelete);
      }
    });
  }

  function sanitizeUserPropertiesForMembership(user: User) {
    return omit(user, 'logins', 'personalOrg');
  }

  const makeInnerGroupName = (groupName: string) => groupName + '-inner';

  const ensureTestGroupName = (groupName: string) => { assert.match(groupName, /^test-/); };

  async function createDummyGroup(groupName: string, extraProps: Partial<GroupWithMembersDescriptor> = {}) {
    ensureTestGroupName(groupName);
    const chimpy = (await db.getExistingUserByLogin('chimpy@getgrist.com'))!;
    const group = await db.createGroup({
      name: groupName,
      type: Group.RESOURCE_USERS_TYPE,
      memberUsers: [chimpy.id],
      ...extraProps,
    });
    return { group, chimpy };
  }

  async function createDummyGroupAndInnerGroup(upperGroupName: string, opts?: {
    upperGroupProps?: Partial<GroupWithMembersDescriptor>,
    innerGroupProps?: Partial<GroupWithMembersDescriptor>
  }) {
    ensureTestGroupName(upperGroupName);
    const { upperGroupProps = {}, innerGroupProps = {}} = opts ?? {};
    const kiwi = (await db.getExistingUserByLogin('kiwi@getgrist.com'))!;
    const innerGroupName = makeInnerGroupName(upperGroupName);

    const innerGroup = await db.createGroup({
      name: innerGroupName,
      type: Group.RESOURCE_USERS_TYPE,
      memberUsers: [kiwi.id],
      ...upperGroupProps,
    });
    const { group, chimpy } = await createDummyGroup(upperGroupName, {
      memberGroups: [innerGroup.id],
      type: Group.ROLE_TYPE,
      ...innerGroupProps,
    });

    return {chimpy, kiwi, innerGroup, group};
  }

  describe('createGroup()', function () {
    setTmpLogLevel('info');

    it('should create a new resource users group', async function () {
      const groupName = 'test-creategroup';
      const { group, chimpy } = await createDummyGroup(groupName);
      assert.equal(group.name, groupName);
      assert.equal(group.type, Group.RESOURCE_USERS_TYPE);
      assert.deepEqual(group.memberUsers, [sanitizeUserPropertiesForMembership(chimpy)]);
      await Group.remove([group]);
    });

    it('should create a new resource users group with groupMembers', async function () {
      const groupName = 'test-creategroup-with-groupMembers';
      const { group, innerGroup, chimpy } = await createDummyGroupAndInnerGroup(groupName);
      assert.equal(group.name, groupName);
      assert.equal(group.type, Group.ROLE_TYPE);
      assert.deepEqual(group.memberUsers, [sanitizeUserPropertiesForMembership(chimpy)]);
      assert.equal(group.memberGroups.length, 1);
      assert.equal(group.memberGroups[0].name, innerGroup.name);
      assert.equal(group.memberGroups[0].type, Group.RESOURCE_USERS_TYPE);
    });

    it("should refuse adding a RESOURCE_USERS_TYPE group as a member of another one", async function () {
      const groupName = 'test-create-nested-resource-users';
      const promise = createDummyGroupAndInnerGroup(groupName, {
        innerGroupProps: {
          type: Group.RESOURCE_USERS_TYPE,
        }
      });
      await assert.isRejected(promise, /cannot contain groups/);
    });
  });

  describe("overwriteGroup()", function () {
    setTmpLogLevel('info');
    it("should fail if the group is not found", function () {
      const promise = db.overwriteGroup(999, {
        name: 'test-overwrite',
        type: Group.ROLE_TYPE,
      });
      return assert.isRejected(promise, /not found/);
    });

    it('should fail when setting memberGroups to RESOURCE_USERS_TYPE', async function () {
      const groupName = 'test-overwrite';
      const { group, innerGroup } = await createDummyGroupAndInnerGroup(groupName);
      const promise = db.overwriteGroup(group.id, {
        name: groupName,
        type: Group.RESOURCE_USERS_TYPE,
        memberGroups: [innerGroup.id],
      });
      return assert.isRejected(promise, /cannot contain groups/);
    });

    it('should fail when adding itself to memberGroups', async function () {
      const groupName = 'test-overwrite';
      const { group } = await createDummyGroup(groupName);
      const promise = db.overwriteGroup(group.id, {
        name: groupName,
        type: Group.ROLE_TYPE,
        memberGroups: [group.id],
      });
      return assert.isRejected(promise, /cannot contain itself/);
    });

    it('should overwrite the group info', async function () {
      const groupName = 'test-overwrite';
      const newInnerGroupName = 'test-overwrite-inner-new';
      const { group } = await createDummyGroupAndInnerGroup(groupName);
      const { group: newInnerGroup, kiwi } = await createDummyGroupAndInnerGroup(newInnerGroupName);
      const newGroupName = 'test-overwrite-new';
      await db.overwriteGroup(group.id, {
        name: newGroupName,
        type: Group.ROLE_TYPE,
        memberUsers: [kiwi.id],
        memberGroups: [newInnerGroup.id],
      });
      const updatedGroup = (await db.getGroupWithMembersById(group.id))!;
      assert.equal(updatedGroup.name, newGroupName);
      assert.equal(updatedGroup.type, Group.ROLE_TYPE);
      assert.deepEqual(updatedGroup.memberUsers, [sanitizeUserPropertiesForMembership(kiwi)]);
      assert.lengthOf(updatedGroup.memberGroups, 1);
      assert.equal(updatedGroup.memberGroups[0].id, newInnerGroup.id);
    });

    it('should overwrite the group info and unset unspecified properties', async function () {
      const groupName = 'test-overwrite';
      const { group } = await createDummyGroupAndInnerGroup(groupName);
      const newGroupName = 'test-overwrite-new';
      await db.overwriteGroup(group.id, {
        name: newGroupName,
        type: Group.ROLE_TYPE,
      });
      const updatedGroup = (await db.getGroupWithMembersById(group.id))!;
      assert.equal(updatedGroup.name, newGroupName);
      assert.equal(updatedGroup.type, Group.ROLE_TYPE);
      assert.isEmpty(updatedGroup.memberUsers);
      assert.isEmpty(updatedGroup.memberGroups);
    });
  });

  describe('getGroupsWithMembersByType()', function () {
    it('should return groups and members for roles', async function () {
      const groups = await db.getGroupsWithMembersByType(Group.ROLE_TYPE);
      assert.isNotEmpty(groups, 'should return roles');
      const groupsNames = new Set(groups.map(group => group.name));

      assert.sameMembers([...groupsNames], ['owners', 'editors', 'viewers', 'guests', 'members']);
      assert.isTrue(groups.some(g => g.memberUsers.length > 0), "memberUsers should be populated");
      assert.isTrue(groups.some(g => g.memberGroups.length > 0), "memberGroups should be populated");
      assert.isTrue(groups.every(g => g.type === Group.ROLE_TYPE), 'some groups retrieved are not of type ' +
        Group.ROLE_TYPE);
    });

    it('should return groups for resource users', async function () {
      const groupName = 'test-getGroupsWithMembers';

      const { innerGroup } = await createDummyGroupAndInnerGroup(groupName);
      const groups = await db.getGroupsWithMembersByType(Group.RESOURCE_USERS_TYPE);
      assert.deepEqual(groups, [innerGroup]);
    });
  });

  describe('getGroupsWithMembers()', function () {
    it('should return all the groups and members', async function () {
      const omitGroupMembers = (group: Group) => omit(group, 'memberGroups', 'memberUsers');
      const groupName = 'test-getGroupsWithMembers';
      const innerGroupName = makeInnerGroupName(groupName);
      const { group: createdGroup, innerGroup } =  await createDummyGroupAndInnerGroup(groupName);
      const groups = await db.getGroupsWithMembers();
      assert.isNotEmpty(groups, 'should return groups');
      const groupsNames = new Set(groups.map(group => group.name));

      assert.sameMembers([...groupsNames], ['owners', 'editors', 'viewers', 'guests', 'members',
        groupName, innerGroupName]);
      const group = groups.find(g => g.name === groupName)!;
      assert.exists(group, 'group is not found');
      assert.deepEqual(omitGroupMembers(group), omitGroupMembers(createdGroup));
      // TODO: should the getGroupsWithMembers return members details?
      assert.deepEqual(group.memberGroups.map(g => g.id), [ innerGroup.id ]);
    });

    it('should return groups for resource users', async function () {
      const groupName = 'test-getGroupsWithMembers';

      const { innerGroup } = await createDummyGroupAndInnerGroup(groupName);
      const groups = await db.getGroupsWithMembersByType(Group.RESOURCE_USERS_TYPE);
      assert.deepEqual(groups, [innerGroup]);
    });
  });

  describe('getGroupWithMembersById()', function () {
    it('should return null when the group is not found', async function () {
      const nonExistingGroup = await db.getGroupWithMembersById(999);
      assert.isNull(nonExistingGroup);
    });

    it('should return a group and with its members given an ID', async function () {
      const groupName = 'test-getGroupWithMembers';

      const { group: createdGroup, innerGroup, chimpy } = await createDummyGroupAndInnerGroup(groupName);

      const group = (await db.getGroupWithMembersById(createdGroup.id))!;
      assert.exists(group, 'group not found');
      assert.equal(group.name, groupName);
      assert.equal(group.type, Group.ROLE_TYPE);
      assert.deepEqual(group.memberUsers, [sanitizeUserPropertiesForMembership(chimpy)]);
      assert.equal(group.memberGroups.length, 1);
      assert.equal(group.memberGroups[0].name, innerGroup.name);
      assert.equal(group.memberGroups[0].type, Group.RESOURCE_USERS_TYPE);
    });
  });

  describe('deleteGroup()', function () {
    setTmpLogLevel('info');

    it('should fail when the group is not found', async function () {
      const promise = db.deleteGroup(999);
      return assert.isRejected(promise, /not found/);
    });

    it('should delete a group', async function () {
      const groupName = 'test-deleteGroup';
      const { group } = await createDummyGroup(groupName);
      await db.deleteGroup(group.id);
      const deletedGroup = await db.getGroupWithMembersById(group.id);
      assert.isNull(deletedGroup);
    });

    it('should delete a group having members', async function () {
      const groupName = 'test-deleteGroup';
      const { group, innerGroup } = await createDummyGroupAndInnerGroup(groupName);
      const anotherInnerGroup = await db.createGroup({
        name: 'test-deleteGroup-inner2',
        type: Group.RESOURCE_USERS_TYPE,
      });
      await db.overwriteGroup(group.id, {
        name: groupName,
        type: Group.ROLE_TYPE,
        memberGroups: [innerGroup.id, anotherInnerGroup.id],
      });
      await db.deleteGroup(group.id);
      const reloadedInnerGroup = (await db.getGroupWithMembersById(innerGroup.id));
      assert.exists(reloadedInnerGroup, 'innerGroup not found after deleting parent group');
      const reloadedAnotherInnerGroup = (await db.getGroupWithMembersById(anotherInnerGroup.id));
      assert.exists(reloadedAnotherInnerGroup, 'anotherInnerGroup not found after deleting parent group');
    });

    it('should dereference the group from its parent group', async function () {
      const groupName = 'test-deleteGroup';
      const { group, innerGroup } = await createDummyGroupAndInnerGroup(groupName);
      await db.deleteGroup(innerGroup.id);
      const updatedGroup = (await db.getGroupWithMembersById(group.id))!;
      assert.exists(updatedGroup, 'upper group not found');
      assert.isEmpty(updatedGroup.memberGroups);
    });
  });
});