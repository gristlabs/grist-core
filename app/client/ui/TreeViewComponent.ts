import { TreeItem, TreeModel, TreeNode, walkTree } from "app/client/models/TreeModel";
import { mouseDrag, MouseDragHandler, MouseDragStart } from "app/client/ui/mouseDrag";
import * as css from 'app/client/ui/TreeViewComponentCss';
import { Computed, dom, DomArg, Holder } from "grainjs";
import { Disposable, IDisposable, makeTestId, ObsArray, Observable, observable } from "grainjs";
import debounce = require('lodash/debounce');
import defaults = require("lodash/defaults");
import noop = require('lodash/noop');

// DropZone identifies a location where an item can be inserted
interface DropZone {
  zone: 'above'|'below'|'within';
  item: ItemModel;

  // `locked` allows to lock the dropzone until the cursor leaves the current item. This is useful
  // when the dropzone is not computed from the cursor position but rather is set to 'within' an
  // item when the auto-expander's timeout expires (defined in `this._updateExpander(...)`). In such
  // a case it would be nearly impossible for the user to properly drop the item without the
  // lock. Because when she releases the mouse she is very likely to move cursor unintentionally
  // which would update the dropZone to either 'above' or 'below' and would insert item in the
  // desired position.
  locked?: boolean;
}

// The view model for a TreeItem
interface ItemModel {
  highlight: Observable<boolean>;
  collapsed: Observable<boolean>;
  dragged: Observable<boolean>;
  // vertical distance in px the user is dragging the item
  deltaY: Observable<number>;
  // the px distance from the left side of the container to the label
  offsetLeft: () => number;
  treeItem: TreeItem;
  headerElement: HTMLElement;
  containerElement: HTMLElement;
  handleElement: HTMLElement;
  labelElement: HTMLElement;
  offsetElement: HTMLElement;
  arrowElement: HTMLElement;
}

// Whether item1 and item2 are models of the same item.
function eq(item1: ItemModel|"root", item2: ItemModel|"root") {
  if (item1 === "root" && item2 === "root") {
    return true;
  }
  if (item1 === "root" || item2 === "root") {
    return false;
  }
  return item1.treeItem === item2.treeItem;
}

// Set when a drag starts.
interface Drag extends IDisposable {
  startY: number;
  item: ItemModel;
  // a holder used to update the highlight surrounding the target's parent
  highlightedBox: Holder<IDisposable>;
  autoExpander: Holder<{item: ItemModel} & IDisposable>;
}

// The geometry of the target which is a visual artifact showing where the user can drop an item.
interface Target {
  width: number;
  top: number;
  left: number;
}

export interface TreeViewOptions {
  // the number of pixels used for indentation.
  offset?: number;
  expanderDelay?: number;
  // the delay a user has to keep the mouse down on a item before dragging starts
  dragStartDelay?: number;
  isOpen?: Observable<boolean>;
  selected: Observable<TreeItem|null>;
  // When true turns readonly mode on, defaults to false.
  isReadonly?: Observable<boolean>;
}

const testId = makeTestId('test-treeview-');

/**
 * The TreeViewComponent is a component that can show hierarchical data. It supports collapsing
 * children and dragging and dropping to move items in the tree.
 *
 * Hovering an item reveals a handle. User must then grab that handle to drag an item. During drag
 * the handle slides vertically to follow cursor's motion. During drag, the component highlights
 * visually where the user can drop the item by displaying a target (above or below) the targeted
 * item and by highlighting its parent. In order to ensure data consistency, the component prevents
 * dropping an item within its own children. If the cursor leaves the component during a drag, all
 * such visual artifact (handle, target and target's parent) are hidden, but if the cursor re-enter
 * the component without releasing the mouse, they will show again allowing user to resume dragging.
 */
 // note to self: in the future the model will be updated by the server, which could cause conflicts
 // if the user is dragging at the same time. It could be simpler to freeze the model and to differ
 // their resolution until after the drag terminates.
export class TreeViewComponent extends Disposable {

  private readonly _options: Required<TreeViewOptions>;
  private readonly _containerElement: Element;

