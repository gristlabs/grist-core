/**
 * An implementation of daff (tabular diff tool) to apply changes.
 * Incomplete and naive.
 *
 * Terms used below:
 *   - trunk: the document being patched, as it is now.
 *   - fork: the copy holding the proposal.
 *   - branch point: the state both started from.
 *   - forkDelta / trunkDelta: what each changed in a table since the
 *     branch point.
 *
 * A patch lands as a single applyUserActions call, so a proposal either
 * applies fully or not at all. Rows the fork adds go in under negative
 * temporary ids, which the engine replaces with real ones as the bundle
 * applies.
 *
 * The rule that shapes everything below: temp ids resolve as rows land, so
 * a reference may only name a row added earlier in the same bundle. A
 * forward reference is rejected, taking the whole bundle with it.
 */

import { ActionSummary, ColumnDelta, TableDelta } from "app/common/ActionSummary";
import { PatchItem, PatchLog } from "app/common/ActiveDocAPI";
import { BulkColValues, CellValue, getColValues, UserAction } from "app/common/DocActions";
import { DocStateComparisonDetails } from "app/common/DocState";
import { extractInfoFromColType, isHiddenCol, isList } from "app/common/gristTypes";
import { MetaRowRecord, MetaTableData } from "app/common/TableData";
import { CellDelta } from "app/common/TabularDiff";
import { GristObjCode } from "app/plugin/GristData";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { OptDocSession } from "app/server/lib/DocSession";

import groupBy from "lodash/groupBy";
import isEmpty from "lodash/isEmpty";

// Values to write to one row.
interface RowValues {
  rowId: number;
  values: Record<string, CellValue>;
}

export class Patch {
  private _columnsByTableIdAndColId: Record<string, Record<string, MetaRowRecord<"_grist_Tables_column">>> = {};
  private _columns: MetaTableData<"_grist_Tables_column">;
  private _tables: MetaTableData<"_grist_Tables">;

  public constructor(private _activeDoc: ActiveDoc, private _docSession: OptDocSession) {
    const columns = this._activeDoc.docData?.getMetaTable("_grist_Tables_column");
    const tables = this._activeDoc.docData?.getMetaTable("_grist_Tables");
    if (!columns || !tables) {
      throw new Error("Attempt to patch before document is initialized");
    }
    this._columns = columns;
    this._tables = tables;
  }

  /**
   * Apply the given comparison as a patch. `trunkChanges` are the changes
   * made to the trunk since the branch point. On success, returns a note
   * per engine action applied. On failure, whether while building the
   * actions or when the engine rejects them, returns a single error note,
   * and nothing has been applied.
   */
  public async applyChanges(details: DocStateComparisonDetails, trunkChanges: ActionSummary): Promise<PatchLog> {
    const changes: PatchItem[] = [];
    try {
      const forkChanges = details.leftChanges;

      if (forkChanges.tableRenames.length > 0) {
        throw new Error("table-level changes cannot be handled yet");
      }

      // Ignore metadata for now. Filtered before the guards below, so they
      // cannot refuse a patch over a table nothing here would touch.
      const userTables: [string, TableDelta][] = Object.entries(forkChanges.tableDeltas)
        .filter(([tableId]) => !tableId.startsWith("_grist_"));

      for (const [tableId, forkDelta] of userTables) {
        if (forkDelta.columnRenames.length > 0) {
          throw new Error("column-level changes cannot be handled yet");
        }
        // A summary truncated under a row cap reads its dropped cells as
        // "?", which would apply as nulls over real data. Callers must
        // summarize with maximumInlineRows: null.
        if (forkDelta.mayBeIncomplete) {
          throw new Error(`summary for table ${tableId} may be incomplete; refusing to apply`);
        }
      }

      const getColumn: GetColumnInfo = (tableId, colId) => this._getColumnInfo(tableId, colId);
      const actions = buildActions(userTables, getColumn, trunkChanges.tableDeltas);
      // Describe before writing, so an action we cannot account for is
      // caught while the document is still untouched.
      const described = actions.map(describeAction);

      if (actions.length > 0) {
        // The one and only write.
        await this._activeDoc.applyUserActions(this._docSession, actions);
      }
      changes.push(...described);
    } catch (e) {
      changes.push({ kind: "error", msg: String(e) });
    }
    // An empty patch counts as applied. Calling it unapplied would leave
    // the proposal open with nothing left to accept.
    const applied = !changes.some(change => change.kind === "error");
    return { changes, applied };
  }

