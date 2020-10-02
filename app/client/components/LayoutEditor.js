/**
 * The LayoutEditor can be attached to a Layout object to allow changing it.
 *
 * Issues:
 * TODO: Hitting ESC while dragging should revert smoothly. We can collapse the original leaf, but
 * not remove it. On Cancel, we would uncollapse it, and remove the newly-inserted targetBox.
 * TODO: UNDO should work. It's OK to just rebuild the old layout without any transition. In other
 * words, this may be fine to do fully outside of LayoutEditor.
 * TODO: if mouseup over an active hint of the DropTargeter, it might be a better experience to
 * reposition to that spot.
 *
 * TEST CASES THAT SHOULD BE VERIFIED AFTER ANY CHANGE.
 * These refer to test/client/components/sampleLayout.js, testable at
 * http://localhost:8080/testKoForm.html#topTab=4.
 * 1. Drag #1 down and up its container element, pausing at borders. Elements around that border
 * should smoothly float to open space for it. Dropping it should cause no jumps.
 * 2. Drag #1 down to top of #6. A grey "drop target" rectangle should appear. Hovering over it
 * should open space over #6. After that, dragging to bottom of #6 and back to top of #6 should
 * open the space automatically without the "drop target".
 * 3. Drag #3 right and left in its container, pausing at borders. Elements should again smoothly
 * float to open space for it. Dropping it should cause no jumps.
 * 4. Drag #4 down into #5, positioning above #5, below, to the left (splitting #5 horizontally)
 * or to the right.
 * 5. Drop #4 onto the leftmost "drop target" on the left side of #5. It should end up as 1/3 of
 * the width of the entire layout, spanning the full height above #6. Drop it back to its place
 * between #3 and #9.
 * 6. Resizing: every vertical line should allow dragging it left or right to resize. The "resize"
 * mouse pointer should appear over a few pixels to the left and right of the border, it should
 * not be a difficult area to target. (This gets messed up if overflow:hidden is set on the box
 * elements.)
 * 7. Drag box 3 to trash; hovering should make it disappear from Layout, mousing back should
 * bring it back. Mouse-up over the trash icon should leave it out of the layout.
 * 8. Drag boxes 3, 9, 10, 2, 7, 1 (8 should stretch vertically), 5 to trash. They should
 * disappear with other elements shrinking or expanding to close the gap.
 * 9. Adding a new element: Drag "+ Add New" box to between 1 and 2. A "drop target" should
 * appear, allowing you to insert it. Same for adding between 3 and 4. Should be no jumps.
 * 10. Drag new element to above #3: three possible drop targets should appear. Hover over each in
 * turn, starting from the bottommost part, and make sure it gets inserted in the right level.
 */


var _ = require('underscore');
var ko = require('knockout');
var assert = require('assert');
var Promise = require('bluebird');
var BackboneEvents = require('backbone').Events;

var dispose = require('app/client/lib/dispose');
var {Delay} = require('app/client/lib/Delay');
var dom = require('app/client/lib/dom');
var kd = require('app/client/lib/koDom');
var Layout = require('./Layout');

/**
 * Use the browser globals in a way that allows replacing them with mocks in tests.
 */
var G = require('../lib/browserGlobals').get('window', 'document', '$');

//----------------------------------------------------------------------

/**
 * The Floater class represents a floating version of the element being dragged around. Its size
 * corresponds to the box being dragged. It lets the user see what's being repositioned.
 */
function Floater(fillWindow) {
  this.leafId = ko.observable(null);
  this.leafContent = ko.observable(null);
  this.fillWindow = fillWindow || false;

  this.floaterElem = this.autoDispose(dom('div.layout_editor_floater',
    kd.show(this.leafContent),
    kd.scope(this.leafContent, function(leafContent) {
      return leafContent;
    })
  ));
  G.document.body.appendChild(this.floaterElem);

  this.mouseOffsetX = 0;
  this.mouseOffsetY = 0;
  this.lastMouseEvent = null;
}
dispose.makeDisposable(Floater);

