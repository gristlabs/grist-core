// A dropdown with a search input to better navigate long lists with
// keyboard. Uses the ARIA combobox + listbox pattern: the search input is
// focused on open, left/right arrows edit the input, and up/down move
// aria-activedescendant through the list.

import { ACIndexImpl, ACIndexOptions, ACItem, buildHighlightedDom, HighlightFunc,
  highlightNone, normalizeText } from "app/client/lib/ACIndex";
import { makeT } from "app/client/lib/localization";
import { getOptionFull, SimpleList } from "app/client/lib/simpleList";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import {
  closeRegisteredMenu, cssExpandIcon, cssMenuItemSubmenu, menuDivider, menuSubHeader,
} from "app/client/ui2018/menus";
import { unstyledButton } from "app/client/ui2018/unstyled";

import {
  Disposable, dom, DomElementArg, DomElementMethod, IOptionFull, makeTestId, Observable,
  onKeyDown, styled,
} from "grainjs";
import mergeWith from "lodash/mergeWith";
import {
  cssMenuItem, cssMenuWrap, defaultMenuOptions, IOpenController, IPopupOptions,
  PopupControl, setPopupToFunc,
} from "popweasel";

const t = makeT("searchDropdown");

const testId = makeTestId("test-sd-");

export type { HighlightFunc } from "app/client/lib/ACIndex";

export type IOption<T> = (T & string) | IOptionFull<T>;

/**
 * Non-selectable section heading. Place it immediately before the options that
 * belong to the section; when filtering, it is kept only if at least one of
 * those options still matches.
 */
export interface IDropdownHeaderOption {
  label: string;
  header: true;
}

/** Selectable option, or a section header (`header: true`). */
export type IDropdownOption<T> = IOption<T> | IDropdownHeaderOption;

/** How typing in the search box reshapes the option list. */
export type SearchMode = "filter" | "rank";

interface SearchUpdateResult<T> {
  matchedItems: OptionItem<T>[];
  highlightFunc: HighlightFunc;
  selectIndex: number;
  searching: boolean;
  truncated: boolean;
  totalItems: number;
}

export interface IDropdownWithSearchOptions<T> {

  // the callback to trigger on selection
  action: (value: T) => void;

  // list of options (use `{ label, header: true }` for section headings)
  options: () => IDropdownOption<T>[],

  /** Called when the dropdown menu is disposed. */
  onClose?: () => void;

  // place holder for the search input. Default to 'Search'
  placeholder?: string;

  /** Label for the search input, vocalized by screen readers, but not shown. */
  ariaLabelInput?: string;

  /** Label for the options list, vocalized by screen readers, but not shown. */
  ariaLabelList?: string;

  // popup options
  popupOptions?: IPopupOptions;

  /** ACIndexOptions to use for indexing and searching items (rank mode only). */
  acOptions?: ACIndexOptions;

  /**
   * How typing in the search box affects the list.
   *
   * - `'rank'` (default for `dropdownWithSearch`): autocomplete-style — score
   *   matches, move them to the top, and still show non-matches below.
   * - `'filter'` (default for menu-item adapters): hide non-matching items and
   *   keep source order (former `searchableMenu` behavior).
   */
  searchMode?: SearchMode;

  /**
   * If set, the width of the dropdown menu will be equal to that of
   * the trigger element.
   */
  matchTriggerElemWidth?: boolean;

  /**
   * Custom renderer for each option. Defaults to highlighted AC match text.
   * Called for regular (non-truncated) items.
   */
  renderItem?: (item: OptionItem<T>, highlightFunc: HighlightFunc) => DomElementArg;

  /** Extra DOM args for the search input (e.g. test ids). */
  searchInputArgs?: DomElementArg[];

  /**
   * Custom empty-state content when a non-empty search matches nothing.
   * Defaults to a generic "No matching items" message.
   */
  buildEmptyMessage?: () => DomElementArg;
}

