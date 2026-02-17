import { getExistingDocSchema } from "app/client/lib/DocSchemaImport";
import { makeT } from "app/client/lib/localization";
import { AirtableAPI, listRecords } from "app/common/airtable/AirtableAPI";
import { AirtableBaseSchema } from "app/common/airtable/AirtableAPITypes";
import { AirtableCrosswalkWarning, createAirtableBaseToGristDocCrosswalk } from "app/common/airtable/AirtableCrosswalk";
import { importDataFromAirtableBase } from "app/common/airtable/AirtableDataImporter";
import { gristDocSchemaFromAirtableSchema } from "app/common/airtable/AirtableSchemaImporter";
import {
  DocSchemaImportTool,
  DocSchemaImportWarning,
  ImportSchema,
  ImportSchemaTransformParams,
  transformImportSchema,
  validateImportSchema,
} from "app/common/DocSchemaImport";
import { ExistingDocSchema } from "app/common/DocSchemaImportTypes";
import { OWNER } from "app/common/roles";
import { UserAPI } from "app/common/UserAPI";

export interface AirtableImportOptions {
  transformations?: ImportSchemaTransformParams,
  existingDocId?: string,
  newDocName?: string,
  structureOnlyTableIds?: string[],
  onProgress?(progress: ImportProgress): void,
}

export interface AirtableImportResult {
  docId: string;
  creationWarnings: DocSchemaImportWarning[];
  crosswalkWarnings?: AirtableCrosswalkWarning[];
}

export interface ImportProgress {
  percent: number;
  status?: string;
}

const t = makeT("AirtableImport");

export async function applyAirtableImportSchemaAndImportData(params: {
  importSchema: ImportSchema,
  dataSource: { api: AirtableAPI, baseId: string },
  userApi: UserAPI,
  options: AirtableImportOptions,
}): Promise<AirtableImportResult> {
  const { dataSource, importSchema, userApi, options } = params;
  const { api, baseId } = dataSource;
  const { existingDocId, transformations, structureOnlyTableIds = [], onProgress } = options;

  onProgress?.({ percent: 0, status: t("Preparing to import base from Airtable...") });

  const baseSchema = await api.getBaseSchema(baseId);

  if (!existingDocId) { onProgress?.({ percent: 10, status: t("Creating a new Grist document...") }); }

  const docId = existingDocId ?? await createDoc(userApi, options.newDocName ?? baseId);
  const docApi = userApi.getDocAPI(docId);

  const existingDocSchema = await getExistingDocSchema(docApi);
  const initialTables = existingDocSchema.tables.map(table => table.id);

  const docSchemaCreator = new DocSchemaImportTool(actions => docApi.applyUserActions((actions)));

  onProgress?.({ percent: 25, status: t("Setting up tables...") });

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

  const finalGristDocSchema = await getExistingDocSchema(docApi);

  const skipDataTableIds = new Set(structureOnlyTableIds);
  const dataTableInfo = Array.from(tableIdsMap.values()).filter(({ originalId: id }) => !skipDataTableIds.has(id));
  const dataTableMapping = new Map(dataTableInfo.map(({ originalId, gristId }) => [originalId, gristId]));

  // tableIdsMap only contains newly created tables - need to add the table mapping supplied by the
  // user when building the crosswalk.
  const existingTableIdMap = transformations?.mapExistingTableIds;
  if (existingTableIdMap) {
    for (const [airtableTableId, gristTableId] of existingTableIdMap.entries()) {
      dataTableMapping.set(airtableTableId, gristTableId);
    }
  }

  if (dataTableMapping.size === 0) {
    return {
      docId,
      creationWarnings,
    };
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

  onProgress?.({ percent: 50, status: t("Importing data from Airtable...") });

  await importDataFromAirtableBase({
    listRecords: tableId => listRecords(api.base(baseId), tableId, {}),
    addRows: docApi.addRows.bind(docApi),
    updateRows: docApi.updateRows.bind(docApi),
    uploadAttachment: docApi.uploadAttachment.bind(docApi),
    schemaCrosswalk,
  });

  onProgress?.({ percent: 100 });

  return {
    creationWarnings,
    crosswalkWarnings,
    docId,
  };
}

export function validateAirtableSchemaImport(
  baseSchema: AirtableBaseSchema,
  existingDocSchema?: ExistingDocSchema,
  transformations?: ImportSchemaTransformParams,
): DocSchemaImportWarning[] {
  const warnings: DocSchemaImportWarning[] = [];

  const { schema: importSchema, warnings: airtableWarnings } = gristDocSchemaFromAirtableSchema(baseSchema);
  warnings.push(...airtableWarnings);

  const transformedSchema = transformImportSchema(importSchema, transformations ?? {}, existingDocSchema);
  warnings.push(...transformedSchema.warnings, ...validateImportSchema(transformedSchema.schema));

  return warnings;
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