  private _drag: Holder<Drag> = Holder.create(this);
  private _hoveredItem: ItemModel|"root" = "root";
  private _dropZone: DropZone|null = null;

  private readonly _hideTarget = observable(true);
  private readonly _target = observable<Target>({width: 0, top: 0, left: 0});
  private readonly _dragging = observable(false);
  private readonly _isClosed: Computed<boolean>;

  private _treeItemMap: Map<TreeItem, Element> = new Map();
  private _childrenDom: Observable<Node>;

  constructor(private _model: Observable<TreeModel>, options: TreeViewOptions) {
    super();
    this._options = defaults(options, {
      offset: 10,
      expanderDelay: 1000,
      dragStartDelay: 1000,
      isOpen: Observable.create(this, true),
      isReadonly: Observable.create(this, false),
    });

    // While building dom we add listeners to the children of all tree nodes to watch for changes
    // and call this._update. Hence, repeated calls to this._update is likely to add or remove
    // listeners to the observable that triggered the update which is not supported by grainjs and
    // could fail (possibly infinite loop). Debounce allows for several change to resolve to a
    // single update.
    this._update = debounce(this._update.bind(this), 0, {leading: false});

    // build dom for the tree of children
    this._childrenDom = observable(this._buildChildren(this._model.get().children()));
    this.autoDispose(this._model.addListener(this._update, this));

    this._isClosed = Computed.create(this, (use) => !use(this._options.isOpen));

    this._containerElement = css.treeViewContainer(

      // hides the drop zone and target when the cursor leaves the component
      dom.on('mouseleave', () => {
        this._setDropZone(null);
        const drag = this._drag.get();
        if (drag) {
          drag.autoExpander.clear();
          drag.item.handleElement.style.display = 'none';
        }
      }),

      dom.on('mouseenter', () => {
        const drag = this._drag.get();
        if (drag) {
          drag.item.handleElement.style.display = '';
        }
      }),

      // it's important to insert drop zone indicator before children, otherwise it could prevent
      // some mouse events to hit children's dom
      this._buildTarget(),

      // insert children
      dom.domComputed(this._childrenDom),

      css.treeViewContainer.cls('-close', this._isClosed),
      css.treeViewContainer.cls('-dragging', this._dragging),
      testId('container'),
    );
  }

  public buildDom() { return this._containerElement; }

  // Starts a drag.
  private _startDrag(ev: MouseEvent) {
    if (this._options.isReadonly.get()) { return null; }
    if (this._isClosed.get()) { return null; }
    this._hoveredItem = this._closestItem(ev.target as HTMLElement|null);
    if (this._hoveredItem === "root") {
      return null;
    }
    const drag = {
      startY: ev.clientY - this._hoveredItem.headerElement.getBoundingClientRect().top,
      item: this._hoveredItem,
      highlightedBox: Holder.create(this),
      autoExpander: Holder.create<IDisposable & {item: ItemModel }>(this),
      dispose: () => {
        drag.autoExpander.dispose();
        drag.highlightedBox.dispose();
        drag.item.dragged.set(false);
        drag.item.handleElement.style.display = '';
        drag.item.deltaY.set(0);
      }
    };

    this._drag.autoDispose(drag);
    this._hoveredItem.dragged.set(true);
    this._dragging.set(true);
    return {
      onMove: (mouseEvent: MouseEvent) => this._onMouseMove(mouseEvent),
      onStop: () => this._terminateDragging(),
    };
  }

  // Terminates a drag.
  private _terminateDragging() {
    const drag = this._drag.get();
    // Clearing the `drag` instance before moving the item allow to revert the style of the item
    // being dragged before it gets removed from the model.
    this._drag.clear();
    if (drag && this._dropZone) {
      this._moveTreeNode(drag.item, this._dropZone);
    }
    this._setDropZone(null);
    this._hideTarget.set(true);
    this._dragging.set(false);
  }

