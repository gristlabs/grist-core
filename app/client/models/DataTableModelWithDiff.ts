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
    return this.core.createFloatingRowModel(optRowModelClass);
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
      } else {
        // No change in ActionSummary for this cell, but it could be a formula
        // column.  So we do a crude comparison between the values available.
        // We won't be able to do anything useful for conflicts (e.g. to know
        // the display text in a reference columnn for the common parent).
        // We also won't be able to detect local changes at all.
        const parent = this.core.getValue(rowId, colId);
        const remote = this.rightTableDelta.finalRowContent?.[rowId]?.[colId];
        if (remote !== undefined && JSON.stringify(remote) !== JSON.stringify(parent)) {
          return [GristObjCode.Versions, {parent, remote} as CellVersions];
        }
        return parent;
      }
    }
    if (rowId < 0) {
      const value = this.rightTableDelta.finalRowContent?.[-rowId]?.[colId];
      // keep row.id consistent with rowId for convenience.
      if (colId === 'id') { return - (value as number); }
      return value;
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