Floater.prototype.onInitialMouseMove = function(mouseEvent, sourceBox) {
  var rect = sourceBox.dom.getBoundingClientRect();
  this.floaterElem.style.width = rect.width + 'px';
  this.floaterElem.style.height = rect.height + 'px';
  this.mouseOffsetX = 0.2 * rect.width;
  this.mouseOffsetY = 0.1 * rect.height;
  this.onMouseMove(mouseEvent);

  this.leafId(sourceBox.leafId());
  this.leafContent(sourceBox.leafContent());
  // We use a dummy non-null leafId here, to ensure that sourceBox remains considered a leaf.
  sourceBox.leafId('empty');
  sourceBox.leafContent(dom('div.layout_editor_empty_space',
    kd.style('margin', (rect.height * 0.02) + 'px'),
    kd.style('min-height', (rect.height * 0.96) + 'px')
  ));
};

Floater.prototype.onMouseUp = function() {
  this.lastMouseEvent = null;
};

Floater.prototype.onMouseMove = function(mouseEvent) {
  this.lastMouseEvent = mouseEvent;
  this.floaterElem.style.left = (mouseEvent.clientX - this.mouseOffsetX) + 'px';
  this.floaterElem.style.top = (mouseEvent.clientY - this.mouseOffsetY) + 'px';
};

//----------------------------------------------------------------------

/**
 * When the user hovers near the edge of a box, we call the direction the "affinity", and it
 * indicates where an insertion is to happen. Affinities are represented by numbers 0 - 3. The
 * functions below distinguish top-down vs left-right, and top/left vs down/right.
 */
//var AFFINITY_NAMES = { 0: 'TOP', 1: 'DOWN', 2: 'LEFT', 3: 'RIGHT' };
function isAffinityUpDown(affinity) { return (affinity >> 1) === 0; }
function isAffinityAfter(affinity) { return (affinity & 1) === 1; }

//----------------------------------------------------------------------

/**
 * DropOverlay is a rectangular indicator that's displayed over a leaf box under the mouse
 * pointer, and shows regions of affinity towards one of the borders. It also computes which
 * region the user is targeting, and returns an affinity value.
 */
function DropOverlay() {
  this.overlayElem = this.autoDispose(dom('div.layout_editor_drop_overlay'));
  this.overlayRect = null;
  this.hBorder = null;
  this.vBorder = null;
}
dispose.makeDisposable(DropOverlay);

/**
 * Hides the overlay box by detaching it from the current element, if any.
 */
DropOverlay.prototype.detach = function() {
  if (this.overlayElem.parentNode) {
    this.overlayElem.parentNode.removeChild(this.overlayElem);
  }
};

function getFrac(distance, max) {
  return distance < max ? distance / max : Infinity;
}

/**
 * Shows the overlay box over the given element.
 */
DropOverlay.prototype.attach = function(targetElem) {
  var rect = this.overlayRect = targetElem.getBoundingClientRect();
  /*
  // If uncommented, this will show areas of affinity when hovering over a box. This is helpful in
  // debugging, and may be helpful to users too, but makes the interface feel more cluttered.
  if (this.overlayElem.parentNode !== targetElem) {
    // This also automatically removes it from the old parent, if any.
    targetElem.appendChild(this.overlayElem);
  }
  */

  // Areas of affinity are essentially fat borders, proportional to width and height. In addition,
  // to avoid overly disproportionate regions, we use twice the smaller dimension to limit the
  // larger dimension.
  this.hBorder = Math.floor(Math.min(rect.height, rect.width * 2) / 3);
  this.vBorder = Math.floor(Math.min(rect.width, rect.height * 2) / 3);
  var s = this.overlayElem.style;
  s.borderTopWidth = s.borderBottomWidth = this.hBorder + 'px';
  s.borderLeftWidth = s.borderRightWidth = this.vBorder + 'px';
};

