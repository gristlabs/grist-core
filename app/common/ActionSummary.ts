import {CellDelta, TabularDiff, TabularDiffs} from 'app/common/TabularDiff';
import toPairs = require('lodash/toPairs');

/**
 * An ActionSummary represents the overall effect of changes that took place
 * during a period of history.
 *   - Only net changes are represented.  Intermediate changes within the period are
 *     not represented.  Changes that are done and undone within the period are not
 *     represented.
 *   - Net addition, removal, and renaming of tables is represented.  The names
 *     of tables, for ActionSummary purposes are their tableIds, the database-safe
 *     version of their names.
 *   - Net addition, removal, and renaming of columns is represented.  As for tables,
 *     the names of columns for ActionSummary purposes are their colIds.
 *   - Net additions and removals of rows are partially represented.  The rowIds of added
 *     and removed rows are represented fully.  The *values* of cells in the rows that
 *     were added or removed are stored in some cases.  There is a threshold on the
 *     number of rows whose values will be cached for each DocAction scanned.
 *   - Net updates of rows are partially represented.  The rowIds of updated rows are
 *     represented fully, but the *values* of updated cells partially, as for additions/
 *     removals.
 *   - Cell value changes affecting _grist_* tables are always represented in full,
 *     even if they are bulk changes.
 *
 * The representation of table name changes and column name changes is the same,
 * simply a list of name pairs [before, after].  We represent the addition of a
 * a table (or column) as the special name pair [null, initialName], and the
 * removal of a table (or column) as the special name pair [finalName, null].
 *
 * An ActionSummary contains two fields:
 *   - tableRenames: a list of table name changes (including addition/removal).
 *   - tableDeltas: a dictionary of changes within a table.
 *
 * The key of the tableDeltas dictionary is the name of a table at the end of the
 * period of history covered by the ActionSummary.
 *   - For example, if we add a table called N, we use the key N for it.
 *   - If we rename a table from N1 to N2, we use the key N2 for it.
 *   - If we add a table called N1, then rename it to N2, we use the key N2 for it.
 * If the table was removed during that period, we use its name at the beginning
 * of the period, preceded by "-".
 *   - If we remove a table called N, we use the key -N for it.
 *   - If we add a table called N, then remove it, there is no net change to represent.
 *   - If we remove a table called N, then add a new table called N, we use the key -N
 *     for the first, and the key N for the second.
 *
 * The changes within a table are represented as a TableDelta, which has the following
 * fields:
 *   - columnRenames: a list of column name changes (including addition/removal).
 *   - columnDeltas: a dictionary of changes within a column.
 *   - updateRows, removeRows, addRows: lists of affected rows.
 *
 * The columnRenames/columnDeltas pair work just like tableRenames/tableDeltas, just
 * on the scope of columns within a table rather than tables within a document.
 *
 * The changes within a column are represented as a ColumnDelta, which is a dictionary
 * keyed by rowIds.  It contains CellDelta values.  CellDelta values represent before
 * and after values of a particular cell.
 *   - a CellDelta of [null, [value]] represents a cell that was non-existent coming into
 *     existence with the given value.
 *   - a CellDelta of [[value], null] represents an existing cell with the given value that
 *     is removed.
 *   - a CellDelta of [[value1], [value2]] represents a change in value of a cell between
 *     two known values.
 *   - a CellDelta of ['?', [value2]] represents a change in value of a cell from an
 *     unknown value to a known value.  Unknown values happen when we know a cell was
 *     implicated in a bulk change but its value didn't happen to be stored.
 *   - a CellDelta of [[value1], '?'] represents a change in value of a cell from an
 *     known value to an unknown value.
 * The CellDelta itself does not tell you whether the rowId has the same identity before
 * and after -- for example it may have been removed and then added.  That information
 * is available by consulting the removeRows and addRows fields.
 *
 */

/**
 * A collection of changes related to a set of tables.
 */
export interface ActionSummary {
  tableRenames: LabelDelta[];  /** a list of table renames/additions/removals */
  tableDeltas: {[tableId: string]: TableDelta};  /** changes within an individual table */
}

/**
 * A collection of changes related to rows and columns of a single table.
 */
export interface TableDelta {
  updateRows: number[];  /** rowIds of rows that exist before+after and were changed during */
  removeRows: number[];  /** rowIds of rows that existed before but were removed during */
  addRows: number[];     /** rowIds of rows that were added during, and exist after */
  /** Partial record of cell-level changes - large bulk changes not included. */
  columnDeltas: {[colId: string]: ColumnDelta};
  columnRenames: LabelDelta[];  /** a list of column renames/additions/removals */
}

/**
 * Pairs of before/after names of tables and columns.  Null represents non-existence,
 * so the addition and removal of tables/columns can be represented.
 */
export type LabelDelta = [string|null, string|null];

/**
 * A collection of changes related to cells in a specific column.
 */
export interface ColumnDelta {
  [rowId: number]: CellDelta;
}


/** Create an ActionSummary for a period with no action */
export function createEmptyActionSummary(): ActionSummary {
  return { tableRenames: [], tableDeltas: {} };
}

/** Create a TableDelta for a period with no action */
export function createEmptyTableDelta(): TableDelta {
  return {
    updateRows: [],
    removeRows: [],
    addRows: [],
    columnDeltas: {},
    columnRenames: []
  };
}


