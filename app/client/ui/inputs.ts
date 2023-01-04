import {theme, vars} from 'app/client/ui2018/cssVars';
import {dom, DomElementArg, IDomArgs, IInputOptions, Observable, styled, subscribe} from 'grainjs';

export const cssInput = styled('input', `
  font-size: ${vars.mediumFontSize};
  height: 48px;
  line-height: 20px;
  width: 100%;
  padding: 14px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 4px;
  outline: none;
  display: block;
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }

  &[type=number] {
    -moz-appearance: textfield;
  }
  &[type=number]::-webkit-inner-spin-button,
  &[type=number]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  &-invalid {
    border: 1px solid ${theme.inputInvalid};
  }

  &-valid {
    border: 1px solid ${theme.inputValid};
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

export function textarea(
  obs: Observable<string>, options: IInputOptions, ...args: IDomArgs<HTMLTextAreaElement>
): HTMLTextAreaElement {

  const isValid = options.isValid;

  function setValue(elem: HTMLTextAreaElement) {
    obs.set(elem.value);
    if (isValid) { isValid.set(elem.validity.valid); }
  }

  return dom('textarea', ...args,
    dom.prop('value', obs),
    (isValid ?
      (elem) => dom.autoDisposeElem(elem,
        subscribe(obs, (use) => isValid.set(elem.checkValidity()))) :
      null),
    options.onInput ? dom.on('input', (e, elem) => setValue(elem)) : null,
    dom.on('change', (e, elem) => setValue(elem)),
  );
}