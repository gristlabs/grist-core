import BaseRowModel from "app/client/models/BaseRowModel";
import DataTableModel from "app/client/models/DataTableModel";
import { DocModel } from "app/client/models/DocModel";
import { TableRec } from "app/client/models/entities/TableRec";
import { TableQuerySets } from "app/client/models/QuerySet";
import { ChangeType, RowGrouping, RowList, RowsChanged, SortedRowSet } from "app/client/models/rowset";
import { TableData } from "app/client/models/TableData";
import { ActionSummarizer } from "app/common/ActionSummarizer";
import { createEmptyActionSummary, createEmptyTableDelta, getTableIdAfter,
  getTableIdBefore, TableDelta } from "app/common/ActionSummary";
import { DisposableWithEvents } from "app/common/DisposableWithEvents";
import { CellVersions, DocAction, UserAction } from "app/common/DocActions";
import { DocStateComparisonDetails } from "app/common/DocState";
import { CellDelta } from "app/common/TabularDiff";
import { CellValue, GristObjCode } from "app/plugin/GristData";

import { Emitter } from "grainjs";

// A special row id, representing omitted rows.
const ROW_ID_SKIP = -1;

/**
 * Returns true if the row ID is a synthetic negative ID used for diff display
 * (removed rows, remotely-added rows). These rows don't exist in the real table.
 */
export function isSyntheticRowId(rowId: unknown): boolean {
  return typeof rowId === "number" && rowId < 0;
}

/**
 * Represent extra rows in a table that correspond to rows added in a remote (right) document,
 * or removed in the local (left) document relative to a common ancestor.
 *
 * These rows don't exist in the real TableData, so we assign synthetic negative row IDs
 * to inject them into the grid's row source. The encoding is:
 *  - For rows added remotely, we map their id to - id * 2 - 1
 *  - For rows removed locally, we map their id to - id * 2 - 2
 *  - (id of -1 is left free for use in skipped rows)
 * This should be the only part of the code that knows that.
 *
 * `changeEmitter` fires when locally-removed rows are added or cleaned up at runtime,
 * so that BaseView can dynamically update ExtendedRowSource (which feeds the grid).
 */
export class ExtraRows {
  /**
   * Map back from a possibly synthetic row id to an original strictly-positive row id.
   */
  public static interpretRowId(
    rowId: number,
  ): { type: "remote-add" | "local-remove" | "shared" | "skipped", id: number } {
    if (rowId >= 0) {
      return { type: "shared", id: rowId };
    } else if (rowId === ROW_ID_SKIP) {
      return { type: "skipped", id: rowId };
    } else if (rowId % 2 !== 0) {
      return { type: "remote-add", id: -(rowId + 1) / 2 };
    }
    return { type: "local-remove", id: -(rowId + 2) / 2 };
  }

  public readonly leftTableDelta?: TableDelta;
  public readonly rightTableDelta?: TableDelta;
  public readonly rightAddRows: Set<number>;
  public readonly rightRemoveRows: Set<number>;
  public leftAddRows: Set<number>;
  public leftRemoveRows: Set<number>;

  public readonly changeEmitter = new Emitter();

  public constructor(public readonly tableId?: string, public readonly comparison?: DocStateComparisonDetails) {
    if (!tableId) {
      this.rightAddRows = new Set();
      this.rightRemoveRows = new Set();
      this.leftAddRows = new Set();
      this.leftRemoveRows = new Set();
      return;
    }
    const remoteTableId = getRemoteTableId(tableId, comparison);
    this.leftTableDelta = this.comparison?.leftChanges?.tableDeltas[tableId];
    if (remoteTableId) {
      this.rightTableDelta = this.comparison?.rightChanges?.tableDeltas[remoteTableId];
    }
    this.rightAddRows = new Set(this.rightTableDelta?.addRows.map(id => this.encodeRightAddRow(id)));
    this.rightRemoveRows = new Set(this.rightTableDelta?.removeRows);
    this.leftAddRows = new Set(this.leftTableDelta?.addRows);
    this.leftRemoveRows = new Set(this.leftTableDelta?.removeRows.map(id => this.encodeLeftRemoveRow(id)));
  }

  public encodeLeftRemoveRow(id: number) {
    return -id * 2 - 2;
  }

  public encodeRightAddRow(id: number) {
    return -id * 2 - 1;
  }

