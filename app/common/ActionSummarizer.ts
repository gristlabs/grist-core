import {getEnvContent, LocalActionBundle} from 'app/common/ActionBundle';
import {ActionSummary, ColumnDelta, createEmptyActionSummary,
        createEmptyTableDelta, defunctTableName, LabelDelta, TableDelta} from 'app/common/ActionSummary';
import {DocAction} from 'app/common/DocActions';
import * as Action from 'app/common/DocActions';
import {arrayExtend} from 'app/common/gutil';
import {CellDelta} from 'app/common/TabularDiff';
import fromPairs = require('lodash/fromPairs');
import keyBy = require('lodash/keyBy');
import sortBy = require('lodash/sortBy');
import toPairs = require('lodash/toPairs');
import values = require('lodash/values');

/**
 * The default maximum number of rows in a single bulk change that will be recorded
 * individually.  Bulk changes that touch more than this number of rows
 * will be summarized only by the number of rows touched.
 */
const MAXIMUM_INLINE_ROWS = 10;

/**
 * Options when producing an action summary.
 */
export interface ActionSummaryOptions {
  maximumInlineRows?: number;       // Overrides the maximum number of rows in a
                                    // single bulk change that will be recorded individually.
  alwaysPreserveColIds?: string[];  // If set, all cells in these columns are preserved
                                    // regardless of maximumInlineRows setting.
}

class ActionSummarizer {

  constructor(private _options?: ActionSummaryOptions) {}

  /** add information about an action based on the forward direction */
  public addForwardAction(summary: ActionSummary, act: DocAction) {
    const tableId = act[1];
    if (Action.isAddTable(act)) {
      summary.tableRenames.push([null, tableId]);
      for (const info of act[2]) {
        this._forTable(summary, tableId).columnRenames.push([null, info.id]);
      }
    } else if (Action.isRenameTable(act)) {
      this._addRename(summary.tableRenames, [tableId, act[2]]);
    } else if (Action.isRenameColumn(act)) {
      this._addRename(this._forTable(summary, tableId).columnRenames, [act[2], act[3]]);
    } else if (Action.isAddColumn(act)) {
      this._forTable(summary, tableId).columnRenames.push([null, act[2]]);
    } else if (Action.isRemoveColumn(act)) {
      this._forTable(summary, tableId).columnRenames.push([act[2], null]);
    } else if (Action.isAddRecord(act)) {
      const td = this._forTable(summary, tableId);
      td.addRows.push(act[2]);
      this._addRow(td, act[2], act[3], 1);
    } else if (Action.isUpdateRecord(act)) {
      const td = this._forTable(summary, tableId);
      td.updateRows.push(act[2]);
      this._addRow(td, act[2], act[3], 1);
    } else if (Action.isBulkAddRecord(act)) {
      const td = this._forTable(summary, tableId);
      arrayExtend(td.addRows, act[2]);
      this._addRows(tableId, td, act[2], act[3], 1);
    } else if (Action.isBulkUpdateRecord(act)) {
      const td = this._forTable(summary, tableId);
      arrayExtend(td.updateRows, act[2]);
      this._addRows(tableId, td, act[2], act[3], 1);
    } else if (Action.isReplaceTableData(act)) {
      const td = this._forTable(summary, tableId);
      arrayExtend(td.addRows, act[2]);
      this._addRows(tableId, td, act[2], act[3], 1);
    }
  }

