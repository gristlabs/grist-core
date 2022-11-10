import * as commands from 'app/client/components/commands';
import { DataRowModel } from 'app/client/models/DataRowModel';
import { ViewFieldRec } from 'app/client/models/entities/ViewFieldRec';
import { KoSaveableObservable } from 'app/client/models/modelUtil';
import { NewAbstractWidget, Options } from 'app/client/widgets/NewAbstractWidget';
import { dom } from 'grainjs';

/**
 * ToggleBase - The base class for toggle widgets, such as a checkbox or a switch.
 */
abstract class ToggleBase extends NewAbstractWidget {
  protected _addClickEventHandler(row: DataRowModel) {
    return dom.on('click', (event) => {
      if (event.shiftKey) {
        // Shift-click is for selection, don't also toggle the checkbox during it.
        return;
      }
      if (!this.field.column().isRealFormula()) {
        // Move the cursor here, and pretend that spacebar was pressed. This triggers an editing
        // flow which is handled by CheckBoxEditor.skipEditor(). This way the edit applies to
        // editRow, which handles setting default values based on widget linking.
        commands.allCommands.setCursor.run(row, this.field);
        commands.allCommands.input.run(' ');
      }
    });
  }
}

export class ToggleCheckBox extends ToggleBase {
  constructor(field: ViewFieldRec, _options: Options = {}) {
    super(field, {defaultTextColor: '#606060'});
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
        this._addClickEventHandler(row),
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
        this._addClickEventHandler(row),
      )
    );
  }
}
