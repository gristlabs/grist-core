import * as roles from "app/common/roles";
import { AclRule } from "app/gen-server/entity/AclRule";
import { Document } from "app/gen-server/entity/Document";
import { Group } from "app/gen-server/entity/Group";
import { GroupWithMembersDescriptor, NonGuestGroup,
  Resource, RoleGroupDescriptor, RunInTransaction } from "app/gen-server/lib/homedb/Interfaces";
import { Organization } from "app/gen-server/entity/Organization";
import { Permissions } from 'app/gen-server/lib/Permissions';
import { User } from "app/gen-server/entity/User";
import { Workspace } from "app/gen-server/entity/Workspace";

import { EntityManager } from "typeorm";
import { UsersManager } from "./UsersManager";
import { ApiError } from "app/common/ApiError";

export type GroupTypes = typeof Group.ROLE_TYPE | typeof Group.RESOURCE_USERS_TYPE;

/**
 * Class responsible for Groups and Roles Management.
 *
 * It's only meant to be used by HomeDBManager. If you want to use one of its (instance or static) methods,
 * please make an indirection which passes through HomeDBManager.
 */
export class GroupsManager {
  // All groups.
  public get defaultGroups(): RoleGroupDescriptor[] {
    return this._defaultGroups;
  }

  // Groups whose permissions are inherited from parent resource to child resources.
  public get defaultBasicGroups(): RoleGroupDescriptor[] {
    return this._defaultGroups
      .filter(_grpDesc => _grpDesc.nestParent);
  }

  // Groups that are common to all resources.
  public get defaultCommonGroups(): RoleGroupDescriptor[] {
    return this._defaultGroups
      .filter(_grpDesc => !_grpDesc.orgOnly);
  }

  public get defaultGroupNames(): roles.Role[] {
    return this._defaultGroups.map(_grpDesc => _grpDesc.name);
  }

  public get defaultBasicGroupNames(): roles.BasicRole[] {
    return this.defaultBasicGroups
      .map(_grpDesc => _grpDesc.name) as roles.BasicRole[];
  }

  public get defaultNonGuestGroupNames(): roles.NonGuestRole[] {
    return this._defaultGroups
      .filter(_grpDesc => _grpDesc.name !== roles.GUEST)
      .map(_grpDesc => _grpDesc.name) as roles.NonGuestRole[];
  }

  public get defaultCommonGroupNames(): roles.NonMemberRole[] {
    return this.defaultCommonGroups
      .map(_grpDesc => _grpDesc.name) as roles.NonMemberRole[];
  }

  // Returns a map of userIds to the user's strongest default role on the given resource.
  // The resource's aclRules, groups, and memberUsers must be populated.
  public static getMemberUserRoles<T extends roles.Role>(res: Resource, allowRoles: T[]): {[userId: string]: T} {
    // Add the users to a map to ensure uniqueness. (A user may be present in
    // more than one group)
    const userMap: {[userId: string]: T} = {};
    (res.aclRules as AclRule[]).forEach((aclRule: AclRule) => {
      const role = aclRule.group.name as T;
      if (allowRoles.includes(role)) {
        // Map the users to remove sensitive information from the result and
        // to add the group names.
        aclRule.group.memberUsers.forEach((u: User) => {
          // If the user is already present in another group, use the more
          // powerful role name.
          userMap[u.id] = userMap[u.id] ? roles.getStrongestRole(userMap[u.id], role) : role;
        });
      }
    });
    return userMap;
  }

