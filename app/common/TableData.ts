/**
 * TableData maintains a single table's data.
 */
import {ActionDispatcher} from 'app/common/ActionDispatcher';
import {BulkAddRecord, BulkColValues, CellValue, ColInfo, ColInfoWithId, ColValues, DocAction,
        isSchemaAction, ReplaceTableData, RowRecord, TableDataAction} from 'app/common/DocActions';
import {getDefaultForType} from 'app/common/gristTypes';
import {arrayRemove, arraySplice, getDistinctValues} from 'app/common/gutil';
import {SchemaTypes} from 'app/common/schema';
import {UIRowId} from 'app/plugin/GristAPI';
import isEqual = require('lodash/isEqual');
import fromPairs = require('lodash/fromPairs');

export interface ColTypeMap { [colId: string]: string; }



type UIRowFunc<T> = (rowId: UIRowId) => T;

interface ColData {
  colId: string;
  type: string;
  defl: any;
  values: CellValue[];
}

export interface SingleCell {
  tableId: string;
  colId: string;
  rowId: number;
}

/**
 * An interface for a table with rows that may be skipped.
 */
export interface SkippableRows {
  // If there may be skippable rows, return a function to test rowIds for keeping.
  getKeepFunc(): undefined | UIRowFunc<boolean>;
  // Get a special row id which represents a skipped sequence of rows.
  getSkipRowId(): number;
}

/**
 * TableData class to maintain a single table's data.
 *
 * In the browser's memory, table data needs a representation that's reasonably compact. We
 * represent it as column-wise arrays. (An early hope was to allow use of TypedArrays, but since
 * types can be mixed, those are not used.)
 */
export class TableData extends ActionDispatcher implements SkippableRows {
  private _tableId: string;
  private _isLoaded: boolean = false;
  private _fetchPromise?: Promise<void>;

  // Storage of the underlying data. Each column is an array, all of the same length. Includes
  // 'id' column, containing a reference to _rowIdCol.
  private _columns: Map<string, ColData> = new Map();

  // Array of all ColData objects, omitting 'id'.
  private _colArray: ColData[] = [];

  // The `id` column is direct reference to the 'id' column, and contains row ids.
  private _rowIdCol: number[] = [];

  // Maps row id to index in the arrays in _columns. I.e. it's the inverse of _rowIdCol.
  private _rowMap: Map<number, number> = new Map();

  constructor(tableId: string, tableData: TableDataAction|null, colTypes: ColTypeMap) {
    super();
    this._tableId = tableId;

    // Initialize all columns to empty arrays, while nothing is yet loaded.
    for (const colId in colTypes) {
      if (colTypes.hasOwnProperty(colId)) {
        const type = colTypes[colId];
        const defl = getDefaultForType(type);
        const colData: ColData = { colId, type, defl, values: [] };
        this._columns.set(colId, colData);
        this._colArray.push(colData);
      }
    }
    this._columns.set('id', {colId: 'id', type: 'Id', defl: 0, values: this._rowIdCol});

    if (tableData) {
      this.loadData(tableData);
    }
    // TODO: We should probably unload big sets of data when no longer needed. This can be left for
    // when we support loading only parts of a table.
  }

  /**
   * Fetch data (as long as a fetch is not in progress), and load it in memory when done.
   * Returns a promise that's resolved when data finishes loading, and isLoaded becomes true.
   */
  public fetchData(fetchFunc: (tableId: string) => Promise<TableDataAction>): Promise<void> {
    if (!this._fetchPromise) {
      this._fetchPromise = fetchFunc(this._tableId).then(data => {
        this._fetchPromise = undefined;
        this.loadData(data);
      });
    }
    return this._fetchPromise;
  }

  /**
   * Populates the data for this table. Returns the array of old rowIds that were loaded before.
   */
  public loadData(tableData: TableDataAction|ReplaceTableData): number[] {
    const rowIds: number[] = tableData[2];
    const colValues: BulkColValues = tableData[3];
    const oldRowIds: number[] = this._rowIdCol.slice(0);

    reassignArray(this._rowIdCol, rowIds);
    for (const colData of this._colArray) {
      const values = colData.colId === 'id' ? rowIds : colValues[colData.colId];
      // If colId is missing from tableData, use an array of default values. Note that reusing
      // default value like this is only OK because all default values we use are primitive.
      reassignArray(colData.values, values || this._rowIdCol.map(() => colData.defl));
    }

    this._rowMap.clear();
    for (let i = 0; i < rowIds.length; i++) {
      this._rowMap.set(rowIds[i], i);
    }

    this._isLoaded = true;
    return oldRowIds;
  }