export class OptionItem<T> implements ACItem, IOptionFull<T> {
  public label: string;
  public value: T;
  public disabled: boolean | undefined;
  public header: boolean;
  public cleanText: string;

  constructor(params: IOptionFull<T> & { header?: boolean }) {
    this.label = params.label;
    this.value = params.value;
    this.header = Boolean(params.header);
    this.disabled = params.disabled || this.header;
    this.cleanText = this.header ? "" : normalizeText(this.label);
  }
}

function isHeaderOption<T>(opt: IDropdownOption<T>): opt is IDropdownHeaderOption {
  return typeof opt === "object" && "header" in opt && Boolean(opt.header);
}

class TruncatedListItem<T> extends OptionItem<T> {
  constructor(label: string) {
    super({
      label,
      value: "" as unknown as T,
      disabled: true,
    });
  }
}

/**
 * Attaches a searchable combobox dropdown to a trigger element.
 */
export function dropdownWithSearch<T>(options: IDropdownWithSearchOptions<T>): DomElementMethod {
  return (elem) => {
    const popupOptions = mergeWith(
      {}, defaultMenuOptions, options.popupOptions,
      (_objValue: any, srcValue: any) => Array.isArray(srcValue) ? srcValue : undefined,
    );
    setPopupToFunc(
      elem,
      ctl => (DropdownWithSearch<T>).create(null, ctl, options),
      popupOptions,
    );
  };
}

/**
 * Menu item that opens a searchable combobox dropdown as a side popup (like a submenu),
 * instead of embedding a search input inside a weasel `role="menu"`.
 */
export function menuItemDropdownWithSearch<T>(
  searchOptions: IDropdownWithSearchOptions<T>,
  ...args: DomElementArg[]
): Element {
  return buildMenuItemDropdownWithSearch(searchOptions, args);
}

/**
 * Same as `menuItemDropdownWithSearch`, styled as a menu sub-header trigger
 * (used for collapsed sections such as "Hidden Columns").
 */
export function menuSubHeaderDropdownWithSearch<T>(
  searchOptions: IDropdownWithSearchOptions<T>,
  ...args: DomElementArg[]
): Element {
  return buildMenuItemDropdownWithSearch(searchOptions, args, { asSubHeader: true });
}

function buildMenuItemDropdownWithSearch<T>(
  searchOptions: IDropdownWithSearchOptions<T>,
  args: DomElementArg[],
  opts: { asSubHeader?: boolean } = {},
): Element {
  const ctl = PopupControl.create(null);
  const popupOptions = mergeWith(
    {},
    defaultMenuOptions,
    {
      placement: "right-start" as const,
      trigger: [] as string[],
      modifiers: { preventOverflow: { padding: 10 } },
      boundaries: "viewport" as const,
      controller: ctl,
      // Attach as a child of the parent menu wrap, matching weasel submenu behavior.
      attach: `.${cssMenuWrap.className}`,
    },
    searchOptions.popupOptions,
    (_objValue: any, srcValue: any) => Array.isArray(srcValue) ? srcValue : undefined,
  );

  const wrappedOptions: IDropdownWithSearchOptions<T> = {
    // Menu-item adapters replace the old searchableMenu, which filtered in place.
    searchMode: "filter",
    ...searchOptions,
    action: (value) => {
      searchOptions.action(value);
      // Selecting an option closes this popup; also dismiss the parent weasel menu.
      closeRegisteredMenu();
    },
  };

  return cssMenuItem(
    cssMenuItemSubmenu.cls(""),
    opts.asSubHeader ? menuSubHeader.cls("") : null,
    opts.asSubHeader ? cssPointer.cls("") : null,
    ...args,
    cssExpandIcon("Expand"),
    dom.autoDispose(ctl),
    { "role": "menuitem", "aria-expanded": "false" },
    (elem: HTMLElement) => {
      setPopupToFunc(
        elem,
        openCtl => (DropdownWithSearch<T>).create(null, openCtl, wrappedOptions),
        popupOptions,
      );
    },
    dom.on("mouseenter", () => { ctl.open({ showDelay: 200 }); }),
    onKeyDown({
      ArrowRight: () => { ctl.open(); },
      Enter: () => { ctl.open(); },
    }),
    // When selection moves away from this item in the parent menu, close the popup.
    (elem: HTMLElement) => dom.dataElem(elem, "menuItemSelected", (yesNo: boolean) => {
      if (!yesNo) { ctl.close(); }
    }),
    // Clicks that open this popup should not close the parent menu.
    dom.on("click", (ev) => { ev.stopPropagation(); }),
  );
}

