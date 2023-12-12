import {ColumnRec, DocModel, IRowModel, refListRecords, refRecord, ViewSectionRec} from 'app/client/models/DocModel';
import {formatterForRec} from 'app/client/models/entities/ColumnRec';
import * as modelUtil from 'app/client/models/modelUtil';
import {removeRule, RuleOwner} from 'app/client/models/RuleOwner';
import { HeaderStyle, Style } from 'app/client/models/Styles';
import {ViewFieldConfig} from 'app/client/models/ViewFieldConfig';
import * as UserType from 'app/client/widgets/UserType';
import {DocumentSettings} from 'app/common/DocumentSettings';
import {BaseFormatter} from 'app/common/ValueFormatter';
import {createParser} from 'app/common/ValueParser';
import * as ko from 'knockout';

// Represents a page entry in the tree of pages.
export interface ViewFieldRec extends IRowModel<"_grist_Views_section_field">, RuleOwner {
  viewSection: ko.Computed<ViewSectionRec>;
  widthDef: modelUtil.KoSaveableObservable<number>;

  widthPx: ko.Computed<string>;
  column: ko.Computed<ColumnRec>;
  origLabel: ko.Computed<string>;
  origCol: ko.Computed<ColumnRec>;
  pureType: ko.Computed<string>;
  colId: ko.Computed<string>;
  label: ko.Computed<string>;
  description: modelUtil.KoSaveableObservable<string>;

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


  disableModify: ko.Computed<boolean>;
  disableEditData: ko.Computed<boolean>;

  // Whether lines should wrap in a cell.
  wrap: modelUtil.KoSaveableObservable<boolean>;
  widget: modelUtil.KoSaveableObservable<string|undefined>;
  textColor: modelUtil.KoSaveableObservable<string|undefined>;
  fillColor: modelUtil.KoSaveableObservable<string|undefined>;
  fontBold: modelUtil.KoSaveableObservable<boolean|undefined>;
  fontUnderline: modelUtil.KoSaveableObservable<boolean|undefined>;
  fontItalic: modelUtil.KoSaveableObservable<boolean|undefined>;
  fontStrikethrough: modelUtil.KoSaveableObservable<boolean|undefined>;
  headerTextColor: modelUtil.KoSaveableObservable<string|undefined>;
  headerFillColor: modelUtil.KoSaveableObservable<string|undefined>;
  headerFontBold: modelUtil.KoSaveableObservable<boolean|undefined>;
  headerFontUnderline: modelUtil.KoSaveableObservable<boolean|undefined>;
  headerFontItalic: modelUtil.KoSaveableObservable<boolean|undefined>;
  headerFontStrikethrough: modelUtil.KoSaveableObservable<boolean|undefined>;
  // Helper computed to change style of a cell and headerStyle without saving it.
  style: ko.PureComputed<Style>;
  headerStyle: ko.PureComputed<HeaderStyle>;

  config: ViewFieldConfig;

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

  /** Label in FormView. By default FormView uses label, use this to override it. */
  question: modelUtil.KoSaveableObservable<string|undefined>;

  createValueParser(): (value: string) => any;

  // Helper which adds/removes/updates field's displayCol to match the formula.
  saveDisplayFormula(formula: string): Promise<void>|undefined;
}

