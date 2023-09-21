import {colors, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {IconName} from 'app/client/ui2018/IconList';
import {icon} from 'app/client/ui2018/icons';
import {isColorDark} from 'app/common/gutil';
import {dom, DomElementArg, Observable, styled} from 'grainjs';
import debounce = require('lodash/debounce');

export interface ISelectorOptionFull<T> {
  value: T;
  label?: string;
  icon?: IconName;
}

// For string options, we can use a string for label and value without wrapping into an object.
export type ISelectorOption<T> = (T & string) | ISelectorOptionFull<T>;

/**
 * Creates a button select, which is a row of buttons of which only one may be selected.
 * The observable `obs` reflects the value of the selected option, and `optionArray` is an array
 * of option values and labels. These may be either strings, or {label, value, icon} objects.
 * Icons and labels are optional (but one should be included or the buttons will be blank).
 *
 * The type of value may be any type at all; it is opaque to this widget.
 *
 * A "light" style is supported in CSS by passing cssButtonSelect.cls('-light') as an additional
 * argument.
 *
 * A disabled state is supported by passing cssButtonSelect.cls('-disabled').
 *
 * Usage:
 *    const fruit = observable("apple");
 *    buttonSelect(fruit, ["apple", "banana", "mango"]);
 *
 *    const alignments: ISelectorOption<string>[] = [
 *      {value: 'left',   icon: 'LeftAlign'},
 *      {value: 'center', icon: 'CenterAlign'},
 *      {value: 'right',  icon: 'RightAlign'}
 *    ];
 *    buttonSelect(obs, alignments);
 *
 */
export function buttonSelect<T>(
  obs: Observable<T>,
  optionArray: Array<ISelectorOption<T>>,
  ...domArgs: DomElementArg[]
) {
  return makeButtonSelect(obs, optionArray, (val: T) => { obs.set(val); }, ...domArgs);
}

/**
 * Identical to a buttonSelect, but allows the possibility of none of the items being selected.
 * Sets the observable `obs` to null when no items are selected.
 */
export function buttonToggleSelect<T>(
  obs: Observable<T|null>,
  optionArray: Array<ISelectorOption<T>>,
  ...domArgs: DomElementArg[]
) {
  const onClick = (val: T) => { obs.set(obs.get() === val ? null : val); };
  return makeButtonSelect(obs, optionArray, onClick, ...domArgs);
}

/**
 * Pre-made text alignment selector.
 */
export function alignmentSelect(obs: Observable<string>, ...domArgs: DomElementArg[]) {
  const alignments: Array<ISelectorOption<string>> = [
    {value: 'left',   icon: 'LeftAlign'},
    {value: 'center', icon: 'CenterAlign'},
    {value: 'right',  icon: 'RightAlign'}
  ];
  return buttonSelect(obs, alignments, {}, testId('alignment-select'), ...domArgs);
}

/**
 * Color selector button. Observable should contain a hex color value, e.g. #a4ba23.
 */
export function colorSelect(value: Observable<string>, save: (val: string) => Promise<void>,
                            ...domArgs: DomElementArg[]) {
  // On some machines (seen on chrome running on a Mac) the `change` event fires as many times as
  // the `input` event, hence the debounce. Also note that when user picks a first color and then a
  // second before closing the picker, it will create two user actions on Chrome, and only one in FF
  // (which should be the expected behaviour).
  const setValue = debounce(e => value.set(e.target.value), 300);
  const onSave = debounce(e => save(e.target.value), 300);

  return cssColorBtn(
    // TODO: When re-opening the color picker after a new color was saved on server, the picker will
    // reset the value to what it was when the picker was last closed. To allow picker to show the
    // latest saved value we should rebind the <input .../> element each time the value is changed
    // by the server.
    cssColorPicker(
      {type: 'color'},
      dom.attr('value', (use) => use(value).slice(0, 7)),
      dom.on('input', setValue),
      dom.on('change', onSave)
    ),
    dom.style('background-color', (use) => use(value) || '#000000'),
    cssColorBtn.cls('-dark', (use) => isColorDark(use(value) || '#000000')),
    cssColorIcon('Dots'),
    ...domArgs
  );
}

export function makeButtonSelect<T>(
  obs: Observable<T|null>,
  optionArray: Array<ISelectorOption<T>>,
  onClick: (value: T) => any,
  ...domArgs: DomElementArg[]
) {
  return cssButtonSelect(
    dom.forEach(optionArray, (option: ISelectorOption<T>) => {
      const value = getOptionValue(option);
      const label = getOptionLabel(option);
      return cssSelectorBtn(
        cssSelectorBtn.cls('-selected', (use) => use(obs) === value),
        dom.on('click', () => onClick(value)),
        isFullOption(option) && option.icon ? icon(option.icon) : null,
        label ? cssSelectorLabel(label) : null,
        testId('select-button')
      );
    }),
    ...domArgs
  );
}

function isFullOption<T>(option: ISelectorOption<T>): option is ISelectorOptionFull<T> {
  return typeof option !== "string";
}

function getOptionLabel<T>(option: ISelectorOption<T>): string|undefined {
  return isFullOption(option) ? option.label : option;
}

function getOptionValue<T>(option: ISelectorOption<T>): T {
  return isFullOption(option) ? option.value : option;
}

export const cssButtonSelect = styled('div', `
  /* Resets */
  position: relative;
  outline: none;
  border-style: none;
  display: flex;

  /* Vars */
  color: ${theme.text};
  flex: 1 1 0;

  &-disabled {
    opacity: 0.4;
    pointer-events: none;
  }
`);

const cssSelectorBtn = styled('div', `
  /* Resets */
  position: relative;
  outline: none;
  border-style: none;
  display: flex;
  align-items: center;
  justify-content: center;

  /* Vars */
  flex: 1 1 0;
  font-size: ${vars.mediumFontSize};
  letter-spacing: -0.08px;
  text-align: center;
  line-height: normal;
  min-width: 32px;
  white-space: nowrap;
  padding: 4px 10px;

  background-color: ${theme.buttonGroupBg};
  border: 1px solid ${theme.buttonGroupBorder};
  --icon-color: ${theme.buttonGroupIcon};

  margin-left: -1px;

  cursor: pointer;

  &:first-child {
    border-top-left-radius: ${vars.controlBorderRadius};
    border-bottom-left-radius: ${vars.controlBorderRadius};
    margin-left: 0;
  }

  &:last-child {
    border-top-right-radius: ${vars.controlBorderRadius};
    border-bottom-right-radius: ${vars.controlBorderRadius};
  }

  &:hover:not(&-selected) {
    background-color: ${theme.buttonGroupBgHover};
    border: 1px solid ${theme.buttonGroupBorderHover};
    z-index: 5;  /* Update z-index so selected borders take precedent */
  }

  &-selected {
    color: ${theme.buttonGroupSelectedFg};
    --icon-color: ${theme.buttonGroupSelectedFg};
    border: 1px solid ${theme.buttonGroupSelectedBorder};
    background-color: ${theme.buttonGroupSelectedBg};
    z-index: 10;  /* Update z-index so selected borders take precedent */
  }

  /* Styles when container includes cssButtonSelect.cls('-light') */
  .${cssButtonSelect.className}-light > & {
    border: none;
    border-radius: ${vars.controlBorderRadius};
    margin-left: 0px;
    padding: 8px;
    color: ${theme.buttonGroupLightFg};
    --icon-color: ${theme.buttonGroupLightFg};
  }
  .${cssButtonSelect.className}-light > &-selected {
    border: none;
    color: ${theme.buttonGroupLightSelectedFg};
    --icon-color: ${theme.buttonGroupLightSelectedFg};
    background-color: initial;
  }
  .${cssButtonSelect.className}-light > &:hover {
    border: none;
    background-color: ${theme.hover};
  }
`);

const cssSelectorLabel = styled('span', `
  margin: 0 2px;
  vertical-align: middle;
`);

const cssColorBtn = styled('div', `
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  min-width: 32px;
  max-width: 56px;
  height: 32px;
  border-radius: 4px;
  border: 1px solid ${colors.darkGrey};

  &:hover {
    border: 1px solid ${colors.hover};
  }

  &-dark {
    border: none !important;
  }
`);

const cssColorPicker = styled('input', `
  position: absolute;
  cursor: pointer;
  opacity: 0;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
`);

const cssColorIcon = styled(icon, `
  margin: 0 2px;
  background-color: ${colors.slate};
  pointer-events: none;

  .${cssColorBtn.className}-dark & {
    background-color: ${colors.light};
  }
`);
