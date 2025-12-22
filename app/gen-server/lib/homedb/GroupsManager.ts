import * as roles from "app/common/roles";
import { AclRule } from "app/gen-server/entity/AclRule";
import { Document } from "app/gen-server/entity/Document";
import { Group } from "app/gen-server/entity/Group";
import { GroupWithMembersDescriptor, NonGuestGroup,
  Resource, RoleGroupDescriptor, RunInTransaction } from "app/gen-server/lib/homedb/Interfaces";
import { Organization } from "app/gen-server/entity/Organization";
import { Permissions } from "app/gen-server/lib/Permissions";
import { User } from "app/gen-server/entity/User";
import { Workspace } from "app/gen-server/entity/Workspace";

import { EntityManager } from "typeorm";
import { UsersManager } from "app/gen-server/lib/homedb/UsersManager";
import { ApiError } from "app/common/ApiError";

export type GroupTypes = typeof Group.ROLE_TYPE | typeof Group.TEAM_TYPE;

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
  public static getMemberUserRoles<T extends roles.Role>(res: Resource, allowRoles: T[]): { [userId: string]: T } {
    // Map of userId to the strongest role for that user among res.aclRules, filtered by allowRoles.
    const userMap: { [userId: string]: T } = {};
    for (const aclRule of res.aclRules) {
      const role = aclRule.group.name as T;
      if (allowRoles.includes(role)) {
        for (const { id } of aclRule.group.memberUsers) {
          // If the user is already present in another group, use the more powerful role name.
          userMap[id] = userMap[id] ? roles.getStrongestRole(userMap[id], role) : role;
        }
      }
    }
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
    nestParent: true,
  }, {
    name: roles.EDITOR,
    permissions: Permissions.EDITOR,
    nestParent: true,
  }, {
    name: roles.VIEWER,
    permissions: Permissions.VIEW,
    nestParent: true,
  }, {
    name: roles.GUEST,
    permissions: Permissions.VIEW,
    nestParent: false,
  }, {
    name: roles.MEMBER,
    permissions: Permissions.VIEW,
    nestParent: false,
    orgOnly: true,
  }];

  public constructor(private _usersManager: UsersManager, private _runInTransaction: RunInTransaction) {}

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
    groups: NonGuestGroup[], inheritedGroups: Group[], dest?: roles.BasicRole | null,
  ): void {
    // Limit scope to those inheritedGroups that have basic roles (viewers, editors, owners).
    inheritedGroups = inheritedGroups.filter(group => roles.isBasicRole(group.name));

    // NOTE that the special names constant is ordered from least to most permissive.
    const reverseDefaultNames = this.defaultBasicGroupNames.reverse();

    // The destination must be a reserved inheritance group or null.
    if (dest && !reverseDefaultNames.includes(dest)) {
      throw new Error("moveInheritedGroups called with invalid destination name");
    }

    // Mapping from group names to top-level groups
    const topGroups: { [groupName: string]: NonGuestGroup } = {};
    groups.forEach((grp) => {
      // Note that this has a side effect of initializing the memberGroups arrays.
      grp.memberGroups = [];
      topGroups[grp.name] = grp;
    });

    // The destFunc maps from an inherited group to its required top-level group name.
    const destFunc = (inherited: Group) =>
      dest === null ? null : reverseDefaultNames.find(sp => sp === inherited.name || sp === dest);

    // Place inherited groups (this has the side-effect of updating member groups)
    inheritedGroups.forEach((grp) => {
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
        .from("group_users")
        .whereInIds(toDelete.map(id => ({ user_id: id, group_id: groupId })))
        .execute();
    }
    if (toAdd.length > 0) {
      await manager.createQueryBuilder()
        .insert()
        // Since we are adding new records in group_users, we may get a duplicate key error if two documents
        // are added at the same time (even in transaction, since we are not blocking the whole table).
        .orIgnore()
        .into("group_users")
        .values(toAdd.map(id => ({ user_id: id, group_id: groupId })))
        .execute();
    }
  }

  /**
   * Returns a name to group mapping for the standard groups. Useful when adding a new child
   * entity. Finds and includes the correct parent groups as member groups.
   */
  public createGroups(inherit?: Organization | Workspace, ownerId?: number): { [name: string]: Group } {
    const groupMap: { [name: string]: Group } = {};
    this.defaultGroups.forEach((groupProps) => {
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
  public setInheritance(group: Group, parent: Organization | Workspace) {
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
  public getRoleFromPermissions(permissions: number): roles.Role | null {
    permissions &= ~Permissions.PUBLIC;    const group = this.defaultBasicGroups.find(grp =>
      (permissions & grp.permissions) === grp.permissions);    return group ? group.name : null;
  }

  // Returns the maxInheritedRole group name set on a resource.
  // The resource's aclRules, groups, and memberGroups must be populated.
  public getMaxInheritedRole(res: Workspace | Document): roles.BasicRole | null {
    const groups = (res.aclRules as AclRule[]).map((_aclRule: AclRule) => _aclRule.group);
    let maxInheritedRole: roles.NonGuestRole | null = null;
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

  /**
   * Create a Group.
   * @param groupDescriptor - The descriptor for the group to be created.
   * @param optManager - Optional EntityManager to use for the transaction.
   * @returns The created Group.
   */
  public async createGroup(groupDescriptor: GroupWithMembersDescriptor, optManager?: EntityManager) {
    return await this._runInTransaction(optManager, async (manager) => {
      if (groupDescriptor.type === Group.TEAM_TYPE) {
        await this._throwIfTeamNameCollision(groupDescriptor.name, manager);
      }
      const group = Group.create({
        type: groupDescriptor.type,
        name: groupDescriptor.name,
        memberUsers: await this._usersManager.getUsersByIdsStrict(groupDescriptor.memberUsers ?? [], manager),
        memberGroups: await this._getGroupsByIdsStrict(groupDescriptor.memberGroups ?? [], manager),
      });
      return await manager.save(group);
    });
  }

  /**
   * Overwrite a Role Group.
   * @param id - The id of the Role Group to be overwritten.
   * @param groupDescriptor - The descriptor to overwrite the role with.
   * @param optManager - Optional EntityManager to use for the transaction.
   *
   * @returns The overwritten Role Group
   */
  public async overwriteRoleGroup(
    id: number, groupDescriptor: GroupWithMembersDescriptor, optManager?: EntityManager,
  ) {
    return await this._runInTransaction(optManager, async (manager) => {
      const existingGroup = await this.getGroupWithMembersById(id, {}, manager);
      if (!existingGroup || (existingGroup.type !== Group.ROLE_TYPE)) {
        throw new ApiError(`Role with id ${id} not found`, 404);
      }
      return await this._overwriteGroup(existingGroup, groupDescriptor, manager);
    });
  }

  /**
   * Overwrite a Team Group.
   * @param id - The id of the Team Group to be overwritten.
   * @param groupDescriptor - The descriptor to overwrite the role with.
   * @param optManager - Optional EntityManager to use for the transaction.
   *
   * @returns The overwritten Team Group
   */
  public async overwriteTeamGroup(
    id: number, groupDescriptor: GroupWithMembersDescriptor, optManager?: EntityManager,
  ) {
    return await this._runInTransaction(optManager, async (manager) => {
      const existingGroup = await this.getGroupWithMembersById(id, {}, manager);
      if (!existingGroup || (existingGroup.type !== Group.TEAM_TYPE)) {
        throw new ApiError(`Group with id ${id} not found`, 404);
      }
      await this._throwIfTeamNameCollision(groupDescriptor.name, manager, id);
      return await this._overwriteGroup(existingGroup, groupDescriptor, manager);
    });
  }

  /**
   * Delete a Group.
   *
   * @param id - The id of the Group to be deleted.
   * @param expectedType - The expected type of the Group to be deleted. If the type is specified,
   *                      the Group will only be deleted if it has the expected type.
   *                      If the type is not specified, the Group will be deleted regardless of its type.
   * @param optManager - Optional EntityManager to use for the transaction.
   */
  public async deleteGroup(id: number, expectedType?: GroupTypes, optManager?: EntityManager) {
    return await this._runInTransaction(optManager, async (manager) => {
      const group = await this.getGroupWithMembersById(id, {}, manager);
      if (!group || (expectedType && expectedType !== group.type)) {
        throw new ApiError(`Group with id ${id} not found`, 404);
      }
      await manager.createQueryBuilder()
        .delete()
        .from("group_groups")
        .where("subgroup_id = :id", { id })
        .execute();
      await manager.remove(group);
    });
  }

  /**
   * Get all the groups with their members.
   * @param optManager - Optional EntityManager to use for the transaction.
   */
  public getGroupsWithMembers(optManager?: EntityManager): Promise<Group[]> {
    return this._runInTransaction(optManager, async (manager: EntityManager) => {
      return this._getGroupsQueryBuilder(manager)
        .getMany();
    });
  }

  /**
   * Get all the groups with their members of the given type.
   *
   * @param type - The type of the groups to be fetched.
   * @param opts - Optional options to be used for the query.
   * @param opts.aclRule - Whether to include the aclRule in the query.
   * @param optManager - Optional EntityManager to use for the transaction.
   *
   * @returns A Promise for an array of Group entities.
   */
  public getGroupsWithMembersByType(
    type: GroupTypes, opts?: { aclRule?: boolean }, optManager?: EntityManager,
  ): Promise<Group[]> {
    return this._runInTransaction(optManager, async (manager: EntityManager) => {
      return this._getGroupsQueryBuilder(manager, opts)
        .where("groups.type = :type", { type })
        .getMany();
    });
  }

  /**
   * Get a Group with its members by id.
   *
   * @param id - The id of the Group to be fetched.
   * @param opts - Optional options to be used for the query.
   * @param opts.aclRule - Whether to include the aclRule in the query.
   * @param optManager - Optional EntityManager to use for the transaction.
   *
   * @returns A Promise for the Group entity.
   */
  public async getGroupWithMembersById(
    id: number, opts?: { aclRule?: boolean }, optManager?: EntityManager,
  ): Promise<Group | null> {
    return await this._runInTransaction(optManager, async (manager) => {
      return await this._getGroupsQueryBuilder(manager, opts)
        .andWhere("groups.id = :groupId", { groupId: id })
        .getOne();
    });
  }

  /**
   * Common method to overwrite groups of any type.
   * @param existing - The existing group to be overwritten.
   * @param groupDescriptor - The descriptor to overwrite the group with.
   * @param optManager - The EntityManager to use for the transaction.
   * @returns The overwritten Group.
   */
  private async _overwriteGroup(
    existing: Group, groupDescriptor: GroupWithMembersDescriptor, optManager: EntityManager,
  ) {
    if (existing.type !== groupDescriptor.type) {
      throw new ApiError("cannot change type of group", 400);
    }
    const updatedGroup = Group.create({
      id: existing.id,
      type: groupDescriptor.type,
      name: groupDescriptor.name,
      memberUsers: await this._usersManager.getUsersByIdsStrict(groupDescriptor.memberUsers ?? [], optManager),
      memberGroups: await this._getGroupsByIdsStrict(groupDescriptor.memberGroups ?? [], optManager),
    });
    return await optManager.save(updatedGroup);
  }

  /**
   * Returns a Promise for an array of Groups for the given groupIds.
   *
   * @param groupIds - The ids of the Groups to be fetched.
   * @param optManager - Optional EntityManager to use for the transaction.
   * @returns A Promise for an array of Group entities.
   */
  private async _getGroupsByIds(groupIds: number[], optManager?: EntityManager): Promise<Group[]> {
    if (groupIds.length === 0) {
      return [];
    }
    return await this._runInTransaction(optManager, async (manager) => {
      const queryBuilder = this._getGroupsQueryBuilder(manager)
        .where("groups.id IN (:...groupIds)", { groupIds });
      return await queryBuilder.getMany();
    });
  }

  /**
   * Returns a Promise for an array of Groups for the given groupIds.
   * Throws an ApiError if any of the groups are not found.
   *
   * @param groupIds - The ids of the Groups to be fetched.
   * @param optManager - Optional EntityManager to use for the transaction.
   */
  private async _getGroupsByIdsStrict(groupIds: number[], optManager?: EntityManager): Promise<Group[]> {
    const groups = await this._getGroupsByIds(groupIds, optManager);
    if (groups.length !== groupIds.length) {
      const foundGroupIds = new Set(groups.map(group => group.id));
      const missingGroupIds = groupIds.filter(id => !foundGroupIds.has(id));
      throw new ApiError("Groups not found: " + missingGroupIds.join(", "), 404);
    }
    return groups;
  }

  /**
   * Returns a QueryBuilder for fetching groups with their members.
   * @param optManager - The EntityManager to use for the query.
   * @param opts - Optional options to be used for the query.
   * @param opts.aclRule - Whether to include the aclRule in the query.
   * @returns The QueryBuilder for fetching groups with their members.
   */
  private _getGroupsQueryBuilder(optManager: EntityManager, opts: { aclRule?: boolean } = {}) {
    let queryBuilder = optManager.createQueryBuilder()
      .select("groups")
      .addSelect("groups.type")
      .addSelect("memberGroups.type")
      .from(Group, "groups")
      .leftJoinAndSelect("groups.memberUsers", "memberUsers")
      .leftJoinAndSelect("groups.memberGroups", "memberGroups");
    if (opts.aclRule) {
      queryBuilder = queryBuilder
        .leftJoinAndSelect("groups.aclRule", "aclRule");
    }
    return queryBuilder;
  }

  private async _throwIfTeamNameCollision(name: string, manager: EntityManager, existingId?: number) {
    const query = this._getGroupsQueryBuilder(manager)
      .where("groups.name = :name", { name })
      .andWhere("groups.type = :type", { type: Group.TEAM_TYPE });
    if (existingId !== undefined) {
      query.andWhere("groups.id != :id", { id: existingId });
    }
    const group = await query.getOne();
    if (group) {
      throw new ApiError(`Group with name "${name}" already exists`, 409);
    }
  }
}
