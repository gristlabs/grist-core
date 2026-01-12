import { AirtableAPI } from "app/common/AirtableAPI";
import { gristDocSchemaFromAirtableSchema } from "app/common/AirtableImporter";
import { DocSchemaImportTool, transformImportSchema } from "app/common/DocSchemaImport";

/*
Importer will:
  - Optionally create a new doc - wipe existing tables
  - Fetch details of base (_api.getBaseSchema) - display them to the user
  - User specifies transforms to be applied. Each transform runs a new validation
  - User finally approves, executes.
  - Creates schema, reports any warnings.
  - Specify transforms to be applied
  - Apply transforms
  - Get the schema from the given service (or be given it)
  - Apply schema to the doc?
 */

window.runAirtableMigration = async function(apiKey) {
  const api = new AirtableAPI({ apiKey });

  const bases = await api.listBases();

  console.log(bases);

  // We can try using a custom DocComm inside a FlowRunner here if needed.
  const userApi = window.gristApp?.topAppModel?.api;
  if (!userApi) {
    throw new Error("No user API available");
  }

  const baseToUse = bases[0];
  const baseSchema = await api.getBaseSchema(baseToUse.id);

  const workspaces = await userApi.getOrgWorkspaces("current");
  const docId = await userApi.newDoc({ name: baseToUse.name }, workspaces[0].id);

  // TODO - Trim the existing tables from the created doc (after creation?)

  const docApi = userApi.getDocAPI(docId);
  const importSchema = gristDocSchemaFromAirtableSchema(baseSchema);
  const transformedSchema = transformImportSchema(importSchema, {});
  const docSchemaCreator = new DocSchemaImportTool(actions => docApi.applyUserActions((actions)));

  return await docSchemaCreator.createTablesFromSchema(transformedSchema.schema);

  // TODO - Fetch base schema, convert to import schema, validate
  //        or should we show the airtable schema first?
  // TODO - set up transforms to be applied (how?)
  // TODO - Flag any warnings from the transforms
  // TODO - Apply schema to doc
};
