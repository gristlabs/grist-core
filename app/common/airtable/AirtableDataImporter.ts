import {
  AirtableBaseSchema,
  AirtableFieldName,
  AirtableFieldSchema,
  AirtableTableId,
  AirtableTableSchema,
} from "app/common/airtable/AirtableAPI";
import { AirtableIdColumnLabel } from "app/common/airtable/AirtableSchemaImporter";
import { TableColValues } from "app/common/DocActions";
import {
  ExistingColumnSchema,
  ExistingDocSchema,
  ExistingTableSchema,
} from "app/common/DocSchemaImportTypes";
import { isNonNullish } from "app/common/gutil";
import { BulkColValues, CellValue, GristObjCode } from "app/plugin/GristData";

import { AirtableBase } from "airtable/lib/airtable_base";
import { chain } from "lodash";

interface AirtableDataImportParams {
  base: AirtableBase,
  addRows: (tableId: GristTableId, rows: BulkColValues) => Promise<number[]>,
  updateRows: UpdateRowsFunc,
  schemaCrosswalk: AirtableBaseSchemaCrosswalk,
}

type UpdateRowsFunc = (tableId: GristTableId, rows: TableColValues) => Promise<number[]>;

export async function importDataFromAirtableBase(
  { base, addRows, updateRows, schemaCrosswalk }: AirtableDataImportParams,
) {
  // TODO - move this comment
  // Maps known airtable ids to their grist row ids to enable reference resolution.
  // Airtable row ids are guaranteed unique within a base.
  const referenceTracker = new ReferenceTracker();
  /*
  const addRowsAndStoreIdMapping = async (tableId: string, airtableRecordIds: string[], colValues: BulkColValues) => {
    const rowIds = await addRows(tableId, colValues);
  };
   */

  const addRowsPromises: Promise<any>[] = [];

  for (const [tableId, tableCrosswalk] of schemaCrosswalk.tables.entries()) {
    console.log(`Migrating ${tableId} to ${tableCrosswalk.gristTable.id}`);
    console.log(tableCrosswalk);
    // Filter out any formula columns early - Grist will error on any write to formula columns.
    const fieldMappings = Array.from(tableCrosswalk.fields.values()).filter(mapping => !mapping.gristColumn.isFormula);
    const gristColumnIds = fieldMappings.map(mapping => mapping.gristColumn.id);

    // Airtable ID needs to be handled separately to fields, as it's not stored as a field in Airtable
    if (tableCrosswalk.airtableIdColumn) {
      gristColumnIds.push(tableCrosswalk.airtableIdColumn.id);
    }

    const referenceColumnIds = Array.from(tableCrosswalk.fields.values())
      .filter(mapping => isRefField(mapping.airtableField))
      .map(mapping => mapping.gristColumn.id);

    const tableReferenceTracker = referenceTracker.addTable(tableCrosswalk.gristTable.id, referenceColumnIds);

    // Used to re-throw outside the eachPage iterator.
    let eachPageError: any = undefined;

    // TODO - This can throw various errors from Airtable's API
    // TODO - See if it makes sense to have a predictable ordering here.
    await base.table(tableId).select().eachPage((records, nextPage) => {
      // Try-catch needed as Airtable's eachPage handler catches any error thrown here, and emits
      // an entirely different, unrelated error instead (looks like a bug in their library)
      try {
        const colValues: BulkColValues = createEmptyBulkColValues(gristColumnIds);
        const airtableRecordIds: string[] = [];
        const refsByColumnIdForRecords: RefValuesByColumnId[] = [];

        for (const record of records) {
          const refsByColumnId: RefValuesByColumnId = {};

          airtableRecordIds.push(record.id);
          for (const fieldMapping of fieldMappings) {
            const rawFieldValue = record.fields[fieldMapping.airtableField.name];

            if (isRefField(fieldMapping.airtableField)) {
              refsByColumnId[fieldMapping.gristColumn.id] = extractRefFromRecordField(rawFieldValue, fieldMapping);
              // Column should remain blank until it's filled in by a later reference resolution step.
              colValues[fieldMapping.gristColumn.id].push(null);
              continue;
            }

            const converter =
              AirtableFieldValueConverters[fieldMapping.airtableField.type] ?? AirtableFieldValueConverters.identity;

            const value = converter(fieldMapping.airtableField, record.fields[fieldMapping.airtableField.name]);

            // Always push, even if the value is undefined, so that row values are always at the right index.
            colValues[fieldMapping.gristColumn.id].push(value ?? null);
          }

          if (tableCrosswalk.airtableIdColumn) {
            colValues[tableCrosswalk.airtableIdColumn.id].push(record.id);
          }

          refsByColumnIdForRecords.push(refsByColumnId);
        }

        const addRowsPromise = addRows(tableCrosswalk.gristTable.id, colValues)
          .then((gristRowIds) => {
            airtableRecordIds.forEach((airtableRecordId, index) => {
              // Only add entries to the reference tracker once we know they're added to the table.
              referenceTracker.addRecordIdMapping(airtableRecordId, gristRowIds[index]);
              tableReferenceTracker.addUnresolvedRecord({
                gristRecordId: gristRowIds[index],
                refsByColumnId: refsByColumnIdForRecords[index],
              });
            });
          });

        addRowsPromises.push(addRowsPromise);

        nextPage();
      }
      catch (e) {
        // Store it and re-throw outside the loop to prevent errors in Airtable's library.
        eachPageError = e;
        // Avoid calling nextPage() to end iteration.
      }
    });

    // TODO - Throw this for now, but we might want to ignore anything recoverable (partial import?)
    if (eachPageError) {
      throw eachPageError;
    }
  }

  // TODO - Handle errors from any addRows promise - should this be a Promise.allSettled?
  console.log(await Promise.all(addRowsPromises));

  for (const tableReferenceTracker of referenceTracker.getTables()) {
    await tableReferenceTracker.bulkUpdateRowsWithUnresolvedReferences(updateRows);
  }

  /*
  // Resolve references, table by table to enable bulk updates.
  // To make the bulk updates behave correctly, all reference columns need updating at the same time.
  // This means every `UnresolvedRefsForRecord` should contain the values for every reference column being resolved.
  for (const [tableCrosswalk, unresolvedRefsForTable] of unresolvedRefsByTable.entries()) {
    const referenceColumns = Array.from(tableCrosswalk.fields.values())
      .filter(mapping => isRefField(mapping.airtableField))
      .map(mapping => mapping.gristColumn);

    const referenceColumnIds = referenceColumns.map(column => column.id);
    const maxBatchSize = 100;

    let pendingUpdate: TableColValues = { id: [], ...createEmptyBulkColValues(referenceColumnIds) };
    for (const unresolvedRefsForRecord of unresolvedRefsForTable) {
      const gristRowId = gristRowIdLookup.get(unresolvedRefsForRecord.airtableRecordId);
      // This should only happen if a row failed to be added - in which case, it's safe to skip
      // reference resolution because there's no row to update.
      if (gristRowId === undefined) { continue; }

      pendingUpdate.id.push(gristRowId);
      // Every row needs an entry in its respective column in the bulk update, so always loop through
      // the same columns for every row.
      for (const referenceColumnId of referenceColumnIds) {
        const references = unresolvedRefsForRecord.refsByColumnId[referenceColumnId];
        // TODO - Unresolvable references are currently just skipped silently. Find a way to display
        //        them in the cell / UI.
        const resolvedReferences = references ?
          references.map(airtableRecordId => gristRowIdLookup.get(airtableRecordId)).filter(isNonNullish) : [];
        pendingUpdate[referenceColumnId].push(
          [GristObjCode.List, ...resolvedReferences],
        );
      }

      if (pendingUpdate.id.length >= maxBatchSize) {
        console.log(pendingUpdate);
        await updateRows(tableCrosswalk.gristTable.id, pendingUpdate);
        pendingUpdate = { id: [], ...createEmptyBulkColValues(referenceColumnIds) };
      }
    }

    if (pendingUpdate.id.length > 0) {
      console.log(pendingUpdate);
      await updateRows(tableCrosswalk.gristTable.id, pendingUpdate);
    }
  }*/
}