  /**
   * Five aclRules, each with one group (with the names 'owners', 'editors', 'viewers',
   * 'guests', and 'members') are created by default on every new entity (Organization,
   * Workspace, Document). These special groups are documented in the _defaultGroups
   * constant below.
   *
   * When a child resource is created under a parent (i.e. when a new Workspace is created
   * under an Organization), special groups with a truthy 'nestParent' property are set up
   * to include in their memberGroups a single group on initialization - the parent's
   * corresponding special group. Special groups with a falsy 'nextParent' property are
   * empty on intialization.
   *
   * NOTE: The groups are ordered from most to least permissive, and should remain that way.
   * TODO: app/common/roles already contains an ordering of the default roles. Usage should
   * be consolidated.
   */
  private readonly _defaultGroups: RoleGroupDescriptor[] = [{
    name: roles.OWNER,
    permissions: Permissions.OWNER,
    nestParent: true
  }, {
    name: roles.EDITOR,
    permissions: Permissions.EDITOR,
    nestParent: true
  }, {
    name: roles.VIEWER,
    permissions: Permissions.VIEW,
    nestParent: true
  }, {
    name: roles.GUEST,
    permissions: Permissions.VIEW,
    nestParent: false
  }, {
    name: roles.MEMBER,
    permissions: Permissions.VIEW,
    nestParent: false,
    orgOnly: true
  }];

  public constructor (private _usersManager: UsersManager, private _runInTransaction: RunInTransaction) {}

  /**
   * Helper for adjusting acl inheritance rules. Given an array of top-level groups from the
   * resource of interest, and an array of inherited groups belonging to the parent resource,
   * moves the inherited groups to the group with the destination name or lower, if their
   * permission level is lower. If the destination group name is omitted, the groups are
   * moved to their original inheritance locations. If the destination group name is null,
   * the groups are all removed and there is no access inheritance to this resource.
   * Returns the updated array of top-level groups. These returned groups should be saved
   * to update the group inheritance in the database.
   *
   * For all passed-in groups, their .memberGroups will be reset. For
   * the basic roles (owner | editor | viewer), these will get updated
   * to include inheritedGroups, with roles reduced to dest when dest
   * is given. All of the basic roles must be present among
   * groups. Any non-basic roles present among inheritedGroups will be
   * ignored.
   *
   * Does not modify inheritedGroups.
   */
  public moveInheritedGroups(
    groups: NonGuestGroup[], inheritedGroups: Group[], dest?: roles.BasicRole|null
  ): void {
    // Limit scope to those inheritedGroups that have basic roles (viewers, editors, owners).
    inheritedGroups = inheritedGroups.filter(group => roles.isBasicRole(group.name));

    // NOTE that the special names constant is ordered from least to most permissive.
    const reverseDefaultNames = this.defaultBasicGroupNames.reverse();

    // The destination must be a reserved inheritance group or null.
    if (dest && !reverseDefaultNames.includes(dest)) {
      throw new Error('moveInheritedGroups called with invalid destination name');
    }

    // Mapping from group names to top-level groups
    const topGroups: {[groupName: string]: NonGuestGroup} = {};
    groups.forEach(grp => {
      // Note that this has a side effect of initializing the memberGroups arrays.
      grp.memberGroups = [];
      topGroups[grp.name] = grp;
    });

    // The destFunc maps from an inherited group to its required top-level group name.
    const destFunc = (inherited: Group) =>
      dest === null ? null : reverseDefaultNames.find(sp => sp === inherited.name || sp === dest);

    // Place inherited groups (this has the side-effect of updating member groups)
    inheritedGroups.forEach(grp => {
      if (!roles.isBasicRole(grp.name)) {
        // We filtered out such groups at the start of this method, but just in case...
        throw new Error(`${grp.name} is not an inheritable group`);
      }
      const moveTo = destFunc(grp);
      if (moveTo) {
        topGroups[moveTo].memberGroups.push(grp);
      }
    });
  }

