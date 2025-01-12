import { Group } from 'app/gen-server/entity/Group';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { BaseController } from 'app/server/lib/scim/v2/BaseController';
import { RequestContext } from 'app/server/lib/scim/v2/ScimTypes';
import { toSCIMMYGroup } from 'app/server/lib/scim/v2/ScimUtils';

import SCIMMY from 'scimmy';

class ScimGroupController extends BaseController {
  /**
   * Gets a single group with the passed ID.
   *
   * @param resource The SCIMMY group resource performing the operation
   * @param context The request context
   */
  public async getSingleGroup(resource: any, context: RequestContext) {
    return this.runAndHandleErrors(context, async () => {
      const id = ScimGroupController.getIdFromResource(resource);
      const group = await this.dbManager.getGroupWithMembersById(id);
      if (!group || group.type !== Group.RESOURCE_USERS_TYPE) {
        throw new SCIMMY.Types.Error(404, null!, `Group with ID ${id} not found`);
      }
      return toSCIMMYGroup(group);
    });
  }

  /**
   * Gets all groups.
   * @param resource The SCIMMY group resource performing the operation
   * @param context The request context
   * @returns All groups
   */
  public async getGroups(resource: any, context: RequestContext) {
    return this.runAndHandleErrors(context, async () => {
      const { filter } = resource;
      const scimmyGroup = (await this.dbManager.getGroupsWithMembersByType(Group.RESOURCE_USERS_TYPE))
        .map(group => toSCIMMYGroup(group));
      return filter ? filter.match(scimmyGroup) : scimmyGroup;
    });
  }
}

export const getScimGroupConfig = (
  dbManager: HomeDBManager, checkAccess: (context: RequestContext) => void
) => {
  const controller = new ScimGroupController(dbManager, checkAccess);

  return {
    egress: async (resource: any, context: RequestContext) => {
      if (resource.id) {
        return await controller.getSingleGroup(resource, context);
      }
      return await controller.getGroups(resource, context);
    },
  };
};
