import { MenuCommand } from 'app/client/components/commandList';
import { FocusLayer } from 'app/client/lib/FocusLayer';
import { makeT } from 'app/client/lib/localization';
import { NeedUpgradeError, reportError } from 'app/client/models/errors';
import { textButton } from 'app/client/ui2018/buttons';
import { cssCheckboxSquare, cssLabel, cssLabelText } from 'app/client/ui2018/checkbox';
import { testId, theme, vars } from 'app/client/ui2018/cssVars';
import { IconName } from 'app/client/ui2018/IconList';
import { icon } from 'app/client/ui2018/icons';
import { cssSelectBtn } from 'app/client/ui2018/select';
import {
  BindableValue, Computed, dom, DomContents, DomElementArg, DomElementMethod, IDomArgs,
  MaybeObsArray, MutableObsArray, Observable, styled
} from 'grainjs';
import debounce from 'lodash/debounce';
import * as weasel from 'popweasel';

const t = makeT('menus');

export interface IOptionFull<T> {
  value: T;
  label: string;
  disabled?: boolean;
  icon?: IconName;
}

let _lastOpenedController: weasel.IOpenController|null = null;

// Close opened menu if any, otherwise do nothing.
// WARN: current implementation does not handle submenus correctly. Does not seem a problem as of
// today though, as there is no submenu in UI.
export function closeRegisteredMenu() {
  if (_lastOpenedController) { _lastOpenedController.close(); }
}

// Register `ctl` to make sure it is closed when `closeMenu()` is called.
export function registerMenuOpen(ctl: weasel.IOpenController) {
  _lastOpenedController = ctl;
  ctl.onDispose(() => _lastOpenedController = null);
}

// For string options, we can use a string for label and value without wrapping into an object.
export type IOption<T> = (T & string) | IOptionFull<T>;

export function menu(createFunc: weasel.MenuCreateFunc, options?: weasel.IMenuOptions): DomElementMethod {
  const wrappedCreateFunc = (ctl: weasel.IOpenController) => {
    registerMenuOpen(ctl);
    return createFunc(ctl);
  };
  return weasel.menu(wrappedCreateFunc, {...defaults, ...options});
}

export interface SearchableMenuOptions {
  searchInputPlaceholder?: string;
}

export interface SearchableMenuItem {
  cleanText: string;
  builder?: () => Element;

  label?: string;
  action?: (item: HTMLElement) => void;
  args?: DomElementArg[];
}

export function searchableMenu(
  menuItems: MaybeObsArray<SearchableMenuItem>,
  options: SearchableMenuOptions = {}
): DomElementArg[] {
  const {searchInputPlaceholder} = options;

  const searchValue = Observable.create(null, '');
  const setSearchValue = debounce((value) => { searchValue.set(value); }, 100);

  return [
    menuItemStatic(
      cssMenuSearch(
        cssMenuSearchIcon('Search'),
        cssMenuSearchInput(
          dom.autoDispose(searchValue),
          dom.on('input', (_ev, elem) => { setSearchValue(elem.value); }),
          {placeholder: searchInputPlaceholder},
          testId('searchable-menu-input'),
        ),
      ),
    ),
    menuDivider(),
    dom.domComputed(searchValue, (value) => {
      const cleanSearchValue = value.trim().toLowerCase();
      return dom.forEach(menuItems, (item) => {
        if (!item.cleanText.includes(cleanSearchValue)) { return null; }
        if (item.label && item.action) {
          return menuItem(item.action, item.label, ...(item.args || []));
        } else if (item.builder) {
          return item.builder();
        } else {
          throw new Error('Invalid menu item');
        }
      });
    }),
    testId('searchable-menu'),
  ];
}



// TODO Weasel doesn't allow other options for submenus, but probably should.
export type ISubMenuOptions =
  weasel.ISubMenuOptions &
  weasel.IPopupOptions &
  {allowNothingSelected?: boolean};

/**
 * Menu item with submenu
 */
export function menuItemSubmenu(
  submenu: weasel.MenuCreateFunc,
  options: ISubMenuOptions,
  ...args: DomElementArg[]
): Element {
  return weasel.menuItemSubmenu(
    submenu,
    {
      ...defaults,
      expandIcon: () => cssExpandIcon('Expand'),
      menuCssClass: `${cssSubMenuElem.className} ${defaults.menuCssClass}`,
      ...options,
    },
    dom.cls(cssMenuItemSubmenu.className),
    ...args
  );
}

/**
 * Header with a submenu (used in collapsed menus scenarios).
 */
