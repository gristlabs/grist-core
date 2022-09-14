/**
 * Implements an autocomplete dropdown.
 */
import {createPopper, Modifier, Instance as Popper, Options as PopperOptions} from '@popperjs/core';
import {ACItem, ACResults, HighlightFunc} from 'app/client/lib/ACIndex';
import {reportError} from 'app/client/models/errors';
import {Disposable, dom, EventCB, IDisposable} from 'grainjs';
import {obsArray, onKeyElem, styled} from 'grainjs';
import merge = require('lodash/merge');
import maxSize from 'popper-max-size-modifier';
import {cssMenu} from 'popweasel';


export interface IAutocompleteOptions<Item extends ACItem> {
  // If provided, applies the css class to the menu container. Could be multiple, space-separated.
  menuCssClass?: string;

  // A single class name to add for the selected item, or 'selected' by default.
  selectedCssClass?: string;

  // Popper options for positioning the popup.
  popperOptions?: Partial<PopperOptions>;

  // To which element to append the popup content. Null means triggerElem.parentNode; string is
  // a selector for the closest matching ancestor of triggerElem, e.g. 'body'.
  // Defaults to the document body.
  attach?: Element|string|null;

  // Given a search term, return the list of Items to render.
  search(searchText: string): Promise<ACResults<Item>>;

  // Function to render a single item.
  renderItem(item: Item, highlightFunc: HighlightFunc): HTMLElement;

  // Get text for the text input for a selected item, i.e. the text to present to the user.
  getItemText(item: Item): string;

  // A callback triggered when user clicks one of the choices.
  onClick?(): void;
}

/**
 * An instance of an open Autocomplete dropdown.
 */
export class Autocomplete<Item extends ACItem> extends Disposable {
  // The UL element containing the actual menu items.
  protected _menuContent: HTMLElement;

  // Index into _items as well as into _menuContent, -1 if nothing selected.
  protected _selectedIndex: number = -1;

  // Currently selected element.
  protected _selected: HTMLElement|null = null;

  private _popper: Popper;
  private _mouseOver: {reset(): void};
  private _lastAsTyped: string;
  private _items = this.autoDispose(obsArray<Item>([]));
  private _highlightFunc: HighlightFunc;

  constructor(
    private _triggerElem: HTMLInputElement | HTMLTextAreaElement,
    private readonly _options: IAutocompleteOptions<Item>,
  ) {
    super();

    const content = cssMenuWrap(
      this._menuContent = cssMenu({class: _options.menuCssClass || ''},
        dom.forEach(this._items, (item) => _options.renderItem(item, this._highlightFunc)),
        dom.style('min-width', _triggerElem.getBoundingClientRect().width + 'px'),
        dom.on('mouseleave', (ev) => this._setSelected(-1, true)),
        dom.on('click', (ev) => {
          this._setSelected(this._findTargetItem(ev.target), true);
          if (_options.onClick) { _options.onClick(); }
        })
      ),
      // Prevent trigger element from being blurred on click.
      dom.on('mousedown', (ev) => ev.preventDefault()),
    );

    this._mouseOver = attachMouseOverOnMove(this._menuContent,
      (ev) => this._setSelected(this._findTargetItem(ev.target), true));

    // Add key handlers to the trigger element as well as the menu if it is an input.
    this.autoDispose(onKeyElem(_triggerElem, 'keydown', {
      ArrowDown: () => this._setSelected(this._getNext(1), true),
      ArrowUp: () => this._setSelected(this._getNext(-1), true),
    }));

    // Keeps track of the last value as typed by the user.
    this.search();
    this.autoDispose(dom.onElem(_triggerElem, 'input', () => this.search()));

    const attachElem = _options.attach === undefined ? document.body : _options.attach;
    const containerElem = getContainer(_triggerElem, attachElem) ?? document.body;
    containerElem.appendChild(content);

    this.onDispose(() => { dom.domDispose(content); content.remove(); });

    // Prepare and create the Popper instance, which places the content according to the options.
    const popperOptions = merge({}, defaultPopperOptions, _options.popperOptions);
    this._popper = createPopper(_triggerElem, content, popperOptions);
    this.onDispose(() => this._popper.destroy());
  }

  public getSelectedItem(): Item|undefined {
    return this._items.get()[this._selectedIndex];
  }

  public search(findMatch?: (items: Item[]) => number) {
    this._updateChoices(this._triggerElem.value, findMatch).catch(reportError);
  }

