import { Group } from 'app/gen-server/entity/Group';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { BaseController } from 'app/server/lib/scim/v2/BaseController';
import { SCIMMYRoleResource } from 'app/server/lib/scim/v2/roles/SCIMMYRoleResource';
import { SCIMMYRoleSchema } from 'app/server/lib/scim/v2/roles/SCIMMYRoleSchema';
import { RequestContext } from 'app/server/lib/scim/v2/ScimTypes';
import { toRoleDescriptor, toSCIMMYRole } from 'app/server/lib/scim/v2/ScimUtils';

import SCIMMY from 'scimmy';

class ScimRoleController extends BaseController {
  public constructor(
    dbManager: HomeDBManager,
    checkAccess: (context: RequestContext) => void,
  ) {
    super(dbManager, checkAccess);
    this.invalidIdError = 'Invalid passed role ID';
  }

  /**
   * Gets a single group with the passed ID.
   *
   * @param resource The SCIMMY resource of the group to get
   * @param context The request context
   */
  public async getSingleRole(resource: SCIMMYRoleResource, context: RequestContext): Promise<SCIMMYRoleSchema> {
    return this.runAndHandleErrors(context, async () => {
      const id = this.getIdFromResource(resource);
      const role = await this.dbManager.getGroupWithMembersById(id, { aclRule: true });
      if (!role || role.type !== Group.ROLE_TYPE) {
        throw new SCIMMY.Types.Error(404, null!, `Role with ID ${id} not found`);
      }
      return toSCIMMYRole(role);
    });
  }

  /**
   * Gets all groups.
   * @param resource The SCIMMY resource with the filters to apply on the results
   * @param context The request context
   * @returns All groups
   */
  public async getRoles(resource: SCIMMYRoleResource, context: RequestContext): Promise<SCIMMYRoleSchema[]> {
    return this.runAndHandleErrors(context, async () => {
      const scimmyGroup = (await this.dbManager.getGroupsWithMembersByType(Group.ROLE_TYPE, { aclRule: true }))
        .map(role => toSCIMMYRole(role));
      return this.maybeApplyFilter(scimmyGroup, resource.filter);
    });
  }

  /**
   * Overwrites a group with the passed data.
   *
   * @param resource The SCIMMY role resource to overwrite
   * @param data The data to overwrite the group with
   * @param context The request context
   */
  public async overwriteRole(
    resource: SCIMMYRoleResource, data: SCIMMYRoleSchema, context: RequestContext,
  ): Promise<SCIMMYRoleSchema> {
    return this.runAndHandleErrors(context, async () => {
      const id = this.getIdFromResource(resource);
      const groupDescriptor = toRoleDescriptor(data);
      const role = await this.dbManager.overwriteRoleGroup(id, groupDescriptor);
      return toSCIMMYRole(role);
    });
  }
}

export function getScimRoleConfig(
  dbManager: HomeDBManager, checkAccess: (context: RequestContext) => void,
) {
  const controller = new ScimRoleController(dbManager, checkAccess);
  return {
    egress: async (resource: SCIMMYRoleResource, context: RequestContext) => {
      if (resource.id) {
        return await controller.getSingleRole(resource, context);
      }
      return await controller.getRoles(resource, context);
    },
    ingress: async (resource: SCIMMYRoleResource, data: SCIMMYRoleSchema, context: RequestContext) => {
      if (resource.id) {
        return await controller.overwriteRole(resource, data, context);
      }
      throw new SCIMMY.Types.Error(501, null!, 'Cannot create Roles.');
    },
    degress: async () => {
      throw new SCIMMY.Types.Error(501, null!, 'Cannot delete roles');
    },
  };
}