  /**
   * Get a list of extra synthetic row ids to add.
   */
  public getExtraRows(): readonly number[] {
    return [...this.rightAddRows].concat([...this.leftRemoveRows]);
  }

  /**
   * Classify the row as either remote-add, remote-remove, local-add, or local-remove.
   */
  public getRowType(rowId: number) {
    if (this.rightAddRows.has(rowId)) {
      return "remote-add";
    } else if (this.leftAddRows.has(rowId)) {
      return "local-add";
    } else if (this.rightRemoveRows.has(rowId)) {
      return "remote-remove";
    } else if (this.leftRemoveRows.has(rowId)) {
      return "local-remove";
    }
    // TODO: consider what should happen when a row is removed both locally and remotely.
    return "";
  }
}

/**
 *
 * A variant of DataTableModel that is aware of a comparison with another version of the table.
 * The constructor takes a DataTableModel and DocStateComparisonDetails.  We act as a proxy
 * for that DataTableModel, with the following changes to tableData:
 *
 *   - a cell changed remotely from A to B is given the value ['X', {parent: A, remote: B}].
 *   - a cell changed locally from A to B1 and remotely from A to B2 is given the value
 *     ['X', {parent: A, local: B1, remote: B2}].
 *   - negative rowIds are served from the remote table.
 *
 */
export class DataTableModelWithDiff extends DisposableWithEvents implements DataTableModel {
  public docModel: DocModel;
  public isLoaded: ko.Observable<boolean>;
  public tableData: TableData;
  public tableMetaRow: TableRec;
  public tableQuerySets: TableQuerySets;
  public extraRows: ExtraRows;

  // For viewing purposes (LazyRowsModel), cells should have comparison info, so we will
  // forward to a comparison-aware wrapper. Otherwise, the model is left substantially
  // unchanged for now.
  private _wrappedModel: DataTableModel;

  /**
   * The _comparison provided to this DataTableModelWithDiff may be mutated. It is used
   * to store and track local changes.
   */
  public constructor(public core: DataTableModel, private _comparison: DocStateComparisonDetails,
    options?: { showAllRows?: boolean }) {
    super();
    this.tableMetaRow = core.tableMetaRow;
    this.tableQuerySets = core.tableQuerySets;
    this.docModel = core.docModel;
    const tableId = core.tableData.tableId;
    const remoteTableId = getRemoteTableId(tableId, _comparison) || tableId;
    this.extraRows = new ExtraRows(this.core.tableData.tableId, this._comparison);
    _comparison.leftChanges.tableDeltas[tableId] ||= createEmptyTableDelta();
    _comparison.rightChanges.tableDeltas[remoteTableId] ||= createEmptyTableDelta();
    const tableDataWithDiff = new TableDataWithDiff(
      core.tableData,
      _comparison.leftChanges.tableDeltas[tableId],
      _comparison.rightChanges.tableDeltas[remoteTableId],
      this.extraRows,
      { showAllRows: options?.showAllRows },
    ) as any;
    this.tableData = tableDataWithDiff;
    this.isLoaded = core.isLoaded;
    this._wrappedModel = this.autoDispose(new DataTableModel(this.docModel, this.tableData, this.tableMetaRow));

    this.listenTo(this._wrappedModel, "rowChange", (changeType: ChangeType, rows: RowList) => {
      this.trigger("rowChange", changeType, rows);
    });
    this.listenTo(this._wrappedModel, "rowNotify", (rows: RowsChanged, notifyValue: any) => {
      this.trigger("rowNotify", rows, notifyValue);
    });
    // Listen for actions about to be applied, so we can snapshot cell values
    // before mutation and track them as local changes in the diff.
    this.autoDispose(core.tableData.preTableActionEmitter.addListener(
      tableDataWithDiff.before.bind(tableDataWithDiff),
    ));
  }

  public getExtraRows() {
    return this.extraRows;
  }

  public createLazyRowsModel(sortedRowSet: SortedRowSet, optRowModelClass: any) {
    return this._wrappedModel.createLazyRowsModel(sortedRowSet, optRowModelClass);
  }

  public createFloatingRowModel(optRowModelClass?: any): BaseRowModel {
    return this._wrappedModel.createFloatingRowModel(optRowModelClass);
  }

  public fetch(force?: boolean): Promise<void> {
    return this.core.fetch(force);
  }

  public getAllRows(): readonly number[] {
    // Could add remote rows, but this method isn't used so it doesn't matter.
    return this.core.getAllRows();
  }

