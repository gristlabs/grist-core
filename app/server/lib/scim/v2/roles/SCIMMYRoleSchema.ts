import SCIMMY from "scimmy";

const { Attribute, SchemaDefinition } = SCIMMY.Types;

/**
 * SCIMMY Role Schema.
 * Heavily inspired by SCIMMY Group Schema by Sam Lee-Lindsay.
 * https://github.com/scimmyjs/scimmy/blob/8b4333edc566a04cd5390ee4aa3272d021610d77/src/lib/schemas/group.js
 */
export class SCIMMYRoleSchema extends SCIMMY.Types.Schema {
  public static get definition() {
    return this._definition;
  }

  private static _definition = (function () {
    // Clone the Groups schema definition
    return new SchemaDefinition(
      "Role", "urn:ietf:params:scim:schemas:Grist:1.0:Role", "Role in Grist (Owner)", [
        new Attribute("string", "displayName", {
          mutable: false, direction: "out" }),
        SCIMMY.Schemas.Group.definition.attribute('members'),
        new Attribute("string", "docId", { required: false, description: "The docId associated to this role.",
          mutable: false, direction: 'out' }),
        new Attribute("integer", "workspaceId", { required: false, description: "The workspaceId for this role",
          mutable: false, direction: 'out' }),
        new Attribute("integer", "orgId", { required: false, description: "The orgId for this role",
          mutable: false, direction: 'out' }),
      ]);
  })();

  public displayName: string;
  public docId: string|undefined;
  public workspaceId: number|undefined;
  public orgId: number|undefined;
  public members: SCIMMY.Schemas.Group["members"];

  constructor(resource: object, direction = "both", basepath?: string, filters?: SCIMMY.Types.Filter) {
    super(resource, direction);
    Object.assign(this, SCIMMYRoleSchema._definition.coerce(resource, direction, basepath, filters));
  }
}
