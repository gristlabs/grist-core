/**
 *
 * Types for use when summarizing differences between versions of a table, with the
 * diff itself presented in tabular form.
 *
 */


/**
 * Pairs of before/after values of cells. Values, when present, are nested in a trivial
 * list since they can be literally anything - null, undefined, etc.  Otherwise they
 * are either null, meaning non-existent, or "?", meaning unknown.  Non-existent values
 * appear prior to a table/column being created, or after it has been destroyed.
 * Unknown values appear when they are omitted from summaries of bulk actions, and those
 * summaries are then merged with others.
 */
export type CellDelta = [[any]|"?"|null, [any]|"?"|null];

/** a special column indicating what changes happened on row (addition, update, removal) */
export type RowChangeType = string;

/** differences for an individual table */
export interface TabularDiff {
  header: string[];  /** labels for columns */
  cells: Array<[RowChangeType, number, CellDelta[]]>;  // "number" is rowId
}

/** differences for a collection of tables */
export interface TabularDiffs {
  [tableId: string]: TabularDiff;
}