  public getNumRows(): number {
    return this.core.getNumRows();
  }

  public getRowGrouping(groupByCol: string): RowGrouping<CellValue> {
    return this.core.getRowGrouping(groupByCol);
  }

  public sendTableActions(actions: UserAction[], optDesc?: string): Promise<any[]> {
    return this.core.sendTableActions(actions, optDesc);
  }

  public sendTableAction(action: UserAction, optDesc?: string): Promise<any> | undefined {
    return this.core.sendTableAction(action, optDesc);
  }
}

/**
 * A variant of TableData that shows a live diff between the comparison base
 * (trunk at fork time) and the current fork state. The live session must
 * match what the server's ActionSummarizer produces on reload.
 *
 * `leftTableDelta` stores `[parentValue, newValue]` per cell, where parent is
 * always the trunk value and new is the current fork value. The `before()` method
 * intercepts each DocAction before it's applied, updating the delta to maintain
 * this invariant across edits, adds, deletes, undos, and redos.
 *
 * Deleted rows get synthetic negative row IDs (via ExtraRows) injected into the
 * grid's row source so they remain visible. These synthetic rows are read-only —
 * all mutation paths must be guarded against them (see `isSyntheticRowId()`).
 *
 * When a deleted row's ID is reused (undo or ID recycling), the add's values are
 * compared to the removal's stored pre-deletion values. If they match (undo),
 * the synthetic row is removed and the pre-deletion diff state is restored
 * (preserving any prior edit diffs). If they differ (recycled ID), both the
 * deletion and the add are kept — the grid shows a struck-through row AND a
 * green added row with the new values.
 */
export class TableDataWithDiff {
  public dataLoadedEmitter: any;
  public tableActionEmitter: any;
  public preTableActionEmitter: any;

  private _leftRemovals: Set<number>;
  private _rightRemovals: Set<number>;
  private _updates: Set<number>;
  // Stores pre-deletion column values for each removed row, keyed by rowId.
  // Used to distinguish undo (values match) from ID recycling (values differ).
  private _removedRowValues = new Map<number, Record<string, CellDelta[0]>>();

  constructor(public core: TableData, public leftTableDelta: TableDelta,
    public rightTableDelta: TableDelta, public extraRows: ExtraRows,
    private _options?: { showAllRows?: boolean }) {
    this.dataLoadedEmitter = core.dataLoadedEmitter;
    this.tableActionEmitter = core.tableActionEmitter;
    this.preTableActionEmitter = core.preTableActionEmitter;
    // Construct the set of all rows updated in either left/local or right/remote.
    // Omit any rows that were deleted in the other version, for simplicity.
    this._leftRemovals = new Set(leftTableDelta.removeRows);
    this._rightRemovals = new Set(rightTableDelta.removeRows);
    this._updates = new Set([
      ...leftTableDelta.updateRows.filter(r => !this._rightRemovals.has(r)),
      ...rightTableDelta.updateRows.filter(r => !this._leftRemovals.has(r)),
    ]);
  }

  public getColIds(): string[] {
    return this.core.getColIds();
  }

  public getColType(colId: string) {
    return this.core.getColType(colId);
  }

  public sendTableActions(actions: UserAction[], optDesc?: string): Promise<any[]> {
    return this.core.sendTableActions(actions, optDesc);
  }

  public sendTableAction(action: UserAction, optDesc?: string): Promise<any> | undefined {
    return this.core.sendTableAction(action, optDesc);
  }

  public receiveAction(action: DocAction): boolean {
    return this.core.receiveAction(action);
  }

  /**
   * Make a variant of getter for a column that calls getValue for rows added remotely,
   * or rows with updates.
   */
  public getRowPropFunc(colId: string) {
    const fn = this.core.getRowPropFunc(colId);
    if (!fn) { return fn; }
    return (rowId: number | "new") => {
      if (rowId !== "new" && (rowId < 0 || this._updates.has(rowId))) {
        return this.getValue(rowId, colId);
      }
      return fn(rowId);
    };
  }

  public getKeepFunc(): undefined | ((rowId: number | "new") => boolean) {
    if (this._options?.showAllRows) { return undefined; }
    return (rowId: number | "new") => {
      return rowId === "new" || this._updates.has(rowId) || rowId < 0 ||
        this._leftRemovals.has(rowId) || this._rightRemovals.has(rowId);
    };
  }

  public getSkipRowId(): number {
    return ROW_ID_SKIP;
  }

