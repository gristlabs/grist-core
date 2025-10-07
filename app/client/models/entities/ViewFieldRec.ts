import {ColumnRec, DocModel, IRowModel, refListRecords, refRecord, ViewSectionRec} from 'app/client/models/DocModel';
import {formatterForRec} from 'app/client/models/entities/ColumnRec';
import * as modelUtil from 'app/client/models/modelUtil';
import {removeRule, RuleOwner} from 'app/client/models/RuleOwner';
import {HeaderStyle, Style} from 'app/client/models/Styles';
import {ViewFieldConfig} from 'app/client/models/ViewFieldConfig';
import * as UserType from 'app/client/widgets/UserType';
import {DocumentSettings} from 'app/common/DocumentSettings';
import {DropdownCondition, DropdownConditionCompilationResult} from 'app/common/DropdownCondition';
import {compilePredicateFormula} from 'app/common/PredicateFormula';
import {BaseFormatter} from 'app/common/ValueFormatter';
import {createParser} from 'app/common/ValueParser';
import {Computed} from 'grainjs';
import * as ko from 'knockout';

// Represents a page entry in the tree of pages.
export interface ViewFieldRec extends IRowModel<"_grist_Views_section_field">, RuleOwner {
  viewSection: ko.Computed<ViewSectionRec>;
  widthDef: modelUtil.KoSaveableObservable<number>;
  docModel: DocModel;

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

  dropdownCondition: modelUtil.KoSaveableObservable<DropdownCondition|undefined>;
  dropdownConditionCompiled: Computed<DropdownConditionCompilationResult|null>;

  createValueParser(): (value: string) => any;

  // Helper which adds/removes/updates field's displayCol to match the formula.
  saveDisplayFormula(formula: string): Promise<void>|undefined;
}

function lazy(gen: any) {
  let value: any = undefined;

  return {
    get() {
      if (value === undefined) {
        console.log("Instantiating lazy property")
        value = gen.call(this);
      }
      return value;
    }
  };
}

