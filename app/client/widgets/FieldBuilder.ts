import { ColumnTransform } from 'app/client/components/ColumnTransform';
import { Cursor } from 'app/client/components/Cursor';
import { FormulaTransform } from 'app/client/components/FormulaTransform';
import { GristDoc } from 'app/client/components/GristDoc';
import { addColTypeSuffix, guessWidgetOptionsSync } from 'app/client/components/TypeConversion';
import { TypeTransform } from 'app/client/components/TypeTransform';
import { FloatingEditor } from 'app/client/widgets/FloatingEditor';
import { UnsavedChange } from 'app/client/components/UnsavedChanges';
import dom from 'app/client/lib/dom';
import { KoArray } from 'app/client/lib/koArray';
import * as kd from 'app/client/lib/koDom';
import * as kf from 'app/client/lib/koForm';
import * as koUtil from 'app/client/lib/koUtil';
import { makeT } from 'app/client/lib/localization';
import { reportError } from 'app/client/models/AppModel';
import { DataRowModel } from 'app/client/models/DataRowModel';
import { ColumnRec, DocModel, ViewFieldRec } from 'app/client/models/DocModel';
import { SaveableObjObservable, setSaveValue } from 'app/client/models/modelUtil';
import { CombinedStyle, Style } from 'app/client/models/Styles';
import { COMMENTS } from 'app/client/models/features';
import { FieldSettingsMenu } from 'app/client/ui/FieldMenus';
import { cssBlockedCursor, cssLabel, cssRow } from 'app/client/ui/RightPanelStyles';
import { textButton } from 'app/client/ui2018/buttons';
import { buttonSelect, cssButtonSelect } from 'app/client/ui2018/buttonSelect';
import { IOptionFull, menu, select } from 'app/client/ui2018/menus';
import { DiffBox } from 'app/client/widgets/DiffBox';
import { buildErrorDom } from 'app/client/widgets/ErrorDom';
import { FieldEditor, saveWithoutEditor } from 'app/client/widgets/FieldEditor';
import { CellDiscussionPopup, EmptyCell } from 'app/client/widgets/DiscussionEditor';
import { openFormulaEditor } from 'app/client/widgets/FormulaEditor';
import { NewAbstractWidget } from 'app/client/widgets/NewAbstractWidget';
import { NewBaseEditor } from "app/client/widgets/NewBaseEditor";
import * as UserType from 'app/client/widgets/UserType';
import * as UserTypeImpl from 'app/client/widgets/UserTypeImpl';
import * as gristTypes from 'app/common/gristTypes';
import { getReferencedTableId, isFullReferencingType } from 'app/common/gristTypes';
import { WidgetType } from 'app/common/widgetTypes';
import { CellValue } from 'app/plugin/GristData';
import { bundleChanges, Computed, Disposable, fromKo,
         dom as grainjsDom, makeTestId, MultiHolder, Observable, styled, toKo } from 'grainjs';
import isEqual from 'lodash/isEqual';
import * as ko from 'knockout';
import * as _ from 'underscore';
import * as commands from "../components/commands";

const testId = makeTestId('test-fbuilder-');
const t = makeT('FieldBuilder');


// Creates a FieldBuilder object for each field in viewFields
export function createAllFieldWidgets(gristDoc: GristDoc, viewFields: ko.Computed<KoArray<ViewFieldRec>>,
                                      cursor: Cursor, options: { isPreview?: boolean } = {}) {
  // TODO: Handle disposal from the map when fields are removed.
  return viewFields().map(function(field) {
    return new FieldBuilder(gristDoc, field, cursor, options);
  }).setAutoDisposeValues();
}

/**
 * Returns the appropriate object from UserType.typeDefs, defaulting to Text for unknown types.
 */
function getTypeDefinition(type: string | false) {
  if (!type) { return UserType.typeDefs.Text; }
  return UserType.typeDefs[type] || UserType.typeDefs.Text;
}

type ComputedStyle = {style?: Style; error?: true} | null | undefined;

/**
 * Builds a font option computed property.
 */
function buildFontOptions(
  builder: FieldBuilder,
  computedRule: ko.Computed<ComputedStyle>,
  optionName: keyof Style) {

  return koUtil.withKoUtils(ko.computed(() => {
    if (builder.isDisposed()) { return false; }
    const style = computedRule()?.style;
    const styleFlag = style?.[optionName] || builder.field[optionName]();
    return styleFlag;
  })).onlyNotifyUnequal();
}

/**
 * Creates an instance of FieldBuilder.  Used to create all column configuration DOMs, cell DOMs,
 * and cell editor DOMs for all Grist Types.
 * @param {Object} field - The field for which the DOMs are to be created.
 * @param {Object} cursor - The cursor object, used to get the cursor position while saving values.
 */
