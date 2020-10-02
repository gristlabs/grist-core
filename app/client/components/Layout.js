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


var ko = require('knockout');
var assert = require('assert');
var _ = require('underscore');
var BackboneEvents = require('backbone').Events;

var dispose = require('../lib/dispose');
var dom = require('../lib/dom');
var kd = require('../lib/koDom');
var koArray = require('../lib/koArray');

/**
 * A LayoutBox is the node in the hierarchy of boxes comprising the layout. This class is used for
 * rendering as well as for the code editor. Since it may be rendered many times on a page, it's
 * important for it to be efficient.
 * @param {Layout} layout: The Layout object that manages this LayoutBox.
 */
function LayoutBox(layout) {
  this.layout = layout;
  this.parentBox = ko.observable(null);
  this.childBoxes = koArray();
  this.leafId = ko.observable(null);
  this.leafContent = ko.observable(null);
  this.uniqueId = _.uniqueId("lb");   // For logging and debugging.

  this.isVBox = this.autoDispose(ko.computed(function() {
    return this.parentBox() ? !this.parentBox().isVBox() : true;
  }, this));
  this.isHBox = this.autoDispose(ko.computed(function() { return !this.isVBox(); }, this));
  this.isLeaf = this.autoDispose(ko.computed(function() { return this.leafId() !== null; },
    this));

  // flexSize represents flexWidth for VBoxes and flexHeight for HBoxes.
  // Undesirable transition effects are likely when <1, so we set average value
  // to 100 so that reduction below 1 is rare.
  this.flexSize = ko.observable(100);

  this.dom = null;

  this._parentBeingDisposed = false;

  // This is an optimization to avoid the wasted cost of removeFromParent during disposal.
  this._parentBeingDisposed = false;

  this.autoDisposeCallback(function() {
    if (!this._parentBeingDisposed) {
      this.removeFromParent();
    }
    this.childBoxes.peek().forEach(function(child) {
      child._parentBeingDisposed = true;
      child.dispose();
    });
  });
}
exports.LayoutBox = LayoutBox;
dispose.makeDisposable(LayoutBox);

LayoutBox.prototype.getDom = function() {
  return this.dom || (this.dom = this.autoDispose(this.buildDom()));
};


/**
 * This helper turns a value, observable, or function (as accepted by koDom functions) into a
 * plain value. It's used to build a static piece of DOM without subscribing to any of the
 * observables, to avoid the performance cost of subscribing/unsubscribing.
 */
function makeStatic(valueOrFunc) {
  if (ko.isObservable(valueOrFunc) || koArray.isKoArray(valueOrFunc)) {
    return valueOrFunc.peek();
  } else if (typeof valueOrFunc === 'function') {
    return valueOrFunc();
  } else {
    return valueOrFunc;
  }
}

LayoutBox.prototype.buildDom = function() {
  var self = this;
  var wrap = this.layout.needDynamic ? _.identity : makeStatic;

  return dom('div.layout_box',
    kd.toggleClass('layout_leaf', wrap(this.isLeaf)),
    kd.toggleClass(this.layout.leafId, wrap(this.isLeaf)),
    kd.cssClass(wrap(function() { return self.isVBox() ? "layout_vbox" : "layout_hbox"; })),
    kd.cssClass(wrap(function() { return (self.layout.fillWindow ? 'layout_fill_window' :
      (self.isLastChild() ? 'layout_last_child' : null));
    })),
    kd.style('flexGrow', wrap(function() {
      return (self.isVBox() || (self.isHBox() && self.layout.fillWindow)) ? self.flexSize() : '';
    })),
    kd.domData('layoutBox', this),
    kd.foreach(wrap(this.childBoxes), function(layoutBox) {
      return layoutBox.getDom();
    }),
    kd.scope(wrap(this.leafContent), function(leafContent) {
      return leafContent;
    })
  );
};

/**
 * Moves the leaf id and content from another layoutBox, unsetting them in the source one.
 */
LayoutBox.prototype.takeLeafFrom = function(sourceLayoutBox) {
  this.leafId(sourceLayoutBox.leafId.peek());
  // Note that we detach the node, so that the old box doesn't destroy its DOM.
  this.leafContent(dom.detachNode(sourceLayoutBox.leafContent.peek()));
  sourceLayoutBox.leafId(null);
  sourceLayoutBox.leafContent(null);
};

LayoutBox.prototype.setChildren = function(children) {
  children.forEach(function(child) {
    child.parentBox(this);
  }, this);
  this.childBoxes.assign(children);
};

LayoutBox.prototype.isFirstChild = function() {
  return this.parentBox() ? this.parentBox().childBoxes.peek()[0] === this : true;
};

LayoutBox.prototype.isLastChild = function() {
  // Use .all() rather than .peek() because it's used in kd.toggleClass('layout_last_child'), and
  // we want it to automatically stay correct when childBoxes array changes.
  return this.parentBox() ? _.last(this.parentBox().childBoxes.all()) === this : true;
};

