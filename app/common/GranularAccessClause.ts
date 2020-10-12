/**
 * All possible access clauses.  There aren't all that many yet.
 * In future the clauses will become more generalized, and start specifying
 * the principle / properties of the user to which they apply.
 */
export type GranularAccessClause =
  GranularAccessDocClause |
  GranularAccessTableClause |
  GranularAccessRowClause;

/**
 * A clause that forbids anyone but owners from modifying the document structure.
 */
export interface GranularAccessDocClause {
  kind: 'doc';
  rule: 'only-owner-can-modify-structure';
}

/**
 * A clause that forbids anyone but owners from accessing a particular table.
 */
export interface GranularAccessTableClause {
  kind: 'table';
  tableId: string;
  rule: 'only-owner-can-access';
}

/**
 * A clause that forbids anyone but owners from editing a particular table
 * or viewing rows for which the named column contains a falsy value.
 */
export interface GranularAccessRowClause {
  kind: 'row';
  tableId: string;
  colId: string;
  rule: 'only-owner-can-edit-table-and-access-all-rows';
}