/**
 * If the mouse is over a region of affinity, returns the affinity as an 0-3 integer (see
 * AFFINITY_NAMES above). Otherwise, returns -1.
 */
DropOverlay.prototype.getAffinity = function(mouseEvent) {
  var rect = this.overlayRect;
  var x = mouseEvent.clientX - rect.left,
      y = mouseEvent.clientY - rect.top,
      top = getFrac(y, this.hBorder),
      down = getFrac(rect.height - y, this.hBorder),
      left = getFrac(x, this.vBorder),
      right = getFrac(rect.width - x, this.vBorder),
      minValue = Math.min(top, down, left, right);

  return (minValue === Infinity ? -1 : [top, down, left, right].indexOf(minValue));
};

//----------------------------------------------------------------------

/**
 * DropTargeter displays a set of rectangles, each of which represents a particular allowed
 * insertion point for the element being dragged. It only shows the insertion points at the edge
 * of a particular layoutBox as indicated by DropOverlay.
 */
function DropTargeter(rootElem) {
  this.rootElem = rootElem;
  this.targetsDom = null;
  this.currentBox = null;
  this.currentAffinity = null;
  this.delayedInsertion = Delay.create();
  this.activeTarget = null;
  this.autoDisposeCallback(this.removeTargetHints);
}
dispose.makeDisposable(DropTargeter);
_.extend(DropTargeter.prototype, BackboneEvents);

DropTargeter.prototype.removeTargetHints = function() {
  this.activeTarget = null;
  this.delayedInsertion.cancel();
  if (this.targetsDom) {
    ko.removeNode(this.targetsDom);
    this.targetsDom = null;
  }
  this.currentBox = null;
  this.currentAffinity = null;
};

DropTargeter.prototype.updateTargetHints = function(layoutBox, affinity, overlay, prevTargetBox) {
  // Nothing to update.
  if (!layoutBox || (layoutBox === this.currentBox && affinity === this.currentAffinity)) {
    return;
  }
  this.removeTargetHints();
  if (affinity === -1) {
    return;
  }
  this.currentBox = layoutBox;
  this.currentAffinity = affinity;

  var upDown = isAffinityUpDown(affinity);
  var isAfter = isAffinityAfter(affinity);

  var targetParts = [];
  // Allow dragging a leaf into another leaf as a child, splitting the latter into two.
  // But don't allow dragging a leaf box into itself, that makes no sense.
  if (upDown === layoutBox.isVBox() && layoutBox !== prevTargetBox) {
    targetParts.push({ box: layoutBox, isChild: true, isAfter: isAfter });
  }
  while (layoutBox) {
    if (upDown === layoutBox.isHBox()) {
      var children = layoutBox.childBoxes.peek();
      // If one of two children is prevTargetBox, replace the last target hint since it
      // will be redundant once prevTargetBox is removed.
      if (children.length === 2 && prevTargetBox.parentBox() === layoutBox) {
        targetParts.splice(targetParts.length - 1, 1,
          { box: layoutBox, isChild: false, isAfter: isAfter });
      }
      // If there is only one child (which may happen for the root box), the target hint
      // is redundant.
      else if (prevTargetBox !== layoutBox && prevTargetBox !== layoutBox.getSiblingBox(isAfter) &&
          children.length !== 1) {
        targetParts.push({ box: layoutBox, isChild: false, isAfter: isAfter });
      }
      if (isAfter && !layoutBox.isLastChild()) { break; }
      if (!isAfter && !layoutBox.isFirstChild()) { break; }
    }
    layoutBox = layoutBox.parentBox();
  }
  if (targetParts.length === 0) {
    return;
  }

  // Render the hint parts.
  if (!isAfter) {
    targetParts.reverse();
  }

  // The same code works for both horizontal and vertical situation. For ease of thinking about
  // it, we pretend below that we are dealing with an up-down situation (drop hints are horizontal
  // wide boxes stacked vertically), and use properties that are named using the up-down
  // situation, but whose values might reflect a left-right situation.
  var pTop = upDown ? 'top' : 'left',
      pHeight = upDown ? 'height' : 'width',
      pLeft = upDown ? 'left' : 'top',
      pWidth = upDown ? 'width' : 'height',
      totalHeight = upDown ? overlay.hBorder : overlay.vBorder,
      singleHeight = Math.floor(totalHeight / targetParts.length);

  // Adjust to account for the rounding-down above.
  totalHeight = singleHeight * targetParts.length;

  var outerRect = this.rootElem.getBoundingClientRect();
  var innerRect = this.currentBox.dom.getBoundingClientRect();

  var self = this;
  this.targetsDom = dom('div.layout_editor_drop_targeter',
    kd.style(pTop,
      (innerRect[pTop] - outerRect[pTop] +
       (isAfter ? innerRect[pHeight] - totalHeight : 0)) + 'px'
    ),
    targetParts.map(function(part, index) {
      var rect = part.box.dom.getBoundingClientRect();
      return dom('div.layout_editor_drop_target', function(elem) {
          elem.style[pHeight] = (singleHeight + 1) + 'px';    // 1px of overlap for better looks
          elem.style[pWidth] = rect[pWidth] + 'px';
          elem.style[pLeft] = (rect[pLeft] - outerRect[pLeft]) + 'px';
          elem.style[pTop] = (singleHeight * index) + 'px';
        },
        dom.on('mouseenter', function() {
          this.classList.add("layout_hover");
          self.activeTarget = part;
          var padDir = upDown ? (isAfter ? 'Bottom' : 'Top') : (isAfter ? 'Right' : 'Left');
          var padding = 'padding' + padDir;
          part.box.dom.style.transition = 'padding .3s';
          part.box.dom.style[padding] = '20px';
        }),
        dom.on('mouseleave', function() {
          this.classList.remove("layout_hover");
          self.activeTarget = null;
          part.box.dom.style.padding = '0';
        }),
        dom.on('transitionend', this.triggerInsertion.bind(this, part))
      );
    }, this)
  );
  this.rootElem.appendChild(this.targetsDom);
};

