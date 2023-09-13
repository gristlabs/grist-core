/**
 * This module provides the ability to render and edit hierarchical layouts of boxes. Each box may
 * contain a list of other boxes, and horizontally- and vertically-arranged lists alternating with
 * the depth in the hierarchy.
 *
 * Layout
 *    Layout is a tree of LayoutBoxes (HBoxes and VBoxes). It consists of HBoxes and VBoxes in
 *    alternating levels. The leaves of the tree are LeafBoxes, and those are the only items that
 *    may be moved around, with the structure of Boxes above them changing to accommodate.
 *
 * LayoutBox
 *    A LayoutBox is a node in the Layout tree. LayoutBoxes should typically have nothing visual
 *    about them (e.g. no borders) except their dimensions: they serve purely for layout purposes.
 *
 *    A LayoutBox may be an HBox or a VBox. An HBox may contain multiple VBoxes arranged in a row.
 *    A VBox may contain multiple HBoxes one under the other. Either kind of LayoutBox may contain
 *    a single LeafBox instead of child LayoutBoxes. No LayoutBox may be empty, and no LayoutBox
 *    may contain a single LayoutBox as a child: it must contain either multiple LayoutBox
 *    children, or a single LeafBox.
 *
 * LeafBox
 *    A LeafBox is the container for user content, i.e. what needs to be laid out, for example
 *    form elements. LeafBoxes are what the user can drag around to other location in the layout.
 *    All the LeafBoxes in a Layout together fill the entire Layout rectangle. If some parts of
 *    the layout are to be empty, they should still contain an empty LeafBox.
 *
 *    There is no separate JS class for LeafBoxes, they are simply LayoutBoxes with .layout_leaf
 *    class and set leafId and leafContent member observables.
 *
 * Floater
 *    A Floater is a rectangle that floats over the layout with the mouse pointer while the user is
 *    dragging a LeafBox. It contains the content of the LeafBox being dragged, so that the user
 *    can see what is being repositioned.
 *
 * DropOverlay
 *    An DropOverlay is a visual aid to the user to indicate area over the current LeafBox where a
 *    drop may be attempted. It also computes the "affinity": which border of the current LeafBox
 *    the user is trying to target as the insertion point.
 *
 * DropTargeter
 *    DropTargeter displays a set of rectangles, each of which represents a particular allowed
 *    insertion point for the element being dragged. E.g. dragging an element to the right side of
 *    a LeafBox would display a drop target for each LayoutBox up the tree that allows a sibling
 *    to be inserted on the right.
 *
 * Saving Changes
 * --------------
 *    We don't attempt to save granular changes to the layout, for each drag operation, because
 *    for the user, it's better to finish editing the layout, and only save the end result. Also,
 *    it's not so easy (the structure changes many times while dragging, and a single drag
 *    operation results in a non-trivial diff of the 'before' and 'after' layouts). So instead, we
 *    just have a way to serialize the layout to and from a JSON blob.
 */


import dom, {detachNode, findAncestor} from 'app/client/lib/dom';
import koArray, {isKoArray, KoArray} from 'app/client/lib/koArray';
import {cssClass, domData, foreach, scope, style, toggleClass} from 'app/client/lib/koDom';
import {Disposable} from 'app/client/lib/dispose';
import assert from 'assert';
import {Events as BackboneEvents} from 'backbone';
import * as ko from 'knockout';
import {computed, isObservable, observable, utils} from 'knockout';
import {identity, isEqual, last, uniqueId} from 'underscore';

export interface ContentBox {
  leafId: ko.Observable<any>;
  leafContent: ko.Observable<Element|null>;
  dom: HTMLElement|null;
}

export interface BoxSpec {
  leaf?: string|number;
  size?: number;
  children?: BoxSpec[];
  collapsed?: BoxSpec[];
}

/**
 * A LayoutBox is the node in the hierarchy of boxes comprising the layout. This class is used for
 * rendering as well as for the code editor. Since it may be rendered many times on a page, it's
 * important for it to be efficient.
 * @param {Layout} layout: The Layout object that manages this LayoutBox.
 */
