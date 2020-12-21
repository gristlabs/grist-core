import {KoArray} from 'app/client/lib/koArray';
import {DocModel, IRowModel, recordSet, refRecord, TableRec, ViewFieldRec} from 'app/client/models/DocModel';
import {jsonObservable, ObjObservable} from 'app/client/models/modelUtil';
import * as gristTypes from 'app/common/gristTypes';
import {removePrefix} from 'app/common/gutil';
import * as ko from 'knockout';

// Represents a column in a user-defined table.
export interface ColumnRec extends IRowModel<"_grist_Tables_column"> {
  table: ko.Computed<TableRec>;
  widgetOptionsJson: ObjObservable<any>;
  viewFields: ko.Computed<KoArray<ViewFieldRec>>;
  summarySource: ko.Computed<ColumnRec>;

  // Is an empty column (undecided if formula or data); denoted by an empty formula.
  isEmpty: ko.Computed<boolean>;

  // Is a real formula column (not an empty column; i.e. contains a non-empty formula).
  isRealFormula: ko.Computed<boolean>;

  // Used for transforming a column.
  // Reference to the original column for a transform column, or to itself for a non-transforming column.
  origColRef: ko.Observable<number>;
  origCol: ko.Computed<ColumnRec>;
  // Indicates whether a column is transforming. Manually set, but should be true in both the original
  // column being transformed and that column's transform column.
  isTransforming: ko.Observable<boolean>;

  // Convenience observable to obtain and set the type with no suffix
  pureType: ko.Computed<string>;

  // The column's display column
  _displayColModel: ko.Computed<ColumnRec>;

  disableModify: ko.Computed<boolean>;
  disableEditData: ko.Computed<boolean>;

  isHiddenCol: ko.Computed<boolean>;

  // Returns the rowModel for the referenced table, or null, if is not a reference column.
  refTable: ko.Computed<TableRec|null>;

  // Helper which adds/removes/updates column's displayCol to match the formula.
  saveDisplayFormula(formula: string): Promise<void>|undefined;
}

export function createColumnRec(this: ColumnRec, docModel: DocModel): void {
  this.table = refRecord(docModel.tables, this.parentId);
  this.widgetOptionsJson = jsonObservable(this.widgetOptions);
  this.viewFields = recordSet(this, docModel.viewFields, 'colRef');
  this.summarySource = refRecord(docModel.columns, this.summarySourceCol);

  // Is this an empty column (undecided if formula or data); denoted by an empty formula.
  this.isEmpty = ko.pureComputed(() => this.isFormula() && this.formula() === '');

  // Is this a real formula column (not an empty column; i.e. contains a non-empty formula).
  this.isRealFormula = ko.pureComputed(() => this.isFormula() && this.formula() !== '');

  // Used for transforming a column.
  // Reference to the original column for a transform column, or to itself for a non-transforming column.
  this.origColRef = ko.observable(this.getRowId());
  this.origCol = refRecord(docModel.columns, this.origColRef);
  // Indicates whether a column is transforming. Manually set, but should be true in both the original
  // column being transformed and that column's transform column.
  this.isTransforming = ko.observable(false);

  // Convenience observable to obtain and set the type with no suffix
  this.pureType = ko.pureComputed(() => gristTypes.extractTypeFromColType(this.type()));

  // The column's display column
  this._displayColModel = refRecord(docModel.columns, this.displayCol);

  // Helper which adds/removes/updates this column's displayCol to match the formula.
  this.saveDisplayFormula = function(formula) {
    if (formula !== (this._displayColModel().formula() || '')) {
      return docModel.docData.sendAction(["SetDisplayFormula", this.table().tableId(),
        null, this.getRowId(), formula]);
    }
  };

  this.disableModify = ko.pureComputed(() => Boolean(this.summarySourceCol()));
  this.disableEditData = ko.pureComputed(() => Boolean(this.summarySourceCol()));

  this.isHiddenCol = ko.pureComputed(() => gristTypes.isHiddenCol(this.colId()));

  // Returns the rowModel for the referenced table, or null, if this is not a reference column.
  this.refTable = ko.pureComputed(() => {
    const refTableId = removePrefix(this.type() || "", 'Ref:');
    return refTableId ? docModel.allTables.all().find(t => t.tableId() === refTableId) || null : null;
  });
}