DropTargeter.prototype.triggerInsertion = function(part) {
  this.removeTargetHints();
  this.trigger('insertBox', function(box) {
    if (part.isChild) {
      part.box.addChild(box, part.isAfter);
    } else {
      part.box.addSibling(box, part.isAfter);
    }
  });
};

DropTargeter.prototype.accelerateInsertion = function() {
  if (this.activeTarget) {
    this.activeTarget.box.dom.style.transition = '';
    this.activeTarget.box.dom.style.padding = '0';
    this.triggerInsertion(this.activeTarget);
  }
};

//----------------------------------------------------------------------

/**
 * When a LayoutEditor is created for a given Layout object, it makes it possible to drag
 * LayoutBoxes to change the layout.
 *
 * When a user drags a box, its content migrates temporarily to the Floater element, which moves
 * with the mouse cursor. As the user drags, the space for the element will open up here or there,
 * by adding an appropriate empty targetBox. DropOverlay and DropTargeter together decide the
 * insertion point for the drag operations.
 *
 * NOTES:
 *  There is some awkwardness in sizing: in a vertically laid out box, the last box takes up all
 *  available space, so moving it away does not show a transition (the box transitions to empty in
 *  theory, but it still takes all the same available space).
 */
function LayoutEditor(layout) {
  this.layout = layout;
  this.rootElem = layout.rootElem;

  this.layout.buildLayout(this.layout.getLayoutSpec(), true);
  this.floater = this.autoDispose(Floater.create(this.layout.fillWindow));
  this.dropOverlay = this.autoDispose(DropOverlay.create());
  this.dropTargeter = this.autoDispose(DropTargeter.create(this.rootElem));
  this.listenTo(this.dropTargeter, 'insertBox', this.onInsertBox);

  // This is a place to put LayoutBoxes that should NOT be shown, but SHOULD be possible to
  // measure. It's used when a new box is being moved into the editor.
  this.measuringBox = this.autoDispose(dom('div.layout_editor_measuring_box'));
  this.rootElem.appendChild(this.measuringBox);

  // For better experience, we prevent new repositions while a transition is active, and we
  // require some work (leaving and re-entering affinity area) after a previous transition ends.
  this.transitionPromise = Promise.resolve();
  this.trashDelay = Delay.create();

  // TODO: We don't use originalBox at the moment, but may want to, specifically to collapse it
  // without removing, and restore if the user hits "Escape".
  // This is the box the user clicked, to move its content elsewhere.
  this.originalBox = null;

  // The new box into which the content is to be inserted. During a move operation, it starts out
  // with this.originalBox.
  this.targetBox = null;

  // Make all LayoutBoxes resizable. Update whenever the layout changes.
  this.layout.forEachBox(this.makeResizable, this);
  this.listenTo(this.layout, 'layoutChanged', function() {
    this.layout.forEachBox(this.makeResizable, this);
  });

  var self = this;
  this.boundMouseDown = function(ev) { return self.handleMouseDown(ev, this); };
  this.boundMouseMove = this.handleMouseMove.bind(this);
  this.boundMouseUp = this.handleMouseUp.bind(this);
  G.$(this.rootElem).on('mousedown', '.layout_leaf', this.boundMouseDown);

  this.initialMouseDown = false;

  this.lastTriggered = 'stop';

  this.autoDisposeCallback(function() {
    G.$(G.window).off('mouseup', this.boundMouseUp);
    G.$(G.window).off('mousemove', this.boundMouseMove);
    G.$(this.rootElem).off('mousedown', this.boundMouseDown);
    if (!this.layout.isDisposed()) {
      this.layout.buildLayout(this.layout.getLayoutSpec(), false);
      this.layout.forEachBox(this.unmakeResizable, this);
    }
  });
}
exports.LayoutEditor = LayoutEditor;