// TODO - Consider how this can be made generic (and maybe do so)
class ReferenceTracker {
  private _rowIdLookup = new Map<string, number>();
  // Group references by table and row to achieve bulk-updates and atomic resolutions for rows.
  private _tableReferenceTrackers = new Map<string, TableReferenceTracker>();

  public addRecordIdMapping(originalRecordId: string, gristRecordId: number) {
    this._rowIdLookup.set(originalRecordId, gristRecordId);
  }

  public resolve(originalRecordId: string): number | undefined {
    return this._rowIdLookup.get(originalRecordId);
  }

  public addTable(gristTableId: string, columnIdsToUpdate: string[]) {
    const tableTracker = new TableReferenceTracker(this, gristTableId, columnIdsToUpdate);
    this._tableReferenceTrackers.set(gristTableId, tableTracker);
    return tableTracker;
  }

  public getTables(): TableReferenceTracker[] {
    return Array.from(this._tableReferenceTrackers.values());
  }
}

// Store and resolve references per-table to enable bulk updates.
class TableReferenceTracker {
  private _unresolvedRefsForRecords: UnresolvedRefsForRecord[] = [];

  // To perform bulk updates, all reference columns need updating at the same time.
  // Enforce this by explicitly listing the column ids to use during instantiation.
  public constructor(private _parent: ReferenceTracker, private _tableId: string, private _columnIds: string[]) {
  }

