import * as commands from 'app/client/components/commands';
import {ChoiceListEntry} from 'app/client/widgets/ChoiceListEntry';
import {DataRowModel} from 'app/client/models/DataRowModel';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import {cssLabel, cssRow} from 'app/client/ui/RightPanel';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuItem} from 'app/client/ui2018/menus';
import {NTextBox} from 'app/client/widgets/NTextBox';
import {Computed, dom, styled} from 'grainjs';

export interface IChoiceOptions {
  textColor: string;
  fillColor: string;
}

export type ChoiceOptions = Record<string, IChoiceOptions | undefined>;
export type ChoiceOptionsByName = Map<string, IChoiceOptions | undefined>;

const DEFAULT_FILL_COLOR = colors.mediumGreyOpaque.value;
export const DEFAULT_TEXT_COLOR = '#000000';

export function getFillColor(choiceOptions?: IChoiceOptions) {
  return choiceOptions?.fillColor ?? DEFAULT_FILL_COLOR;
}

export function getTextColor(choiceOptions?: IChoiceOptions) {
  return choiceOptions?.textColor ?? DEFAULT_TEXT_COLOR;
}

/**
 * ChoiceTextBox - A textbox for choice values.
 */
export class ChoiceTextBox extends NTextBox {
  private _choices: KoSaveableObservable<string[]>;
  private _choiceValues: Computed<string[]>;
  private _choiceOptions: KoSaveableObservable<ChoiceOptions | null | undefined>;
  private _choiceOptionsByName: Computed<ChoiceOptionsByName>

  constructor(field: ViewFieldRec) {
    super(field);
    this._choices = this.options.prop('choices');
    this._choiceOptions = this.options.prop('choiceOptions');
    this._choiceValues = Computed.create(this, (use) => use(this._choices) || []);
    this._choiceOptionsByName = Computed.create(this, (use) => toMap(use(this._choiceOptions)));
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId()];
    return cssChoiceField(
      cssChoiceTextWrapper(
        dom.style('justify-content', (use) => use(this.alignment) === 'right' ? 'flex-end' : use(this.alignment)),
        dom.domComputed((use) => {
          if (use(row._isAddRow)) { return cssChoiceText(''); }

          const formattedValue = use(this.valueFormatter).format(use(value));
          if (formattedValue === '') { return cssChoiceText(''); }

          const choiceOptions = use(this._choiceOptionsByName).get(formattedValue);
          return cssChoiceText(
            dom.style('background-color', getFillColor(choiceOptions)),
            dom.style('color', getTextColor(choiceOptions)),
            formattedValue,
            testId('choice-text')
          );
        }),
      ),
      this.buildDropdownMenu(),
    );
  }

  public buildConfigDom() {
    return [
      super.buildConfigDom(),
      cssLabel('CHOICES'),
      cssRow(
        dom.create(
          ChoiceListEntry,
          this._choiceValues,
          this._choiceOptionsByName,
          (choices, choiceOptions) => {
            return this.options.setAndSave({
              ...this.options.peek(),
              choices,
              choiceOptions: toObject(choiceOptions)
            });
          }
        )
      )
    ];
  }

  public buildTransformConfigDom() {
    return this.buildConfigDom();
  }

  protected getChoiceValues(): Computed<string[]> {
    return this._choiceValues;
  }

  protected getChoiceOptions(): Computed<ChoiceOptionsByName> {
    return this._choiceOptionsByName;
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

// Converts a POJO containing choice options to an ES6 Map
function toMap(choiceOptions?: ChoiceOptions | null): ChoiceOptionsByName {
  if (!choiceOptions) { return new Map(); }

  return new Map(Object.entries(choiceOptions));
}

// Converts an ES6 Map containing choice options to a POJO
function toObject(choiceOptions: ChoiceOptionsByName): ChoiceOptions {
  const object: ChoiceOptions = {};
  for (const [choice, options] of choiceOptions.entries()) {
    object[choice] = options;
  }
  return object;
}

const cssChoiceField = styled('div.field_clip', `
  display: flex;
  align-items: center;
  padding: 0 3px;
`);

const cssChoiceTextWrapper = styled('div', `
  display: flex;
  width: 100%;
  min-width: 0px;
  overflow: hidden;
`);

const cssChoiceText = styled('div', `
  border-radius: 3px;
  padding: 1px 4px;
  margin: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  height: min-content;
  line-height: 16px;
`);

const cssDropdownIcon = styled(icon, `
  cursor: pointer;
  background-color: ${colors.lightGreen};
  min-width: 16px;
  width: 16px;
  height: 16px;
  margin-left: auto;
`);