dispose.makeDisposable(LayoutEditor);
_.extend(LayoutEditor.prototype, BackboneEvents);

LayoutEditor.prototype.triggerUserEditStart = function() {
  assert(this.lastTriggered === 'stop', "UserEditStart triggered twice in succession");
  this.lastTriggered = 'start';
  // This attribute allows browser tests to tell when an edit is in progress.
  this.rootElem.setAttribute('data-useredit', 'start');
  this.layout.trigger('layoutUserEditStart');
};

LayoutEditor.prototype.triggerUserEditStop = function() {
  assert(this.lastTriggered === 'start', "UserEditStop triggered twice in succession");
  this.lastTriggered = 'stop';
  this.layout.trigger('layoutUserEditStop');
  // This attribute allows browser tests to tell when an edit is finished.
  this.rootElem.setAttribute('data-useredit', 'stop');
};

LayoutEditor.prototype.makeResizable = function(box) {
  // Do not add resizable if:
  // Box already resizable, box is not vertically resizable, box is last in it`s group.
  if (G.$(box.dom).resizable('instance') || (box.isHBox() && !this.layout.fillWindow) ||
    box.isLastChild()) {
    return;
  }
  var helperObj = { box: box };
  var isWidth = box.isVBox();
  G.$(box.dom).resizable({
    handles: isWidth ? 'e' : 's',
    start: this.onResizeStart.bind(this, helperObj, isWidth),
    resize: this.onResizeMove.bind(this, helperObj, isWidth),
    stop: this.triggerUserEditStop.bind(this)
  });
};

LayoutEditor.prototype.unmakeResizable = function(box) {
  if (G.$(box.dom).resizable("instance")) {
    // Resizable widget is set for this box.
    G.$(box.dom).resizable('destroy');
  }
};