  public addUnresolvedRecord(unresolvedRefsForRecord: UnresolvedRefsForRecord) {
    console.log(`Adding unresolved record: ${JSON.stringify(unresolvedRefsForRecord)}`);
    this._unresolvedRefsForRecords.push(unresolvedRefsForRecord);
  }

  public async bulkUpdateRowsWithUnresolvedReferences(
    updateRows: UpdateRowsFunc,
    options?: { batchSize?: number },
  ) {
    const batchSize = options?.batchSize ?? 100;

    let pendingUpdate: TableColValues = { id: [], ...createEmptyBulkColValues(this._columnIds) };

    for (const unresolvedRefsForRecord of this._unresolvedRefsForRecords) {
      pendingUpdate.id.push(unresolvedRefsForRecord.gristRecordId);

      // Every row needs an entry in its respective column in the bulk update, so always loop through
      // the same columns for every row.
      for (const columnId of this._columnIds) {
        const references = unresolvedRefsForRecord.refsByColumnId[columnId];
        // TODO - Unresolvable references are currently just skipped silently. Find a way to display
        //        them in the cell / UI.
        const resolvedReferences = references ?
          references.map(originalRecordId => this._parent.resolve(originalRecordId)).filter(isNonNullish) : [];
        pendingUpdate[columnId].push(
          [GristObjCode.List, ...resolvedReferences],
        );
      }

      if (pendingUpdate.id.length >= batchSize) {
        console.log(pendingUpdate);
        await updateRows(this._tableId, pendingUpdate);
        pendingUpdate = { id: [], ...createEmptyBulkColValues(this._columnIds) };
      }
    }

    if (pendingUpdate.id.length > 0) {
      console.log(pendingUpdate);
      await updateRows(this._tableId, pendingUpdate);
    }
  }
}

interface UnresolvedRefsForRecord {
  gristRecordId: number;
  refsByColumnId: RefValuesByColumnId;
}

type RefValuesByColumnId = Record<string, string[] | undefined>;

function isRefField(field: AirtableFieldSchema) {
  return field.type === "multipleRecordLinks";
}

function extractRefFromRecordField(fieldValue: any, fieldMapping: AirtableFieldMappingInfo): string[] | undefined {
  if (fieldMapping.airtableField.type === "multipleRecordLinks") {
    return fieldValue;
  }
  return undefined;
}

function createEmptyBulkColValues(columnIds: string[]): BulkColValues {
  return chain(columnIds).keyBy().mapValues(() => []).value();
}

type AirtableFieldValueConverter = (fieldSchema: AirtableFieldSchema, value: any) => CellValue | undefined;
// TODO - Make these values easier to use by typing their parameters. It won't be type safe, but might help.
const AirtableFieldValueConverters: Record<string, AirtableFieldValueConverter> = {
  identity(fieldSchema, value) {
    return value;
  },
  aiText(fieldSchema, aiTextState) {
    return aiTextState?.value;
  },
  createdBy(fieldSchema, collaborator) {
    return formatCollaborator(collaborator);
  },
  count(fieldSchema, collaborator) {
    // Summary column - should be a formula in Grist, no value needed
    return null;
  },
  formula(fieldSchema, collaborator) {
    // Generated column - should be a formula in Grist, no value needed
    return null;
  },
  lastModifiedBy(fieldSchema, collaborator) {
    return formatCollaborator(collaborator);
  },
  lookup(fieldSchema, value) {
    // Lookup fields fetch values from other columns. This should be a formula in Grist, no value needed.
    return null;
  },
  multipleCollaborators(fieldSchema, collaborators) {
    return collaborators?.map(formatCollaborator);
  },
  singleCollaborator(fieldSchema, collaborator) {
    return formatCollaborator(collaborator);
  },
  rollup(fieldSchema, collaborator) {
    // Generated column - should be a formula in Grist, no value needed
    return null;
  },
};

