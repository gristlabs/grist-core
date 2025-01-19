import { ApiError } from 'app/common/ApiError';
import { Group } from 'app/gen-server/entity/Group';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { BaseController } from 'app/server/lib/scim/v2/BaseController';
import { RequestContext } from 'app/server/lib/scim/v2/ScimTypes';
import { toGroupDescriptor, toSCIMMYRole } from 'app/server/lib/scim/v2/ScimUtils';

import SCIMMY from 'scimmy';

const { Attribute, SchemaDefinition } = SCIMMY.Types;


class ScimRoleController extends BaseController {
  public constructor(
    dbManager: HomeDBManager,
    checkAccess: (context: RequestContext) => void
  ) {
    super(dbManager, checkAccess, 'Invalid passed role ID');
  }

  /**
   * Gets a single group with the passed ID.
   *
   * @param resource The SCIMMY group resource performing the operation
   * @param context The request context
   */
  public async getSingleRole(resource: any, context: RequestContext) {
    return this.runAndHandleErrors(context, async () => {
      const id = this.getIdFromResource(resource);
      const group = await this.dbManager.getGroupWithMembersById(id, {aclRule: true});
      if (!group || group.type !== Group.ROLE_TYPE) {
        throw new SCIMMY.Types.Error(404, null!, `Group with ID ${id} not found`);
      }
      console.log(JSON.stringify(toSCIMMYRole(group), null, 4));
      return toSCIMMYRole(group);
    });
  }

  /**
   * Gets all groups.
   * @param resource The SCIMMY group resource performing the operation
   * @param context The request context
   * @returns All groups
   */
  public async getRoles(resource: any, context: RequestContext) {
    return this.runAndHandleErrors(context, async () => {
      const { filter } = resource;
      const scimmyGroup = (await this.dbManager.getGroupsWithMembersByType(Group.ROLE_TYPE, {aclRule: true}))
        .map(group => toSCIMMYRole(group));
      return filter ? filter.match(scimmyGroup) : scimmyGroup;
    });
  }

  /**
   * Overwrites a group with the passed data.
   *
   * @param resource The SCIMMY group resource performing the operation
   * @param data The data to overwrite the group with
   * @param context The request context
   */
  public async overwriteRole(resource: any, data: any, context: RequestContext) {
    return this.runAndHandleErrors(context, async () => {
      const id = this.getIdFromResource(resource);
      const groupDescriptor = toGroupDescriptor(data);
      const group = await this.dbManager.overwriteGroup(id, groupDescriptor, Group.ROLE_TYPE);
      return toSCIMMYRole(group);
    });
  }
}

export const getScimRoleConfig = (
  dbManager: HomeDBManager, checkAccess: (context: RequestContext) => void
) => {
  const controller = new ScimRoleController(dbManager, checkAccess);
  return {
    egress: async (resource: any, context: RequestContext) => {
      if (resource.id) {
        return await controller.getSingleRole(resource, context);
      }
      return await controller.getRoles(resource, context);
    },
    ingress: async (resource: any, data: any, context: RequestContext) => {
      if (resource.id) {
        return await controller.overwriteRole(resource, data, context);
      }
      throw new ApiError('Cannot create roles', 501);
    }
  };
};

export class SCIMMYRoleGroupSchema extends SCIMMY.Types.Schema {
  public static get definition() {
    return this._definition;
  }

  private static _definition = (function () {
    // Clone the Groups schema definition
    const attrMembers = SCIMMY.Schemas.Group.definition.attribute('members');
    return new SchemaDefinition(
      "Role", "urn:ietf:params:scim:schemas:Grist:Role", "Role in Grist (Owner)", [
        new Attribute("string", "role", {/*canonicalValues: ['owner', 'editor', 'viewer', 'member', 'guest'], */
          mutable: false}),
        attrMembers as SCIMMY.Types.Attribute,
        new Attribute("string", "docId", {required: false, description: "The docId associated to this role.",
          mutable: false}),
        new Attribute("integer", "workspaceId", {required: false, description: "The workspaceId for this role",
          mutable: false}),
        new Attribute("integer", "orgId", {required: false, description: "The orgId for this role",
          mutable: false})
      ]);
  })();