LayoutEditor.prototype.onResizeStart = function(helperObj, isWidth, event, ui) {
  this.triggerUserEditStart();
  var size = isWidth ? ui.originalSize.width : ui.originalSize.height;
  helperObj.scalePerFlexUnit = size / (helperObj.box.flexSize() || 1);
  var allSiblings = helperObj.box.parentBox().childBoxes.peek();
  var index = allSiblings.indexOf(helperObj.box);
  helperObj.nextSiblings = allSiblings.slice(index + 1);
  helperObj.origNextSizes = helperObj.nextSiblings.map(function(b) { return b.flexSize(); });
  helperObj.origSize = helperObj.box.flexSize();
  function adder(sum, box) { return sum + box.flexSize.peek(); }
  helperObj.sumPrev = allSiblings.slice(0, index).reduce(adder, 0);
  helperObj.sumAll = allSiblings.reduce(adder, 0);
  helperObj.sumNext = helperObj.sumAll - helperObj.sumPrev;
};

// We'll snap to 1/NumSteps of total size. The choice of 60 allows many evenly-sized layouts.
var NumSteps = 60;

function round(value, multipleOf) {
  return Math.round(value / multipleOf) * multipleOf;
}

function snap(flexSize, sumPrev, sumAll) {
  var endEdge = round(sumPrev + flexSize, sumAll / NumSteps);
  return Math.min(endEdge, sumAll) - sumPrev;
}

LayoutEditor.prototype.onResizeMove = function(helperObj, isWidth, event, ui) {
  var sizePx = isWidth ? ui.size.width : ui.size.height;
  var newSize = sizePx / helperObj.scalePerFlexUnit;

  // We need some amount of snapping to make it easier to align boxes. The way we'll do it is to
  // adjust flexSize of the box being resized and all following boxes so that boundaries end up at
  // multiples of fullSize / NumSteps.

  newSize = snap(newSize, helperObj.sumPrev, helperObj.sumAll);
  var siblingsFactor = (helperObj.sumNext - newSize) / (helperObj.sumNext - helperObj.origSize);
  var sumPrev = helperObj.sumPrev + newSize;
  var newSizes = [];
  helperObj.origNextSizes.forEach(function(size) {
    var s = snap(size * siblingsFactor, sumPrev, helperObj.sumAll);
    sumPrev += s;
    newSizes.push(s);
  });

  if (newSize <= 0 || newSizes.some(function(size) { return size <= 0; })) {
    return;   // This isn't an acceptable position.
  }
  if (newSize !== helperObj.box.flexSize.peek()) {
    helperObj.box.flexSize(newSize);
    helperObj.nextSiblings.forEach(function(b, i) {
      b.flexSize(newSizes[i]);
    });
    this.layout.trigger('layoutResized');
  }
};

LayoutEditor.prototype.handleMouseDown = function(event, elem) {
  if (event.button !== 0 || event.target.classList.contains('ui-resizable-handle')) {
    return;
  }
  if (event.target.classList.contains('layout_grabbable')) {
    this.initialMouseDown = true;
    this.originalBox = ko.utils.domData.get(elem, 'layoutBox');
    assert(this.originalBox, "MouseDown on element without an associated layoutBox");
    G.$(G.window).on('mousemove', this.boundMouseMove);
    G.$(G.window).on('mouseup', this.boundMouseUp);
    return false;
  }
};

LayoutEditor.prototype.dragInNewBox = function(event, leafId) {
  var box = this.layout.buildLayoutBox({leaf: leafId});

  // Place this box into a measuring div.
  this.measuringBox.appendChild(box.getDom());

  this.handleMouseDown(event, box.dom);
};

LayoutEditor.prototype.startDragBox = function(event, box) {
  this.triggerUserEditStart();
  this.targetBox = box;
  this.floater.onInitialMouseMove(event, box);
};