  private _getColumnInfo(tableId: string, colId: string): ColumnInfo {
    const column = this._getTableColumn(tableId, colId);
    // Careful, isFormula set, with a blank formula, means
    // an empty column.
    // Hidden columns are currently gristHelper_ columns
    // (for conditional formatting, so formula columns in
    // any case, or manualSort. Changing manualSort is
    // complicated, let's not get into it yet.
    const skip = (Boolean(column.isFormula) && Boolean(column.formula)) || isHiddenCol(colId);
    const info = extractInfoFromColType(column.type);
    const refTableId = (info.type === "Ref" || info.type === "RefList") ? info.tableId : undefined;
    return { skip, refTableId, twoWay: this._twoWayInfo(column) };
  }

  /**
   * The part a column plays in a two-way reference, if any. Of a Ref/RefList
   * pair, the patch writes the Ref. Of a pair of the same kind, it writes
   * the column with the lower id.
   */
  private _twoWayInfo(column: MetaRowRecord<"_grist_Tables_column">): ColumnInfo["twoWay"] {
    const reverse = column.reverseCol ? this._columns.getRecord(column.reverseCol) : undefined;
    if (!reverse) { return undefined; }
    const kind = extractInfoFromColType(column.type).type;
    const reverseKind = extractInfoFromColType(reverse.type).type;
    if (kind !== reverseKind) { return { pair: "manyToOne", mirror: kind === "RefList" }; }
    return { pair: kind === "Ref" ? "oneToOne" : "manyToMany", mirror: column.id > reverse.id };
  }

  private _getTableColumn(tableId: string, colId: string) {
    const column = this._getTableColumns(tableId)[colId];
    if (!column) {
      throw new Error(`column not found: ${colId}`);
    }
    return column;
  }

  private _getTableColumns(tableId: string) {
    if (this._columnsByTableIdAndColId[tableId]) {
      return this._columnsByTableIdAndColId[tableId];
    }
    const table = this._tables.findRecord("tableId", tableId);
    if (!table) {
      throw new Error(`table not found: ${tableId}`);
    }
    const columns = this._columns.getRecords().filter(rec => rec.parentId === table.id);
    this._columnsByTableIdAndColId[tableId] = Object.fromEntries(columns.map(rec => [String(rec.colId), rec]));
    return this._columnsByTableIdAndColId[tableId];
  }
}

/**
 * What planning a patch needs to know about a trunk column.
 */
export interface ColumnInfo {
  // Formula and hidden columns, which the trunk computes.
  skip: boolean;
  // For a Ref or RefList column, the table it points into.
  refTableId?: string;
  // For one side of a two-way reference: what kind of pair it is in, and
  // whether it is the mirror, the side the patch leaves for the engine to
  // update from the other. See planTable.
  twoWay?: {
    pair: "oneToOne" | "manyToOne" | "manyToMany";
    mirror: boolean;
  };
}

export type GetColumnInfo = (tableId: string, colId: string) => ColumnInfo;

/**
 * Build the whole bundle without touching the document. The order matters:
 *   - Removes and releases free one-to-one partners (see releaseActions)
 *     before anything claims them.
 *   - Every BulkAddRecord precedes anything carrying a temp id: the
 *     updates, whose Refs may name added rows, and the deferred Refs of
 *     the added rows themselves.
 */