export class LayoutBox extends Disposable implements ContentBox {
  public layout: Layout;
  public dom: HTMLElement | null = null;
  public leafId: ko.Observable<any>; // probably number for section id
  public parentBox: ko.Observable<LayoutBox|null>;
  public childBoxes: KoArray<LayoutBox>;
  public leafContent: ko.Observable<Element|null>;
  public uniqueId: string;
  public isVBox: ko.Computed<boolean>;
  public isHBox: ko.Computed<boolean>;
  public isLeaf: ko.Computed<boolean>;
  public isMaximized: ko.Computed<boolean>;
  public isHidden: ko.Computed<boolean>;
  public flexSize: ko.Observable<number>;
  private _parentBeingDisposed: boolean;

  public create(layout: Layout) {
    this.layout = layout;
    this.parentBox = observable(null as any);
    this.childBoxes = koArray();
    this.leafId = observable(null);
    this.leafContent = observable(null as any);
    this.uniqueId = uniqueId("lb"); // For logging and debugging.

    this.isVBox = this.autoDispose(computed(() => {
      return this.parentBox() ? !this.parentBox()!.isVBox() : true;
    }, this));
    this.isHBox = this.autoDispose(computed(() => { return !this.isVBox(); }));
    this.isLeaf = this.autoDispose(computed(() => { return this.leafId() !== null; },
      this));

    this.isMaximized = this.autoDispose(ko.pureComputed(() => {
      const leafId = this.layout?.maximizedLeaf();
      if (!leafId) { return false; }
      if (leafId === this.leafId()) { return true; }
      return this.childBoxes.all().some(function(child) { return child.isMaximized(); });
    }, this));
    this.isHidden = this.autoDispose(ko.pureComputed(() => {
      // If there isn't any maximized box, then no box is hidden.
      const maximized = this.layout?.maximizedLeaf();
      if (!maximized) { return false; }
      return !this.isMaximized();
    }, this));

    // flexSize represents flexWidth for VBoxes and flexHeight for HBoxes.
    // Undesirable transition effects are likely when <1, so we set average value
    // to 100 so that reduction below 1 is rare.
    this.flexSize = observable(100);

    this.dom = null;

    // This is an optimization to avoid the wasted cost of removeFromParent during disposal.
    this._parentBeingDisposed = false;

    this.autoDisposeCallback(() => {
      if (!this._parentBeingDisposed) {
        this.removeFromParent();
      }
      this.childBoxes.peek().forEach(function(child) {
        child._parentBeingDisposed = true;
        child.dispose();
      });
    });
  }
  public getDom() {
    return this.dom || (this.dom = this.autoDispose(this.buildDom()));
  }
  public maximize() {
    if (this.layout.maximizedLeaf.peek() !== this.leafId.peek()) {
      this.layout.maximizedLeaf(this.leafId());
    } else {
      this.layout.maximizedLeaf(null);
    }
  }
  public buildDom() {
    const self = this;
    const wrap = this.layout.needDynamic ? identity : makeStatic;

    return dom('div.layout_box',
      toggleClass('layout_leaf', wrap(this.isLeaf)),
      toggleClass('layout_hidden', this.isHidden),
      toggleClass(this.layout.leafId, wrap(this.isLeaf)),
      cssClass(wrap(function() { return self.isVBox() ? "layout_vbox" : "layout_hbox"; })),
      cssClass(wrap(function() {
        return (self.layout.fillWindow ? 'layout_fill_window' :
          (self.isLastChild() ? 'layout_last_child' : null));
      })),
      style('--flex-grow', wrap(function() {
        return (self.isVBox() || (self.isHBox() && self.layout.fillWindow)) ? self.flexSize() : '';
      })),
      domData('layoutBox', this),
      foreach(wrap(this.childBoxes), function(layoutBox: LayoutBox) {
        return layoutBox.getDom();
      }),
      scope(wrap(this.leafContent), function(leafContent: any) {
        return leafContent;
      })
    );
  }
  /**
   * Moves the leaf id and content from another layoutBox, unsetting them in the source one.
   */
  public takeLeafFrom(sourceLayoutBox: ContentBox) {
    this.leafId(sourceLayoutBox.leafId.peek());
    // Note that we detach the node, so that the old box doesn't destroy its DOM.
    this.leafContent(detachNode(sourceLayoutBox.leafContent.peek()));
    sourceLayoutBox.leafId(null);
    sourceLayoutBox.leafContent(null);
  }
  public setChildren(children: LayoutBox[]) {
    children.forEach((child) => child.parentBox(this));
    this.childBoxes.assign(children);
  }
  public isFirstChild() {
    return this.parentBox() ? this.parentBox()!.childBoxes.peek()[0] === this : true;
  }
  public isLastChild() {
    // Use .all() rather than .peek() because it's used in kd.toggleClass('layout_last_child'), and
    // we want it to automatically stay correct when childBoxes array changes.
    return this.parentBox() ? last(this.parentBox()!.childBoxes.all()) === this : true;
  }
  public isDomDetached() {
    return !(this.dom && this.dom.parentNode);
  }
  public getSiblingBox(isAfter: boolean) {
    if (!this.parentBox()) {
      return null;
    }
    const siblings = this.parentBox()!.childBoxes.peek();
    let index = siblings.indexOf(this);
    if (index < 0) {
      return null;
    }
    index += (isAfter ? 1 : -1);
    return (index < 0 || index >= siblings.length ? null : siblings[index]);
  }
  public _addChild(childBox: LayoutBox, isAfter: boolean, optNextSibling?: LayoutBox) {
    assert(childBox.parentBox() === null, "LayoutBox._addChild: child already has parentBox set");
    let index;
    if (optNextSibling) {
      index = this.childBoxes.peek().indexOf(optNextSibling) + (isAfter ? 1 : 0);
    } else {
      index = isAfter ? this.childBoxes.peekLength : 0;
    }
    childBox.parentBox(this);
    this.childBoxes.splice(index, 0, childBox);
  }
  public addSibling(childBox: LayoutBox, isAfter: boolean) {
    childBox.removeFromParent();
    const parentBox = this.parentBox();
    if (parentBox) {
      // Normally, we just add a sibling as requested.
      parentBox._addChild(childBox, isAfter, this);
    } else {
      // If adding a sibling to the root node (another VBox), we need to create a new root and push
      // things down two levels (HBox and VBox), and add the sibling to the lower VBox.
      if (this.childBoxes.peekLength === 1) {
        // Except when the root has a single child, in which case there is already a good place to
        // add the new node two levels lower. And we should not create another level because the
        // root is the only place that can have a single child.
        const lowerBox = this.childBoxes.peek()[0];
        assert(!lowerBox.isLeaf(), 'LayoutBox.addSibling: should not have leaf as a single child');
        lowerBox._addChild(childBox, isAfter);
      } else {
        // Create a new root, and add the sibling two levels lower.
        const vbox = LayoutBox.create(this.layout);
        const hbox = LayoutBox.create(this.layout);
        // We don't need removeFromParent here because this only runs when there is no parent.
        vbox._addChild(hbox, false);
        hbox._addChild(this, false);
        hbox._addChild(childBox, isAfter);
        this.layout.setRoot(vbox);
      }
    }
    this.layout.trigger('layoutChanged');
  }
  public addChild(childBox: LayoutBox, isAfter: boolean) {
    childBox.removeFromParent();
    if (this.isLeaf()) {
      // Move the leaf data into a new child, then add the requested childBox.
      const newBox = LayoutBox.create(this.layout);
      newBox.takeLeafFrom(this);
      this._addChild(newBox, false);
    }
    this._addChild(childBox, isAfter);
    this.layout.trigger('layoutChanged');
  }
  public toString(): string {
    return this.isDisposed() ? this.uniqueId + "[disposed]" : (this.uniqueId +
      (this.isHBox() ? "H" : "V") +
      (this.isLeaf() ? "(" + this.leafId() + ")" :
        "[" + this.childBoxes.peek().map(function(b) { return b.toString(); }).join(",") + "]")
    );
  }
  public _removeChildBox(childBox: LayoutBox) {
    //console.log("_removeChildBox %s from %s", childBox.toString(), this.toString());
    let index = this.childBoxes.peek().indexOf(childBox);
    childBox.parentBox(null);
    if (index >= 0) {
      this.childBoxes.splice(index, 1);
      this.rescaleFlexSizes();
    }
    if (this.childBoxes.peekLength === 1) {
      // If we now have a single child, then something needs to collapse.
      const lowerBox = this.childBoxes.peek()[0];
      const parentBox = this.parentBox();
      if (lowerBox.isLeaf()) {
        // Move the leaf data into ourselves, and remove the lower box.
        this.takeLeafFrom(lowerBox);
        lowerBox.dispose();
      } else if (parentBox) {
        // Move grandchildren into our place within our parent, and collapse two levels.
        // (Unless we are the root, in which case it's OK for us to have a single non-leaf child.)
        index = parentBox.childBoxes.peek().indexOf(this);
        assert(index >= 0, 'LayoutBox._removeChildBox: box not found in parent');

        const grandchildBoxes = lowerBox.childBoxes.peek();
        grandchildBoxes.forEach(function(box) { box.parentBox(parentBox); });
        parentBox.childBoxes.arraySplice(index, 0, grandchildBoxes);

        lowerBox.childBoxes.splice(0, lowerBox.childBoxes.peekLength);
        this.removeFromParent();

        lowerBox.dispose();
        this.dispose();
      }
    }
  }
  /**
   * Helper to detach a box from its parent without disposing it. If you no longer plan to reattach
   * the box, you should probably call box.dispose().
   */
  public removeFromParent() {
    if (this.parentBox()) {
      this.parentBox()!._removeChildBox(this);
      this.layout.trigger('layoutChanged');
    }
  }
  /**
   * Adjust flexSize values of the children so that they add up to at least 1.
   * Otherwise, Firefox will not stretch them to the full size of the container.
   */
  public rescaleFlexSizes() {
    // Just scale so that the smallest value is 1.
    const children = this.childBoxes.peek();
    const minSize = Math.min.apply(null, children.map(function(b) { return b.flexSize(); }));
    if (minSize < 1) {
      children.forEach(function(b) {
        b.flexSize(b.flexSize() / minSize);
      });
    }
  }
}

