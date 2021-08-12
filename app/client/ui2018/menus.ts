import {Command} from 'app/client/components/commands';
import {NeedUpgradeError, reportError} from 'app/client/models/errors';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import {cssSelectBtn} from 'app/client/ui2018/select';
import {IconName} from 'app/client/ui2018/IconList';
import {icon} from 'app/client/ui2018/icons';
import {commonUrls} from 'app/common/gristUrls';
import {dom, DomElementArg, DomElementMethod} from 'grainjs';
import {MaybeObsArray, Observable, styled} from 'grainjs';
import * as weasel from 'popweasel';
import {IAutocompleteOptions} from 'popweasel';

export interface IOptionFull<T> {
  value: T;
  label: string;
  disabled?: boolean;
  icon?: IconName;
}

// For string options, we can use a string for label and value without wrapping into an object.
export type IOption<T> = (T & string) | IOptionFull<T>;

export function menu(createFunc: weasel.MenuCreateFunc, options?: weasel.IMenuOptions): DomElementMethod {
  return weasel.menu(createFunc, {...defaults, ...options});
}

// TODO Weasel doesn't allow other options for submenus, but probably should.
export type ISubMenuOptions = weasel.ISubMenuOptions & weasel.IPopupOptions;

export function menuItemSubmenu(
  submenu: weasel.MenuCreateFunc,
  options: ISubMenuOptions,
  ...args: DomElementArg[]
): Element {
  return weasel.menuItemSubmenu(submenu, {...defaults, ...options}, ...args);
}

const cssMenuElem = styled('div', `
  font-family: ${vars.fontFamily};
  font-size: ${vars.mediumFontSize};
  line-height: initial;
  max-width: 400px;
  padding: 8px 0px 16px 0px;
  box-shadow: 0 2px 20px 0 rgba(38,38,51,0.6);
  min-width: 160px;
  z-index: 999;
  --weaseljs-selected-background-color: ${vars.primaryBg};
  --weaseljs-menu-item-padding: 8px 24px;

  @media print {
    & {
      display: none;
    }
  }
`);

const menuItemStyle = `
  justify-content: flex-start;
  align-items: center;
  --icon-color: ${colors.lightGreen};
  .${weasel.cssMenuItem.className}-sel {
    --icon-color: ${colors.light};
  }
  &.disabled {
    cursor: default;
    opacity: 0.2;
  }
`;

export const menuCssClass = cssMenuElem.className;

// Add grist-floating-menu class to support existing browser tests
const defaults = { menuCssClass: menuCssClass + ' grist-floating-menu' };

/**
 * Creates a select dropdown widget. The observable `obs` reflects the value of the selected
 * option, and `optionArray` is an array (regular or observable) of option values and labels.
 * These may be either strings, or {label, value, icon, disabled} objects. Icons are optional
 * and must be IconName strings from 'app/client/ui2018/IconList'.
 *
 * The type of value may be any type at all; it is opaque to this widget.
 *
 * If obs is set to an invalid or disabled value, then defLabel option is used to determine the
 * label that the select box will show, blank by default.
 *
 * Usage:
 *    const fruit = observable("apple");
 *    select(fruit, ["apple", "banana", "mango"]);
 *
 *    const employee = observable(17);
 *    const allEmployees = Observable.create(owner, [
 *      {value: 12, label: "Bob", disabled: true},
 *      {value: 17, label: "Alice"},
 *      {value: 21, label: "Eve"},
 *    ]);
 *    select(employee, allEmployees, {defLabel: "Select employee:"});
 *
 * Note that this select element is not compatible with browser address autofill for usage in
 * forms, and that formSelect should be used for this purpose.
 */
export function select<T>(obs: Observable<T>, optionArray: MaybeObsArray<IOption<T>>,
                          options: weasel.ISelectUserOptions = {}) {
  const _menu = cssSelectMenuElem(testId('select-menu'));
  const _btn = cssSelectBtn(testId('select-open'));

  const {menuCssClass: menuClass, ...otherOptions} = options;
  const selectOptions = {
    buttonArrow: cssInlineCollapseIcon('Collapse'),
    menuCssClass: _menu.className + ' ' + (menuClass || ''),
    buttonCssClass: _btn.className,
    ...otherOptions,
  };

  return weasel.select(obs, optionArray, selectOptions, (op) =>
    cssOptionRow(
      op.icon ? cssOptionRowIcon(op.icon) : null,
      cssOptionLabel(op.label),
      testId('select-row')
    )
  ) as HTMLElement; // TODO: should be changed in weasel
}

