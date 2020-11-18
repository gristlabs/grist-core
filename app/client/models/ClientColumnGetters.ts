import * as DataTableModel from 'app/client/models/DataTableModel';
import {ColumnGetters} from 'app/common/ColumnGetters';
import * as gristTypes from 'app/common/gristTypes';

/**
 *
 * An implementation of ColumnGetters for the client, drawing
 * on the observables and models available in that context.
 *
 */
export class ClientColumnGetters implements ColumnGetters {

  // If the "unversioned" option is set, then cells with multiple
  // versions will be read as a single version - the first version
  // available of parent, local, or remote.  This can make sense for
  // sorting, so cells appear in a reasonably sensible place.
  constructor(private _tableModel: DataTableModel, private _options: {
    unversioned?: boolean} = {}) {
  }

  public getColGetter(colRef: number): ((rowId: number) => any) | null {
    const colId = this._tableModel.docModel.columns.getRowModel(Math.abs(colRef)).colId();
    const getter = this._tableModel.tableData.getRowPropFunc(colId);
    if (!getter) { return getter || null; }
    if (this._options.unversioned && this._tableModel.tableData.mayHaveVersions()) {
      return (rowId) => {
        const value = getter(rowId);
        if (value && gristTypes.isVersions(value)) {
          const versions = value[1];
          return ('parent' in versions) ? versions.parent :
            ('local' in versions) ? versions.local : versions.remote;
        }
        return value;
      };
    }
    return getter;
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
