/**
 * This is a temporary <input> element. The intended usage is to create is when needed (e.g. when
 * some "rename" option is chosen), and provide methods to save and to close.
 *
 * It calls save() on Enter and on blur, which should return a Promise. On successful save, and on
 * Escape, it calls close(), which should destroy the <input>.
 */

import {reportError} from 'app/client/models/AppModel';
import {theme} from 'app/client/ui2018/cssVars';
import {dom, DomArg, styled} from 'grainjs';

export interface ITransientInputOptions {
  initialValue: string;
  save(value: string): Promise<void>|any;
  close(): void;
}

export function transientInput({initialValue, save, close}: ITransientInputOptions,
                               ...args: Array<DomArg<HTMLInputElement>>) {
  let lastSave: string = initialValue;

  async function onSave(explicitSave: boolean) {
    try {
      if (explicitSave || input.value !== lastSave) {
        lastSave = input.value;
        await save(input.value);
      }
      close();
    } catch (err) {
      reportError(err);
      delayedFocus();
    }
  }

  function delayedFocus() {
    setTimeout(() => { input.focus(); input.select(); }, 10);
  }

  const input = cssInput({type: 'text', placeholder: 'Enter name'},
    dom.prop('value', initialValue),
    dom.on('blur', () => onSave(false)),
    dom.onKeyDown({
      Enter: () => onSave(true),
      Escape: () => close(),
    }),
    ...args,
  );
  delayedFocus();
  return input;
}

const cssInput = styled('input', `
  background-color: transparent;
  color: ${theme.inputFg};

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);