  /** add information about an action based on undo information */
  public addReverseAction(summary: ActionSummary, act: DocAction) {
    const tableId = act[1];
    if (Action.isAddTable(act)) { // undoing, so this is a table removal
      summary.tableRenames.push([tableId, null]);
      for (const info of act[2]) {
        this._forTable(summary, tableId).columnRenames.push([info.id, null]);
      }
    } else if (Action.isAddRecord(act)) { // undoing, so this is a record removal
      const td = this._forTable(summary, tableId);
      td.removeRows.push(act[2]);
      this._addRow(td, act[2], act[3], 0);
    } else if (Action.isUpdateRecord(act)) { // undoing, so this is reversal of a record update
      const td = this._forTable(summary, tableId);
      this._addRow(td, act[2], act[3], 0);
    } else if (Action.isBulkAddRecord(act)) { // undoing, this may be reversing a table delete
      const td = this._forTable(summary, tableId);
      arrayExtend(td.removeRows, act[2]);
      this._addRows(tableId, td, act[2], act[3], 0);
    } else if (Action.isBulkUpdateRecord(act)) { // undoing, so this is reversal of a bulk record update
      const td = this._forTable(summary, tableId);
      arrayExtend(td.updateRows, act[2]);
      this._addRows(tableId, td, act[2], act[3], 0);
    } else if (Action.isRenameTable(act)) { // undoing - sometimes renames only in undo info
      this._addRename(summary.tableRenames, [act[2], tableId]);
    } else if (Action.isRenameColumn(act)) { // undoing - sometimes renames only in undo info
      this._addRename(this._forTable(summary, tableId).columnRenames, [act[3], act[2]]);
    } else if (Action.isReplaceTableData(act)) { // undoing
      const td = this._forTable(summary, tableId);
      arrayExtend(td.removeRows, act[2]);
      this._addRows(tableId, td, act[2], act[3], 0);
    }
  }

  /** helper function to access summary changes for a specific table by name */
  private _forTable(summary: ActionSummary, tableId: string): TableDelta {
    return summary.tableDeltas[tableId] || (summary.tableDeltas[tableId] = createEmptyTableDelta());
  }

  /** helper function to access summary changes for a specific cell by rowId and colId */
  private _forCell(td: TableDelta, rowId: number, colId: string): CellDelta {
    const cd = td.columnDeltas[colId] || (td.columnDeltas[colId] = {});
    return cd[rowId] || (cd[rowId] = [null, null]);
  }

  /**
   * helper function to store detailed cell changes for a single row.
   * Direction parameter is 0 if values are prior values of cells, 1 if values are new values.
   */
  private _addRow(td: TableDelta, rowId: number, colValues: Action.ColValues,
                direction: 0|1) {
    for (const [colId, colChanges] of toPairs(colValues)) {
      const cell = this._forCell(td, rowId, colId);
      cell[direction] = [colChanges];
    }
  }

  /** helper function to store detailed cell changes for a set of rows */
  private _addRows(tableId: string, td: TableDelta, rowIds: number[],
                 colValues: Action.BulkColValues, direction: 0|1) {
    const maximumInlineRows = this._options?.maximumInlineRows || MAXIMUM_INLINE_ROWS;
    const limitRows: boolean = rowIds.length > maximumInlineRows && !tableId.startsWith("_grist_");
    let selectedRows: Array<[number, number]> = [];
    if (limitRows) {
      // if many rows, just take some from start and one from end as examples
      selectedRows = [...rowIds.slice(0, maximumInlineRows - 1).entries()];
      selectedRows.push([rowIds.length - 1, rowIds[rowIds.length - 1]]);
    }

    const alwaysPreserveColIds = new Set(this._options?.alwaysPreserveColIds || []);
    for (const [colId, colChanges] of toPairs(colValues)) {
      const addCellToSummary = (rowId: number, idx: number) => {
        const cell = this._forCell(td, rowId, colId);
        cell[direction] = [colChanges[idx]];
      };
      if (!limitRows || alwaysPreserveColIds.has(colId)) {
        rowIds.forEach(addCellToSummary);
      } else {
        selectedRows.forEach(([idx, rowId]) => addCellToSummary(rowId, idx));
      }
    }
  }

  /** add a rename to a list, avoiding duplicates */
  private _addRename(renames: LabelDelta[], rename: LabelDelta) {
    if (renames.find(r => r[0] === rename[0] && r[1] === rename[1])) { return; }
    renames.push(rename);
  }
}

/**
 * Summarize the tabular changes that a LocalActionBundle results in, in a form
 * that will be suitable for composition.
 */
export function summarizeAction(body: LocalActionBundle, options?: ActionSummaryOptions): ActionSummary {
  return summarizeStoredAndUndo(getEnvContent(body.stored), body.undo, options);
}

