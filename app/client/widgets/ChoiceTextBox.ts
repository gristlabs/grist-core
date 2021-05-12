import * as commands from 'app/client/components/commands';
import {ListEntry} from 'app/client/lib/listEntry';
import {DataRowModel} from 'app/client/models/DataRowModel';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import {cssLabel, cssRow} from 'app/client/ui/RightPanel';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuItem} from 'app/client/ui2018/menus';
import {NTextBox} from 'app/client/widgets/NTextBox';
import {Computed, dom, styled} from 'grainjs';

/**
 * ChoiceTextBox - A textbox for choice values.
 */
export class ChoiceTextBox extends NTextBox {
  private _choices: KoSaveableObservable<string[]>;
  private _choiceValues: Computed<string[]>;

  constructor(field: ViewFieldRec) {
    super(field);
    this._choices = this.options.prop('choices');
    this._choiceValues = Computed.create(this, (use) => use(this._choices) || []);
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId()];
    return cssChoiceField(
      cssChoiceText(
        dom.style('text-align', this.alignment),
        dom.text((use) => use(row._isAddRow) ? '' : use(this.valueFormatter).format(use(value))),
      ),
      this.buildDropdownMenu(),
    );
  }

  public buildConfigDom() {
    return [
      super.buildConfigDom(),
      cssLabel('OPTIONS'),
      cssRow(
        dom.create(ListEntry, this._choiceValues, (values) => this._choices.saveOnly(values))
      )
    ];
  }

  public buildTransformConfigDom() {
    return this.buildConfigDom();
  }

  protected getChoiceValues(): Computed<string[]> {
    return this._choiceValues;
  }

  protected buildDropdownMenu() {
    return cssDropdownIcon('Dropdown',
      // When choices exist, click dropdown icon to open edit autocomplete.
      dom.on('click', () => this._hasChoices() && commands.allCommands.editField.run()),
      // When choices do not exist, open a single-item menu to open the sidepane choice option editor.
      menu(() => [
        menuItem(commands.allCommands.fieldTabOpen.run, 'Add Choice Options')
      ], {
        trigger: [(elem, ctl) => {
          // Only open this menu if there are no choices.
          dom.onElem(elem, 'click', () => this._hasChoices() || ctl.open());
        }]
      }),
      testId('choice-dropdown')
    );
  }

  private _hasChoices() {
    return this._choiceValues.get().length > 0;
  }
}

const cssChoiceField = styled('div.field_clip', `
  display: flex;
`);

const cssChoiceText = styled('div', `
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssDropdownIcon = styled(icon, `
  cursor: pointer;
  background-color: ${colors.lightGreen};
  min-width: 16px;
  width: 16px;
  height: 16px;
  margin-left: auto;
`);
