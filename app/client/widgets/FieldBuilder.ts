import { ColumnTransform } from 'app/client/components/ColumnTransform';
import { Cursor } from 'app/client/components/Cursor';
import { FormulaTransform } from 'app/client/components/FormulaTransform';
import { GristDoc } from 'app/client/components/GristDoc';
import { addColTypeSuffix } from 'app/client/components/TypeConversion';
import { TypeTransform } from 'app/client/components/TypeTransform';
import * as dom from 'app/client/lib/dom';
import { KoArray } from 'app/client/lib/koArray';
import * as kd from 'app/client/lib/koDom';
import * as kf from 'app/client/lib/koForm';
import * as koUtil from 'app/client/lib/koUtil';
import { reportError } from 'app/client/models/AppModel';
import { DataRowModel } from 'app/client/models/DataRowModel';
import { ColumnRec, DocModel, ViewFieldRec } from 'app/client/models/DocModel';
import { SaveableObjObservable, setSaveValue } from 'app/client/models/modelUtil';
import { FieldSettingsMenu } from 'app/client/ui/FieldMenus';
import { cssLabel, cssRow } from 'app/client/ui/RightPanel';
import { buttonSelect } from 'app/client/ui2018/buttonSelect';
import { IOptionFull, menu, select } from 'app/client/ui2018/menus';
import { DiffBox } from 'app/client/widgets/DiffBox';
import { buildErrorDom } from 'app/client/widgets/ErrorDom';
import { FieldEditor, openSideFormulaEditor, saveWithoutEditor } from 'app/client/widgets/FieldEditor';
import { NewAbstractWidget } from 'app/client/widgets/NewAbstractWidget';
import * as UserType from 'app/client/widgets/UserType';
import * as UserTypeImpl from 'app/client/widgets/UserTypeImpl';
import * as gristTypes from 'app/common/gristTypes';
import * as gutil from 'app/common/gutil';
import { CellValue } from 'app/plugin/GristData';
import { delay } from 'bluebird';
import { Computed, Disposable, fromKo, dom as grainjsDom, Holder, IDisposable, makeTestId } from 'grainjs';
import * as ko from 'knockout';
import * as _ from 'underscore';

const testId = makeTestId('test-fbuilder-');

// Creates a FieldBuilder object for each field in viewFields
export function createAllFieldWidgets(gristDoc: GristDoc, viewFields: ko.Computed<KoArray<ViewFieldRec>>,
                                      cursor: Cursor) {
  // TODO: Handle disposal from the map when fields are removed.
  return viewFields().map(function(field) {
    return new FieldBuilder(gristDoc, field, cursor);
  }).setAutoDisposeValues();
}

/**
 * Returns the appropriate object from UserType.typeDefs, defaulting to Text for unknown types.
 */