const testProto = {};
Object.defineProperties(testProto, {
  viewSection: lazy(function(this: ViewFieldRec) {
    return refRecord(this.docModel.viewSections, this.parentId);
  }),
  widthDef: lazy(function(this: ViewFieldRec) {
    return modelUtil.fieldWithDefault(this.width, () => this.viewSection().defaultWidth());
  }),
  widthPx: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed(() => this.widthDef() + 'px'));
  }),
  column: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(refRecord(this.docModel.columns, this.colRef));
  }),
  origCol: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed(() => this.column().origCol()));
  }),
  pureType: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed(() => this.column().pureType()));
  }),
  colId: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed(() => this.column().colId()));
  }),
  label: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed(() => this.column().label()));
  }),
  origLabel: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed(() => this.origCol().label()));
  }),
  description: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(modelUtil.savingComputed({
      read: () => this.column().description(),
      write: (setter, val) => setter(this.column().description, val)
    }));
  }),
  // displayLabel displays label by default but switches to the more helpful colId whenever a
  // formula field in the view is being edited.
  displayLabel: lazy(function(this: ViewFieldRec) {
    return modelUtil.savingComputed({
      read: () => this.docModel.editingFormula() ? '$' + this.origCol().colId() : this.origCol().label(),
      write: (setter, val) => setter(this.column().label, val)
    });
  }),
  // The field knows when we are editing a formula, so that all rows can reflect that.
  editingFormula: lazy(function(this: ViewFieldRec) {
    const _editingFormula = ko.observable(false);
    return this.autoDispose(ko.pureComputed({
      read: () => _editingFormula(),
      write: val => {
        // Whenever any view field changes its editingFormula status, let the this.docModel know.
        this.docModel.editingFormula(val);
        _editingFormula(val);
      }
    }));
  }),
  // CSS class to add to formula cells, incl. to show that we are editing this field's formula.
  formulaCssClass: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed<string|null>(() => {
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
    }));
  }),
  // The fields's display column
  _displayColModel: lazy(function(this: ViewFieldRec) {
    return refRecord(this.docModel.columns, this.displayCol);
  }),
  // Whether this field uses column's widgetOptions (true) or its own (false).
  // During transform, use the transform column's options (which should be initialized to match
  // field or column when the transform starts TODO).
  useColOptions: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed(() => !this.widgetOptions() || this.column().isTransforming()));
  }),
  // Helper that returns the RowModel for either this field or its column, depending on
  // useColOptions. Field and Column have a few identical fields:
  //    .widgetOptions()        // JSON string of options
  //    .saveDisplayFormula()   // Method to save the display formula
  //    .displayCol()           // Reference to an optional associated display column.
  _fieldOrColumn: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed(() => this.useColOptions() ? this.column() : this));
  }),
  // Display col ref to use for the field, defaulting to the plain column itthis.
  displayColRef: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed(() => this._fieldOrColumn().displayCol() || this.colRef()));
  }),
  visibleColRef: lazy(function(this: ViewFieldRec) {
    return modelUtil.addSaveInterface(this.autoDispose(ko.pureComputed({
        read: () => this._fieldOrColumn().visibleCol(),
        write: (colRef) => this._fieldOrColumn().visibleCol(colRef),
      })),
      colRef => this.docModel.docData.bundleActions(null, async () => {
        const col = this.docModel.columns.getRowModel(colRef);
        await Promise.all([
          this._fieldOrColumn().visibleCol.saveOnly(colRef),
          this._fieldOrColumn().saveDisplayFormula(colRef ? `$${this.colId()}.${col.colId()}` : '')
        ]);
      }, {nestInActiveBundle: this.column.peek().isTransforming.peek()})
    );
  }),
  // The display column to use for the field, or the column itthis when no displayCol is set.
  displayColModel: lazy(function(this: ViewFieldRec) {
    return refRecord(this.docModel.columns, this.displayColRef);
  }),
  visibleColModel: lazy(function(this: ViewFieldRec) {
    return refRecord(this.docModel.columns, this.visibleColRef);
  }),
  // Helper for Reference/ReferenceList columns, which returns a formatter according to the visibleCol
  // associated with this field. If no visible column available, return formatting for the field itthis.
  visibleColFormatter: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(
      ko.pureComputed(() => formatterForRec(this, this.column(), this.docModel, 'vcol'))
    );
  }),
  formatter: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(
      ko.pureComputed(() => formatterForRec(this, this.column(), this.docModel, 'full'))
    );
  }),
  // The widgetOptions to read and write: either the column's or the field's own.
  _widgetOptionsStr: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(modelUtil.savingComputed({
      read: () => this._fieldOrColumn().widgetOptions(),
      write: (setter, val) => setter(this._fieldOrColumn().widgetOptions, val)
    }));
  }),
  documentSettings: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed(() => this.docModel.docInfoRow.documentSettingsJson()));
  }),
  style: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed({
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
    }));
  }),
  headerStyle: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed({
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
    }));
  }),
  tableId: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed(() => this.column().table().tableId()));
  }),
  rulesList: lazy(function(this: ViewFieldRec) {
    return modelUtil.savingComputed({
      read: () => this._fieldOrColumn().rules(),
      write: (setter, val) => setter(this._fieldOrColumn().rules, val)
    });
  }),
  rulesCols: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(
      refListRecords(this.docModel.columns, ko.pureComputed(() => this._fieldOrColumn().rules()))
    );
  }),
  rulesColsIds: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed(() => this.rulesCols().map(c => c.colId())));
  }),
  rulesStyles: lazy(function(this: ViewFieldRec) {
    return modelUtil.fieldWithDefault(
      this.widgetOptionsJson.prop("rulesOptions") as modelUtil.KoSaveableObservable<Style[]>,
      []);
  }),
  hasRules: lazy(function(this: ViewFieldRec) {
    return this.autoDispose(ko.pureComputed(() => this.rulesCols().length > 0));
  }),
  // Externalize widgetOptions configuration, to support changing those options
  // for multiple fields at once.
  config: lazy(function (this: ViewFieldRec) {
    return new ViewFieldConfig(this, this.docModel);
  }),
});

