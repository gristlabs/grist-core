import { SCIMMYRoleSchema } from 'app/server/lib/scim/v2/roles/SCIMMYRoleSchema';

import SCIMMY from 'scimmy';

/**
 * SCIMMY Role Resource. Heavily inspired by SCIMMY Group Resource.
 * https://github.com/scimmyjs/scimmy/blob/8b4333edc566a04cd5390ee4aa3272d021610d77/src/lib/resources/group.js
 */
export class SCIMMYRoleResource extends SCIMMY.Types.Resource<SCIMMYRoleSchema> {
  // NB: must be a getter, cannot override this property with readonly attribute
  public static get endpoint() {
    return '/Roles';
  }

  public static get schema() {
    return SCIMMYRoleSchema;
  }

  public static basepath(): string;
  public static basepath(path: string): typeof SCIMMYRoleResource;
  // Required by SCIMMY. This seems to be a method with the same logic for every Resouces:
  // https://github.com/scimmyjs/scimmy/blob/8b4333edc566a04cd5390ee4aa3272d021610d77/src/lib/resources/group.js#L22-L27
  public static basepath(path?: string) {
    if (path === undefined) {
      return SCIMMYRoleResource._basepath;
    }
    else {
      SCIMMYRoleResource._basepath = (path.endsWith(SCIMMYRoleResource.endpoint) ?
        path :
        `${path}${SCIMMYRoleResource.endpoint}`);
    }

    return SCIMMYRoleResource;
  }

  /** @implements {SCIMMY.Types.Resource.ingress<typeof SCIMMY.Resources.User, SCIMMY.Schemas.User>} */
  public static ingress(handler: SCIMMY.Types.Resource.IngressHandler<any, any>) {
    this._ingress = handler;
    return this;
  }

  /** @implements {SCIMMY.Types.Resource.egress<typeof SCIMMY.Resources.User, SCIMMY.Schemas.User>} */
  public static egress(handler: SCIMMY.Types.Resource.EgressHandler<any, SCIMMYRoleSchema>) {
    this._egress = handler;
    return this;
  }

  /** @implements {SCIMMY.Types.Resource.degress<typeof SCIMMY.Resources.User>} */
  public static degress(handler: SCIMMY.Types.Resource.DegressHandler<any>) {
    this._degress = handler;
    return this;
  }

  private static _basepath: string;

  /** @private */
  private static _ingress: SCIMMY.Types.Resource.IngressHandler<SCIMMYRoleResource, SCIMMYRoleSchema> = () => {
    throw new SCIMMY.Types.Error(501, null!, `Method 'ingress' not implemented by resource '${this.name}'`);
  };

  /** @private */
  private static _egress: SCIMMY.Types.Resource.EgressHandler<SCIMMYRoleResource, SCIMMYRoleSchema> = () => {
    throw new SCIMMY.Types.Error(501, null!, `Method 'egress' not implemented by resource '${this.name}'`);
  };

  /** @private */
  private static _degress: SCIMMY.Types.Resource.DegressHandler<SCIMMYRoleResource> = () => {
    throw new SCIMMY.Types.Error(501, null!, `Method 'degress' not implemented by resource '${this.name}'`);
  };

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
      const source = await SCIMMYRoleResource._egress(this, ctx);
      const target = (this.id ? [source].flat().shift() : source);

      // If not looking for a specific resource, make sure egress returned an array
      if (!this.id && Array.isArray(target)) {
        return new SCIMMY.Messages.ListResponse(target
          .map(u => new SCIMMYRoleSchema(
            u, "out", SCIMMYRoleResource.basepath(), this.attributes),
          ), this.constraints);
      }
      // For specific resources, make sure egress returned an object
      else if (target instanceof Object) {
        return new SCIMMYRoleSchema(target, "out", SCIMMYRoleResource.basepath(), this.attributes);
      }
      // Otherwise, egress has not been implemented correctly
      else {
        throw new SCIMMY.Types.Error(
          500, null!, `Unexpected ${target === undefined ? "empty" : "invalid"} value returned by egress handler`,
        );
      }
    }
    catch (ex) {
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
  public async write(instance: SCIMMYRoleSchema, ctx: any) {
    if (instance === undefined) {
      throw new SCIMMY.Types.Error(
        400, "invalidSyntax", `Missing request body payload for ${this.id ? "PUT" : "POST"} operation`,
      );
    }
    if (Object(instance) !== instance || Array.isArray(instance)) {
      throw new SCIMMY.Types.Error(
        400, "invalidSyntax",
        `Operation ${this.id ? "PUT" : "POST"} expected request body payload to be single complex value`,
      );
    }

    try {
      const target = await SCIMMYRoleResource._ingress(this, new SCIMMYRoleSchema(instance, "in"), ctx);

      // Make sure ingress returned an object
      if (target instanceof Object) {
        return new SCIMMYRoleSchema(target, "out", SCIMMYRoleResource.basepath(), this.attributes);
      }
      // Otherwise, ingress has not been implemented correctly
      else {
        throw new SCIMMY.Types.Error(500, null!,
          `Unexpected ${target === undefined ? "empty" : "invalid"} value returned by ingress handler`,
        );
      }
    }
    catch (ex) {
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
        400, "invalidSyntax", "PatchOp request expected message body to be single complex value",
      );
    }

    return (await new SCIMMY.Messages.PatchOp(message)
      .apply((await this.read(ctx)) as SCIMMYRoleSchema, async instance => await this.write(instance, ctx))
      // NOTE: A bit odd, but the type suggest that we should have an instance of Schema,
      // but the upstream code suggests that it can be undefined
      .then(instance => !instance ? undefined :
        new SCIMMYRoleSchema(instance, "out", SCIMMYRoleResource.basepath(), this.attributes)))!;
  }

  /**
   * @implements {SCIMMY.Types.Resource#dispose}
   * @example
   * // Delete user with ID "1234"
   * await new SCIMMY.Resources.User("1234").dispose();
   */
  public async dispose(ctx: any) {
    if (!this.id) {
      throw new SCIMMY.Types.Error(
        404, null!, "DELETE operation must target a specific resource",
      );
    }
    try {
      await SCIMMYRoleResource._degress(this, ctx);
    }
    catch (ex) {
      if (ex instanceof SCIMMY.Types.Error) {
        throw ex;
      }
      else if (ex instanceof TypeError) {
        throw new SCIMMY.Types.Error(500, null!, ex.message);
      }
      else {
        throw new SCIMMY.Types.Error(404, null!, `Resource ${this.id} not found`);
      }
    }
  }
}