/**
 * This helper turns a value, observable, or function (as accepted by koDom functions) into a
 * plain value. It's used to build a static piece of DOM without subscribing to any of the
 * observables, to avoid the performance cost of subscribing/unsubscribing.
 */
function makeStatic(valueOrFunc: any) {
  if (isObservable(valueOrFunc) || isKoArray(valueOrFunc)) {
    return valueOrFunc.peek();
  } else if (typeof valueOrFunc === 'function') {
    return valueOrFunc();
  } else {
    return valueOrFunc;
  }
}

//----------------------------------------------------------------------

/**
 * @event layoutChanged: Triggered on changes to the structure of the layout.
 * @event layoutResized: Triggered on non-structural changes that may affect the size of rootElem.
 */
export class Layout extends Disposable {
  /**
   * You can also find the nearest containing LayoutBox without having the Layout object itself by
   * using Layout.Layout.getContainingBox. The Layout object is then accessible as box.layout.
   */
  public static getContainingBox(elem: Element|null, optContainer: any) {
    const boxElem = findAncestor(elem, optContainer, '.layout_box');
    return boxElem ? utils.domData.get(boxElem, 'layoutBox') : null;
  }

  public listenTo: BackboneEvents["listenTo"];            // set by Backbone
  public trigger: BackboneEvents["trigger"];              // set by Backbone
  public stopListening: BackboneEvents["stopListening"];  // set by Backbone

