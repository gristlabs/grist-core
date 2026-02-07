import { getExistingDocSchema } from "app/client/lib/DocSchemaImport";
import { AirtableAPI } from "app/common/airtable/AirtableAPI";
import { createAirtableBaseToGristDocCrosswalk } from "app/common/airtable/AirtableCrosswalk";
import {
  importDataFromAirtableBase,
} from "app/common/airtable/AirtableDataImporter";
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
  structureOnly?: boolean,
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

  const docId = existingDocId ?? await createDoc(userApi, baseToUse.name);
  const docApi = userApi.getDocAPI(docId);

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

  const { tableIdsMap, warnings: creationWarnings } =
    await docSchemaCreator.createTablesFromSchema(transformedSchema.schema);
  console.log("Warnings that occurred when applying the schema to the document:");
  console.log(creationWarnings);

  // Only remove the initial tables if the Grist document was newly created.
  if (!existingDocId) {
    await docSchemaCreator.removeTables(initialTables);
  }

  console.log("Final schema of the Grist document:");
  const finalGristDocSchema = await getExistingDocSchema(docApi);
  console.log(finalGristDocSchema);

  if (options.structureOnly) { return; }

  console.log(tableIdsMap);

  const dataTableMapping = new Map(
    Array.from(tableIdsMap.values()).map(tableIdInfo => [tableIdInfo.originalId, tableIdInfo.gristId]),
  );

  console.log(dataTableMapping);

  const { schemaCrosswalk, warnings: crosswalkWarnings } =
    createAirtableBaseToGristDocCrosswalk(baseSchema, finalGristDocSchema, dataTableMapping);

  console.log("Generated crosswalk schema:");
  console.log(schemaCrosswalk);

  console.log("Warnings that occurred when generating the crosswalk between the Airtable base and Grist doc:");
  console.log(crosswalkWarnings);

  console.log(`Importing data from base ${baseId} to Grist doc ${docId}`);
  await importDataFromAirtableBase({
    base: api.base(baseId),
    addRows: docApi.addRows.bind(docApi),
    updateRows: docApi.updateRows.bind(docApi),
    schemaCrosswalk,
  });

  console.log("Data import completed!");
}

export async function runAirtableDataImport(
  apiKey: string,
  baseId: string,
  docId: string,
  tableMapping: Map<string, string>,
) {
  const api = new AirtableAPI({ apiKey });
  const baseSchema = await api.getBaseSchema(baseId);

  const userApi = window.gristApp?.topAppModel?.api;
  if (!userApi) {
    throw new Error("No user API available - is this being run outside of the browser?");
  }
  const docApi = userApi.getDocAPI(docId);
  const existingDocSchema = await getExistingDocSchema(docApi);

  const { schemaCrosswalk, warnings: crosswalkWarnings } =
    createAirtableBaseToGristDocCrosswalk(baseSchema, existingDocSchema, tableMapping);

  console.log(crosswalkWarnings);

  await importDataFromAirtableBase({
    base: api.base(baseId),
    addRows: docApi.addRows.bind(docApi),
    updateRows: docApi.updateRows.bind(docApi),
    schemaCrosswalk,
  });
}

async function createDoc(userApi: UserAPI, name: string) {
  const workspaces = await userApi.getOrgWorkspaces("current");
  return await userApi.newDoc({ name }, workspaces[0].id);
}