export function menuSubHeaderMenu(
  submenu: weasel.MenuCreateFunc,
  options: ISubMenuOptions,
  ...args: DomElementArg[]
): Element {
  return menuItemSubmenu(
    submenu,
    {
      ...options,
    },
    menuSubHeader.cls(''),
    cssPointer.cls(''),
    ...args,
  );
}

export const cssEllipsisLabel = styled('div', `
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`);

export const cssExpandIcon = styled(icon, `
  position: absolute;
  right: 4px;
`);

const cssSubMenuElem = styled('div', `
  white-space: nowrap;
  min-width: 200px;
`);

export const cssMenuElem = styled('div', `
  font-family: ${vars.fontFamily};
  font-size: ${vars.mediumFontSize};
  line-height: initial;
  max-width: 400px;
  padding: 8px 0px 16px 0px;
  box-shadow: 0 2px 20px 0 ${theme.menuShadow};
  min-width: 160px;
  z-index: ${vars.menuZIndex};
  --weaseljs-selected-background-color: ${theme.menuItemSelectedBg};
  --weaseljs-menu-item-padding: 8px 24px;
  background-color: ${theme.menuBg};

  @media print {
    & {
      display: none;
    }
  }
`);

export const menuItemStyle = `
  justify-content: flex-start;
  align-items: center;
  color: ${theme.menuItemFg};
  --icon-color: ${theme.accentIcon};
  .${weasel.cssMenuItem.className}-sel {
    color: ${theme.menuItemSelectedFg};
    --icon-color: ${theme.menuItemSelectedFg};
  }
  &.disabled {
    cursor: default;
    color: ${theme.menuItemDisabledFg};
    --icon-color: ${theme.menuItemDisabledFg};
  }
`;

export const menuItemStatic = styled('div', menuItemStyle);

export const menuCssClass = cssMenuElem.className;

// Add grist-floating-menu class to support existing browser tests
const defaults = { menuCssClass: menuCssClass + ' grist-floating-menu' };

export interface SelectOptions<T> extends weasel.ISelectUserOptions {
  /** Additional DOM element args to pass to each select option. */
  renderOptionArgs?: (option: IOptionFull<T | null>) => DomElementArg;
}

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
 *    const name = observable("alice");
 *    const names = ["alice", "bob", "carol"];
 *    select(name, names, {renderOptionArgs: (op) => console.log(`Rendered option ${op.value}`)});
 *
 * Note that this select element is not compatible with browser address autofill for usage in
 * forms, and that formSelect should be used for this purpose.
 */