  public mayHaveVersions() {
    return true;
  }

  /**
   * Intercept requests for updated cells or cells from remote rows.
   */
  public getValue(rowId: number, colId: string): CellValue | undefined {
    if (rowId === ROW_ID_SKIP && colId !== "id") {
      return [GristObjCode.Skip];
    }
    if (this._updates.has(rowId)) {
      const left = this.leftTableDelta.columnDeltas[colId]?.[rowId];
      const right = this.rightTableDelta.columnDeltas[colId]?.[rowId];
      if (left !== undefined && right !== undefined) {
        return [GristObjCode.Versions, {
          parent: oldValue(left),
          local: newValue(left),
          remote: newValue(right),
        } as CellVersions];
      } else if (right !== undefined) {
        return [GristObjCode.Versions, {
          parent: oldValue(right),
          remote: newValue(right),
        } as CellVersions];
      } else if (left !== undefined) {
        return [GristObjCode.Versions, {
          parent: oldValue(left),
          local: newValue(left),
        } as CellVersions];
      }
    } else {
      // keep row.id consistent with rowId for convenience.
      if (colId === "id") { return rowId; }
      const { type, id } = ExtraRows.interpretRowId(rowId);
      if (type === "remote-add") {
        const cell = this.rightTableDelta.columnDeltas[colId]?.[id];
        const value = (cell !== undefined) ? newValue(cell) : undefined;
        return value;
      } else if (type === "local-remove") {
        const cell = this.leftTableDelta.columnDeltas[colId]?.[id];
        const value = (cell !== undefined) ? oldValue(cell) : undefined;
        return value;
      }
    }
    return this.core.getValue(rowId, colId);
  }

  public get tableId() { return this.core.tableId; }

  public numRecords() {
    return this.core.numRecords();
  }

  /**
   * Called via preTableActionEmitter, just before a DocAction is applied to the
   * underlying table. When the user edits while viewing a comparison, those edits
   * need to appear as local changes in the diff. The problem is that DocActions only
   * carry *new* cell values. By running here — before the action mutates the table —
   * we can use ActionSummarizer.addAction() to build a delta that pairs each new value
   * with the current (soon-to-be-old) value read from this.core. The resulting delta
   * is then folded into leftTableDelta so the diff display reflects the edit.
   */
  public before(action: DocAction): void {
    const op = new ActionSummarizer();
    const sum = createEmptyActionSummary();
    op.addAction(sum, action, this.core);

    const tableDelta = Object.values(sum.tableDeltas)[0];
    if (!tableDelta) {
      return;
    }

    this._processUpdateRows(tableDelta);
    this._processAddRows(tableDelta);
    this._processRemoveRows(tableDelta);
  }

  /**
   * For each updated cell, record a delta in leftTableDelta. If this is the first
   * local edit to this cell, snapshot the current value as the "parent" (index 0) —
   * subsequent edits to the same cell keep that original parent, so the diff always
   * shows the change from the comparison base, not from intermediate edits.
   * The new value (index 1) is always overwritten with the latest.
   */
  private _processUpdateRows(tableDelta: TableDelta): void {
    for (const rowId of tableDelta.updateRows) {
      for (const colId of Object.keys(tableDelta.columnDeltas)) {
        this._ensureColumnExists(colId);

        if (!this.leftTableDelta.columnDeltas[colId][rowId]) {
          const row = this.core.getRecord(rowId);
          const cell = row?.[colId];
          const nestedCell = cell === undefined ? null : [cell] as [any];

          this.leftTableDelta.columnDeltas[colId][rowId] = [nestedCell, null];

          if (!this.leftTableDelta.updateRows.includes(rowId)) {
            this.leftTableDelta.updateRows.push(rowId);
            this._updates.add(rowId);
          }
        }

        this.leftTableDelta.columnDeltas[colId][rowId][1] =
          tableDelta.columnDeltas[colId]?.[rowId]?.[1];
      }
    }
  }