export class FieldBuilder extends Disposable {
  public columnTransform: ColumnTransform | null;
  public readonly origColumn: ColumnRec;
  public readonly options: SaveableObjObservable<any>;
  public readonly widget: ko.PureComputed<any>;
  public readonly isCallPending: ko.Observable<boolean>;
  public readonly widgetImpl: ko.Computed<NewAbstractWidget>;
  public readonly diffImpl: NewAbstractWidget;

  private readonly _availableTypes: Computed<Array<IOptionFull<string>>>;
  private readonly _readOnlyPureType: ko.PureComputed<string>;
  private readonly _isRightType: ko.PureComputed<(value: CellValue, options?: any) => boolean>;
  private readonly _refTableId: ko.Computed<string | null>;
  private readonly _isRef: ko.Computed<boolean>;
  private readonly _rowMap: Map<DataRowModel, Element>;
  private readonly _isTransformingFormula: ko.Computed<boolean>;
  private readonly _isTransformingType: ko.Computed<boolean>;
  private readonly _widgetCons: ko.Computed<{create: (...args: any[]) => NewAbstractWidget}>;
  private readonly _docModel: DocModel;
  private readonly _readonly: Computed<boolean>;
  private readonly _comments: ko.Computed<boolean>;
  private readonly _showRefConfigPopup: ko.Observable<boolean>;
  private readonly _isEditorActive = Observable.create(this, false);



  public constructor(public readonly gristDoc: GristDoc, public readonly field: ViewFieldRec,
                     private _cursor: Cursor, private _options: { isPreview?: boolean } = {}) {
    super();

    this._docModel = gristDoc.docModel;
    this.origColumn = field.origCol();
    this.options = field.widgetOptionsJson;
    this._comments = ko.pureComputed(() => toKo(ko, COMMENTS())());

    this._readOnlyPureType = ko.pureComputed(() => this.field.column().pureType());

    this._readonly = Computed.create(this, (use) =>
      use(gristDoc.isReadonly) || use(field.disableEditData) || Boolean(this._options.isPreview));

    // Observable with a list of available types.
    this._availableTypes = Computed.create(this, (use) => {
      const isForm = use(use(this.field.viewSection).widgetType) === WidgetType.Form;
      const isFormula = use(this.origColumn.isFormula);
      const types: Array<IOptionFull<string>> = [];
      _.each(UserType.typeDefs, (def: any, key: string|number) => {
        if (isForm && key === 'Attachments') {
          // Attachments in forms are currently unsupported.
          return;
        }

        const o: IOptionFull<string> = {
          value: key as string,
          label: def.label,
          icon: def.icon
        };
        if (key === 'Any') {
          // User is unable to select the Any type in non-formula columns.
          o.disabled = !isFormula;
        }
        types.push(o);
      });
      return types;
    });

    // Observable which evaluates to a *function* that decides if a value is valid.
    this._isRightType = ko.pureComputed<(value: CellValue, options?: any) => boolean>(() => {
      return gristTypes.isRightType(this._readOnlyPureType()) || _.constant(false);
    });

    // Returns a boolean indicating whether the column is type Reference or ReferenceList.
    this._isRef = this.autoDispose(ko.computed(() => {
      const type = this.field.column().type();
      return type !== "Attachments" && isFullReferencingType(type);
    }));

    // Gives the table ID to which the reference points.
    this._refTableId = this.autoDispose(ko.computed({
      read: () => getReferencedTableId(this.field.column().type()),
      write: val => {
        const type = this.field.column().type();
        if (type.startsWith('Ref:')) {
          this._setType(`Ref:${val}`);
        } else {
          this._setType(`RefList:${val}`);
        }
      }
    }));

    this.widget = ko.pureComputed(() => this.field.widget());

    // Whether there is a pending call that transforms column.
    this.isCallPending = ko.observable(false);

    // Maintains an instance of the transform object if the field is currently being transformed,
    // and null if not. Gets disposed along with the transform menu dom.
    this.columnTransform = null;

    // Returns a boolean indicating whether a formula transform is in progress.
    this._isTransformingFormula = this.autoDispose(ko.computed(() => {
      return this.field.column().isTransforming() && this.columnTransform instanceof FormulaTransform;
    }));
    // Returns a boolean indicating whether a type transform is in progress.
    this._isTransformingType = this.autoDispose(ko.computed(() => {
      return (this.field.column().isTransforming() || this.isCallPending()) &&
        (this.columnTransform instanceof TypeTransform);
    }));

    // Map from rowModel to cell dom for the field to which this fieldBuilder applies.
    this._rowMap = new Map();

    // Returns the constructor for the widget, and only notifies subscribers on changes.
    this._widgetCons = this.autoDispose(koUtil.withKoUtils(ko.computed(() => {
      return UserTypeImpl.getWidgetConstructor(this.options().widget,
                                               this._readOnlyPureType());
    })).onlyNotifyUnequal());

    // Computed builder for the widget.
    this.widgetImpl = this.autoDispose(koUtil.computedBuilder(() => {
      const cons = this._widgetCons();
      // Must subscribe to `colId` so that field.colId is rechecked on transform.
      return cons.create.bind(cons, this.field, this.field.colId());
    }, this).extend({ deferred: true }));

    this.diffImpl = this.autoDispose(DiffBox.create(this.field));

    this._showRefConfigPopup = ko.observable(false);

    this.autoDispose(commands.createGroup({
      showPopup: (args: any) => {
        if(args.popup==='referenceColumnsConfig'){
          this._showRefConfigPopup(true);
        }
      }
    }, this, true));
  }

