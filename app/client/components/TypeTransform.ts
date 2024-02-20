/**
 * TypeTransform extends ColumnTransform, creating the transform dom prompt that is shown when the
 * user changes the type of a data column. The purpose is to aid the user in converting data to the new
 * type by allowing a formula to be applied prior to conversion. It also allows for program-generated formulas
 * to be pre-entered for certain transforms (to Reference / Date) which the user can modify via dropdown menus.
 */

import {ColumnTransform} from 'app/client/components/ColumnTransform';
import {GristDoc} from 'app/client/components/GristDoc';
import * as TypeConversion from 'app/client/components/TypeConversion';
import {reportError} from 'app/client/models/errors';
import {cssButtonRow} from 'app/client/ui/RightPanelStyles';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {testId} from 'app/client/ui2018/cssVars';
import {FieldBuilder} from 'app/client/widgets/FieldBuilder';
import {ColumnRec} from 'app/client/models/DocModel';
import {NewAbstractWidget} from 'app/client/widgets/NewAbstractWidget';
import {UserAction} from 'app/common/DocActions';
import {Computed, dom, fromKo, Observable} from 'grainjs';
import {makeT} from 'app/client/lib/localization';
import {WidgetType} from 'app/common/widgetTypes';

const t = makeT('TypeTransform');

// To simplify diff (avoid rearranging methods to satisfy private/public order).
/* eslint-disable @typescript-eslint/member-ordering */

/**
 * Creates an instance of TypeTransform for a single field. Extends ColumnTransform.
 */
export class TypeTransform extends ColumnTransform {
  private _reviseTypeChange = Observable.create(this, false);
  private _transformWidget: Computed<NewAbstractWidget|null>;
  private _isFormWidget: Computed<boolean>;
  private _convertColumn: ColumnRec;                 // Set in prepare()

  constructor(gristDoc: GristDoc, fieldBuilder: FieldBuilder) {
    super(gristDoc, fieldBuilder);
    this._shouldExecute = true;

    // The display widget of the new transform column. Used to build the transform config menu.
    // Only set while transforming.
    this._transformWidget = Computed.create(this, fromKo(fieldBuilder.widgetImpl), (use, widget) => {
      return use(this.origColumn.isTransforming) ? widget : null;
    });

    this._isFormWidget = Computed.create(this, use => use(use(this.field.viewSection).parentKey) === WidgetType.Form);
  }

  /**
   * Build the transform menu for a type transform
   */
  public buildDom() {
    // An observable to disable all buttons before the dom get removed.
    const disableButtons = Observable.create(null, false);
    this._reviseTypeChange.set(false);
    return dom('div',
      testId('type-transform-top'),
      dom.domComputed(use => {
        const transformWidget = use(this._transformWidget);
        if (!transformWidget) { return null; }

        if (use(this._isFormWidget)) {
          return transformWidget.buildFormTransformConfigDom();
        } else {
          return transformWidget.buildTransformConfigDom();
        }
      }),
      dom.maybe(this._reviseTypeChange, () =>
        dom('div.transform_editor', this.buildEditorDom(),
          testId("type-transform-formula")
        )
      ),
      cssButtonRow(
        basicButton(dom.on('click', () => { this.cancel().catch(reportError); disableButtons.set(true); }),
          t('Cancel'), testId("type-transform-cancel"),
          dom.cls('disabled', disableButtons)
        ),
        dom.domComputed(this._reviseTypeChange, revising => {
          if (revising) {
            return basicButton(dom.on('click', () => this.preview()),
              t('Preview'), testId("type-transform-update"),
              dom.cls('disabled', (use) => use(disableButtons) || use(this.formulaUpToDate)),
              { title: t('Update formula (Shift+Enter)') }
            );
          } else {
            return basicButton(dom.on('click', () => { this._reviseTypeChange.set(true); }),
              t('Revise'), testId("type-transform-revise"),
              dom.cls('disabled', disableButtons)
            );
          }
        }),
        primaryButton(dom.on('click', () => { this.execute().catch(reportError); disableButtons.set(true); }),
          t('Apply'), testId("type-transform-apply"),
          dom.cls('disabled', disableButtons)
        )
      )
    );
  }

