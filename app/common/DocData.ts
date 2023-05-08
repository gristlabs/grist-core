/**
 * DocData maintains all underlying data for a Grist document, knows how to load it,
 * subscribes to actions which change it, and forwards those actions to individual tables.
 * It also provides the interface to apply actions to data.
 */
import {DocumentSettings} from 'app/common/DocumentSettings';
import {safeJsonParse} from 'app/common/gutil';
import {schema, SchemaTypes} from 'app/common/schema';
import fromPairs = require('lodash/fromPairs');
import groupBy = require('lodash/groupBy');
import {ActionDispatcher} from './ActionDispatcher';
import {TableFetchResult} from './ActiveDocAPI';
import {
  BulkColValues, ColInfo, ColInfoWithId, ColValues, DocAction,
  RowRecord, TableDataAction
} from './DocActions';
import {ColTypeMap, MetaRowRecord, MetaTableData, TableData} from './TableData';

type FetchTableFunc = (tableId: string) => Promise<TableFetchResult>;

export class DocData extends ActionDispatcher {
  private _tables: Map<string, TableData> = new Map();

  private _fetchTableFunc: (tableId: string) => Promise<TableDataAction>;

  /**
   * If metaTableData is not supplied, then any tables needed should be loaded manually,
   * using syncTable(). All column types will be set to Any, which will affect default
   * values.
   */
  constructor(fetchTableFunc: FetchTableFunc, metaTableData: {[tableId: string]: TableDataAction} | null) {
    super();
    // Wrap fetchTableFunc slightly to handle any extra attachment data that
    // may come along for the ride.
    this._fetchTableFunc = async (tableId: string) => {
      const {tableData, attachments} = await fetchTableFunc(tableId);
      if (attachments) {
        // Back-end doesn't keep track of which attachments we already have,
        // so there may be duplicates of rows we already have - but happily
        // BulkAddRecord overwrites duplicates now.
        this.receiveAction(attachments);
      }
      return tableData;
    };
    if (metaTableData === null) { return; }
    // Create all meta tables, and populate data we already have.
    for (const tableId in schema) {
      if (schema.hasOwnProperty(tableId)) {
        const colTypes: ColTypeMap = (schema as any)[tableId];
        this._tables.set(tableId, this.createTableData(tableId, metaTableData[tableId], colTypes));
      }
    }

    // Build a map from tableRef to [columnRecords]
    const colsByTable = groupBy(this._tables.get('_grist_Tables_column')!.getRecords(), 'parentId');
    for (const t of this._tables.get('_grist_Tables')!.getRecords()) {
      const tableId = t.tableId as string;
      const colRecords: RowRecord[] = colsByTable[t.id] || [];
      const colTypes = fromPairs(colRecords.map(c => [c.colId, c.type]));
      this._tables.set(tableId, this.createTableData(tableId, null, colTypes));
    }
  }

  /**
   * Creates a new TableData object. A derived class may override to return an object derived from TableData.
   */
  public createTableData(tableId: string, tableData: TableDataAction|null, colTypes: ColTypeMap): TableData {
    return new (tableId in schema ? MetaTableData : TableData)(tableId, tableData, colTypes);
  }

  /**
   * Returns the TableData object for the requested table.
   */
  public getTable(tableId: string): TableData|undefined {
    return this._tables.get(tableId);
  }

  public async requireTable(tableId: string): Promise<TableData> {
    await this.fetchTable(tableId);
    const td = this._tables.get(tableId);
    if (!td) {
      throw new Error(`could not fetch table: ${tableId}`);
    }
    return td;
  }

  /**
   * Like getTable, but the result knows about the types of its records
   */
  public getMetaTable<TableId extends keyof SchemaTypes>(tableId: TableId): MetaTableData<TableId> {
    return this.getTable(tableId) as any;
  }

  /**
   * Returns an unsorted list of all tableIds in this doc, including both metadata and user tables.
   */
  public getTables(): ReadonlyMap<string, TableData> {
    return this._tables;
  }

  /**
   * Fetches the data for tableId if needed, and returns a promise that is fulfilled when the data
   * is loaded.
   */
  public fetchTable(tableId: string, force?: boolean): Promise<void> {
    const table = this._tables.get(tableId);
    if (!table) { throw new Error(`DocData.fetchTable: unknown table ${tableId}`); }
    return (!table.isLoaded || force) ? table.fetchData(this._fetchTableFunc) : Promise.resolve();
  }

  /**
   * Fetches the data for tableId unconditionally, and without knowledge of its metadata.
   * Columns will be assumed to have type 'Any'.
   */
  public async syncTable(tableId: string): Promise<void> {
    const tableData = await this._fetchTableFunc(tableId);
    const colTypes = fromPairs(Object.keys(tableData[3]).map(c => [c, 'Any']));
    colTypes.id = 'Any';
    this._tables.set(tableId, this.createTableData(tableId, tableData, colTypes));
  }

  /**
   * Handles an action received from the server, by forwarding it to the appropriate TableData
   * object.
   */
  public receiveAction(action: DocAction): void {
    // Look up TableData before processing the action in case we rename or remove it.
    const tableId: string = action[1];
    const table = this._tables.get(tableId);

    this.dispatchAction(action);

    // Forward all actions to per-table TableData objects.
    if (table) {
      table.receiveAction(action);
    }
  }

  public docInfo(): MetaRowRecord<'_grist_DocInfo'> {
    const docInfoTable = this.getMetaTable('_grist_DocInfo');
    return docInfoTable.getRecord(1)!;
  }

  public docSettings(): DocumentSettings {
    return safeJsonParse(this.docInfo().documentSettings, {});
  }

  // ---- The following methods implement ActionDispatcher interface ----

  protected onAddTable(action: DocAction, tableId: string, columns: ColInfoWithId[]): void {
    const colTypes = fromPairs(columns.map(c => [c.id, c.type]));
    this._tables.set(tableId, this.createTableData(tableId, null, colTypes));
  }

  protected onRemoveTable(action: DocAction, tableId: string): void {
    this._tables.delete(tableId);
  }

  protected onRenameTable(action: DocAction, oldTableId: string, newTableId: string): void {
    const table = this._tables.get(oldTableId);
    if (table) {
      this._tables.set(newTableId, table);
      this._tables.delete(oldTableId);
    }
  }

  // tslint:disable:no-empty
  protected onAddRecord(action: DocAction, tableId: string, rowId: number, colValues: ColValues): void {}
  protected onUpdateRecord(action: DocAction, tableId: string, rowId: number, colValues: ColValues): void {}
  protected onRemoveRecord(action: DocAction, tableId: string, rowId: number): void {}

  protected onBulkAddRecord(action: DocAction, tableId: string, rowIds: number[], colValues: BulkColValues): void {}
  protected onBulkUpdateRecord(action: DocAction, tableId: string, rowIds: number[], colValues: BulkColValues): void {}
  protected onBulkRemoveRecord(action: DocAction, tableId: string, rowIds: number[]) {}

  protected onReplaceTableData(action: DocAction, tableId: string, rowIds: number[], colValues: BulkColValues): void {}

  protected onAddColumn(action: DocAction, tableId: string, colId: string, colInfo: ColInfo): void {}
  protected onRemoveColumn(action: DocAction, tableId: string, colId: string): void {}
  protected onRenameColumn(action: DocAction, tableId: string, oldColId: string, newColId: string): void {}
  protected onModifyColumn(action: DocAction, tableId: string, colId: string, colInfo: ColInfo): void {}
}
