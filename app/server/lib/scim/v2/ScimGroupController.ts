import { Group } from "app/gen-server/entity/Group";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { BaseController } from "app/server/lib/scim/v2/BaseController";
import { RequestContext } from "app/server/lib/scim/v2/ScimTypes";
import { toGroupDescriptor, toSCIMMYGroup } from "app/server/lib/scim/v2/ScimUtils";

import SCIMMY from "scimmy";

type GroupSchema = SCIMMY.Schemas.Group;
type GroupResource = SCIMMY.Resources.Group;

class ScimGroupController extends BaseController {
  public constructor(
    dbManager: HomeDBManager,
    checkAccess: (context: RequestContext) => void,
  ) {
    super(dbManager, checkAccess);
    this.invalidIdError = "Invalid passed group ID";
  }

  /**
   * Gets a single group with the passed ID.
   *
   * @param resource The SCIMMY group resource performing the operation
   * @param context The request context
   */
  public async getSingleGroup(resource: GroupResource, context: RequestContext): Promise<GroupSchema> {
    return this.runAndHandleErrors(context, async () => {
      const id = this.getIdFromResource(resource);
      const group = await this.dbManager.getGroupWithMembersById(id);
      if (!group || group.type !== Group.TEAM_TYPE) {
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
  public async getGroups(resource: GroupResource, context: RequestContext): Promise<GroupSchema[]> {
    return this.runAndHandleErrors(context, async () => {
      const scimmyGroup = (await this.dbManager.getGroupsWithMembersByType(Group.TEAM_TYPE))
        .map(group => toSCIMMYGroup(group));
      return this.maybeApplyFilter(scimmyGroup, resource.filter);
    });
  }

  /**
   * Creates a new group with the passed data.
   *
   * @param data The data to create the group with
   * @param context The request context
   */
  public async createGroup(data: GroupSchema, context: RequestContext): Promise<GroupSchema> {
    return this.runAndHandleErrors(context, async () => {
      const groupDescriptor = toGroupDescriptor(data);
      const group = await this.dbManager.createGroup(groupDescriptor);
      return toSCIMMYGroup(group);
    });
  }

  /**
   * Overwrites a group with the passed data.
   *
   * @param resource The SCIMMY group resource performing the operation
   * @param data The data to overwrite the group with
   * @param context The request context
   */
  public async overwriteGroup(
    resource: GroupResource, data: GroupSchema, context: RequestContext,
  ): Promise<GroupSchema> {
    return this.runAndHandleErrors(context, async () => {
      const id = this.getIdFromResource(resource);
      const groupDescriptor = toGroupDescriptor(data);
      const group = await this.dbManager.overwriteTeamGroup(id, groupDescriptor);
      return toSCIMMYGroup(group);
    });
  }

  /**
   * Deletes a group with the passed ID.
   *
   * @param resource The SCIMMY group resource performing the operation
   * @param context The request context
   *
   */
  public async deleteGroup(resource: GroupResource, context: RequestContext): Promise<void> {
    return this.runAndHandleErrors(context, async () => {
      const id = this.getIdFromResource(resource);
      await this.dbManager.deleteGroup(id, Group.TEAM_TYPE);
    });
  }
}

export function getScimGroupConfig(
  dbManager: HomeDBManager, checkAccess: (context: RequestContext) => void,
) {
  const controller = new ScimGroupController(dbManager, checkAccess);

  return {
    egress: async (resource: GroupResource, context: RequestContext): Promise<GroupSchema | GroupSchema[]> => {
      if (resource.id) {
        return await controller.getSingleGroup(resource, context);
      }
      return await controller.getGroups(resource, context);
    },
    ingress: async (resource: GroupResource, data: GroupSchema, context: RequestContext): Promise<GroupSchema> => {
      if (resource.id) {
        return await controller.overwriteGroup(resource, data, context);
      }
      return await controller.createGroup(data, context);
    },
    degress: async (resource: GroupResource, context: RequestContext): Promise<void> => {
      return await controller.deleteGroup(resource, context);
    },
  };
}