LayoutBox.prototype.isDomDetached = function() {
  return !(this.dom && this.dom.parentNode);
};

LayoutBox.prototype.getSiblingBox = function(isAfter) {
  if (!this.parentBox()) {
    return null;
  }
  var siblings = this.parentBox().childBoxes.peek();
  var index = siblings.indexOf(this);
  if (index < 0) {
    return null;
  }
  index += (isAfter ? 1 : -1);
  return (index < 0 || index >= siblings.length ? null : siblings[index]);
};

LayoutBox.prototype._addChild = function(childBox, isAfter, optNextSibling) {
  assert(childBox.parentBox() === null, "LayoutBox._addChild: child already has parentBox set");
  var index;
  if (optNextSibling) {
    index = this.childBoxes.peek().indexOf(optNextSibling) + (isAfter ? 1 : 0);
  } else {
    index = isAfter ? this.childBoxes.peekLength : 0;
  }
  childBox.parentBox(this);
  this.childBoxes.splice(index, 0, childBox);
};


LayoutBox.prototype.addSibling = function(childBox, isAfter) {
  childBox.removeFromParent();
  var parentBox = this.parentBox();
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
      var lowerBox = this.childBoxes.peek()[0];
      assert(!lowerBox.isLeaf(), 'LayoutBox.addSibling: should not have leaf as a single child');
      lowerBox._addChild(childBox, isAfter);
    } else {
      // Create a new root, and add the sibling two levels lower.
      var vbox = LayoutBox.create(this.layout);
      var hbox = LayoutBox.create(this.layout);
      // We don't need removeFromParent here because this only runs when there is no parent.
      vbox._addChild(hbox, false);
      hbox._addChild(this, false);
      hbox._addChild(childBox, isAfter);
      this.layout.setRoot(vbox);
    }
  }
  this.layout.trigger('layoutChanged');
};

LayoutBox.prototype.addChild = function(childBox, isAfter) {
  childBox.removeFromParent();
  if (this.isLeaf()) {
    // Move the leaf data into a new child, then add the requested childBox.
    var newBox = LayoutBox.create(this.layout);
    newBox.takeLeafFrom(this);
    this._addChild(newBox, 0);
  }
  this._addChild(childBox, isAfter);
  this.layout.trigger('layoutChanged');
};

LayoutBox.prototype.toString = function() {
  return this.isDisposed() ? this.uniqueId + "[disposed]" : (this.uniqueId +
    (this.isHBox() ? "H" : "V") +
    (this.isLeaf() ? "(" + this.leafId() + ")" :
      "[" + this.childBoxes.peek().map(function(b) { return b.toString(); }).join(",") + "]")
  );
};

LayoutBox.prototype._removeChildBox = function(childBox) {
  //console.log("_removeChildBox %s from %s", childBox.toString(), this.toString());
  var index = this.childBoxes.peek().indexOf(childBox);
  childBox.parentBox(null);
  if (index >= 0) {
    this.childBoxes.splice(index, 1);
    this.rescaleFlexSizes();
  }
  if (this.childBoxes.peekLength === 1) {
    // If we now have a single child, then something needs to collapse.
    var lowerBox = this.childBoxes.peek()[0];
    var parentBox = this.parentBox();
    if (lowerBox.isLeaf()) {
      // Move the leaf data into ourselves, and remove the lower box.
      this.takeLeafFrom(lowerBox);
      lowerBox.dispose();
    } else if (parentBox) {
      // Move grandchildren into our place within our parent, and collapse two levels.
      // (Unless we are the root, in which case it's OK for us to have a single non-leaf child.)
      index = parentBox.childBoxes.peek().indexOf(this);
      assert(index >= 0, 'LayoutBox._removeChildBox: box not found in parent');

      var grandchildBoxes = lowerBox.childBoxes.peek();
      grandchildBoxes.forEach(function(box) { box.parentBox(parentBox); });
      parentBox.childBoxes.arraySplice(index, 0, grandchildBoxes);

      lowerBox.childBoxes.splice(0, lowerBox.childBoxes.peekLength);
      this.removeFromParent();

      lowerBox.dispose();
      this.dispose();
    }
  }
};

/**
 * Helper to detach a box from its parent without disposing it. If you no longer plan to reattach
 * the box, you should probably call box.dispose().
 */
LayoutBox.prototype.removeFromParent = function() {
  if (this.parentBox()) {
    this.parentBox()._removeChildBox(this);
    this.layout.trigger('layoutChanged');
  }
};

/**
 * Adjust flexSize values of the children so that they add up to at least 1.
 * Otherwise, Firefox will not stretch them to the full size of the container.
 */
LayoutBox.prototype.rescaleFlexSizes = function() {
  // Just scale so that the smallest value is 1.
  var children = this.childBoxes.peek();
  var minSize = Math.min.apply(null, children.map(function(b) { return b.flexSize(); }));
  if (minSize < 1) {
    children.forEach(function(b) {
      b.flexSize(b.flexSize() / minSize);
    });
  }
};


