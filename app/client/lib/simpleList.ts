/**
 * SimpleList is a simple collection of item. Besides holding the items, it also knows which item is
 * selected, and allows selection via keyboard. In particular simpleList does not steal focus from
 * the trigger element, which makes it suitable to show a list of items next to an input element
 * while user is typing without interfering.
 *
 * const array = observable([{label: 'foo': value: 0, {label: 'bar', value: 1}]);
 * const ctl = popupControl(elem, ctl => SimpleList.create(null, ctl, array, action));
 *
 * dom('input', dom.on('click', () => ctl.toggle()));
 */
import { Disposable, dom, Observable, styled } from "grainjs";
import { cssMenuItem, getOptionFull, IOpenController, IOption } from "popweasel";
import { attachMouseOverOnMove, findAncestorChild } from "app/client/lib/autocomplete";
import { menuCssClass, menuItem } from "app/client/ui2018/menus";

export type { IOption, IOptionFull } from 'popweasel';

export class SimpleList<T> extends Disposable {

  public readonly content: HTMLElement;
  private _menuContent: HTMLElement;
  private _selected: HTMLElement;
  private _selectedIndex: number = -1;
  private _mouseOver: {reset(): void};

  constructor(private _ctl: IOpenController,
              private _items: Observable<Array<IOption<T>>>,
              private _action: (value: T) => void) {
    super();
    this.content = cssMenuWrap(
      {class: menuCssClass + ' grist-floating-menu'},
      this._menuContent = cssMenuList(
        dom.forEach(this._items, (i) => {
          const item = getOptionFull(i);
          return cssOptionRow(
            {class: menuItem.className + ' ' + cssMenuItem.className},
            dom.on('click', () => this._doAction(item.value)),
            item.label,
            dom.cls('disabled', Boolean(item.disabled)),
            dom.data('itemValue', item.value),
          );
        }),
      ),
      dom.on('mouseleave', (_ev) => this.setSelected(-1)),
    );
    this.autoDispose(dom.onKeyElem(_ctl.getTriggerElem() as any, 'keydown', {
      Escape: () => this._ctl.close(),
      ArrowDown: () => this.setSelected(this._getNextSelectable(1)),
      ArrowUp: () => this.setSelected(this._getNextSelectable(-1)),
      Enter: () => this._doAction(this._getSelectedData()),
    }));
    this.autoDispose(_items.addListener(() => this._update()));
    this._mouseOver = attachMouseOverOnMove(
      this._menuContent,
      (ev) => this.setSelected(this._findTargetItem(ev.target))
    );
    this._update();
  }

  // When the selected element changes, update the classes of the formerly and newly-selected
  // elements.
  public setSelected(index: number) {
    const elem = (this._menuContent.children[index] as HTMLElement) || null;
    const prev = this._selected;
    if (elem !== prev) {
      const clsName = cssMenuItem.className + '-sel';
      if (prev) { prev.classList.remove(clsName); }
      if (elem) {
        elem.classList.add(clsName);
        elem.scrollIntoView({block: 'nearest'});
      }
    }
    this._selected = elem;
    this._selectedIndex = elem ? index : -1;
  }

  private _update() {
    this._mouseOver?.reset();
  }

  private _findTargetItem(target: EventTarget|null): number {
    // Find immediate child of this._menuContent which is an ancestor of ev.target.
    const elem = findAncestorChild(this._menuContent, target as Element|null);
    if (elem?.classList.contains('disabled')) { return -1; }
    return Array.prototype.indexOf.call(this._menuContent.children, elem);
  }

  private _getSelectedData() {
    return this._selected ? dom.getData(this._selected, 'itemValue') : null;
  }

  private _doAction(value: T | null) {
    // If value is null, simply close the menu. This happens when pressing enter with no element
    // selected.
    if (value) { this._action(value); }
    this._ctl.close();
  }

  private _getNext(index: number, step: 1 | -1): number {
    // Pretend there is an extra element at the end to mean "nothing selected".
    const xsize = this._items.get().length + 1;
    const next = (index + step + xsize) % xsize;
    return (next === xsize - 1) ? -1 : next;
  }

  private _getNextSelectable(step: 1 | -1): number {
    let next = this._getNext(this._selectedIndex, step);
    while (this._menuContent.children[next]?.classList.contains('disabled')) {
      next = this._getNext(next, step);
    }
    return next;
  }
}

const cssMenuWrap = styled('div', `
  position: absolute;
  display: flex;
  flex-direction: column;
  outline: none;
`);
const cssMenuList = styled('ul', `
  overflow: auto;
  list-style: none;
  outline: none;
  padding: 6px 0;
  width: 100%;
`);
const cssOptionRow = styled('li', `
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
`);