/**
 * Same as select(), but the main element looks like a link rather than a button.
 */
export function linkSelect<T>(obs: Observable<T>, optionArray: MaybeObsArray<IOption<T>>,
                              options: weasel.ISelectUserOptions = {}) {
  const _btn = cssSelectBtnLink(testId('select-open'));
  const elem = select(obs, optionArray, {buttonCssClass: _btn.className, ...options});
  // It feels strange to have focus stay on this link; remove tabIndex that makes it focusable.
  elem.removeAttribute('tabIndex');
  return elem;
}

/**
 * Creates a select dropdown widget that is more ideal for forms. Implemented using the <select>
 * element to work with browser form autofill and typing in the desired value to quickly set it.
 * The appearance of the opened menu is OS dependent.
 *
 * The observable `obs` reflects the value of the selected option, and `optionArray` is an
 * array (regular or observable) of option values and labels. These may be either strings,
 * or {label, value} objects.
 *
 * If obs is set to an empty string value, then defLabel option is used to determine the
 * label that the select box will show, blank by default.
 *
 * Usage:
 *    const fruit = observable("");
 *    formSelect(fruit, ["apple", "banana", "mango"], {defLabel: "Select fruit:"});
 */
export function formSelect(obs: Observable<string>, optionArray: MaybeObsArray<IOption<string>>,
                           options: {defaultLabel?: string} = {}) {
  const {defaultLabel = ""} = options;
  const container: Element = cssSelectBtnContainer(
    dom('select', {class: cssSelectBtn.className, style: 'height: 42px; padding: 12px 30px 12px 12px;'},
      dom.prop('value', obs),
      dom.on('change', (_, elem) => { obs.set(elem.value); }),
      dom('option', {value: '', hidden: 'hidden'}, defaultLabel),
      dom.forEach(optionArray, (option) => {
        const obj: weasel.IOptionFull<string> = weasel.getOptionFull(option);
        return dom('option', {value: obj.value}, obj.label);
      })
    ),
    cssCollapseIcon('Collapse')
  );
  return container;
}

export function inputMenu(createFunc: weasel.MenuCreateFunc, options?: weasel.IMenuOptions): DomElementMethod {
  // Triggers the input menu on 'input' events, if the input has text inside.
  function inputTrigger(triggerElem: Element, ctl: weasel.PopupControl): void {
    dom.onElem(triggerElem, 'input', () => {
      (triggerElem as HTMLInputElement).value.length > 0 ? ctl.open() : ctl.close();
    });
  }
  return weasel.inputMenu(createFunc, {
    trigger: [inputTrigger],
    menuCssClass: `${cssMenuElem.className} ${cssInputButtonMenuElem.className}`,
    ...options
  });
}

// A menu item that leads to the billing page if the desired operation requires an upgrade.
// Such menu items are marked with a little sparkle unicode.
export function upgradableMenuItem(needUpgrade: boolean, action: () => void, ...rem: any[]) {
  if (needUpgrade) {
    return menuItem(() => reportError(new NeedUpgradeError()), ...rem, " *");
  } else {
    return menuItem(action, ...rem);
  }
}

export function upgradeText(needUpgrade: boolean) {
  if (!needUpgrade) { return null; }
  return menuText(dom('span', '* Workspaces are available on team plans. ',
        dom('a', {href: commonUrls.plans}, 'Upgrade now')));
}

/**
 * Create an autocomplete element and tie it to an input or textarea element.
 *
 * Usage:
 *      const employees = ['Thomas', 'June', 'Bethany', 'Mark', 'Marjorey', 'Zachary'];
 *      const inputElem = input(...);
 *      autocomplete(inputElem, employees);
 */
export function autocomplete(
  inputElem: HTMLInputElement,
  choices: MaybeObsArray<string>,
  options: IAutocompleteOptions = {}
) {
  return weasel.autocomplete(inputElem, choices, {
    ...defaults, ...options,
    menuCssClass: defaults.menuCssClass + ' ' + cssSelectMenuElem.className + ' ' + (options.menuCssClass || '')
  });
}

