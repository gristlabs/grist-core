import { AddRecord, BulkAddRecord, BulkRemoveRecord, BulkUpdateRecord,
         getColIdsFromDocAction, getColValuesFromDocAction,
         getTableId, RemoveRecord, ReplaceTableData, TableDataAction,
         UpdateRecord } from 'app/common/DocActions';
import { DocData } from 'app/common/DocData';
import { isNumber } from 'app/common/gutil';

/**
 * Represent current attachment columns as a map from tableId to a set of
 * colIds.
 */
export type AttachmentColumns = Map<string, Set<string>>;

/**
 * Enumerate attachment columns, represented as a map from tableId to
 * a set of colIds.
 */
export function getAttachmentColumns(metaDocData: DocData): AttachmentColumns {
  const tablesTable = metaDocData.getMetaTable('_grist_Tables');
  const columnsTable = metaDocData.getMetaTable('_grist_Tables_column');
  const attachmentColumns: Map<string, Set<string>> = new Map();
  for (const column of columnsTable.filterRecords({type: 'Attachments'})) {
    const table = tablesTable.getRecord(column.parentId);
    const tableId = table?.tableId;
    if (!tableId) {
      /* should never happen */
      throw new Error('table not found');
    }
    if (!attachmentColumns.has(tableId)) {
      attachmentColumns.set(tableId, new Set());
    }
    attachmentColumns.get(tableId)!.add(column.colId);
  }
  return attachmentColumns;
}

/**
 * Get IDs of attachments that are present in attachment columns in an action.
 */
export function gatherAttachmentIds(
  attachmentColumns: AttachmentColumns,
  action: AddRecord | BulkAddRecord | UpdateRecord | BulkUpdateRecord |
    RemoveRecord | BulkRemoveRecord | ReplaceTableData | TableDataAction
): Set<number> {
  const tableId = getTableId(action);
  const attColumns = attachmentColumns.get(tableId);
  const colIds = getColIdsFromDocAction(action) || [];
  const attIds = new Set<number>();
  if (!attColumns || !colIds.some(colId => attColumns.has(colId))) {
    return attIds;
  }
  for (const colId of colIds) {
    if (!attColumns.has(colId)) { continue; }
    const values = getColValuesFromDocAction(action, colId);
    if (!values) { continue; }
    for (const v of values) {
      // We expect an array. What should we do with other types?
      // If we were confident no part of Grist would interpret non-array
      // values as attachment ids, then we should let them be added, as
      // part of Grist's spreadsheet-style willingness to allow invalid
      // data. I decided to go ahead and require that numbers or number-like
      // strings should be checked as if they were attachment ids, just in
      // case. But if this proves awkward for someone, it could be reasonable
      // to only check ids in an array after confirming Grist is strict in
      // how it interprets material in attachment cells.
      if (typeof v === 'number') {
        attIds.add(v);
      } else if (Array.isArray(v)) {
        for (const p of v) {
          if (typeof p === 'number') {
            attIds.add(p);
          }
        }
      } else if (typeof v === 'boolean' || v === null) {
        // Nothing obvious to do here.
      } else if (isNumber(v)) {
        attIds.add(Math.round(parseFloat(v)));
      }
    }
  }
  return attIds;
}
