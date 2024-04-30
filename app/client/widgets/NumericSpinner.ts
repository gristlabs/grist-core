import {theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {clamp, numberOrDefault} from 'app/common/gutil';
import {MaybePromise} from 'app/plugin/gutil';
import {BindableValue, dom, DomElementArg, IDomArgs, makeTestId, Observable, styled} from 'grainjs';

const testId = makeTestId('test-numeric-spinner-');

export interface NumericSpinnerOptions {
  /** Defaults to `false`. */
  setValueOnInput?: boolean;
  label?: string;
  defaultValue?: number | Observable<number>;
  /** No minimum if unset. */
  minValue?: number;
  /** No maximum if unset. */
  maxValue?: number;
  disabled?: BindableValue<boolean>;
  inputArgs?: IDomArgs<HTMLInputElement>;
  /** Called on blur and spinner button click. */
  save?: (val?: number) => MaybePromise<void>,
}

export function numericSpinner(
  value: Observable<number | ''>,
  options: NumericSpinnerOptions = {},
  ...args: DomElementArg[]
) {
  const {
    setValueOnInput = false,
    label,
    defaultValue,
    minValue = Number.NEGATIVE_INFINITY,
    maxValue = Number.POSITIVE_INFINITY,
    disabled,
    inputArgs = [],
    save,
  } = options;

  const getDefaultValue = () => {
    if (defaultValue === undefined) {
      return 0;
    } else if (typeof defaultValue === 'number') {
      return defaultValue;
    } else {
      return defaultValue.get();
    }
  };

  let inputElement: HTMLInputElement;

  const shiftValue = async (delta: 1 | -1, opts: {saveValue?: boolean} = {}) => {
    const {saveValue} = opts;
    const currentValue = numberOrDefault(inputElement.value, getDefaultValue());
    const newValue = clamp(Math.floor(currentValue + delta), minValue, maxValue);
    if (setValueOnInput) { value.set(newValue); }
    if (saveValue) { await save?.(newValue); }
    return newValue;
  };
  const incrementValue = (opts: {saveValue?: boolean} = {}) => shiftValue(1, opts);
  const decrementValue = (opts: {saveValue?: boolean} = {}) => shiftValue(-1, opts);

  return cssNumericSpinner(
    disabled ? cssNumericSpinner.cls('-disabled', disabled) : null,
    label ? cssNumLabel(label) : null,
    inputElement = cssNumInput(
      {type: 'number'},
      dom.prop('value', value),
      defaultValue !== undefined ? dom.prop('placeholder', defaultValue) : null,
      dom.onKeyDown({
        ArrowUp: async (_ev, elem) => { elem.value = String(await incrementValue()); },
        ArrowDown: async (_ev, elem) => { elem.value = String(await decrementValue()); },
        Enter$: async (_ev, elem) => save && elem.blur(),
      }),
      !setValueOnInput ? null : dom.on('input', (_ev, elem) => {
        value.set(Number.parseFloat(elem.value));
      }),
      !save ? null : dom.on('blur', async () => {
        let newValue = numberOrDefault(inputElement.value, undefined);
        if (newValue !== undefined) { newValue = clamp(newValue, minValue, maxValue); }
        await save(newValue);
      }),
      dom.on('focus', (_ev, elem) => elem.select()),
      ...inputArgs,
    ),
    cssSpinner(
      cssSpinnerBtn(
        cssSpinnerTop('DropdownUp'),
        dom.on('click', async () => incrementValue({saveValue: true})),
        testId('increment'),
      ),
      cssSpinnerBtn(
        cssSpinnerBottom('Dropdown'),
        dom.on('click', async () => decrementValue({saveValue: true})),
        testId('decrement'),
      ),
    ),
    ...args
  );
}

const cssNumericSpinner = styled('div', `
  position: relative;
  flex: auto;
  font-weight: normal;
  display: flex;
  align-items: center;
  outline: 1px solid ${theme.inputBorder};
  background-color: ${theme.inputBg};
  border-radius: 3px;
  &-disabled {
    opacity: 0.4;
    pointer-events: none;
  }
`);

const cssNumLabel = styled('div', `
  color: ${theme.lightText};
  flex-shrink: 0;
  padding-left: 8px;
  pointer-events: none;
`);

const cssNumInput = styled('input', `
  flex-grow: 1;
  padding: 4px 32px 4px 8px;
  width: 100%;
  text-align: right;
  appearance: none;
  color: ${theme.inputFg};
  background-color: transparent;
  border: none;
  outline: none;
  -moz-appearance: textfield;

  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
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
