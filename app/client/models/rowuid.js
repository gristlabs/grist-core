/**
 * For some purposes, we need to identify rows uniquely across different tables, e.g. when showing
 * data with subtotals. This module implements a simple and reasonably efficient way to combine a
 * tableRef and rowId into a single numeric identifier.
 */



// A JS Number can represent integers exactly up to 53 bits. We use some of those bits to
// represent tableRef (the rowId of the table in _grist_Tables meta table), and the rest to
// represent rowId in the table. Note that we currently never reuse old ids, so these limits apply
// to the count of all tables or all rows per table that ever existed, including deleted ones.
const MAX_TABLES = Math.pow(2, 18);     // Up to ~262k tables.
const MAX_ROWS = Math.pow(2, 35);       // Up to ~34 billion rows.
exports.MAX_TABLES = MAX_TABLES;
exports.MAX_ROWS = MAX_ROWS;

/**
 * Given tableRef and rowId, returns a Number combining them.
 */
function combine(tableRef, rowId) {
  return tableRef * MAX_ROWS + rowId;
}
exports.combine = combine;

/**
 * Given a combined rowUid, returns the tableRef it represents.
 */
function tableRef(rowUid) {
  return Math.floor(rowUid / MAX_ROWS);
}
exports.tableRef = tableRef;

/**
 * Given a combined rowUid, returns the rowId it represents.
 */
function rowId(rowUid) {
  return rowUid % MAX_ROWS;
}
exports.rowId = rowId;

/**
 * Returns a human-readable string representation of the rowUid, as "tableRef:rowId".
 */
function toString(rowUid) {
  return typeof rowUid === 'number' ? tableRef(rowUid) + ":" + rowId(rowUid) : rowUid;
}
exports.toString = toString;
