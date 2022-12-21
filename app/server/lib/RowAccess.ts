import { AddRecord, BulkAddRecord, BulkRemoveRecord, BulkUpdateRecord,
         DocAction, getTableId, RemoveRecord, ReplaceTableData,
         TableDataAction, UpdateRecord } from "app/common/DocActions";
import { getSetMapValue } from "app/common/gutil";

/**
 * A little class for tracking pre-existing rows touched by a sequence of DocActions for
 * a given table.
 */
class RowIdTracker {
  public blockedIds = new Set<number>();  // row ids minted within the DocActions (so NOT pre-existing).
  public blocked: boolean = false;        // set if all pre-existing rows are wiped/
  public ids = new Set<number>();         // set of pre-existing rows touched.
}

/**
 * This gets a list of pre-existing rows that the DocActions may touch.  Returns
 * a list of form [tableId, Set{rowId1, rowId2, ...}].
 */
export function getRelatedRows(docActions: DocAction[]): ReadonlyArray<readonly [string, Set<number>]> {
  // Relate tableIds for tables with what they were before the actions, if renamed.
  const tableIds = new Map<string, string>();      // key is current tableId
  const rowIds = new Map<string, RowIdTracker>();  // key is pre-existing tableId
  const addedTables = new Set<string>();  // track newly added tables to ignore; key is current tableId
  for (const docAction of docActions) {
    const currentTableId = getTableId(docAction);
    const tableId = tableIds.get(currentTableId) || currentTableId;
    if (docAction[0] === 'RenameTable') {
      if (addedTables.has(currentTableId)) {
        addedTables.delete(currentTableId);
        addedTables.add(docAction[2]);
        continue;
      }
      tableIds.delete(currentTableId);
      tableIds.set(docAction[2], tableId);
      continue;
    }
    if (docAction[0] === 'AddTable') {
      addedTables.add(currentTableId);
    }
    if (docAction[0] === 'RemoveTable') {
      addedTables.delete(currentTableId);
      continue;
    }
    if (addedTables.has(currentTableId)) { continue; }

    // tableId will now be that prior to docActions, regardless of renames.
    const tracker = getSetMapValue(rowIds, tableId, () => new RowIdTracker());

    if (docAction[0] === 'RemoveRecord' || docAction[0] === 'BulkRemoveRecord' ||
        docAction[0] === 'UpdateRecord' || docAction[0] === 'BulkUpdateRecord') {
      // All row ids mentioned are external, unless created within this set of DocActions.
      if (!tracker.blocked) {
        for (const id of getRowIdsFromDocAction(docAction)) {
          if (!tracker.blockedIds.has(id)) { tracker.ids.add(id); }
        }
      }
    } else if (docAction[0] === 'AddRecord' || docAction[0] === 'BulkAddRecord') {
      // All row ids mentioned are created within this set of DocActions, and are not external.
      for (const id of getRowIdsFromDocAction(docAction)) { tracker.blockedIds.add(id); }
    } else if (docAction[0] === 'ReplaceTableData' || docAction[0] === 'TableData') {
      // No pre-existing rows can be referred to for this table from now on.
      tracker.blocked = true;
    }
  }

  return [...rowIds.entries()].map(([tableId, tracker]) => [tableId, tracker.ids] as const);
}

/**
 * Tiny helper to get the row ids mentioned in a record-related DocAction as a list
 * (even if the action is not a bulk action).
 */
export function getRowIdsFromDocAction(docActions: RemoveRecord | BulkRemoveRecord | AddRecord |
                                       BulkAddRecord | UpdateRecord | BulkUpdateRecord | ReplaceTableData |
                                       TableDataAction) {
  const ids = docActions[2];
  return (typeof ids === 'number') ? [ids] : ids;
}
