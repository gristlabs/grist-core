import {KoArray} from 'app/client/lib/koArray';
import {DocModel, IRowModel, recordSet, refRecord, TableRec, ViewFieldRec} from 'app/client/models/DocModel';
import {jsonObservable, ObjObservable} from 'app/client/models/modelUtil';
import * as gristTypes from 'app/common/gristTypes';
import {getReferencedTableId, isFullReferencingType} from 'app/common/gristTypes';
import {BaseFormatter, createFormatter} from 'app/common/ValueFormatter';
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

  // Is a trigger formula column (not formula, but contains non-empty formula)
  hasTriggerFormula: ko.Computed<boolean>;

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

  // Display col ref to use for the column, defaulting to the plain column itself.
  displayColRef: ko.Computed<number>;

  // The display column to use for the column, or the column itself when no displayCol is set.
  displayColModel: ko.Computed<ColumnRec>;
  visibleColModel: ko.Computed<ColumnRec>;

  disableModifyBase: ko.Computed<boolean>;    // True if column config can't be modified (name, type, etc.)
  disableModify: ko.Computed<boolean>;        // True if column can't be modified or is being transformed.
  disableEditData: ko.Computed<boolean>;      // True to disable editing of the data in this column.

  isHiddenCol: ko.Computed<boolean>;

  // Returns the rowModel for the referenced table, or null, if is not a reference column.
  refTable: ko.Computed<TableRec|null>;

  // Helper for Reference/ReferenceList columns, which returns a formatter according
  // to the visibleCol associated with column.
  visibleColFormatter: ko.Computed<BaseFormatter>;

  // A formatter for values of this column.
  // The difference between visibleColFormatter and formatter is especially important for ReferenceLists:
  // `visibleColFormatter` is for individual elements of a list, sometimes hypothetical
  // (i.e. they aren't actually referenced but they exist in the visible column and are relevant to e.g. autocomplete)
  // `formatter` formats actual cell values, e.g. a whole list from the display column.
  formatter: ko.Computed<BaseFormatter>;

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
  // If this column has a trigger formula defined
  this.hasTriggerFormula = ko.pureComputed(() => !this.isFormula() && this.formula() !== '');

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

  // Display col ref to use for the column, defaulting to the plain column itself.
  this.displayColRef = ko.pureComputed(() => this.displayCol() || this.origColRef());

  // The display column to use for the column, or the column itself when no displayCol is set.
  this.displayColModel = refRecord(docModel.columns, this.displayColRef);
  this.visibleColModel = refRecord(docModel.columns, this.visibleCol);

  this.disableModifyBase = ko.pureComputed(() => Boolean(this.summarySourceCol()));
  this.disableModify = ko.pureComputed(() => this.disableModifyBase() || this.isTransforming());
  this.disableEditData = ko.pureComputed(() => Boolean(this.summarySourceCol()));

  this.isHiddenCol = ko.pureComputed(() => gristTypes.isHiddenCol(this.colId()));

  // Returns the rowModel for the referenced table, or null, if this is not a reference column.
  this.refTable = ko.pureComputed(() => {
    const refTableId = getReferencedTableId(this.type() || "");
    return refTableId ? docModel.allTables.all().find(t => t.tableId() === refTableId) || null : null;
  });

  // Helper for Reference/ReferenceList columns, which returns a formatter according to the visibleCol
  // associated with this column. If no visible column available, return formatting for the column itself.
  this.visibleColFormatter = ko.pureComputed(() => visibleColFormatterForRec(this, this, docModel));

  this.formatter = ko.pureComputed(() => formatterForRec(this, this, docModel, this.visibleColFormatter()));
}

export function visibleColFormatterForRec(
  rec: ColumnRec | ViewFieldRec, colRec: ColumnRec, docModel: DocModel
): BaseFormatter {
  const vcol = rec.visibleColModel();
  const documentSettings = docModel.docInfoRow.documentSettingsJson();
  const type = colRec.type();
  if (isFullReferencingType(type)) {
    if (vcol.getRowId() === 0) {
      // This column displays the Row ID, e.g. Table1[2]
      // referencedTableId may actually be empty if the table is hidden
      const referencedTableId: string = colRec.refTable()?.tableId() || "";
      return createFormatter('Id', {tableId: referencedTableId}, documentSettings);
    } else {
      return createFormatter(vcol.type(), vcol.widgetOptionsJson(), documentSettings);
    }
  } else {
    // For non-reference columns, there's no 'visible column' and we just return a regular formatter
    return createFormatter(type, rec.widgetOptionsJson(), documentSettings);
  }
}

export function formatterForRec(
  rec: ColumnRec | ViewFieldRec, colRec: ColumnRec, docModel: DocModel, visibleColFormatter: BaseFormatter
): BaseFormatter {
  const type = colRec.type();
  // Ref/RefList columns delegate most formatting to the visibleColFormatter
  const widgetOpts = {...rec.widgetOptionsJson(), visibleColFormatter};
  const documentSettings = docModel.docInfoRow.documentSettingsJson();
  return createFormatter(type, widgetOpts, documentSettings);
}
