import DataTableModel from 'app/client/models/DataTableModel';
import {ColumnGetter, ColumnGetters, ColumnGettersByColId} from 'app/common/ColumnGetters';
import * as gristTypes from 'app/common/gristTypes';
import {choiceGetter} from 'app/common/SortFunc';
import {Sort} from 'app/common/SortSpec';
import {TableData} from 'app/common/TableData';

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

  public getColGetter(colSpec: Sort.ColSpec): ColumnGetter | null {
    const rowModel = this._tableModel.docModel.columns.getRowModel(Sort.getColRef(colSpec));
    const colId = rowModel.colId();
    let getter: ColumnGetter|undefined = this._tableModel.tableData.getRowPropFunc(colId);
    if (!getter) { return null; }
    if (this._options.unversioned && this._tableModel.tableData.mayHaveVersions()) {
      const valueGetter = getter;
      getter = (rowId) => {
        const value = valueGetter(rowId);
        if (value && gristTypes.isVersions(value)) {
          const versions = value[1];
          return ('parent' in versions) ? versions.parent :
            ('local' in versions) ? versions.local : versions.remote;
        }
        return value;
      };
    }
    const details = Sort.specToDetails(colSpec);
    if (details.orderByChoice) {
      if (rowModel.pureType() === 'Choice') {
        const choices: string[] = rowModel.widgetOptionsJson.peek()?.choices || [];
        getter = choiceGetter(getter, choices);
      }
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


export class ClientColumnGettersByColId implements ColumnGettersByColId {
  constructor(private _tableData: TableData) {
  }

  public getColGetterByColId(colId: string): ColumnGetter {
    return this._tableData.getRowPropFunc(colId);
  }
}