export class DropdownWithSearch<T> extends Disposable {
  private _allItems: OptionItem<T>[];
  private _selectableItems: OptionItem<T>[];
  private _items: Observable<OptionItem<T>[]>;
  private _acIndex: ACIndexImpl<OptionItem<T>> | null = null;
  private _inputElem: HTMLInputElement;
  private _simpleList: SimpleList<T, OptionItem<T>>;
  private _highlightFunc: HighlightFunc;
  private _ariaLabelListObs: Observable<string | undefined> | undefined;
  private _searchValue = Observable.create(this, "");
  private _showEmpty = Observable.create(this, false);
  private _hasHeaders: boolean;
  private _searchMode: SearchMode;

  constructor(private _ctl: IOpenController, private _options: IDropdownWithSearchOptions<T>) {
    super();
    this._searchMode = _options.searchMode ?? "rank";
    this._allItems = _options.options().map((opt) => {
      if (isHeaderOption(opt)) {
        // Headers are never selected; value is unused.
        return new OptionItem<T>({ label: opt.label, value: undefined as unknown as T, header: true });
      }
      const full = typeof opt === "string" ?
        { label: opt, value: opt as unknown as T } :
        getOptionFull(opt);
      return new OptionItem(full);
    });
    this._hasHeaders = this._allItems.some(item => item.header);
    // Search only selectable rows; headers are woven back in after search.
    this._selectableItems = this._allItems.filter(item => !item.header);
    if (this._searchMode === "rank") {
      this._acIndex = new ACIndexImpl<OptionItem<T>>(this._selectableItems, {
        ...this._options.acOptions,
        // Keep source order when section headers are present so groups stay intact.
        keepOrder: this._hasHeaders || this._options.acOptions?.keepOrder,
      });
    }
    this._items = Observable.create<OptionItem<T>[]>(this, this._allItems);
    this._highlightFunc = highlightNone;
    this._ariaLabelListObs = _options.ariaLabelList ? Observable.create(this, _options.ariaLabelList) : undefined;
    this._simpleList = this._buildSimpleList();
    this._simpleList.listenKeys(this._inputElem, {
      onEscape: () => {
        if (this._searchValue.get()) {
          this._clearSearch();
          return true;
        }
        return false;
      },
    });
    this._inputElem.setAttribute("aria-controls", this._simpleList.listboxId);
    this._update();
    // auto-focus the search input
    setTimeout(() => this._inputElem.focus(), 1);
    this._ctl.onDispose(() => _options.onClose?.());
  }

  public get content(): HTMLElement {
    return this._simpleList.content;
  }

  private _clearSearch() {
    this._inputElem.value = "";
    this._searchValue.set("");
    this._update();
    this._inputElem.focus();
  }

