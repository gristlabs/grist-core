import { get as getBrowserGlobals } from "app/client/lib/browserGlobals";
import { getExistingDocSchema } from "app/client/lib/SchemaImporter";
import { AirtableAPI } from "app/common/airtable/AirtableAPI";
import { gristDocSchemaFromAirtableSchema } from "app/common/airtable/AirtableImporter";
import {
  DocSchemaImportTool,
  ImportSchemaTransformParams,
  transformImportSchema, validateImportSchema,
} from "app/common/DocSchemaImport";

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

const G = getBrowserGlobals("window");

export function addAirtableMigrationBrowserGlobal() {
  G.window.runAirtableMigration = runAirtableMigration;
}

export async function runAirtableMigration(
  apiKey: string,
  baseId: string,
  transformations?: ImportSchemaTransformParams,
) {
  const api = new AirtableAPI({ apiKey });

  const bases = await api.listBases();

  console.log("Bases");
  console.log(bases);

  const baseToUse = bases.find(base => base.id === baseId);
  if (baseToUse === undefined) {
    throw new Error("No base with the given ID found");
  }

  // We can try using a custom DocComm inside a FlowRunner here if needed.
  const userApi = window.gristApp?.topAppModel?.api;
  if (!userApi) {
    throw new Error("No user API available");
  }

  const baseSchema = await api.getBaseSchema(baseToUse.id);

  console.log("Base schema");
  console.log(baseSchema);

  const workspaces = await userApi.getOrgWorkspaces("current");
  const docId = await userApi.newDoc({ name: baseToUse.name }, workspaces[0].id);
  const docApi = userApi.getDocAPI(docId);

  const existingDocSchema = await getExistingDocSchema(docApi);
  console.log("Existing doc schema");
  console.log(existingDocSchema);
  const initialTables = existingDocSchema.tables.map(table => table.id);

  const importSchema = gristDocSchemaFromAirtableSchema(baseSchema);

  console.log("Import schema");
  console.log(importSchema);

  console.log("Import schema validation warnings");
  console.log(validateImportSchema(importSchema));

  const transformedSchema = transformImportSchema(importSchema, transformations ?? {}, existingDocSchema);

  console.log("Transformed import schema");
  console.log(transformedSchema.schema);

  console.log("Transformation warnings");
  console.log(transformedSchema.warnings);

  console.log("Transformed schema validation warnings");
  console.log(validateImportSchema(transformedSchema.schema));

  const docSchemaCreator = new DocSchemaImportTool(actions => docApi.applyUserActions((actions)));

  const { warnings: creationWarnings } = await docSchemaCreator.createTablesFromSchema(transformedSchema.schema);
  console.log("Creation warnings");
  console.log(creationWarnings);

  await docSchemaCreator.removeTables(initialTables);

  console.log("Final real doc schema");
  console.log(await getExistingDocSchema(docApi));
}