  public buildSelectWidgetDom() {
    return grainjsDom.maybe((use) => !use(this._isTransformingType) && use(this._readOnlyPureType), type => {
      const typeWidgets = getTypeDefinition(type).widgets;
      const widgetOptions = Object.keys(typeWidgets).map(label => ({
        label,
        value: label,
        icon: typeWidgets[label].icon
      }));
      if (widgetOptions.length <= 1) { return null; }
      // Here we need to accommodate the fact that the widget can be null, which
      // won't be visible on a select component when disabled.
      const defaultWidget = Computed.create(null, use => {
        if (widgetOptions.length <= 2) {
          return;
        }
        const value = use(this.field.config.widget);
        return value;
      });
      defaultWidget.onWrite((value) => this.field.config.widget(value));
      const disabled = Computed.create(null, use => !use(this.field.config.sameWidgets));
      return [
        cssLabel(t('CELL FORMAT')),
        cssRow(
          grainjsDom.autoDispose(defaultWidget),
          widgetOptions.length <= 2 ?
            buttonSelect(
              fromKo(this.field.config.widget),
              widgetOptions,
              cssButtonSelect.cls("-disabled", disabled),
            ) :
            select(
              defaultWidget,
              widgetOptions,
              {
                disabled,
                defaultLabel: t('Mixed format')
              }
            ),
          testId('widget-select')
        )
      ];
    });
  }

  /**
   * Build the type change dom.
   */
  public buildSelectTypeDom() {
    const holder = new MultiHolder();
    const commonType = Computed.create(holder, use => use(use(this.field.viewSection).columnsType));
    const selectType = Computed.create(holder, (use) => {
      const myType = use(fromKo(this._readOnlyPureType));
      return use(commonType) === 'mixed' ? '' : myType;
    });
    selectType.onWrite(newType => {
      const sameType = newType === this._readOnlyPureType.peek();
      if (!sameType || commonType.get() === 'mixed') {
        if (['Ref', 'RefList'].includes(newType)) {
          this._showRefConfigPopup(true);
        }
        return this._setType(newType);
      }
    });
    const onDispose = () => (this.isDisposed() || selectType.set(this.field.column().pureType()));
    const allFormulas = Computed.create(holder, use => use(use(this.field.viewSection).columnsAllIsFormula));
    return [
      cssRow(
        grainjsDom.autoDispose(holder),
        select(selectType, this._availableTypes, {
          disabled: (use) =>
            // If we are transforming column at this moment (applying a formula to change data),
            use(this._isTransformingFormula) ||
            // If this is a summary column
            use(this.origColumn.disableModifyBase) ||
            // If there are multiple column selected, but all have different type than Any.
            (use(this.field.config.multiselect) && !use(allFormulas)) ||
            // If we are waiting for a server response
            use(this.isCallPending),
          menuCssClass: cssTypeSelectMenu.className,
          defaultLabel: t('Mixed types'),
          renderOptionArgs: (op) => {
            if (['Ref', 'RefList'].includes(selectType.get())) {
              // Don't show tip if a reference column type is already selected.
              return;
            }

            if (op.label === 'Reference') {
              return this.gristDoc.behavioralPromptsManager.attachPopup('referenceColumns', {
                popupOptions: {
                  attach: `.${cssTypeSelectMenu.className}`,
                  placement: 'left-start',
                }
              });
            } else {
              return null;
            }
          }
        }),
        testId('type-select'),
        grainjsDom.cls('tour-type-selector'),
        grainjsDom.cls(cssBlockedCursor.className, use =>
          use(this.origColumn.disableModifyBase) ||
          use(this._isTransformingFormula) ||
          (use(this.field.config.multiselect) && !use(allFormulas))
        ),
      ),
      grainjsDom.maybe((use) => use(this._isRef) && !use(this._isTransformingType), () => this._buildRefTableSelect()),
      grainjsDom.maybe(this._isTransformingType, () => {
        // Editor dom must be built before preparing transform.
        return dom('div.type_transform_prompt',
                   kf.prompt(
                     dom('div',
                         grainjsDom.maybe(this._isRef, () => this._buildRefTableSelect()),
                         grainjsDom.maybe((use) => use(this.field.column().isTransforming),
                                          () => this.columnTransform!.buildDom())
                     )
                   ),
                   grainjsDom.onDispose(onDispose)
        );
      })
    ];
  }