const formatCollaborator = (collaborator: any) => collaborator?.name;

type GristTableId = string;

interface AirtableBaseSchemaCrosswalk {
  tables: Map<AirtableTableId, AirtableTableCrosswalk>
}

interface AirtableTableCrosswalk {
  airtableTable: AirtableTableSchema;
  gristTable: ExistingTableSchema;
  fields: Map<AirtableFieldName, AirtableFieldMappingInfo>
  // Special case - ID isn't a field in Airtable, but it's useful to have a mapping if it exists.
  airtableIdColumn?: ExistingColumnSchema;
}

interface AirtableFieldMappingInfo {
  airtableField: AirtableFieldSchema;
  gristColumn: ExistingColumnSchema;
}

// TODO - Consider moving Airtable -> Grist crosswalk to its own file.
/**
 * Creates a mapping from fields in an Airtable schema to fields in a Grist schema.
 * @param {AirtableBaseSchema} airtableSchema
 * @param {ExistingDocSchema} gristSchema
 * @param {Map<AirtableTableId, GristTableId>} tableMap
 * @returns {{schemaCrosswalk: AirtableBaseSchemaCrosswalk, warnings: DocSchemaImportWarning[]}}
 */
export function createAirtableBaseToGristDocCrosswalk(
  airtableSchema: AirtableBaseSchema, gristSchema: ExistingDocSchema, tableMap: Map<AirtableTableId, GristTableId>,
): { schemaCrosswalk: AirtableBaseSchemaCrosswalk, warnings: AirtableDataImportWarning[] } {
  const schemaCrosswalk: AirtableBaseSchemaCrosswalk = {
    tables: new Map(),
  };
  const warnings: AirtableDataImportWarning[] = [];

  for (const [airtableTableId, gristTableId] of tableMap.entries()) {
    const airtableTableSchema = airtableSchema.tables.find(table => table.id === airtableTableId);
    const gristTableSchema = gristSchema.tables.find(table => table.id === gristTableId);

    if (!airtableTableSchema) {
      // Implementation error - this shouldn't be possible if the parameters are passed correctly.
      throw new Error(`No airtable table found with id '${airtableTableId}' when building crosswalk`);
    }

    if (!gristTableSchema) {
      warnings.push(new MissingGristTableWarning(gristTableId));
      continue;
    }

    const { crosswalk: tableCrosswalk, warnings: tableWarnings } =
      createAirtableTableToGristTableCrosswalk(airtableTableSchema, gristTableSchema);

    warnings.push(...tableWarnings);

    schemaCrosswalk.tables.set(airtableTableId, tableCrosswalk);
  }

  return {
    schemaCrosswalk,
    warnings,
  };
}

function createAirtableTableToGristTableCrosswalk(
  airtableTableSchema: AirtableTableSchema, gristTableSchema: ExistingTableSchema,
) {
  const warnings: AirtableDataImportWarning[] = [];
  const crosswalk: AirtableTableCrosswalk = {
    airtableTable: airtableTableSchema,
    gristTable: gristTableSchema,
    fields: new Map(),
    airtableIdColumn: gristTableSchema.columns.find(column => column.label === AirtableIdColumnLabel),
  };

  for (const field of airtableTableSchema.fields) {
    // Match columns on label. It's the only reliable value we can automatically match on and the simplest to implement.
    const matchingColumn = findGristColumnForField(field, gristTableSchema);
    if (!matchingColumn) {
      warnings.push(new NoDestinationColumnWarning(gristTableSchema.id, field));
      continue;
    }
    // Airtable record queries list fields by name (not id), which is guaranteed to be unique.
    crosswalk.fields.set(field.name, {
      airtableField: field,
      gristColumn: matchingColumn,
    });
  }

  return { crosswalk, warnings };
}

function findGristColumnForField(field: AirtableFieldSchema, gristSchema: ExistingTableSchema) {
  return gristSchema.columns.find(column => column.label === field.name);
}

interface AirtableDataImportWarning {
  message: string;
}

class MissingGristTableWarning implements AirtableDataImportWarning {
  public readonly message;

  constructor(public readonly tableId: AirtableTableId) {
    this.message = `No Grist table found with id '${tableId}'`;
  }
}

class NoDestinationColumnWarning implements AirtableDataImportWarning {
  public readonly message: string;

  constructor(public readonly gristTableId: string, public readonly field: AirtableFieldSchema) {
    this.message = `No destination column in the Grist table '${gristTableId}' could be found for field '${field.name}'. A column with a matching label is required.`;
  }
}