  // When the selected element changes, update the classes of the formerly and newly-selected
  // elements and optionally update the text input.
  private _setSelected(index: number, updateValue: boolean) {
    const elem = (this._menuContent.children[index] as HTMLElement) || null;
    const prev = this._selected;
    if (elem !== prev) {
      const clsName = this._options.selectedCssClass || 'selected';
      if (prev) { prev.classList.remove(clsName); }
      if (elem) {
        elem.classList.add(clsName);
        elem.scrollIntoView({block: 'nearest'});
      }
    }
    this._selected = elem;
    this._selectedIndex = elem ? index : -1;

    if (updateValue) {
      // Update trigger's value with the selected choice, or else with the last typed value.
      if (elem) {
        this._triggerElem.value = this._options.getItemText(this.getSelectedItem()!);
      } else {
        this._triggerElem.value = this._lastAsTyped;
      }
    }
  }

  private _findTargetItem(target: EventTarget|null): number {
    // Find immediate child of this._menuContent which is an ancestor of ev.target.
    const elem = findAncestorChild(this._menuContent, target as Element|null);
    return Array.prototype.indexOf.call(this._menuContent.children, elem);
  }

  private _getNext(step: 1 | -1): number {
    // Pretend there is an extra element at the end to mean "nothing selected".
    const xsize = this._items.get().length + 1;
    const next = (this._selectedIndex + step + xsize) % xsize;
    return (next === xsize - 1) ? -1 : next;
  }

  private async _updateChoices(inputVal: string, findMatch?: (items: Item[]) => number): Promise<void> {
    this._lastAsTyped = inputVal;
    // TODO We should perhaps debounce the search() call in some clever way, to avoid unnecessary
    // searches while typing. Today, search() is synchronous in practice, so it doesn't matter.
    const acResults = await this._options.search(inputVal);
    this._highlightFunc = acResults.highlightFunc;
    this._items.set(acResults.items);

    // Plain update() (which is deferred) may be better, but if _setSelected() causes scrolling
    // before the positions are updated, it causes the entire page to scroll horizontally.
    this._popper.forceUpdate();

    this._mouseOver.reset();

    let index: number;
    if (findMatch) {
      index = findMatch(this._items.get());
    } else {
      index = inputVal ? acResults.selectIndex : -1;
    }
    this._setSelected(index, false);
  }
}


// The maxSize modifiers follow recommendations at https://www.npmjs.com/package/popper-max-size-modifier
const calcMaxSize = {
  ...maxSize,
  options: {padding: 4},
};

const applyMaxSize: Modifier<any, any> = {
  name: 'applyMaxSize',
  enabled: true,
  phase: 'beforeWrite',
  requires: ['maxSize'],
  fn({state}: any) {
    // The `maxSize` modifier provides this data
    const {height} = state.modifiersData.maxSize;
    Object.assign(state.styles.popper, {
      maxHeight: `${Math.max(160, height)}px`
    });
  }
};

export const defaultPopperOptions: Partial<PopperOptions> = {
  placement: 'bottom-start',
  modifiers: [
    calcMaxSize,
    applyMaxSize,
    {name: "computeStyles", options: {gpuAcceleration: false}},
  ],
};


/**
 * Helper that finds the container according to attachElem. Null means
 * elem.parentNode; string is a selector for the closest matching ancestor, e.g. 'body'.
 */
 function getContainer(elem: Element, attachElem: Element|string|null): Node|null {
  return (typeof attachElem === 'string') ? elem.closest(attachElem) :
    (attachElem || elem.parentNode);
}

/**
 * Helper function which returns the direct child of ancestor which is an ancestor of elem, or
 * null if elem is not a descendant of ancestor.
 */
export function findAncestorChild(ancestor: Element, elem: Element|null): Element|null {
  while (elem && elem.parentElement !== ancestor) {
    elem = elem.parentElement;
  }
  return elem;
}

/**
 * A version of dom.onElem('mouseover') that doesn't start firing until there is first a 'mousemove'.
 * This way if an element is created under the mouse cursor (triggered by the keyboard, for
 * instance) it's not immediately highlighted, but only when a user moves the mouse.
 * Returns an object with a reset() method, which restarts the wait for mousemove.
 */
export function attachMouseOverOnMove<T extends EventTarget>(elem: T, callback: EventCB<MouseEvent, T>) {
  let lis: IDisposable|undefined;
  function setListener(eventType: 'mouseover'|'mousemove', cb: EventCB<MouseEvent, T>) {
    if (lis) { lis.dispose(); }
    lis = dom.onElem(elem, eventType, cb);
  }
  function reset() {
    setListener('mousemove', (ev, _elem) => {
      setListener('mouseover', callback);
      callback(ev, _elem);
    });
  }
  reset();
  return {reset};
}

const cssMenuWrap = styled('div', `
  position: absolute;
  display: flex;
  flex-direction: column;
  outline: none;
`);