export function select<T>(obs: Observable<T>, optionArray: MaybeObsArray<IOption<T>>,
                          options: SelectOptions<T> = {}) {
  const {renderOptionArgs, ...weaselOptions} = options;
  const _menu = cssSelectMenuElem(testId('select-menu'));
  const _btn = cssSelectBtn(testId('select-open'));

  const {menuCssClass: menuClass, ...otherOptions} = weaselOptions;
  const selectOptions = {
    buttonArrow: cssInlineCollapseIcon('Collapse'),
    menuCssClass: _menu.className + ' ' + (menuClass || ''),
    buttonCssClass: _btn.className,
    ...otherOptions,
  };

  return weasel.select(obs, optionArray, selectOptions, (op) =>
    cssOptionRow(
      op.icon ? cssOptionRowIcon(op.icon) : null,
      cssOptionLabel(t(op.label)),
      renderOptionArgs ? renderOptionArgs(op) : null,
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

export interface IMultiSelectUserOptions {
  placeholder?: string;
  error?: Observable<boolean>;
}

/**
 * Creates a select dropdown widget that supports selecting multiple options.
 *
 * The observable array `selectedOptions` reflects the selected options, and
 * `availableOptions` is an array (normal or observable) of selectable options.
 * These may either be strings, or {label, value} objects.
 */
export function multiSelect<T>(selectedOptions: MutableObsArray<T>,
                               availableOptions: MaybeObsArray<IOption<T>>,
                               options: IMultiSelectUserOptions = {},
                               ...domArgs: DomElementArg[]) {
  const selectedOptionsSet = Computed.create(null, selectedOptions, (_use, opts) => new Set(opts));

  const selectedOptionsText = Computed.create(null, selectedOptionsSet, (use, selectedOpts) => {
    if (selectedOpts.size === 0) {
      return options.placeholder ?? t("Select fields");
    }

    const optionArray = Array.isArray(availableOptions) ? availableOptions : use(availableOptions);
    return optionArray
      .filter(opt => selectedOpts.has(weasel.getOptionFull(opt).value))
      .map(opt => weasel.getOptionFull(opt).label)
      .join(', ');
  });

  function buildMultiSelectMenu(ctl: weasel.IOpenController) {
    return cssMultiSelectMenu(
      { tabindex: '-1' }, // Allow menu to be focused.
      dom.cls(menuCssClass),
      FocusLayer.attach({pauseMousetrap: true}),
      dom.onKeyDown({
        Enter: () => ctl.close(),
        Escape: () => ctl.close()
      }),
      elem => {
        // Set focus on open, so that keyboard events work.
        setTimeout(() => elem.focus(), 0);

        // Sets menu width to match parent container (button) width.
        const style = elem.style;
        style.minWidth = ctl.getTriggerElem().getBoundingClientRect().width + 'px';
        style.marginLeft = style.marginRight = '0';
      },
      dom.domComputed(selectedOptionsSet, selectedOpts => {
        return dom.forEach(availableOptions, option => {
          const fullOption = weasel.getOptionFull(option);
          return cssCheckboxLabel(
            cssCheckboxSquare(
              {type: 'checkbox'},
              dom.prop('checked', selectedOpts.has(fullOption.value)),
              dom.on('change', (_ev, elem) => {
                if (elem.checked) {
                  selectedOptions.push(fullOption.value);
                } else {
                  selectedOpts.delete(fullOption.value);
                  selectedOptions.set([...selectedOpts]);
                }
              }),
              dom.style('position', 'relative'),
              testId('multi-select-menu-option-checkbox')
            ),
            cssCheckboxText(fullOption.label, testId('multi-select-menu-option-text')),
            testId('multi-select-menu-option')
          );
        });
      }),
      testId('multi-select-menu')
    );
  }

  return cssSelectBtn(
    dom.autoDispose(selectedOptionsSet),
    dom.autoDispose(selectedOptionsText),
    cssMultiSelectSummary(
      dom.text(selectedOptionsText),
      cssMultiSelectSummary.cls('-placeholder', use => use(selectedOptionsSet).size === 0)
    ),
    icon('Dropdown'),
    elem => {
      weasel.setPopupToCreateDom(elem, ctl => buildMultiSelectMenu(ctl), weasel.defaultMenuOptions);
    },
    dom.style('border', use => {
      return options.error && use(options.error)
        ? `1px solid ${theme.selectButtonBorderInvalid}`
        : `1px solid ${theme.selectButtonBorder}`;
    }),
    ...domArgs
  );
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

export function upgradeText(needUpgrade: boolean, onClick: () => void) {
  if (!needUpgrade) { return null; }
  return menuText(dom('span', t("* Workspaces are available on team plans. "),
    cssUpgradeTextButton(t("Upgrade now"), dom.on('click', () => onClick()))));
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
  options: weasel.IAutocompleteOptions = {}
) {
  return weasel.autocomplete(inputElem, choices, {
    ...defaults, ...options,
    menuCssClass: defaults.menuCssClass + ' ' + cssSelectMenuElem.className + ' ' + (options.menuCssClass || '')
  });
}

/**
 * Creates simple (not reactive) static menu that looks like a select-box.
 * Primary usage is for menus, where you want to control how the options and a default
 * label will look. Label is not updated or changed when one of the option is clicked, for those
 * use cases use a select component.
 * Icons are optional, can use custom elements instead of labels and options.
 *
 * Usage:
 *
 *  selectMenu(selectTitle("Title", "Script"), () => [
 *    selectOption(() => ..., "Option1", "Database"),
 *    selectOption(() => ..., "Option2", "Script"),
 *  ]);
 *
 *  // Control disabled state (if the menu will be opened or not)
 *
 *  const disabled = observable(false);
 *  selectMenu(selectTitle("Title", "Script"), () => [
 *    selectOption(() => ..., "Option1", "Database"),
 *    selectOption(() => ..., "Option2", "Script"),
 *  ], disabled);
 *
 */
export function selectMenu(
  label: DomElementArg,
  items: () => DomElementArg[],
  ...args: IDomArgs<HTMLDivElement>
) {
  return cssSelectBtn(
    label,
    icon('Dropdown'),
    listOfMenuItems(items),
    ...args,
  );
}

export function listOfMenuItems(items: () => DomElementArg[],) {
  const _menu = cssSelectMenuElem(testId('select-menu'));
  return menu(
      items,
      {
        ...weasel.defaultMenuOptions,
        menuCssClass: _menu.className + ' grist-floating-menu',
        stretchToSelector: `.${cssSelectBtn.className}`,
        trigger: [(triggerElem, ctl) => {
          const isDisabled = () => triggerElem.classList.contains('disabled');
          dom.onElem(triggerElem, 'click', () => isDisabled() || ctl.toggle());
          dom.onKeyElem(triggerElem as HTMLElement, 'keydown', {
            ArrowDown: () => isDisabled() || ctl.open(),
            ArrowUp: () => isDisabled() || ctl.open()
          });
        }]
      },
  );
}

export function selectTitle(label: BindableValue<string>, iconName?: BindableValue<IconName>) {
  return cssOptionRow(
    iconName ? dom.domComputed(iconName, (name) => cssOptionRowIcon(name)) : null,
    dom.text(label)
  );
}

export function selectOption(
  action: (item: HTMLElement) => void,
  label: BindableValue<string>,
  iconName?: BindableValue<IconName>,
  ...args: IDomArgs<HTMLElement>) {
  return menuItem(action, selectTitle(label, iconName), ...args);
}

export const menuSubHeader = styled('div', `
  color: ${theme.menuSubheaderFg};
  font-size: ${vars.xsmallFontSize};
  text-transform: uppercase;
  font-weight: ${vars.headerControlTextWeight};
  padding: 8px 24px 8px 24px;
  cursor: default;
`);

export const cssPointer = styled('div', `
  cursor: pointer;
`);

export const menuText = styled('div', `
  display: flex;
  align-items: center;
  font-size: ${vars.smallFontSize};
  color: ${theme.menuText};
  padding: 8px 24px 4px 24px;
  max-width: 250px;
  cursor: default;
`);


export const menuItem = styled(weasel.menuItem, menuItemStyle);

export const menuItemLink = styled(weasel.menuItemLink, menuItemStyle);

// when element name is too long, it will be trimmed with ellipsis ("...")
export function menuItemTrimmed(
  action: (item: HTMLElement, ev: Event) => void, label: string, ...args: DomElementArg[]) {
  return menuItem(action, cssEllipsisLabel(label), ...args);
}


/**
 * A version of menuItem which runs the action on next tick, allowing the menu to close even when
 * the action causes the disabling of the element being clicked.
 * TODO disabling the element should not prevent the menu from closing; once fixed in weasel, this
 * can be removed.
 */
export const menuItemAsync: typeof weasel.menuItem = function(action, ...args) {
  return menuItem(() => setTimeout(action, 0), ...args);
};

export function menuItemCmd(
  cmd: MenuCommand,
  label: string | (() => DomContents),
  ...args: DomElementArg[]
) {
  return menuItem(
    () => cmd.run(),
    typeof label === 'string'
          ? dom('span', label, testId('cmd-name'))
          : dom('div', label(), testId('cmd-name')),
    cmd.humanKeys?.length ? cssCmdKey(cmd.humanKeys[0]) : null,
    cssMenuItemCmd.cls(''), // overrides some menu item styles
    ...args
  );
}

export const menuItemCmdLabel = styled('div', `
  display: flex;
  align-items: center;
`);

export function menuAnnotate(text: string, ...args: DomElementArg[]) {
  return cssAnnotateMenuItem(text, ...args);
}

export const menuDivider = styled(weasel.cssMenuDivider, `
  background-color: ${theme.menuBorder};
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
  color: ${theme.controlFg};
  --icon-color: ${theme.controlFg};
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
    color: ${theme.controlHoverFg};
    --icon-color: ${theme.controlHoverFg};
    box-shadow: initial;
  }
`);


export const cssOptionRow = styled('span', `
  display: flex;
  align-items: center;
  width: 100%;
`);

export const cssOptionRowIcon = styled(icon, `
  height: 16px;
  width: 16px;
  background-color: var(--icon-color, ${theme.menuItemIconFg});
  margin: -3px 8px 0 2px;
  margin: 0 8px 0 0;
  flex: none;

  .${weasel.cssMenuItem.className}-sel & {
    background-color: ${theme.menuItemSelectedFg};
  }

  .${weasel.cssMenuItem.className}.disabled & {
    background-color: ${theme.menuItemDisabledFg};
  }
`);

export const cssOptionLabel = styled('div', `
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  --grist-option-label-color: ${theme.menuItemFg};
  --grist-option-label-color-sel: ${theme.menuItemSelectedFg};
  --grist-option-label-color-disabled: ${theme.menuItemDisabledFg};

  .${weasel.cssMenuItem.className} & {
    color: var(--grist-option-label-color);
  }

  .${weasel.cssMenuItem.className}-sel & {
    color: var(--grist-option-label-color-sel);
    background-color: ${theme.menuItemSelectedBg};
  }

  .${weasel.cssMenuItem.className}.disabled & {
    color: var(--grist-option-label-color-disabled);
  }
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
  background-color: ${theme.selectButtonFg};
`);

const cssInputButtonMenuElem = styled(cssMenuElem, `
  padding: 4px 0px;
`);

const cssMenuItemCmd = styled('div', `
  justify-content: space-between;
  --icon-color: ${theme.menuItemFg};

  .${weasel.cssMenuItem.className}-sel & {
    --icon-color: ${theme.menuItemSelectedFg};
  }

  .${weasel.cssMenuItem.className}.disabled & {
    --icon-color: ${theme.menuItemDisabledFg};
  }
`);

const cssCmdKey = styled('span', `
  margin-left: 16px;
  color: ${theme.menuItemIconFg};
  margin-right: -12px;

  .${weasel.cssMenuItem.className}-sel > & {
    color: ${theme.menuItemIconSelectedFg};
  }

  .${weasel.cssMenuItem.className}.disabled & {
    color: ${theme.menuItemDisabledFg};
  }
`);

const cssAnnotateMenuItem = styled('span', `
  color: ${theme.accentText};
  text-transform: uppercase;
  font-size: 8px;
  vertical-align: super;
  margin-top: -4px;
  margin-left: 4px;
  font-weight: bold;

  .${weasel.cssMenuItem.className}-sel > & {
    color: ${theme.menuItemIconSelectedFg};
  }
`);

const cssMultiSelectSummary = styled('div', `
  flex: 1 1 0px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: ${theme.selectButtonFg};

  &-placeholder {
    color: ${theme.selectButtonPlaceholderFg};
  }
`);

const cssMultiSelectMenu = styled(weasel.cssMenu, `
  display: flex;
  flex-direction: column;
  max-height: calc(max(300px, 95vh - 300px));
  max-width: 400px;
  padding-bottom: 0px;
  background-color: ${theme.menuBg};
`);

const cssCheckboxLabel = styled(cssLabel, `
  padding: 8px 16px;
`);

const cssCheckboxText = styled(cssLabelText, `
  margin-right: 12px;
  color: ${theme.text};
  white-space: pre;
`);

const cssUpgradeTextButton = styled(textButton, `
  font-size: ${vars.smallFontSize};
`);

const cssMenuItemSubmenu = styled('div', `
  position: relative;
  justify-content: flex-start;
  color: ${theme.menuItemFg};
  --icon-color: ${theme.accentIcon};
  .${weasel.cssMenuItem.className}-sel {
    color: ${theme.menuItemSelectedFg};
    --icon-color: ${theme.menuItemSelectedFg};
  }
  &.disabled {
    cursor: default;
    color: ${theme.menuItemDisabledFg};
    --icon-color: ${theme.menuItemDisabledFg};
  }
`);

const cssMenuSearch = styled('div', `
  display: flex;
  column-gap: 8px;
  align-items: center;
  padding: 8px 16px;
`);

const cssMenuSearchIcon = styled(icon, `
  flex-shrink: 0;
  --icon-color: ${theme.menuItemIconFg};
`);

const cssMenuSearchInput = styled('input', `
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  flex-grow: 1;
  font-size: ${vars.mediumFontSize};
  padding: 0px;
  border: none;
  outline: none;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);

type MenuDefinition = Array<MenuItem>;


interface MenuItem {
  label?: string;
  header?: string;
  action?: string | (() => void);
  disabled?: boolean;
  icon?: IconName;
  shortcut?: string;
  submenu?: MenuDefinition;
  maxSubmenu?: number;
  type?: 'header' | 'separator' | 'item'; // default to item.
}

export function buildMenu(definition: MenuDefinition, onclick?: (action: string) => any) {
  function *buildMenuItems(current: MenuDefinition): IterableIterator<Element> {
    for (const item of current) {
      const isHeader = item.type === 'header' || item.header;
      // If this is header with submenu.
      if (isHeader && item.submenu) {
        yield menuSubHeaderMenu(() => [...buildMenuItems(item.submenu!)], {}, item.header ?? item.label);
        continue;
      } else if (isHeader) {
        yield menuSubHeader(item.header ?? item.label);
        continue;
      }

      // Not a header, so it's an item or a separator.
      if (item.type === 'separator') {
        yield menuDivider();
        continue;
      }

      // If this is an item with submenu.
      if (item.submenu) {
        yield menuItemSubmenu(() => [...buildMenuItems(item.submenu!)], {}, item.label);
        continue;
      }

      // Not a submenu, so it's a regular item.
      const action = typeof item.action === 'function' ? item.action : () => onclick?.(item.action as string);
      yield menuItem(action, item.icon && menuIcon(item.icon), item.label, item.shortcut && cssCmdKey(item.shortcut));

    }
  }
  return menu((ctl) => [...buildMenuItems(definition)], {});
}
