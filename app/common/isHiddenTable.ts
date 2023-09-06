import {TableData} from 'app/common/TableData';
import {UIRowId} from 'app/plugin/GristAPI';

/**
 * Return whether a table (identified by the rowId of its metadata record) should
 * normally be hidden from the user (e.g. as an option in the page-widget picker).
 */
export function isHiddenTable(tablesData: TableData, tableRef: UIRowId): boolean {
  const tableId = tablesData.getValue(tableRef, 'tableId') as string|undefined;
  // The `!tableId` check covers the case of censored tables (see isTableCensored() below).
  return !tableId || isSummaryTable(tablesData, tableRef) || tableId.startsWith('GristHidden_');
}

/**
 * Return whether a table (identified by the rowId of its metadata record) is a
 * summary table.
 */
export function isSummaryTable(tablesData: TableData, tableRef: UIRowId): boolean {
  return tablesData.getValue(tableRef, 'summarySourceTable') !== 0;
}

// Check if a table record (from _grist_Tables) is censored.
// Metadata records get censored by clearing certain of their fields, so it's expected that a
// record may exist even though various code should consider it as hidden.
export function isTableCensored(tablesData: TableData, tableRef: UIRowId): boolean {
  const tableId = tablesData.getValue(tableRef, 'tableId');
  return !tableId;
}