LayoutEditor.prototype.handleMouseUp = function(event) {
  G.$(G.window).off('mousemove', this.boundMouseMove);
  G.$(G.window).off('mouseup', this.boundMouseUp);

  if (this.initialMouseDown) {
    this.initialMouseDown = false;
    return;
  }

  this.targetBox.takeLeafFrom(this.floater);
  if (this.dropTargeter.activeTarget) {
    this.dropTargeter.accelerateInsertion();
  } else {
    resizeLayoutBox(this.targetBox, 'reset');
  }

  this.dropTargeter.removeTargetHints();
  this.dropOverlay.detach();

  this.transitionPromise.bind(this).finally(function() {
    this.floater.onMouseUp();
    resizeLayoutBox(this.targetBox, 'reset');
    this.targetBox = this.originalBox = null;
    dispose.emptyNode(this.measuringBox);
    this.triggerUserEditStop();
  });
};

LayoutEditor.prototype.removeContainingBox = function(elem) {
  var box = this.layout.getContainingBox(elem);
  if (box && !box.isDomDetached()) {
    this.triggerUserEditStart();
    this.targetBox = box;
    var rect = box.dom.getBoundingClientRect();
    box.leafId('empty');
    box.leafContent(dom('div.layout_editor_empty_space',
      kd.style('min-height', rect.height + 'px')
    ));
    this.onInsertBox(_.noop, rect);
    this.triggerUserEditStop();
  }
};

LayoutEditor.prototype.handleMouseMove = function(event) {
  // Make sure the grabbed box still exists
  if (this.originalBox.isDisposed()) {
    return;
  }

  if (this.initialMouseDown) {
    this.initialMouseDown = false;
    this.startDragBox(event, this.originalBox);
  }
  this.floater.onMouseMove(event);

  if (this.transitionPromise.isPending()) {
    // Don't attempt to do any repositioning while another reposition is happening.
    return;
  }

  // Handle dragging to trash.
  if (dom.findAncestor(event.target, null, '.layout_trash')) {
    var isTrashed = this.targetBox && this.targetBox.isDomDetached();
    if (!this.trashDelay.isPending() && !isTrashed) {
      // To "trash" a box, we call onInsertBox with noop for the inserter function. The new box
      // will still be created, just not attached to anything.
      this.trashDelay.schedule(100, this.onInsertBox, this, _.noop);
    }
    return;
  }
  this.trashDelay.cancel();

  // See if we are over a layout_leaf, and that the leaf is in the same layout as the dragged
  // element. If so, we are dealing with repositioning.
  var elem = dom.findAncestor(event.target, this.rootElem, '.' + this.layout.leafId);
  if (elem) {
    var hoverBox = ko.utils.domData.get(elem, 'layoutBox');
    this.dropOverlay.attach(elem);
    var affinity = this.dropOverlay.getAffinity(event);
    this.dropTargeter.updateTargetHints(hoverBox, affinity, this.dropOverlay, this.targetBox);
  } else if (!dom.findAncestor(event.target, this.rootElem, '.layout_editor_drop_target')) {
    this.dropTargeter.removeTargetHints();
  }
};


/**
 * Resizes the given LayoutBox to transition it when it's supposed to expand or collapse. It only
 * affects the height for HBoxes, and only the width for VBoxes. For rows, we use an explicit
 * height. For columns we rely on 'flex-grow' property.
 *    A rectangle object: set the relevant style according to the values there.
 *    'reset': unset the relevant style, to revert to the values associated with CSS classes.
 *    'collapse': collapse to empty size.
 *    'current': set and explicit value for the relevant style, which is needed for transitions.
 */
function resizeLayoutBox(layoutBox, sizeRect) {
  var reset = (sizeRect === 'reset');
  var collapse = (sizeRect === 'collapse');
  if (sizeRect === 'current') {
    sizeRect = layoutBox.dom.getBoundingClientRect();
  }
  if (layoutBox.isHBox()) {
    layoutBox.dom.style.height = (reset ? '' : (collapse ? '0px' : sizeRect.height + 'px'));
  } else {
    layoutBox.dom.style.width = (reset ? '' : (collapse ? '0px' : sizeRect.width + 'px'));
  }
  layoutBox.dom.style.opacity = collapse ? '0.0' : '1.0';
}

