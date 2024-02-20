import {makeT} from 'app/client/lib/localization';
import {DataRowModel} from 'app/client/models/DataRowModel';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import {Style} from 'app/client/models/Styles';
import {cssLabel, cssRow} from 'app/client/ui/RightPanelStyles';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {ChoiceListEntry} from 'app/client/widgets/ChoiceListEntry';
import {choiceToken, DEFAULT_BACKGROUND_COLOR, DEFAULT_COLOR} from 'app/client/widgets/ChoiceToken';
import {NTextBox} from 'app/client/widgets/NTextBox';
import {Computed, dom, styled} from 'grainjs';

export type IChoiceOptions = Style
export type ChoiceOptions = Record<string, IChoiceOptions | undefined>;
export type ChoiceOptionsByName = Map<string, IChoiceOptions | undefined>;

const t = makeT('ChoiceTextBox');

export function getRenderFillColor(choiceOptions?: IChoiceOptions) {
  return choiceOptions?.fillColor ?? DEFAULT_BACKGROUND_COLOR;
}

export function getRenderTextColor(choiceOptions?: IChoiceOptions) {
  return choiceOptions?.textColor ?? DEFAULT_COLOR;
}

/**
 * ChoiceTextBox - A textbox for choice values.
 */
export class ChoiceTextBox extends NTextBox {
  private _choices: KoSaveableObservable<string[]>;
  private _choiceValues: Computed<string[]>;
  private _choiceValuesSet: Computed<Set<string>>;
  private _choiceOptions: KoSaveableObservable<ChoiceOptions | null | undefined>;
  private _choiceOptionsByName: Computed<ChoiceOptionsByName>;

  constructor(field: ViewFieldRec) {
    super(field);
    this._choices = this.options.prop('choices');
    this._choiceOptions = this.options.prop('choiceOptions');
    this._choiceValues = Computed.create(this, (use) => use(this._choices) || []);
    this._choiceValuesSet = Computed.create(this, this._choiceValues, (_use, values) => new Set(values));
    this._choiceOptionsByName = Computed.create(this, (use) => toMap(use(this._choiceOptions)));
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId()];
    const isSingle = this.field.viewSection().parentKey() === "single";
    const maybeDropDownCssChoiceEditIcon = isSingle ? cssChoiceEditIcon('Dropdown') : null;

    return cssChoiceField(
      cssChoiceTextWrapper(
        dom.style('justify-content', (use) => use(this.alignment) === 'right' ? 'flex-end' : use(this.alignment)),
        maybeDropDownCssChoiceEditIcon,
        dom.domComputed((use) => {
          if (this.isDisposed() || use(row._isAddRow)) { return null; }

          const formattedValue = use(this.valueFormatter).formatAny(use(value));
          if (formattedValue === '') { return null; }

          return choiceToken(
            formattedValue,
            {
              ...(use(this._choiceOptionsByName).get(formattedValue) || {}),
              invalid: !use(this._choiceValuesSet).has(formattedValue),
            },
            dom.cls(cssChoiceText.className),
            testId('choice-token')
          );
        }),
      ),
    );
  }

  public buildConfigDom() {
    return [
      super.buildConfigDom(),
      this._buildChoicesConfigDom(),
    ];
  }

  public buildTransformConfigDom() {
    return this.buildConfigDom();
  }

  public buildFormConfigDom() {
    return [
      this._buildChoicesConfigDom(),
      super.buildFormConfigDom(),
    ];
  }

  public buildFormTransformConfigDom() {
    return [
      this._buildChoicesConfigDom(),
    ];
  }

  protected getChoiceValuesSet(): Computed<Set<string>> {
    return this._choiceValuesSet;
  }

  protected getChoiceOptions(): Computed<ChoiceOptionsByName> {
    return this._choiceOptionsByName;
  }

  protected save(choices: string[], choiceOptions: ChoiceOptionsByName, renames: Record<string, string>) {
    const options = {
      choices,
      choiceOptions: toObject(choiceOptions)
    };
    return this.field.config.updateChoices(renames, options);
  }

  private _buildChoicesConfigDom() {
    const disabled = Computed.create(null,
      use => use(this.field.disableModify)
        || use(use(this.field.column).disableEditData)
        || use(this.field.config.options.disabled('choices'))
      );

    const mixed = Computed.create(null,
      use => !use(disabled)
        && (use(this.field.config.options.mixed('choices')) || use(this.field.config.options.mixed('choiceOptions')))
      );

    return [
      cssLabel(t('CHOICES')),
      cssRow(
        dom.autoDispose(disabled),
        dom.autoDispose(mixed),
        dom.create(
          ChoiceListEntry,
          this._choiceValues,
          this._choiceOptionsByName,
          this.save.bind(this),
          disabled,
          mixed
        )
      )
    ];
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
  padding: 0 3px;
`);

const cssChoiceTextWrapper = styled('div', `
  display: flex;
  width: 100%;
  min-width: 0px;
  overflow: hidden;
`);

const cssChoiceText = styled('div', `
  margin: 2px;
  height: min-content;
  line-height: 16px;
`);

const cssChoiceEditIcon = styled(icon, `
  background-color: ${theme.lightText};
  display: block;
  height: inherit;
`);
