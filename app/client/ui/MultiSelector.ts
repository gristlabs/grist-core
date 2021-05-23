/**
 * Usage in Grist: Multi-selector component serves as the base class for Sorting, Filtering,
 * Group-By, Linking, and possibly other widgets in Grist.
 *
 * The multi-selector component allows the user to create an ordered list of items selected from a
 * unique list. Visually it shows a list of Items, and a link to add a new item. Each item shows a
 * trash-can icon to remove it. Optionally, items may be reordered relative to each other using a
 * dragger. Each Item contains a dropdown which shows a fixed set of options (e.g. column names).
 * Options already selected (present as other Items) are omitted from the list.
 *
 * Using the link to add a new item creates an "Empty Item" row, which then gets added to
 * the list and becomes a real item when the user chooses a value. Note that the Empty Item
 * uses the empty string '' as its value, so it is not a valid value in the list of items.
 *
 * The MultiSelect class may be extended to be used with enhanced items, to show additional UI (to
 * control additional properties of items, e.g. ascending/descending for sorting), and to provide
 * custom implementation for changes (e.g. adding an item may involve a request to the server).
 *
 * TODO: Implement optional reordering of items
 * TODO: Optionally omit selected items from list
 */

import { computed, MutableObsArray, ObsArray, observable, Observable } from 'grainjs';
import { Disposable, dom, makeTestId, select, styled } from 'grainjs';
import { button1 } from './buttons';

export interface BaseItem {
  value: any;
  label: string;
}

const testId = makeTestId('test-ms-');

export abstract class MultiItemSelector<Item extends BaseItem> extends Disposable {

  constructor(private _incItems: MutableObsArray<Item>, private _allItems: ObsArray<Item>,
              private _options: {
                addItemLabel: string,
                addItemText: string
              }) {
    super();
  }

  public buildDom() {
    return cssMultiSelectorWrapper(
      cssItemList(testId('list'),
        dom.forEach(this._incItems, item => this.buildItemDom(item)),
        this._buildAddItemDom(this._options.addItemLabel, this._options.addItemText)
      ),
    );
  }

  // Must be overridden to return list of available items. Items already present in the items
  // array (according to value) may be safely included, and will not be shown in the select-box.

  // The default implementations update items array, but may be overridden.
  protected async add(item: Item): Promise<void> {
    this._incItems.push(item);
  }

  // Called with an item from `_allItems`
  protected async remove(item: Item): Promise<void> {
    const idx = this._findIncIndex(item);
    if (idx === -1) { return; }
    this._incItems.splice(idx, 1);
  }

  // TODO: Called with an item in the items array
  protected async reorder(item: Item, nextItem: Item): Promise<void> { return; }

  // Replaces an existing item (if found) with a new one
  protected async changeItem(item: Item, newItem: Item): Promise<void> {
    const idx = this._findIncIndex(item);
    if (idx === -1) { return; }
    this._incItems.splice(idx, 1, newItem);
  }

  // Exposed for use by custom buildItemDom().
  protected buildDragHandle(item: Item): Element { return new Element(); }

  protected buildSelectBox(selectedValue: string,
                           selectCb: (newItem: Item) => void,
                           selectOptions?: {}): Element {
    const obs = computed(use => selectedValue).onWrite(async value => {
      const newItem = this._findItemByValue(value);
      if (newItem) {
        selectCb(newItem);
      }
    });

    const result = select(
      obs,
      this._allItems,
      selectOptions
    );
    dom.autoDisposeElem(result, obs);

    return result;
  }

  protected buildRemoveButton(removeCb: () => void): Element {
    return cssItemRemove(testId('remove-btn'),
      dom.on('click', removeCb),
      '✖'
    );
  }

  // May be overridden for custom-looking items.
  protected buildItemDom(item: Item): Element {
    return dom('li', testId('item'),
      // this.buildDragHandle(item), TODO: once dragging is implemented
      this.buildSelectBox(item.value, async newItem => this.changeItem(item, newItem)),
      this.buildRemoveButton(() => this.remove(item))
    );
  }

  // Returns the index (order) of the item if it's been included, or -1 otherwise.
  private _findIncIndex(item: Item): number {
    return this._incItems.get().findIndex(_item => _item === item);
  }

  // Returns the item object given it's value, or undefined if not found.
  private _findItemByValue(value: string): Item | undefined {
    return this._allItems.get().find(_item => _item.value === value);
  }

  // Builds the about-to-be-added item
  private _buildAddItemDom(defLabel: string, defText: string): Element {
    const addNewItem: Observable<boolean> = observable(false);
    return dom('li', testId('add-item'),
      dom.domComputed(addNewItem, isAdding => isAdding
        ? dom.frag(
          this.buildSelectBox('', async newItem => {
            await this.add(newItem);
            addNewItem.set(false);
          }, { defLabel }),
          this.buildRemoveButton(() => addNewItem.set(false)))
        : button1(defText, testId('add-btn'),
          dom.on('click', () => addNewItem.set(true)))
      )
    );
  }
}

const cssMultiSelectorWrapper = styled('div', `
  border: 1px solid blue;
`);

const cssItemList = styled('ul', `
  list-style-type: none;
`);

const cssItemRemove = styled('span', `
  padding: 0 .5rem;
  vertical-align: middle;
  cursor: pointer;
`);
