import * as BaseRowModel from "app/client/models/BaseRowModel";
import * as DataTableModel from 'app/client/models/DataTableModel';
import { DocModel } from 'app/client/models/DocModel';
import { TableRec } from 'app/client/models/entities/TableRec';
import { TableQuerySets } from 'app/client/models/QuerySet';
import { RowGrouping, SortedRowSet } from 'app/client/models/rowset';
import { TableData } from 'app/client/models/TableData';
import { createEmptyTableDelta, TableDelta } from 'app/common/ActionSummary';
import { DisposableWithEvents } from 'app/common/DisposableWithEvents';
import { CellVersions, UserAction } from 'app/common/DocActions';
import { GristObjCode } from "app/common/gristTypes";
import { CellDelta } from 'app/common/TabularDiff';
import { DocStateComparisonDetails } from 'app/common/UserAPI';
import { CellValue } from 'app/plugin/GristData';

/**
 * Represent extra rows in a table that correspond to rows added in a remote (right) document,
 * or removed in the local (left) document relative to a common ancestor.
 *
 * We assign synthetic row ids for these rows somewhat arbitrarily as follows:
 *  - For rows added remotely, we double their id and flip sign
 *  - For rows removed locally, we double their id, add one, and flip sign
 * This should be the only part of the code that knows that.
 */
export class ExtraRows {
  readonly leftTableDelta?: TableDelta;
  readonly rightTableDelta?: TableDelta;
  readonly rightAddRows: Set<number>;
  readonly rightRemoveRows: Set<number>;
  readonly leftAddRows: Set<number>;
  readonly leftRemoveRows: Set<number>;

  /**
   * Map back from a possibly synthetic row id to an original strictly-positive row id.
   */
  public static interpretRowId(rowId: number): { type: 'remote-add'|'local-remove'|'shared', id: number } {
    if (rowId >= 0) { return { type: 'shared', id: rowId }; }
    if (rowId % 2 === 0) { return { type: 'remote-add', id: -rowId / 2 }; }
    return { type: 'local-remove', id: (-rowId - 1) / 2 };
  }

  public constructor(readonly tableId: string, readonly comparison?: DocStateComparisonDetails) {
    this.leftTableDelta = this.comparison?.leftChanges?.tableDeltas[this.tableId];
    this.rightTableDelta = this.comparison?.rightChanges?.tableDeltas[this.tableId];
    this.rightAddRows = new Set(this.rightTableDelta && this.rightTableDelta.addRows.map(id => -id*2));
    this.rightRemoveRows = new Set(this.rightTableDelta && this.rightTableDelta.removeRows);
    this.leftAddRows = new Set(this.leftTableDelta && this.leftTableDelta.addRows);
    this.leftRemoveRows = new Set(this.leftTableDelta && this.leftTableDelta.removeRows.map(id => -id*2 -1));
  }

  /**
   * Get a list of extra synthetic row ids to add.
   */
  public getExtraRows(): ReadonlyArray<number> {
    return [...this.rightAddRows].concat([...this.leftRemoveRows]);
  }