  // Helper function to set the column type to newType.
  public _setType(newType: string): void {
    // If the original column is a formula, we won't be showing any transform UI, so we can
    // just set the type directly. We test original column as this field might be in the middle
    // of transformation and temporary be connected to a helper column (but formula columns are
    // never transformed using UI).
    if (this.origColumn.isFormula()) {
      // Do not type transform a new/empty column or a formula column. Just make a best guess for
      // the full type, and set it. If multiple columns are selected (and all are formulas/empty),
      // then we will set the type for all of them using full type guessed from the first column.
      const column = this.field.column(); // same as this.origColumn.
      const calculatedType = addColTypeSuffix(newType, column, this._docModel);
      const fields = this.field.viewSection.peek().selectedFields.peek();
      // If we selected multiple empty/formula columns, make the change for all of them.
      if (
        fields.length > 1 &&
        fields.every(f => f.column.peek().isFormula() || f.column.peek().isEmpty())
      ) {
        this.gristDoc.docData.bundleActions(t("Changing multiple column types"), () =>
          Promise.all(this.field.viewSection.peek().selectedFields.peek().map(f =>
            f.column.peek().type.setAndSave(calculatedType)
        ))).catch(reportError);
      } else if (column.pureType() === 'Any') {
        // If this is Any column, guess the final options.
        const guessedOptions = guessWidgetOptionsSync({
          docModel: this._docModel,
          origCol: this.origColumn,
          toTypeMaybeFull: newType,
        });
        const existingOptions = column.widgetOptionsJson.peek();
        const widgetOptions = JSON.stringify({...existingOptions, ...guessedOptions});
        bundleChanges(() => {
          this.gristDoc.docData.bundleActions(t("Changing column type"), () =>
            Promise.all([
              // This order is better for any other UI modifications, as first we are updating options
              // and then saving type.
              !isEqual(existingOptions, guessedOptions)
                ? column.widgetOptions.setAndSave(widgetOptions)
                : Promise.resolve(),
                column.type.setAndSave(calculatedType),
            ])
          ).catch(reportError);
        });
      } else {
        column.type.setAndSave(calculatedType).catch(reportError);
      }
    } else if (!this.columnTransform) {
      this.columnTransform = TypeTransform.create(null, this.gristDoc, this);
      this.columnTransform.prepare(newType).catch(reportError);
    } else {
      if (this.columnTransform instanceof TypeTransform) {
        this.columnTransform.setType(newType).catch(reportError);
      }
    }
  }

  // Builds the reference type table selector. Built when the column is type reference.
  public _buildRefTableSelect() {
    const allTables = Computed.create(null, (use) =>
                                      use(this._docModel.visibleTables.getObservable()).map(tableRec => ({
                                        value: use(tableRec.tableId),
                                        label: use(tableRec.tableNameDef),
                                        icon: 'FieldTable' as const
                                      }))
                                     );
    const isDisabled = Computed.create(null, use => {
      return use(this.origColumn.disableModifyBase) || use(this.field.config.multiselect);
    });
    return [
      cssLabel(t('DATA FROM TABLE'),
        kd.maybe(this._showRefConfigPopup, () => {
            return dom('div', this.gristDoc.behavioralPromptsManager.attachPopup(
              'referenceColumnsConfig',
              {
                onDispose: () => this._showRefConfigPopup(false),
                popupOptions: {
                  placement: 'left-start',
                },
              }
            ));
          },
        ),
      ),
      cssRow(
        dom.autoDispose(allTables),
        dom.autoDispose(isDisabled),
        select(fromKo(this._refTableId), allTables, {
          // Disallow changing the destination table when the column should not be modified
          // (specifically when it's a group-by column of a summary table).
          disabled: isDisabled,
        }),
        testId('ref-table-select')
      )
    ];
  }

  /**
   * Build the formula transform dom
   */
  public buildTransformDom() {
    const transformButton = ko.computed({
      read: () => this.field.column().isTransforming(),
      write: val => {
        if (val) {
          this.columnTransform = FormulaTransform.create(null, this.gristDoc, this);
          return this.columnTransform.prepare();
        } else {
          return this.columnTransform && this.columnTransform.cancel();
        }
      }
    });
    return dom('div',
               dom.autoDispose(transformButton),
               dom.onDispose(() => {
                 // When losing focus, if there's an active column transform, finalize it.
                 if (this.columnTransform) {
                   this.columnTransform.finalize().catch(reportError);
                 }
               }),
               cssRow(
                 textButton(t('Apply Formula to Data'),
                 dom.on('click', () => transformButton(true)),
                 kd.hide(this._isTransformingFormula),
                 kd.boolAttr('disabled', () =>
                   this._isTransformingType() ||
                   this.origColumn.isFormula() ||
                   this.origColumn.disableModifyBase() ||
                   this.field.config.multiselect()),
                 dom.testId("FieldBuilder_editTransform"),
                 testId('edit-transform'),
               )),
               kd.maybe(this._isTransformingFormula, () => {
                 return this.columnTransform!.buildDom();
               })
    );
  }

