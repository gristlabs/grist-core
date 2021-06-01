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

import { colors } from 'app/client/ui2018/cssVars';
import { Computed, dom, DomArg, styled } from 'grainjs';
import { Observable } from 'grainjs';

export const cssLabel = styled('label', `
  position: relative;
  display: inline-flex;
  min-width: 0px;
  margin-bottom: 0px;

  outline: none;
  user-select: none;

  --color: ${colors.darkGrey};
  &:hover {
    --color: ${colors.hover};
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
    --color: ${colors.lightGreen};
  }

  &:disabled {
    --color: ${colors.darkGrey};
    cursor: not-allowed;
  }

  .${cssLabel.className}:hover > &:checked:enabled,
  .${cssLabel.className}:hover > &:indeterminate:enabled, {
    --color: ${colors.darkGreen};
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

  &:checked::after, &:indeterminate::after {
    content: '';
    position: absolute;
    height: 16px;
    width: 16px;
    -webkit-mask-image: var(--icon-Tick);
    -webkit-mask-size: contain;
    -webkit-mask-position: center;
    -webkit-mask-repeat: no-repeat;
    background-color: ${colors.light};
  }

  &:not(:checked):indeterminate::after {
    -webkit-mask-image: var(--icon-Minus);
  }

  &:not(:disabled)::after {
    background-color: ${colors.light};
  }
`);

export const cssCheckboxCircle = styled(cssCheckboxSquare, `
  --radius: 100%;
`);

export const cssLabelText = styled('span', `
  margin-left: 8px;
  color: ${colors.dark};
  font-weight: initial;   /* negate bootstrap */
  overflow: hidden;
  text-overflow: ellipsis;
`);

type CheckboxArg = DomArg<HTMLInputElement>;

function checkbox(
  obs: Observable<boolean>, cssCheckbox: typeof cssCheckboxSquare, label: string = '',  ...domArgs: CheckboxArg[]
) {
  return cssLabel(
    cssCheckbox(
      { type: 'checkbox' },
      dom.prop('checked', obs),
      dom.on('change', (ev, el) => obs.set(el.checked)),
      ...domArgs
    ),
    label ? cssLabelText(label) : null
  );
}

export function squareCheckbox(obs: Observable<boolean>, ...domArgs: CheckboxArg[]) {
  return checkbox(obs, cssCheckboxSquare, '', ...domArgs);
}

export function circleCheckbox(obs: Observable<boolean>, ...domArgs: CheckboxArg[]) {
  return checkbox(obs, cssCheckboxCircle, '', ...domArgs);
}

export function labeledSquareCheckbox(obs: Observable<boolean>, label: string, ...domArgs: CheckboxArg[]) {
  return checkbox(obs, cssCheckboxSquare, label, ...domArgs);
}

export function labeledCircleCheckbox(obs: Observable<boolean>, label: string, ...domArgs: CheckboxArg[]) {
  return checkbox(obs, cssCheckboxCircle, label, ...domArgs);
}

export const Indeterminate = 'indeterminate';
export type TriState = boolean|'indeterminate';

function triStateCheckbox(
  obs: Observable<TriState>, cssCheckbox: typeof cssCheckboxSquare, label: string = '',  ...domArgs: CheckboxArg[]
) {
  const checkboxObs = Computed.create(null, obs, (_use, state) => state === true)
    .onWrite((checked) => obs.set(checked));
  return checkbox(
    checkboxObs, cssCheckbox, label,
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