  /**
   * Overrides parent method to initialize the transform column with guesses as to the particular
   * type and column options.
   * @param {String} toType: A pure or complete type for the transformed column.
   */
  protected async addTransformColumn(toType: string) {
    const docModel = this.gristDoc.docModel;
    const newColInfos = await this._tableData.sendTableActions([
      ['AddColumn', 'gristHelper_Converted', {type: 'Any'}],
      ['AddColumn', 'gristHelper_Transform', {type: 'Any'}],
    ]);
    const gristHelper_ConvertedRef = newColInfos[0].colRef;
    const gristHelper_TransformRef = newColInfos[1].colRef;
    this.transformColumn = docModel.columns.getRowModel(gristHelper_TransformRef);
    this._convertColumn = docModel.columns.getRowModel(gristHelper_ConvertedRef);
    const colInfo = await TypeConversion.prepTransformColInfo({
      docModel,
      origCol: this.origColumn,
      origDisplayCol: this.origDisplayCol,
      toTypeMaybeFull: toType,
      convertedRef: this._convertColumn.colId.peek()
    });
    // NOTE: We could add rules with AddColumn action, but there are some optimizations that converts array values.
    const rules = colInfo.rules;
    delete (colInfo as any).rules;
    await this._tableData.sendTableActions([
      ['ModifyColumn', this._convertColumn.colId.peek(), {...colInfo, isFormula: false, formula: ''}],
      ['ModifyColumn', this.transformColumn.colId.peek(), colInfo],
    ]);
    if (rules) {
      await this.gristDoc.docData.sendActions([
        ['UpdateRecord', '_grist_Tables_column', gristHelper_TransformRef, { rules }]
      ]);
    }
    await this.convertValues();
    return gristHelper_TransformRef;
  }

  protected convertValuesActions(): UserAction[] {
    const tableId = this._tableData.tableId;
    const srcColId = this.origColumn.colId.peek();
    const dstColId = this._convertColumn.colId.peek();
    const type = this.transformColumn.type.peek();
    const widgetOptions = this.transformColumn.widgetOptions.peek();
    const visibleColRef = this.transformColumn.visibleCol.peek();
    return [['ConvertFromColumn', tableId, srcColId, dstColId, type, widgetOptions, visibleColRef]];
  }

  protected async convertValues() {
    await Promise.all([
      this.gristDoc.docData.sendActions(this.convertValuesActions()),
      TypeConversion.setDisplayFormula(this.gristDoc.docModel, this.transformColumn),
    ]);
  }

  protected executeActions(): UserAction[] {
    return [...this.convertValuesActions(), ...super.executeActions()];
  }

  /**
   * Overrides parent method to subscribe to changes to the transform column.
   */
  protected postAddTransformColumn() {
    // When a user-initiated change is saved to type or widgetOptions, reconvert the values
    // Need to subscribe to both 'change' and 'save' for type which can come from setting the type itself
    // or e.g. a change to DateTime timezone.
    this.autoDispose(this.transformColumn.type.subscribe(this.convertValues, this, "change"));
    this.autoDispose(this.transformColumn.type.subscribe(this.convertValues, this, "save"));
    this.autoDispose(this.transformColumn.visibleCol.subscribe(this.convertValues, this, "save"));
    this.autoDispose(this.field.widgetOptionsJson.subscribe(this.convertValues, this, "save"));
  }

  /**
   * Overrides parent method to delete extra column
   */
  protected cleanup() {
    void this._tableData.sendTableAction(['RemoveColumn', this._convertColumn.colId.peek()]);
  }

  /**
   * When a type is changed, again guess appropriate column options.
   */
  public async setType(toType: string) {
    const docModel = this.gristDoc.docModel;
    const colInfo = await TypeConversion.prepTransformColInfo({
      docModel,
      origCol: this.origColumn,
      origDisplayCol: this.origDisplayCol,
      toTypeMaybeFull: toType,
      convertedRef: this._convertColumn.colId.peek()
    });
    const tcol = this.transformColumn;
    await tcol.updateColValues(colInfo as any);
  }
}