  /**
   * Update the set of users in a group.  TypeORM's .save() method appears to be
   * unreliable for a ManyToMany relation with a table with a multi-column primary
   * key, so we make the update using explicit deletes and inserts.
   */
  public async setGroupUsers(manager: EntityManager, groupId: number, usersBefore: User[],
                               usersAfter: User[]) {
    const userIdsBefore = new Set(usersBefore.map(u => u.id));
    const userIdsAfter = new Set(usersAfter.map(u => u.id));
    const toDelete = [...userIdsBefore].filter(id => !userIdsAfter.has(id));
    const toAdd = [...userIdsAfter].filter(id => !userIdsBefore.has(id));
    if (toDelete.length > 0) {
      await manager.createQueryBuilder()
        .delete()
        .from('group_users')
        .whereInIds(toDelete.map(id => ({user_id: id, group_id: groupId})))
        .execute();
    }
    if (toAdd.length > 0) {
      await manager.createQueryBuilder()
        .insert()
        // Since we are adding new records in group_users, we may get a duplicate key error if two documents
        // are added at the same time (even in transaction, since we are not blocking the whole table).
        .orIgnore()
        .into('group_users')
        .values(toAdd.map(id => ({user_id: id, group_id: groupId})))
        .execute();
    }
  }

  /**
   * Returns a name to group mapping for the standard groups. Useful when adding a new child
   * entity. Finds and includes the correct parent groups as member groups.
   */
  public createGroups(inherit?: Organization|Workspace, ownerId?: number): {[name: string]: Group} {
    const groupMap: {[name: string]: Group} = {};
    this.defaultGroups.forEach(groupProps => {
      if (!groupProps.orgOnly || !inherit) {
        // Skip this group if it's an org only group and the resource inherits from a parent.
        const group = Group.create({
          name: groupProps.name,
          type: Group.ROLE_TYPE,
        });
        if (inherit) {
          this.setInheritance(group, inherit);
        }
        groupMap[groupProps.name] = group;
      }
    });
    // Add the owner explicitly to the owner group.
    if (ownerId) {
      const ownerGroup = groupMap[roles.OWNER];
      const user = new User();
      user.id = ownerId;
      ownerGroup.memberUsers = [user];
    }
    return groupMap;
  }

  // Sets the given group to inherit the groups in the given parent resource.
  public setInheritance(group: Group, parent: Organization|Workspace) {
    // Add the parent groups to the group
    const groupProps = this.defaultGroups.find(special => special.name === group.name);
    if (!groupProps) {
      throw new Error(`Non-standard group passed to _addInheritance: ${group.name}`);
    }
    if (groupProps.nestParent) {
      const parentGroups = (parent.aclRules as AclRule[]).map((_aclRule: AclRule) => _aclRule.group);
      const inheritGroup = parentGroups.find((_parentGroup: Group) => _parentGroup.name === group.name);
      if (!inheritGroup) {
        throw new Error(`Special group ${group.name} not found in ${parent.name} for inheritance`);
      }
      group.memberGroups = [inheritGroup];
    }
  }

  // Returns the most permissive default role that does not have more permissions than the passed
  // in argument.
  public getRoleFromPermissions(permissions: number): roles.Role|null {
    permissions &= ~Permissions.PUBLIC; // tslint:disable-line:no-bitwise
    const group = this.defaultBasicGroups.find(grp =>
      (permissions & grp.permissions) === grp.permissions); // tslint:disable-line:no-bitwise
    return group ? group.name : null;
  }

  // Returns the maxInheritedRole group name set on a resource.
  // The resource's aclRules, groups, and memberGroups must be populated.
  public getMaxInheritedRole(res: Workspace|Document): roles.BasicRole|null {
    const groups = (res.aclRules as AclRule[]).map((_aclRule: AclRule) => _aclRule.group);
    let maxInheritedRole: roles.NonGuestRole|null = null;
    for (const name of this.defaultBasicGroupNames) {
      const group = groups.find(_grp => _grp.name === name);
      if (!group) {
        throw new Error(`Error in _getMaxInheritedRole: group ${name} not found in ${res.name}`);
      }
      if (group.memberGroups.length > 0) {
        maxInheritedRole = name;
        break;
      }
    }
    return roles.getEffectiveRole(maxInheritedRole);
  }

