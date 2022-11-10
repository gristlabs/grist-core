import { KoArray } from 'app/client/lib/koArray';
import * as koUtil from 'app/client/lib/koUtil';
import BaseRowModel from 'app/client/models/BaseRowModel';
import DataTableModel from 'app/client/models/DataTableModel';
import { IRowModel } from 'app/client/models/DocModel';
import { ValidationRec } from 'app/client/models/entities/ValidationRec';
import * as modelUtil from 'app/client/models/modelUtil';
import { CellValue, ColValues } from 'app/common/DocActions';
import * as ko from 'knockout';

/**
 * DataRowModel is a RowModel for a Data Table. It creates observables for each field in colNames.
 * A DataRowModel is initialized "unassigned", and can be assigned to any rowId using `.assign()`.
 */
export class DataRowModel extends BaseRowModel {
  // Instances of this class are indexable, but that is a little awkward to type.
  // The cells field gives typed access to that aspect of the instance.  This is a
  // bit hacky, and should be cleaned up when BaseRowModel is ported to typescript.
  public readonly cells: {[key: string]: modelUtil.KoSaveableObservable<CellValue>} = this as any;

  public _validationFailures: ko.PureComputed<Array<IRowModel<'_grist_Validations'>>>;
  public _isAddRow: ko.Observable<boolean>;

  public _isRealChange: ko.Observable<boolean>;

  public constructor(dataTableModel: DataTableModel, colNames: string[]) {
    super(dataTableModel, colNames);

    const allValidationsList: ko.Computed<KoArray<ValidationRec>> = dataTableModel.tableMetaRow.validations;

    this._isAddRow = ko.observable(false);

    // Observable that's set whenever a change to a row model is likely to be real, and unset when a
    // row model is being reassigned to a different row. If a widget uses CSS transitions for
    // changes, those should only be enabled when _isRealChange is true.
    this._isRealChange = ko.observable(true);

    this._validationFailures = this.autoDispose(ko.pureComputed(() => {
      return allValidationsList().all().filter(
        validation => !this.cells[this.getValidationNameFromId(validation.id())]());
    }));
  }

  /**
   * Helper method to get the column id of a validation associated with a given id
   * No code other than this should need to know what
   * naming scheme is used
   */
  public getValidationNameFromId(id: number) {
    return "validation___" + id;
  }

  /**
   * Overrides BaseRowModel.updateColValues(), which is used to save fields, to support the special
   * "add-row" records, and to ensure values are up-to-date when the action completes.
   */
  public async updateColValues(colValues: ColValues) {
    const action = this._isAddRow.peek() ?
      ["AddRecord", null, colValues] : ["UpdateRecord", this._rowId, colValues];

    try {
      return await this._table.sendTableAction(action);
    } finally {
      // If the action doesn't actually result in an update to a row, it's important to reset the
      // observable to the data (if the data did get updated, this will be a no-op). This is also
      // important for AddRecord: if after the update, this row is again the 'new' row, it needs to
      // be cleared out.
      // TODO: in the case when data reverts because an update didn't happen (e.g. typing in
      // "12.000" into a numeric column that has "12" in it), there should be a visual indication.
      Object.keys(colValues).forEach(colId => this._assignColumn(colId));
    }
  }


  /**
   * Assign the DataRowModel to a different row of the table. This is primarily used with koDomScrolly,
   * when scrolling is accomplished by reusing a few rows of DOM and their underying RowModels.
   */
  public assign(rowId: number|'new'|null) {
    this._rowId = rowId;
    this._isAddRow(rowId === 'new');

    // When we reassign a row, unset _isRealChange momentarily (to disable CSS transitions).
    // NOTE: it would be better to only set this flag when there is a data change (rather than unset
    // it whenever we scroll), but Chrome will only run a transition if it's enabled before the
    // actual DOM change, so setting this flag in the same tick as a change is not sufficient.
    this._isRealChange(false);
    // Include a check to avoid using the observable after the row model has been disposed.
    setTimeout(() => this.isDisposed() || this._isRealChange(true), 0);

    if (this._rowId !== null) {
      this._fields.forEach(colName => this._assignColumn(colName));
    }
  }

  /**
   * Helper method to assign a particular column of this row to the associated tabledata.
   */
  private _assignColumn(colName: string) {
    if (!this.isDisposed() && this.hasOwnProperty(colName)) {
      const value =
        (this._rowId === 'new' || !this._rowId) ? '' : this._table.tableData.getValue(this._rowId, colName);
      koUtil.withKoUtils(this.cells[colName]).assign(value);
    }
  }
}