export function summarizeStoredAndUndo(stored: DocAction[], undo: DocAction[],
                                       options?: ActionSummaryOptions): ActionSummary {
  const summarizer = new ActionSummarizer(options);
  const summary = createEmptyActionSummary();
  for (const act of stored) {
    summarizer.addForwardAction(summary, act);
  }
  for (const act of Array.from(undo).reverse()) {
    summarizer.addReverseAction(summary, act);
  }
  // Name tables consistently, by their ultimate name, now we know it.
  for (const renames of summary.tableRenames) {
    const pre = renames[0];
    let post = renames[1];
    if (pre === null) { continue; }
    if (post === null) { post = defunctTableName(pre); }
    if (summary.tableDeltas[pre]) {
      summary.tableDeltas[post] = summary.tableDeltas[pre];
      delete summary.tableDeltas[pre];
    }
  }
  for (const td of values(summary.tableDeltas)) {
    // Name columns consistently, by their ultimate name, now we know it.
    for (const renames of td.columnRenames) {
      const pre = renames[0];
      let post = renames[1];
      if (pre === null) { continue; }
      if (post === null) { post = defunctTableName(pre); }
      if (td.columnDeltas[pre]) {
        td.columnDeltas[post] = td.columnDeltas[pre];
        delete td.columnDeltas[pre];
      }
    }
    // remove any duplicates that crept in
    td.addRows = Array.from(new Set(td.addRows));
    td.updateRows = Array.from(new Set(td.updateRows));
    td.removeRows = Array.from(new Set(td.removeRows));
  }
  return summary;
}

/**
 * Once we can produce an ActionSummary for each LocalActionBundle, it is useful to be able
 * to compose them.  Take the case of an ActionSummary pair, part 1 and part 2.  NameMerge
 * is an internal structure to help merging table/column name changes across two parts.
 */
interface NameMerge {
  dead1: Set<string>;  /** anything of this name in part 1 should be removed from merge */
  dead2: Set<string>;  /** anything of this name in part 2 should be removed from merge */
  rename1: Map<string, string>;  /** replace these names in part 1 */
  rename2: Map<string, string>;  /** replace these names in part 2 */
  merge: LabelDelta[]; /** a merged list of adds/removes/renames for the result */
}

/**
 * Looks at a pair of name change lists (could be tables or columns) and figures out what
 * changes would need to be made to a data structure keyed on those names in order to key
 * it consistently on final names.
 */
function planNameMerge(names1: LabelDelta[], names2: LabelDelta[]): NameMerge {
  const result: NameMerge = {
    dead1: new Set(),
    dead2: new Set(),
    rename1: new Map<string, string>(),
    rename2: new Map<string, string>(),
    merge: new Array<LabelDelta>(),
  };
  const names1ByFinalName: {[name: string]: LabelDelta} = keyBy(names1, p => p[1]!);
  const names2ByInitialName: {[name: string]: LabelDelta} = keyBy(names2, p => p[0]!);
  for (const [before1, after1] of names1) {
    if (!after1) {
      if (!before1) { throw new Error("invalid name change found"); }
      // Table/column was deleted in part 1.
      result.dead1.add(before1);
      result.merge.push([before1, null]);
      continue;
    }
    // At this point, we know the table/column existed at end of part 1.
    const pair2 = names2ByInitialName[after1];
    if (!pair2) {
      // Table/column's name was stable in part 2, so only change was in part 1.
      result.merge.push([before1, after1]);
      continue;
    }
    const after2 = pair2[1];
    if (!after2) {
      // Table/column was deleted in part 2.
      result.dead2.add(after1);
      if (before1) {
        // Table/column existed prior to part 1, so we need to expose its history.
        result.dead1.add(before1);
        result.merge.push([before1, null]);
      } else {
        // Table/column did not exist prior to part 1, so we erase it from history.
        result.dead1.add(after1);
        result.dead2.add(defunctTableName(after1));
      }
      continue;
    }
    // It we made it this far, our table/column exists after part 2.  Any information
    // keyed to its name in part 1 will need to be rekeyed to its final name.
    result.rename1.set(after1, after2);
    result.merge.push([before1, after2]);
  }
  // Look through part 2 for any changes not already covered.
  for (const [before2, after2] of names2) {
    if (!before2 && !after2) { throw new Error("invalid name change found"); }
    if (before2 && names1ByFinalName[before2]) { continue; }  // Already handled
    result.merge.push([before2, after2]);
    // If table/column is renamed in part 2, and name was stable in part 1,
    // rekey any information about it in part 1.
    if (before2 && after2) { result.rename1.set(before2, after2); }
  }
  // For neatness, sort the merge order. Not essential.
  result.merge = sortBy(result.merge, ([a, b]) => [a || "", b || ""]);
  return result;
}