export const menuSubHeader = styled('div', `
  font-size: ${vars.xsmallFontSize};
  text-transform: uppercase;
  font-weight: ${vars.bigControlTextWeight};
  padding: 8px 24px 16px 24px;
  cursor: default;
`);

export const menuText = styled('div', `
  display: flex;
  align-items: center;
  font-size: ${vars.smallFontSize};
  color: ${colors.slate};
  padding: 8px 24px 4px 24px;
  max-width: 250px;
  cursor: default;
`);

export const menuItem = styled(weasel.menuItem, menuItemStyle);

export const menuItemLink = styled(weasel.menuItemLink, menuItemStyle);

/**
 * A version of menuItem which runs the action on next tick, allowing the menu to close even when
 * the action causes the disabling of the element being clicked.
 * TODO disabling the element should not prevent the menu from closing; once fixed in weasel, this
 * can be removed.
 */
export const menuItemAsync: typeof weasel.menuItem = function(action, ...args) {
  return menuItem(() => setTimeout(action, 0), ...args);
};

export function menuItemCmd(cmd: Command, label: string, ...args: DomElementArg[]) {
  return menuItem(
    cmd.run,
    dom('span', label, testId('cmd-name')),
    cmd.humanKeys.length ? cssCmdKey(cmd.humanKeys[0]) : null,
    cssMenuItemCmd.cls(''), // overrides some menu item styles
    ...args
  );
}

export function menuAnnotate(text: string, ...args: DomElementArg[]) {
  return cssAnnotateMenuItem(text, ...args);
}

export const menuDivider = styled(weasel.cssMenuDivider, `
  margin: 8px 0;
`);

export const menuIcon = styled(icon, `
  flex: none;
  margin-right: 8px;
`);

const cssSelectMenuElem = styled(cssMenuElem, `
  max-height: 400px;
  overflow-y: auto;

  --weaseljs-menu-item-padding: 8px 16px;
`);

const cssSelectBtnContainer = styled('div', `
  position: relative;
  width: 100%;
`);

const cssSelectBtnLink = styled('div', `
  display: flex;
  align-items: center;
  font-size: ${vars.mediumFontSize};
  color: ${colors.lightGreen};
  --icon-color: ${colors.lightGreen};
  width: initial;
  height: initial;
  line-height: inherit;
  background-color: initial;
  padding: initial;
  border: initial;
  border-radius: initial;
  box-shadow: initial;
  cursor: pointer;
  outline: none;
  -webkit-appearance: none;
  -moz-appearance: none;

  &:hover, &:focus, &:active {
    color: ${colors.darkGreen};
    --icon-color: ${colors.darkGreen};
    box-shadow: initial;
  }
`);

const cssOptionIcon = styled(icon, `
  height: 16px;
  width: 16px;
  background-color: ${colors.slate};
  margin: -3px 8px 0 2px;
`);

const cssOptionRow = styled('span', `
  display: flex;
  align-items: center;
  width: 100%;
`);

const cssOptionRowIcon = styled(cssOptionIcon, `
  margin: 0 8px 0 0;
  flex: none;

  .${weasel.cssMenuItem.className}-sel & {
    background-color: white;
  }
`);

const cssOptionLabel = styled('div', `
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssInlineCollapseIcon = styled(icon, `
  margin: 0 2px;
  pointer-events: none;
`);

const cssCollapseIcon = styled(icon, `
  position: absolute;
  right: 12px;
  top: calc(50% - 8px);
  pointer-events: none;
  background-color: ${colors.dark};
`);

const cssInputButtonMenuElem = styled(cssMenuElem, `
  padding: 4px 0px;
`);

const cssMenuItemCmd = styled('div', `
  justify-content: space-between;
`);

const cssCmdKey = styled('span', `
  margin-left: 16px;
  color: ${colors.slate};
  margin-right: -12px;
`);

const cssAnnotateMenuItem = styled('span', `
  color: ${colors.lightGreen};
  text-transform: uppercase;
  font-size: 8px;
  vertical-align: super;
  margin-top: -4px;
  margin-left: 4px;
  font-weight: bold;

  .${weasel.cssMenuItem.className}-sel > & {
    color: white;
  }
`);