export function createViewFieldRec(this: ViewFieldRec, docModel: DocModel): void {
  const myself = this;
  this.docModel = docModel;

  Object.setPrototypeOf(testProto, Object.getPrototypeOf(this));
  Object.setPrototypeOf(this, testProto);


  // Helper which adds/removes/updates this field's displayCol to match the formula.
  myself.saveDisplayFormula = function(formula) {
    if (formula !== (this._displayColModel().formula() || '')) {
      return docModel.docData.sendAction(["SetDisplayFormula", this.column().table().tableId(),
        this.getRowId(), null, formula]);
    }
  };

  myself.createValueParser = function() {
    const fieldRef = this.useColOptions.peek() ? undefined : this.id.peek();
    const parser = createParser(docModel.docData, this.colRef.peek(), fieldRef);
    return parser.cleanParse.bind(parser);
  };


  // Observable for the object with the current options, either for the field or for the column,
  // which takes into account the default options for this column's type.
  myself.widgetOptionsJson = myself.autoDispose(modelUtil.jsonObservable(myself._widgetOptionsStr,
    (opts: any) => UserType.mergeOptions(opts || {}, myself.column().pureType())));

  // When user has yet to specify a desired wrapping state, we use different defaults for
  // GridView (no wrap) and DetailView (wrap).
  myself.wrap = myself.autoDispose(modelUtil.fieldWithDefault(
    myself.widgetOptionsJson.prop('wrap'),
    () => myself.viewSection().parentKey() !== 'record'
  ));
  myself.widget = myself.widgetOptionsJson.prop('widget');
  myself.textColor = myself.widgetOptionsJson.prop('textColor');
  myself.fillColor = myself.widgetOptionsJson.prop('fillColor');
  myself.fontBold = myself.widgetOptionsJson.prop('fontBold');
  myself.fontUnderline = myself.widgetOptionsJson.prop('fontUnderline');
  myself.fontItalic = myself.widgetOptionsJson.prop('fontItalic');
  myself.fontStrikethrough = myself.widgetOptionsJson.prop('fontStrikethrough');
  myself.headerTextColor = myself.widgetOptionsJson.prop('headerTextColor');
  myself.headerFillColor = myself.widgetOptionsJson.prop('headerFillColor');
  myself.headerFontBold = myself.widgetOptionsJson.prop('headerFontBold');
  myself.headerFontUnderline = myself.widgetOptionsJson.prop('headerFontUnderline');
  myself.headerFontItalic = myself.widgetOptionsJson.prop('headerFontItalic');
  myself.headerFontStrikethrough = myself.widgetOptionsJson.prop('headerFontStrikethrough');
  myself.question = myself.widgetOptionsJson.prop('question');


  // Helper method to add an empty rule (either initial or additional one).
  // Style options are added to widget options directly and can be briefly out of sync,
  // which is taken into account during rendering.
  myself.addEmptyRule = async () => {
    const useCol = myself.useColOptions.peek();
    const action = [
      'AddEmptyRule',
      myself.column.peek().table.peek().tableId.peek(),
      useCol ? 0 : myself.id.peek(), // field_ref
      useCol ? myself.column.peek().id.peek() : 0, // col_ref
    ];
    await docModel.docData.sendAction(action, `Update rules for ${myself.colId.peek()}`);
  };

  myself.removeRule = (index: number) => removeRule(docModel, myself, index);

  myself.disableModify = myself.autoDispose(ko.pureComputed(() => myself.column().disableModify()));
  myself.disableEditData = myself.autoDispose(ko.pureComputed(() => myself.column().disableEditData()));

  myself.dropdownCondition = myself.widgetOptionsJson.prop('dropdownCondition');
  myself.dropdownConditionCompiled = Computed.create(myself, use => {
    const dropdownCondition = use(myself.dropdownCondition);
    if (!dropdownCondition?.parsed) { return null; }

    try {
      return {
        kind: 'success',
        result: compilePredicateFormula(JSON.parse(dropdownCondition.parsed), {
          variant: 'dropdown-condition',
        }),
      };
    } catch (e) {
      return {kind: 'failure', error: e.message};
    }
  });
}
