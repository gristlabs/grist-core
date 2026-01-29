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

// A special row id, representing omitted rows.
const ROW_ID_SKIP = -1;

/**
 * Represent extra rows in a table that correspond to rows added in a remote (right) document,
 * or removed in the local (left) document relative to a common ancestor.
 *
 * We assign synthetic row ids for these rows somewhat arbitrarily as follows:
 *  - For rows added remotely, we map their id to - id * 2 - 1
 *  - For rows removed locally, we map their id to - id * 2 - 2
 *  - (id of -1 is left free for use in skipped rows)
 * This should be the only part of the code that knows that.
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
    this.rightAddRows = new Set(this.rightTableDelta?.addRows.map(id => -id * 2 - 1));
    this.rightRemoveRows = new Set(this.rightTableDelta?.removeRows);
    this.leftAddRows = new Set(this.leftTableDelta?.addRows);
    this.leftRemoveRows = new Set(this.leftTableDelta?.removeRows.map(id => -id * 2 - 2));
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

  public constructor(public core: DataTableModel, private _comparison: DocStateComparisonDetails) {
    super();
    this.tableMetaRow = core.tableMetaRow;
    this.tableQuerySets = core.tableQuerySets;
    this.docModel = core.docModel;
    const tableId = core.tableData.tableId;
    const remoteTableId = getRemoteTableId(tableId, _comparison) || "";
    this.extraRows = new ExtraRows(this.core.tableData.tableId, this._comparison);
    _comparison.leftChanges.tableDeltas[tableId] ||= createEmptyTableDelta();
    _comparison.rightChanges.tableDeltas[remoteTableId] ||= createEmptyTableDelta();
    const tableDataWithDiff = new TableDataWithDiff(
      core.tableData,
      _comparison.leftChanges.tableDeltas[tableId],
      _comparison.rightChanges.tableDeltas[remoteTableId],
      this.extraRows,
    ) as any;
    this.tableData = tableDataWithDiff;
    this.isLoaded = core.isLoaded;
    this._wrappedModel = new DataTableModel(this.docModel, this.tableData, this.tableMetaRow);

    this.listenTo(this._wrappedModel, "rowChange", (changeType: ChangeType, rows: RowList) => {
      this.trigger("rowChange", changeType, rows);
    });
    this.listenTo(this._wrappedModel, "rowNotify", (rows: RowsChanged, notifyValue: any) => {
      this.trigger("rowNotify", rows, notifyValue);
    });
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
 * A variant of TableData that is aware of a comparison with another version of the table.
 * TODO: flesh out, just included essential members so far.
 */
export class TableDataWithDiff {
  public dataLoadedEmitter: any;
  public tableActionEmitter: any;
  public preTableActionEmitter: any;

  private _leftRemovals: Set<number>;
  private _rightRemovals: Set<number>;
  private _updates: Set<number>;

  constructor(public core: TableData, public leftTableDelta: TableDelta,
    public rightTableDelta: TableDelta, public extraRows: ExtraRows) {
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
   * An action may be about to happen. We need to squirrel away
   * the current version of cells since DocAction only has new
   * values.
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

  private _processAddRows(tableDelta: TableDelta): void {
    for (const rowId of tableDelta.addRows) {
      for (const colId of Object.keys(tableDelta.columnDeltas)) {
        this._ensureColumnExists(colId);
        
        if (!this.leftTableDelta.columnDeltas[colId][rowId]) {
          this.leftTableDelta.columnDeltas[colId][rowId] = [null, null];
          
          if (!this.leftTableDelta.addRows.includes(rowId)) {
            this.leftTableDelta.addRows.push(rowId);
          }
        }
        
        this.leftTableDelta.columnDeltas[colId][rowId][1] =
            tableDelta.columnDeltas[colId]?.[rowId]?.[1];
        
        this._updates.add(rowId);
        this.extraRows.leftAddRows.add(rowId);
      }
    }
  }

  private _processRemoveRows(tableDelta: TableDelta): void {
    for (const rowId of tableDelta.removeRows) {
      if (this.extraRows.leftAddRows.has(rowId)) {
        this._cleanupAddedRow(rowId);
        continue;
      }
      
      for (const colId of Object.keys(tableDelta.columnDeltas)) {
        this._ensureColumnExists(colId);
        
        if (!this.leftTableDelta.columnDeltas[colId][rowId]) {
          this.leftTableDelta.columnDeltas[colId][rowId] = [null, null];
          this.leftTableDelta.removeRows.push(rowId);
        }
        
        this.leftTableDelta.columnDeltas[colId][rowId][0] =
            tableDelta.columnDeltas[colId]?.[rowId]?.[1];
        
        this._updates.add(rowId);
        this.extraRows.leftRemoveRows.add(rowId);
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
    this._updates.delete(rowId);
    this.leftTableDelta.addRows = this.leftTableDelta.addRows.filter(id => id !== rowId);
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