export function createViewFieldRec(this: ViewFieldRec, docModel: DocModel): void {
  this.viewSection = refRecord(docModel.viewSections, this.parentId);
  this.widthDef = modelUtil.fieldWithDefault(this.width, () => this.viewSection().defaultWidth());

  this.widthPx = this.autoDispose(ko.pureComputed(() => this.widthDef() + 'px'));
  this.column = this.autoDispose(refRecord(docModel.columns, this.colRef));
  this.origCol = this.autoDispose(ko.pureComputed(() => this.column().origCol()));
  this.pureType = this.autoDispose(ko.pureComputed(() => this.column().pureType()));
  this.colId = this.autoDispose(ko.pureComputed(() => this.column().colId()));
  this.label = this.autoDispose(ko.pureComputed(() => this.column().label()));
  this.origLabel = this.autoDispose(ko.pureComputed(() => this.origCol().label()));
  this.description = modelUtil.savingComputed({
    read: () => this.column().description(),
    write: (setter, val) => setter(this.column().description, val)
  });

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

    // If the current column is transforming, assign the CSS class "transform_field"
    if (col.isTransforming()) {
      if ( col.origCol().isFormula() && col.origCol().formula() !== "") {
        return "transform_field formula_field";
      }
      return "transform_field";
    }
    // If the column is not transforming but a formula is being edited
    else if (this.editingFormula()) {
      return "formula_field_edit";
    }
    // If a formula exists and it is not empty
    else if (col.isFormula() && col.formula() !== "") {
      return "formula_field";
    }
    // If none of the above conditions are met, assign null
    else {
      return null;
    }
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
  this.useColOptions = this.autoDispose(ko.pureComputed(() => !this.widgetOptions() || this.column().isTransforming()));

  // Helper that returns the RowModel for either this field or its column, depending on
  // useColOptions. Field and Column have a few identical fields:
  //    .widgetOptions()        // JSON string of options
  //    .saveDisplayFormula()   // Method to save the display formula
  //    .displayCol()           // Reference to an optional associated display column.
  this._fieldOrColumn = this.autoDispose(ko.pureComputed(() => this.useColOptions() ? this.column() : this));

  // Display col ref to use for the field, defaulting to the plain column itself.
  this.displayColRef = this.autoDispose(ko.pureComputed(() => this._fieldOrColumn().displayCol() || this.colRef()));

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
  this._widgetOptionsStr = this.autoDispose(modelUtil.savingComputed({
    read: () => this._fieldOrColumn().widgetOptions(),
    write: (setter, val) => setter(this._fieldOrColumn().widgetOptions, val)
  }));

  // Observable for the object with the current options, either for the field or for the column,
  // which takes into account the default options for this column's type.
  this.widgetOptionsJson = this.autoDispose(modelUtil.jsonObservable(this._widgetOptionsStr,
    (opts: any) => UserType.mergeOptions(opts || {}, this.column().pureType())));

  // When user has yet to specify a desired wrapping state, we use different defaults for
  // GridView (no wrap) and DetailView (wrap).
  this.wrap = this.autoDispose(modelUtil.fieldWithDefault(
    this.widgetOptionsJson.prop('wrap'),
    () => this.viewSection().parentKey() !== 'record'
  ));
  this.widget = this.widgetOptionsJson.prop('widget');
  this.textColor = this.widgetOptionsJson.prop('textColor');
  this.fillColor = this.widgetOptionsJson.prop('fillColor');
  this.fontBold = this.widgetOptionsJson.prop('fontBold');
  this.fontUnderline = this.widgetOptionsJson.prop('fontUnderline');
  this.fontItalic = this.widgetOptionsJson.prop('fontItalic');
  this.fontStrikethrough = this.widgetOptionsJson.prop('fontStrikethrough');
  this.headerTextColor = this.widgetOptionsJson.prop('headerTextColor');
  this.headerFillColor = this.widgetOptionsJson.prop('headerFillColor');
  this.headerFontBold = this.widgetOptionsJson.prop('headerFontBold');
  this.headerFontUnderline = this.widgetOptionsJson.prop('headerFontUnderline');
  this.headerFontItalic = this.widgetOptionsJson.prop('headerFontItalic');
  this.headerFontStrikethrough = this.widgetOptionsJson.prop('headerFontStrikethrough');
  this.question = this.widgetOptionsJson.prop('question');

  this.documentSettings = ko.pureComputed(() => docModel.docInfoRow.documentSettingsJson());
  this.style = ko.pureComputed({
    read: () => ({
      textColor: this.textColor(),
      fillColor: this.fillColor(),
      fontBold: this.fontBold(),
      fontUnderline: this.fontUnderline(),
      fontItalic: this.fontItalic(),
      fontStrikethrough: this.fontStrikethrough(),
    }) as Style,
    write: (style: Style) => {
      this.widgetOptionsJson.update(style);
    },
  });
  this.headerStyle = ko.pureComputed({
    read: () => ({
      headerTextColor: this.headerTextColor(),
      headerFillColor: this.headerFillColor(),
      headerFontBold: this.headerFontBold(),
      headerFontUnderline: this.headerFontUnderline(),
      headerFontItalic: this.headerFontItalic(),
      headerFontStrikethrough: this.headerFontStrikethrough(),
    }) as HeaderStyle,
    write: (headerStyle: HeaderStyle) => {
      this.widgetOptionsJson.update(headerStyle);
    },
  });

  this.tableId = ko.pureComputed(() => this.column().table().tableId());
  this.rulesList = ko.pureComputed(() => this._fieldOrColumn().rules());
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

  this.removeRule = (index: number) => removeRule(docModel, this, index);
  // Externalize widgetOptions configuration, to support changing those options
  // for multiple fields at once.
  this.config = new ViewFieldConfig(this, docModel);

  this.disableModify = this.autoDispose(ko.pureComputed(() => this.column().disableModify()));
  this.disableEditData = this.autoDispose(ko.pureComputed(() => this.column().disableEditData()));
}