  // Used by QuerySet to load new rows for onDemand tables.
  public loadPartial(data: TableDataAction): void {
    // Add the new rows, reusing BulkAddData code.
    const rowIds: number[] = data[2];
    this.onBulkAddRecord(data, data[1], rowIds, data[3]);

    // Mark the table as loaded.
    this._isLoaded = true;
  }

  // Used by QuerySet to remove unused rows for onDemand tables when a QuerySet is disposed.
  public unloadPartial(rowIds: number[]): void {
    // Remove the unneeded rows, reusing BulkRemoveRecord code.
    this.onBulkRemoveRecord(['BulkRemoveRecord', this.tableId, rowIds], this.tableId, rowIds);
  }

  /**
   * Read-only tableId.
   */
  public get tableId(): string { return this._tableId; }

  /**
   * Boolean flag for whether the data for this table is already loaded.
   */
  public get isLoaded(): boolean { return this._isLoaded; }

  /**
   * The number of records loaded in this table.
   */
  public numRecords(): number { return this._rowIdCol.length; }

  /**
   * Returns the specified value from this table.
   */
  public getValue(rowId: UIRowId, colId: string): CellValue|undefined {
    const colData = this._columns.get(colId);
    const index = this._rowMap.get(rowId as number);    // rowId of 'new' will not be found.
    return colData && index !== undefined ? colData.values[index] : undefined;
  }

  public hasRowId(rowId: number): boolean {
    return this._rowMap.has(rowId);
  }

  /**
   * Returns the index of the given rowId, if it exists, in the same unstable order that's
   * returned by getRowIds() and getColValues().
   */
  public getRowIdIndex(rowId: UIRowId): number|undefined {
    return this._rowMap.get(rowId as number);
  }

  /**
   * Given a column name, returns a function that takes a rowId and returns the value for that
   * column of that row. The returned function is faster than getValue() calls.
   */
  public getRowPropFunc(colId: string): UIRowFunc<CellValue|undefined> {
    const colData = this._columns.get(colId);
    if (!colData) { return () => undefined; }
    const values = colData.values;
    const rowMap = this._rowMap;
    return (rowId: UIRowId) => values[rowMap.get(rowId as number)!];
  }

  // By default, no rows are skippable, all are kept.
  public getKeepFunc(): undefined | UIRowFunc<boolean> {
    return undefined;
  }

  // By default, no special row id for skip rows is needed.
  public getSkipRowId(): number {
    throw new Error('no skip row id defined');
  }

  /**
   * Returns the list of all rowIds in this table, in unspecified and unstable order. Equivalent
   * to getColValues('id').
   */
  public getRowIds(): ReadonlyArray<number> {
    return this._rowIdCol;
  }

  /**
   * Sort and returns the list of all rowIds in this table.
   */
  public getSortedRowIds(): number[] {
    return this._rowIdCol.slice(0).sort((a, b) => a - b);
  }

  /**
   * Returns true if cells may contain multiple versions (e.g. in diffs).
   */
  public mayHaveVersions() {
    return false;
  }

  /**
   * Returns the list of colIds in this table, including 'id'.
   */
  public getColIds(): string[] {
    return Array.from(this._columns.keys());
  }

  /**
   * Returns an unsorted list of all values in the given column. With no intervening actions,
   * all arrays returned by getColValues() and getRowIds() are parallel to each other, i.e. the
   * values at the same index correspond to the same record.
   */
  public getColValues(colId: string): ReadonlyArray<CellValue>|undefined {
    const colData = this._columns.get(colId);
    return colData ? colData.values : undefined;
  }

  /**
   * Returns a limited-sized set of distinct values from a column. If count is given, limits how many
   * distinct values are returned.
   */
  public getDistinctValues(colId: string, count: number = Infinity): Set<CellValue>|undefined {
    const valColumn = this.getColValues(colId);
    if (!valColumn) { return undefined; }
    return getDistinctValues(valColumn, count);
  }