/**
 * Re-key nested data to match name changes / removals.  Needs to be done a little carefully
 * since it is perfectly possible for names to be swapped or shuffled.
 *
 * Entries may be TableDeltas in the case of table renames or ColumnDeltas for column renames.
 *
 * @param entries: a dictionary of nested data - TableDeltas for tables, ColumnDeltas for columns.
 * @param dead: a set of keys to remove from the dictionary.
 * @param rename: changes of names to apply to the dictionary.
 */
function renameAndDelete<T>(entries: {[name: string]: T}, dead: Set<string>,
                            rename: Map<string, string>) {
  // Remove all entries marked as dead.
  for (const key of dead) { delete entries[key]; }
  // Move all entries that are going to be renamed out to a cache temporarily.
  const cache: {[name: string]: any} = {};
  for (const key of rename.keys()) {
    if (entries[key]) {
      cache[key] = entries[key];
      delete entries[key];
    }
  }
  // Move all renamed entries back in with their new names.
  for (const [key, val] of rename.entries()) { if (cache[key]) { entries[val] = cache[key]; } }
}

/**
 * Apply planned name changes to a pair of entries, and return a merged entry incorporating
 * their composition.
 *
 * @param names: the planned name changes as calculated by planNameMerge()
 * @param entries1: the first dictionary of nested data keyed on the names
 * @param entries2: test second dictionary of nested data keyed on the names
 * @param mergeEntry: a function to apply any further corrections needed to the entries
 *
 */
function mergeNames<T>(names: NameMerge,
                       entries1: {[name: string]: T},
                       entries2: {[name: string]: T},
                       mergeEntry: (e1: T, e2: T) => T): {[name: string]: T} {
  // Update the keys of the entries1 and entries2 dictionaries to be consistent.
  renameAndDelete(entries1, names.dead1, names.rename1);
  renameAndDelete(entries2, names.dead2, names.rename2);

  // Prepare the composition of the two dictionaries.
  const entries = entries2;                   // Start with the second dictionary.
  for (const key of Object.keys(entries1)) {  // Add material from the first.
    const e1 = entries1[key];
    if (!entries[key]) { entries[key] = e1;  continue; }  // No overlap - just add and move on.
    entries[key] = mergeEntry(e1, entries[key]);          // Recursive merge if overlap.
  }
  return entries;
}

/**
 * Track whether a specific row was added, removed or updated.
 */
interface RowChange {
  added: boolean;
  removed: boolean;
  updated: boolean;
}

/** RowChange for each row in a table */
export interface RowChanges {
  [rowId: number]: RowChange;
}


/**
 * This is used when we hit a cell that we know has changed but don't know its
 * value due to it being part of a bulk input.  This produces a cell that
 * represents the unknowns.
 */
function bulkCellFor(rc: RowChange|undefined): CellDelta|undefined {
  if (!rc) { return undefined; }
  const result: CellDelta = [null, null];
  if (rc.removed || rc.updated) { result[0] = '?'; }
  if (rc.added || rc.updated) { result[1] = '?'; }
  return result;
}

/**
 * Merge changes that apply to a particular column.
 *
 * @param present1: affected rows in part 1
 * @param present2: affected rows in part 2
 * @param e1: cached cell values for the column in part 1
 * @param e2: cached cell values for the column in part 2
 */
