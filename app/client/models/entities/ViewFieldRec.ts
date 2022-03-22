import {ColumnRec, DocModel, IRowModel, refListRecords, refRecord, ViewSectionRec} from 'app/client/models/DocModel';
import {formatterForRec} from 'app/client/models/entities/ColumnRec';
import * as modelUtil from 'app/client/models/modelUtil';
import {Style} from 'app/client/models/Styles';
import * as UserType from 'app/client/widgets/UserType';
import {DocumentSettings} from 'app/common/DocumentSettings';
import {BaseFormatter} from 'app/common/ValueFormatter';
import {createParser} from 'app/common/ValueParser';
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

  // Whether lines should wrap in a cell.
  wrapping: ko.Computed<boolean>;

  disableModify: ko.Computed<boolean>;
  disableEditData: ko.Computed<boolean>;

  textColor: modelUtil.KoSaveableObservable<string|undefined>;
  fillColor: modelUtil.KoSaveableObservable<string>;

  computedColor: ko.Computed<string|undefined>;
  computedFill: ko.Computed<string>;

  documentSettings: ko.PureComputed<DocumentSettings>;

  // Helper for Reference/ReferenceList columns, which returns a formatter according
  // to the visibleCol associated with field.
  visibleColFormatter: ko.Computed<BaseFormatter>;

  // A formatter for values of this column.
  // The difference between visibleColFormatter and formatter is especially important for ReferenceLists:
  // `visibleColFormatter` is for individual elements of a list, sometimes hypothetical
  // (i.e. they aren't actually referenced but they exist in the visible column and are relevant to e.g. autocomplete)
  // `formatter` formats actual cell values, e.g. a whole list from the display column.
  formatter: ko.Computed<BaseFormatter>;

  // Field can have a list of conditional styling rules. Each style is a combination of a formula and options
  // that must by applied to a field. Style is persisted as a new hidden formula column and the list of such
  // columns is stored as Reference List property ('rules') in a field or column.
  // Rule for conditional style is a formula of the hidden column, style options are saved as JSON object in
  // a styleOptions field (in that hidden formula column).

  // If this field (or column) has a list of conditional styling rules.
  hasRules: ko.Computed<boolean>;
  // List of columns that are used as rules for conditional styles.
  rulesCols: ko.Computed<ColumnRec[]>;
  // List of columns ids that are used as rules for conditional styles.
  rulesColsIds: ko.Computed<string[]>;
  // List of styles used by conditional rules.
  rulesStyles: modelUtil.KoSaveableObservable<Style[]>;

  // Adds empty conditional style rule. Sets before sending to the server.
  addEmptyRule(): Promise<void>;
  // Removes one rule from the collection. Removes before sending update to the server.
  removeRule(index: number): Promise<void>;

  createValueParser(): (value: string) => any;

  // Helper which adds/removes/updates field's displayCol to match the formula.
  saveDisplayFormula(formula: string): Promise<void>|undefined;

  // Helper for Choice/ChoiceList columns, that saves widget options and renames values in a document
  // in one bundle
  updateChoices(renameMap: Record<string, string>, options: any): Promise<void>;
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
    }, {nestInActiveBundle: this.column.peek().isTransforming.peek()})
  );

  // The display column to use for the field, or the column itself when no displayCol is set.
  this.displayColModel = refRecord(docModel.columns, this.displayColRef);
  this.visibleColModel = refRecord(docModel.columns, this.visibleColRef);

  // Helper for Reference/ReferenceList columns, which returns a formatter according to the visibleCol
  // associated with this field. If no visible column available, return formatting for the field itself.
  this.visibleColFormatter = ko.pureComputed(() => formatterForRec(this, this.column(), docModel, 'vcol'));

  this.formatter = ko.pureComputed(() => formatterForRec(this, this.column(), docModel, 'full'));

  this.createValueParser = function() {
    const fieldRef = this.useColOptions.peek() ? undefined : this.id.peek();
    const parser = createParser(docModel.docData, this.colRef.peek(), fieldRef);
    return parser.cleanParse.bind(parser);
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

  this.wrapping = ko.pureComputed(() => {
    // When user has yet to specify a desired wrapping state, we use different defaults for
    // GridView (no wrap) and DetailView (wrap).
    // "??" is the newish "nullish coalescing" operator. How cool is that!
    return this.widgetOptionsJson().wrap ?? (this.viewSection().parentKey() !== 'record');
  });

  this.disableModify = ko.pureComputed(() => this.column().disableModify());
  this.disableEditData = ko.pureComputed(() => this.column().disableEditData());

  this.textColor = this.widgetOptionsJson.prop('textColor') as modelUtil.KoSaveableObservable<string>;

  const fillColorProp = modelUtil.fieldWithDefault(
    this.widgetOptionsJson.prop('fillColor') as modelUtil.KoSaveableObservable<string>, "#FFFFFF00");
  // Store empty string in place of the default white color, so that we can keep it transparent in
  // GridView, to avoid interfering with zebra stripes.
  this.fillColor = modelUtil.savingComputed({
    read: () => fillColorProp(),
    write: (setter, val) => setter(fillColorProp, val?.toUpperCase() === '#FFFFFF' ? '' : (val ?? '')),
  });

  this.documentSettings = ko.pureComputed(() => docModel.docInfoRow.documentSettingsJson());

  this.updateChoices = async (renames, widgetOptions) => {
    // In case this column is being transformed - using Apply Formula to Data, bundle the action
    // together with the transformation.
    const actionOptions = {nestInActiveBundle: this.column.peek().isTransforming.peek()};
    const hasRenames = !!Object.entries(renames).length;
    const callback = async () => {
      await Promise.all([
        this.widgetOptionsJson.setAndSave(widgetOptions),
        hasRenames ?
          docModel.docData.sendAction(["RenameChoices", this.column().table().tableId(), this.colId(), renames]) :
          null
      ]);
    };
    return docModel.docData.bundleActions("Update choices configuration", callback, actionOptions);
  };

  this.rulesCols = refListRecords(docModel.columns, ko.pureComputed(() => this._fieldOrColumn().rules()));
  this.rulesColsIds = ko.pureComputed(() => this.rulesCols().map(c => c.colId()));
  this.rulesStyles = modelUtil.fieldWithDefault(
    this.widgetOptionsJson.prop("rulesOptions") as modelUtil.KoSaveableObservable<Style[]>,
    []);
  this.hasRules = ko.pureComputed(() => this.rulesCols().length > 0);

  // Helper method to add an empty rule (either initial or additional one).
  // Style options are added to widget options directly and can be briefly out of sync,
  // which is taken into account during rendering.
  this.addEmptyRule = async () => {
    const useCol = this.useColOptions.peek();
    const action = [
      'AddEmptyRule',
      this.column.peek().table.peek().tableId.peek(),
      useCol ? 0 : this.id.peek(), // field_ref
      useCol ? this.column.peek().id.peek() : 0, // col_ref
    ];
    await docModel.docData.sendAction(action, `Update rules for ${this.colId.peek()}`);
  };

  // Helper method to remove a rule.
  this.removeRule = async (index: number) => {
    const col = this.rulesCols.peek()[index];
    if (!col) {
      throw new Error(`There is no rule at index ${index}`);
    }
    const tableData = docModel.dataTables[col.table.peek().tableId.peek()].tableData;
    const newStyles = this.rulesStyles.peek().slice();
    if (newStyles.length >= index) {
      newStyles.splice(index, 1);
    } else {
      console.debug(`There are not style options at index ${index}`);
    }
    const callback = () =>
      Promise.all([
        this.rulesStyles.setAndSave(newStyles),
        tableData.sendTableAction(['RemoveColumn', col.colId.peek()])
      ]);
    const actionOptions = {nestInActiveBundle: this.column.peek().isTransforming.peek()};
    await docModel.docData.bundleActions("Remove conditional rule", callback, actionOptions);
  };
}