  /**
   * Classify the row as either remote-add, remote-remove, local-add, or local-remove.
   */
  public getRowType(rowId: number) {
    if (this.rightAddRows.has(rowId))         { return 'remote-add'; }
    else if (this.leftAddRows.has(rowId))     { return 'local-add';  }
    else if (this.rightRemoveRows.has(rowId)) { return 'remote-remove'; }
    else if (this.leftRemoveRows.has(rowId))  { return 'local-remove'; }
    // TODO: consider what should happen when a row is removed both locally and remotely.
    return '';
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

  // For viewing purposes (LazyRowsModel), cells should have comparison info, so we will
  // forward to a comparison-aware wrapper. Otherwise, the model is left substantially
  // unchanged for now.
  private _wrappedModel: DataTableModel;

  public constructor(public core: DataTableModel, comparison: DocStateComparisonDetails) {
    super();
    this.tableMetaRow = core.tableMetaRow;
    this.tableQuerySets = core.tableQuerySets;
    this.docModel = core.docModel;
    this.tableData = new TableDataWithDiff(
      core.tableData,
      comparison.leftChanges.tableDeltas[core.tableData.tableId] || createEmptyTableDelta(),
      comparison.rightChanges.tableDeltas[core.tableData.tableId] || createEmptyTableDelta()) as any;
    this.isLoaded = core.isLoaded;
    this._wrappedModel = new DataTableModel(this.docModel, this.tableData, this.tableMetaRow);
  }

  public createLazyRowsModel(sortedRowSet: SortedRowSet, optRowModelClass: any) {
    return this._wrappedModel.createLazyRowsModel(sortedRowSet, optRowModelClass);
  }

  public createFloatingRowModel(optRowModelClass: any): BaseRowModel {
    return this._wrappedModel.createFloatingRowModel(optRowModelClass);
  }

  public fetch(force?: boolean): Promise<void> {
    return this.core.fetch(force);
  }

  public getAllRows(): ReadonlyArray<number> {
    // Could add remote rows, but this method isn't used so it doesn't matter.
    return this.core.getAllRows();
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

  private _updates: Set<number>;

  constructor(public core: TableData, public leftTableDelta: TableDelta, public rightTableDelta: TableDelta) {
    this.dataLoadedEmitter = core.dataLoadedEmitter;
    this.tableActionEmitter = core.tableActionEmitter;
    // Construct the set of all rows updated in either left/local or right/remote.
    // Omit any rows that were deleted in the other version, for simplicity.
    const leftRemovals = new Set(leftTableDelta.removeRows);
    const rightRemovals = new Set(rightTableDelta.removeRows);
    this._updates = new Set([
      ...leftTableDelta.updateRows.filter(r => !rightRemovals.has(r)),
      ...rightTableDelta.updateRows.filter(r => !leftRemovals.has(r))
    ]);
  }

  public getColIds(): string[] {
    return this.core.getColIds();
  }

  public sendTableActions(actions: UserAction[], optDesc?: string): Promise<any[]> {
    return this.core.sendTableActions(actions, optDesc);
  }

  public sendTableAction(action: UserAction, optDesc?: string): Promise<any> | undefined {
    return this.core.sendTableAction(action, optDesc);
  }

  /**
   * Make a variant of getter for a column that calls getValue for rows added remotely,
   * or rows with updates.
   */
  public getRowPropFunc(colId: string) {
    const fn = this.core.getRowPropFunc(colId);
    if (!fn) { return fn; }
    return (rowId: number|"new") => {
      if (rowId !== 'new' && this._updates.has(rowId)) {
        return this.getValue(rowId, colId);
      }
      return (rowId !== 'new' && rowId < 0) ? this.getValue(rowId, colId) : fn(rowId);
    };
  }

  /**
   * Intercept requests for updated cells or cells from remote rows.
   */
  public getValue(rowId: number, colId: string): CellValue|undefined {
    if (this._updates.has(rowId)) {
      const left = this.leftTableDelta.columnDeltas[colId]?.[rowId];
      const right = this.rightTableDelta.columnDeltas[colId]?.[rowId];
      if (left !== undefined && right !== undefined) {
        return [GristObjCode.Versions, {
          parent: oldValue(left),
          local: newValue(left),
          remote: newValue(right)
        } as CellVersions];
      } else if (right !== undefined) {
        return [GristObjCode.Versions, {
          parent: oldValue(right),
          remote: newValue(right)
        } as CellVersions];
      } else if (left !== undefined) {
        return [GristObjCode.Versions, {
          parent: oldValue(left),
          local: newValue(left)
        } as CellVersions];
      }
    } else {
      // keep row.id consistent with rowId for convenience.
      if (colId === 'id') { return rowId; }
      const {type, id} = ExtraRows.interpretRowId(rowId);
      if (type === 'remote-add') {
        const cell = this.rightTableDelta.columnDeltas[colId]?.[id];
        const value = (cell !== undefined) ? newValue(cell) : undefined;
        return value;
      } else if (type === 'local-remove') {
        const cell = this.leftTableDelta.columnDeltas[colId]?.[id];
        const value = (cell !== undefined) ? oldValue(cell) : undefined;
        return value;
      }
    }
    return this.core.getValue(rowId, colId);
  }
  public get tableId() { return this.core.tableId; }
}

/**
 * Get original value from a cell change, if available.
 */
function oldValue(delta: CellDelta) {
  if (delta[0] === '?') { return null; }
  return delta[0]?.[0];
}

/**
 * Get new value from a cell change, if available.
 */
function newValue(delta: CellDelta) {
  if (delta[1] === '?') { return null; }
  return delta[1]?.[0];
}
