import { getExistingDocSchema } from "app/client/lib/DocSchemaImport";
import { AirtableAPI, listRecords } from "app/common/airtable/AirtableAPI";
import { createAirtableBaseToGristDocCrosswalk } from "app/common/airtable/AirtableCrosswalk";
import { importDataFromAirtableBase } from "app/common/airtable/AirtableDataImporter";
import { gristDocSchemaFromAirtableSchema } from "app/common/airtable/AirtableSchemaImporter";
import {
  DocSchemaImportTool,
  ImportSchema,
  ImportSchemaTransformParams,
} from "app/common/DocSchemaImport";
import { OWNER } from "app/common/roles";
import { UserAPI } from "app/common/UserAPI";

export interface AirtableImportOptions {
  transformations?: ImportSchemaTransformParams,
  existingDocId?: string,
  newDocName?: string;
  structureOnly?: boolean,
}

/**
 * @deprecated
 * Runs a full import from an Airtable base into a new or existing Grist doc
 * This is intended to be replaced by a full UI when complete.
 * @param {string} apiKey - Airtable Personal Access Token
 * @param {string} baseId - ID of the Airtable base to import
 * @param options - Options to modify the import
 * @param {ImportSchemaTransformParams} [options.transformations] - Transformations to apply to the
 *   schema
 * @param {string} [options.existingDocId] - If defined, imports tables into this existing Grist
 *   doc.
 * @returns {Promise<void>}
 */
export async function runAirtableImport(
  apiKey: string,
  baseId: string,
  options: AirtableImportOptions = {},
): Promise<void> {
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
  const { schema: importSchema, warnings: airtableWarnings } = gristDocSchemaFromAirtableSchema(baseSchema);

  console.log("Warnings from Airtable schema conversion:");
  console.warn(airtableWarnings);

  await applyAirtableImportSchemaAndImportData({
    userApi,
    dataSource: { api, baseId },
    importSchema,
    options: {
      newDocName: options.newDocName ?? baseToUse.name,
    },
  });
}

export async function applyAirtableImportSchemaAndImportData(params: {
  importSchema: ImportSchema,
  dataSource: { api: AirtableAPI, baseId: string },
  userApi: UserAPI,
  options: AirtableImportOptions,
}) {
  const { dataSource, importSchema, userApi, options } = params;
  const { api, baseId } = dataSource;
  const { existingDocId, transformations } = options;

  const baseSchema = await api.getBaseSchema(baseId);

  const docId = existingDocId ?? await createDoc(userApi, options.newDocName ?? baseId);
  const docApi = userApi.getDocAPI(docId);

  const existingDocSchema = await getExistingDocSchema(docApi);
  const initialTables = existingDocSchema.tables.map(table => table.id);

  const docSchemaCreator = new DocSchemaImportTool(actions => docApi.applyUserActions((actions)));

  const { tableIdsMap, warnings: creationWarnings } = await docSchemaCreator.createTablesFromSchema(importSchema);

  // TODO - Update this to show the creation warnings to user before starting data import.
  if (creationWarnings.length > 0) {
    console.warn({
      message: `Warnings were emitted while creating the tables for airtable base ${baseId} and grist doc ${docId}`,
      docId,
      baseId,
      warnings: creationWarnings,
    });
  }

  // Only remove the initial tables if the Grist document was newly created.
  if (!existingDocId) {
    await docSchemaCreator.removeTables(initialTables);
  }

  if (options.structureOnly) { return; }

  const finalGristDocSchema = await getExistingDocSchema(docApi);

  const dataTableMapping = new Map(
    Array.from(tableIdsMap.values()).map(tableIdInfo => [tableIdInfo.originalId, tableIdInfo.gristId]),
  );

  // tableIdsMap only contains newly created tables - need to add the table mapping supplied by the
  // user when building the crosswalk.
  const existingTableIdMap = transformations?.mapExistingTableIds;
  if (existingTableIdMap) {
    for (const [airtableTableId, gristTableId] of existingTableIdMap.entries()) {
      dataTableMapping.set(airtableTableId, gristTableId);
    }
  }

  const { schemaCrosswalk, warnings: crosswalkWarnings } =
    createAirtableBaseToGristDocCrosswalk(baseSchema, finalGristDocSchema, dataTableMapping);

  // TODO - Update these steps to show the crosswalk warnings to user before starting data import.
  if (crosswalkWarnings.length > 0) {
    console.warn({
      message: `Warnings were emitted while generating the crosswalk between airtable base ${baseId} and grist doc ${docId}`,
      docId,
      baseId,
      warnings: crosswalkWarnings,
    });
  }

  await importDataFromAirtableBase({
    listRecords: tableId => listRecords(api.base(baseId), tableId, {}),
    addRows: docApi.addRows.bind(docApi),
    updateRows: docApi.updateRows.bind(docApi),
    schemaCrosswalk,
  });

  return {
    creationWarnings,
    crosswalkWarnings,
  };
}

async function createDoc(userApi: UserAPI, name: string) {
  const workspaces = await userApi.getOrgWorkspaces("current");
  if (workspaces.length === 0) {
    throw new NoWorkspacesError();
  }
  const writableWorkspaces = workspaces.filter(workspace => workspace.access === OWNER);
  if (writableWorkspaces.length === 0) {
    // This could be a different error?
    throw new NoWorkspacesError();
  }
  return await userApi.newDoc({ name }, workspaces[0].id);
}

class NoWorkspacesError extends Error {
  constructor() {
    super("No workspaces could be found for importing to: imports by anonymous users are not supported.");
  }
}
