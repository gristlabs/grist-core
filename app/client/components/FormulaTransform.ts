/**
 * FormulaTransform extends ColumnTransform, creating the transform dom in the field config tab
 * used to transform a column of data using a formula. Allows the user to easily and quickly clean
 * data or change data to a more useful form.
 */

// Client libraries
import {ColumnTransform} from 'app/client/components/ColumnTransform';
import {GristDoc} from 'app/client/components/GristDoc';
import {cssButtonRow} from 'app/client/ui/RightPanelStyles';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {testId} from 'app/client/ui2018/cssVars';
import {FieldBuilder} from 'app/client/widgets/FieldBuilder';
import {dom} from 'grainjs';

/**
 * Creates an instance of FormulaTransform for a single field. Extends ColumnTransform.
 */
export class FormulaTransform extends ColumnTransform {
  constructor(gristDoc: GristDoc, fieldBuilder: FieldBuilder) {
    super(gristDoc, fieldBuilder);
  }

  /**
   * Build the transform menu for a formula transform
   */
  public buildDom() {
    return [
      dom('div.transform_menu',
        dom('div.transform_editor',
          this.buildEditorDom(this.getIdentityFormula()),
          testId("formula-transform-top")
        )
      ),
      cssButtonRow(
        basicButton(dom.on('click', () => this.cancel()),
          'Cancel', testId("formula-transform-cancel")),
        basicButton(dom.on('click', () => this.preview()),
          'Preview',
          dom.cls('disabled', this.formulaUpToDate),
          { title: 'Update formula (Shift+Enter)' },
          testId("formula-transform-update")),
        primaryButton(dom.on('click', () => this.execute()),
          'Apply', testId("formula-transform-apply"))
      ),
    ];
  }
}
