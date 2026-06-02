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

  private static _definition = (function() {
    // Clone the Groups schema definition
    return new SchemaDefinition(
      "Role", "urn:ietf:params:scim:schemas:Grist:1.0:Role", "Role in Grist", [
        new Attribute("string", "displayName", {
          mutable: false, direction: "out" }),
        new Attribute("complex", "members",
          { multiValued: true, uniqueness: false, description: "A list of members of the Role." },
          [
            new Attribute("string", "value",
              { mutable: "immutable", description: "Identifier of the member of this Role." }),
            new Attribute("string", "display",
              { mutable: "immutable", description: "Human-readable name of the member of this Role." }),
            new Attribute("reference", "$ref",
              {
                mutable: "immutable",
                referenceTypes: ["User", "Group", "Role"],
                description: "The URI corresponding to a SCIM resource that is a member of this Role.",
              },
            ),
            new Attribute("string", "type",
              {
                mutable: "immutable",
                canonicalValues: ["User", "Group", "Role"],
                description: "A label indicating the type of resource, e.g., 'User', 'Role' or 'Group'.",
              },
            ),
          ],
        ),
        new Attribute("string", "docId", { required: false, description: "The docId associated to this role.",
          mutable: false, direction: "out" }),
        new Attribute("integer", "workspaceId", { required: false, description: "The workspaceId for this role",
          mutable: false, direction: "out" }),
        new Attribute("integer", "orgId", { required: false, description: "The orgId for this role",
          mutable: false, direction: "out" }),
      ]);
  })();

  public displayName: string;
  public docId: string | undefined;
  public workspaceId: number | undefined;
  public orgId: number | undefined;
  public members: SCIMMY.Schemas.Group["members"];

  constructor(resource: object, direction = "both", basepath?: string, filters?: SCIMMY.Types.Filter) {
    super(resource, direction);
    Object.assign(this, SCIMMYRoleSchema._definition.coerce(resource, direction, basepath, filters));
  }
}
