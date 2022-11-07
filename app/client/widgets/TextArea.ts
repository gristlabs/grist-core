import {theme} from 'app/client/ui2018/cssVars';
import {dom, DomArg, Observable, styled} from 'grainjs';

const cssTextArea = styled('textarea', `
  min-height: 5em;
  border-radius: 3px;
  padding: 4px 6px;
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  border: 1px solid ${theme.inputBorder};
  outline: none;
  width: 100%;
  resize: none;
  max-height: 10em;
  &-comment, &-reply {
    min-height: 28px;
    height: 28px;
  }
  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);

function bindProp(text: Observable<string>) {
  return [
    dom.prop('value', text),
    dom.on('input', (_, el: HTMLTextAreaElement) => text.set(el.value)),
  ];
}

function autoFocus() {
  return (el: HTMLElement) => void setTimeout(() => el.focus(), 10);
}

function autoGrow(text: Observable<string>) {
  return (el: HTMLTextAreaElement) => {
    el.addEventListener('input', () => resize(el));
    setTimeout(() => resize(el), 10);
    dom.autoDisposeElem(el, text.addListener(val => {
      // Changes to the text are not reflected by the input event (witch is used by the autoGrow)
      // So we need to manually update the textarea when the text is cleared.
      if (!val) {
        el.style.height = '5px'; // there is a min-height css attribute, so this is only to trigger a style update.
      }
    }));
  };
}

function resize(el: HTMLTextAreaElement) {
  el.style.height = '5px'; // hack for triggering style update.
  const border = getComputedStyle(el, null).borderTopWidth || "0";
  el.style.height = `calc(${el.scrollHeight}px + 2 * ${border})`;
}

export function buildTextEditor(text: Observable<string>, ...args: DomArg<HTMLTextAreaElement>[]) {
  return cssTextArea(
    bindProp(text),
    autoFocus(),
    autoGrow(text),
    ...args
  );
}