export function buildActions(
  userTables: [string, TableDelta][], getColumn: GetColumnInfo, trunkDeltas: Record<string, TableDelta> = {},
): UserAction[] {
  const tables = planTables(userTables, getColumn, trunkDeltas);
  const adds = tables.map(addActions);
  return [
    ...tables.flatMap(removeActions),
    ...tables.flatMap(releaseActions),
    ...adds.flatMap(a => a.adds),
    ...tables.flatMap(updateActions),
    ...adds.flatMap(a => a.deferredRefs),
  ];
}

function planTables(
  userTables: [string, TableDelta][], getColumn: GetColumnInfo, trunkDeltas: Record<string, TableDelta>,
): TablePlan[] {
  const trunkEntries = Object.entries(trunkDeltas);
  const isForkAdded = rowCheck(userTables.map(([tableId, delta]) => [tableId, delta.addRows]));
  // Rows the trunk removed since the branch point.
  const isTrunkRemoved = rowCheck(trunkEntries.map(([tableId, delta]) => [tableId, delta.removeRows]));
  // Removed rows whose ids the trunk gave to new rows.
  const isTrunkReused = rowCheck(trunkEntries.map(([tableId, delta]) => {
    const added = new Set(delta.addRows);
    return [tableId, delta.removeRows.filter(rowId => added.has(rowId))];
  }));
  // Rows the fork removed that the trunk still has.
  const isForkRemoved = rowCheck(userTables.map(([tableId, delta]) =>
    [tableId, delta.removeRows.filter(rowId => !isTrunkRemoved(tableId, rowId))]));
  const context: PatchContext = { isForkAdded, isForkRemoved, isTrunkRemoved, isTrunkReused };
  return userTables.map(([tableId, forkDelta]) =>
    planTable(tableId, forkDelta, getColumn, trunkDeltas[tableId], context));
}

// What planning each table needs to know about the patch as a whole.
interface PatchContext {
  isForkAdded: RowCheck;
  isForkRemoved: RowCheck;
  isTrunkRemoved: RowCheck;
  isTrunkReused: RowCheck;
}

// One table's part in the patch.
interface TablePlan extends PatchContext {
  tableId: string;
  forkDelta: TableDelta;
  // The columns to write, leaving out skipped ones and mirrors.
  columns: PlannedColumn[];
}

interface PlannedColumn extends ColumnInfo {
  colId: string;
  cells: ColumnDelta;
}

function planTable(
  tableId: string, forkDelta: TableDelta, getColumn: GetColumnInfo, trunkDelta: TableDelta | undefined,
  context: PatchContext,
): TablePlan {
  // Changing a row the trunk has removed would fail if the id is free,
  // and change an unrelated row if it was reused.
  const removedUpdate = existingUpdatedRows(forkDelta).find(rowId => context.isTrunkRemoved(tableId, rowId));
  if (removedUpdate !== undefined) {
    throw new Error(`the suggestion changes row ${removedUpdate} of ${tableId}, ` +
      "which was removed from this document after the suggestion's copy was made");
  }
  const planned = Object.entries(forkDelta.columnDeltas)
    .map(([colId, cells]): PlannedColumn => ({ colId, cells, ...getColumn(tableId, colId) }))
    .filter(col => !col.skip);
  // Only truncated summaries have unknown values, and applyChanges refuses
  // those. Check anyway: one would land as a null over real data.
  for (const { colId, cells } of planned) {
    const unknown = Object.entries(cells).find(([, cellDelta]) => cellDelta.includes("?"));
    if (unknown) {
      throw new Error(`the suggestion's change to ${tableId}.${colId} in row ${unknown[0]} is not known in full`);
    }
  }
  refuseTwoWayConflicts(tableId, forkDelta, planned, trunkDelta);
  // A two-way change shows up in the fork's summary on both sides. Writing
  // both could fail: a pet moved to a new owner would be listed in the new
  // owner's BulkAddRecord while the old owner still listed it, and the
  // engine refuses a pet with two owners. So mirrors are left to the
  // engine. That loses a reorder of a mirror list, which the engine
  // re-sorts whenever its links change anyway.
  const columns = planned.filter(col => !col.twoWay?.mirror);
  return { ...context, tableId, forkDelta, columns };
}