  /**
   * Builds the FieldBuilder Options Config DOM. Calls the buildConfigDom function of its widgetImpl.
   */
  public buildConfigDom() {
    // NOTE: adding a grainjsDom .maybe here causes the disposable order of the widgetImpl and
    // the dom created by the widgetImpl to get out of sync.
    return dom('div',
      kd.maybe(() => !this._isTransformingType() && this.widgetImpl(), (widget: NewAbstractWidget) =>
        dom('div', widget.buildConfigDom())
      )
    );
  }

  public buildColorConfigDom() {
    // NOTE: adding a grainjsDom .maybe here causes the disposable order of the widgetImpl and
    // the dom created by the widgetImpl to get out of sync.
    return dom('div',
      kd.maybe(() => !this._isTransformingType() && this.widgetImpl(), (widget: NewAbstractWidget) =>
        dom('div', widget.buildColorConfigDom(this.gristDoc))
      )
    );
  }

  public buildFormConfigDom() {
    return dom('div',
      kd.maybe(() => !this._isTransformingType() && this.widgetImpl(), (widget: NewAbstractWidget) =>
        dom('div', widget.buildFormConfigDom())
      )
    );
  }

  /**
   * Builds the FieldBuilder Options Config DOM. Calls the buildConfigDom function of its widgetImpl.
   */
  public buildSettingOptions() {
    // NOTE: adding a grainjsDom .maybe here causes the disposable order of the widgetImpl and
    // the dom created by the widgetImpl to get out of sync.
    return dom('div',
      kd.maybe(() => !this._isTransformingType() && this.widgetImpl(), (widget: NewAbstractWidget) =>
        dom('div',
          // If there is more than one field for this column (i.e. present in multiple views).
          kd.maybe(() => this.origColumn.viewFields().all().length > 1, () =>
            dom('div.fieldbuilder_settings',
              kf.row(
                kd.toggleClass('fieldbuilder_settings_header', true),
                kf.label(
                  dom('div.fieldbuilder_settings_button',
                      dom.testId('FieldBuilder_settings'),
                      kd.text(() => this.field.useColOptions() ? 'Common' : 'Separate'), ' ▾',
                      menu(() => FieldSettingsMenu(
                        this.field.useColOptions(),
                        this.field.viewSection().isRaw(),
                        {
                          useSeparate: () => this.fieldSettingsUseSeparate(),
                          saveAsCommon: () => this.fieldSettingsSaveAsCommon(),
                          revertToCommon: () => this.fieldSettingsRevertToCommon(),
                        },
                      )),
                    ),
                  'Field in ',
                  kd.text(() => this.origColumn.viewFields().all().length),
                  ' views'
                )
              )
            )
          )
        )
      )
    );
  }

  public fieldSettingsUseSeparate() {
    return this.gristDoc.docData.bundleActions(
      t("Use separate field settings for {{colId}}", { colId: this.origColumn.colId() }), () => {
        return Promise.all([
          setSaveValue(this.field.widgetOptions, this.field.column().widgetOptions() || "{}"),
          setSaveValue(this.field.visibleCol, this.field.column().visibleCol()),
          this.field.saveDisplayFormula(this.field.column()._displayColModel().formula() || '')
        ]);
      }
    );
  }

  public fieldSettingsSaveAsCommon() {
    return this.gristDoc.docData.bundleActions(
      t("Save field settings for {{colId}} as common", { colId: this.origColumn.colId() }), () => {
        return Promise.all([
          setSaveValue(this.field.column().widgetOptions, this.field.widgetOptions()),
          setSaveValue(this.field.column().visibleCol, this.field.visibleCol()),
          this.field.column().saveDisplayFormula(this.field._displayColModel().formula() || ''),
          setSaveValue(this.field.widgetOptions, ''),
          setSaveValue(this.field.visibleCol, 0),
          this.field.saveDisplayFormula('')
        ]);
      }
    );
  }

  public fieldSettingsRevertToCommon() {
    return this.gristDoc.docData.bundleActions(
      t("Revert field settings for {{colId}} to common", { colId: this.origColumn.colId() }), () => {
        return Promise.all([
          setSaveValue(this.field.widgetOptions, ''),
          setSaveValue(this.field.visibleCol, 0),
          this.field.saveDisplayFormula('')
        ]);
      }
    );
  }

