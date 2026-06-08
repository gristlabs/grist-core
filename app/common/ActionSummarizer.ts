import { getEnvContent, LocalActionBundle } from "app/common/ActionBundle";
import { chunkByLattice, chunkByOwners } from "app/common/ActionLayout";
import { ActionSummary, ColumnDelta, createEmptyActionSummary,
  createEmptyTableDelta, defunctTableName, LabelDelta, TableDelta } from "app/common/ActionSummary";
import { DocAction } from "app/common/DocActions";
import * as Action from "app/common/DocActions";
import { arrayExtend } from "app/common/gutil";
import { TableData } from "app/common/TableData";
import { CellDelta } from "app/common/TabularDiff";

import clone from "lodash/clone";
import fromPairs from "lodash/fromPairs";
import isEqual from "lodash/isEqual";
import keyBy from "lodash/keyBy";
import toPairs from "lodash/toPairs";
import values from "lodash/values";

/**
 * Building and composing ActionSummaries.
 *
 * An ActionSummary is the NET difference between two document states: which
 * tables, columns, and rows were added, removed, renamed, or changed, and for
 * the cells we keep, the value before and after. "Net" is the point: change a
 * cell and change it straight back, and the summary shows nothing.
 *
 * How a summary is represented:
 *  - Cells: a `[before, after]` pair. Each side is a wrapped value like `["x"]`,
 *    or `null` (the cell did not exist at that end, e.g. its row or column was
 *    added or removed within the span), or `"?"` (unknown; see incomplete below).
 *  - Rows: each row id's story is told by which of `addRows` / `removeRows` /
 *    `updateRows` it lands in. In both add and remove means recycled: the id held
 *    one entity, then a different one, so their cells must not be merged.
 *  - Names: table and column renames are `[before, after]` pairs (a `null` side
 *    is an add or a remove). A removed column's cells are keyed under a
 *    `-`-prefixed name, so they don't collide with a new column reusing the name.
 *
 * Composing two summaries (concatenateSummaryPair) is value-preserving: it keeps
 * a cell that looks like no change (`[v, v]`), because a later merge can make
 * that value matter. If a row is removed later, its old value is what shows up as
 * "this was here and now it's gone". Such cells are dropped only at the end, by
 * canonicalizeSummary, when the summary is read for display or comparison.
 * Recycled rows and `"?"` are the deliberate exceptions: their equal-looking
 * cells are real, not noise.
 *
 * Incomplete summaries: a bulk change over many rows is recorded only up to
 * `maximumInlineRows`. Past that the summary keeps a sample and sets
 * `mayBeIncomplete`, and a missing cell then reads as `"?"` (unknown) rather than
 * "absent". Composition keeps `"?"` instead of resolving it either way.
 *
 * A single bundle that carries several schema changes at once is first split by
 * the chunker (see ActionLayout) into pieces that each summarize cleanly; the
 * per-piece summaries are then composed here.
 */

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
  /**
   * Overrides the maximum number of rows in a single bulk change that will be
   * recorded individually. Set to `null` to specify no limit. Defaults to `10`.
   */
  maximumInlineRows?: number | null;
  /**
   * If set, all cells in these columns are preserved regardless of the value of
   * `maximumInlineRows`.
   */
  alwaysPreserveColIds?: string[];
  /**
   * Ignore any per-undo ownership the engine recorded with the bundle and infer
   * the chunk boundaries instead (the `chunkByLattice` path). Off by default, so
   * when ownership is present it is used. Mainly for testing both paths agree.
   */
  ignoreUndoGrouping?: boolean;
}

export class ActionSummarizer {
  private readonly _maxRows = this._getMaxRows();

  constructor(private _options?: ActionSummaryOptions) {}

  /**
   * Add information about an action based on the forward direction.
   * The `act` DocAction is examined for everything we can glean,
   * updating the ActionSummary. On its own, this isn't enough for
   * the summary to be complete, since we know neither the current
   * state the action is working on, nor the undo action for `act`.
   */
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

  /**
   * Add information about an action to a summary based on
   * undo information. `act` is assumed to be an undo action.
   * So, for example, if it is an AddTable, the summary will
   * contain a table deletion.
   */
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

