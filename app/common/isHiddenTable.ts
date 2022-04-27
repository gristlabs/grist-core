import {UIRowId} from 'app/common/UIRowId';
import {TableData} from "./TableData";

/**
 * Return whether a table identified by the rowId of its metadata record, should normally be
 * hidden from the user (e.g. as an option in the page-widget picker).
 */
export function isHiddenTable(tablesData: TableData, tableRef: UIRowId): boolean {
  const tableId = tablesData.getValue(tableRef, 'tableId') as string|undefined;
  return !isRawTable(tablesData, tableRef) || Boolean(tableId?.startsWith('GristHidden'));
}

/**
 * Return whether a table identified by the rowId of its metadata record should be visible on Raw Data page.
 */
export function isRawTable(tablesData: TableData, tableRef: UIRowId): boolean {
  return tablesData.getValue(tableRef, 'summarySourceTable') === 0;
}