  /**
   * Builds the cell and editor DOM for the chosen UserType. Calls the buildDom and
   *  buildEditorDom functions of its widgetImpl.
   */
  public buildDomWithCursor(row: DataRowModel, isActive: ko.Computed<boolean>, isSelected: ko.Computed<boolean>) {
    const computedFlags = koUtil.withKoUtils(ko.pureComputed(() => {
      return this.field.rulesColsIds().map(colRef => row.cells[colRef]?.() ?? false);
    }, this).extend({ deferred: true }));
    // Here we are using computedWithPrevious helper, to return
    // the previous value of computed rule. When user adds or deletes
    // rules there is a brief moment that rule is still not evaluated
    // (rules.length != value.length), in this case return last value
    // and wait for the update.
    const computedRule = koUtil.withKoUtils(ko.pureComputed<ComputedStyle>(() => {
      if (this.isDisposed()) { return null; }
      // If this is add row or a blank row (not loaded yet with all fields = '')
      // don't use rules.
      if (row._isAddRow() || !row.id()) { return null; }
      const styles: Style[] = this.field.rulesStyles();
      // Make sure that rules where computed.
      if (!Array.isArray(styles) || styles.length === 0) { return null; }
      const flags = computedFlags();
      // Make extra sure that all rules are up to date.
      // If not, fallback to the previous value.
      // We need to make sure that all rules columns are created,
      // sometimes there are more styles for a brief moment.
      if (styles.length < flags.length) { return/* undefined */; }
      // We will combine error information in the same computed value.
      // If there is an error in rules - return it instead of the style.
      const error = flags.some(f => !gristTypes.isValidRuleValue(f));
      if (error) {
        return { error };
      }
      // Combine them into a single style option.
      return { style : new CombinedStyle(styles, flags) };
    }, this).extend({ deferred: true })).previousOnUndefined();

    const widgetObs = koUtil.withKoUtils(ko.computed(() => {
      // TODO: Accessing row values like this doesn't always work (row and field might not be updated
      // simultaneously).
      if (this.isDisposed()) { return null; }   // Work around JS errors during field removal.
      const value = row.cells[this.field.colId()];
      const cell = value && value();
      if ((value as any) && this._isRightType()(cell, this.options) || row._isAddRow.peek()) {
        return this.widgetImpl();
      } else if (gristTypes.isVersions(cell)) {
        return this.diffImpl;
      } else {
        return null;
      }
    }).extend({ deferred: true })).onlyNotifyUnequal();

    const ruleText = koUtil.withKoUtils(ko.computed(() => {
      if (this.isDisposed()) { return null; }
      return computedRule()?.style?.textColor || '';
    })).onlyNotifyUnequal();

    const ruleFill = koUtil.withKoUtils(ko.computed(() => {
      if (this.isDisposed()) { return null; }
      return notTransparent(computedRule()?.style?.fillColor || '');
    })).onlyNotifyUnequal();

    const fontBold = buildFontOptions(this, computedRule, 'fontBold');
    const fontItalic = buildFontOptions(this, computedRule, 'fontItalic');
    const fontUnderline = buildFontOptions(this, computedRule, 'fontUnderline');
    const fontStrikethrough = buildFontOptions(this, computedRule, 'fontStrikethrough');

    const errorInStyle = ko.pureComputed(() => Boolean(computedRule()?.error));

    const cellText = ko.pureComputed(() => this.field.textColor() || '');
    const cellFill = ko.pureComputed(() => notTransparent(this.field.fillColor() || ''));

    const hasComment = koUtil.withKoUtils(ko.computed(() => {
      if (this.isDisposed()) { return false; }   // Work around JS errors during field removal.
      if (!this._comments()) { return false; }
      if (this.gristDoc.isReadonlyKo()) { return false; }
      const rowId = row.id();
      const discussion = this.field.column().cells().all()
        .find(d =>
          d.rowId() === rowId
          && !d.resolved()
          && d.type() === gristTypes.CellInfoType.COMMENT
          && !d.hidden()
          && d.root());
      return Boolean(discussion);
    }).extend({ deferred: true })).onlyNotifyUnequal();

    const domHolder = new MultiHolder();
    domHolder.autoDispose(hasComment);
    domHolder.autoDispose(widgetObs);
    domHolder.autoDispose(computedFlags);
    domHolder.autoDispose(errorInStyle);
    domHolder.autoDispose(cellText);
    domHolder.autoDispose(cellFill);
    domHolder.autoDispose(computedRule);
    domHolder.autoDispose(fontBold);
    domHolder.autoDispose(fontItalic);
    domHolder.autoDispose(fontUnderline);
    domHolder.autoDispose(fontStrikethrough);

    return (elem: Element) => {
      this._rowMap.set(row, elem);
      dom(elem,
          dom.autoDispose(domHolder),
          kd.style('--grist-cell-color', cellText),
          kd.style('--grist-cell-background-color', cellFill),
          kd.style('--grist-rule-color', ruleText),
          kd.style('--grist-column-rule-background-color', ruleFill),
          this._options.isPreview ? null : kd.cssClass(this.field.formulaCssClass),
          kd.toggleClass('field-with-comments', hasComment),
          kd.maybe(hasComment, () => dom('div.field-comment-indicator')),
          kd.toggleClass("readonly", toKo(ko, this._readonly)),
          kd.maybe(isSelected, () => dom('div.selected_cursor',
                                         kd.toggleClass('active_cursor', isActive)
                                        )),
          kd.scope(widgetObs, (widget: NewAbstractWidget) => {
            if (this.isDisposed()) { return null; }   // Work around JS errors during field removal.
            const cellDom = widget ? widget.buildDom(row) : buildErrorDom(row, this.field);
            if (cellDom === null) { return null; }
            return dom(cellDom, kd.toggleClass('has_cursor', isActive),
                       kd.toggleClass('field-error-from-style', errorInStyle),
                       kd.toggleClass('font-bold', fontBold),
                       kd.toggleClass('font-underline', fontUnderline),
                       kd.toggleClass('font-italic', fontItalic),
                       kd.toggleClass('font-strikethrough', fontStrikethrough));
          })
         );
    };
  }

