import {autoGrow} from 'app/client/ui/forms';
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
export function textInput(obs: Observable<string|undefined>, ...args: DomElementArg[]): HTMLInputElement {
  return cssInput(
    dom.prop('value', u => u(obs) || ''),
    dom.on('input', (_e, elem) => obs.set(elem.value)),
    ...args,
  );
}

export interface ITextAreaOptions extends IInputOptions {
  autoGrow?: boolean;
  save?: (value: string) => void;
}

export function textarea(
  obs: Observable<string>, options?: ITextAreaOptions|null, ...args: IDomArgs<HTMLTextAreaElement>
): HTMLTextAreaElement {

  const isValid = options?.isValid;

  function setValue(elem: HTMLTextAreaElement) {
    if (options?.save) { options.save(elem.value); }
    else { obs.set(elem.value); }
    if (isValid) { isValid.set(elem.validity.valid); }
  }

  const value = options?.autoGrow ? Observable.create(null, obs.get()) : null;
  const trackInput = Boolean(options?.onInput || options?.autoGrow);
  const onInput = trackInput ? dom.on('input', (e, elem: HTMLTextAreaElement) => {
    if (options?.onInput) {
      setValue(elem);
    }
    if (options?.autoGrow) {
      value?.set(elem.value);
    }
  }) : null;


  return dom('textarea', ...args,
    value ? [
      dom.autoDispose(value),
      dom.autoDispose(obs.addListener(v => value.set(v))),
    ] : null,
    dom.prop('value', use => use(obs) ?? ''),
    (isValid ?
      (elem) => dom.autoDisposeElem(elem,
        subscribe(obs, (use) => isValid.set(elem.checkValidity()))) :
      null),
    onInput,
    options?.autoGrow ? [
      autoGrow(value!),
      dom.style('resize', 'none')
    ] : null,
    dom.on('change', (e, elem) => setValue(elem)),
  );
}