function rectDesc(rect) {
  return (typeof rect === 'string') ? rect :
    Math.floor(rect.width) + "x" + Math.floor(rect.height);
}

/**
 * Resizes the given LayoutBox smoothly from starting to ending position, where startRect and
 * endRect are one of the values documented in 'resizeLayoutBox'.
 */
function resizeLayoutBoxSmoothly(layoutBox, startRect, endRect) {
  if (layoutBox.isDomDetached()) {
    return Promise.resolve();
  }
  var prevFlexGrow = layoutBox.dom.style.flexGrow;
  layoutBox.dom.style.flexGrow = 0;
  resizeLayoutBox(layoutBox, startRect);

  // Force the layout engine to compute the current state of the layoutBox.dom element before
  // applying the transition. This follows the recommendation here, and seems to work:
  // https://timtaubert.de/blog/2012/09/css-transitions-for-dynamically-created-dom-elements/
  _.pick(G.window.getComputedStyle(layoutBox.dom), 'height', 'width');

  // Start the transition.
  layoutBox.dom.classList.add('layout_editor_resize_transition');
  return new Promise(function(resolve, reject) {
    dom.once(layoutBox.dom, 'transitionend', function() { resolve(); });
    resizeLayoutBox(layoutBox, endRect);
  })
  .timeout(600)    // Transitions are only 400ms long, so complain if nothing happened for longer.
  .catch(Promise.TimeoutError, function() {
    console.error("LayoutEditor.resizeLayoutBoxSmoothly %s %s->%s: transition didn't run",
      layoutBox, rectDesc(startRect), rectDesc(endRect));
    // We keep going. It should look like something's wrong and jumpy, but it should still be
    // usable and not cause errors elsewhere.
  })
  .finally(function() {
    layoutBox.dom.classList.remove('layout_editor_resize_transition');
    layoutBox.dom.style.flexGrow = prevFlexGrow;
  });
}

LayoutEditor.prototype.onInsertBox = function(inserterFunc, optRect) {
  // Create a new LayoutBox, and insert it using inserterFunc.
  // Shrink prevTargetBox to 0. Create a new target box, initially shrunk, and grow it.
  var prevTargetBox = this.targetBox;

  this.targetBox = Layout.LayoutBox.create(this.layout);
  this.targetBox.takeLeafFrom(prevTargetBox);
  this.targetBox.flexSize(prevTargetBox.flexSize());

  // Sizing boxes vertically requires extra care that the sum of values doesn't change.
  this.targetBox.getDom();    // Make sure its dom is created.

  //console.log("onInsertBox %s -> %s", prevTargetBox, this.targetBox);
  var transitionPromiseResolve;
  this.transitionPromise = new Promise(function(resolve, reject) {
    transitionPromiseResolve = resolve;
  });

  inserterFunc(this.targetBox);

  var prevRect = prevTargetBox.dom.getBoundingClientRect();

  // Set previous box size to 0 for accurate measurement of new target box
  var prevFlexGrow = prevTargetBox.dom.style.flexGrow;
  prevTargetBox.dom.style.flexGrow = 0;

  var targetRect = this.targetBox.dom.getBoundingClientRect();

  prevTargetBox.dom.style.flexGrow = prevFlexGrow;

  return Promise.all([
    resizeLayoutBoxSmoothly(prevTargetBox, prevRect, 'collapse'),
    resizeLayoutBoxSmoothly(this.targetBox, 'collapse', targetRect),
  ])
  .bind(this).then(function() {
    prevTargetBox.dispose();
    if (this.targetBox) {
      resizeLayoutBox(this.targetBox, 'reset');
      this.dropOverlay.attach(this.targetBox.dom);
    }

    transitionPromiseResolve();
    this.layout.trigger('layoutResized');
  });
};