  public buildEditorDom(editRow: DataRowModel, mainRowModel: DataRowModel, options: {
    init?: string,
    state?: any
    event?: KeyboardEvent | MouseEvent
  }) {
    // If the user attempts to edit a value during transform, finalize (i.e. cancel or execute)
    // the transform.
    if (this.columnTransform) {
      this.columnTransform.finalize().catch(reportError);
      return;
    }

    // Clear previous editor. Some caveats:
    // - The floating editor has an async cleanup routine, but it promises that it won't affect as.
    // - All other editors should be synchronous, so this line will remove all opened editors.
    const holder = this.gristDoc.fieldEditorHolder;
    // If the global editor is from our own field, we will dispose it immediately, otherwise we will
    // rely on the clipboard to dispose it by grabbing focus.
    const clearOwn = () => this.isEditorActive() && holder.clear();

    // If this is censored value, don't open up the editor, unless it is a formula field.
    const cell = editRow.cells[this.field.colId()];
    const value = cell && cell();
    if (gristTypes.isCensored(value) && !this.origColumn.isFormula.peek()) {
      return clearOwn();
    }

    const editorCtor: typeof NewBaseEditor =
      UserTypeImpl.getEditorConstructor(this.options().widget, this._readOnlyPureType());
    // constructor may be null for a read-only non-formula field, though not today.
    if (!editorCtor) {
      return clearOwn();
    }

    if (this._readonly.get() && editorCtor.supportsReadonly && !editorCtor.supportsReadonly()) {
      return clearOwn();
    }

    if (
      !this._readonly.get() &&
      saveWithoutEditor(editorCtor, editRow, this.field, {
        typedVal: options.init,
        event: options.event,
      })
    ) {
      return clearOwn();
    }

    const cellElem = this._rowMap.get(mainRowModel)!;

    // The editor may dispose itself; the Holder will know to clear itself in this case.
    const fieldEditor = FieldEditor.create(holder, {
      gristDoc: this.gristDoc,
      field: this.field,
      cursor: this._cursor,
      editRow,
      cellElem,
      editorCtor,
      state: options.state,
      startVal: this._readonly.get() ? undefined : options.init, // don't start with initial value
      readonly: this._readonly.get() // readonly for editor will not be observable
    });
    this._isEditorActive.set(true);

    // expose the active editor in a grist doc as an observable
    fieldEditor.onDispose(() => {
      this._isEditorActive.set(false);
      this.gristDoc.activeEditor.set(null);
    });
    this.gristDoc.activeEditor.set(fieldEditor);
  }

  public buildDiscussionPopup(editRow: DataRowModel, mainRowModel: DataRowModel, discussionId?: number) {
    const owner = this.gristDoc.fieldEditorHolder;
    const cellElem: Element = this._rowMap.get(mainRowModel)!;
    if (this.columnTransform) {
      this.columnTransform.finalize().catch(reportError);
      return;
    }
    if (editRow._isAddRow.peek() || this._readonly.get()) {
      return;
    }
    const holder = this.gristDoc.fieldEditorHolder;

    const cell = editRow.cells[this.field.colId()];
    const value = cell && cell();
    if (gristTypes.isCensored(value)) {
      holder.clear();
      return;
    }

    const tableRef = this.field.viewSection.peek()!.tableRef.peek()!;

    // Reuse fieldEditor holder to make sure only one popup/editor is attached to the cell.
    const discussionHolder = MultiHolder.create(owner);
    const discussions = EmptyCell.create(discussionHolder, {
      gristDoc: this.gristDoc,
      tableRef,
      column: this.field.column.peek(),
      rowId: editRow.id.peek(),
    });
    CellDiscussionPopup.create(discussionHolder, {
      domEl: cellElem,
      topic: discussions,
      discussionId,
      gristDoc: this.gristDoc,
      closeClicked: () => owner.clear()
    });
  }

