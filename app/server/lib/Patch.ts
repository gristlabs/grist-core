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
import isEqual from "lodash/isEqual";
import sortBy from "lodash/sortBy";

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
      const trunkDeltas = trunkChanges.tableDeltas;
      const trunkCells = await this._readTrunk(trunkReads(userTables, getColumn, trunkDeltas));
      const actions = buildActions(userTables, getColumn, trunkDeltas, trunkCells);
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
   * Read the trunk cells that two-way references need.
   *
   * TODO: the read and the write that follows are separate steps, so a
   * change landing between them goes unseen, as does any change after the
   * trunk's summary was taken. Doing the read inside the same engine action
   * as the write would close the gap.
   *
   * The read is made as the user applying the patch, so what access rules
   * hide from them does not shape what is written in their name. A row or
   * column hidden from them goes unread. A hidden row holding a partner the
   * fork claims is not released, and the engine then refuses the claim. A
   * hidden row the fork unpairs is unpaired, as if unchanged since the
   * branch point. A hidden list is not merged into, and the patch is
   * refused.
   */
  private async _readTrunk(reads: TrunkRead[]): Promise<TrunkCells> {
    const trunkCells: TrunkCells = {};
    for (const { tableId, colId, rowIds, values } of reads) {
      const filters = rowIds ? { id: rowIds } : { [colId]: values ?? [] };
      const { tableData } = await this._activeDoc.fetchQuery(this._docSession, { tableId, filters });
      const [, , ids, colValues] = tableData;
      const column = colValues[colId];
      if (!column) { continue; }
      const cells = ((trunkCells[tableId] ??= {})[colId] ??= new Map());
      ids.forEach((id, i) => cells.set(id, column[i]));
    }
    return trunkCells;
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
   * Which side of a two-way reference the patch writes. Of a Ref/RefList
   * pair, it writes the Ref. Of a pair of the same kind, it writes the
   * column with the lower id. Either choice gives the same links (see
   * releaseActions, isStaleUnpairing and mergeLinks), though it can change
   * their order on the mirror side.
   */
  private _twoWayRole(column: MetaRowRecord<"_grist_Tables_column">): ColumnInfo["twoWay"] {
    const reverse = column.reverseCol ? this._columns.getRecord(column.reverseCol) : undefined;
    if (!reverse) { return undefined; }
    const kind = extractInfoFromColType(column.type).type;
    const reverseKind = extractInfoFromColType(reverse.type).type;
    if (kind !== reverseKind) { return kind === "RefList" ? "mirror" : undefined; }
    if (column.id > reverse.id) { return "mirror"; }
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
 * What planning a patch needs to know about a trunk column.
 */
export interface ColumnInfo {
  // Formula and hidden columns, which the trunk computes.
  skip: boolean;
  // For a Ref or RefList column, the table it points into.
  refTableId?: string;
  // The patch writes one side of each two-way reference, and the engine
  // updates the other side to match. Values:
  //   - "mirror": the side left to the engine. See reorderActions.
  //   - "oneToOne": the side written, where both sides are Refs.
  //     See releaseActions.
  //   - "manyToMany": the side written, where both sides are RefLists.
  //     See mergeLinks.
  twoWay?: "mirror" | "oneToOne" | "manyToMany";
}

export type GetColumnInfo = (tableId: string, colId: string) => ColumnInfo;

/**
 * Trunk cells read for the patch: tableId, then colId, then rowId to
 * value. See trunkReads for which cells are read.
 */
export type TrunkCells = Record<string, Record<string, Map<number, CellValue>>>;

/**
 * A read of the trunk the patch needs before it can be built: either the
 * current values of some rows, or the rows whose cell currently holds one
 * of some values.
 */
export interface TrunkRead {
  tableId: string;
  colId: string;
  rowIds?: number[];
  values?: number[];
}

/**
 * The trunk cells that two-way references need read before the patch is
 * built. For a many-to-many pair, the lists the fork changes, to merge
 * into (see mergeLinks). For a one-to-one pair, the rows now holding the
 * partners the fork claims, to release (see releaseActions), and the rows
 * the fork unpairs, to check they still hold the partner being given up
 * (see isStaleUnpairing).
 */
export function trunkReads(
  userTables: [string, TableDelta][], getColumn: GetColumnInfo, trunkDeltas: Record<string, TableDelta> = {},
): TrunkRead[] {
  return planTables(userTables, getColumn, trunkDeltas).flatMap(tableReads);
}

function tableReads(table: TablePlan): TrunkRead[] {
  const { tableId, forkDelta } = table;
  const existing = existingUpdatedRows(forkDelta);
  const reads = table.columns.flatMap((column): TrunkRead[] => {
    const { colId, cells } = column;
    const written = existing.filter(rowId => cells[rowId]);
    if (column.twoWay === "manyToMany") {
      return [{ tableId, colId, rowIds: written }];
    }
    if (column.twoWay === "oneToOne") {
      return [
        { tableId, colId, values: claimedPartners(forkDelta, column, table.isForkAdded) },
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
 *   - Every BulkAddRecord precedes anything carrying a temp id: the
 *     updates, whose Refs may name added rows, and the deferred Refs of
 *     the added rows themselves.
 *   - Reordered mirror lists go last, once the engine has settled what is
 *     in them.
 *
 * `trunkCells` has the cells trunkReads asks for. Without it, many-to-many
 * lists are written whole, and only rows the fork itself changes release
 * one-to-one partners.
 */
export function buildActions(
  userTables: [string, TableDelta][], getColumn: GetColumnInfo, trunkDeltas: Record<string, TableDelta> = {},
  trunkCells?: TrunkCells,
): UserAction[] {
  const tables = planTables(userTables, getColumn, trunkDeltas, trunkCells);
  const adds = tables.map(addActions);
  return [
    ...tables.flatMap(removeActions),
    ...tables.flatMap(releaseActions),
    ...adds.flatMap(a => a.adds),
    ...tables.flatMap(updateActions),
    ...adds.flatMap(a => a.deferredRefs),
    ...tables.flatMap(reorderActions),
  ];
}

function planTables(
  userTables: [string, TableDelta][], getColumn: GetColumnInfo, trunkDeltas: Record<string, TableDelta>,
  trunkCells?: TrunkCells,
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
  const isTrunkUpdated = rowCheck(trunkEntries.map(([tableId, delta]) => [tableId, delta.updateRows]));
  // Rows the fork removed that the trunk still has.
  const isForkRemoved = rowCheck(userTables.map(([tableId, delta]) =>
    [tableId, delta.removeRows.filter(rowId => !isTrunkRemoved(tableId, rowId))]));
  const context: PatchContext = {
    isForkAdded, isForkRemoved, isTrunkRemoved, isTrunkReused, isTrunkUpdated, trunkCells,
  };
  return userTables.map(([tableId, forkDelta]) =>
    planTable(tableId, forkDelta, getColumn, trunkDeltas[tableId], context));
}

// What planning each table needs to know about the patch as a whole.
interface PatchContext {
  isForkAdded: RowCheck;
  isForkRemoved: RowCheck;
  isTrunkRemoved: RowCheck;
  isTrunkReused: RowCheck;
  isTrunkUpdated: RowCheck;
  // Trunk cells, if read. See trunkReads.
  trunkCells?: TrunkCells;
}

// One table's part in the patch.
interface TablePlan extends PatchContext {
  tableId: string;
  forkDelta: TableDelta;
  // The columns to write, leaving out skipped ones.
  columns: PlannedColumn[];
  // The mirror sides of two-way references. See reorderActions.
  mirrors: PlannedColumn[];
  trunkDelta?: TableDelta;
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
  const columns = planned.filter(col => col.twoWay !== "mirror");
  const mirrors = planned.filter(col => col.twoWay === "mirror");
  return { ...context, tableId, forkDelta, columns, mirrors, trunkDelta };
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
 *
 * If the trunk has since given a claimed partner to some other row, that
 * row is released too, so the fork's claim lands. That matches how the
 * fork wins any cell both sides changed, with no conflict reported.
 */
function releaseActions(table: TablePlan): UserAction[] {
  const { tableId, forkDelta } = table;
  const existing = existingUpdatedRows(forkDelta);
  const released = new Map<number, Record<string, CellValue>>();
  const release = (rowId: number, colId: string) => {
    released.set(rowId, { ...released.get(rowId), [colId]: 0 });
  };
  for (const column of table.columns.filter(col => col.twoWay === "oneToOne")) {
    const written = existing.filter(rowId => column.cells[rowId] && !isStaleUnpairing(table, column, rowId));
    written.forEach(rowId => release(rowId, column.colId));
    const claimed = new Set(claimedPartners(forkDelta, column, table.isForkAdded));
    // Rows the fork removes are gone by now. A row the trunk added under
    // the id of one both sides removed is not, and is released like any.
    const inWritten = new Set(written);
    const skipped = (rowId: number) => inWritten.has(rowId) || table.isForkRemoved(tableId, rowId);
    for (const [rowId, partner] of table.trunkCells?.[tableId]?.[column.colId] ?? []) {
      if (typeof partner === "number" && claimed.has(partner) && !skipped(rowId)) {
        release(rowId, column.colId);
      }
    }
  }
  return bulkUpdates(tableId, [...released].map(([rowId, values]) => ({ rowId, values })));
}

/**
 * The partners a one-to-one column names, in rows the fork adds or
 * updates, other than partners the fork adds too. No trunk row can hold
 * one of those yet, so there is nothing to release or read.
 */
function claimedPartners(
  forkDelta: TableDelta, { cells, refTableId }: Pick<PlannedColumn, "cells" | "refTableId">, isForkAdded: RowCheck,
): number[] {
  return [...forkDelta.addRows, ...existingUpdatedRows(forkDelta)]
    .map(rowId => cells[rowId] && extractValue(cells[rowId][1]))
    .filter((partner): partner is number => isPartner(partner) && !(refTableId && isForkAdded(refTableId, partner)));
}

// Whether a Ref value names a row, rather than being empty.
function isPartner(value: CellValue | undefined): value is number {
  return typeof value === "number" && value > 0;
}

/**
 * Whether the fork unpairs a row of a one-to-one reference from a partner
 * the trunk has since unpaired it from. As in mergeLinks, the change is
 * taken as a link removed, and the trunk no longer has that link. Clearing
 * the row anyway would undo the trunk's own pairing.
 */
function isStaleUnpairing(table: TablePlan, column: PlannedColumn, rowId: number): boolean {
  const cellDelta = column.cells[rowId];
  if (column.twoWay !== "oneToOne" || !cellDelta || isPartner(extractValue(cellDelta[1]))) { return false; }
  const current = table.trunkCells?.[table.tableId]?.[column.colId]?.get(rowId);
  // Not read, or not a row id, as when censored: see Patch._readTrunk.
  if (current === undefined || (current !== null && typeof current !== "number")) { return false; }
  const partner = (value: CellValue) => isPartner(value) ? value : 0;
  return partner(current) !== partner(extractValue(cellDelta[0]));
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
    const { immediate, deferred } = newRowValues(table, rowId, { existing: true });
    return { rowId, values: { ...immediate, ...deferred } };
  });
  return bulkUpdates(tableId, rows);
}

/**
 * Write reorders of mirror lists, last of all.
 *
 * A two-way change shows up in the fork's summary on both sides. The patch
 * writes only one side, since writing both could fail: a pet moved to a
 * new owner would be listed in the new owner's BulkAddRecord while the old
 * owner still listed it, and the engine refuses a pet with two owners.
 *
 * A reorder that keeps the same rows changes nothing on the other side, so
 * the engine has nothing to carry over, and it is written here. Where the
 * rows in a list changed as well, the fork's order is lost, and the
 * engine's order stands.
 *
 * A reorder is dropped if the trunk also changed that list. Writing the
 * fork's whole list would undo the trunk's change, and the engine would
 * pass that on to rows the fork never touched.
 */
function reorderActions(table: TablePlan): UserAction[] {
  const rows = existingUpdatedRows(table.forkDelta).map((rowId) => {
    const values: Record<string, CellValue> = {};
    for (const column of table.mirrors) {
      const cellDelta = column.cells[rowId];
      if (!cellDelta) { continue; }
      const before = extractValue(cellDelta[0]);
      const after = extractValue(cellDelta[1]);
      if (isList(before) && isList(after) && isEqual(sortBy(before.slice(1)), sortBy(after.slice(1))) &&
        !trunkChangedCell(table, column.colId, rowId)) {
        values[column.colId] = trunkValue(table, column, after).value;
      }
    }
    return { rowId, values };
  });
  return bulkUpdates(table.tableId, rows);
}

/**
 * Whether the trunk changed a cell since the branch point. If the trunk's
 * summary may have dropped cells for the table, any change to the row
 * counts.
 */
function trunkChangedCell(table: TablePlan, colId: string, rowId: number): boolean {
  const { trunkDelta } = table;
  if (!trunkDelta || !table.isTrunkUpdated(table.tableId, rowId)) { return false; }
  return Boolean(trunkDelta.mayBeIncomplete || trunkDelta.columnDeltas[colId]?.[rowId]);
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
 * adds (now given as temp ids), and `immediate` has everything else. For a
 * row the trunk already has, many-to-many lists are merged into the
 * trunk's, and left out if that changes nothing.
 */
function newRowValues(table: TablePlan, forkRowId: number, options: { existing?: boolean } = {}) {
  const immediate: Record<string, CellValue> = {};
  const deferred: Record<string, CellValue> = {};
  for (const column of table.columns) {
    const cellDelta = column.cells[forkRowId];
    if (!cellDelta || (options.existing && isStaleUnpairing(table, column, forkRowId))) { continue; }
    const result = (options.existing && column.twoWay === "manyToMany") ?
      mergedValue(table, column, forkRowId, cellDelta) :
      trunkValue(table, column, extractValue(cellDelta[1]));
    if (!result) { continue; }
    (result.namesForkAdded ? deferred : immediate)[column.colId] = result.value;
  }
  return { immediate, deferred };
}

/**
 * The value to write to the written side of a many-to-many reference, in
 * a row the trunk has. If the trunk's list is as it was at the branch
 * point, the fork's list is written as is, order and all. Otherwise the
 * fork's change is merged into the trunk's list (see mergeLinks), and
 * undefined is returned if that leaves it unchanged.
 */
function mergedValue(table: TablePlan, column: PlannedColumn, rowId: number, cellDelta: CellDelta) {
  const forkValue = extractValue(cellDelta[1]);
  if (!table.trunkCells) { return trunkValue(table, column, forkValue); }
  const { tableId } = table;
  const { colId, refTableId } = column;
  const current = table.trunkCells[tableId]?.[colId]?.get(rowId);
  const [baseIds, forkIds, now] = [extractValue(cellDelta[0]), forkValue, current].map(linkIds);
  if (!now) {
    // Not read, or censored: see Patch._readTrunk.
    throw new Error(`the suggestion changes ${tableId}.${colId} in row ${rowId}, ` +
      "and this document's value there could not be read as a list to merge into, " +
      "perhaps because access rules hide it");
  }
  if (!baseIds || !forkIds) {
    throw new Error(`the suggestion changes ${tableId}.${colId} in row ${rowId}, ` +
      "and not as a list whose change could be merged");
  }
  const refersTo = (check: RowCheck, id: number) => Boolean(refTableId && check(refTableId, id));
  // A branch point row whose id the trunk reused is not the row now listed
  // under that id. The fork's link to it, kept or dropped, is left out.
  // Only a new link to it is refused, in trunkValue.
  const isStale = (id: number) => refersTo(table.isTrunkReused, id) && !refersTo(table.isForkAdded, id);
  const inBase = new Set(baseIds);
  const base = baseIds.filter(id => !isStale(id));
  const forkKept = forkIds.filter(id => !(isStale(id) && inBase.has(id)));
  const proposed = trunkValue(table, column,
    forkKept.length === forkIds.length ? forkValue : [GristObjCode.List, ...forkKept]);
  if (isEqual(base, now)) { return proposed; }
  // Rows the fork removes are unlinked before this is written, and must
  // stay so.
  const live = now.filter(id => !refersTo(table.isForkRemoved, id));
  const merged = mergeLinks(base, linkIds(proposed.value) ?? [], live);
  if (isEqual(merged, live)) { return undefined; }
  return { value: [GristObjCode.List, ...merged] as CellValue, namesForkAdded: merged.some(id => id < 0) };
}

/**
 * Merge the fork's change to one side of a many-to-many reference into
 * the trunk's list, where the trunk changed the list too. The change is
 * taken as links added and removed rather than as a new list, so nothing
 * the trunk linked or unlinked is undone, whichever side of the pair is
 * written. Links the trunk kept stay in its order, and the fork's new ones
 * follow in the fork's order.
 *
 * All three are row ids as the trunk knows them: `proposed` with rows the
 * fork adds as temp ids, which cannot match anything in `current`.
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
