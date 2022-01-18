import {ACIndex, ACItem, buildHighlightedDom} from 'app/client/lib/ACIndex';
import {Autocomplete, IAutocompleteOptions} from 'app/client/lib/autocomplete';
import {colors} from "app/client/ui2018/cssVars";
import {icon} from "app/client/ui2018/icons";
import {menuCssClass} from 'app/client/ui2018/menus';
import {dom, DomElementArg, Holder, IDisposableOwner, Observable, styled} from 'grainjs';

export interface ACSelectItem extends ACItem {
  value: string;
  label: string;
}

/**
 * Builds a text input with an autocomplete dropdown.
 * Note that because it is currently only used in the right-side panel, it is designed to avoid
 * keeping focus.
 */
export function buildACSelect(
  owner: IDisposableOwner,
  options: {
    disabled?: Observable<boolean>,
    acIndex: ACIndex<ACSelectItem>,
    valueObs: Observable<string>,
    save: (value: string, item: ACSelectItem|undefined) => Promise<void>|void
  },
  ...args: DomElementArg[]
) {
  const {acIndex, valueObs, save} = options;
  const acHolder = Holder.create<Autocomplete<ACSelectItem>>(owner);
  let textInput: HTMLInputElement;

  const isOpen = () => !acHolder.isEmpty();
  const acOpen = () => acHolder.isEmpty() && Autocomplete.create(acHolder, textInput, acOptions);
  const acClose = () => acHolder.clear();
  const finish = () => { acClose(); textInput.blur(); };
  const revert = () => { textInput.value = valueObs.get(); finish(); };
  const commitOrRevert = async () => { (await commitIfValid()) || revert(); };
  const openOrCommit = () => { isOpen() ? commitOrRevert().catch(() => {}) : acOpen(); };

  const commitIfValid = async () => {
    const item = acHolder.get()?.getSelectedItem();
    if (item) {
      textInput.value = item.value;
    }
    textInput.disabled = true;
    try {
      await save(textInput.value, item);
      finish();
      return true;
    } catch (e) {
      return false;
    } finally {
      textInput.disabled = false;
    }
  };

  const onMouseDown = (ev: MouseEvent) => {
    ev.preventDefault();    // Don't let it affect focus, since we focus/blur manually.
    if (options.disabled?.get()) {
      return;
    }
    if (!isOpen()) { textInput.focus(); }
    openOrCommit();
  };

  const acOptions: IAutocompleteOptions<ACSelectItem> = {
    menuCssClass: `${menuCssClass} test-acselect-dropdown`,
    search: async (term: string) => acIndex.search(term),
    renderItem: (item, highlightFunc) =>
      cssSelectItem(buildHighlightedDom(item.label, highlightFunc, cssMatchText)),
    getItemText: (item) => item.value,
    onClick: commitIfValid,
  };

  return cssSelectBtn(
    textInput = cssInput({type: 'text'},
      dom.prop('value', valueObs),
      dom.on('focus', (ev, elem) => elem.select()),
      dom.on('blur', commitOrRevert),
      dom.prop("disabled", (use) => options.disabled ? use(options.disabled) : false),
      dom.onKeyDown({
        Escape: revert,
        Enter: openOrCommit,
        ArrowDown: acOpen,
        Tab: commitIfValid,
      }),
      dom.on('input', acOpen),
    ),
    dom.on('mousedown', onMouseDown),
    cssIcon('Dropdown'),
    ...args
  );
}

const cssSelectBtn = styled('div', `
  position: relative;
  width: 100%;
  height: 30px;
  color: ${colors.dark};
  --icon-color: ${colors.dark};
`);

const cssSelectItem = styled('li', `
  display: block;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  outline: none;
  padding: var(--weaseljs-menu-item-padding, 8px 24px);
  cursor: pointer;

  &.selected {
    background-color: var(--weaseljs-selected-background-color, #5AC09C);
    color:            var(--weaseljs-selected-color, white);
  }
`);

const cssInput = styled('input', `
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  height: 100%;
  width: 100%;
  padding: 0 6px;
  outline: none;
  border: 1px solid ${colors.darkGrey};
  border-radius: 3px;
  cursor: pointer;
  line-height: 16px;
  cursor: pointer;

  &:disabled {
    color: grey;
    background-color: initial;
  }
  &:focus {
    cursor: initial;
    outline: none;
    box-shadow: 0px 0px 2px 2px #5E9ED6;
  }
`);

const cssIcon = styled(icon, `
  position: absolute;
  right: 6px;
  top: calc(50% - 8px);
`);

const cssMatchText = styled('span', `
  color: ${colors.lightGreen};
  .selected > & {
    color: ${colors.lighterGreen};
  }
`);