  constructor(resource: object, direction = "both", basepath?: string, filters?: SCIMMY.Types.Filter) {
    super(resource, direction);
    Object.assign(this, SCIMMYRoleGroupSchema._definition.coerce(resource, direction, basepath, filters));
  }
}

export class SCIMMYRoleGroupResource extends SCIMMY.Types.Resource {
  // NB: must be a getter, cannot override this property with readonly attribute
  public static get endpoint() {
    return '/Roles';
  }

  public static get schema() {
    return SCIMMYRoleGroupSchema;
  }

  // Required by SCIMMY. This seems to be a method with the same logic for every Resouces:
  // https://github.com/scimmyjs/scimmy/blob/8b4333edc566a04cd5390ee4aa3272d021610d77/src/lib/resources/user.js#L22-L27
  public static basepath(path?: string) {
    const { endpoint } = SCIMMYRoleGroupResource;
    if (path === undefined) {
      return SCIMMYRoleGroupResource._basepath;
    } else {
      SCIMMYRoleGroupResource._basepath = (path.endsWith(endpoint) ? path : `${path}${endpoint}`);
    }

    return SCIMMYRoleGroupResource;
  }

  /** @implements {SCIMMY.Types.Resource.ingress<typeof SCIMMY.Resources.User, SCIMMY.Schemas.User>} */
  public static ingress(handler: any) {
      this._ingress = handler;
      return this;
  }

  /** @implements {SCIMMY.Types.Resource.egress<typeof SCIMMY.Resources.User, SCIMMY.Schemas.User>} */
  public static egress(handler: any) {
    this._egress = handler;
    return this;
  }

  /** @implements {SCIMMY.Types.Resource.degress<typeof SCIMMY.Resources.User>} */
  // public static degress(handler: any) {
  //   this._degress = handler;
  //   return this;
  // }

  private static _basepath: string;

  /** @private */
  private static _ingress = (...args: any[]): Promise<any> => {
    throw new SCIMMY.Types.Error(501, null!, "Method 'ingress' not implemented by resource 'User'");
  };

  /** @private */
  private static _egress = (...args: any[]): Promise<any> => {
    throw new SCIMMY.Types.Error(501, null!, `Method 'egress' not implemented by resource '${this.name}'`);
  };

  /** @private */
  // private static _degress = (...args: any[]): Promise<any> => {
  //   throw new SCIMMY.Types.Error(501, null!, `Method 'degress' not implemented by resource '${this.name}'`);
  // };

  /**
   * Instantiate a new SCIM User resource and parse any supplied parameters
   * @internal
   */
  constructor(...params: any[]) {
    super(...params);
  }

  /**
    * @implements {SCIMMY.Types.Resource#read}
    * @example
    * // Retrieve group with ID "1234"
    * await new SCIMMY.Resources.Group("1234").read();
    * @example
    * // Retrieve groups with a group name starting with "A"
    * await new SCIMMY.Resources.Group({filter: 'displayName sw "A"'}).read();
    */
  public async read(ctx: any) {
    try {
      const source = await SCIMMYRoleGroupResource._egress(this, ctx);
      const target = (this.id ? [source].flat().shift() : source);

      // If not looking for a specific resource, make sure egress returned an array
      if (!this.id && Array.isArray(target)) {
        return new SCIMMY.Messages.ListResponse(target
          .map(u => new SCIMMYRoleGroupSchema(
            u, "out", SCIMMYRoleGroupResource.endpoint, this.attributes)
          ), this.constraints);
      }
      // For specific resources, make sure egress returned an object
      else if (target instanceof Object) {
        return new SCIMMYRoleGroupSchema(target, "out", SCIMMYRoleGroupResource.endpoint, this.attributes);
      }
      // Otherwise, egress has not been implemented correctly
      else {
        throw new SCIMMY.Types.Error(
          500, null!, `Unexpected ${target === undefined ? "empty" : "invalid"} value returned by egress handler`
        );
      }
    } catch (ex) {
      if (ex instanceof SCIMMY.Types.Error) {
        throw ex;
      }
      else if (ex instanceof TypeError) {
        throw new SCIMMY.Types.Error(400, "invalidValue", ex.message);
      }
      else {
        throw new SCIMMY.Types.Error(404, null!, `Resource ${this.id} not found`);
      }
    }
  }

