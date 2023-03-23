/**
 * editableLabel uses grainjs's input widget and adds UI and behavioral extensions:
 *   - Label width grows/shrinks with content (using a hidden sizer element)
 *   - On Escape, cancel editing and revert to original value
 *   - Clicking away or hitting Enter on empty value cancels editing too
 *
 * The structure is a wrapper diver with an input child: div > input. Supports passing in
 * DomElementArgs, which get passed to the underlying <input> element.
 *
 * TODO: Consider merging this into grainjs's input widget.
 */
import { theme } from 'app/client/ui2018/cssVars';
import { dom, DomArg, styled } from 'grainjs';
import { Observable } from 'grainjs';
import noop = require('lodash/noop');

const cssWrapper = styled('div', `
  position: relative;
  display: inline-block;
`);

export const cssLabelText = styled(rawTextInput, `
  /* Reset appearance */
  -webkit-appearance: none;
  -moz-appearance: none;
  padding: 0;
  margin: 0;
  border: none;
  outline: none;

  /* Size is determined by the hidden sizer, so take up 100% of width */
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;

  line-height: inherit;
  font-size: inherit;
  font-family: inherit;
  font-weight: inherit;
  background-color: inherit;
  color: inherit;
`);

export const cssTextInput = styled('input', `
  outline: none;
  height: 28px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 3px;
  padding: 0 6px;
`);

const cssSizer = styled('div', `
  visibility: hidden;
  overflow: visible;
  white-space: pre;

  &:empty:before {
    content: ' ';  /* Don't collapse */
  }
`);

enum Status { NORMAL, EDITING, SAVING }

type SaveFunc = (value: string) => void|PromiseLike<void>;

export interface EditableLabelOptions {
  save: SaveFunc;
  args?: Array<DomArg<HTMLDivElement>>;
  inputArgs?: Array<DomArg<HTMLInputElement>>;
}

/**
 * Provides a label that takes in an observable that is set on Enter or loss of focus. Escape
 * cancels editing. Label grows in size with typed input. Validation logic (if any) should happen in
 * the save function, to reject a value simply throw an error, this will revert to the saved one .
 */
export function editableLabel(label: Observable<string>, options: EditableLabelOptions) {
  const {save, args, inputArgs} = options;

  let input: HTMLInputElement;
  let sizer: HTMLSpanElement;

  function updateSizer() {
    sizer.textContent = input.value;
  }

  return cssWrapper(
    sizer = cssSizer(label.get()),
    input = rawTextInput(label, save, updateSizer, dom.cls(cssLabelText.className),
      dom.on('focus', () => input.select()),
      ...inputArgs ?? [],
    ),
    ...args ?? [],
  );
}

/**
 * Provides a text input element that pretty much behaves like the editableLabel only it shows as a
 * regular input within a rigid static frame. It takes in an observable that is set on Enter or loss
 * of focus. Escape cancels editing. Validation logic (if any) should happen in the save function,
 * to reject a value simply throw an error, this will revert to the the saved one.
 */
export function textInput(label: Observable<string>, save: SaveFunc, ...args: Array<DomArg<HTMLInputElement>>) {
  return rawTextInput(label, save, noop, dom.cls(cssTextInput.className), ...args);
}

/**
 * A helper that implements all the saving logic for both editableLabel and textInput.
 */
export function rawTextInput(value: Observable<string>, save: SaveFunc, onChange: () => void,
                             ...args: Array<DomArg<HTMLInputElement>>) {
  let status: Status = Status.NORMAL;
  let inputEl: HTMLInputElement;

  // When label changes updates the input, unless in the middle of editing.
  const lis = value.addListener((val) => { if (status !== Status.EDITING) { setValue(val); } });

  function setValue(val: string) {
    inputEl.value = val;
    onChange();
  }

  function revertToSaved() {
    setValue(value.get());
    status = Status.NORMAL;
    inputEl.blur();
  }

  async function saveEdit() {
    if (status === Status.EDITING) {
      status = Status.SAVING;
      inputEl.disabled = true;
      // Ignore errors; save() callback is expected to handle their reporting.
      try { await save(inputEl.value); } catch (e) { /* ignore */ }
      inputEl.disabled = false;
      revertToSaved();
    } else if (status === Status.NORMAL) {
      // If we are not editing, nothing to save, but lets end in the expected blurred state.
      inputEl.blur();
    }
  }

  return inputEl = dom('input',
    dom.autoDispose(lis),
    {type: 'text'},
    dom.on('input', () => { status = Status.EDITING; onChange(); }),
    dom.on('blur', saveEdit),
    // we set the attribute to the initial value and keep it updated for the convenience of usage
    // with selenium webdriver
    dom.attr('value', value),
    dom.onKeyDown({
      Escape: revertToSaved,
      Enter: saveEdit,
    }),
    ...args
  );
}
