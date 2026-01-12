import { AirtableAPI } from "app/common/AirtableAPI";
import { gristDocSchemaFromAirtableSchema } from "app/common/AirtableImporter";
import {
  DocSchemaImportTool,
  formatDocSchemaSqlResult,
  GET_DOC_SCHEMA_SQL,
  transformImportSchema,
} from "app/common/DocSchemaImport";
import { DocSchemaSqlResultChecker, ExistingDocSchema } from "app/common/DocSchemaImportTypes";
import { DocAPI } from "app/common/UserAPI";

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

  console.log("Bases");
  console.log(bases);

  // We can try using a custom DocComm inside a FlowRunner here if needed.
  const userApi = window.gristApp?.topAppModel?.api;
  if (!userApi) {
    throw new Error("No user API available");
  }

  const baseToUse = bases[0];
  const baseSchema = await api.getBaseSchema(baseToUse.id);

  console.log("Base schema");
  console.log(baseSchema);

  const workspaces = await userApi.getOrgWorkspaces("current");
  const docId = await userApi.newDoc({ name: baseToUse.name }, workspaces[0].id);
  const docApi = userApi.getDocAPI(docId);

  console.log("Existing doc schema");
  console.log(await getExistingDocSchema(docApi));
  // TODO - Trim the existing tables from the created doc (after creation?)

  const importSchema = gristDocSchemaFromAirtableSchema(baseSchema);

  console.log("Import schema");
  console.log(importSchema);

  const transformedSchema = transformImportSchema(importSchema, {});

  console.log("Transformed import schema");
  console.log(transformedSchema);

  const docSchemaCreator = new DocSchemaImportTool(actions => docApi.applyUserActions((actions)));

  // TODO - Record warnings
  await docSchemaCreator.createTablesFromSchema(transformedSchema.schema);

  console.log("Final real doc schema");
  console.log(await getExistingDocSchema(docApi));

  // TODO - Fetch base schema, convert to import schema, validate
  //        or should we show the airtable schema first?
  // TODO - set up transforms to be applied (how?)
  // TODO - Flag any warnings from the transforms
  // TODO - Apply schema to doc
};

async function getExistingDocSchema(docApi: DocAPI): Promise<ExistingDocSchema> {
  const result = await docApi.sql(GET_DOC_SCHEMA_SQL);
  const formattedResult = result.records.map(record => record.fields);
  if (DocSchemaSqlResultChecker.test(formattedResult)) {
    return formatDocSchemaSqlResult(formattedResult);
  }
  // This should always throw, but typescript doesn't know that.
  DocSchemaSqlResultChecker.check(formattedResult);
  throw new Error("Invalid schema format - this error should not be hit");
}