  // The target is an horizontal bar indicating where user can drop an item. It typically shows
  // above or below any particular item to indicate where the dragged item would be inserted.
  private _buildTarget() {
    return css.target(
      testId('target'),
      // show only if a drop zone is set
      dom.hide(this._hideTarget),
      dom.style('width', (use) => use(this._target).width + 'px'),
      dom.style('top', (use) => use(this._target).top + 'px'),
      dom.style('left', (use) => use(this._target).left + 'px'),
    );
  }

  // Update this._childrenDom with the content of the new tree. Its rebuilds entirely the tree of
  // items and reuses dom from the old content for each item that were already part of the old
  // tree. Then takes care of disposing dom for those items that were removed from the old tree.
  private _update() {
    this._childrenDom.set(this._buildChildren(this._model.get().children(), 0));

    // Dispose all the items from this._treeItemMap that are not in the new tree. Note an item
    // already takes care of removing itself from the this._treeItemMap on dispose (thanks to the
    // dom.onDispose(() => this._treeItemMap.delete(treeItem)) in this._getOrCreateItem). First
    // create a map with all the items from _treeItemMap (they may or may not be included in the new
    // tree), then walk the new tree and remove all of its items from the map. Eventually, what
    // remains in the map are the elements that need disposal.
    const map = new Map(this._treeItemMap);
    walkTree(this._model.get(), (treeItem) => map.delete(treeItem));
    map.forEach((elem, key) => dom.domDispose(elem));
  }

  // Build list of children. For each child reuses item's dom if already exist and update the offset
  // and the list of children. Also add a listener that calls this._update to children.
  private _buildChildren(children: ObsArray<TreeItem>, level: number = 0) {
    return css.itemChildren(
      children.get().map(treeItem => {
        const elem = this._getOrCreateItem(treeItem);
        this._setOffset(elem, level);
        const itemHeaderElem = elem.children[0];
        const itemChildren = treeItem.children();
        const arrowElement = dom.getData(elem, 'item').arrowElement;
        if (itemChildren) {
          const itemChildrenElem = this._buildChildren(treeItem.children()!, level + 1);
          replaceChildren(elem, itemHeaderElem, itemChildrenElem);
          dom.styleElem(arrowElement, 'visibility', itemChildren.get().length ? 'visible' : 'hidden');
        } else {
          replaceChildren(elem, itemHeaderElem);
          dom.styleElem(arrowElement, 'visibility', 'hidden');
        }
        return elem;
      }),
      dom.autoDispose(children.addListener(this._update, this)),
    );
  }

  // Get or create dom for treeItem.
  private _getOrCreateItem(treeItem: TreeItem): Element {
    let item = this._treeItemMap.get(treeItem);
    if (!item) {
      item = this._buildTreeItemDom(treeItem,
        dom.onDispose(() => this._treeItemMap.delete(treeItem))
      );
      this._treeItemMap.set(treeItem, item);
    }
    return item;
  }

  private _setOffset(el: Element, level: number) {
    const item = dom.getData(el, 'item') as ItemModel;
    item.offsetElement.style.width = level * this._options.offset + "px";
  }

