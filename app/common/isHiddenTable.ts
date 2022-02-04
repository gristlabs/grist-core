import {UIRowId} from 'app/common/UIRowId';
import {TableData} from "./TableData";

/**
 * Return whether a table identified by the rowId of its metadata record, should normally be
 * hidden from the user (e.g. as an option in the page-widget picker).
 */
export function isHiddenTable(tablesData: TableData, tableRef: UIRowId): boolean {
  const tableId = tablesData.getValue(tableRef, 'tableId') as string|undefined;
  return tablesData.getValue(tableRef, 'summarySourceTable') !== 0 ||
    Boolean(tableId?.startsWith('GristHidden'));
}