/**
 * Distill a summary further, into tabular form, for ease of rendering.
 */
export function asTabularDiffs(summary: ActionSummary): TabularDiffs {
  const allChanges: TabularDiffs = {};
  for (const [tableId, td] of toPairs(summary.tableDeltas)) {
    const tableChanges: TabularDiff = allChanges[tableId] = {
      header: [],
      cells: [],
    };
    // swap order to row-dominant for visualization purposes
    const perRow: {[row: number]: {[name: string]: any}} = {};
    const activeCols = new Set<string>();
    // iterate through the column-dominant representation grist prefers internally
    for (const [col, perCol] of toPairs(td.columnDeltas)) {
      activeCols.add(col);
      // iterate through the rows for that column, writing out the row-dominant
      // results we want for visualization.
      for (const row of Object.keys(perCol)) {
        if (!perRow[row as any]) { perRow[row as any] = {}; }
        perRow[row as any][col] = perCol[row as any];
      }
    }
    // TODO: recover order of columns; recover row numbers (as opposed to rowIds)
    const activeColsWithoutManualSort = [...activeCols].filter(c => c !== 'manualSort');
    tableChanges.header = activeColsWithoutManualSort;
    const addedRows = new Set(td.addRows);
    const removedRows = new Set(td.removeRows);
    const updatedRows = new Set(td.updateRows);
    const rowIds = Object.keys(perRow).map(row => parseInt(row, 10));
    const presentRows = new Set(rowIds);
    const droppedRows = [...addedRows, ...removedRows, ...updatedRows]
      .filter(x => !presentRows.has(x))
      .sort((a, b) => a - b);

    // Now that we have pulled together rows of changes, we will add a summary cell
    // to each row to show whether they were caused by row updates, additions or removals.
    // We also at this point make sure the cells of the row are output in a consistent
    // order with a header.
    for (const rowId of rowIds) {
      if (droppedRows.length > 0) {
        // Bulk additions/removals/updates may result in just some rows being saved.
        // We signal this visually with a "..." row.  The order of where this should
        // go isn't well defined at this point (there's a row number TODO above).
        if (rowId > droppedRows[0]) {
          tableChanges.cells.push(['...', droppedRows[0],
                                   activeColsWithoutManualSort.map(x => [null, null] as [null, null])]);
          while (rowId > droppedRows[0]) {
            droppedRows.shift();
          }
        }
      }
      // For each rowId, we need to issue either 1 or 2 rows.  We issue 2 rows
      // if the rowId is both added and removed - in this scenario, the rows
      // before and after are unrelated.  In all other cases, the before and
      // after values refer to the same row.
      const versions: Array<[string, (diff: CellDelta) => CellDelta]> = [];
      if (addedRows.has(rowId) && removedRows.has(rowId)) {
        versions.push(['-', (diff) => [diff[0], null]]);
        versions.push(['+', (diff) => [null, diff[1]]]);
      } else {
        let code: string = '...';
        if (updatedRows.has(rowId)) { code = '→'; }
        if (addedRows.has(rowId))   { code = '+';  }
        if (removedRows.has(rowId)) { code = '-';  }
        versions.push([code, (diff) => diff]);
      }
      for (const [code, transform] of versions) {
        const acc: CellDelta[] = [];
        const perCol = perRow[rowId];
        activeColsWithoutManualSort.forEach(col => {
          const diff = perCol ? perCol[col] : null;
          if (!diff) {
            acc.push([null, null]);
          } else {
            acc.push(transform(diff));
          }
        });
        tableChanges.cells.push([code, rowId, acc]);
      }
    }
  }
  return allChanges;
}

/**
 * Return a suitable key for a removed table/column.  We cannot use their id directly
 * since it could clash with an added table/column of the same name.
 */
export function defunctTableName(id: string): string {
  return `-${id}`;
}

export function rootTableName(id: string): string {
  return id.replace('-', '');
}

/**
 * Returns a list of all tables changed by the summarized action.  Changes include
 * schema or data changes.  Tables are identified by their post-action name.
 * Deleted tables are identified by their pre-action name, with "-" prepended.
 */
export function getAffectedTables(summary: ActionSummary): string[] {
  return [
    // Tables added, renamed, or removed in this action.
    ...summary.tableRenames.map(pair => pair[1] || defunctTableName(pair[0] || "")),
    // Tables modified in this action.
    ...Object.keys(summary.tableDeltas)
  ];
}

/**
 * Given a tableId from after the specified renames, figure out what the tableId was before
 * the renames.  Returns null if table didn't exist.
 */
export function getTableIdBefore(renames: LabelDelta[], tableIdAfter: string|null): string|null {
  if (tableIdAfter === null) { return tableIdAfter; }
  const rename = renames.find(_rename => _rename[1] === tableIdAfter);
  return rename ? rename[0] : tableIdAfter;
}

/**
 * Given a tableId from before the specified renames, figure out what the tableId is after
 * the renames.  Returns null if there is no valid tableId to return.
 */
export function getTableIdAfter(renames: LabelDelta[], tableIdBefore: string|null): string|null {
  if (tableIdBefore === null) { return tableIdBefore; }
  const rename = renames.find(_rename => _rename[0] === tableIdBefore);
  const tableIdAfter = rename ? rename[1] : tableIdBefore;
  if (tableIdAfter?.startsWith('-')) { return null; }
  return tableIdAfter;
}
