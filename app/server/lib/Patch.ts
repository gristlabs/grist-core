/**
 * An implementation of daff (tabular diff tool) to apply changes.
 * Incomplete and naive.
 *
 * A patch lands as a single applyUserActions call, so a proposal either
 * applies fully or not at all. Rows it adds carry negative temporary ids
 * that the engine replaces with real ones as the bundle applies.
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
import isEqual from "lodash/isEqual";
import sortBy from "lodash/sortBy";

/**
 * What planning a patch needs to know about a column of the target document.
 */
export interface ColumnInfo {
  // Formula and hidden columns, which the target computes.
  skip: boolean;
  // For a Ref or RefList column, the table it points into.
  refTableId?: string;
  // Set on the side of a two-way reference that the engine keeps in step
  // with the side the patch writes. See followingActions.
  following?: boolean;
  // Set on the side the patch writes of a two-way reference where both
  // sides are Refs, so each row pairs with at most one other. See
  // releaseActions.
  oneToOne?: boolean;
}

export type GetColumnInfo = (tableId: string, colId: string) => ColumnInfo;

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
   * made to this document since the branch point, as it is now. On success,
   * returns a note per engine action applied. On failure, whether while
   * building the actions or when the engine rejects them, returns a single
   * error note, and nothing has been applied.
   */
  public async applyChanges(details: DocStateComparisonDetails, trunkChanges: ActionSummary): Promise<PatchLog> {
    const changes: PatchItem[] = [];
    try {
      const summary = details.leftChanges;

      if (summary.tableRenames.length > 0) {
        throw new Error("table-level changes cannot be handled yet");
      }

      // Ignore metadata for now. Filtered before the guards below, so they
      // cannot refuse a patch over a table nothing here would touch.
      const userTables: [string, TableDelta][] = Object.entries(summary.tableDeltas)
        .filter(([tableId]) => !tableId.startsWith("_grist_"));

      for (const [tableId, delta] of userTables) {
        if (delta.columnRenames.length > 0) {
          throw new Error("column-level changes cannot be handled yet");
        }
        // A summary truncated under a row cap reads its dropped cells as
        // "?", which would apply as nulls over real data. Callers must
        // summarize with maximumInlineRows: null.
        if (delta.mayBeIncomplete) {
          throw new Error(`summary for table ${tableId} may be incomplete; refusing to apply`);
        }
      }

      const actions = buildActions(userTables, (tableId, colId) => this._getColumnInfo(tableId, colId),
        trunkChanges.tableDeltas);
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
    return { skip, refTableId, ...this._twoWayRole(column) };
  }

  /**
   * The part a column plays in a two-way reference, if any. The engine
   * follows the RefList side of a Ref/RefList pair, and the later column of
   * a pair of the same kind.
   */
  private _twoWayRole(column: MetaRowRecord<"_grist_Tables_column">): Pick<ColumnInfo, "following" | "oneToOne"> {
    const reverse = column.reverseCol ? this._columns.getRecord(column.reverseCol) : undefined;
    if (!reverse) { return {}; }
    const kind = (col: MetaRowRecord<"_grist_Tables_column">) => extractInfoFromColType(col.type).type;
    const following = (kind(column) !== kind(reverse)) ? kind(column) === "RefList" : column.id > reverse.id;
    const oneToOne = kind(column) === "Ref" && kind(reverse) === "Ref";
    return following ? { following } : { oneToOne };
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
 * Build the whole bundle without touching the document. The order matters:
 *   - Removes and releases free one-to-one partners (see releaseActions)
 *     before anything claims them.
 *   - Every Add precedes anything carrying a temp id: the Updates, whose
 *     Refs may name added rows, and the Ref values kept out of the Adds.
 *   - Reordered lists on the following side of a two-way reference go
 *     last, once the engine has settled what is in them.
 */
export function buildActions(
  userTables: [string, TableDelta][], getColumn: GetColumnInfo, trunkDeltas: Record<string, TableDelta> = {},
): UserAction[] {
  // Source row ids this patch adds, per table.
  const isAddedRow = rowCheck(userTables.map(([tableId, delta]) => [tableId, delta.addRows]));
  // Rows of the branch point the target has removed since. On the source,
  // the same ids still mean the branch point's rows. Some ids the target
  // has reused for new rows, listed as both removed and added.
  const trunkEntries = Object.entries(trunkDeltas);
  const isGoneRow = rowCheck(trunkEntries.map(([tableId, delta]) => [tableId, delta.removeRows]));
  const isReusedRow = rowCheck(trunkEntries.map(([tableId, delta]) => {
    const added = new Set(delta.addRows);
    return [tableId, delta.removeRows.filter(rowId => added.has(rowId))];
  }));
  const isTrunkUpdatedRow = rowCheck(trunkEntries.map(([tableId, delta]) => [tableId, delta.updateRows]));
  const tables = userTables.map(([tableId, delta]) => planTable(tableId, delta, getColumn, isAddedRow,
    { isGoneRow, isReusedRow, isTrunkUpdatedRow, trunkDelta: trunkDeltas[tableId] }));

  const adds = tables.map(addActions);
  return [
    ...tables.flatMap(removeActions),
    ...tables.flatMap(releaseActions),
    ...adds.flatMap(a => a.adds),
    ...tables.flatMap(updateActions),
    ...adds.flatMap(a => a.laterRefs),
    ...tables.flatMap(followingActions),
  ];
}

// One table's part in the patch, with its columns looked up once.
interface TablePlan {
  tableId: string;
  delta: TableDelta;
  // The columns to write, leaving out skipped ones.
  columns: PlannedColumn[];
  // The following sides of two-way references. See followingActions.
  following: PlannedColumn[];
  isAddedRow: RowCheck;
  isGoneRow: RowCheck;
  isReusedRow: RowCheck;
  isTrunkUpdatedRow: RowCheck;
  // What the target changed in this table since the branch point, if anything.
  trunkDelta?: TableDelta;
}

interface PlannedColumn extends ColumnInfo {
  colId: string;
  cells: ColumnDelta;
}

function planTable(
  tableId: string, delta: TableDelta, getColumn: GetColumnInfo, isAddedRow: RowCheck,
  trunk: Pick<TablePlan, "isGoneRow" | "isReusedRow" | "isTrunkUpdatedRow" | "trunkDelta">,
): TablePlan {
  // Changing a row the target has removed would fail if the id is free,
  // and change an unrelated row if it was reused.
  const goneUpdate = existingUpdatedRows(delta).find(rowId => trunk.isGoneRow(tableId, rowId));
  if (goneUpdate !== undefined) {
    throw new Error(`the suggestion changes row ${goneUpdate} of ${tableId}, ` +
      "which was removed from this document after the suggestion's copy was made");
  }
  const planned = Object.entries(delta.columnDeltas)
    .map(([colId, cells]): PlannedColumn => ({ colId, cells, ...getColumn(tableId, colId) }))
    .filter(col => !col.skip);
  const columns = planned.filter(col => !col.following);
  const following = planned.filter(col => col.following);
  return { tableId, delta, columns, following, isAddedRow, ...trunk };
}

/**
 * Whether a row id in a table belongs to some set, such as the rows the
 * patch adds.
 */
export type RowCheck = (tableId: string, rowId: number) => boolean;

function rowCheck(rowsByTable: [string, number[]][]): RowCheck {
  const sets = new Map(rowsByTable.map(([tableId, rows]) => [tableId, new Set(rows)]));
  return (tableId, rowId) => Boolean(sets.get(tableId)?.has(rowId));
}

function removeActions({ tableId, delta, isGoneRow }: TablePlan): UserAction[] {
  // Both sides agree that a row the target has removed is gone. If its id
  // was reused, removing it here would remove the target's new row.
  const rows = delta.removeRows.filter(rowId => !isGoneRow(tableId, rowId));
  return rows.length === 0 ? [] : [["BulkRemoveRecord", tableId, rows]];
}

/**
 * Clear the one-to-one references this patch changes on existing rows,
 * before anything else claims a partner. The engine refuses a partner
 * claimed twice, and checks after every action, not just at the end of
 * the bundle. Without this, a row could claim its new partner while that
 * partner's old claimant still held it: an Add going before the update
 * that frees its partner, or a swap split over two updates. The real
 * values follow in the update pass, when every partner is free.
 */
function releaseActions(table: TablePlan): UserAction[] {
  const oneToOne = table.columns.filter(col => col.oneToOne);
  const rows = existingUpdatedRows(table.delta).map(rowId => ({
    rowId,
    values: Object.fromEntries(oneToOne.filter(col => col.cells[rowId]).map(col => [col.colId, 0])),
  }));
  return bulkUpdates(table.tableId, rows);
}

/**
 * Build the Adds for one table. Values that name rows this patch adds
 * cannot go in an Add, since the row named may not have landed yet. They
 * are returned separately, as `laterRefs`, to set once every row is in.
 * Treating them all this way frees the patch from ordering tables to suit
 * its references, and resolves cycles both ways.
 */
function addActions(table: TablePlan): { adds: UserAction[], laterRefs: UserAction[] } {
  const { tableId, delta } = table;
  // The engine hands out real row ids in bundle order, and new rows sort by
  // id, so add them in the order the source created them.
  const rows = [...delta.addRows].sort((a, b) => a - b).map((sourceRowId) => {
    // Negating the source id keeps temp ids distinct within the table,
    // which is all the engine asks of them.
    const rowId = -sourceRowId;
    const { plain, namingAdded } = newRowValues(table, sourceRowId);
    return { now: { rowId, values: plain }, later: { rowId, values: namingAdded } };
  });
  // Grouping by column set leaves each column the source did not set at
  // its default, rather than forcing null into it. Only neighbors group,
  // which keeps the order.
  const adds = groupAdjacentByColumnSet(rows.map(r => r.now)).map(
    group => ["BulkAddRecord", tableId, group.map(r => r.rowId),
      getColValues(group.map(r => r.values))] as UserAction);
  const laterRefs = bulkUpdates(tableId, rows.map(r => r.later));
  return { adds, laterRefs };
}

function updateActions(table: TablePlan): UserAction[] {
  const { tableId, delta } = table;
  const rows = existingUpdatedRows(delta).map((rowId) => {
    // Every Add is already in the bundle, so temp ids here resolve, and
    // values naming added rows can go in with the rest.
    const { plain, namingAdded } = newRowValues(table, rowId);
    return { rowId, values: { ...plain, ...namingAdded } };
  });
  return bulkUpdates(tableId, rows);
}

/**
 * In a two-way reference, the engine keeps each side in step with the
 * other, so a change to one shows up in the summary on both. Writing both
 * sides is at best redundant. At worst it fails: a pet moved to a new
 * owner would be listed by the new owner, in its Add, while the old owner
 * still lists it, and the engine refuses a pet with two owners. So the
 * patch writes one side, and leaves the other, following side to the
 * engine.
 *
 * The one change the engine cannot follow is a list put in a new order
 * with the same rows in it, since that changes nothing on the other side.
 * Those are written here, last, once everything else has settled. Where
 * the rows in a list changed as well, its new order is lost, and the order
 * the engine gives it stands.
 *
 * A reorder is also dropped if the target changed the same list since the
 * branch point. Writing the source's list whole would undo the target's
 * change, and through the engine, change rows the source never touched,
 * such as unsetting the owner of a pet the target gave this owner.
 */
function followingActions(table: TablePlan): UserAction[] {
  const rows = existingUpdatedRows(table.delta).map((rowId) => {
    const values: Record<string, CellValue> = {};
    for (const column of table.following) {
      const cellDelta = column.cells[rowId];
      if (!cellDelta) { continue; }
      const before = extractValue(cellDelta[0]);
      const after = extractValue(cellDelta[1]);
      if (isList(before) && isList(after) && isEqual(sortBy(before.slice(1)), sortBy(after.slice(1))) &&
        !trunkChangedCell(table, column.colId, rowId)) {
        values[column.colId] = targetValue(table, column, after).value;
      }
    }
    return { rowId, values };
  });
  return bulkUpdates(table.tableId, rows);
}

/**
 * Whether the target changed a cell since the branch point. If the
 * target's summary may have dropped cells for the table, any change to
 * the row counts.
 */
function trunkChangedCell(table: TablePlan, colId: string, rowId: number): boolean {
  const { trunkDelta } = table;
  if (!trunkDelta || !table.isTrunkUpdatedRow(table.tableId, rowId)) { return false; }
  return Boolean(trunkDelta.mayBeIncomplete || trunkDelta.columnDeltas[colId]?.[rowId]);
}

/**
 * The rows a table's delta updates that neither it adds nor removes. Rows
 * also being added get their final values in the Add; rows also being
 * removed are gone by the time updates run, and updating them would throw.
 * Summaries do list rows in two buckets at once, so filter here rather
 * than trusting them not to.
 */
function existingUpdatedRows(delta: TableDelta): number[] {
  const excludedRows = new Set([...delta.addRows, ...delta.removeRows]);
  return delta.updateRows.filter(r => !excludedRows.has(r));
}

/**
 * The values the source gave one row, ready for the target, and split in
 * two: `namingAdded` has the Ref and RefList values that name rows this
 * patch adds (now given as temp ids), and `plain` has everything else.
 */
function newRowValues(table: TablePlan, sourceRowId: number) {
  const plain: Record<string, CellValue> = {};
  const namingAdded: Record<string, CellValue> = {};
  for (const column of table.columns) {
    const cellDelta = column.cells[sourceRowId];
    if (!cellDelta) { continue; }
    const { value, namesAdded } = targetValue(table, column, extractValue(cellDelta[1]));
    (namesAdded ? namingAdded : plain)[column.colId] = value;
  }
  return { plain, namingAdded };
}

/**
 * A value from the source, ready for the target: any references to rows
 * the patch adds become temp ids, with `namesAdded` set. A reference to a
 * row whose id the target has reused is refused.
 */
function targetValue(table: TablePlan, column: PlannedColumn, value: CellValue) {
  refuseReusedRefs(table, column, value);
  const translated = translateRefValue(column.refTableId, value, table.isAddedRow);
  return translated ? { value: translated.value, namesAdded: true } : { value, namesAdded: false };
}

/**
 * Refuse a Ref or RefList value naming a row whose id the target has
 * reused for a new row, since it would land on that unrelated row. That
 * does not apply if the patch adds a row under the id, since it then names
 * the added row. A reference to a row the target removed without reusing
 * its id just dangles, which Grist allows, as it would on the target alone.
 */
function refuseReusedRefs(table: TablePlan, { colId, refTableId }: PlannedColumn, value: CellValue) {
  if (!refTableId) { return; }
  const ids = typeof value === "number" ? [value] : isList(value) ? value.slice(1) : [];
  const reused = ids.find(id => typeof id === "number" && id > 0 &&
    !table.isAddedRow(refTableId, id) && table.isReusedRow(refTableId, id));
  if (reused !== undefined) {
    throw new Error(`the suggestion sets ${table.tableId}.${colId} to refer to row ${reused} of ${refTableId}, ` +
      "which was removed from this document after the suggestion's copy was made, and its id reused");
  }
}

/**
 * Rewrite a Ref or RefList value so references to rows the patch adds
 * become temp ids. A cross-doc reference carries a source-side id that the
 * target's engine will reassign, so without rewriting it lands on the
 * wrong row. Rows the patch does not add are taken to be shared with the
 * common ancestor, so their ids mean the same thing on both sides and pass
 * through untouched.
 *
 * Returns undefined if nothing needed rewriting. The result is wrapped
 * because `CellValue` includes null, which would otherwise be
 * indistinguishable from "nothing to do".
 *
 * Known gap: an id this same patch removes is not an added row, so it
 * passes through and lands dangling. Ids the target reused are refused
 * before this, by refuseReusedRefs.
 */
export function translateRefValue(
  refTableId: string | undefined, sourceValue: CellValue, isAddedRow: RowCheck,
): { value: CellValue } | undefined {
  if (!refTableId) { return undefined; }
  const translate = (item: CellValue) =>
    (typeof item === "number" && item > 0 && isAddedRow(refTableId, item)) ? -item : item;
  if (typeof sourceValue === "number") {
    const value = translate(sourceValue);
    return value === sourceValue ? undefined : { value };
  }
  if (isList(sourceValue)) {
    const items = sourceValue.slice(1);
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
// exist). The latter two collapse to null.
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
