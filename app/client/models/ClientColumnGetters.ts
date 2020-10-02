import {ColumnGetters} from 'app/common/ColumnGetters';
import * as gristTypes from 'app/common/gristTypes';

/**
 *
 * An implementation of ColumnGetters for the client, drawing
 * on the observables and models available in that context.
 *
 */
export class ClientColumnGetters implements ColumnGetters {

  constructor(private _tableModel: any) {
  }

  public getColGetter(colRef: number): ((rowId: number) => any) | null {
    const colId = this._tableModel.docModel.columns.getRowModel(Math.abs(colRef)).colId();
    return this._tableModel.tableData.getRowPropFunc(colId);
  }

  public getManualSortGetter(): ((rowId: number) => any) | null {
    const manualSortCol = this._tableModel.tableMetaRow.columns().peek().find(
      (c: any) => c.colId() === gristTypes.MANUALSORT);
    if (!manualSortCol) {
      return null;
    }
    return this.getColGetter(manualSortCol.getRowId());
  }
}
