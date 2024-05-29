/**
 * See app/common/NumberFormat for description of options we support.
 */
import {FormFieldRulesConfig} from 'app/client/components/Forms/FormConfig';
import {GristDoc} from 'app/client/components/GristDoc';
import {fromKoSave} from 'app/client/lib/fromKoSave';
import {makeT} from 'app/client/lib/localization';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {reportError} from 'app/client/models/errors';
import {fieldWithDefault} from 'app/client/models/modelUtil';
import {FormNumberFormat} from 'app/client/ui/FormAPI';
import {cssLabel, cssNumericSpinner, cssRow} from 'app/client/ui/RightPanelStyles';
import {buttonSelect, cssButtonSelect, ISelectorOption, makeButtonSelect} from 'app/client/ui2018/buttonSelect';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {buildCurrencyPicker} from 'app/client/widgets/CurrencyPicker';
import {NTextBox} from 'app/client/widgets/NTextBox';
import {numberOrDefault} from 'app/common/gutil';
import {buildNumberFormat, NumberFormatOptions, NumMode, NumSign} from 'app/common/NumberFormat';
import {Computed, dom, DomContents, fromKo, MultiHolder, styled} from 'grainjs';
import * as LocaleCurrency from 'locale-currency';

const t = makeT('NumericTextBox');

const modeOptions: Array<ISelectorOption<NumMode>> = [
  {value: 'currency', label: '$'},
  {value: 'decimal', label: ','},
  {value: 'percent', label: '%'},
  {value: 'scientific', label: 'Exp'}
];

const signOptions: Array<ISelectorOption<NumSign>> = [
  {value: 'parens', label: '(-)'},
];

/**
 * NumericTextBox - The most basic widget for displaying numeric information.
 */
export class NumericTextBox extends NTextBox {
  constructor(field: ViewFieldRec) {
    super(field);
  }

  public buildConfigDom(gristDoc: GristDoc): DomContents {
    // Holder for all computeds created here. It gets disposed with the returned DOM element.
    const holder = new MultiHolder();

    // Resolved options, to show default min/max decimals, which change depending on numMode.
    const resolved = Computed.create<Intl.ResolvedNumberFormatOptions>(holder, (use) => {
      const {numMode} = use(this.field.config.options);
      const docSettings = use(this.field.documentSettings);
      return buildNumberFormat({numMode}, docSettings).resolvedOptions();
    });

    // Prepare various observables that reflect the options in the UI.
    const fieldOptions = this.field.config.options;
    const options = fromKo(fieldOptions);
    const docSettings = fromKo(this.field.documentSettings);
    const numMode = Computed.create(holder, options, (use, opts) => (opts.numMode as NumMode) || null);
    const numSign = Computed.create(holder, options, (use, opts) => opts.numSign || null);
    const currency = Computed.create(holder, options, (use, opts) => opts.currency);
    const disabled = Computed.create(holder, use => use(this.field.config.options.disabled('currency')));
    const minDecimals = Computed.create(holder, options, (use, opts) => numberOrDefault(opts.decimals, ''));
    const maxDecimals = Computed.create(holder, options, (use, opts) => numberOrDefault(opts.maxDecimals, ''));
    const defaultMin = Computed.create(holder, resolved, (use, res) => res.minimumFractionDigits);
    const defaultMax = Computed.create(holder, resolved, (use, res) => res.maximumFractionDigits);
    const docCurrency = Computed.create(holder, docSettings, (use, settings) =>
      settings.currency ?? LocaleCurrency.getCurrency(settings.locale ?? 'en-US')
    );

    // Save a value as the given property in fieldOptions observable. Set it, save, and revert
    // on save error. This is similar to what modelUtil.setSaveValue() does.
    const setSave = (prop: keyof NumberFormatOptions, value: unknown) => {
      const orig = {...fieldOptions.peek()};
      if (value !== orig[prop]) {
        fieldOptions({...orig, [prop]: value, ...updateOptions(prop, value)});
        fieldOptions.save().catch((err) => { reportError(err); fieldOptions(orig); });
      }
    };

    // Prepare setters for the UI elements.
    // If defined, `val` will be a floating point number between 0 and 20; make sure it's
    // saved as an integer.
    const setMinDecimals = (val?: number) => setSave('decimals', val && Math.floor(val));
    const setMaxDecimals = (val?: number) => setSave('maxDecimals', val && Math.floor(val));
    // Mode and Sign behave as toggles: clicking a selected on deselects it.
    const setMode = (val: NumMode) => setSave('numMode', val !== numMode.get() ? val : undefined);
    const setSign = (val: NumSign) => setSave('numSign', val !== numSign.get() ? val : undefined);
    const setCurrency = (val: string|undefined) => setSave('currency', val);

    const disabledStyle = cssButtonSelect.cls('-disabled', disabled);

    return [
      super.buildConfigDom(gristDoc),
      cssLabel(t('Number Format')),
      cssRow(
        dom.autoDispose(holder),
        makeButtonSelect(numMode, modeOptions, setMode, disabledStyle, cssModeSelect.cls(''), testId('numeric-mode')),
        makeButtonSelect(numSign, signOptions, setSign, disabledStyle, cssSignSelect.cls(''), testId('numeric-sign')),
      ),
      dom.maybe((use) => use(numMode) === 'currency', () => [
        cssLabel(t('Currency')),
        cssRow(
          dom.domComputed(docCurrency, (defaultCurrency) =>
            buildCurrencyPicker(holder, currency, setCurrency,
              {defaultCurrencyLabel: t(`Default currency ({{defaultCurrency}})`, {defaultCurrency}), disabled})
          ),
          testId("numeric-currency")
        )
      ]),
      cssLabel(t('Decimals')),
      cssRow(
        cssNumericSpinner(
          minDecimals,
          {
            label: t('min'),
            minValue: 0,
            maxValue: 20,
            defaultValue: defaultMin,
            disabled,
            save: setMinDecimals,
          },
          testId('numeric-min-decimals'),
        ),
        cssNumericSpinner(
          maxDecimals,
          {
            label: t('max'),
            minValue: 0,
            maxValue: 20,
            defaultValue: defaultMax,
            disabled,
            save: setMaxDecimals,
          },
          testId('numeric-max-decimals'),
        ),
      ),
    ];
  }


  public buildFormConfigDom(): DomContents {
    const format = fieldWithDefault<FormNumberFormat>(
      this.field.widgetOptionsJson.prop('formNumberFormat'),
      'text'
    );

    return [
      cssLabel(t('Field Format')),
      cssRow(
        buttonSelect(
          fromKoSave(format),
          [
            {value: 'text', label: t('Text')},
            {value: 'spinner', label: t('Spinner')},
          ],
          testId('numeric-form-field-format'),
        ),
      ),
      dom.create(FormFieldRulesConfig, this.field),
    ];
  }
}

// Helper used by setSave() above to reset some properties when switching modes.
function updateOptions(prop: keyof NumberFormatOptions, value: unknown): Partial<NumberFormatOptions> {
  // Reset the numSign to default when toggling mode to percent or scientific.
  if (prop === 'numMode' && (!value || value === 'scientific' || value === 'percent')) {
    return {numSign: undefined};
  }
  return {};
}

const cssModeSelect = styled(makeButtonSelect, `
  flex: 4 4 0px;
  background-color: ${theme.inputBg};
`);

const cssSignSelect = styled(makeButtonSelect, `
  flex: 1 1 0px;
  background-color: ${theme.inputBg};
  margin-left: 16px;
`);