/**
 * Refuse the patch where the fork and the trunk both changed the same cell
 * of a two-way reference whose sides are of the same kind. Which side of
 * such a pair the patch writes depends on which column was created first,
 * and writing over the trunk's change would undo different links depending
 * on that choice. Checking both sides keeps the outcome the same either
 * way.
 *
 * A Ref/RefList pair needs no check. The Ref is always the side written,
 * and where both sides changed it, the fork's value wins, as for any
 * other cell.
 */
function refuseTwoWayConflicts(
  tableId: string, forkDelta: TableDelta, planned: PlannedColumn[], trunkDelta: TableDelta | undefined,
) {
  if (!trunkDelta) { return; }
  const trunkUpdated = new Set(trunkDelta.updateRows);
  const rows = existingUpdatedRows(forkDelta).filter(rowId => trunkUpdated.has(rowId));
  for (const { colId, cells, twoWay } of planned) {
    if (!twoWay || twoWay.pair === "manyToOne") { continue; }
    // If the trunk's summary may have dropped cells, any change to the row counts.
    const rowId = rows.find(r => cells[r] && (trunkDelta.mayBeIncomplete || trunkDelta.columnDeltas[colId]?.[r]));
    if (rowId !== undefined) {
      throw new Error(`the suggestion changes ${tableId}.${colId} in row ${rowId}, ` +
        "a two-way reference this document has also changed there since the suggestion's copy was made");
    }
  }
}

/**
 * Whether a row id in a table belongs to some set, such as the rows the
 * fork adds.
 */
type RowCheck = (tableId: string, rowId: number) => boolean;

function rowCheck(rowsByTable: [string, number[]][]): RowCheck {
  const sets = new Map(rowsByTable.map(([tableId, rows]) => [tableId, new Set(rows)]));
  return (tableId, rowId) => Boolean(sets.get(tableId)?.has(rowId));
}

function removeActions({ tableId, forkDelta, isForkRemoved }: TablePlan): UserAction[] {
  // Rows both sides removed are left alone. If the trunk reused one's id,
  // removing it here would remove the trunk's new row.
  const rows = forkDelta.removeRows.filter(rowId => isForkRemoved(tableId, rowId));
  return rows.length === 0 ? [] : [["BulkRemoveRecord", tableId, rows]];
}

/**
 * Clear the one-to-one references the fork changes on existing rows,
 * before anything else claims a partner. The engine refuses a partner
 * claimed twice, and checks after every action, not just at the end of
 * the bundle. A swap split over two updates would otherwise fail, as would
 * an added row claiming a partner that an update frees later. The real
 * values follow in the update pass, when every partner is free.
 */
function releaseActions(table: TablePlan): UserAction[] {
  const oneToOne = table.columns.filter(col => col.twoWay?.pair === "oneToOne");
  const rows = existingUpdatedRows(table.forkDelta).map(rowId => ({
    rowId,
    values: Object.fromEntries(oneToOne.filter(col => col.cells[rowId]).map(col => [col.colId, 0])),
  }));
  return bulkUpdates(table.tableId, rows);
}

/**
 * Build the BulkAddRecords for one table. Values that name rows the fork
 * adds are kept out of them, since the row named may not have landed yet.
 * They come back as `deferredRefs`, to set once every row is in. Deferring
 * them all means tables need no particular order, and cycles just work.
 */
