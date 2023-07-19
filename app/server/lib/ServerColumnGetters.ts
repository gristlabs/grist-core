import {ColumnGetter, ColumnGetters, ColumnGettersByColId} from 'app/common/ColumnGetters';
import * as gristTypes from 'app/common/gristTypes';
import {safeJsonParse} from 'app/common/gutil';
import {choiceGetter} from 'app/common/SortFunc';
import {Sort} from 'app/common/SortSpec';
import {BulkColValues} from 'app/plugin/GristData';

/**
 *
 * An implementation of ColumnGetters for the server, currently
 * drawing on the data and metadata prepared for CSV export.
 *
 */
export class ServerColumnGetters implements ColumnGetters, ColumnGettersByColId {
  private _rowIndices: Map<number, number>;
  private _colIndices: Map<number, string>;

  constructor(rowIds: number[], private _dataByColId: BulkColValues, private _columns: any[]) {
    this._rowIndices = new Map<number, number>(rowIds.map((rowId, index) => [rowId, index] as [number, number]));
    this._colIndices = new Map<number, string>(_columns.map(col => [col.id, col.colId] as [number, string]));
  }

  public getColGetter(colSpec: Sort.ColSpec): ColumnGetter | null {
    const colRef = Sort.getColRef(colSpec);
    const colId = this._colIndices.get(colRef);
    if (colId === undefined) {
      return null;
    }
    let getter = this.getColGetterByColId(colId);
    if (!getter) {
      return null;
    }
    const details = Sort.specToDetails(colSpec);
    if (details.orderByChoice) {
      const rowModel = this._columns.find(c => c.id == colRef);
      if (rowModel?.type === 'Choice') {
        const choices: string[] = safeJsonParse(rowModel.widgetOptions, {}).choices || [];
        getter = choiceGetter(getter, choices);
      }
    }
    return getter;
  }

  public getManualSortGetter(): ((rowId: number) => any) | null {
    const manualSortCol = this._columns.find(c => c.colId === gristTypes.MANUALSORT);
    if (!manualSortCol) {
      return null;
    }
    return this.getColGetter(manualSortCol.id);
  }

  public getColGetterByColId(colId: string): ColumnGetter | null {
    if (colId === "id") {
      return (rowId: number) => rowId;
    }
    const col = this._dataByColId[colId];
    if (!col) {
      return null;
    }
    return (rowId: number) => {
      const idx = this._rowIndices.get(rowId);
      if (idx === undefined) {
        return null;
      }
      return col[idx];
    };
  }

}
