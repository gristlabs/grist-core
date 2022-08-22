import {colors, vars} from 'app/client/ui2018/cssVars';
import {dom, DomElementArg, Observable, styled} from 'grainjs';

export const cssInput = styled('input', `
  font-size: ${vars.mediumFontSize};
  height: 48px;
  line-height: 20px;
  width: 100%;
  padding: 14px;
  border: 1px solid #D9D9D9;
  border-radius: 4px;
  outline: none;
  display: block;

  &[type=number] {
    -moz-appearance: textfield;
  }
  &[type=number]::-webkit-inner-spin-button,
  &[type=number]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  &-invalid {
    border: 1px solid ${colors.error};
  }

  &-valid {
    border: 1px solid ${colors.lightGreen};
  }
`);

/**
 * Builds a text input that updates `obs` as you type.
 */
export function textInput(obs: Observable<string>, ...args: DomElementArg[]): HTMLInputElement {
  return cssInput(
    dom.prop('value', obs),
    dom.on('input', (_e, elem) => obs.set(elem.value)),
    ...args,
  );
}
