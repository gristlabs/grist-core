import { AirtableFieldSchema } from "app/common/airtable/AirtableAPITypes";
import { AirtableFieldMappingInfo } from "app/common/airtable/AirtableCrosswalk";
import { UpdateRowsFunc } from "app/common/airtable/AirtableDataImporterTypes";
import { TableColValues } from "app/common/DocActions";
import { isNonNullish } from "app/common/gutil";
import { BulkColValues, GristObjCode } from "app/plugin/GristData";

export type RefValuesByColumnId = Record<string, string[] | undefined>;

interface UnresolvedRefsForRecord {
  gristRecordId: number;
  refsByColumnId: RefValuesByColumnId;
}

interface RefColumn {
  tableId?: string;
  id: string;
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

  public addTable(gristTableId: string, columnIdsToUpdate: RefColumn[], options: { airtableIdColumnId?: string } = {}) {
    const tableTracker = new TableReferenceTracker(this, gristTableId, columnIdsToUpdate, options);
    this._tableReferenceTrackers.set(gristTableId, tableTracker);
    return tableTracker;
  }

  public getTable(gristTableId: string): TableReferenceTracker | undefined {
    return this._tableReferenceTrackers.get(gristTableId);
  }

  public getTables(): TableReferenceTracker[] {
    return Array.from(this._tableReferenceTrackers.values());
  }
}

// Store and resolve references per-table to enable bulk updates.
export class TableReferenceTracker {
  public readonly airtableIdColumnId?: string;
  private _unresolvedRefsForRecords: UnresolvedRefsForRecord[] = [];

  // To perform bulk updates, all reference columns need updating at the same time.
  // Enforce this by explicitly listing the column ids to use during instantiation.
  public constructor(
    private _parent: ReferenceTracker,
    private _tableId: string,
    private _refColumns: RefColumn[],
    _options: { airtableIdColumnId?: string } = {}) {
    this.airtableIdColumnId = _options.airtableIdColumnId;
  }

  public addUnresolvedRecord(unresolvedRefsForRecord: UnresolvedRefsForRecord) {
    this._unresolvedRefsForRecords.push(unresolvedRefsForRecord);
  }

  public async bulkUpdateRowsWithUnresolvedReferences(
    updateRows: UpdateRowsFunc,
    options?: { batchSize?: number },
  ) {
    const batchSize = options?.batchSize ?? 100;
    const refColumnIds = this._refColumns.map(col => col.id);

    let pendingUpdate: TableColValues = { id: [], ...createEmptyBulkColValues(refColumnIds) };

    for (const unresolvedRefsForRecord of this._unresolvedRefsForRecords) {
      pendingUpdate.id.push(unresolvedRefsForRecord.gristRecordId);

      // Every row needs an entry in its respective column in the bulk update, so always loop through
      // the same columns for every row.
      for (const column of this._refColumns) {
        const references = unresolvedRefsForRecord.refsByColumnId[column.id];
        // TODO - Unresolvable references are currently just skipped silently. Find a way to display
        //        them in the cell / UI.
        if (!references) {
          pendingUpdate[column.id].push([GristObjCode.List]);
          continue;
        }

        // If there's an Airtable ID column, the sandbox can perform the lookup for us.
        const otherTableAirtableIdColumnId =
          column.tableId && this._parent.getTable(column.tableId)?.airtableIdColumnId;

        if (otherTableAirtableIdColumnId) {
          pendingUpdate[column.id].push(
            [GristObjCode.LookUp, references, { column: otherTableAirtableIdColumnId }],
          );
          continue;
        }

        const resolvedReferences =
          references.map(originalRecordId => this._parent.resolve(originalRecordId)).filter(isNonNullish);

        pendingUpdate[column.id].push(
          [GristObjCode.List, ...resolvedReferences],
        );
      }

      if (pendingUpdate.id.length >= batchSize) {
        await updateRows(this._tableId, pendingUpdate);
        pendingUpdate = { id: [], ...createEmptyBulkColValues(refColumnIds) };
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

export function getRefFieldLinkedTableId(field: AirtableFieldSchema): string | undefined {
  return field.options?.linkedTableId;
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
  return Object.fromEntries(columnIds.map(id => [id, []]));
}