  private _buildTreeItemDom(treeItem: TreeItem, ...args: DomArg[]): Element {
    const collapsed = observable(false);
    const dragged = observable(false);
    // vertical distance in px the user is dragging the item
    const deltaY = observable(0);
    const children = treeItem.children();
    const offsetLeft = () =>
      labelElement.getBoundingClientRect().left - this._containerElement.getBoundingClientRect().left;
    const highlight = observable(false);

    let headerElement: HTMLElement;
    let labelElement: HTMLElement;
    let handleElement: HTMLElement|null = null;
    let offsetElement: HTMLElement;
    let arrowElement: HTMLElement;

    const containerElement = dom('div.itemContainer',
      testId('itemContainer'),
      dom.cls('collapsed', collapsed),
      css.itemHeaderWrapper(
        testId('itemHeaderWrapper'),
        dom.cls('dragged', dragged),
        css.itemHeaderWrapper.cls('-not-dragging', (use) => !use(this._dragging)),
        headerElement = css.itemHeader(
          testId('itemHeader'),
          dom.cls('highlight', highlight),
          dom.cls('selected', (use) => use(this._options.selected) === treeItem),
          offsetElement = css.offset(testId('offset')),
          arrowElement = css.arrow(
            css.dropdown('Dropdown'),
            testId('itemArrow'),
            dom.style('transform', (use) => use(collapsed) ? 'rotate(-90deg)' : ''),
            dom.on('click', (ev) => toggle(collapsed)),
            // Let's prevent dragging to start when un-intentionally holding the mouse down on an arrow.
            dom.on('mousedown', (ev) => ev.stopPropagation()),
          ),
          labelElement = css.itemLabel(
            testId('label'),
            treeItem.buildDom(),
            dom.style('top', (use) => use(deltaY) + 'px')
          ),
          delayedMouseDrag(this._startDrag.bind(this), this._options.dragStartDelay),
        ),
        treeItem.hidden ? null : css.itemLabelRight(
          handleElement = css.centeredIcon('DragDrop',
            dom.style('top', (use) => use(deltaY) + 'px'),
            testId('handle'),
            dom.hide(this._options.isReadonly),
          ),
          mouseDrag((startEvent, elem) => this._startDrag(startEvent))
        ),
      ),
      ...args
    );

    // Associates some of this item internals to the dom element. This is what makes possible to
    // find which item user is currently pointing at using `const item =
    // this._closestItem(ev.target);` where ev is a mouse event.
    const itemModel = {
      collapsed, dragged, children, treeItem, offsetLeft, highlight, deltaY,
      headerElement,
      containerElement,
      handleElement,
      labelElement,
      offsetElement,
      arrowElement,
    } as ItemModel;
    dom.dataElem(containerElement, 'item', itemModel);

    return containerElement;
  }

  private _updateHandle(y: number) {
    const drag = this._drag.get();
    if (drag) {
      drag.item.deltaY.set(y - drag.startY - drag.item.headerElement.getBoundingClientRect().top);
    }
  }

  private _onMouseMove(ev: MouseEvent) {
    if (!(ev.target instanceof HTMLElement)) {
      return null;
    }

    const item = this._closestItem(ev.target);
    if (item === "root") {
      return;
    }

    // updates the expander when cursor is entering a new item while dragging
    const drag = this._drag.get();
    if (drag && !eq(this._hoveredItem, item)) {
      this._updateExpander(drag, item);
    }

    this._hoveredItem = item;

    this._updateHandle(ev.clientY);

    // update the target, update the target's parent
    const dropZone = this._getDropZone(ev.clientY);
    this._setDropZone(dropZone);
  }

  // Set the drop zone and update the target and target's parent
  private _setDropZone(dropZone: DropZone|null) {
    // if there is a locked dropzone on the hovered item already set, do nothing (see
    // `DropZone#locked` documentation at the begin of this file for more detail)
    if (this._dropZone && this._dropZone.locked && eq(this._dropZone.item, this._hoveredItem)) {
      return;
    }
    this._dropZone = dropZone;
    this._updateTarget();
    this._updateTargetParent();
  }

  // Update the target based on this._dropZone.
  private _updateTarget() {
    const dropZone = this._dropZone;
    if (dropZone) {
      const left = this._getDropZoneOffsetLeft(dropZone);
      const width = this._getDropZoneRight(dropZone) - left;
      const top = this._getDropZoneTop(dropZone);
      this._target.set({width, left, top});
      this._hideTarget.set(false);
    } else {
      this._hideTarget.set(true);
    }
  }

  // compute the px distance between the left side of the container and the right side of the header
  private _getDropZoneRight(dropZone: DropZone): number {
    const headerRight = dropZone.item.headerElement.getBoundingClientRect().right;
    const containerRight = this._containerElement.getBoundingClientRect().left;
    return headerRight - containerRight;
  }

  // compute the px distance between the left side of the container and the drop zone
  private _getDropZoneOffsetLeft(dropZone: DropZone): number {
    // when target is 'within' the item we must add one level of indentation to the items left offset
    return dropZone.item.offsetLeft() + (dropZone.zone === 'within' ? this._options.offset : 0);
  }