  /**
   * Return data in TableDataAction form ['TableData', tableId, [...rowIds], {...}]
   * Optionally takes a list of row ids to return data from. If a row id is
   * not actually present in the table, a row of nulls will be returned for it.
   */
  public getTableDataAction(desiredRowIds?: number[],
                            colIds?: string[]): TableDataAction {
    colIds = colIds || this.getColIds();
    const colIdSet = new Set<string>(colIds);
    const rowIds = desiredRowIds || this.getRowIds();
    let bulkColValues: {[colId: string]: CellValue[]};
    const colArray = this._colArray.filter(({colId}) => colIdSet.has(colId));
    if (desiredRowIds) {
      const len = rowIds.length;
      bulkColValues = {};
      for (const colId of colIds) { bulkColValues[colId] = Array(len); }
      for (let i = 0; i < len; i++) {
        const index = this._rowMap.get(rowIds[i]);
        for (const {colId, values} of colArray) {
          const value = (index === undefined) ? null : values[index];
          bulkColValues[colId][i] = value;
        }
      }
    } else {
      bulkColValues = fromPairs(
        colIds
          .filter(colId => colId !== 'id')
          .map(colId => [colId, this.getColValues(colId)! as CellValue[]]));
    }
    return ['TableData',
            this.tableId,
            rowIds as number[],
            bulkColValues];
  }

  public getBulkAddRecord(desiredRowIds?: number[]): BulkAddRecord {
    const tableData = this.getTableDataAction(desiredRowIds?.sort((a, b) => a - b));
    return [
      'BulkAddRecord', tableData[1], tableData[2], tableData[3],
    ];
  }

  /**
   * Returns the given columns type, if the column exists, or undefined otherwise.
   */
  public getColType(colId: string): string|undefined {
    const colData = this._columns.get(colId);
    return colData ? colData.type : undefined;
  }

  /**
   * Builds and returns a record object for the given rowId.
   */
  public getRecord(rowId: number): undefined | RowRecord {
    const index = this._rowMap.get(rowId);
    if (index === undefined) { return undefined; }
    const ret: RowRecord = { id: this._rowIdCol[index] };
    for (const colData of this._colArray) {
      ret[colData.colId] = colData.values[index];
    }
    return ret;
  }

  /**
   * Builds and returns the list of all records on this table, in unspecified and unstable order.
   */
  public getRecords(): RowRecord[] {
    const records: RowRecord[] = this._rowIdCol.map((id) => ({ id }));
    for (const {colId, values} of this._colArray) {
      for (let i = 0; i < records.length; i++) {
        records[i][colId] = values[i];
      }
    }
    return records;
  }

  public filterRowIds(properties: {[key: string]: any}): number[] {
    return this._filterRowIndices(properties).map(i => this._rowIdCol[i]);
  }

  /**
   * Builds and returns the list of records in this table that match the given properties object.
   * Properties may include 'id' and any table columns. Returned records are not sorted.
   */
  public filterRecords(properties: {[key: string]: any}): RowRecord[] {
    const rowIndices: number[] = this._filterRowIndices(properties);

    // Convert the array of indices to an array of RowRecords.
    const records: RowRecord[] = rowIndices.map(i => ({id: this._rowIdCol[i]}));
    for (const {colId, values} of this._colArray) {
      for (let i = 0; i < records.length; i++) {
        records[i][colId] = values[rowIndices[i]];
      }
    }
    return records;
  }

  /**
   * Returns the rowId in the table where colValue is found in the column with the given colId.
   */
  public findRow(colId: string, colValue: any): number {
    const colData = this._columns.get(colId);
    if (!colData) {
      return 0;
    }
    const index = colData.values.indexOf(colValue);
    return index < 0 ? 0 : this._rowIdCol[index];
  }

  /**
   * Returns the first rowId matching the given filters, or 0 if no match. If there are multiple
   * matches, it is unspecified which will be returned.
   */
  public findMatchingRowId(properties: {[key: string]: CellValue | undefined}): number {
    const props = Object.keys(properties).map(p => ({col: this._columns.get(p)!, value: properties[p]}));
    if (!props.every((p) => p.col)) {
      return 0;
    }
    return this._rowIdCol.find((id, i) =>
      props.every((p) => isEqual(p.col.values[i], p.value))
    ) || 0;
  }

