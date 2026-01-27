import { getExistingDocSchema } from "app/client/lib/DocSchemaImport";
import { AirtableAPI } from "app/common/airtable/AirtableAPI";
import { gristDocSchemaFromAirtableSchema } from "app/common/airtable/AirtableSchemaImporter";
import {
  DocSchemaImportTool,
  ImportSchemaTransformParams,
  transformImportSchema, validateImportSchema,
} from "app/common/DocSchemaImport";
import { UserAPI } from "app/common/UserAPI";

export interface AirtableImportOptions {
  transformations?: ImportSchemaTransformParams,
  existingDocId?: string,
}

/**
 * Exemplar function for importing an airtable base into a Grist document.
 * @param {string} apiKey - Airtable Personal Access Token
 * @param {string} baseId - ID of the Airtable base to import
 * @param options - Options to modify the import
 * @param {ImportSchemaTransformParams} [options.transformations] - Transformations to apply to the schema
 * @param {string} [options.existingDocId] - If defined, imports tables into this existing Grist doc.
 * @returns {Promise<void>}
 */
export async function runAirtableImport(
  apiKey: string,
  baseId: string,
  options: AirtableImportOptions = {},
): Promise<void> {
  const { existingDocId, transformations } = options;

  const api = new AirtableAPI({ apiKey });

  const bases = await api.listBases();

  console.log("All available Airtable bases:");
  console.log(bases);

  const baseToUse = bases.find(base => base.id === baseId);
  if (baseToUse === undefined) {
    throw new Error("No base with the given ID found");
  }

  const userApi = window.gristApp?.topAppModel?.api;
  if (!userApi) {
    throw new Error("No user API available - is this being run outside of the browser?");
  }

  const baseSchema = await api.getBaseSchema(baseToUse.id);

  console.log("Retrieved schema for the selected Airtable base:");
  console.log(baseSchema);

  const docApi = existingDocId ?
    userApi.getDocAPI(existingDocId) : userApi.getDocAPI(await createDoc(userApi, baseToUse.name));

  const existingDocSchema = await getExistingDocSchema(docApi);
  console.log("Schema for the existing Grist document:");
  console.log(existingDocSchema);
  const initialTables = existingDocSchema.tables.map(table => table.id);

  const { schema: importSchema, warnings: airtableWarnings } = gristDocSchemaFromAirtableSchema(baseSchema);

  console.log("Generated Grist schema from the Airtable base:");
  console.log(importSchema);

  console.log("Warnings from Airtable schema conversion:");
  console.warn(airtableWarnings);

  console.log("Validation warnings for the generated Grist schema:");
  console.warn(validateImportSchema(importSchema));

  const transformedSchema = transformImportSchema(importSchema, transformations ?? {}, existingDocSchema);

  console.log("Generated Grist schema after transformations are applied:");
  console.log(transformedSchema.schema);

  console.log("Warnings that occurred during the transformation:");
  console.log(transformedSchema.warnings);

  console.log("Validation warnings for the transformed Grist schema:");
  console.log(validateImportSchema(transformedSchema.schema));

  const docSchemaCreator = new DocSchemaImportTool(actions => docApi.applyUserActions((actions)));

  const { warnings: creationWarnings } = await docSchemaCreator.createTablesFromSchema(transformedSchema.schema);
  console.log("Warnings that occurred when applying the schema to the document:");
  console.log(creationWarnings);

  // Only remove the initial tables if the Grist document was newly created.
  if (!existingDocId) {
    await docSchemaCreator.removeTables(initialTables);
  }

  console.log("Final schema of the Grist document:");
  console.log(await getExistingDocSchema(docApi));
}

export async function runAirtableDataImport(
  apiKey: string,
  baseId: string,
  tableMapping: Map<string, string>,
) {
  // TODO - Fetch airtable schema
  //        fetch existing doc schema
  //        create crosswalk
  //        execute data import code
}

async function createDoc(userApi: UserAPI, name: string) {
  const workspaces = await userApi.getOrgWorkspaces("current");
  return await userApi.newDoc({ name }, workspaces[0].id);
}
