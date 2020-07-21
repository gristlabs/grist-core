import {ColumnGetters} from 'app/common/ColumnGetters';
import * as gristTypes from 'app/common/gristTypes';

/**
 *
 * An implementation of ColumnGetters for the server, currently
 * drawing on the data and metadata prepared for CSV export.
 *
 */
export class ServerColumnGetters implements ColumnGetters {
  private _rowIndices: Map<number, number>;
  private _colIndices: Map<number, string>;

  constructor(rowIds: number[], private _dataByColId: {[colId: string]: any}, private _columns: any[]) {
    this._rowIndices = new Map<number, number>(rowIds.map((rowId, r) => [rowId, r] as [number, number]));
    this._colIndices = new Map<number, string>(_columns.map(col => [col.id, col.colId] as [number, string]));
  }

  public getColGetter(colRef: number): ((rowId: number) => any) | null {
    const colId = this._colIndices.get(colRef);
    if (colId === undefined) {
      return null;
    }
    const col = this._dataByColId[colId];
    return rowId => {
      const idx = this._rowIndices.get(rowId);
      if (idx === undefined) {
        return null;
      }
      return col[idx];
    };
  }

  public getManualSortGetter(): ((rowId: number) => any) | null {
    const manualSortCol = this._columns.find(c => c.colId === gristTypes.MANUALSORT);
    if (!manualSortCol) {
      return null;
    }
    return this.getColGetter(manualSortCol.id);
  }
}