  /**
   * Applies a DocAction received from the server; returns true, or false if it was skipped.
   */
  public receiveAction(action: DocAction): boolean {
    if (this._isLoaded || isSchemaAction(action)) {
      this.dispatchAction(action);
      return true;
    }
    return false;
  }

  // ---- The following methods implement ActionDispatcher interface ----

  protected onAddRecord(action: DocAction, tableId: string, rowId: number, colValues: ColValues): void {
    if (this._rowMap.get(rowId) !== undefined) {
      // If adding a record that already exists, act like an update.
      // We rely on this behavior for distributing attachment
      // metadata.
      this.onUpdateRecord(action, tableId, rowId, colValues);
      return;
    }
    const index: number = this._rowIdCol.length;
    this._rowMap.set(rowId, index);
    this._rowIdCol[index] = rowId;
    for (const {colId, defl, values} of this._colArray) {
      values[index] = colValues.hasOwnProperty(colId) ? colValues[colId] : defl;
    }
  }

  protected onBulkAddRecord(action: DocAction, tableId: string, rowIds: number[], colValues: BulkColValues): void {
    let destIndex: number = this._rowIdCol.length;
    for (let i = 0; i < rowIds.length; i++) {
      const srcIndex = this._rowMap.get(rowIds[i]);
      if (srcIndex !== undefined) {
        // If adding a record that already exists, act like an update.
        // We rely on this behavior for distributing attachment
        // metadata.
        for (const colId in colValues) {
          if (colValues.hasOwnProperty(colId)) {
            const colData = this._columns.get(colId);
            if (colData) {
              colData.values[srcIndex] = colValues[colId][i];
            }
          }
        }
      } else {
        this._rowMap.set(rowIds[i], destIndex);
        this._rowIdCol[destIndex] = rowIds[i];
        for (const {colId, defl, values} of this._colArray) {
          values[destIndex] = colValues.hasOwnProperty(colId) ? colValues[colId][i] : defl;
        }
        destIndex++;
      }
    }
  }

  protected onRemoveRecord(action: DocAction, tableId: string, rowId: number): void {
    // Note that in this implementation, delete + undo will reorder the storage and the ordering
    // of rows returned getRowIds() and similar methods.
    const index = this._rowMap.get(rowId);
    if (index !== undefined) {
      const last: number = this._rowIdCol.length - 1;
      // We keep the column-wise arrays dense by moving the last element into the freed-up spot.
      for (const {values} of this._columns.values()) {    // This adjusts _rowIdCol too.
        values[index] = values[last];
        values.pop();
      }
      this._rowMap.set(this._rowIdCol[index], index);
      this._rowMap.delete(rowId);
    }
  }

  protected onUpdateRecord(action: DocAction, tableId: string, rowId: number, colValues: ColValues): void {
    const index = this._rowMap.get(rowId);
    if (index !== undefined) {
      for (const colId in colValues) {
        if (colValues.hasOwnProperty(colId)) {
          const colData = this._columns.get(colId);
          if (colData) {
            colData.values[index] = colValues[colId];
          }
        }
      }
    }
  }

  protected onBulkUpdateRecord(action: DocAction, tableId: string, rowIds: number[], colValues: BulkColValues): void {
    for (let i = 0; i < rowIds.length; i++) {
      const index = this._rowMap.get(rowIds[i]);
      if (index !== undefined) {
        for (const colId in colValues) {
          if (colValues.hasOwnProperty(colId)) {
            const colData = this._columns.get(colId);
            if (colData) {
              colData.values[index] = colValues[colId][i];
            }
          }
        }
      }
    }
  }

  protected onReplaceTableData(action: DocAction, tableId: string, rowIds: number[], colValues: BulkColValues): void {
    this.loadData(action as ReplaceTableData);
  }

  protected onAddColumn(action: DocAction, tableId: string, colId: string, colInfo: ColInfo): void {
    if (this._columns.has(colId)) { return; }
    const type = colInfo.type;
    const defl = getDefaultForType(type);
    const colData: ColData = { colId, type, defl, values: this._rowIdCol.map(() => defl) };
    this._columns.set(colId, colData);
    this._colArray.push(colData);
  }

