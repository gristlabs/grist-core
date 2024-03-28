// A dropdown with a search input to better navigate long list with
// keyboard. Dropdown features a search input and reoders the list of
// items to bring best matches at the top.

import { Disposable, dom, DomElementMethod, IOptionFull, makeTestId, Observable, styled } from "grainjs";
import { theme, vars } from 'app/client/ui2018/cssVars';
import { ACIndexImpl, ACIndexOptions, ACItem, buildHighlightedDom, HighlightFunc,
         normalizeText } from "app/client/lib/ACIndex";
import { menuDivider } from "app/client/ui2018/menus";
import { icon } from "app/client/ui2018/icons";
import { cssMenuItem, defaultMenuOptions, IOpenController, IPopupOptions, setPopupToFunc } from "popweasel";
import { mergeWith } from "lodash";
import { getOptionFull, SimpleList } from "../lib/simpleList";
import { makeT } from 'app/client/lib/localization';

const t = makeT('searchDropdown');

const testId = makeTestId('test-sd-');

export type { HighlightFunc } from "app/client/lib/ACIndex";

export type IOption<T> = (T & string) | IOptionFull<T>;

export interface IDropdownWithSearchOptions<T> {

  // the callback to trigger on selection
  action: (value: T) => void;

  // list of options
  options: () => Array<IOption<T>>,

  /** Called when the dropdown menu is disposed. */
  onClose?: () => void;

  // place holder for the search input. Default to 'Search'
  placeholder?: string;

  // popup options
  popupOptions?: IPopupOptions;

  /** ACIndexOptions to use for indexing and searching items. */
  acOptions?: ACIndexOptions;

  /**
   * If set, the width of the dropdown menu will be equal to that of
   * the trigger element.
   */
  matchTriggerElemWidth?: boolean;
}

export interface OptionItemParams<T> {
  /** Item label. Normalized and used by ACIndex for indexing and searching. */
  label: string;
  /** Item value. */
  value: T;
  /** Defaults to false. */
  disabled?: boolean;
  /**
   * If true, marks this item as the "placeholder" item.
   *
   * The placeholder item is excluded from indexing, so it's label doesn't
   * match search inputs. However, it's still shown when the search input is
   * empty.
   *
   * Defaults to false.
   */
  placeholder?: boolean;
}

export class OptionItem<T> implements ACItem, IOptionFull<T> {
  public label = this._params.label;
  public value = this._params.value;
  public disabled = this._params.disabled;
  public placeholder = this._params.placeholder;
  public cleanText = this.placeholder ? '' : normalizeText(this.label);

  constructor(private _params: OptionItemParams<T>) {

  }
}

export function dropdownWithSearch<T>(options: IDropdownWithSearchOptions<T>): DomElementMethod {
  return (elem) => {
    const popupOptions = mergeWith(
      {}, defaultMenuOptions, options.popupOptions,
      (_objValue: any, srcValue: any) => Array.isArray(srcValue) ? srcValue : undefined
    );
    setPopupToFunc(
      elem,
      (ctl) => (DropdownWithSearch<T>).create(null, ctl, options),
      popupOptions
    );
  };
}

class DropdownWithSearch<T> extends Disposable {

  private _items: Observable<OptionItem<T>[]>;
  private _acIndex: ACIndexImpl<OptionItem<T>>;
  private _inputElem: HTMLInputElement;
  private _simpleList: SimpleList<T>;
  private _highlightFunc: HighlightFunc;

  constructor(private _ctl: IOpenController, private _options: IDropdownWithSearchOptions<T>) {
    super();
    const acItems = _options.options().map(getOptionFull).map((params) => new OptionItem(params));
    this._acIndex = new ACIndexImpl<OptionItem<T>>(acItems, this._options.acOptions);
    this._items = Observable.create<OptionItem<T>[]>(this, acItems);
    this._highlightFunc = () => [];
    this._simpleList = this._buildSimpleList();
    this._simpleList.listenKeys(this._inputElem);
    this._update();
    // auto-focus the search input
    setTimeout(() => this._inputElem.focus(), 1);
    this._ctl.onDispose(() => _options.onClose?.());
  }

  public get content(): HTMLElement {
    return this._simpleList.content;
  }

  private _buildSimpleList() {
    const action = this._action.bind(this);
    const headerDom = this._buildHeader.bind(this);
    const renderItem = this._buildItem.bind(this);
    return (SimpleList<T>).create(this, this._ctl, this._items, action, {
      matchTriggerElemWidth: this._options.matchTriggerElemWidth,
      headerDom,
      renderItem,
    });
  }

  private _buildHeader() {
    return [
      cssMenuHeader(
        cssSearchIcon('Search'),
        this._inputElem = cssSearch(
          {placeholder: this._options.placeholder || t('Search')},
          dom.on('input', () => { this._update(); }),
          dom.on('blur', () => setTimeout(() => this._inputElem.focus(), 0)),
        ),

        // Prevents click on header to close menu
        dom.on('click', ev => ev.stopPropagation()),
        testId('search'),
      ),
      cssMenuDivider(),
    ];
  }

  private _buildItem(item: OptionItem<T>) {
    return [
      item.placeholder
        ? cssPlaceholderItem(item.label)
        : buildHighlightedDom(item.label, this._highlightFunc, cssMatchText),
      testId('searchable-list-item'),
    ];
  }

  private _update() {
    const acResults = this._acIndex.search(this._inputElem?.value || '');
    this._highlightFunc = acResults.highlightFunc;
    this._items.set(acResults.items);
    this._simpleList.setSelected(acResults.selectIndex);
  }

  private _action(value: T | null) {
    // If value is null, simply close the menu. This happens when pressing enter with no element
    // selected.
    if (value !== null) {
      this._options.action(value);
    }
    this._ctl.close();
  }
}

const cssMatchText = styled('span', `
  color: ${theme.autocompleteMatchText};
  .${cssMenuItem.className}-sel > & {
    color: ${theme.autocompleteSelectedMatchText};
  }
`);
const cssMenuHeader = styled('div', `
  display: flex;
  padding: 13px 17px 15px 17px;
`);
const cssSearchIcon = styled(icon, `
  --icon-color: ${theme.lightText};
  flex-shrink: 0;
  margin-left: auto;
  margin-right: 4px;
`);
const cssSearch = styled('input', `
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  flex-grow: 1;
  min-width: 1px;
  -webkit-appearance: none;
  -moz-appearance: none;

  font-size: ${vars.mediumFontSize};

  margin: 0px 16px 0px 8px;
  padding: 0px;
  border: none;
  outline: none;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);
const cssMenuDivider = styled(menuDivider, `
  flex-shrink: 0;
  margin: 0;
`);
const cssPlaceholderItem = styled('div', `
  color: ${theme.inputPlaceholderFg};

  .${cssMenuItem.className}-sel > & {
    color: ${theme.menuItemSelectedFg};
  }
`);
