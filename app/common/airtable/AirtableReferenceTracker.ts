import { AirtableFieldSchema } from "app/common/airtable/AirtableAPITypes";
import { AirtableFieldMappingInfo } from "app/common/airtable/AirtableCrosswalk";
import { UpdateRowsFunc } from "app/common/airtable/AirtableDataImporterTypes";
import { TableColValues } from "app/common/DocActions";
import { isNonNullish } from "app/common/gutil";
import { BulkColValues, GristObjCode } from "app/plugin/GristData";

import { chain } from "lodash";

export type RefValuesByColumnId = Record<string, string[] | undefined>;

interface UnresolvedRefsForRecord {
  gristRecordId: number;
  refsByColumnId: RefValuesByColumnId;
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

export function isRefField(field: AirtableFieldSchema) {
  return field.type === "multipleRecordLinks";
}

export function extractRefFromRecordField(
  fieldValue: any,
  fieldMapping: AirtableFieldMappingInfo,
): string[] | undefined {
  if (fieldMapping.airtableField.type === "multipleRecordLinks") {
    return fieldValue;
  }
  return undefined;
}

export function createEmptyBulkColValues(columnIds: string[]): BulkColValues {
  return chain(columnIds).keyBy().mapValues(() => []).value();
}