  /**
   * Build a summary from a forward action plus the current table state (pre-action).
   * This is an alternative to addForwardAction + addReverseAction, for when undo
   * actions aren't available but the live table data is.
   *
   * addForwardAction() populates new values (CellDelta index 1). Removals need
   * special handling since forward remove actions don't carry cell contents — we
   * look those up from tableData. The final loop backfills old values (index 0) for
   * updated/added rows from the current table state, which works because this is
   * called before the action is applied.
   */
  public addAction(summary: ActionSummary, act: DocAction,
    tableData: TableData) {
    const tableId = act[1];
    if (!summary.tableDeltas[tableId]) {
      summary.tableDeltas[tableId] = createEmptyTableDelta();
    }
    this.addForwardAction(summary, act);
    // removal of records doesn't register in forward action.
    if (Action.isRemoveRecord(act)) {
      const td = this._forTable(summary, tableId);
      td.removeRows.push(act[2]);
      const rec = tableData.getRecord(act[2]);
      if (rec) {
        this._addRow(td, act[2], rec, 0);
      }
    } else if (Action.isBulkRemoveRecord(act)) {
      const td = this._forTable(summary, tableId);
      arrayExtend(td.removeRows, act[2]);
      for (const id of act[2]) {
        const rec = tableData.getRecord(id);
        if (rec) {
          this._addRow(td, id, rec, 0);
        }
      }
    }

    // Backfill old values (CellDelta index 0) from the pre-action table state.
    // For updates, this captures what the cell held before the edit. For adds,
    // getRecord returns undefined (row doesn't exist yet), so the old value is
    // correctly set to null (non-existent).
    const tableDelta = summary.tableDeltas[tableId];
    for (const r of new Set([...tableDelta.updateRows, ...tableDelta.addRows])) {
      const row = tableData.getRecord(r);
      for (const colId of Object.keys(tableDelta.columnDeltas)) {
        if (!(r in tableDelta.columnDeltas[colId])) {
          continue;
        }
        const cell = row?.[colId];
        const nestedCell = cell === undefined ? null : [cell] as [any];
        tableDelta.columnDeltas[colId][r][0] = nestedCell;
      }
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
    direction: 0 | 1) {
    for (const [colId, colChanges] of toPairs(colValues)) {
      const cell = this._forCell(td, rowId, colId);
      cell[direction] = [colChanges];
    }
  }

  /** helper function to store detailed cell changes for a set of rows */
  private _addRows(tableId: string, td: TableDelta, rowIds: number[],
    colValues: Action.BulkColValues, direction: 0 | 1) {
    const limitRows: boolean = rowIds.length > this._maxRows && !tableId.startsWith("_grist_");
    let selectedRows: [number, number][] = [];
    if (limitRows) {
      // if many rows, just take some from start and one from end as examples
      selectedRows = [...rowIds.slice(0, this._maxRows - 1).entries()];
      selectedRows.push([rowIds.length - 1, rowIds[rowIds.length - 1]]);
      td.mayBeIncomplete = true;
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

  private _getMaxRows() {
    const maxRows = this._options?.maximumInlineRows;
    if (maxRows === undefined) {
      return MAXIMUM_INLINE_ROWS;
    } else if (maxRows === null) {
      return Infinity;
    } else {
      return maxRows;
    }
  }
}

/**
 * Summarize the tabular changes that a LocalActionBundle results in, in a form
 * that will be suitable for composition.
 */
export function summarizeAction(body: LocalActionBundle, options?: ActionSummaryOptions): ActionSummary {
  return summarizeStoredAndUndo(getEnvContent(body.stored), body.undo, options, body.undoOwner);
}

/**
 * Build an ActionSummary from a flat (stored, undo) pair.
 *
 * A whole-bundle forward/reverse walk commits too early when a single bundle
 * carries several schema changes (say, multiple renames, or a remove-then-readd
 * at one slot). The walk can't tell an intermediate name or value, one that
 * appeared and vanished inside the bundle, from the real before-and-after. So we
 * first split the bundle into sub-bundles (see ActionLayout), summarize each one
 * on its own with the walk, and compose the per-chunk summaries with
 * `concatenateSummaries`. The chunker is here for correctness on multi-change
 * bundles, not for speed.
 *
 * If the bundle carries the engine's per-undo ownership (`undoOwner`, parallel to
 * `undo`), we chunk by it (`chunkByOwners`); otherwise by `chunkByLattice`. The
 * lattice is the common case, not a relic: it covers all history from before
 * ownership was added (immutable, recomputed lazily on read), plus engine-less
 * bundles. `ignoreUndoGrouping` forces it for testing. Both feed the same walk
 * and composition, so they agree (checked over the fuzz corpus).
 *
 * Aside: very old bundles (pre-~2017) recorded `stored` as only the user-facing
 * action, with `undo` carrying the metadata-side inverses too. Neither chunker
 * can attribute those, so they fall into a trailing orphan chunk (stored=[]) and
 * merge back as the old whole-bundle walk did.
 *
 * The input arrays and their action contents are not mutated.
 */
export function summarizeStoredAndUndo(stored: DocAction[], undo: DocAction[],
  options?: ActionSummaryOptions, undoOwner?: readonly (number | null)[] | null): ActionSummary {
  // `Array.isArray`, not just a presence check: a bundle round-tripped through the action history
  // marshaller turns an absent owner list into null, and an older bundle omits it entirely.
  const useOwners = Array.isArray(undoOwner) && undoOwner.length === undo.length &&
    !options?.ignoreUndoGrouping;
  const chunks = useOwners ? chunkByOwners(stored, undo, undoOwner) : chunkByLattice(stored, undo);
  const summaries = chunks.map(c => summarizeChunkWalked(c.stored, c.undo, options));
  return concatenateSummaries(summaries);
}

/** Walk one (stored, undo) chunk into a chunk-local ActionSummary. */
function summarizeChunkWalked(stored: DocAction[], undo: DocAction[],
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
 * Canonical presentation order for rename entries: sorted by pre-name
 * ascending, with null pre-names (additions) after all non-null pre-names.
 * Entries with equal pre-name (only possible when both
 * pre-names are null, since non-null pre-names are injective) are tie-broken
 * by post-name ascending, so the order is total and grouping-independent.
 */
function compareLabelDelta(a: LabelDelta, b: LabelDelta): number {
  const [a0, a1] = a;
  const [b0, b1] = b;
  if (a0 !== b0) {
    if (a0 === null) { return 1; }   // additions sort last
    if (b0 === null) { return -1; }
    return a0 < b0 ? -1 : 1;
  }
  const x = a1 === null ? "" : a1;
  const y = b1 === null ? "" : b1;
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Put a rename list into canonical form: drop identity renames ([c, c], which
 * arise from a name renamed away and back within scope) and sort into the stable
 * presentation order so equivalent summaries always serialize the same way.
 */
function canonicalizeRenames(renames: LabelDelta[]): LabelDelta[] {
  return [...renames]
    .filter(([pre, post]) => !(pre !== null && pre === post))
    .sort(compareLabelDelta);
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
  const names1ByFinalName: { [name: string]: LabelDelta } = keyBy(names1, p => p[1]!);
  const names2ByInitialName: { [name: string]: LabelDelta } = keyBy(names2, p => p[0]!);
  const names2ByFinalName: { [name: string]: LabelDelta } = keyBy(names2, p => p[1]!);
  for (const [before1, after1] of names1) {
    if (!after1) {
      if (!before1) { throw new Error("invalid name change found"); }
      // Table/column was deleted in part 1. Its delta is already keyed under
      // the defunct name (-before1), so we only need to drop a stale entry
      // under the live name -- unless `before1` was also re-added in part 1
      // (a recycle), in which case the live `before1` key holds a distinct
      // new entity that must be preserved.
      if (!names1ByFinalName[before1]) { result.dead1.add(before1); }
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
      // Table/column was deleted in part 2. Its delta is keyed under the
      // defunct name there, so only mark the live name dead unless `after1`
      // was also re-added in part 2 (a recycle), where the live `after1` key
      // holds a distinct new entity that must be preserved.
      if (!names2ByFinalName[after1]) { result.dead2.add(after1); }
      if (before1) {
        // Table/column existed prior to part 1 (as `before1`), was renamed to
        // `after1` during part 1, and removed during part 2. In the combined
        // scope it is removed, so its delta keys under the defunct name of its
        // original name. Rekey part 1's delta (keyed by `after1`) and part 2's
        // defunct delta (keyed by `-after1`) onto that final defunct key, so
        // the row/cell history merges in rather than being stranded or dropped.
        const finalKey = defunctTableName(before1);
        result.rename1.set(after1, finalKey);
        result.rename2.set(defunctTableName(after1), finalKey);
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
    if (before2 && after2) {
      result.rename1.set(before2, after2);
    } else if (before2 && !after2) {
      // Removed in part 2, but stable (data-only delta, or untouched) in part 1.
      // Part 1's delta is keyed by the live name `before2`; rekey it onto the
      // defunct name so it merges with part 2's defunct delta rather than being
      // stranded under a name that no longer exists in the combined scope.
      result.rename1.set(before2, defunctTableName(before2));
    }
  }
  // Canonical rename order. This matters: the same order must
  // result whether a delta was merged here or copied through untouched, or
  // composition would not be associative on presentation.
  result.merge.sort(compareLabelDelta);
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
 * @param mergeOnCollision: how to combine a renamed entry with a distinct entry
 *   already occupying the target key (see below); without it, the renamed entry
 *   overwrites and the occupant's data is lost.
 *
 * entries may be modified, and if so will be shallow-copied.
 */
function renameAndDelete<T>(entries: CopyOnWrite<{ [name: string]: T }>, dead: Set<string>,
  rename: Map<string, string>,
  mergeOnCollision?: (incoming: T, existing: CopyOnWrite<T>) => T) {
  if (!(dead.size || rename.size)) {
    return;
  }
  entries.write();
  const entriesCopy = entries.read();
  // Remove all entries marked as dead.
  for (const key of dead) { delete entriesCopy[key]; }
  // Move all entries that are going to be renamed out to a cache temporarily.
  const cache: { [name: string]: any } = {};
  for (const key of rename.keys()) {
    if (entriesCopy[key]) {
      cache[key] = entriesCopy[key];
      delete entriesCopy[key];
    }
  }
  // Move all renamed entries back in with their new names. If the target name
  // is still occupied by a distinct (non-renamed) entry, that entry and the
  // renamed one are two facets of the same final entity -- e.g. a table whose
  // data was recorded under its post-rename name by a calc-flush restore while
  // its removal was recorded under the pre-rename name. They have to merge, not
  // overwrite, or the occupant's rows/cells are dropped (breaking composition
  // associativity). The renamed entry carried the old name, so it is the
  // earlier facet (e1); the occupant carried the new name (e2).
  for (const [key, val] of rename.entries()) {
    if (!cache[key]) { continue; }
    if (entriesCopy[val] !== undefined && mergeOnCollision) {
      const existing = copyOnWrite(entriesCopy[val]);
      entriesCopy[val] = mergeOnCollision(cache[key], existing);
    } else {
      entriesCopy[val] = cache[key];
    }
  }
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
 * entries2 may be modified, and if so it will be copied.
 */
function mergeNames<T>(names: NameMerge,
  entries1: { [name: string]: T },
  entries2: CopyOnWrite<{ [name: string]: T }>,
  mergeEntry: (e1: T, e2: CopyOnWrite<T>) => T,
  transformOrphan?: (e1: T) => T): { [name: string]: T } {
  const entries1Wrapper = copyOnWrite(entries1);
  // Update the keys of the entries1 and entries2 dictionaries to be consistent.
  // A rename whose target key is already occupied merges rather than overwrites
  // (see renameAndDelete), using the same composition as the cross-part merge.
  renameAndDelete(entries1Wrapper, names.dead1, names.rename1, mergeEntry);
  renameAndDelete(entries2, names.dead2, names.rename2, mergeEntry);

  // Prepare the composition of the two dictionaries.
  const entries = entries2;                // Start with the second dictionary.
  for (const key of Object.keys(entries1Wrapper.read())) {  // Add material from the first.
    const e1 = entries1Wrapper.read()[key];
    if (!entries.read()[key]) {
      // entries1 has this key, entries2 does not. entries2's part-2 may
      // still carry row-level changes (notably row removals) that must
      // apply -- a removed row has no cells afterward. Those
      // changes aren't in this missing entry, so transformOrphan lets the
      // caller apply them; otherwise the entry is added unchanged.
      entries.write()[key] = transformOrphan ? transformOrphan(e1) : e1;
      continue;
    }
    const e2cow = copyOnWrite(entries.read()[key]);
    const result = mergeEntry(e1, e2cow);
    if (e2cow.hasWrite()) {
      entries.write()[key] = result;          // Recursive merge if overlap.
    }
  }
  return entries.read();
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
function bulkCellFor(rc: RowChange | undefined): CellDelta | undefined {
  if (!rc) { return undefined; }
  const result: CellDelta = [null, null];
  if (rc.removed || rc.updated) { result[0] = "?"; }
  if (rc.added || rc.updated) { result[1] = "?"; }
  return result;
}

/**
 * Merge changes that apply to a particular column.
 *
 * @param present1: affected rows in part 1
 * @param present2: affected rows in part 2
 * @param e1: cached cell values for the column in part 1
 * @param e2: cached cell values for the column in part 2
 *
 * e2 may be modified, and will be copied if so.
 */
function mergeColumn(present1: RowChanges, present2: RowChanges,
  incomplete1: true | undefined, incomplete2: true | undefined,
  e1: ColumnDelta, e2: CopyOnWrite<ColumnDelta>): ColumnDelta {
  for (const key of (Object.keys(present1) as unknown as number[])) {
    let v1 = e1[key];
    let v2 = e2.read()[key];
    if (!v1 && !v2) { continue; }
    // Drop the cell only if the row is added in e1 and removed in e2, and not
    // the reverse in either: then it is empty at both ends and never really
    // existed. Judge by the two parts together. A row both added and removed in
    // e1 was already there at the start, so keep its old value. And if either
    // part may be incomplete, a missing cell could be hiding a reused row id, so
    // don't drop it then.
    const t1 = present1[key], t2 = present2[key];
    if (t1.added && !t1.removed && t2?.removed && !t2?.added && !incomplete1 && !incomplete2) {
      delete e2.write()[key];
      continue;
    }
    // A row marked "updated" on a side that has no cell here means one of two
    // things: the column simply wasn't touched (so the value lives on the other
    // side and we can copy it over), or the summarizer dropped the cell to keep a
    // large bulk change small (so "?" for unknown is the right answer). If that
    // side is not flagged incomplete, it's the first case and we recover the
    // value. If it is, we can't tell, so we keep it unknown.
    const v1Untouched = v1 === undefined && !incomplete1;
    const v2Untouched = v2 === undefined && !incomplete2;
    v1 = v1 || bulkCellFor(t1);
    v2 = v2 || bulkCellFor(t2);
    if (!v2)    { e2.write()[key] = e1[key]; continue; }
    if (!v1[1]) {
      // e1 deleted the row and kept its old value in v1[0]. That is the value at
      // the start of the whole span, so keep it as the "before", whatever e2 does
      // next: if e2 re-adds the row we get [old, new]; if e2 also removes it (or
      // leaves it gone) we get [old, null], the original value, still removed. We
      // only do this when e1 genuinely removed the row (a row merely added in e1
      // with no value here has nothing to carry).
      if (t1.removed) {
        e2.write()[key] = [v1[0], v2[1]];
      }
      continue;
    }
    // Default composition is [v1[0], v2[1]]. Recover from the other side
    // when one side's synthesized '?' came from a complete summary that
    // simply didn't touch this column at this row.
    const pre = (v1Untouched && v1[0] === "?") ? v2[0] : v1[0];
    const post = (v2Untouched && v2[1] === "?") ? v1[1] : v2[1];
    e2.write()[key] = [pre, post];
  }
  return e2.read();
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
  return fromPairs([...all].map((x) => {
    return [x, { added: added.has(x),
      removed: removed.has(x),
      updated: updated.has(x) }] as [number, RowChange];
  }));
}

/**
 * Merge changes that apply to a particular table.  For updating addRows and removeRows, care is
 * needed, since it is fine to remove and add the same rowId within a single summary -- this is just
 * rowId reuse.  It needs to be tracked so we know lifetime of rows though.
 *
 * e2 may be modified, and is copied if so.
 */
function mergeTable(e1: TableDelta,  e2: CopyOnWrite<TableDelta>): TableDelta {
  // First, sort out any changes to names of columns.
  const e2td = e2.read();
  const names = planNameMerge(e1.columnRenames, e2td.columnRenames);
  const columnDeltasCow = copyOnWrite(e2td.columnDeltas);
  // A column that exists only in part 1 must still feel part 2's row removals.
  // A deleted row has no cells afterward, so when part 2 genuinely
  // removes a row (removed and not re-added), clear the post side of that column's
  // cell for it. We touch only those cells, never the pre side or other rows.
  //
  // Rows recycled in part 2 (removed AND re-added) are deliberately left alone,
  // and that is safe. The walk records a removal on the pre side only
  // (addReverseAction, direction 0), so a removed row's post is already null on
  // every column. By the time a row is recycled its orphan-column cell therefore
  // reads [pre, null] anyway: no stale post to clear, and the new entity (which
  // part 2 never set here) is correctly absent.
  const removedInE2 = new Set(e2td.removeRows);
  for (const r of e2td.addRows) { removedInE2.delete(r); }
  const applyRemovalsToOrphanColumn = (col: ColumnDelta): ColumnDelta => {
    let out: ColumnDelta | undefined;
    for (const rowId of Object.keys(col) as unknown as number[]) {
      if (removedInE2.has(Number(rowId)) && col[rowId][1] !== null) {
        out = out || { ...col };
        out[rowId] = [col[rowId][0], null];
      }
    }
    return out || col;
  };
  mergeNames(names, e1.columnDeltas, columnDeltasCow,
    mergeColumn.bind(null,
      getRowChanges(e1),
      getRowChanges(e2td),
      e1.mayBeIncomplete,
      e2td.mayBeIncomplete),
    applyRemovalsToOrphanColumn);
  const columnRenames = names.merge;
  // All the columnar data is now merged.  What remains is to merge the summary lists of rowIds
  // that we maintain.
  const addRows1 = new Set(e1.addRows);
  const removeRows2 = new Set(e2.read().removeRows);
  const e1Removed = new Set(e1.removeRows);
  const e2Added = new Set(e2.read().addRows);
  // A transient row is one added and then removed across the two parts, so it is
  // empty at both ends and never really existed. Judge that by the two parts
  // together: it must be added (not removed) in e1 and removed (not added) in e2.
  // A row both added and removed in e1 was already there at the start, so a
  // removal in e2 leaves it removed, not transient -- calling it transient would
  // drop its old value and break associativity. A row re-added in e2 isn't
  // transient either.
  const transients = e1.addRows.filter(
    x => removeRows2.has(x) && !e1Removed.has(x) && !e2Added.has(x));
  let addRows = uniqueAndSorted([...e2.read().addRows, ...e1.addRows.filter(x => !removeRows2.has(x))]);
  let removeRows = uniqueAndSorted([...e2.read().removeRows.filter(x => !addRows1.has(x)), ...e1.removeRows]);
  const updateRows = uniqueAndSorted([...e1.updateRows.filter(x => !removeRows2.has(x)),
    ...e2.read().updateRows.filter(x => !addRows1.has(x))]);
  if (e1.mayBeIncomplete || e2td.mayBeIncomplete) {
    // Transient collapse is unsafe when cells may have been
    // dropped -- the absent cells could be a truncated `recycled` row rather
    // than a genuine transient. Keep such rows in both lists (recycled) and
    // keep their cells, instead of erasing them.
    addRows = uniqueAndSorted([...addRows, ...transients]);
    removeRows = uniqueAndSorted([...removeRows, ...transients]);
  } else if (transients.length) {
    // Complete summary: erase all traces of transient rows from history. Write
    // through columnDeltasCow (not e2.read().columnDeltas) so the erase lands on
    // a private clone: e2.write() is a shallow copy whose .columnDeltas still
    // aliases the caller's input until columnDeltasCow is written back below.
    for (const [colId, columnDelta] of Object.entries(columnDeltasCow.read())) {
      const updatedColumnDelta = copyOnWrite(columnDelta);
      for (const rowId of transients) {
        delete updatedColumnDelta.write()[rowId];
      }
      if (updatedColumnDelta.hasWrite()) {
        columnDeltasCow.write()[colId] = updatedColumnDelta.read();
      }
    }
  }
  // Write the merged column deltas back once, onto a private copy (the shallow
  // e2.write() shares the columnDeltas dict with the caller's input otherwise).
  if (columnDeltasCow.hasWrite()) {
    e2.write().columnDeltas = columnDeltasCow.read();
  }
  // We unconditionally write at this level.
  Object.assign(e2.write(), {
    columnRenames,
    addRows,
    removeRows,
    updateRows,
  });
  if (e1.mayBeIncomplete || e2td.mayBeIncomplete) {
    e2.write().mayBeIncomplete = true;
  }
  return e2.read();
}

/**
 * A cell pair is vacuous when its two sides are equal: it records no
 * change. Covers `[null, null]` (cell absent at both endpoints) and
 * `[[v], [v]]` (same value before and after). A `"?"` side is never
 * vacuous (it asserts an unknown change, not "no change").
 */
function cellIsVacuous(c: CellDelta): boolean {
  const [pre, post] = c;
  if (pre === "?" || post === "?") { return false; }
  if (pre === null && post === null) { return true; }
  if (pre === null || post === null) { return false; }
  return isEqual(pre, post);   // [v] vs [v]
}

function isEmptyTableDelta(td: TableDelta): boolean {
  return td.addRows.length === 0 && td.removeRows.length === 0 &&
    td.updateRows.length === 0 && td.columnRenames.length === 0 &&
    Object.keys(td.columnDeltas).length === 0 && !td.mayBeIncomplete;
}

/**
 * Settle a freshly merged TableDelta: the structural cleanup every merge
 * needs and the next merge relies on. It
 *  - fixes a cell side to "absent" at an existence boundary (a row or column
 *    that did not exist at that endpoint);
 *  - re-keys a removed column's cells onto its `-`-prefixed defunct name, which
 *    `planNameMerge` then assumes is already in place;
 *  - resolves a stray `"?"` to absent in a complete summary;
 *  - drops `[null, null]` cells (no value at either end);
 *  - derives `updateRows` from the cells, so it does not depend on merge order;
 *  - puts renames and row lists in canonical order.
 * It keeps an insignificant `[v, v]` cell: a later merge can turn that value
 * into the "before" of a removal, so it can't be dropped yet.
 * `canonicalizeTableDelta` drops those once merging is done.
 */
function settleTableDelta(td: TableDelta): TableDelta {
  const incomplete = Boolean(td.mayBeIncomplete);
  // Existence boundaries fix a cell side to "absent": a cell has
  // no value at an endpoint where its row or column did not exist there.
  //  - a column added in scope (a `[null, name]` rename) has no pre value;
  //  - a defunct column (keyed by its `-`-prefixed name) has no post value;
  //  - a row added in scope (in addRows, not also removed) has no pre value;
  //  - a row removed in scope (in removeRows, not also re-added) has no post.
  // Recycled rows (in both lists) are per-entity and exempt from the row
  // rules. Enforcing these fixes composition that synthesized a stray `"?"`
  // at such a boundary, and lets the later vacuous-cell drop clear anything
  // that thereby becomes `[null, null]`.
  const addedCols = new Set(td.columnRenames.filter(([pre]) => pre === null).map(([, post]) => post));
  const removeSet = new Set(td.removeRows);
  const addSet = new Set(td.addRows);
  const addedRows = new Set(td.addRows.filter(r => !removeSet.has(r)));
  const removedRows = new Set(td.removeRows.filter(r => !addSet.has(r)));
  // Delta keying: a removed column's cells key under its
  // `-`-prefixed pre-name, never the now-defunct live name. The walk can leave
  // a cell under the live name (e.g. for a row removed before the column went
  // defunct), and `planNameMerge` assumes the defunct keying is already in
  // place, so enforce it here: re-key any `[pre, null]` column's live-name
  // cells onto `-pre`, merging with an already-canonical entry (which wins).
  // A column whose live name is occupied by a distinct entity must not have
  // that entity's cells re-keyed onto the defunct name. That happens two ways:
  //  - the name is re-added ([null, pre]); or
  //  - the name is a rename target ([x, pre]): something was renamed into it,
  //    so the live `pre` key holds the renamed-in column, not the removed one.
  // Only a column removed and neither re-added nor renamed-into has its cells
  // re-keyed onto `-pre`.
  const renameTargets = new Set(
    td.columnRenames.filter(([pre, post]) => pre !== null && post !== null).map(([, post]) => post));
  const removedCols = new Map<string, string>();
  for (const [pre, post] of td.columnRenames) {
    if (pre !== null && post === null && !addedCols.has(pre) && !renameTargets.has(pre)) {
      removedCols.set(pre, defunctTableName(pre));
    }
  }
  let sourceDeltas = td.columnDeltas;
  if (removedCols.size > 0 && Object.keys(td.columnDeltas).some(c => removedCols.has(c))) {
    sourceDeltas = {};
    // Canonical (non-remapped) keys first, so an existing `-pre` entry wins on
    // any row collision with a stranded live-name cell.
    const entries = Object.entries(td.columnDeltas)
      .sort((a, b) => (removedCols.has(a[0]) ? 1 : 0) - (removedCols.has(b[0]) ? 1 : 0));
    for (const [colId, cd] of entries) {
      const target = removedCols.get(colId) ?? colId;
      const dest = sourceDeltas[target] ?? (sourceDeltas[target] = {});
      for (const [rowId, cell] of Object.entries(cd)) {
        const r = Number(rowId);
        if (!(r in dest)) { dest[r] = cell; }
      }
    }
  }
  const columnDeltas: { [colId: string]: ColumnDelta } = {};
  for (const [colId, cd] of Object.entries(sourceDeltas)) {
    const colNoPre = addedCols.has(colId);
    const colNoPost = colId.startsWith("-");
    const kept: ColumnDelta = {};
    for (const [rowId, cell] of Object.entries(cd)) {
      const r = Number(rowId);
      const noPre = colNoPre || addedRows.has(r);
      const noPost = colNoPost || removedRows.has(r);
      let pre = noPre ? null : cell[0];
      let post = noPost ? null : cell[1];
      // A complete summary carries no unknowns: `"?"` only appears
      // when the `mayBeIncomplete` flag permits dropped detail. When that flag
      // is unset, any `"?"` is a composition artifact (a value the summary
      // never recorded, e.g. an omitted default) with no recoverable value, so
      // resolve it to absent. When the flag is set, `"?"` is meaningful and
      // kept.
      if (!incomplete) {
        if (pre === "?") { pre = null; }
        if (post === "?") { post = null; }
      }
      // `[null, null]` carries no value, so drop it. Keep everything else,
      // including an insignificant `[v, v]`: a later merge may still need `v`.
      if (pre === null && post === null) { continue; }
      kept[r] = [pre, post];
    }
    if (Object.keys(kept).length > 0) { columnDeltas[colId] = kept; }
  }
  let updateRows = td.updateRows;
  if (!incomplete) {
    // A row is `updated` iff it persisted (not net-added, not net-removed) and
    // its contents changed -- i.e. it carries a cell delta (section 3: contents
    // changes live in cells, not a separate flag). Derive it from the cells
    // rather than filtering the accumulated list, so it is associative: the
    // accumulated updateRows can differ by composition order, the cells cannot.
    // (Under mayBeIncomplete a real update may have had its cell dropped, so the
    // accumulated list is kept instead.)
    const cellRows = new Set<number>();
    for (const cd of Object.values(columnDeltas)) {
      for (const r of Object.keys(cd)) { cellRows.add(Number(r)); }
    }
    // The final return sorts via uniqueAndSorted, so no need to sort here.
    updateRows = [...cellRows].filter(r => !addSet.has(r) && !removeSet.has(r));
  }
  const columnRenames = canonicalizeRenames(td.columnRenames);
  // Presentation rule: row lists are sets, serialized sorted
  // by rowId ascending (deduped). updateRows is already sorted when derived
  // above; sort addRows/removeRows here too so the canonical form is
  // order-stable regardless of the order the walk/composition accumulated them.
  return { ...td, addRows: uniqueAndSorted(td.addRows), removeRows: uniqueAndSorted(td.removeRows),
    columnDeltas, updateRows: uniqueAndSorted(updateRows), columnRenames };
}

/**
 * Final cleanup of a settled TableDelta for display or comparison:
 *  - drop the `[v, v]` cells that record no real change;
 *  - drop any column left with no cells;
 *  - drop from `updateRows` any row that no surviving cell justifies (it was
 *    there only for a change that canceled out). Suppressed under
 *    `mayBeIncomplete`, where a missing cell may be a dropped value rather than
 *    "no change".
 * A recycled row's equal-sided cell is significant (two entities share the id)
 * and is kept. Row identity (add/remove/recycle) is preserved. Expects
 * `settleTableDelta` output; running it again changes nothing.
 */
function canonicalizeTableDelta(td: TableDelta): TableDelta {
  const incomplete = Boolean(td.mayBeIncomplete);
  const addSet = new Set(td.addRows);
  const removeSet = new Set(td.removeRows);
  // Recycled rows (in both lists) carry per-entity cells where `null` marks an
  // entity boundary, so their equal-sided cells are significant, never stripped.
  const recycledRows = new Set(td.addRows.filter(r => removeSet.has(r)));
  const columnDeltas: { [colId: string]: ColumnDelta } = {};
  for (const [colId, cd] of Object.entries(td.columnDeltas)) {
    const kept: ColumnDelta = {};
    for (const [rowId, cell] of Object.entries(cd)) {
      const r = Number(rowId);
      if (cellIsVacuous(cell) && !recycledRows.has(r)) { continue; }
      kept[r] = cell;
    }
    if (Object.keys(kept).length > 0) { columnDeltas[colId] = kept; }
  }
  let updateRows = td.updateRows;
  if (!incomplete) {
    // Re-derive from the cells that survived, so a row kept only by a
    // now-dropped `[v, v]` cell leaves updateRows.
    const cellRows = new Set<number>();
    for (const cd of Object.values(columnDeltas)) {
      for (const r of Object.keys(cd)) { cellRows.add(Number(r)); }
    }
    updateRows = uniqueAndSorted([...cellRows].filter(r => !addSet.has(r) && !removeSet.has(r)));
  }
  return { ...td, columnDeltas, updateRows };
}

/** Apply a per-table transform across a summary, canonicalize its table renames,
 * and drop any table left with nothing to say. (A table being added or removed
 * is already recorded in the renames, so an empty change-set for it would just
 * be noise.) */
function mapTableDeltas(sum: ActionSummary, fn: (td: TableDelta) => TableDelta): ActionSummary {
  const tableDeltas: { [tableId: string]: TableDelta } = {};
  for (const [tableId, td] of Object.entries(sum.tableDeltas)) {
    const out = fn(td);
    if (!isEmptyTableDelta(out)) { tableDeltas[tableId] = out; }
  }
  return { tableRenames: canonicalizeRenames(sum.tableRenames), tableDeltas };
}

/** Settle every table after a merge (see settleTableDelta). */
function settleSummary(sum: ActionSummary): ActionSummary {
  return mapTableDeltas(sum, settleTableDelta);
}

/**
 * Merge two summaries into one covering both, with sum1 happening before sum2.
 *
 * It keeps cells that look like "no change" (the same value before and after).
 * That seems wasteful, but if a later merge removes that row, the old value is
 * what shows up as "this was here and now it's gone", so we can't drop it partway
 * through. The result is therefore not display-ready: call canonicalizeSummary to
 * drop those cells (concatenateSummaries does that for you once the merges are
 * done).
 */
export function concatenateSummaryPair(sum1: ActionSummary, sum2: ActionSummary): ActionSummary {
  const names = planNameMerge(sum1.tableRenames, sum2.tableRenames);
  const rowChanges = mergeNames(names, sum1.tableDeltas, copyOnWrite(sum2.tableDeltas), mergeTable);
  return settleSummary({
    tableRenames: names.merge,
    tableDeltas: rowChanges,
  });
}

/**
 * Clean a summary up for display or comparison: drop the cells that record no
 * real change (same value before and after). Merging deliberately keeps those
 * cells (see concatenateSummaryPair), so clean up only once the merging is done.
 * Settles first, so it is correct on any summary, not only an already-merged
 * one. Running this twice changes nothing.
 */
export function canonicalizeSummary(sum: ActionSummary): ActionSummary {
  return mapTableDeltas(settleSummary(sum), canonicalizeTableDelta);
}

/** Merge a whole list of summaries, in order, then clean up the result. */
export function concatenateSummaries(sums: ActionSummary[]): ActionSummary {
  if (sums.length === 0) { return createEmptyActionSummary(); }
  let result = sums[0];
  for (let i = 1; i < sums.length; i++) {
    result = concatenateSummaryPair(result, sums[i]);
  }
  return canonicalizeSummary(result);
}

export function getRenames(ref: ActionSummary | TableDelta) {
  if ("tableRenames" in ref) {
    return ref.tableRenames;
  } else {
    return ref.columnRenames;
  }
}

export function getDeltas<T extends ActionSummary | TableDelta>(ref: T) {
  if ("tableRenames" in ref) {
    return ref.tableDeltas;
  } else {
    return ref.columnDeltas;
  }
}

interface RebasePlan {
  dead: Set<string>;
  rename: Map<string, string>;
  refBack: Map<string, string | null>;
  targetBack: Map<string, string | null>;
  targetForward: Map<string, string | null>;
  refForward: Map<string | null, string | null>;
  updatedRenames: LabelDelta[];
}

/**
 * For the ref and target, assumed to start from the same ancestor,
 * figure out the following changes in the ref that can be applied
 * to the target:
 *   - Any renaming of items.
 *   - Any deletion of items.
 * Return items to delete and rename, in the naming scheme of the
 * target.
 */
function planRebase(ref: ActionSummary | TableDelta,
  target: ActionSummary | TableDelta): RebasePlan {
  const dead = new Set<string>();
  const rename = new Map<string, string>();
  const targetNames = new Map<string, string | null>();
  const refBack = new Map<string, string | null>();
  const targetBack = new Map<string, string | null>();
  const refForward = new Map<string | null, string | null>();
  for (const [oldId, newId] of getRenames(target)) {
    if (oldId) {
      targetNames.set(oldId, newId);
    }
    if (newId) {
      targetBack.set(newId, oldId);
    }
  }
  for (const [oldId, newId] of getRenames(ref)) {
    if (newId) {
      refBack.set(newId, oldId);
    }
    if (oldId) {
      refForward.set(oldId, newId);
    }
  }

  const targetDeltas = getDeltas(target);

  for (const [oldId, newId] of getRenames(ref)) {
    if (oldId && !newId) {
      dead.add(targetNames.get(oldId) || oldId);
    }
    if (!oldId && newId && targetDeltas[newId]) {
      dead.add(newId);
    }
    if (oldId && newId && !targetNames.get(oldId)) {
      rename.set(oldId, newId);
    }
  }
  const updatedRenames: LabelDelta[] = getRenames(target)
    .filter(([oldId, _]) => !oldId || refForward.get(oldId) !== null)
    .filter(([oldId, newId]) => oldId || !newId || !refBack.get(newId))
    .map(([oldId, newId]) => [refForward.get(oldId) || oldId, newId]);

  return {
    dead,
    rename,
    targetBack,
    refBack,
    targetForward: targetNames,
    refForward,
    updatedRenames,
  };
}

/**
 * Applies table and column renames that are present in the `ref`
 * summary to the target summary.
 */
export function rebaseSummary(ref: ActionSummary, target: ActionSummary) {
  const plan = planRebase(ref, target);
  const empty = createEmptyTableDelta();
  for (const key of Object.keys(target.tableDeltas)) {
    const ancestorName = plan.targetBack.get(key) || key;
    const afterTargetName = plan.targetForward.get(ancestorName) || ancestorName;
    const afterRefName = plan.refForward.get(ancestorName) || ancestorName;
    const afterTarget = target.tableDeltas[afterTargetName] ?? empty;
    const afterRef = ref.tableDeltas[afterRefName] ?? empty;
    rebaseTable(afterRef, afterTarget);
  }
  const deltas = copyOnWrite(target.tableDeltas);
  renameAndDelete(deltas, plan.dead, plan.rename);
  target.tableDeltas = deltas.read();
  target.tableRenames = plan.updatedRenames;
}

function rebaseTable(ref: TableDelta, target: TableDelta) {
  const plan = planRebase(ref, target);
  const deltas = copyOnWrite(target.columnDeltas);
  renameAndDelete(deltas, plan.dead, plan.rename);
  target.columnDeltas = deltas.read();
  target.columnRenames = plan.updatedRenames;
}

/**
 * Wrapper to facilitate making a shallow copy of an
 * object if we find we need to edit it.
 */
function copyOnWrite<T>(item: T): CopyOnWrite<T> {
  let maybeCopiedItem: T | undefined;
  return {
    read() { return maybeCopiedItem || item; },
    write() {
      if (!maybeCopiedItem) {
        // make a shallow clone
        maybeCopiedItem = clone(item);
      }
      return maybeCopiedItem;
    },
    hasWrite() {
      return maybeCopiedItem !== undefined;
    },
  };
}

interface CopyOnWrite<T> {
  read(): T;
  write(): T;
  hasWrite(): boolean;
}
