import {ColumnRec, DocModel, IRowModel, refRecord, ViewSectionRec} from 'app/client/models/DocModel';
import * as modelUtil from 'app/client/models/modelUtil';
import * as UserType from 'app/client/widgets/UserType';
import {BaseFormatter, createFormatter} from 'app/common/ValueFormatter';
import {Computed, fromKo} from 'grainjs';
import * as ko from 'knockout';

// Represents a page entry in the tree of pages.
export interface ViewFieldRec extends IRowModel<"_grist_Views_section_field"> {
  viewSection: ko.Computed<ViewSectionRec>;
  widthDef: modelUtil.KoSaveableObservable<number>;

  widthPx: ko.Computed<string>;
  column: ko.Computed<ColumnRec>;
  origCol: ko.Computed<ColumnRec>;
  colId: ko.Computed<string>;
  label: ko.Computed<string>;

  // displayLabel displays label by default but switches to the more helpful colId whenever a
  // formula field in the view is being edited.
  displayLabel: modelUtil.KoSaveableObservable<string>;

  // The field knows when we are editing a formula, so that all rows can reflect that.
  editingFormula: ko.Computed<boolean>;

  // CSS class to add to formula cells, incl. to show that we are editing field's formula.
  formulaCssClass: ko.Computed<string|null>;

  // The fields's display column
  _displayColModel: ko.Computed<ColumnRec>;

  // Whether field uses column's widgetOptions (true) or its own (false).
  // During transform, use the transform column's options (which should be initialized to match
  // field or column when the transform starts TODO).
  useColOptions: ko.Computed<boolean>;

  // Helper that returns the RowModel for either field or its column, depending on
  // useColOptions. Field and Column have a few identical fields:
  //    .widgetOptions()        // JSON string of options
  //    .saveDisplayFormula()   // Method to save the display formula
  //    .displayCol()           // Reference to an optional associated display column.
  _fieldOrColumn: ko.Computed<ColumnRec|ViewFieldRec>;

  // Display col ref to use for the field, defaulting to the plain column itself.
  displayColRef: ko.Computed<number>;

  visibleColRef: modelUtil.KoSaveableObservable<number>;

  // The display column to use for the field, or the column itself when no displayCol is set.
  displayColModel: ko.Computed<ColumnRec>;
  visibleColModel: ko.Computed<ColumnRec>;

  // The widgetOptions to read and write: either the column's or the field's own.
  _widgetOptionsStr: modelUtil.KoSaveableObservable<string>;

  // Observable for the object with the current options, either for the field or for the column,
  // which takes into account the default options for column's type.

  widgetOptionsJson: modelUtil.SaveableObjObservable<any>;

  // Observable for the parsed filter object saved to the field.
  activeFilter: modelUtil.CustomComputed<string>;

  // Computed boolean that's true when there's a saved filter
  isFiltered: Computed<boolean>;

  disableModify: ko.Computed<boolean>;
  disableEditData: ko.Computed<boolean>;

  textColor: modelUtil.KoSaveableObservable<string>;
  fillColor: modelUtil.KoSaveableObservable<string>;

  // Helper which adds/removes/updates field's displayCol to match the formula.
  saveDisplayFormula(formula: string): Promise<void>|undefined;

  // Helper for Reference columns, which returns a formatter according to the visibleCol
  // associated with field. Subscribes to observables if used within a computed.
  createVisibleColFormatter(): BaseFormatter;
}