  public maximizedLeaf: ko.Observable<string|null>;
  public rootBox: ko.Observable<LayoutBox|null>;
  public createLeafFunc: (id: string) => HTMLElement;
  public fillWindow: boolean;
  public needDynamic: boolean;
  public rootElem: HTMLElement;
  public leafId: string;
  private _leafIdMap: Map<any, LayoutBox>|null;

  public create(boxSpec: BoxSpec, createLeafFunc: (id: string) => HTMLElement, optFillWindow: boolean) {
    this.maximizedLeaf = observable(null as (string|null));
    this.rootBox = observable(null as any);
    this.createLeafFunc = createLeafFunc;
    this._leafIdMap = null;
    this.fillWindow = optFillWindow || false;
    this.needDynamic = false;
    this.rootElem = this.autoDispose(this.buildDom());

    // Generates a unique id class so boxes can only be placed next to other boxes in this layout.
    this.leafId = uniqueId('layout_leaf_');

    this.buildLayout(boxSpec || {});

    // Invalidate the _leafIdMap when the layout is adjusted.
    this.listenTo(this, 'layoutChanged', () => { this._leafIdMap = null; });

    this.autoDisposeCallback(() => {
      if (this.rootBox()) {
        this.rootBox()!.dispose();
      }
    });
  }
  /**
   * Finds and returns the leaf layout box containing the content for the given leafId.
   */
  public getLeafBox(leafId: string|number) {
    return this.getLeafIdMap().get(leafId);
  }
  /**
   * Returns the list of all leafIds present in this layout.
   */
  public getAllLeafIds() {
    return Array.from(this.getLeafIdMap().keys());
  }
  public setRoot(layoutBox: LayoutBox) {
    this.rootBox(layoutBox);
  }
  public buildDom() {
    return dom('div.layout_root',
      domData('layoutModel', this),
      toggleClass('layout_fill_window', this.fillWindow),
      toggleClass('layout_box_maximized', this.maximizedLeaf),
      scope(this.rootBox, (rootBox: LayoutBox) => {
        return rootBox ? rootBox.getDom() : null;
      })
    );
  }
  /**
   * Calls cb on each box in the layout recursively.
   */
  public forEachBox(cb: (box: LayoutBox) => void, optContext?: any) {
    if (!this.rootBox.peek()) {
      return;
    }
    function iter(box: any) {
      cb.call(optContext, box);
      box.childBoxes.peek().forEach(iter);
    }
    iter(this.rootBox.peek());
  }
  public buildLayoutBox(boxSpec: BoxSpec) {
    // Note that this is hot code: it runs when rendering a layout for each record, not only for the
    // layout editor.
    const box = LayoutBox.create(this);
    if (boxSpec.size) {
      box.flexSize(boxSpec.size);
    }
    if (boxSpec.leaf) {
      box.leafId(boxSpec.leaf);
      box.leafContent(this.createLeafFunc(box.leafId()!));
    } else if (boxSpec.children) {
      box.setChildren(boxSpec.children.map(this.buildLayoutBox, this));
    }
    return box;
  }
  public buildLayout(boxSpec: BoxSpec, needDynamic = false) {
    if (needDynamic === this.needDynamic &&
      this.rootBox() &&
      isEqual(boxSpec, this.getLayoutSpec())) {
      // Nothing has changed, and we already have a layout. No need to rebuild.
      return;
    }
    this.needDynamic = needDynamic;
    const oldRootBox = this.rootBox();
    this.rootBox(this.buildLayoutBox(boxSpec));
    this.trigger('layoutChanged');
    if (oldRootBox) {
      oldRootBox.dispose();
    }
  }
  public _getBoxSpec(layoutBox: LayoutBox) {
    const spec: BoxSpec = {};
    if (layoutBox.isDisposed()) {
      return spec;
    }
    if (layoutBox.flexSize() && layoutBox.flexSize() !== 100) {
      spec.size = layoutBox.flexSize();
    }
    if (layoutBox.isLeaf()) {
      spec.leaf = layoutBox.leafId();
    } else {
      spec.children = layoutBox.childBoxes.peek().map(this._getBoxSpec, this);
    }
    return spec;
  }
  public getLayoutSpec() {
    const rootBox = this.rootBox();
    return rootBox ? this._getBoxSpec(rootBox) : {};
  }
  /**
   * Returns a Map object mapping leafId to its LayoutBox. This gets invalidated on layoutAdjust
   * events, and rebuilt on next request.
   */
  public getLeafIdMap() {
    if (!this._leafIdMap) {
      this._leafIdMap = new Map<number|string, LayoutBox>();
      this.forEachBox((box) => {
        const leafId = box.leafId.peek();
        if (leafId !== null) {
          this._leafIdMap!.set(leafId, box);
        }
      }, this);
    }
    return this._leafIdMap;
  }
  /**
   * Returns a LayoutBox object containing the given DOM element, or null if not found.
   */
  public getContainingBox(elem: Element|null) {
    return Layout.getContainingBox(elem, this.rootElem);
  }
}

Object.assign(Layout.prototype, BackboneEvents);
