import * as commands from 'app/client/components/commands';
import { FormFieldRulesConfig } from 'app/client/components/Forms/FormConfig';
import { fromKoSave } from 'app/client/lib/fromKoSave';
import { makeT } from 'app/client/lib/localization';
import { DataRowModel } from 'app/client/models/DataRowModel';
import { ViewFieldRec } from 'app/client/models/entities/ViewFieldRec';
import { fieldWithDefault, KoSaveableObservable } from 'app/client/models/modelUtil';
import { FormToggleFormat } from 'app/client/ui/FormAPI';
import { cssLabel, cssRow } from 'app/client/ui/RightPanelStyles';
import { buttonSelect } from 'app/client/ui2018/buttonSelect';
import { toggleSwitch } from 'app/client/ui2018/toggleSwitch';
import { theme } from 'app/client/ui2018/cssVars';
import { components } from 'app/common/ThemePrefs';
import { NewAbstractWidget, Options } from 'app/client/widgets/NewAbstractWidget';
import { dom, DomContents, DomElementArg, fromKo, makeTestId, styled } from 'grainjs';

const t = makeT('Toggle');

const testId = makeTestId('test-toggle-');

/**
 * ToggleBase - The base class for toggle widgets, such as a checkbox or a switch.
 */
abstract class ToggleBase extends NewAbstractWidget {
  public buildFormConfigDom(): DomContents {
    const format = fieldWithDefault<FormToggleFormat>(
      this.field.widgetOptionsJson.prop('formToggleFormat'),
      'switch',
    );

    return [
      cssLabel(t('Field Format')),
      cssRow(
        buttonSelect(
          fromKoSave(format),
          [
            { value: 'switch', label: t('Switch') },
            { value: 'checkbox', label: t('Checkbox') },
          ],
          testId('form-field-format'),
        ),
      ),
      dom.create(FormFieldRulesConfig, this.field),
    ];
  }

  protected _addClickEventHandlers(row: DataRowModel) {
    return [
      dom.on('click', (event) => {
        if (event.shiftKey) {
          // Shift-click is for selection, don't also toggle the checkbox during it.
          return;
        }
        if (!this.field.column().isRealFormula()) {
          // Move the cursor here, and pretend that enter was pressed. This triggers an editing
          // flow which is handled by CheckBoxEditor.skipEditor(). This way the edit applies to
          // editRow, which handles setting default values based on widget linking.
          commands.allCommands.setCursor.run(row, this.field);
          commands.allCommands.input.run('<enter>');
        }
      }),
      dom.on('dblclick', (event) => {
        // Don't start editing the field when a toggle is double-clicked.
        event.stopPropagation();
        event.preventDefault();
      }),
    ];
  }
}

export class ToggleCheckBox extends ToggleBase {
  constructor(field: ViewFieldRec, _options: Options = {}) {
    super(field, { defaultTextColor: theme.toggleCheckboxFg.toString() });
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId.peek()] as KoSaveableObservable<boolean>;
    return dom('div.field_clip',
      buildCheckbox(value, this._addClickEventHandlers(row)),
    );
  }
}

export class ToggleSwitch extends ToggleBase {
  constructor(field: ViewFieldRec, _options: Options = {}) {
    super(field, {
      defaultTextColor: components.switchActiveSlider.getRawValue(),
    });
  }

  public override buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId.peek()] as KoSaveableObservable<boolean>;
    return dom('div.field_clip',
      // For printing, we will show this as a checkbox (without handlers).
      buildCheckbox(value, dom.cls('screen-force-hide')),
      // For screen, we will show this as a switch (with handlers).
      buildSwitch(
        value,
        row._isRealChange,
        this._addClickEventHandlers(row),
        dom.cls('print-force-hide'),
      ),
    );
  }
}

function buildCheckbox(value: KoSaveableObservable<boolean>, ...args: DomElementArg[]) {
  return dom('div.widget_checkbox',
    dom('div.widget_checkmark',
      dom.show(value),
      dom('div.checkmark_kick'),
      dom('div.checkmark_stem'),
    ),
    ...args,
  );
}

function buildSwitch(
  value: KoSaveableObservable<boolean>,
  isTransitionEnabled: ko.Observable<boolean>,
  ...args: DomElementArg[]) {
  return toggleSwitch(fromKo(value), {
    args: [dom.cls(cssToggleSwitch.className), ...args],
    useHiddenInput: false,
    enableTransitions: fromKo(isTransitionEnabled),
  });
}

/* user can define a color in the column config: expose it to the switch component */
const cssToggleSwitch = styled('div', `
  margin: -1px auto;
  --grist-theme-switch-active-slider: var(--grist-actual-cell-color, ${components.switchActiveSlider.getRawValue()});
`);