  /**
   * Record locally-added rows. The parent value (index 0) is null since the row
   * didn't exist in the comparison base.
   *
   * If a row ID was previously removed, we check whether this is an undo
   * (pre-deletion values match the add) or ID recycling (values differ):
   * - Undo: remove the synthetic row and restore the pre-deletion diff state
   *   (any prior edit diffs are preserved).
   * - Recycling: leave the remove intact, process the add normally. The grid
   *   shows both a struck-through deleted row and a green added row. This
   *   matches what the server's ActionSummarizer produces on reload.
   */
  private _processAddRows(tableDelta: TableDelta): void {
    for (const rowId of tableDelta.addRows) {
      const syntheticId = this.extraRows.encodeLeftRemoveRow(rowId);
      if (this.extraRows.leftRemoveRows.has(syntheticId)) {
        if (this._addMatchesRemoval(rowId, tableDelta)) {
          // Undo: values match the original removal — restore diff state.
          this._cleanupRemovedRow(rowId, tableDelta);
          continue;
        }
        // Recycled ID with different values: leave the remove intact
        // (the struck-through row stays). Mark the row as added so it gets
        // green highlighting, but don't create delta entries — the removal's
        // deltas must stay intact for the synthetic row's getValue() to work.
        // Remove from _updates so the real row's values come from
        // core.getValue() instead of the removal's stale CellVersions.
        this._updates.delete(rowId);
        this.extraRows.leftAddRows.add(rowId);
        if (!this.leftTableDelta.addRows.includes(rowId)) {
          this.leftTableDelta.addRows.push(rowId);
        }
        continue;
      }

      for (const colId of Object.keys(tableDelta.columnDeltas)) {
        this._ensureColumnExists(colId);

        if (!this.leftTableDelta.columnDeltas[colId][rowId]) {
          this.leftTableDelta.columnDeltas[colId][rowId] = [null, null];
        }

        this.leftTableDelta.columnDeltas[colId][rowId][1] =
          tableDelta.columnDeltas[colId]?.[rowId]?.[1];
      }

      if (!this.leftTableDelta.addRows.includes(rowId)) {
        this.leftTableDelta.addRows.push(rowId);
      }
      this._updates.add(rowId);
      this.extraRows.leftAddRows.add(rowId);
    }
  }

  /**
   * Record locally-removed rows. If a row was added locally and is now being
   * removed, the add and remove cancel out — we just clean up the bookkeeping.
   * Otherwise, we record the pre-removal cell values (index 0) so the diff can
   * show what was deleted.
   */
  private _processRemoveRows(tableDelta: TableDelta): void {
    for (const rowId of tableDelta.removeRows) {
      if (this.extraRows.leftAddRows.has(rowId)) {
        this._cleanupAddedRow(rowId);
        continue;
      }

      // If this row was previously in updateRows (e.g., edited then deleted),
      // clean up the update bookkeeping before recording it as a remove.
      if (this.leftTableDelta.updateRows.includes(rowId)) {
        this.leftTableDelta.updateRows =
          this.leftTableDelta.updateRows.filter(id => id !== rowId);
      }

      const syntheticId = this.extraRows.encodeLeftRemoveRow(rowId);
      const isNew = !this.extraRows.leftRemoveRows.has(syntheticId);

      for (const colId of Object.keys(tableDelta.columnDeltas)) {
        this._ensureColumnExists(colId);

        if (!this.leftTableDelta.columnDeltas[colId][rowId]) {
          // First time seeing this cell — snapshot the pre-deletion value as parent.
          this.leftTableDelta.columnDeltas[colId][rowId] = [
            tableDelta.columnDeltas[colId]?.[rowId]?.[0] ?? null,
            null,
          ];
        }
        // If the delta already existed (e.g., from a prior edit), keep the
        // original parent — it reflects the comparison base, not the current
        // (possibly edited) value.
      }

      // Store pre-deletion values for undo detection. When the same row ID
      // reappears (via undo or recycling), we compare the add's values against
      // these to distinguish the two cases.
      const snapshot: Record<string, CellDelta[0]> = {};
      for (const colId of Object.keys(tableDelta.columnDeltas)) {
        snapshot[colId] = tableDelta.columnDeltas[colId]?.[rowId]?.[0] ?? null;
      }
      this._removedRowValues.set(rowId, snapshot);

      if (!this.leftTableDelta.removeRows.includes(rowId)) {
        this.leftTableDelta.removeRows.push(rowId);
      }
      this._updates.add(rowId);
      this.extraRows.leftRemoveRows.add(syntheticId);

      if (isNew) {
        this.extraRows.changeEmitter.emit("add", [syntheticId]);
      }
    }
  }

  private _ensureColumnExists(colId: string): void {
    if (!this.leftTableDelta.columnDeltas[colId]) {
      this.leftTableDelta.columnDeltas[colId] = {};
    }
  }