function addActions(table: TablePlan): { adds: UserAction[], deferredRefs: UserAction[] } {
  const { tableId, forkDelta } = table;
  // The engine hands out real row ids in bundle order, and new rows sort by
  // id, so add them in the order the fork created them.
  const rows = [...forkDelta.addRows].sort((a, b) => a - b).map((forkRowId) => {
    // Negating the fork's id keeps temp ids distinct within the table,
    // which is all the engine asks of them.
    const rowId = -forkRowId;
    const { immediate, deferred } = newRowValues(table, forkRowId);
    return { now: { rowId, values: immediate }, later: { rowId, values: deferred } };
  });
  // Grouping by column set leaves each column the fork did not set at its
  // default, rather than forcing null into it. Only neighbors group, which
  // keeps the order.
  const adds = groupAdjacentByColumnSet(rows.map(r => r.now)).map(
    group => ["BulkAddRecord", tableId, group.map(r => r.rowId),
      getColValues(group.map(r => r.values))] as UserAction);
  const deferredRefs = bulkUpdates(tableId, rows.map(r => r.later));
  return { adds, deferredRefs };
}

function updateActions(table: TablePlan): UserAction[] {
  const { tableId, forkDelta } = table;
  const rows = existingUpdatedRows(forkDelta).map((rowId) => {
    // Every BulkAddRecord is already in the bundle, so nothing here needs
    // deferring.
    const { immediate, deferred } = newRowValues(table, rowId);
    return { rowId, values: { ...immediate, ...deferred } };
  });
  return bulkUpdates(tableId, rows);
}

/**
 * The rows a table's delta updates that neither it adds nor removes. Rows
 * also being added get their final values in the BulkAddRecord; rows also
 * being removed are gone by the time updates run, and updating them would
 * throw. Summaries do list rows in two buckets at once, so filter here
 * rather than trusting them not to.
 */
function existingUpdatedRows(delta: TableDelta): number[] {
  const excludedRows = new Set([...delta.addRows, ...delta.removeRows]);
  return delta.updateRows.filter(r => !excludedRows.has(r));
}

/**
 * The values the fork gave one row, ready for the trunk, and split in
 * two: `deferred` has the Ref and RefList values that name rows the fork
 * adds (now given as temp ids), and `immediate` has everything else.
 */
function newRowValues(table: TablePlan, forkRowId: number) {
  const immediate: Record<string, CellValue> = {};
  const deferred: Record<string, CellValue> = {};
  for (const column of table.columns) {
    const cellDelta = column.cells[forkRowId];
    if (!cellDelta) { continue; }
    const result = trunkValue(table, column, extractValue(cellDelta[1]));
    (result.namesForkAdded ? deferred : immediate)[column.colId] = result.value;
  }
  return { immediate, deferred };
}

/**
 * A value from the fork, ready for the trunk: any references to rows the
 * fork adds become temp ids, with `namesForkAdded` set. A reference to a
 * row whose id the trunk has reused is refused.
 */
function trunkValue(table: TablePlan, column: PlannedColumn, value: CellValue) {
  refuseReusedRefs(table, column, value);
  const { refTableId } = column;
  const translated = refTableId ?
    translateRefValue(value, rowId => table.isForkAdded(refTableId, rowId)) : undefined;
  return translated ? { value: translated.value, namesForkAdded: true } : { value, namesForkAdded: false };
}

/**
 * Refuse a Ref or RefList value naming a row whose id the trunk has
 * reused for a new row, since it would land on that unrelated row. That
 * does not apply if the fork adds a row under the id, since it then names
 * the added row. A reference to a row the trunk removed without reusing
 * its id just dangles, which Grist allows.
 */
function refuseReusedRefs(table: TablePlan, { colId, refTableId }: PlannedColumn, value: CellValue) {
  if (!refTableId) { return; }
  const ids = typeof value === "number" ? [value] : isList(value) ? value.slice(1) : [];
  const reused = ids.find(id => typeof id === "number" && id > 0 &&
    !table.isForkAdded(refTableId, id) && table.isTrunkReused(refTableId, id));
  if (reused !== undefined) {
    throw new Error(`the suggestion sets ${table.tableId}.${colId} to refer to row ${reused} of ${refTableId}, ` +
      "which was removed from this document after the suggestion's copy was made, and its id reused");
  }
}