export function createViewFieldRec(this: ViewFieldRec, docModel: DocModel): void {
  this.viewSection = refRecord(docModel.viewSections, this.parentId);
  this.widthDef = modelUtil.fieldWithDefault(this.width, () => this.viewSection().defaultWidth());

  this.widthPx = ko.pureComputed(() => this.widthDef() + 'px');
  this.column = refRecord(docModel.columns, this.colRef);
  this.origCol = ko.pureComputed(() => this.column().origCol());
  this.colId = ko.pureComputed(() => this.column().colId());
  this.label = ko.pureComputed(() => this.column().label());

  // displayLabel displays label by default but switches to the more helpful colId whenever a
  // formula field in the view is being edited.
  this.displayLabel = modelUtil.savingComputed({
    read: () => docModel.editingFormula() ? '$' + this.origCol().colId() : this.origCol().label(),
    write: (setter, val) => setter(this.column().label, val)
  });

  // The field knows when we are editing a formula, so that all rows can reflect that.
  const _editingFormula = ko.observable(false);
  this.editingFormula = ko.pureComputed({
    read: () => _editingFormula(),
    write: val => {
      // Whenever any view field changes its editingFormula status, let the docModel know.
      docModel.editingFormula(val);
      _editingFormula(val);
    }
  });

  // CSS class to add to formula cells, incl. to show that we are editing this field's formula.
  this.formulaCssClass = ko.pureComputed<string|null>(() => {
    const col = this.column();
    return this.column().isTransforming() ? "transform_field" :
      (this.editingFormula() ? "formula_field_edit" :
        (col.isFormula() && col.formula() !== "" ? "formula_field" : null));
  });

  // The fields's display column
  this._displayColModel = refRecord(docModel.columns, this.displayCol);

  // Helper which adds/removes/updates this field's displayCol to match the formula.
  this.saveDisplayFormula = function(formula) {
    if (formula !== (this._displayColModel().formula() || '')) {
      return docModel.docData.sendAction(["SetDisplayFormula", this.column().table().tableId(),
        this.getRowId(), null, formula]);
    }
  };

  // Whether this field uses column's widgetOptions (true) or its own (false).
  // During transform, use the transform column's options (which should be initialized to match
  // field or column when the transform starts TODO).
  this.useColOptions = ko.pureComputed(() => !this.widgetOptions() || this.column().isTransforming());

  // Helper that returns the RowModel for either this field or its column, depending on
  // useColOptions. Field and Column have a few identical fields:
  //    .widgetOptions()        // JSON string of options
  //    .saveDisplayFormula()   // Method to save the display formula
  //    .displayCol()           // Reference to an optional associated display column.
  this._fieldOrColumn = ko.pureComputed(() => this.useColOptions() ? this.column() : this);

  // Display col ref to use for the field, defaulting to the plain column itself.
  this.displayColRef = ko.pureComputed(() => this._fieldOrColumn().displayCol() || this.colRef());

  this.visibleColRef = modelUtil.addSaveInterface(ko.pureComputed({
      read: () => this._fieldOrColumn().visibleCol(),
      write: (colRef) => this._fieldOrColumn().visibleCol(colRef),
    }),
    colRef => docModel.docData.bundleActions(null, async () => {
      const col = docModel.columns.getRowModel(colRef);
      await Promise.all([
        this._fieldOrColumn().visibleCol.saveOnly(colRef),
        this._fieldOrColumn().saveDisplayFormula(colRef ? `$${this.colId()}.${col.colId()}` : '')
      ]);
    })
  );

  // The display column to use for the field, or the column itself when no displayCol is set.
  this.displayColModel = refRecord(docModel.columns, this.displayColRef);
  this.visibleColModel = refRecord(docModel.columns, this.visibleColRef);

  // Helper for Reference columns, which returns a formatter according to the visibleCol
  // associated with this field. If no visible column available, return formatting for the field itself.
  // Subscribes to observables if used within a computed.
  // TODO: It would be better to replace this with a pureComputed whose value is a formatter.
  this.createVisibleColFormatter = function() {
    const vcol = this.visibleColModel();
    return (vcol.getRowId() !== 0) ?
      createFormatter(vcol.type(), vcol.widgetOptionsJson()) :
      createFormatter(this.column().type(), this.widgetOptionsJson());
  };

  // The widgetOptions to read and write: either the column's or the field's own.
  this._widgetOptionsStr = modelUtil.savingComputed({
    read: () => this._fieldOrColumn().widgetOptions(),
    write: (setter, val) => setter(this._fieldOrColumn().widgetOptions, val)
  });

  // Observable for the object with the current options, either for the field or for the column,
  // which takes into account the default options for this column's type.

  this.widgetOptionsJson = modelUtil.jsonObservable(this._widgetOptionsStr,
    (opts: any) => UserType.mergeOptions(opts || {}, this.column().pureType()));

  // Observable for the active filter that's initialized from the value saved to the server.
  this.activeFilter = modelUtil.customComputed({
    read: () => { const f = this.filter(); return f === 'null' ? '' : f; }, // To handle old empty filters
    save: (val) => this.filter.saveOnly(val),
  });

  this.isFiltered = Computed.create(this, fromKo(this.activeFilter), (_use, f) => f !== '');

  this.disableModify = ko.pureComputed(() => this.column().disableModify());
  this.disableEditData = ko.pureComputed(() => this.column().disableEditData());

  this.textColor = modelUtil.fieldWithDefault(
    this.widgetOptionsJson.prop('textColor') as modelUtil.KoSaveableObservable<string>, "#000000");

  const fillColorProp = this.widgetOptionsJson.prop('fillColor') as modelUtil.KoSaveableObservable<string>;
  // Store empty string in place of the default white color, so that we can keep it transparent in
  // GridView, to avoid interfering with zebra stripes.
  this.fillColor = modelUtil.savingComputed({
    read: () => fillColorProp(),
    write: (setter, val) => setter(fillColorProp, val === '#ffffff' ? '' : val),
  });
}
