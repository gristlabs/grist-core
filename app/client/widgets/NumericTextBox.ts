/**
 * See app/common/NumberFormat for description of options we support.
 */
import {makeT} from 'app/client/lib/localization';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {reportError} from 'app/client/models/errors';
import {cssLabel, cssRow} from 'app/client/ui/RightPanelStyles';
import {cssButtonSelect, ISelectorOption, makeButtonSelect} from 'app/client/ui2018/buttonSelect';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {buildCurrencyPicker} from 'app/client/widgets/CurrencyPicker';
import {NTextBox} from 'app/client/widgets/NTextBox';
import {clamp} from 'app/common/gutil';
import {buildNumberFormat, NumberFormatOptions, NumMode, NumSign} from 'app/common/NumberFormat';
import {BindableValue, Computed, dom, DomContents, DomElementArg,
        fromKo, MultiHolder, Observable, styled} from 'grainjs';
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

  public buildConfigDom(): DomContents {
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
    // Min/max fraction digits may range from 0 to 20; other values are invalid.
    const setMinDecimals = (val?: number) => setSave('decimals', val && clamp(val, 0, 20));
    const setMaxDecimals = (val?: number) => setSave('maxDecimals', val && clamp(val, 0, 20));
    // Mode and Sign behave as toggles: clicking a selected on deselects it.
    const setMode = (val: NumMode) => setSave('numMode', val !== numMode.get() ? val : undefined);
    const setSign = (val: NumSign) => setSave('numSign', val !== numSign.get() ? val : undefined);
    const setCurrency = (val: string|undefined) => setSave('currency', val);

    const disabledStyle = cssButtonSelect.cls('-disabled', disabled);

    return [
      super.buildConfigDom(),
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
        decimals('min', minDecimals, defaultMin, setMinDecimals, disabled, testId('numeric-min-decimals')),
        decimals('max', maxDecimals, defaultMax, setMaxDecimals, disabled, testId('numeric-max-decimals')),
      ),
    ];
  }
}


function numberOrDefault<T>(value: unknown, def: T): number | T {
  return value !== null && value !== undefined ? Number(value) : def;
}

// Helper used by setSave() above to reset some properties when switching modes.
function updateOptions(prop: keyof NumberFormatOptions, value: unknown): Partial<NumberFormatOptions> {
  // Reset the numSign to default when toggling mode to percent or scientific.
  if (prop === 'numMode' && (!value || value === 'scientific' || value === 'percent')) {
    return {numSign: undefined};
  }
  return {};
}

function decimals(
  label: string,
  value: Observable<number | ''>,
  defaultValue: Observable<number>,
  setFunc: (val?: number) => void,
  disabled: BindableValue<boolean>,
  ...args: DomElementArg[]
) {
  return cssDecimalsBox(
    cssDecimalsBox.cls('-disabled', disabled),
    cssNumLabel(label),
    cssNumInput({type: 'text', size: '2', min: '0'},
      dom.prop('value', value),
      dom.prop('placeholder', defaultValue),
      dom.on('change', (ev, elem) => {
        const newVal = parseInt(elem.value, 10);
        // Set value explicitly before its updated via setFunc; this way the value reflects the
        // observable in the case the observable is left unchanged (e.g. because of clamping).
        elem.value = String(value.get());
        setFunc(Number.isNaN(newVal) ? undefined : newVal);
        elem.blur();
      }),
      dom.on('focus', (ev, elem) => elem.select()),
    ),
    cssSpinner(
      cssSpinnerBtn(cssSpinnerTop('DropdownUp'),
        dom.on('click', () => setFunc(numberOrDefault(value.get(), defaultValue.get()) + 1))),
      cssSpinnerBtn(cssSpinnerBottom('Dropdown'),
        dom.on('click', () => setFunc(numberOrDefault(value.get(), defaultValue.get()) - 1))),
    ),
    ...args
  );
}

const cssDecimalsBox = styled('div', `
  position: relative;
  flex: auto;
  --icon-color: ${theme.lightText};
  color: ${theme.lightText};
  font-weight: normal;
  display: flex;
  align-items: center;
  &:first-child {
    margin-right: 16px;
  }
  &-disabled {
    opacity: 0.4;
    pointer-events: none;
  }
`);

const cssNumLabel = styled('div', `
  position: absolute;
  padding-left: 8px;
  pointer-events: none;
`);

const cssNumInput = styled('input', `
  padding: 4px 32px 4px 40px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 3px;
  background-color: ${theme.inputBg};
  color: ${theme.inputFg};
  width: 100%;
  text-align: right;
  appearance: none;
  -moz-appearance: none;
  -webkit-appearance: none;
`);

const cssSpinner = styled('div', `
  position: absolute;
  right: 8px;
  width: 16px;
  height: 100%;
  display: flex;
  flex-direction: column;
`);

const cssSpinnerBtn = styled('div', `
  --icon-color: ${theme.controlSecondaryFg};
  flex: 1 1 0px;
  min-height: 0px;
  position: relative;
  cursor: pointer;
  overflow: hidden;
  &:hover {
    --icon-color: ${theme.controlSecondaryHoverFg};
  }
`);

const cssSpinnerTop = styled(icon, `
  position: absolute;
  top: 0px;
`);

const cssSpinnerBottom = styled(icon, `
  position: absolute;
  bottom: 0px;
`);

const cssModeSelect = styled(makeButtonSelect, `
  flex: 4 4 0px;
  background-color: ${theme.inputBg};
`);

const cssSignSelect = styled(makeButtonSelect, `
  flex: 1 1 0px;
  background-color: ${theme.inputBg};
  margin-left: 16px;
`);
