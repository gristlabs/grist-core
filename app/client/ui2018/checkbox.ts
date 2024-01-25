/**
 * UI 2018 Checkboxes
 *
 * Includes:
 *  - squareCheckbox
 *  - circleCheckbox
 *  - labeledSquareCheckbox
 *  - labeledCircleCheckbox
 *
 * Checkboxes support passing in DomElementArgs, which can be used to register click handlers, set
 * the disabled property, and other HTML <input> element behaviors.
 *
 * Examples:
 *  squareCheckbox(observable(true)),
 *  labeledSquareCheckbox(observable(false), 'Include other values', dom.prop('disabled', true)),
 */

import {testId, theme} from 'app/client/ui2018/cssVars';
import {Computed, dom, DomArg, DomContents, Observable, styled} from 'grainjs';

export const cssLabel = styled('label', `
  position: relative;
  display: inline-flex;
  min-width: 0px;
  margin-bottom: 0px;

  outline: none;
  user-select: none;

  --color: ${theme.checkboxBorder};
  &:hover {
    --color: ${theme.checkboxBorderHover};
  }
`);



// TODO: the !important markings are to trump bootstrap, and should be removed when it's gone.
export const cssCheckboxSquare = styled('input', `
  -webkit-appearance: none;
  -moz-appearance: none;
  margin: 0 !important;
  padding: 0;

  flex-shrink: 0;

  display: inline-block;
  width: 16px;
  height: 16px;
  outline: none !important;

  --radius: 3px;

  &:checked:enabled, &:indeterminate:enabled {
    --color: ${theme.controlPrimaryBg};
  }

  &:disabled {
    --color: ${theme.checkboxDisabledBg};
    cursor: not-allowed;
  }

  &::before, &::after {
    content: '';

    position: absolute;
    top: 0;
    left: 0;

    height: 16px;
    width: 16px;

    box-sizing: border-box;
    border: 1px solid var(--color);
    border-radius: var(--radius);
  }

  &:checked::before, &:disabled::before, &:indeterminate::before {
    background-color: var(--color);
  }

  &:not(:checked):indeterminate::after {
    -webkit-mask-image: var(--icon-Minus);
  }

  &:not(:disabled)::after {
    background-color: ${theme.checkboxBg};
  }

  &:checked::after, &:indeterminate::after {
    content: '';
    position: absolute;
    height: 16px;
    width: 16px;
    -webkit-mask-image: var(--icon-Tick);
    -webkit-mask-size: contain;
    -webkit-mask-position: center;
    -webkit-mask-repeat: no-repeat;
    background-color: ${theme.controlPrimaryFg};
  }
`);

export const cssCheckboxCircle = styled(cssCheckboxSquare, `
  --radius: 100%;
`);

export const cssLabelText = styled('span', `
  margin-left: 8px;
  color: ${theme.text};
  font-weight: initial;   /* negate bootstrap */
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 16px;
`);

type CheckboxArg = DomArg<HTMLInputElement>;

function checkbox(
  obs: Observable<boolean>, cssCheckbox: typeof cssCheckboxSquare,
  label: DomArg, right: boolean,  ...domArgs: CheckboxArg[]
) {
  const field = cssCheckbox(
      { type: 'checkbox' },
      dom.prop('checked', obs),
      dom.on('change', (ev, el) => obs.set(el.checked)),
      ...domArgs
    );
  const text = label ? cssLabelText(label) : null;
  if (right) {
    return cssReversedLabel([text, cssInlineRelative(field)]);
  }
  return cssLabel(field, text);
}

export function squareCheckbox(obs: Observable<boolean>, ...domArgs: CheckboxArg[]) {
  return checkbox(obs, cssCheckboxSquare, '', false, ...domArgs);
}

export function circleCheckbox(obs: Observable<boolean>, ...domArgs: CheckboxArg[]) {
  return checkbox(obs, cssCheckboxCircle, '', false, ...domArgs);
}

export function labeledSquareCheckbox(obs: Observable<boolean>, label: DomArg, ...domArgs: CheckboxArg[]) {
  return checkbox(obs, cssCheckboxSquare, label, false, ...domArgs);
}

export function labeledLeftSquareCheckbox(obs: Observable<boolean>, label: DomArg, ...domArgs: CheckboxArg[]) {
  return checkbox(obs, cssCheckboxSquare, label, true, ...domArgs);
}

export function labeledCircleCheckbox(obs: Observable<boolean>, label: DomArg, ...domArgs: CheckboxArg[]) {
  return checkbox(obs, cssCheckboxCircle, label, false, ...domArgs);
}

export const Indeterminate = 'indeterminate';
export type TriState = boolean|'indeterminate';

function triStateCheckbox(
  obs: Observable<TriState>, cssCheckbox: typeof cssCheckboxSquare, label: string = '',  ...domArgs: CheckboxArg[]
) {
  const checkboxObs = Computed.create(null, obs, (_use, state) => state === true)
    .onWrite((checked) => obs.set(checked));
  return checkbox(
    checkboxObs, cssCheckbox, label, false,
    dom.prop('indeterminate', (use) => use(obs) === 'indeterminate'),
    dom.autoDispose(checkboxObs),
    ...domArgs
  );
}

export function triStateSquareCheckbox(obs: Observable<TriState>, ...domArgs: CheckboxArg[]) {
  return triStateCheckbox(obs, cssCheckboxSquare, '', ...domArgs);
}

export function labeledTriStateSquareCheckbox(obs: Observable<TriState>, label: string, ...domArgs: CheckboxArg[]) {
  return triStateCheckbox(obs, cssCheckboxSquare, label, ...domArgs);
}

export function radioCheckboxOption<T>(selectedObservable: Observable<T>, optionId: T, content: DomContents) {
  const selected = Computed.create(null, use => use(selectedObservable) === optionId)
    .onWrite(val => val ? selectedObservable.set(optionId) : void 0);
  return dom.update(
    labeledCircleCheckbox(selected, content, dom.autoDispose(selected)),
    testId(`option-${optionId}`),
    cssBlockCheckbox.cls(''),
    cssBlockCheckbox.cls('-block', selected),
  );
}

export const cssRadioCheckboxOptions = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 10px;
`);

// We need to reset top and left of ::before element, as it is wrongly set
// on the inline checkbox.
// To simulate radio button behavior, we will block user input after option is selected, because
// checkbox doesn't support two-way binding.
const cssBlockCheckbox = styled('div', `
  display: flex;
  padding: 10px 8px;
  border: 1px solid ${theme.controlSecondaryDisabledFg};
  border-radius: 3px;
  cursor: pointer;
  & input::before, & input::after  {
    top: unset;
    left: unset;
  }
  &:hover {
    border-color: ${theme.controlFg};
  }
  &-block {
    pointer-events: none;
  }
  &-block a {
    pointer-events: all;
  }
`);

const cssInlineRelative = styled('div', `
  display: inline-block;
  position: relative;
  height: 16px;
`);

const cssReversedLabel = styled(cssLabel, `
  justify-content: space-between;
  gap: 8px;
  & .${cssLabelText.className} {
    margin: 0px;
  }
`);