  private _buildSimpleList() {
    const action = this._action.bind(this);
    const headerDom = this._buildHeader.bind(this);
    const renderItem = this._buildItem.bind(this);
    return (SimpleList<T, OptionItem<T>>).create(this, this._ctl, this._items, action, {
      matchTriggerElemWidth: this._options.matchTriggerElemWidth,
      headerDom,
      renderItem,
      ariaLabel: this._ariaLabelListObs,
      footerDom: () => dom.maybe(this._showEmpty, () =>
        cssEmptyMessage(
          this._options.buildEmptyMessage?.() ?? t("No matching items"),
          testId("empty"),
        ),
      ),
      onSelectedChange: (selectedItem) => {
        if (selectedItem?.id) {
          this._inputElem.setAttribute("aria-activedescendant", selectedItem.id);
        } else {
          this._inputElem.removeAttribute("aria-activedescendant");
        }
      },
    });
  }

  private _buildHeader() {
    return [
      cssMenuHeader(
        cssSearchIcon("Search"),
        this._inputElem = cssSearch(
          {
            "placeholder": this._options.placeholder || t("Search"),
            "role": "combobox",
            "aria-autocomplete": "list",
            "aria-expanded": "true",
            "aria-label": this._options.ariaLabelInput ||
              this._options.placeholder || t("Search"),
          },
          dom.on("input", (_ev, elem) => {
            this._searchValue.set(elem.value);
            this._update();
          }),
          dom.on("blur", () => setTimeout(() => this._inputElem.focus(), 0)),
          ...(this._options.searchInputArgs || []),
        ),
        dom.maybe(this._searchValue, () => cssSearchClear(
          icon("CrossSmall"),
          { "aria-label": t("Clear search") },
          testId("search-clear"),
          dom.on("click", () => this._clearSearch()),
        )),

        // Prevents click on header to close menu
        dom.on("click", ev => ev.stopPropagation()),
        testId("search"),
      ),
      cssMenuDivider(),
    ];
  }

  private _buildItem(item: OptionItem<T>): DomElementArg {
    if (item.header) {
      return cssSectionHeader(
        item.label,
        // Prevents click on header to close or select.
        dom.on("click", ev => ev.stopPropagation()),
        testId("section-header"),
      );
    }
    if (item instanceof TruncatedListItem) {
      return dom("span", this._buildTruncatedMsgItem(item), testId("truncated-message"));
    }
    if (this._options.renderItem) {
      // display:contents so custom rows (e.g. ACL user items) can cancel the option-row padding.
      return cssItemWrap(
        this._options.renderItem(item, this._highlightFunc),
        testId("searchable-list-item"),
      );
    }
    return cssItemWrap(
      buildHighlightedDom(item.label, this._highlightFunc, cssMatchText),
      testId("searchable-list-item"),
    );
  }

  private _buildTruncatedMsgItem(item: TruncatedListItem<T>) {
    return cssTruncatedMessageItem(
      item.label,
      // Prevents click to close menu
      dom.on("click", ev => ev.stopPropagation()),
    );
  }

  private _update() {
    const searchText = this._inputElem?.value || "";
    if (this._searchMode === "filter") {
      this._updateFilter(searchText);
    } else {
      this._updateRank(searchText);
    }
  }

  /**
   * Filter mode: substring match, preserve order, hide non-matches.
   * Uses includes() rather than ACIndex so mid-string matches work the same
   * way the old searchableMenu did.
   */
  private _updateFilter(searchText: string) {
    const searching = Boolean(searchText.trim());
    const matched = searching ?
      this._selectableItems.filter(item => item.cleanText.includes(normalizeText(searchText))) :
      this._selectableItems;
    this._applyResults({
      matchedItems: matched,
      highlightFunc: highlightNone,
      selectIndex: searching && matched.length > 0 ? 0 : -1,
      searching,
      truncated: false,
      totalItems: this._selectableItems.length,
    });
  }

  /**
   * Rank mode: ACIndex scores matches to the top and pads with non-matches.
   */
  private _updateRank(searchText: string) {
    const acIndex = this._acIndex!;
    const acResults = acIndex.search(searchText);
    const searching = Boolean(searchText.trim());
    this._applyResults({
      matchedItems: acResults.items,
      highlightFunc: acResults.highlightFunc,
      selectIndex: acResults.selectIndex,
      searching,
      truncated: acResults.items.length < acIndex.totalItems && acResults.items.length > 0,
      totalItems: acIndex.totalItems,
    });
  }

