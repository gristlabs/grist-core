import * as commands from 'app/client/components/commands';
import { FieldRulesConfig } from 'app/client/components/Forms/FormConfig';
import { DataRowModel } from 'app/client/models/DataRowModel';
import { ViewFieldRec } from 'app/client/models/entities/ViewFieldRec';
import { KoSaveableObservable } from 'app/client/models/modelUtil';
import { NewAbstractWidget, Options } from 'app/client/widgets/NewAbstractWidget';
import { theme } from 'app/client/ui2018/cssVars';
import { dom, DomContents } from 'grainjs';

/**
 * ToggleBase - The base class for toggle widgets, such as a checkbox or a switch.
 */
abstract class ToggleBase extends NewAbstractWidget {
  public buildFormConfigDom(): DomContents {
    return [
      dom.create(FieldRulesConfig, this.field),
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
    super(field, {defaultTextColor: theme.toggleCheckboxFg.toString()});
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId.peek()] as KoSaveableObservable<boolean>;
    return dom('div.field_clip',
      dom('div.widget_checkbox',
        dom('div.widget_checkmark',
          dom.show(value),
          dom('div.checkmark_kick'),
          dom('div.checkmark_stem')
        ),
        this._addClickEventHandlers(row),
      )
    );
  }
}

export class ToggleSwitch extends ToggleBase {
  constructor(field: ViewFieldRec, _options: Options = {}) {
    super(field, {defaultTextColor: '#2CB0AF'});
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId.peek()] as KoSaveableObservable<boolean>;
    return dom('div.field_clip',
      dom('div.widget_switch',
        dom.cls('switch_on', value),
        dom.cls('switch_transition', row._isRealChange),
        dom('div.switch_slider'),
        dom('div.switch_circle'),
        this._addClickEventHandlers(row),
      )
    );
  }
}
