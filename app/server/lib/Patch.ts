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
  // The part the column plays in a two-way reference, if any:
  //   - "following": the side the engine keeps in step with the side the
  //     patch writes. See followingActions.
  //   - "oneToOne": the side the patch writes, where both sides are Refs,
  //     so each row pairs with at most one other. See releaseActions.
  //   - "manyToMany": the side the patch writes, where both sides are
  //     RefLists. See mergeLinks.
  twoWay?: "following" | "oneToOne" | "manyToMany";
}

export type GetColumnInfo = (tableId: string, colId: string) => ColumnInfo;

/**
 * Cells of the target as it is now, as read for the patch: tableId, then
 * colId, then rowId to value. See targetReads for which cells are read.
 */
export type TargetCells = Record<string, Record<string, Map<number, CellValue>>>;

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

      const getColumn: GetColumnInfo = (tableId, colId) => this._getColumnInfo(tableId, colId);
      const target = await this._readTarget(targetReads(userTables, getColumn, trunkChanges.tableDeltas));
      const actions = buildActions(userTables, getColumn, trunkChanges.tableDeltas, target);
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

  /**
   * Read the cells of the target that two-way references need.
   *
   * TODO: the read and the write that follows are separate steps, so a
   * change landing between them goes unseen, as does any change after the
   * trunk's summary was taken. Doing the read inside the same engine action
   * as the write would close the gap.
   *
   * The read is made as the user applying the patch, so what access rules
   * hide from them does not shape what is written in their name. A row or
   * column hidden from them goes unread. A hidden row holding a partner the
   * patch claims is not released, and the engine then refuses the claim. A
   * hidden row the patch unpairs is unpaired, as if unchanged since the
   * branch point. A hidden list is not merged into, and the patch is
   * refused.
   */
  private async _readTarget(reads: TargetRead[]): Promise<TargetCells> {
    const target: TargetCells = {};
    for (const { tableId, colId, rowIds, values } of reads) {
      const filters = rowIds ? { id: rowIds } : { [colId]: values ?? [] };
      const { tableData } = await this._activeDoc.fetchQuery(this._docSession, { tableId, filters });
      const [, , ids, colValues] = tableData;
      const column = colValues[colId];
      if (!column) { continue; }
      const cells = ((target[tableId] ??= {})[colId] ??= new Map());
      ids.forEach((id, i) => cells.set(id, column[i]));
    }
    return target;
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
    return { skip, refTableId, twoWay: this._twoWayRole(column) };
  }

  /**
   * The part a column plays in a two-way reference, if any. The engine
   * follows the RefList side of a Ref/RefList pair, and the later column of
   * a pair of the same kind. Which column of a same-kind pair is written
   * does not change which links result (see releaseActions,
   * isStaleUnpairing and mergeLinks), though it can change their order in
   * the other column.
   */
  private _twoWayRole(column: MetaRowRecord<"_grist_Tables_column">): ColumnInfo["twoWay"] {
    const reverse = column.reverseCol ? this._columns.getRecord(column.reverseCol) : undefined;
    if (!reverse) { return undefined; }
    const kind = extractInfoFromColType(column.type).type;
    const reverseKind = extractInfoFromColType(reverse.type).type;
    if (kind !== reverseKind) { return kind === "RefList" ? "following" : undefined; }
    if (column.id > reverse.id) { return "following"; }
    return kind === "Ref" ? "oneToOne" : "manyToMany";
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
 * A read of the target the patch needs before it can be built: either the
 * current values of some rows, or the rows whose cell currently holds one
 * of some values.
 */
export interface TargetRead {
  tableId: string;
  colId: string;
  rowIds?: number[];
  values?: number[];
}

/**
 * The cells of the target that two-way references need read before the
 * patch is built. For a many-to-many pair, the lists the patch changes on
 * the side it writes, to merge into (see mergeLinks). For a one-to-one
 * pair, the rows now holding the partners the patch claims, to release
 * (see releaseActions), and the rows the patch unpairs, to check they
 * still hold the partner being given up (see isStaleUnpairing).
 */
export function targetReads(
  userTables: [string, TableDelta][], getColumn: GetColumnInfo, trunkDeltas: Record<string, TableDelta> = {},
): TargetRead[] {
  return planTables(userTables, getColumn, trunkDeltas).flatMap(tableReads);
}

function tableReads(table: TablePlan): TargetRead[] {
  const { tableId, delta } = table;
  const existing = existingUpdatedRows(delta);
  const reads = table.columns.flatMap((column): TargetRead[] => {
    const { colId, cells } = column;
    const written = existing.filter(rowId => cells[rowId]);
    if (column.twoWay === "manyToMany") {
      return [{ tableId, colId, rowIds: written }];
    }
    if (column.twoWay === "oneToOne") {
      return [
        { tableId, colId, values: claimedPartners(delta, column, table.isAddedRow) },
        { tableId, colId, rowIds: written.filter(rowId => !isPartner(extractValue(cells[rowId][1]))) },
      ];
    }
    return [];
  });
  return reads.filter(read => (read.rowIds ?? read.values)?.length);
}

/**
 * Build the whole bundle without touching the document. The order matters:
 *   - Removes and releases free one-to-one partners (see releaseActions)
 *     before anything claims them.
 *   - Every Add precedes anything carrying a temp id: the Updates, whose
 *     Refs may name added rows, and the Ref values kept out of the Adds.
 *   - Reordered lists on the following side of a two-way reference go
 *     last, once the engine has settled what is in them.
 *
 * `target` has the cells targetReads asks for. Without it, many-to-many
 * lists are written whole, and only rows the patch itself changes release
 * one-to-one partners.
 */
export function buildActions(
  userTables: [string, TableDelta][], getColumn: GetColumnInfo, trunkDeltas: Record<string, TableDelta> = {},
  target?: TargetCells,
): UserAction[] {
  const tables = planTables(userTables, getColumn, trunkDeltas, target);
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

function planTables(
  userTables: [string, TableDelta][], getColumn: GetColumnInfo, trunkDeltas: Record<string, TableDelta>,
  target?: TargetCells,
): TablePlan[] {
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
  // Rows the patch removes from the target, which the target still has.
  const isRemovedRow = rowCheck(userTables.map(([tableId, delta]) =>
    [tableId, delta.removeRows.filter(rowId => !isGoneRow(tableId, rowId))]));
  const context: PatchContext = { isAddedRow, isGoneRow, isReusedRow, isRemovedRow, isTrunkUpdatedRow, target };
  return userTables.map(([tableId, delta]) => planTable(tableId, delta, getColumn, trunkDeltas[tableId], context));
}

// What planning each table needs to know about the patch as a whole.
interface PatchContext {
  isAddedRow: RowCheck;
  isGoneRow: RowCheck;
  isReusedRow: RowCheck;
  isRemovedRow: RowCheck;
  isTrunkUpdatedRow: RowCheck;
  // Cells read from the target as it is now, if read. See targetReads.
  target?: TargetCells;
}

// One table's part in the patch, with its columns looked up once.
interface TablePlan extends PatchContext {
  tableId: string;
  delta: TableDelta;
  // The columns to write, leaving out skipped ones.
  columns: PlannedColumn[];
  // The following sides of two-way references. See followingActions.
  following: PlannedColumn[];
  // What the target changed in this table since the branch point, if anything.
  trunkDelta?: TableDelta;
}

interface PlannedColumn extends ColumnInfo {
  colId: string;
  cells: ColumnDelta;
}

function planTable(
  tableId: string, delta: TableDelta, getColumn: GetColumnInfo, trunkDelta: TableDelta | undefined,
  context: PatchContext,
): TablePlan {
  // Changing a row the target has removed would fail if the id is free,
  // and change an unrelated row if it was reused.
  const goneUpdate = existingUpdatedRows(delta).find(rowId => context.isGoneRow(tableId, rowId));
  if (goneUpdate !== undefined) {
    throw new Error(`the suggestion changes row ${goneUpdate} of ${tableId}, ` +
      "which was removed from this document after the suggestion's copy was made");
  }
  const planned = Object.entries(delta.columnDeltas)
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
  const columns = planned.filter(col => col.twoWay !== "following");
  const following = planned.filter(col => col.twoWay === "following");
  return { ...context, tableId, delta, columns, following, trunkDelta };
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

function removeActions({ tableId, delta, isRemovedRow }: TablePlan): UserAction[] {
  // Both sides agree that a row the target has removed is gone. If its id
  // was reused, removing it here would remove the target's new row.
  const rows = delta.removeRows.filter(rowId => isRemovedRow(tableId, rowId));
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
 *
 * The target may also have given a partner the patch claims to some other
 * row since the branch point. That row is released too, so the patch's
 * claim lands, as the patch's value currently does for any cell both
 * sides changed, with no conflict reported. This matches what the engine
 * does when the other side is written.
 */
function releaseActions(table: TablePlan): UserAction[] {
  const { tableId, delta } = table;
  const existing = existingUpdatedRows(delta);
  const released = new Map<number, Record<string, CellValue>>();
  const release = (rowId: number, colId: string) => {
    released.set(rowId, { ...released.get(rowId), [colId]: 0 });
  };
  for (const column of table.columns.filter(col => col.twoWay === "oneToOne")) {
    const written = existing.filter(rowId => column.cells[rowId] && !isStaleUnpairing(table, column, rowId));
    written.forEach(rowId => release(rowId, column.colId));
    const claimed = new Set(claimedPartners(delta, column, table.isAddedRow));
    // Rows the patch removes are gone by now. A row the target added under
    // the id of one both sides removed is not, and is released like any.
    const inWritten = new Set(written);
    const skipped = (rowId: number) => inWritten.has(rowId) || table.isRemovedRow(tableId, rowId);
    for (const [rowId, partner] of table.target?.[tableId]?.[column.colId] ?? []) {
      if (typeof partner === "number" && claimed.has(partner) && !skipped(rowId)) {
        release(rowId, column.colId);
      }
    }
  }
  return bulkUpdates(tableId, [...released].map(([rowId, values]) => ({ rowId, values })));
}

/**
 * The partners a one-to-one column claims, in rows the patch adds or
 * updates. Partners the patch adds are left out, since nothing in the
 * target can hold them yet.
 */
function claimedPartners(
  delta: TableDelta, { cells, refTableId }: Pick<PlannedColumn, "cells" | "refTableId">, isAddedRow: RowCheck,
): number[] {
  return [...delta.addRows, ...existingUpdatedRows(delta)]
    .map(rowId => cells[rowId] && extractValue(cells[rowId][1]))
    .filter((partner): partner is number => isPartner(partner) && !(refTableId && isAddedRow(refTableId, partner)));
}

// Whether a Ref value names a row, rather than being empty.
function isPartner(value: CellValue | undefined): value is number {
  return typeof value === "number" && value > 0;
}

/**
 * Whether the patch unpairs a row, on the written side of a one-to-one
 * reference, from a partner the target has since unpaired it from. As in
 * mergeLinks, the change is taken as a link removed, and the target no
 * longer has that link to remove. Clearing the row anyway would undo the
 * target's own pairing, and only where this side is the one written: from
 * the other side, the patch would clear the old partner's cell, and leave
 * this row alone.
 */
function isStaleUnpairing(table: TablePlan, column: PlannedColumn, rowId: number): boolean {
  const cellDelta = column.cells[rowId];
  if (column.twoWay !== "oneToOne" || !cellDelta || isPartner(extractValue(cellDelta[1]))) { return false; }
  const current = table.target?.[table.tableId]?.[column.colId]?.get(rowId);
  // Not read, or not a row id, as when censored: see Patch._readTarget.
  if (current === undefined || (current !== null && typeof current !== "number")) { return false; }
  const partner = (value: CellValue) => isPartner(value) ? value : 0;
  return partner(current) !== partner(extractValue(cellDelta[0]));
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
    const { plain, namingAdded } = newRowValues(table, rowId, { existing: true });
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
 * For a row the target already has, many-to-many lists are merged into
 * the target's, and left out if that changes nothing.
 */
function newRowValues(table: TablePlan, sourceRowId: number, options: { existing?: boolean } = {}) {
  const plain: Record<string, CellValue> = {};
  const namingAdded: Record<string, CellValue> = {};
  for (const column of table.columns) {
    const cellDelta = column.cells[sourceRowId];
    if (!cellDelta || (options.existing && isStaleUnpairing(table, column, sourceRowId))) { continue; }
    const result = (options.existing && column.twoWay === "manyToMany") ?
      mergedValue(table, column, sourceRowId, cellDelta) :
      targetValue(table, column, extractValue(cellDelta[1]));
    if (!result) { continue; }
    (result.namesAdded ? namingAdded : plain)[column.colId] = result.value;
  }
  return { plain, namingAdded };
}

/**
 * The value to write to the written side of a many-to-many reference, in
 * a row the target has. If the target's list is as it was at the branch
 * point, the source's list is written as is, order and all. Otherwise the
 * source's change is merged into the target's list (see mergeLinks), and
 * undefined is returned if that leaves it unchanged.
 */
function mergedValue(table: TablePlan, column: PlannedColumn, rowId: number, cellDelta: CellDelta) {
  const sourceValue = extractValue(cellDelta[1]);
  if (!table.target) { return targetValue(table, column, sourceValue); }
  const { tableId } = table;
  const { colId, refTableId } = column;
  const current = table.target[tableId]?.[colId]?.get(rowId);
  const [baseIds, sourceIds, now] = [extractValue(cellDelta[0]), sourceValue, current].map(linkIds);
  if (!now) {
    // Not read, or censored: see Patch._readTarget.
    throw new Error(`the suggestion changes ${tableId}.${colId} in row ${rowId}, ` +
      "and this document's value there could not be read as a list to merge into, " +
      "perhaps because access rules hide it");
  }
  if (!baseIds || !sourceIds) {
    throw new Error(`the suggestion changes ${tableId}.${colId} in row ${rowId}, ` +
      "and not as a list whose change could be merged");
  }
  const refersTo = (check: RowCheck, id: number) => Boolean(refTableId && check(refTableId, id));
  // A row of the branch point the target removed and reused the id of is
  // not the row now listed under that id. The source's link to it, kept or
  // dropped, is left out. Only a new link to it is refused, in targetValue.
  const isStale = (id: number) => refersTo(table.isReusedRow, id) && !refersTo(table.isAddedRow, id);
  const inBase = new Set(baseIds);
  const base = baseIds.filter(id => !isStale(id));
  const sourceKept = sourceIds.filter(id => !(isStale(id) && inBase.has(id)));
  const proposed = targetValue(table, column,
    sourceKept.length === sourceIds.length ? sourceValue : [GristObjCode.List, ...sourceKept]);
  if (isEqual(base, now)) { return proposed; }
  // Rows the patch removes are unlinked before this is written, and must
  // stay so.
  const live = now.filter(id => !refersTo(table.isRemovedRow, id));
  const merged = mergeLinks(base, linkIds(proposed.value) ?? [], live);
  if (isEqual(merged, live)) { return undefined; }
  return { value: [GristObjCode.List, ...merged] as CellValue, namesAdded: merged.some(id => id < 0) };
}

/**
 * Merge the source's change to one side of a many-to-many reference into
 * the target's list, where the target changed the list too. Each side is
 * one set of links, shown twice, so the change is taken as links added and
 * removed rather than as a new list. Nothing the target linked or unlinked
 * is undone: writing the source's list whole would drop any row the target
 * linked meanwhile, and which rows could be dropped would depend on which
 * side of the pair is written. Links the target kept stay in its order,
 * and the source's new ones follow in the source's order.
 *
 * All three are row ids as the target knows them: `proposed` with rows the
 * patch adds as temp ids, which cannot match anything in `current`.
 */
export function mergeLinks(base: number[], proposed: number[], current: number[]): number[] {
  const [inBase, inProposed] = [new Set(base), new Set(proposed)];
  const kept = current.filter(id => !inBase.has(id) || inProposed.has(id));
  const inKept = new Set(kept);
  const added = proposed.filter(id => !inBase.has(id) && !inKept.has(id));
  return [...kept, ...added];
}

// The row ids in a RefList value, or undefined if it is not one, or was
// not read. An empty RefList may be stored as null.
function linkIds(value: CellValue | undefined): number[] | undefined {
  if (value === undefined) { return undefined; }
  if (value === null || value === "") { return []; }
  if (!isList(value)) { return undefined; }
  const ids = value.slice(1);
  return ids.every(id => typeof id === "number") ? ids : undefined;
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