  /**
     * @implements {SCIMMY.Types.Resource#write}
     * @example
     * // Create a new group with displayName "A Group"
     * await new SCIMMY.Resources.Group().write({displayName: "A Group"});
     * @example
     * // Set members attribute for group with ID "1234"
     * await new SCIMMY.Resources.Group("1234").write({members: [{value: "5678"}]});
     */
  public async write(instance: any, ctx: any) {
    if (instance === undefined) {
      throw new SCIMMY.Types.Error(
        400, "invalidSyntax", `Missing request body payload for ${this.id ? "PUT" : "POST"} operation`
      );
    }
    if (Object(instance) !== instance || Array.isArray(instance)) {
      throw new SCIMMY.Types.Error(
        400, "invalidSyntax",
        `Operation ${this.id ? "PUT" : "POST"} expected request body payload to be single complex value`
      );
    }

    try {
      const target = await SCIMMYRoleGroupResource._ingress(this, new SCIMMYRoleGroupSchema(instance, "in"), ctx);

      // Make sure ingress returned an object
      if (target instanceof Object) {
        return new SCIMMYRoleGroupResource(target, "out", SCIMMYRoleGroupResource.endpoint, this.attributes);
      }
        // Otherwise, ingress has not been implemented correctly
      else {
        throw new SCIMMY.Types.Error(500, null!,
          `Unexpected ${target === undefined ? "empty" : "invalid"} value returned by ingress handler`
        );
      }
    } catch (ex) {
      if (ex instanceof SCIMMY.Types.Error) {
        throw ex;
      }
      else if (ex instanceof TypeError) {
        throw new SCIMMY.Types.Error(400, "invalidValue", ex.message);
      }
      else {
        throw new SCIMMY.Types.Error(404, null!, `Resource ${this.id} not found`);
      }
    }
  }

  /**
   * @implements {SCIMMY.Types.Resource#patch}
   * @see SCIMMY.Messages.PatchOp
   */
  public async patch(message: any, ctx: any) {
    if (!this.id) {
      throw new SCIMMY.Types.Error(404, null!, "PATCH operation must target a specific resource");
    }
    if (message === undefined) {
      throw new SCIMMY.Types.Error(400, "invalidSyntax", "Missing message body from PatchOp request");
    }
    if (Object(message) !== message || Array.isArray(message)) {
      throw new SCIMMY.Types.Error(
        400, "invalidSyntax", "PatchOp request expected message body to be single complex value"
      );
    }

    return await new SCIMMY.Messages.PatchOp(message)
      .apply((await this.read(ctx)) as any, async (instance) => await this.write(instance, ctx))
      .then(instance => !instance ? undefined :
        new SCIMMYRoleGroupSchema(instance, "out", SCIMMYRoleGroupResource.endpoint, this.attributes));
  }

  // /**
  //  * @implements {SCIMMY.Types.Resource#dispose}
  //  * @example
  //  * // Delete user with ID "1234"
  //  * await new SCIMMY.Resources.User("1234").dispose();
  //  */
  // public async dispose(ctx: any) {
  //   if (!this.id) {
  //     throw new SCIMMY.Types.Error(
  //       404, null!, "DELETE operation must target a specific resource"
  //     );
  //   }
  //   try {
  //     await SCIMMYRoleGroupResource._degress(this, ctx);
  //   } catch (ex) {
  //     if (ex instanceof SCIMMY.Types.Error) {
  //       throw ex;
  //     }
  //     else if (ex instanceof TypeError) {
  //       throw new SCIMMY.Types.Error(500, null!, ex.message);
  //     }
  //     else {
  //       throw new SCIMMY.Types.Error(404, null!, `Resource ${this.id} not found`);
  //     }
  //   }
  // }
}