/**
 * Rewrite a Ref or RefList value so references to rows the fork adds
 * become temp ids. Those ids are the fork's, and the trunk's engine will
 * assign new ones, so without rewriting they land on the wrong row. Other
 * rows are taken to date from the branch point, so their ids mean the
 * same thing on both sides and pass through untouched.
 *
 * Returns undefined if nothing needed rewriting. The result is wrapped
 * because `CellValue` includes null, which would otherwise be
 * indistinguishable from "nothing to do".
 *
 * Known gap: a row the fork removes is not an added row, so a reference
 * to it passes through and dangles. Reused ids are refused before this,
 * by refuseReusedRefs.
 */
export function translateRefValue(
  forkValue: CellValue, isForkAdded: (rowId: number) => boolean,
): { value: CellValue } | undefined {
  const translate = (item: CellValue) =>
    (typeof item === "number" && item > 0 && isForkAdded(item)) ? -item : item;
  if (typeof forkValue === "number") {
    const value = translate(forkValue);
    return value === forkValue ? undefined : { value };
  }
  if (isList(forkValue)) {
    const items = forkValue.slice(1);
    const translated = items.map(translate);
    return translated.every((item, i) => item === items[i]) ? undefined :
      { value: [GristObjCode.List, ...translated] };
  }
  return undefined;
}

/**
 * Write the given rows, one BulkUpdateRecord per distinct column set. Rows
 * with nothing to write are left out.
 */
function bulkUpdates(tableId: string, rows: RowValues[]): UserAction[] {
  return groupByColumnSet(rows.filter(row => !isEmpty(row.values))).map(
    group => ["BulkUpdateRecord", tableId, group.map(r => r.rowId),
      getColValues(group.map(r => r.values))] as UserAction);
}

/**
 * Bucket rows by the set of columns they write, one bucket per BulkAdd or
 * BulkUpdate. Mixing rows with different column sets would force null
 * into columns some rows leave alone.
 */
function groupByColumnSet(rows: RowValues[]): RowValues[][] {
  return Object.values(groupBy(rows, columnSetKey));
}

/** Like groupByColumnSet, but only rows next to each other share a bucket. */
function groupAdjacentByColumnSet(rows: RowValues[]): RowValues[][] {
  const groups: RowValues[][] = [];
  let lastKey: string | undefined;
  for (const row of rows) {
    const key = columnSetKey(row);
    if (key === lastKey) {
      groups[groups.length - 1].push(row);
    } else {
      groups.push([row]);
      lastKey = key;
    }
  }
  return groups;
}

function columnSetKey(row: RowValues): string {
  // ColIds can't contain NUL, so the joined sorted-cols string is unique.
  return Object.keys(row.values).sort().join("\0");
}

// A CellDelta side is `[value]`, `"?"` (unknown), or `null` (cell didn't
// exist). The latter two collapse to null. Unknown values are refused in
// planTable, so here that only happens to cells the patch leaves alone.
function extractValue(side: CellDelta[0]): CellValue {
  return Array.isArray(side) ? side[0] : null;
}

/**
 * Describe one action for the patch log. Deriving the log from the actions,
 * rather than accumulating it alongside them, keeps the two from drifting.
 */
function describeAction(action: UserAction): PatchItem {
  const [name, tableId, rowIds, colValues] =
    action as [string, string, number[], BulkColValues];
  switch (name) {
    case "BulkAddRecord": return { kind: "add", tableId, rowCount: rowIds.length };
    case "BulkRemoveRecord": return { kind: "remove", tableId, rowCount: rowIds.length };
    case "BulkUpdateRecord":
      return { kind: "update", tableId, cellCount: rowIds.length * Object.keys(colValues).length };
    default: throw new Error(`patch built an action it cannot describe: ${name}`);
  }
}
