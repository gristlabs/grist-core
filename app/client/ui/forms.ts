/**
 * Collection of styled elements to put together basic forms. Intended usage is:
 *
 *   return forms.form({method: 'POST',
 *     forms.question(
 *       forms.text('What color is the sky right now?'),
 *       forms.checkboxItem([{name: 'sky-blue'}], 'Blue'),
 *       forms.checkboxItem([{name: 'sky-orange'}], 'Orange'),
 *       forms.checkboxOther([], {name: 'sky-other', placeholder: 'Other...'}),
 *     ),
 *     forms.question(
 *       forms.text('What is the meaning of life, universe, and everything?'),
 *       forms.textBox({name: 'meaning', placeholder: 'Your answer'}),
 *     ),
 *   );
 */
import {cssCheckboxSquare, cssLabel} from 'app/client/ui2018/checkbox';
import {dom, DomArg, DomElementArg, Observable, styled} from 'grainjs';

export {
  form,
  cssQuestion as question,
  cssText as text,
  textBox,
};


/**
 * Create a checkbox accompanied by a label. The first argument should be the (possibly empty)
 * array of arguments to the checkbox; the rest goes into the label. E.g.
 *    checkboxItem([{name: 'ok'}], 'Check to approve');
 */
export function checkboxItem(
  checkboxArgs: Array<DomArg<HTMLInputElement>>, ...labelArgs: DomElementArg[]
): HTMLElement {
  return cssCheckboxLabel(
    cssCheckbox({type: 'checkbox'}, ...checkboxArgs),
    ...labelArgs);
}

/**
 * Create a checkbox accompanied by a textbox, for a choice of "Other". The checkbox gets checked
 * automatically when something is typed into the textbox.
 *    checkboxOther([{name: 'choice-other'}], {name: 'other-text', placeholder: '...'});
 */
export function checkboxOther(checkboxArgs: DomElementArg[], ...textboxArgs: DomElementArg[]): HTMLElement {
  let checkbox: HTMLInputElement;
  return cssCheckboxLabel(
    checkbox = cssCheckbox({type: 'checkbox'}, ...checkboxArgs),
    cssTextBox(...textboxArgs,
      dom.on('input', (e, elem) => { checkbox.checked = Boolean(elem.value); }),
    ),
  );
}

/**
 * Returns whether the form is fully filled, i.e. has a value for each of the provided names of
 * form elements. If a name ends with "*", it is treated as a prefix, and any element matching it
 * would satisfy this key (e.g. use "foo_*" to accept any checkbox named "foo_<something>").
 */
export function isFormFilled(formElem: HTMLFormElement, names: string[]): boolean {
  const formData = new FormData(formElem);
  return names.every(name => hasValue(formData, name));
}

/**
 * Returns true of the form includes a non-empty value for the given name. If the second argument
 * ends with "-", it is treated as a prefix, and the function returns true if the form includes
 * any value for a key that starts with that prefix.
 */
export function hasValue(formData: FormData, nameOrPrefix: string): boolean {
  if (nameOrPrefix.endsWith('*')) {
    const prefix = nameOrPrefix.slice(0, -1);
    return [...formData.keys()].filter(k => k.startsWith(prefix)).some(k => formData.get(k));
  } else {
    return Boolean(formData.get(nameOrPrefix));
  }
}

function resize(el: HTMLTextAreaElement) {
  el.style.height = '5px'; // hack for triggering style update.
  const border = getComputedStyle(el, null).borderTopWidth || "0";
  el.style.height = `calc(${el.scrollHeight}px + 2 * ${border})`;
}

export function autoGrow(text: Observable<string>) {
   // If this should autogrow we need to monitor width of this element.
  return (el: HTMLTextAreaElement) => {
    let width = 0;
    const resizeObserver = new ResizeObserver((entries) => {
      const elem = entries[0].target as HTMLTextAreaElement;
      if (elem.offsetWidth !== width && width) {
        resize(elem);
      }
      width = elem.offsetWidth;
    });
    resizeObserver.observe(el);
    dom.onDisposeElem(el, () => resizeObserver.disconnect());
    el.addEventListener('input', () => resize(el));
    dom.autoDisposeElem(el, text.addListener(() => setImmediate(() => resize(el))));
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

const cssForm = styled('form', `
  margin-bottom: 32px;
  font-size: 14px;
  &:focus {
    outline: none;
  }
  & input:focus, & button:focus {
    outline: none;
    box-shadow: 0 0 1px 2px lightblue;
  }
`);

const cssQuestion = styled('div', `
  margin: 32px 0;
  padding-left: 24px;
  & > :first-child {
    margin-left: -24px;
  }
`);

const cssText = styled('div', `
  margin: 16px 0;
  font-size: 15px;
`);

const cssCheckboxLabel = styled(cssLabel, `
  font-size: 14px;
  font-weight: normal;
  display: flex;
  align-items: center;
  margin: 12px 0;
  user-select: unset;
`);

const cssCheckbox = styled(cssCheckboxSquare, `
  position: relative;
  margin-right: 12px !important;
  border-radius: var(--radius);
`);

const cssTextBox = styled('input', `
  flex: auto;
  width: 100%;
  font-size: inherit;
  padding: 4px 8px;
  border: 1px solid #D9D9D9;
  border-radius: 3px;

  &-invalid {
    color: red;
  }
`);

const form = cssForm.bind(null, {tabIndex: '-1'});
const textBox = cssTextBox.bind(null, {type: 'text'});