  public isEditorActive() {
    const holder = this.gristDoc.fieldEditorHolder;
    return !holder.isEmpty() && this._isEditorActive.get();
  }

  /**
   * Open the formula editor in the side pane. It will be positioned over refElem.
   */
  public openSideFormulaEditor(options: {
    editRow: DataRowModel,
    refElem: Element,
    canDetach: boolean,
    editValue?: string,
    onSave?: (column: ColumnRec, formula: string) => Promise<void>,
    onCancel?: () => void
  }) {
    const {editRow, refElem, canDetach, editValue, onSave, onCancel} = options;

    // Remember position when the popup was opened.
    const position = this.gristDoc.cursorPosition.get();

    // Create a controller for the floating editor. It is primarily responsible for moving the editor
    // dom from the place where it was rendered to the popup (and moving it back).
    const floatController = {
      attach: async (content: HTMLElement) => {
        // If we haven't change page and the element is still in the DOM, move the editor to the
        // back to where it was rendered. It still has it's content, so no need to dispose it.
        if (refElem.isConnected) {
          formulaEditor.attach(refElem);
        } else {
          // Else, we will navigate to the position we left off, dispose the editor and the content.
          formulaEditor.dispose();
          grainjsDom.domDispose(content);
          await this.gristDoc.recursiveMoveToCursorPos(position!, true);
        }
      },
      detach() {
        return formulaEditor.detach();
      },
      autoDispose(el: Disposable) {
        return formulaEditor.autoDispose(el);
      },
      dispose() {
        formulaEditor.dispose();
      }
    };

    // Create a custom cleanup method, that won't destroy us when we loose focus while being detached.
    function setupEditorCleanup(
      owner: MultiHolder, gristDoc: GristDoc,
      editingFormula: ko.Computed<boolean>, _saveEdit: () => Promise<unknown>
    ) {
      // Just override the behavior on focus lost.
      const saveOnFocus = () => floatingExtension.active.get() ? void 0 : _saveEdit().catch(reportError);
      UnsavedChange.create(owner, async () => { await saveOnFocus(); });
      gristDoc.app.on('clipboard_focus', saveOnFocus);
      owner.onDispose(() => {
        gristDoc.app.off('clipboard_focus', saveOnFocus);
        editingFormula(false);
      });
    }

    // Get the field model from metatables, as the one provided by the caller might be some floating one, that
    // will change when user navigates around.
    const field = this.gristDoc.docModel.viewFields.getRowModel(this.field.getRowId());

    // Finally create the editor passing only the field, which will enable detachable flavor of formula editor.
    const formulaEditor = openFormulaEditor({
      gristDoc: this.gristDoc,
      field,
      editingFormula: this.field.editingFormula,
      setupCleanup: setupEditorCleanup,
      editRow,
      refElem,
      editValue,
      canDetach,
      onSave,
      onCancel
    });

    // And now create the floating editor itself. It is just a floating wrapper that will grab the dom
    // from the editor and show it in the popup. It also overrides various parts of Grist to make smoother experience.
    const floatingExtension = FloatingEditor.create(formulaEditor, floatController, {
      gristDoc: this.gristDoc,
      refElem,
      placement: 'overlapping',
    });

    // Add editor to document holder - this will prevent multiple formula editor instances.
    this.gristDoc.fieldEditorHolder.autoDispose(formulaEditor);
  }
}

const cssTypeSelectMenu = styled('div', `
  max-height: 500px;
`);


// Simple helper that removes transparency from a HEX or rgba color.
// User can set a transparent fill color using doc actions, but we don't want to show it well
// when a column is frozen.
function notTransparent(color: string): string {
  if (!color) {
    return color;
  } else if (color.startsWith('#') && color.length === 9) {
    return color.substring(0, 7);
  } else if (color.startsWith('rgba')) {
    // rgba(255, 255, 255)
    // rgba(255, 255, 255, 0.5)
    // rgba(255 255 255 / 0.5)
    // rgba(255 255 255 / 50%)
    return color.replace(/^rgba\((\d+)[,\s]+(\d+)[,\s]+(\d+)[/,\s]+([\d.%]+)\)$/i, 'rgb($1, $2, $3)');
  }
  return color;
}