  private _cleanupAddedRow(rowId: number): void {
    this.extraRows.leftAddRows.delete(rowId);
    this.leftTableDelta.addRows = this.leftTableDelta.addRows.filter(id => id !== rowId);

    // If this row also has a coexisting removal (recycled ID case), don't
    // delete the column deltas or _updates — they belong to the removal and
    // are needed for the synthetic row's getValue() to show trunk values.
    const syntheticId = this.extraRows.encodeLeftRemoveRow(rowId);
    if (!this.extraRows.leftRemoveRows.has(syntheticId)) {
      this._updates.delete(rowId);
      for (const colId of Object.keys(this.leftTableDelta.columnDeltas)) {
        delete this.leftTableDelta.columnDeltas[colId][rowId];
      }
    }
  }

  /**
   * Check whether an AddRecord for a previously-removed row ID is an undo
   * (restoring the original values) or ID recycling (a genuinely new row).
   * Compares the add's new values against the stored removal's parent values.
   */
  private _addMatchesRemoval(rowId: number, tableDelta: TableDelta): boolean {
    // Compare the add's new values against the pre-deletion values stored
    // when the row was removed. If they match, this is an undo. If they
    // differ, it's a genuinely new row that reused the same ID.
    const snapshot = this._removedRowValues.get(rowId);
    if (!snapshot) { return false; }
    for (const colId of Object.keys(tableDelta.columnDeltas)) {
      if (!tableDelta.columnDeltas[colId]?.[rowId]) { continue; }
      const oldVal = snapshot[colId] ?? null;
      const newVal = tableDelta.columnDeltas[colId][rowId][1];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Undo a removal: remove the synthetic row and restore the diff state to
   * what it was before the deletion. For columns that were edited before
   * deletion, the edit delta (parent=trunk, new=edited) is preserved. For
   * columns that had no prior edit, the delta entry (created by the removal)
   * is cleaned up. The row returns to its pre-deletion diff state.
   */
  private _cleanupRemovedRow(rowId: number, tableDelta: TableDelta): void {
    const syntheticId = this.extraRows.encodeLeftRemoveRow(rowId);
    this.extraRows.leftRemoveRows.delete(syntheticId);
    this.leftTableDelta.removeRows = this.leftTableDelta.removeRows.filter(id => id !== rowId);
    this.extraRows.changeEmitter.emit("remove", [syntheticId]);
    this._removedRowValues.delete(rowId);

    // Restore each column's delta to its pre-deletion state.
    let hasRemainingDelta = false;
    for (const colId of Object.keys(this.leftTableDelta.columnDeltas)) {
      const delta = this.leftTableDelta.columnDeltas[colId][rowId];
      if (!delta) { continue; }
      // If this delta was created by the removal (parent came from the
      // removal's tableDelta, not from a prior edit), clean it up.
      // We detect this by checking: if the only source of this delta was
      // the removal, delta[1] will be null (removals set [0] but leave [1]).
      if (delta[1] === null) {
        delete this.leftTableDelta.columnDeltas[colId][rowId];
      } else {
        // This delta existed before the removal (from a prior edit).
        // Update [1] with the restored value from the undo's add.
        delta[1] = tableDelta.columnDeltas[colId]?.[rowId]?.[1] ?? delta[1];
        hasRemainingDelta = true;
      }
    }

    if (hasRemainingDelta) {
      // Row still has edit diffs — keep it in _updates and updateRows.
      if (!this.leftTableDelta.updateRows.includes(rowId)) {
        this.leftTableDelta.updateRows.push(rowId);
      }
    } else {
      // No remaining diffs — fully clean.
      this._updates.delete(rowId);
    }
  }
}

/**
 * Get original value from a cell change, if available.
 */
function oldValue(delta: CellDelta) {
  if (delta[0] === "?") { return null; }
  return delta[0]?.[0];
}

/**
 * Get new value from a cell change, if available.
 */
function newValue(delta: CellDelta) {
  if (delta[1] === "?") { return null; }
  return delta[1]?.[0];
}

/**
 * Figure out the id of the specified table in the remote document.
 * Returns null if table is deleted or unknown in the remote document.
 */
function getRemoteTableId(tableId: string, comparison?: DocStateComparisonDetails) {
  if (!comparison) { return tableId; }
  const parentTableId = getTableIdBefore(comparison.leftChanges.tableRenames, tableId);
  return getTableIdAfter(comparison.rightChanges.tableRenames, parentTableId);
}
