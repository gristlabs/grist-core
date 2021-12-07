/**
 * TableData maintains a single table's data.
 */
import {ColumnACIndexes} from 'app/client/models/ColumnACIndexes';
import {ColumnCache} from 'app/client/models/ColumnCache';
import {DocData} from 'app/client/models/DocData';
import {DocAction, ReplaceTableData, TableDataAction, UserAction} from 'app/common/DocActions';
import {isRaisedException} from 'app/common/gristTypes';
import {countIf} from 'app/common/gutil';
import {SchemaTypes} from 'app/common/schema';
import {ColTypeMap, MetaTableData as MetaTableDataBase, TableData as TableDataBase} from 'app/common/TableData';
import {Emitter} from 'grainjs';

/**
 * TableData class to maintain a single table's data.
 */
export class TableData extends TableDataBase {
  public readonly tableActionEmitter = new Emitter();
  public readonly dataLoadedEmitter = new Emitter();

  public readonly columnACIndexes = new ColumnACIndexes(this);

  private _columnErrorCounts = new ColumnCache<number|undefined>(this);

  /**
   * Constructor for TableData.
   * @param {DocData} docData: The root DocData object for this document.
   * @param {String} tableId: The name of this table.
   * @param {Object} tableData: An object equivalent to BulkAddRecord, i.e.
   *        ["TableData", tableId, rowIds, columnValues].
   * @param {Object} columnTypes: A map of colId to colType.
   */
  constructor(public readonly docData: DocData,
              tableId: string, tableData: TableDataAction|null, columnTypes: ColTypeMap) {
    super(tableId, tableData, columnTypes);
  }

  public loadData(tableData: TableDataAction|ReplaceTableData): number[] {
    const oldRowIds = super.loadData(tableData);
    // If called from base constructor, this.dataLoadedEmitter may be unset; in that case there
    // are no subscribers anyway.
    if (this.dataLoadedEmitter) {
      this.dataLoadedEmitter.emit(oldRowIds, this.getRowIds());
    }
    return oldRowIds;
  }

  // Used by QuerySet to load new rows for onDemand tables.
  public loadPartial(data: TableDataAction): void {
    super.loadPartial(data);
    // Emit dataLoaded event, to trigger ('rowChange', 'add') on the TableModel RowSource.
    this.dataLoadedEmitter.emit([], data[2]);
  }

  // Used by QuerySet to remove unused rows for onDemand tables when a QuerySet is disposed.
  public unloadPartial(rowIds: number[]): void {
    super.unloadPartial(rowIds);
    // Emit dataLoaded event, to trigger ('rowChange', 'rm') on the TableModel RowSource.
    this.dataLoadedEmitter.emit(rowIds, []);
  }

  /**
   * Counts and returns the number of error values in the given column. The count is cached to
   * keep it faster for large tables, and the cache is cleared as needed on changes to the table.
   */
  public countErrors(colId: string): number|undefined {
    return this._columnErrorCounts.getValue(colId, () => {
      const values = this.getColValues(colId);
      return values && countIf(values, isRaisedException);
    });
  }

  /**
   * Sends an array of table-specific action to the server to be applied. The tableId should be
   * omitted from each `action` parameter and will be inserted automatically.
   *
   * @param {Array} actions: Array of user actions of the form [actionType, rowId, etc], which is sent
   * to the server as [actionType, **tableId**, rowId, etc]
   * @param {String} optDesc: Optional description of the actions to be shown in the log.
   * @returns {Array} Array of return values for all the UserActions as produced by the data engine.
   */
  public sendTableActions(actions: UserAction[], optDesc?: string) {
    actions.forEach((action) => action.splice(1, 0, this.tableId));
    return this.docData.sendActions(actions as DocAction[], optDesc);
  }

  /**
   * Sends a table-specific action to the server. The tableId should be omitted from the action parameter
   * and will be inserted automatically.
   *
   * @param {Array} action: [actionType, rowId...], sent as [actionType, **tableId**, rowId...]
   * @param {String} optDesc: Optional description of the actions to be shown in the log.
   * @returns {Object} Return value for the UserAction as produced by the data engine.
   */
  public sendTableAction(action: UserAction, optDesc?: string) {
    if (!action) { return; }
    action.splice(1, 0, this.tableId);
    return this.docData.sendAction(action as DocAction, optDesc);
  }

  /**
   * Emits a table-specific action received from the server as a 'tableAction' event.
   */
  public receiveAction(action: DocAction): boolean {
    const applied = super.receiveAction(action);
    if (applied) {
      this.tableActionEmitter.emit(action);
    }
    return applied;
  }
}

export type MetaTableData<TableId extends keyof SchemaTypes> = MetaTableDataBase<TableId> & TableData;