  // compute the px distance between the top of the container and the drop zone
  private _getDropZoneTop(dropZone: DropZone): number {
    const el = dropZone.item.headerElement;
    // when crossing the border between 2 consecutive items A and B while dragging another item, in
    // order to allow the target to remain steady between A and B we need to remove 2 px when
    // dropzone is 'above', otherwise it causes the target to flicker.
    return dropZone.zone === 'above' ? el.offsetTop - 2 : el.offsetTop + el.clientHeight;
  }

  // Turns off the highlight on the former parent, and turns it on the new parent.
  private _updateTargetParent() {
    const drag = this._drag.get();
    if (!drag) {
      return;
    }
    const newParent = this._dropZone ? this._getDropZoneParent(this._dropZone) : null;
    if (newParent && newParent !== "root") {
      drag.highlightedBox.autoDispose({dispose: () => newParent.highlight.set(false)});
      newParent.highlight.set(true);
    } else {
      // setting holder to a dump value allows to dispose the previous value
      drag.highlightedBox.autoDispose({dispose: noop});
    }
  }

  private _getDropZone(mouseY: number): DropZone|null {
    const item = this._hoveredItem;
    const drag = this._drag.get();

    if (!drag || item === "root") {
      return null;
    }

    // let's not permit dropping above or below the dragged item
    if (eq(drag.item, item)) {
      return null;
    }

    // prevents dropping items into their own children
    if (this._isInChildOf(item.containerElement, drag.item.containerElement)) {
      return null;
    }

    const children = item.treeItem.children();
    const rect = item.headerElement.getBoundingClientRect();

    // if cursor is over the top half of the header set the drop zone to above this item
    if ((mouseY - rect.top) <= rect.height / 2) {
      return {zone: 'above', item};
    }

    // if cursor is over the bottom half of the header set the drop zone to below this item, unless
    // the children are expanded in which case set the drop zone to 'within' this item.
    if ((mouseY - rect.top) > rect.height / 2) {
      if (!item.collapsed.get() && children && children.get().length) {
        // set drop zone to above the first child only if the dragged item is not this item, because
        // it is not allowed to drop item into their own children.
        if (eq(item, drag.item)) {
          return null;
        }
        return {zone: 'within', item};
      } else {
        return {zone: 'below', item};
      }
    }
    return null;
  }

  // Returns whether `element` is nested in a child of `parent`. Both `el` and `parent` must be
  // a child of this._containerElement.
  private _isInChildOf(el: Element, parent: Element) {
    while (el.parentElement
           && el.parentElement !== parent
           && el.parentElement !== this._containerElement // let's stop at the top element
           ) {
      el = el.parentElement;
    }
    return el.parentElement === parent;
  }

  // Finds the closest ancestor with '.itemContainer' and returns the attached ItemModel. Returns
  // "root" if none are found.
  private _closestItem(element: HTMLElement|null): ItemModel|"root" {
    if (element) {
      let el: HTMLElement|null = element;
      while (el && el !== this._containerElement) {
        if (el.classList.contains('itemContainer')) {
          return dom.getData(el, 'item');
        }
        el = el.parentElement;
      }
    }
    return "root";
  }

  // Return the ItemModel of the item's parent or 'root' if parent is the root.
  private _getParent(item: ItemModel): ItemModel|"root" {
    return this._closestItem(item.containerElement.parentElement);
  }

  // Return the ItemModel of the dropZone's parent or 'root' if parent is the root.
  private _getDropZoneParent(zone: DropZone): ItemModel|"root" {
    return zone.zone === 'within' ? zone.item : this._getParent(zone.item);
  }

  // Returns the TreeNode associated with the item or the TreeModel if item is the root.
  private _getTreeNode(item: ItemModel|"root"): TreeNode {
    return item === "root" ? this._model.get() : item.treeItem;
  }

  // returns the item that is just after where zone is pointing to
  private _getNextChild(zone: DropZone): TreeItem|undefined {
    const children = this._getTreeNode(this._getDropZoneParent(zone)).children();
    if (!children) {
      return undefined;
    }
    switch (zone.zone) {
      case "within": return children.get()[0];
      case "above": return zone.item.treeItem;
      case "below": return findNext(children.get(), zone.item.treeItem);
    }
  }