function mergeColumn(present1: RowChanges, present2: RowChanges,
                     e1: ColumnDelta, e2: ColumnDelta): ColumnDelta {
  for (const key of (Object.keys(present1) as unknown as number[])) {
    let v1 = e1[key];
    let v2 = e2[key];
    if (!v1 && !v2) { continue; }
    v1 = v1 || bulkCellFor(present1[key]);
    v2 = v2 || bulkCellFor(present2[key]);
    if (!v2)    { e2[key] = e1[key]; continue; }
    if (!v1[1]) { continue; }  // Deleted row.
    e2[key] = [v1[0], v2[1]];  // Change is from initial value in e1 to final value in e2.
  }
  return e2;
}


/** Put list of numbers in ascending order, with duplicates removed. */
function uniqueAndSorted(lst: number[]) {
  return [...new Set(lst)].sort((a, b) => a - b);
}

/** For each row changed, figure out whether it was added/removed/updated */
/** TODO: need for this method suggests maybe a better core representation for this info */
function getRowChanges(e: TableDelta): RowChanges {
  const all = new Set([...e.addRows, ...e.removeRows, ...e.updateRows]);
  const added = new Set(e.addRows);
  const removed = new Set(e.removeRows);
  const updated = new Set(e.updateRows);
  return fromPairs([...all].map(x => {
    return [x, {added: added.has(x),
                removed: removed.has(x),
                updated: updated.has(x)}] as [number, RowChange];
  }));
}

/**
 * Merge changes that apply to a particular table.  For updating addRows and removeRows, care is
 * needed, since it is fine to remove and add the same rowId within a single summary -- this is just
 * rowId reuse.  It needs to be tracked so we know lifetime of rows though.
 */
function mergeTable(e1: TableDelta,  e2: TableDelta): TableDelta {
  // First, sort out any changes to names of columns.
  const names = planNameMerge(e1.columnRenames, e2.columnRenames);
  mergeNames(names, e1.columnDeltas, e2.columnDeltas,
             mergeColumn.bind(null,
                              getRowChanges(e1),
                              getRowChanges(e2)));
  e2.columnRenames = names.merge;
  // All the columnar data is now merged.  What remains is to merge the summary lists of rowIds
  // that we maintain.
  const addRows1 = new Set(e1.addRows);       // Non-transient rows we have clearly added.
  const removeRows2 = new Set(e2.removeRows); // Non-transient rows we have clearly removed.
  const transients = e1.addRows.filter(x => removeRows2.has(x));
  e2.addRows = uniqueAndSorted([...e2.addRows, ...e1.addRows.filter(x => !removeRows2.has(x))]);
  e2.removeRows = uniqueAndSorted([...e2.removeRows.filter(x => !addRows1.has(x)), ...e1.removeRows]);
  e2.updateRows = uniqueAndSorted([...e1.updateRows.filter(x => !removeRows2.has(x)),
                                   ...e2.updateRows.filter(x => !addRows1.has(x))]);
  // Remove all traces of transients (rows that were created and destroyed) from history.
  for (const cols of values(e2.columnDeltas)) {
    for (const key of transients) { delete cols[key]; }
  }
  return e2;
}

/** Finally, merge a pair of summaries. */
export function concatenateSummaryPair(sum1: ActionSummary, sum2: ActionSummary): ActionSummary {
  const names = planNameMerge(sum1.tableRenames, sum2.tableRenames);
  const rowChanges = mergeNames(names, sum1.tableDeltas, sum2.tableDeltas, mergeTable);
  const sum: ActionSummary = {
    tableRenames: names.merge,
    tableDeltas: rowChanges
  };
  return sum;
}

/** Generalize to merging a list of summaries. */
export function concatenateSummaries(sums: ActionSummary[]): ActionSummary {
  if (sums.length === 0) { return createEmptyActionSummary(); }
  let result = sums[0];
  for (let i = 1; i < sums.length; i++) {
    result = concatenateSummaryPair(result, sums[i]);
  }
  return result;
}