  protected onRemoveColumn(action: DocAction, tableId: string, colId: string): void {
    const colData = this._columns.get(colId);
    if (!colData) { return; }
    this._columns.delete(colId);
    arrayRemove(this._colArray, colData);
  }

  protected onRenameColumn(action: DocAction, tableId: string, oldColId: string, newColId: string): void {
    const colData = this._columns.get(oldColId);
    if (colData) {
      colData.colId = newColId;
      this._columns.set(newColId, colData);
      this._columns.delete(oldColId);
    }
  }

  protected onModifyColumn(action: DocAction, tableId: string, oldColId: string, colInfo: ColInfo): void {
    const colData = this._columns.get(oldColId);
    if (colData && colInfo.hasOwnProperty('type')) {
      colData.type = colInfo.type;
      colData.defl = getDefaultForType(colInfo.type);
    }
  }

  protected onRenameTable(action: DocAction, oldTableId: string, newTableId: string): void {
    this._tableId = newTableId;
  }

  protected onAddTable(action: DocAction, tableId: string, columns: ColInfoWithId[]): void {
    // A table processing its own addition is a noop
  }

  protected onRemoveTable(action: DocAction, tableId: string): void {
    // Stop dispatching actions if we've been deleted. We might also want to clean up in the future.
    this._isLoaded = false;
  }

  private _filterRowIndices(properties: {[key: string]: any}): number[] {
    const rowIndices: number[] = [];
    // Array of {col: arrayOfColValues, value: valueToMatch}
    const props = Object.keys(properties).map(p => ({col: this._columns.get(p)!, value: properties[p]}));
    this._rowIdCol.forEach((id, i) => {
      // Collect the indices of the matching rows.
      if (props.every((p) => isEqual(p.col.values[i], p.value))) {
        rowIndices.push(i);
      }
    });
    return rowIndices;
  }
}

// A type safe record of a meta table with types as defined in schema.ts
// '&' is used because declaring the id field and the index signature in one block gives a syntax error.
// The second part is basically equivalent to SchemaTypes[TableId]
// but TS sees that as incompatible with RowRecord and doesn't allow simple overrides in MetaTableData.
export type MetaRowRecord<TableId extends keyof SchemaTypes> =
  { id: number } &
  { [ColId in keyof SchemaTypes[TableId]]: SchemaTypes[TableId][ColId] & CellValue };

type MetaColId<TableId extends keyof SchemaTypes> = keyof MetaRowRecord<TableId> & string;

/**
 * Behaves the same as TableData, but uses SchemaTypes for type safety of its columns.
 */
export class MetaTableData<TableId extends keyof SchemaTypes> extends TableData {
  constructor(tableId: TableId, tableData: TableDataAction | null, colTypes: ColTypeMap) {
    super(tableId, tableData, colTypes);
  }

  public getValue<ColId extends MetaColId<TableId>>(rowId: number, colId: ColId):
    MetaRowRecord<TableId>[ColId] | undefined {
    return super.getValue(rowId, colId) as any;
  }

  public getRecords(): Array<MetaRowRecord<TableId>> {
    return super.getRecords() as any;
  }

  public getRecord(rowId: number): MetaRowRecord<TableId> | undefined {
    return super.getRecord(rowId) as any;
  }

  public filterRecords(properties: Partial<MetaRowRecord<TableId>>): Array<MetaRowRecord<TableId>> {
    return super.filterRecords(properties) as any;
  }

  public findMatchingRowId(properties: Partial<MetaRowRecord<TableId>>): number {
    return super.findMatchingRowId(properties);
  }

  public getRowPropFunc<ColId extends MetaColId<TableId>>(
    colId: ColId
  ): UIRowFunc<MetaRowRecord<TableId>[ColId]> {
    return super.getRowPropFunc(colId as any) as any;
  }

  public getColValues<ColId extends MetaColId<TableId>>(
    colId: ColId
  ): ReadonlyArray<MetaRowRecord<TableId>[ColId]> {
    return super.getColValues(colId) as any;
  }

  public findRow<ColId extends MetaColId<TableId>>(
    colId: ColId, colValue: MetaRowRecord<TableId>[ColId]
  ): number {
    return super.findRow(colId, colValue);
  }
}

function reassignArray<T>(targetArray: T[], sourceArray: T[]): void {
  targetArray.length = 0;
  arraySplice(targetArray, 0, sourceArray);
}