  // trigger calls to TreeNode#insertBefore(...) and TreeNode#removeChild(...) to move draggedItem
  // to where zone is pointing to.
  private _moveTreeNode(draggedItem: ItemModel, zone: DropZone) {
    const parentTo = this._getTreeNode(this._getDropZoneParent(zone));
    const childrenTo = parentTo.children();
    const nextChild = this._getNextChild(zone);
    const parentFrom = this._getTreeNode(this._getParent(draggedItem));

    if (!childrenTo) {
      throw new Error('Should not be possible to drop into an item with `null` children');
    }

    if (parentTo === parentFrom) {
      // if dropping an item below the above item, do nothing.
      if (nextChild === draggedItem.treeItem) {
        return;
      }
      // if dropping and item above the below item, do nothing.
      if (findNext(childrenTo.get(), draggedItem.treeItem) === nextChild) {
        return;
      }
    }
    // call callbacks
    parentTo.insertBefore(draggedItem.treeItem, nextChild || null);
  }

  // Shuts down the previous expander, and sets a new one for item if it is not the dragged item and
  // it can be expanded (ie: it has collapsed children or it has empty list of children).
  private _updateExpander(drag: Drag, item: ItemModel) {
    const children = item.treeItem.children();
    if (eq(drag.item, item) || !children || children.get().length && !item.collapsed.get()) {
      drag.autoExpander.clear();
    } else {
      const callback = () => {

        // Expanding the item needs some extra care. Because we could push the dragged item
        // downwards in the view (if the dragged item is below the item to be expanded). In which
        // case we must update `item.deltaY` to reflect the offset in order to prevent an offset
        // between the handle (and the drag image) and the cursor. So let's first save the old pos of the item.
        const oldItemTop = drag.item.headerElement.getBoundingClientRect().top;

        // let's expand the item
        item.collapsed.set(false);

        // let's get the new pos for the dragged item, and get the diff
        const newItemTop = drag.item.headerElement.getBoundingClientRect().top;
        const offset = newItemTop - oldItemTop;

        // let's reflect the offset on `item.deltaY`
        drag.item.deltaY.set(drag.item.deltaY.get() - offset);

        // then set the dropzone.
        this._setDropZone({zone: 'within', item, locked: true});
      };
      const timeoutId = window.setTimeout(callback, this._options.expanderDelay);
      const dispose = () => window.clearTimeout(timeoutId);
      drag.autoExpander.autoDispose({item, dispose});
    }
  }
}

// returns the item next to item in children, or null.
function findNext(children: TreeItem[], item: TreeItem) {
  return children.find((val, i, array) => Boolean(i) && array[i - 1] === item);
}

function toggle(obs: Observable<boolean>) {
  obs.set(!obs.get());
}


export function addTreeView(model: Observable<TreeModel>, options: TreeViewOptions) {
  return dom.create(TreeViewComponent, model, options);
}

// Starts dragging only when the user keeps the mouse down for a while. Also the cursor must not
// move until the timer expires. Implementation relies on `./mouseDrag` and a timer that will call
// `startDrag` only after a timer expires.
function delayedMouseDrag(startDrag: MouseDragStart, delay: number) {
  return mouseDrag((startEvent, el) => {
    // the drag handler is assigned when the timer expires
    let handler: MouseDragHandler|null;
    const timeoutId = setTimeout(() => handler = startDrag(startEvent, el), delay);
    dom.onDisposeElem(el, () => clearTimeout(timeoutId));
    function onMove(ev: MouseEvent) {
      // Clears timeout if cursor moves before timer expires, ie: the startDrag won't be called.
      handler ? handler.onMove(ev) : clearTimeout(timeoutId);
    }
    function onStop(ev: MouseEvent) {
      handler ? handler.onStop(ev) : clearTimeout(timeoutId);
    }
    return {onMove, onStop};
  });
}


// Replaces the children of elem with children.
function replaceChildren(elem: Element, ...children: Element[]) {
  while (elem.firstChild) {
    elem.removeChild(elem.firstChild);
  }
  for (const child of children) {
    elem.appendChild(child);
  }
}
