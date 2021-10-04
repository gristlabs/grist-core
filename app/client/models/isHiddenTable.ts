import {RowId} from 'app/client/models/rowset';
import {TableData} from 'app/client/models/TableData';

/**
 * Return whether a table identified by the rowId of its metadata record, should normally be
 * hidden from the user (e.g. as an option in the page-widget picker).
 */
export function isHiddenTable(tablesData: TableData, tableRef: RowId): boolean {
  const tableId = tablesData.getValue(tableRef, 'tableId') as string|undefined;
  return tablesData.getValue(tableRef, 'summarySourceTable') !== 0 ||
    Boolean(tableId?.startsWith('GristHidden'));
}
