/**
 * TypeTransform extends ColumnTransform, creating the transform dom prompt that is shown when the
 * user changes the type of a data column. The purpose is to aid the user in converting data to the new
 * type by allowing a formula to be applied prior to conversion. It also allows for program-generated formulas
 * to be pre-entered for certain transforms (to Reference / Date) which the user can modify via dropdown menus.
 */

import * as AceEditor from 'app/client/components/AceEditor';
import {ColumnTransform} from 'app/client/components/ColumnTransform';
import {GristDoc} from 'app/client/components/GristDoc';
import * as TypeConversion from 'app/client/components/TypeConversion';
import {reportError} from 'app/client/models/errors';
import * as modelUtil from 'app/client/models/modelUtil';
import {cssButtonRow} from 'app/client/ui/RightPanel';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {testId} from 'app/client/ui2018/cssVars';
import {FieldBuilder} from 'app/client/widgets/FieldBuilder';
import {NewAbstractWidget} from 'app/client/widgets/NewAbstractWidget';
import {ColValues} from 'app/common/DocActions';
import {Computed, dom, fromKo, Observable} from 'grainjs';
import isEmpty = require('lodash/isEmpty');
import pickBy = require('lodash/pickBy');

// To simplify diff (avoid rearranging methods to satisfy private/public order).
/* eslint-disable @typescript-eslint/member-ordering */

/**
 * Creates an instance of TypeTransform for a single field. Extends ColumnTransform.
 */
export class TypeTransform extends ColumnTransform {
  private reviseTypeChange = Observable.create(this, false);
  private transformWidget: Computed<NewAbstractWidget|null>;

  constructor(gristDoc: GristDoc, fieldBuilder: FieldBuilder) {
    super(gristDoc, fieldBuilder);
    this._shouldExecute = true;

    // The display widget of the new transform column. Used to build the transform config menu.
    // Only set while transforming.
    this.transformWidget = Computed.create(this, fromKo(fieldBuilder.widgetImpl), (use, widget) => {
      return use(this.origColumn.isTransforming) ? widget : null;
    });
  }

  /**
   * Build the transform menu for a type transform
   */
  public buildDom() {
    // An observable to disable all buttons before the dom get removed.
    const disableButtons = Observable.create(null, false);

    this.reviseTypeChange.set(false);
    this.editor = this.autoDispose(AceEditor.create({ observable: this.transformColumn.formula }));
    return dom('div',
      testId('type-transform-top'),
      dom.maybe(this.transformWidget, transformWidget => transformWidget.buildTransformConfigDom()),
      dom.maybe(this.reviseTypeChange, () =>
        dom('div.transform_editor', this.buildEditorDom(),
          testId("type-transform-formula")
        )
      ),
      cssButtonRow(
        basicButton(dom.on('click', () => { this.cancel().catch(reportError); disableButtons.set(true); }),
          'Cancel', testId("type-transform-cancel"),
          dom.cls('disabled', disableButtons)
        ),
        dom.domComputed(this.reviseTypeChange, revising => {
          if (revising) {
            return basicButton(dom.on('click', () => this.editor.writeObservable()),
              'Preview', testId("type-transform-update"),
              dom.cls('disabled', (use) => use(disableButtons) || use(this.formulaUpToDate)),
              { title: 'Update formula (Shift+Enter)' }
            );
          } else {
            return basicButton(dom.on('click', () => { this.reviseTypeChange.set(true); }),
              'Revise', testId("type-transform-revise"),
              dom.cls('disabled', disableButtons)
            );
          }
        }),
        primaryButton(dom.on('click', () => { this.execute().catch(reportError); disableButtons.set(true); }),
          'Apply', testId("type-transform-apply"),
          dom.cls('disabled', disableButtons)
        )
      )
    );
  }

  protected async resetToDefaultFormula() {
    if (!this.isFinalizing()) {
      const toType = this.transformColumn.type.peek();
      const formula = TypeConversion.getDefaultFormula(this.gristDoc.docModel, this.origColumn,
        toType, this.field.visibleColRef(), this.field.widgetOptionsJson());
      await modelUtil.setSaveValue(this.transformColumn.formula, formula);
    }
  }

  /**
   * Overrides parent method to initialize the transform column with guesses as to the particular
   * type and column options.
   * @param {String} toType: A pure or complete type for the transformed column.
   */
  protected async addTransformColumn(toType: string) {
    const docModel = this.gristDoc.docModel;
    const colInfo = await TypeConversion.prepTransformColInfo(docModel, this.origColumn, this.origDisplayCol, toType);
    const newColInfo = await this._tableData.sendTableAction(['AddColumn', 'gristHelper_Transform', colInfo]);
    const tcol = docModel.columns.getRowModel(newColInfo.colRef);
    await TypeConversion.setDisplayFormula(docModel, tcol);
    return newColInfo.colRef;
  }

  /**
   * Overrides parent method to subscribe to changes to the transform column.
   */
  protected postAddTransformColumn() {
    // When a user-initiated change is saved to type or widgetOptions, update the formula.
    this.autoDispose(this.transformColumn.type.subscribe(this.resetToDefaultFormula, this, "save"));
    this.autoDispose(this.transformColumn.visibleCol.subscribe(this.resetToDefaultFormula, this, "save"));
    this.autoDispose(this.field.widgetOptionsJson.subscribe(this.resetToDefaultFormula, this, "save"));
  }

  /**
   * When a type is changed, again guess appropriate column options.
   */
  public async setType(toType: string) {
    const docModel = this.gristDoc.docModel;
    const colInfo = await TypeConversion.prepTransformColInfo(docModel, this.origColumn, this.origDisplayCol, toType);
    // Only update those values which changed, and only if needed.
    const tcol = this.transformColumn;
    const changedInfo = pickBy(colInfo, (val, key) =>
      (val !== tcol[key as keyof TypeConversion.ColInfo].peek()));
    return Promise.all([
      isEmpty(changedInfo) ? undefined : tcol.updateColValues(changedInfo as ColValues),
      TypeConversion.setDisplayFormula(docModel, tcol, changedInfo.visibleCol)
    ]);
  }
}