//----------------------------------------------------------------------

/**
 * @event layoutChanged: Triggered on changes to the structure of the layout.
 * @event layoutResized: Triggered on non-structural changes that may affect the size of rootElem.
 */
function Layout(boxSpec, createLeafFunc, optFillWindow) {
  this.rootBox = ko.observable(null);
  this.createLeafFunc = createLeafFunc;
  this._leafIdMap = null;
  this.fillWindow = optFillWindow || false;
  this.needDynamic = false;
  this.rootElem = this.autoDispose(this.buildDom());

  // Generates a unique id class so boxes can only be placed next to other boxes in this layout.
  this.leafId = _.uniqueId('layout_leaf_');

  this.buildLayout(boxSpec || {});

  // Invalidate the _leafIdMap when the layout is adjusted.
  this.listenTo(this, 'layoutChanged', function() { this._leafIdMap = null; });

  this.autoDisposeCallback(function() {
    if (this.rootBox()) {
      this.rootBox().dispose();
    }
  });
}
exports.Layout = Layout;
dispose.makeDisposable(Layout);
_.extend(Layout.prototype, BackboneEvents);


/**
 * Returns a LayoutBox object containing the given DOM element, or null if not found.
 */
Layout.prototype.getContainingBox = function(elem) {
  return Layout.getContainingBox(elem, this.rootElem);
};

/**
 * You can also find the nearest containing LayoutBox without having the Layout object itself by
 * using Layout.Layout.getContainingBox. The Layout object is then accessible as box.layout.
 */
Layout.getContainingBox = function(elem, optContainer) {
  var boxElem = dom.findAncestor(elem, optContainer, '.layout_box');
  return boxElem ? ko.utils.domData.get(boxElem, 'layoutBox') : null;
};

/**
 * Finds and returns the leaf layout box containing the content for the given leafId.
 */
Layout.prototype.getLeafBox = function(leafId) {
  return this.getLeafIdMap().get(leafId);
};

/**
 * Returns the list of all leafIds present in this layout.
 */
Layout.prototype.getAllLeafIds = function() {
  return Array.from(this.getLeafIdMap().keys());
};

Layout.prototype.setRoot = function(layoutBox) {
  this.rootBox(layoutBox);
};

Layout.prototype.buildDom = function() {
  return dom('div.layout_root',
    kd.domData('layoutModel', this),
    kd.toggleClass('layout_fill_window', this.fillWindow),
    kd.scope(this.rootBox, function(rootBox) {
      return rootBox ? rootBox.getDom() : null;
    })
  );
};

/**
 * Calls cb on each box in the layout recursively.
 */
Layout.prototype.forEachBox = function(cb, optContext) {
  function iter(box) {
    cb.call(optContext, box);
    box.childBoxes.peek().forEach(iter);
  }
  iter(this.rootBox.peek());
};

Layout.prototype.buildLayoutBox = function(boxSpec) {
  // Note that this is hot code: it runs when rendering a layout for each record, not only for the
  // layout editor.
  var box = LayoutBox.create(this);
  if (boxSpec.size) {
    box.flexSize(boxSpec.size);
  }
  if (boxSpec.leaf) {
    box.leafId(boxSpec.leaf);
    box.leafContent(this.createLeafFunc(box.leafId()));
  } else if (boxSpec.children) {
    box.setChildren(boxSpec.children.map(this.buildLayoutBox, this));
  }
  return box;
};

Layout.prototype.buildLayout = function(boxSpec, needDynamic) {
  this.needDynamic = needDynamic;
  var oldRootBox = this.rootBox();
  this.rootBox(this.buildLayoutBox(boxSpec));
  this.trigger('layoutChanged');
  if (oldRootBox) {
    oldRootBox.dispose();
  }
};

Layout.prototype._getBoxSpec = function(layoutBox) {
  var spec = {};
  if (layoutBox.flexSize() && layoutBox.flexSize() !== 100) {
    spec.size = layoutBox.flexSize();
  }
  if (layoutBox.isLeaf()) {
    spec.leaf = layoutBox.leafId();
  } else {
    spec.children = layoutBox.childBoxes.peek().map(this._getBoxSpec, this);
  }
  return spec;
};

Layout.prototype.getLayoutSpec = function() {
  return this._getBoxSpec(this.rootBox());
};

/**
 * Returns a Map object mapping leafId to its LayoutBox. This gets invalidated on layoutAdjust
 * events, and rebuilt on next request.
 */
Layout.prototype.getLeafIdMap = function() {
  if (!this._leafIdMap) {
    this._leafIdMap = new Map();
    this.forEachBox(function(box) {
      var leafId = box.leafId.peek();
      if (leafId !== null) {
        this._leafIdMap.set(leafId, box);
      }
    }, this);
  }
  return this._leafIdMap;
};
