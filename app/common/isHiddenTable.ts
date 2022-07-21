import {TableData} from 'app/common/TableData';
import {UIRowId} from 'app/common/UIRowId';

/**
 * Return whether a table (identified by the rowId of its metadata record) should
 * normally be hidden from the user (e.g. as an option in the page-widget picker).
 */
export function isHiddenTable(tablesData: TableData, tableRef: UIRowId): boolean {
  const tableId = tablesData.getValue(tableRef, 'tableId') as string|undefined;
  return !tableId || isSummaryTable(tablesData, tableRef) || tableId.startsWith('GristHidden_');
}

/**
 * Return whether a table (identified by the rowId of its metadata record) is a
 * summary table.
 */
export function isSummaryTable(tablesData: TableData, tableRef: UIRowId): boolean {
  return tablesData.getValue(tableRef, 'summarySourceTable') !== 0;
}