  public async createGroup(groupDescriptor: GroupWithMembersDescriptor, optManager?: EntityManager) {
    return await this._runInTransaction(optManager, async (manager) => {
      const group = Group.create({
        type: groupDescriptor.type,
        name: groupDescriptor.name,
        memberUsers: await this._usersManager.getUsersByIdsStrict(groupDescriptor.memberUsers ?? [], manager),
        memberGroups: await this._getGroupsByIdsStrict(groupDescriptor.memberGroups ?? [], manager),
      });
      return await manager.save(group);
    });
  }

  public async overwriteGroup(
    id: number, groupDescriptor: GroupWithMembersDescriptor, optManager?: EntityManager
  ) {
    return await this._runInTransaction(optManager, async (manager) => {
      const existingGroup = await this.getGroupWithMembersById(id, manager);
      if (!existingGroup) {
        throw new ApiError(`Group with id ${id} not found`, 404);
      }
      const updatedGroup = Group.create({
        id,
        type: groupDescriptor.type,
        name: groupDescriptor.name,
        memberUsers: await this._usersManager.getUsersByIdsStrict(groupDescriptor.memberUsers ?? [], manager),
        memberGroups: await this._getGroupsByIdsStrict(groupDescriptor.memberGroups ?? [], manager),
      });
      return await manager.save(updatedGroup);
    });
  }

  public async deleteGroup(id: number, optManager?: EntityManager) {
    return await this._runInTransaction(optManager, async (manager) => {
      const group = await manager.findOne(Group, { where: { id } });
      if (!group) {
        throw new ApiError(`Group with id ${id} not found`, 404);
      }
      await manager.createQueryBuilder()
        .delete()
        .from('group_groups')
        .where('subgroup_id = :id', { id })
        .execute();
      await manager.remove(group);
    });
  }

  public getGroupsWithMembers(mamager?: EntityManager): Promise<Group[]> {
    return this._runInTransaction(mamager, async (manager: EntityManager) => {
      return this._getGroupsQueryBuilder(manager)
        .getMany();
    });
  }

  public getGroupsWithMembersByType(type: GroupTypes, mamager?: EntityManager): Promise<Group[]> {
    return this._runInTransaction(mamager, async (manager: EntityManager) => {
      return this._getGroupsQueryBuilder(manager)
        .where('groups.type = :type', {type})
        .getMany();
    });
  }

  public async getGroupWithMembersById(groupId: number, optManager?: EntityManager): Promise<Group|null> {
    return await this._runInTransaction(optManager, async (manager) => {
      return await this._getGroupsQueryBuilder(manager)
        .andWhere('groups.id = :groupId', {groupId})
        .getOne();
    });
  }

  /**
   * Returns a Promise for an array of User entites for the given userIds.
   */
  private async _getGroupsByIds(groupIds: number[], optManager?: EntityManager): Promise<Group[]> {
    if (groupIds.length === 0) {
      return [];
    }
    return await this._runInTransaction(optManager, async (manager) => {
      const queryBuilder = this._getGroupsQueryBuilder(manager)
        .where('groups.id IN (:...groupIds)', {groupIds});
      return await queryBuilder.getMany();
    });
  }

  private async _getGroupsByIdsStrict(groupIds: number[], optManager?: EntityManager): Promise<Group[]> {
    const groups = await this._getGroupsByIds(groupIds, optManager);
    if (groups.length !== groupIds.length) {
      const foundGroupIds = new Set(groups.map(group => group.id));
      const missingGroupIds = groupIds.filter(id => !foundGroupIds.has(id));
      throw new ApiError('Groups not found: ' + missingGroupIds.join(', '), 404);
    }
    return groups;
  }

  private _getGroupsQueryBuilder(manager: EntityManager) {
      return manager.createQueryBuilder()
        .select('groups')
        .addSelect('groups.type')
        .addSelect('memberGroups.type')
        .from(Group, 'groups')
        .leftJoinAndSelect('groups.memberUsers', 'memberUsers')
        .leftJoinAndSelect('groups.memberGroups', 'memberGroups');
  }
}