function getTypeDefinition(type: string | false) {
  if (!type) { return UserType.typeDefs.Text; }
  return UserType.typeDefs[type] || UserType.typeDefs.Text;
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

  private readonly availableTypes: Computed<Array<IOptionFull<string>>>;
  private readonly readOnlyPureType: ko.PureComputed<string>;
  private readonly isRightType: ko.PureComputed<(value: CellValue, options?: any) => boolean>;
  private readonly refTableId: ko.Computed<string | null>;
  private readonly isRef: ko.Computed<boolean>;
  private readonly _rowMap: Map<DataRowModel, Element>;
  private readonly isTransformingFormula: ko.Computed<boolean>;
  private readonly isTransformingType: ko.Computed<boolean>;
  private readonly _fieldEditorHolder: Holder<IDisposable>;
  private readonly widgetCons: ko.Computed<{create: (...args: any[]) => NewAbstractWidget}>;
  private readonly docModel: DocModel;

  public constructor(public readonly gristDoc: GristDoc, public readonly field: ViewFieldRec,
                     private _cursor: Cursor) {
    super();

    this.docModel = gristDoc.docModel;
    this.origColumn = field.column();
    this.options = field.widgetOptionsJson;

    this.readOnlyPureType = ko.pureComputed(() => this.field.column().pureType());

    // Observable with a list of available types.
    this.availableTypes = Computed.create(this, (use) => {
      const isFormula = use(this.origColumn.isFormula);
      const types: Array<IOptionFull<string>> = [];
      _.each(UserType.typeDefs, (def: any, key: string|number) => {
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
    this.isRightType = ko.pureComputed(function() {
      return gristTypes.isRightType(this.readOnlyPureType()) || _.constant(false);
    }, this);

    // Returns a boolean indicating whether the column is type Reference.
    this.isRef = this.autoDispose(ko.computed(() => {
      return gutil.startsWith(this.field.column().type(), 'Ref:');
    }));

    // Gives the table ID to which the reference points.
    this.refTableId = this.autoDispose(ko.computed({
      read: () => gutil.removePrefix(this.field.column().type(), "Ref:"),
      write: val => this._setType(`Ref:${val}`)
    }));

    this.widget = ko.pureComputed({
      owner: this,
      read() { return this.options().widget; },
      write(widget) {
        // Reset the entire JSON, so that all options revert to their defaults.

        const previous = this.options.peek();
        this.options.setAndSave({
          widget,
          // Persists color settings across widgets (note: we cannot use `field.fillColor` to get the
          // current value because it returns a default value for `undefined`. Same for `field.textColor`.
          fillColor: previous.fillColor,
          textColor: previous.textColor,
        }).catch(reportError);
      }
    });

    // Whether there is a pending call that transforms column.
    this.isCallPending = ko.observable(false);

    // Maintains an instance of the transform object if the field is currently being transformed,
    // and null if not. Gets disposed along with the transform menu dom.
    this.columnTransform = null;

    // Returns a boolean indicating whether a formula transform is in progress.
    this.isTransformingFormula = this.autoDispose(ko.computed(() => {
      return this.field.column().isTransforming() && this.columnTransform instanceof FormulaTransform;
    }));
    // Returns a boolean indicating whether a type transform is in progress.
    this.isTransformingType = this.autoDispose(ko.computed(() => {
      return (this.field.column().isTransforming() || this.isCallPending()) &&
        (this.columnTransform instanceof TypeTransform);
    }));

    // This holds a single FieldEditor. When a new FieldEditor is created (on edit), it replaces the
    // previous one if any.
    this._fieldEditorHolder = Holder.create(this);

    // Map from rowModel to cell dom for the field to which this fieldBuilder applies.
    this._rowMap = new Map();

    // Returns the constructor for the widget, and only notifies subscribers on changes.
    this.widgetCons = this.autoDispose(koUtil.withKoUtils(ko.computed(function() {
      return UserTypeImpl.getWidgetConstructor(this.options().widget,
                                               this.readOnlyPureType());
    }, this)).onlyNotifyUnequal());

    // Computed builder for the widget.
    this.widgetImpl = this.autoDispose(koUtil.computedBuilder(() => {
      const cons = this.widgetCons();
      // Must subscribe to `colId` so that field.colId is rechecked on transform.
      return cons.create.bind(cons, this.field, this.field.colId());
    }, this).extend({ deferred: true }));

    this.diffImpl = this.autoDispose(DiffBox.create(this.field));
  }

// dispose.makeDisposable(FieldBuilder);


  public buildSelectWidgetDom() {
    return grainjsDom.maybe((use) => !use(this.isTransformingType) && use(this.readOnlyPureType), type => {
      const typeWidgets = getTypeDefinition(type).widgets;
      const widgetOptions = Object.keys(typeWidgets).map(label => ({
        label,
        value: label,
        icon: typeWidgets[label].icon
      }));
      return widgetOptions.length <= 1 ? null : [
        cssLabel('CELL FORMAT'),
        cssRow(
          widgetOptions.length <= 2 ? buttonSelect(fromKo(this.widget), widgetOptions) :
            select(fromKo(this.widget), widgetOptions),
          testId('widget-select')
        )
      ];
    });
  }

  /**
   * Build the type change dom.
   */
  public buildSelectTypeDom() {
    const selectType = Computed.create(null, (use) => use(fromKo(this.readOnlyPureType)));
    selectType.onWrite(newType => newType === this.readOnlyPureType.peek() || this._setType(newType));
    const onDispose = () => (this.isDisposed() || selectType.set(this.field.column().pureType()));

    return [
      cssRow(
        grainjsDom.autoDispose(selectType),
        select(selectType, this.availableTypes, {
          disabled: (use) => use(this.isTransformingFormula) || use(this.origColumn.disableModifyBase) ||
            use(this.isCallPending)
        }),
        testId('type-select')
      ),
      grainjsDom.maybe((use) => use(this.isRef) && !use(this.isTransformingType), () => this._buildRefTableSelect()),
      grainjsDom.maybe(this.isTransformingType, () => {
        // Editor dom must be built before preparing transform.
        return dom('div.type_transform_prompt',
                   kf.prompt(
                     dom('div',
                         grainjsDom.maybe(this.isRef, () => this._buildRefTableSelect()),
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
  public _setType(newType: string): Promise<unknown>|undefined {
    if (this.origColumn.isFormula()) {
      // Do not type transform a new/empty column or a formula column. Just make a best guess for
      // the full type, and set it.
      const column = this.field.column();
      column.type.setAndSave(addColTypeSuffix(newType, column, this.docModel)).catch(reportError);
    } else if (!this.columnTransform) {
      this.columnTransform = TypeTransform.create(null, this.gristDoc, this);
      return this.columnTransform.prepare(newType);
    } else {
      if (this.columnTransform instanceof TypeTransform) {
        return this.columnTransform.setType(newType);
      }
    }
  }

  // Builds the reference type table selector. Built when the column is type reference.
  public _buildRefTableSelect() {
    const allTables = Computed.create(null, (use) =>
                                      use(this.docModel.allTableIds.getObservable()).map(tableId => ({
                                        value: tableId,
                                        label: tableId,
                                        icon: 'FieldTable' as const
                                      }))
                                     );
    return [
      cssLabel('DATA FROM TABLE'),
      cssRow(
        dom.autoDispose(allTables),
        select(fromKo(this.refTableId), allTables),
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
               kf.row(
                 15, kf.label('Apply Formula to Data'),
                 3, kf.buttonGroup(
                   kf.checkButton(transformButton,
                     dom('span.glyphicon.glyphicon-flash'),
                     dom.testId("FieldBuilder_editTransform"),
                     kd.toggleClass('disabled', () => this.isTransformingType() || this.origColumn.isFormula() ||
                       this.origColumn.disableModifyBase())
                   )
                 )
               ),
               kd.maybe(this.isTransformingFormula, () => {
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
      kd.maybe(() => !this.isTransformingType() && this.widgetImpl(), (widget: NewAbstractWidget) =>
        dom('div',
            widget.buildConfigDom(),
            widget.buildColorConfigDom(),

            // If there is more than one field for this column (i.e. present in multiple views).
            kd.maybe(() => this.origColumn.viewFields().all().length > 1, () =>
                     dom('div.fieldbuilder_settings',
                         kf.row(
                           kd.toggleClass('fieldbuilder_settings_header', true),
                           kf.label(
                             dom('div.fieldbuilder_settings_button',
                                 dom.testId('FieldBuilder_settings'),
                                 kd.text(() => this.field.useColOptions() ? 'Common' : 'Separate'), ' ▾',
                                 menu(ctl => FieldSettingsMenu(this.field.useColOptions(), {
                                   useSeparate: () => this.fieldSettingsUseSeparate(),
                                   saveAsCommon: () => this.fieldSettingsSaveAsCommon(),
                                   revertToCommon: () => this.fieldSettingsRevertToCommon()
                                 }))
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
      `Use separate field settings for ${this.origColumn.colId()}`, () => {
        return Promise.all([
          setSaveValue(this.field.widgetOptions, this.field.column().widgetOptions()),
          setSaveValue(this.field.visibleCol, this.field.column().visibleCol()),
          this.field.saveDisplayFormula(this.field.column()._displayColModel().formula() || '')
        ]);
      }
    );
  }

  public fieldSettingsSaveAsCommon() {
    return this.gristDoc.docData.bundleActions(
      `Save field settings for ${this.origColumn.colId()} as common`, () => {
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
      `Revert field settings for ${this.origColumn.colId()} to common`, () => {
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
  public buildDomWithCursor(row: DataRowModel, isActive: boolean, isSelected: boolean) {
    const widgetObs = koUtil.withKoUtils(ko.computed(function() {
      // TODO: Accessing row values like this doesn't always work (row and field might not be updated
      // simultaneously).
      if (this.isDisposed()) { return null; }   // Work around JS errors during field removal.
      const value = row.cells[this.field.colId()];
      const cell = value && value();
      if (value && this.isRightType()(cell, this.options) || row._isAddRow.peek()) {
        return this.widgetImpl();
      } else if (gristTypes.isVersions(cell)) {
        return this.diffImpl;
      } else {
        return null;
      }
    }, this).extend({ deferred: true })).onlyNotifyUnequal();

    return (elem: Element) => {
      this._rowMap.set(row, elem);
      dom(elem,
          dom.autoDispose(widgetObs),
          kd.cssClass(this.field.formulaCssClass),
          kd.maybe(isSelected, () => dom('div.selected_cursor',
                                         kd.toggleClass('active_cursor', isActive)
                                        )),
          kd.scope(widgetObs, (widget: NewAbstractWidget) => {
            if (this.isDisposed()) { return null; }   // Work around JS errors during field removal.
            const cellDom = widget ? widget.buildDom(row) : buildErrorDom(row, this.field);
            return dom(cellDom, kd.toggleClass('has_cursor', isActive),
                       kd.style('--grist-cell-color', () => this.field.textColor() || ''),
                       kd.style('--grist-cell-background-color', this.field.fillColor));
          })
         );
    };
  }

  /**
   * Flash the cursor in the given row briefly to indicate that editing in this cell is disabled.
   */
  public async flashCursorReadOnly(mainRow: DataRowModel) {
    const mainCell = this._rowMap.get(mainRow);
    // Abort if a cell is not found (i.e. if this is a ChartView)
    if (!mainCell) { return; }
    const elem = mainCell.querySelector('.active_cursor');
    if (elem && !elem.classList.contains('cursor_read_only')) {
      elem.classList.add('cursor_read_only');
      const div = elem.appendChild(dom('div.cursor_read_only_lock.glyphicon.glyphicon-lock'));
      try {
        await delay(200);
        elem.classList.add('cursor_read_only_fade');
        await delay(400);
      } finally {
        elem.classList.remove('cursor_read_only', 'cursor_read_only_fade');
        elem.removeChild(div);
      }
    }
  }

  public buildEditorDom(editRow: DataRowModel, mainRowModel: DataRowModel, options: {
    init?: string
  }) {
    // If the user attempts to edit a value during transform, finalize (i.e. cancel or execute)
    // the transform.
    if (this.columnTransform) {
      this.columnTransform.finalize().catch(reportError);
      return;
    }

    const editorCtor = UserTypeImpl.getEditorConstructor(this.options().widget, this.readOnlyPureType());
    // constructor may be null for a read-only non-formula field, though not today.
    if (!editorCtor) {
      // Actually, we only expect buildEditorDom() to be called when isEditorActive() is false (i.e.
      // _fieldEditorHolder is already clear), but clear here explicitly for clarity.
      this._fieldEditorHolder.clear();
      return;
    }

    if (saveWithoutEditor(editorCtor, editRow, this.field, options.init)) {
      this._fieldEditorHolder.clear();
      return;
    }

    const cellElem = this._rowMap.get(mainRowModel)!;

    // The editor may dispose itself; the Holder will know to clear itself in this case.
    const fieldEditor = FieldEditor.create(this._fieldEditorHolder, {
      gristDoc: this.gristDoc,
      field: this.field,
      cursor: this._cursor,
      editRow,
      cellElem,
      editorCtor,
      startVal: options.init,
    });

    // Put the FieldEditor into a holder in GristDoc too. This way any existing FieldEditor (perhaps
    // for another field, or for another BaseView) will get disposed at this time. The reason to
    // still maintain a Holder in this FieldBuilder is mainly to match older behavior; changing that
    // will entail a number of other tweaks related to the order of creating and disposal.
    this.gristDoc.fieldEditorHolder.autoDispose(fieldEditor);
  }

  public isEditorActive() {
    return !this._fieldEditorHolder.isEmpty();
  }

  /**
   * Open the formula editor in the side pane. It will be positioned over refElem.
   */
  public openSideFormulaEditor(editRow: DataRowModel, refElem: Element) {
    const editorHolder = openSideFormulaEditor({
      gristDoc: this.gristDoc,
      field: this.field,
      editRow,
      refElem,
    });
    this.gristDoc.fieldEditorHolder.autoDispose(editorHolder);
  }
}