  private _applyResults(result: SearchUpdateResult<T>) {
    this._highlightFunc = result.highlightFunc;
    let items = this._hasHeaders ?
      this._weaveHeaders(result.matchedItems, result.searching) :
      result.matchedItems;
    this._showEmpty.set(result.searching && result.matchedItems.length === 0);
    if (result.truncated) {
      const truncatedLabel = t("Showing {{displayedCount}} of {{totalCount}} items. Search for more.", {
        displayedCount: result.matchedItems.length,
        totalCount: result.totalItems,
      });
      items = items.concat(new TruncatedListItem(truncatedLabel) as OptionItem<T>);
      this._ariaLabelListObs?.set(
        this._options.ariaLabelList ?
          `${this._options.ariaLabelList} - ${truncatedLabel}` :
          truncatedLabel,
      );
    } else {
      this._ariaLabelListObs?.set(this._options.ariaLabelList);
    }
    this._items.set(items);
    // Map suggested selection into the (possibly header-woven) list.
    if (result.selectIndex < 0) {
      this._simpleList.setSelected(-1);
    } else {
      const target = result.matchedItems[result.selectIndex];
      this._simpleList.setSelected(items.indexOf(target));
    }
  }

  /**
   * Re-insert section headers above any of their items that survived the search.
   * When not searching, returns the full original list (headers + items).
   */
  private _weaveHeaders(matchedItems: OptionItem<T>[], searching: boolean): OptionItem<T>[] {
    if (!this._hasHeaders) { return matchedItems; }
    if (!searching) { return this._allItems; }

    const matched = new Set(matchedItems);
    const result: OptionItem<T>[] = [];
    let pendingHeader: OptionItem<T> | null = null;
    for (const item of this._allItems) {
      if (item.header) {
        pendingHeader = item;
      } else if (matched.has(item)) {
        if (pendingHeader) {
          result.push(pendingHeader);
          pendingHeader = null;
        }
        result.push(item);
      }
    }
    return result;
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

const cssMatchText = styled("span", `
  color: ${theme.autocompleteMatchText};
  .${cssMenuItem.className}-sel > & {
    color: ${theme.autocompleteSelectedMatchText};
  }
`);
const cssMenuHeader = styled("div", `
  display: flex;
  align-items: center;
  padding: 13px 17px 15px 17px;
`);
const cssSearchIcon = styled(icon, `
  --icon-color: ${theme.lightText};
  flex-shrink: 0;
  margin-left: auto;
  margin-right: 4px;
`);
const cssSearch = styled("input", `
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
  outline-offset: 3px;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);
const cssSearchClear = styled(unstyledButton, `
  flex-shrink: 0;
  display: flex;
  align-items: center;
  --icon-color: ${theme.lightText};
`);
const cssMenuDivider = styled(menuDivider, `
  flex-shrink: 0;
  margin: 0;
`);
const cssTruncatedMessageItem = styled("div", `
  color: ${theme.inputPlaceholderFg};
`);
const cssEmptyMessage = styled("div", `
  margin: 8px 24px;
  font-style: italic;
  color: ${theme.lightText};
`);
const cssItemWrap = styled("div", `
  display: contents;
`);
const cssSectionHeader = styled("div", `
  /* Beat the parent .disabled grey so headers stay styled as section labels. */
  color: ${theme.menuSubheaderFg} !important;
  font-size: ${vars.xsmallFontSize};
  text-transform: uppercase;
  font-weight: ${vars.headerControlTextWeight};
  /* Cancel the option-row's 8px 24px padding so this matches menuSubHeader. */
  margin: -8px -24px;
  padding: 8px 24px;
  cursor: default;
  white-space: normal;
`);
const cssPointer = styled("div", `
  cursor: pointer;
`);
