/**
 * TableData maintains a single table's data.
 */
import {ColumnACIndexes} from 'app/client/models/ColumnACIndexes';
import {DocData} from 'app/client/models/DocData';
import {DocAction, ReplaceTableData, TableDataAction, UserAction} from 'app/common/DocActions';
import {ColTypeMap, TableData as BaseTableData} from 'app/common/TableData';
import {BaseFormatter} from 'app/common/ValueFormatter';
import {Emitter} from 'grainjs';

export type SearchFunc = (value: string) => boolean;

/**
 * TableData class to maintain a single table's data.
 */
export class TableData extends BaseTableData {
  public readonly tableActionEmitter = new Emitter();
  public readonly dataLoadedEmitter = new Emitter();

  public readonly columnACIndexes = new ColumnACIndexes(this);

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
   * Given a colId and a search string, returns a list of matches, optionally limiting their number.
   * The matches are returned as { label, value } pairs, for use with auto-complete. In these, value
   * is the rowId, and label is the actual value matching the query.
   * @param {String} colId: identifies the column to search.
   * @param {String|Function} searchTextOrFunc: If a string, then the text to search. It splits the
   *    text into words, and returns values which contain each of the words. May be a function
   *    which, given a formatted column value, returns whether to include it.
   * @param [Number] optMaxResults: if given, limit the number of returned results to this.
   * @returns Array[{label, value}] array of objects, suitable for use with JQueryUI's autocomplete.
   */
  public columnSearch(colId: string, formatter: BaseFormatter,
                      searchTextOrFunc: string|SearchFunc, optMaxResults?: number) {
    // Search for each of the words in query, case-insensitively.
    const searchFunc = (typeof searchTextOrFunc === 'function' ? searchTextOrFunc :
      makeSearchFunc(searchTextOrFunc));
    const maxResults = optMaxResults || Number.POSITIVE_INFINITY;

    const rowIds = this.getRowIds();
    const valColumn = this.getColValues(colId);
    const ret = [];
    if (!valColumn) {
      // tslint:disable-next-line:no-console
      console.warn(`TableData.columnSearch called on invalid column ${this.tableId}.${colId}`);
    } else {
      for (let i = 0; i < rowIds.length && ret.length < maxResults; i++) {
        const rowId = rowIds[i];
        const value = String(formatter.formatAny(valColumn[i]));
        if (value && searchFunc(value)) {
          ret.push({ label: value, value: rowId });
        }
      }
    }
    return ret;
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

function makeSearchFunc(searchText: string): SearchFunc {
  const searchWords = searchText.toLowerCase().split(/\s+/);
  return value => {
    const lower = value.toLowerCase();
    return searchWords.every(w => lower.includes(w));
  };
}
