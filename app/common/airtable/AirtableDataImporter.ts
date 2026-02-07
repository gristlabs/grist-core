import { AirtableFieldSchema, listRecords } from "app/common/airtable/AirtableAPI";
import {
  AirtableBaseSchemaCrosswalk,
  AirtableFieldMappingInfo,
  GristTableId,
} from "app/common/airtable/AirtableCrosswalk";
import { TableColValues } from "app/common/DocActions";
import { isNonNullish } from "app/common/gutil";
import { BulkColValues, CellValue, GristObjCode } from "app/plugin/GristData";

import { AirtableBase } from "airtable/lib/airtable_base";
import { chain } from "lodash";

export interface AirtableDataImportParams {
  base: AirtableBase,
  addRows: (tableId: GristTableId, rows: BulkColValues) => Promise<number[]>,
  updateRows: UpdateRowsFunc,
  schemaCrosswalk: AirtableBaseSchemaCrosswalk,
}

type UpdateRowsFunc = (tableId: GristTableId, rows: TableColValues) => Promise<number[]>;

export async function importDataFromAirtableBase(
  { base, addRows, updateRows, schemaCrosswalk }: AirtableDataImportParams,
) {
  const referenceTracker = new ReferenceTracker();

  const addRowsPromises: Promise<any>[] = [];

  for (const [tableId, tableCrosswalk] of schemaCrosswalk.tables.entries()) {
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

    let listRecordsResult = await listRecords(base, tableId, {});

    while (listRecordsResult.records.length > 0) {
      const { records } = listRecordsResult;

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

      listRecordsResult = await listRecordsResult.fetchNextPage();
    }
  }

  // Future improvement - report all errors here using Promise.allSettled, or continue even if
  //                      a few sets of rows throw errors
  await Promise.all(addRowsPromises);

  for (const tableReferenceTracker of referenceTracker.getTables()) {
    await tableReferenceTracker.bulkUpdateRowsWithUnresolvedReferences(updateRows);
  }
}

export class ReferenceTracker {
  // Maps known airtable ids to their grist row ids to enable reference resolution.
  // Airtable row ids are guaranteed unique within a base.
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
        await updateRows(this._tableId, pendingUpdate);
        pendingUpdate = { id: [], ...createEmptyBulkColValues(this._columnIds) };
      }
    }

    if (pendingUpdate.id.length > 0) {
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
  multipleAttachments(fieldSchema, attachmentInfo) {
    // Improvement - add attachment support, null them out for now.
    return null;
  },
  multipleCollaborators(fieldSchema, collaborators) {
    const formattedCollaborators = collaborators?.map(formatCollaborator);
    if (!formattedCollaborators) { return null; }
    return formattedCollaborators.join(", ");
  },
  singleCollaborator(fieldSchema, collaborator) {
    return formatCollaborator(collaborator);
  },
  multipleSelects(fieldSchema, choices?: string[]) {
    if (!choices) { return null; }
    return [GristObjCode.List, ...choices];
  },
  rollup(fieldSchema, collaborator) {
    // Generated column - should be a formula in Grist, no value needed
    return null;
  },
};

const formatCollaborator = (collaborator: any) => collaborator?.name;
