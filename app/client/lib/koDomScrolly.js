/**
 * Scrolly is a class that allows scrolling a very long list of rows by rendering only those
 * that are visible. Note that the elements rendered by scrolly should have box-sizing set to
 * border-box.
 */



var _ = require('underscore');
var ko = require('knockout');
var assert = require('assert');
var gutil = require('app/common/gutil');
var BinaryIndexedTree = require('app/common/BinaryIndexedTree');
var {Delay} = require('./Delay');
var dispose = require('./dispose');
var kd = require('./koDom');
var dom = require('./dom');

/**
 * Use the browser globals in a way that allows replacing them with mocks in tests.
 */
var G = require('./browserGlobals').get('window', '$');

/**
 * Scrolly may contain multiple panes scrolling in parallel (e.g. for row numbers). The UI for
 * each pane consists of two nested pieces: a scrollDiv and a blockDiv. The scrollDiv is very tall
 * and mostly empty; the blockDiv contains the actual rendered rows, and is absolutely positioned
 * inside its scrollDiv.
 */
function ScrollyPane(scrolly, paneIndex, container, options, itemCreateFunc) {
  this.scrolly = scrolly;
  this.paneIndex = paneIndex;
  this.container = container;
  this.itemCreateFunc = itemCreateFunc;
  this.preparedRows = [];

  _.extend(this.scrolly.options, options);

  this.container.appendChild(
    this.scrollDiv = dom(
      'div.scrolly_outer',
      kd.style('height', this.scrolly.totalHeightPx),
      this.blockDiv = dom(
        'div',
        kd.style('position', 'absolute'),
        kd.style('top', this.scrolly.blockTopPx),
        kd.style('width', options.fitToWidth ? '100%' : ''),
        kd.style('padding-right', options.paddingRight + 'px')
      )
    )
  );

  ko.utils.domNodeDisposal.addDisposeCallback(container, () => {
    this.scrolly.destroyPane(this);
    // Delete all members, to break cycles.
    for (var k in this) {
      delete this[k];
    }
  });

  G.$(this.container).on('scroll', () => this.scrolly.onScroll(this) );
}

/**
 * Prepares the DOM for rows in scrolly's [begin, end) range, reusing currently active rows as
 * much as possible. New rows are saved in this.preparedRows, and also added to the end of
 * blockDiv so that they may be measured.
 */
ScrollyPane.prototype.prepareNewRows = function() {
  var i, item, row,
    begin = this.scrolly.begin,
    count = this.scrolly.end - begin,
    array = this.scrolly.data.peek(),
    prevItemModels = this.scrolly.activeItemModels,
    prevRows = this.preparedRows;

  if (prevRows.length > 0) {
    // Skip this check if there are no rows, maybe we just added this pane.
    assert.equal(prevRows.length, prevItemModels.length,
             "Rows and models not in sync: " + prevRows.length + "!=" + prevItemModels.length);
  }

  this.preparedRows = [];

  // Reuse any reusable old rows. They must be tied to an active model.
  for (i = 0; i < prevRows.length; i++) {
    row = prevRows[i];
    item = prevItemModels[i];
    if (item._index() === null) {
      ko.removeNode(row);
    } else {
      var relIndex = item._index() - begin;
      assert(relIndex >= 0 && relIndex < count, "prepareNewRows saw out-of-range model");
      this.preparedRows[relIndex] = row;
    }
  }

  // Create any missing rows.
  for (i = 0; i < count; i++) {
    if (!this.preparedRows[i]) {
      item = array[begin + i];
      assert(item, "ScrollyPane item missing at index " + (begin + i));
      item._rowHeightPx("");    // Mark this row as in need of measuring.
      row = this.itemCreateFunc(item);
      kd.style('height', item._rowHeightPx)(row);
      ko.utils.domData.set(row, "itemModel", item);
      this.preparedRows[i] = row;
      // The row may not end up at the end of blockDiv, but we need to add it to the document in
      // order to measure it. We'll move it to the right place in arrangePreparedRows().
      this.blockDiv.appendChild(row);
    }
  }
};

/**
 * Returns the measured height of the given prepared row.
 */
ScrollyPane.prototype.measurePreparedRow = function(rowIndex) {
  var row = this.preparedRows[rowIndex];
  var rect = row.getBoundingClientRect();
  return rect.bottom - rect.top;
};

/**
 * Update the DOM with the prepared rows in the correct order.
 */
ScrollyPane.prototype.arrangePreparedRows = function() {
  // Note that everything that was in blockDiv previously is now either gone or is in
  // preparedRows. So placing all preparedRows into blockDiv automatically removes them from their
  // old positions.
  //
  // For a slight speedup in rendering, we try to avoid removing and reinserting rows
  // unnecessarily, as that slows down subsequent rendering. We could try harder, by finding the
  // longest common subsequence, but that's quite a bit harder.
  for (var i = 0; i < this.preparedRows.length; i++) {
    var row = this.preparedRows[i];
    var current = this.blockDiv.childNodes[i];
    if (row !== current) {
      this.blockDiv.insertBefore(row, current);
    }
  }
};

//----------------------------------------------------------------------

/**
 * The Scrolly class is used internally to manage the state of the scrolly. It keeps track of the
 * data items being rendered, of the heights of all rows (including cumulative heights, in a
 * BinaryIndexedTree), and various other counts and positions.
 *
 * The actual DOM elements are managed by ScrollyPane class. There may be more than one instance,
 * if there are multiple panes scrolling together (e.g. for row numbers).
 */
function Scrolly(dataModel) {
  // In the constructor we only initialize the parts shared by all ScrollyPanes.
  this.data = dataModel;
  this.numRows = 0;
  this.options = {
    paddingBottom: 0
  };

  this.panes = [];

  // The items currently rendered. Same as this.data._itemModels, but we manage it manually
  // to maintain the invariant that rendered DOM elements match this.activeItemModels.
  this.activeItemModels = [];

  // Data structure to store row heights and cumulative offsets of all rows.
  this.rowHeights = [];
  this.rowOffsetTree = new BinaryIndexedTree();
  // TODO: Reconsider row height for rendering layouts / other tall elements in a scrolly.
  this.minRowHeight = 23;   // In pixels. Rows will be forced to be at least this tall.

  this.numBuffered = 1;     // How many rows to render outside the visible area.
  this.numRendered = 1;     // Total rows to render.

  this.begin = 0;       // Index of the first rendered row
  this.end = 0;         // Index of the row after the last rendered one

  this.scrollTop = 0;   // The scrollTop position of all panes.
  this.shownHeight = 0; // The clientHeight of all panes.
  this.blockBottom = 0; // Bottom of the rendered block, i.e. rowOffsetTree.getSumTo(this.end)

  // Top in px of the rendered block; rowOffsetTree.getSumTo(this.begin)
  this.blockTop = ko.observable(0);
  this.blockTopPx = ko.computed(function() { return this.blockTop() + 'px'; }, this);

  // The height of the scrolly_outer div
  this.totalHeight = ko.observable(0);
  this.totalHeightPx = ko.computed(function() { return this.totalHeight() + 'px'; }, this);

  // Subscribe to data changes, and initialize with the current data.
  this.subscription = this.autoDispose(
    this.data.subscribe(this.onDataSplice, this, 'spliceChange'));

  // The delayedUpdateSize helper is used by scheduleUpdateSize.
  this.delayedUpdateSize = this.autoDispose(Delay.create());

  // Initialize with the current data.
  var array = this.data.all();
  this.onDataSplice({ array: array, start: 0, added: array.length, deleted: [] });

  //T198: Scrolly should have its own handler to remove, so that when removing handlers it does not
  //remove other's handler.
  let onResize = () => {
    this.scheduleUpdateSize();
  };

  G.$(G.window).on('resize.scrolly', onResize);

  this.autoDisposeCallback(() => G.$(G.window).off('resize.scrolly', onResize));

}
exports.Scrolly = Scrolly;

dispose.makeDisposable(Scrolly);


Scrolly.prototype.debug = function() {
  console.log("Scrolly: numRows " + this.numRows + "; panes " + this.panes.length +
              "; numRendered " + this.numRendered + " [" + this.begin + ", " + this.end + ")" +
              "; block at " + this.blockTop() + " of " + this.totalHeight() +
              "; scrolled to " + this.scrollTop + "; shownHeight " + this.shownHeight);
  console.assert(this.numRows, this.data.peekLength,
               "Wrong numRows; data is " + this.data.peekLength);
  console.assert(this.numRows, this.rowHeights.length,
               "Wrong rowHeights size " + this.rowHeights.length);
  console.assert(this.numRows, this.rowOffsetTree.size(),
               "Wrong rowOffsetTree size " + this.rowOffsetTree.size());
  var count = Math.min(this.numRendered, this.numRows);
  console.assert(this.end - this.begin, count,
               "Wrong range size " + (this.end - this.begin));
  console.assert(this.activeItemModels.length, count,
               "Wrong activeItemModels.size " + this.activeItemModels.length);

  var expectedHeight = this.blockBottom - this.blockTop();
  if (count > 0) {
    for (var p = 0; p < this.panes.length; p++) {
      var topRow = this.panes[p].preparedRows[0].getBoundingClientRect();
      var bottomRow = _.last(this.panes[p].preparedRows).getBoundingClientRect();
      var blockHeight = bottomRow.bottom - topRow.top;
      if (blockHeight !== expectedHeight) {
        console.warn("Scrolly render pane #%d %dpx bigger from expected (%dpx per row). Ensure items have no margins",
          p, blockHeight - expectedHeight, (blockHeight - expectedHeight) / count);
      }
    }
  }
};

/**
 * Helper that returns the Scrolly object currently associate with the given LazyArrayModel. It
 * feels a bit wrong that the model knows about its user, but a LazyArrayModel generally only
 * supports a single user (e.g. a single Scrolly), so it makes sense.
 */
function getInstance(dataModel) {
  if (!dataModel._scrollyObj) {
    dataModel._scrollyObj = Scrolly.create(dataModel);
    dataModel._scrollyObj.autoDisposeCallback(() => delete dataModel._scrollyObj);
  }
  return dataModel._scrollyObj;
}
exports.getInstance = getInstance;

/**
 * Adds a new pane that scrolls as part of this Scrolly object. This call itself does no
 * rendering of the pane.
 */
Scrolly.prototype.addPane = function(containerElem, options, itemCreateFunc) {
  var pane = new ScrollyPane(this, this.panes.length, containerElem, options, itemCreateFunc);
  this.panes.push(pane);
  this.scheduleUpdateSize();
};

/**
 * Tells Scrolly to call updateSize after things have had a chance to render.
 */
Scrolly.prototype.scheduleUpdateSize = function(overrideHeight) {
  if (!this.isDisposed() && !this.delayedUpdateSize.isPending()) {
    this.delayedUpdateSize.schedule(0, this.updateSize.bind(this, overrideHeight), this);
  }
};

/**
 * Measures the size of the panes and adjusts Scrolly parameters for how many rows to render.
 * This should be called as soon as all Scrolly panes have been attached to the Document, and any
 * time their outer size changes.
 * Pass in an overrideHeight to use instead of the current height of the panes.
 */
Scrolly.prototype.updateSize = function(overrideHeight) {
  this.resetHeights();
  this.shownHeight = Math.max(0, Math.max.apply(null, this.panes.map(function(pane) {
    return pane.container.clientHeight;
  })));

  // Update counts of rows that are shown.
  var numVisible = Math.max(1, Math.ceil((overrideHeight ?? this.shownHeight) / this.minRowHeight));
  this.numBuffered = 5;
  this.numRendered = numVisible + 2 * this.numBuffered;

  // Re-render everything.
  this._updateRange();
  this.render();
  this.syncScrollPosition();
};

/**
 * Called whenever any pane got scrolled. It syncs up all panes to the same scrollTop.
 */
Scrolly.prototype.onScroll = function(pane) {
  this.scrollTo(pane.container.scrollTop);
};

/**
 * Actively scroll all panes to the given scrollTop position, adjusting what is rendered as
 * necessary.
 */
Scrolly.prototype.scrollTo = function(top) {
  if (top === this.scrollTop) {
    return;
  }

  this.scrollTop = top;
  this.syncScrollPosition();

  if (this.blockTop() <= top && this.blockBottom >= top + this.shownHeight) {
    // Nothing needs to be re-rendered.
    //console.log("scrollTo(%s): all elements already shown", top);
    return;
  }

  // If we are scrolled to the bottom, restore our bottom position at the end. This happens
  // in particular when reloading a page scrolled to the bottom. This is in no way general; it's
  // just particularly easy to come across.
  var atEnd = (top + this.shownHeight >= this.panes[0].container.scrollHeight);

  this._updateRange();
  // Do the magic.
  this.render();

  // If we were scrolled to the bottom, stay that way.
  if (atEnd) {
    this.scrollTop = this.panes[0].container.scrollHeight - this.shownHeight;
  }

  // Sometimes render() affects scrollTop of some panes; restore it to what we want by always
  // calling syncScrollPosition() once more after render.
  this.syncScrollPosition();
};

/**
 * Called when the underlying data array changes.
 */
Scrolly.prototype.onDataSplice = function(splice) {
  // We may need to adjust which rows are shown, but render does all the work of figuring out what
  // changed and needs re-rendering.
  this.numRows = this.data.peekLength;

  // Update rowHeights: reproduce the splice, inserting minRowHeights for the new rows.
  this.rowHeights.splice(splice.start, splice.deleted.length);
  gutil.arraySplice(this.rowHeights, splice.start,
    gutil.arrayRepeat(splice.added, this.minRowHeight));

  // And rebuild the rowOffsetTree.
  this.rowOffsetTree.fillFromValues(this.rowHeights);
  this.totalHeight(this.rowOffsetTree.getTotal() + this.options.paddingBottom);

  this._updateRange();

  this.scheduleUpdateSize();
};

/**
 * Set all panes to the common scroll position.
 */
Scrolly.prototype.syncScrollPosition = function() {
  // Note that setting scrollTop triggers more scroll events, but those get ignored in onScroll
  // because top === this.scrollTop.
  var top = this.scrollTop;
  for (var p = 0; p < this.panes.length; p++) {
    // Reading .scrollTop may cause a synchronous reflow, so may be worse than setting it.
    this.panes[p].container.scrollTop = top;
  }
};

/**
 * Creates a new item model. There is one for each rendered row. This uses the lazyArray to create
 * the model, but adds a _rowHeightPx observable, used for controlling the row height.
 */
Scrolly.prototype.createItemModel = function() {
  var item = this.data.makeItemModel();
  item._rowHeightPx = ko.observable("");
  return item;
};

/**
 * Render rows in [begin, end) range, reusing any currently rendered rows as much as possible.
 */
Scrolly.prototype.render = function() {
  //var startTime = Date.now();
  // console.log("Scrolly render (top " + this.scrollTop + "): [" + this.begin + ", " +
  //            this.end + ") = " + (this.end - this.begin) + " rows");

  // Invariant: all panes contain DOM elements parallel to this.activeItemModels.
  // At the end, this.activeItemModels and DOM in panes represent the range [begin, end).
  var i, p, item, index, delta,
    count = this.end - this.begin,
    array = this.data.peek(),
    freeList = [];

  assert(this.end <= array.length, "Scrolly render() exceeds data length of " + array.length);

  // If scrolling up, we may adjust heights of rows, pushing down the row at scrollTop.
  // If that happens, we will adjust scrollTop correspondingly.
  var rowAtScrollTop = this.rowOffsetTree.getIndex(this.scrollTop);
  var sumToScrollTop = this.rowOffsetTree.getSumTo(rowAtScrollTop);

  // Place out-of-range itemModels into a free list.
  for (i = 0; i < this.activeItemModels.length; i++) {
    item = this.activeItemModels[i];
    index = item._index();
    if (index === null || index < this.begin || index >= this.end) {
      freeList.push(item);
    }
  }

  // Go through the models we need, and fill any missing ones.
  for (i = 0, index = this.begin; i < count; i++, index++) {
    if (!array[index]) {
      // Use the freeList if possible, or create a new model otherwise.
      item = freeList.shift() || this.createItemModel();
      this.data.setItemModel(item, index);
      // Unset the explicit height so that we can measure what it would naturally be.
      item._rowHeightPx("");
    }
  }

  // Unset anything else in the free list.
  for (i = 0; i < freeList.length; i++) {
    this.data.unsetItemModel(freeList[i]);
  }

  // Prepare DOM in all panes. This ensures that there is a DOM element for each active item.
  // If prepareNewRows creates new DOM, it will unset _rowHeightPx, to mark it for measuring.
  for (p = 0; p < this.panes.length; p++) {
    this.panes[p].prepareNewRows();
  }

  // Measure the rows, and use the max across panes to update the stored heights.
  // Note: this involves a reflow.
  for (i = 0, index = this.begin; i < count; i++, index++) {
    item = array[index];
    if (item._rowHeightPx.peek() === "") {
      var height = this.minRowHeight;
      for (p = 0; p < this.panes.length; p++) {
        height = Math.max(height, this.panes[p].measurePreparedRow(i));
      }
      height = Math.round(height);

      delta = height - this.rowHeights[index];
      if (delta !== 0) {
        this.rowHeights[index] = height;
        this.rowOffsetTree.addValue(index, delta);
      }
    }
  }

  // Set back the explicit heights of the rows. This is separate from the loop above to make sure
  // we don't trigger additional reflows while measuring rows.
  for (i = 0, index = this.begin; i < count; i++, index++) {
    item = array[index];
    item._rowHeightPx(this.rowHeights[index] + 'px');
  }

  // Render the new rows in the new order in each pane.
  for (p = 0; p < this.panes.length; p++) {
    this.panes[p].arrangePreparedRows();
  }

  // Save the current activeItemModels.
  this.activeItemModels = array.slice(this.begin, this.end);
  // console.log("activeItemModels now " + this.activeItemModels.length);
  // console.log("rows in panes now are " + this.panes.map(
  //             function(p) { return p.blockDiv.childNodes.length; }).join(", "));

  // Update heights and positions of the scrolling pane parts.
  this.totalHeight(this.rowOffsetTree.getTotal() + this.options.paddingBottom);
  this.blockTop(this.rowOffsetTree.getSumTo(this.begin));
  this.blockBottom = this.rowOffsetTree.getSumTo(this.end);

  // Adjust scrollTop if previously-shown top moved because of newly-rendered rows above.
  delta = this.rowOffsetTree.getSumTo(rowAtScrollTop) - sumToScrollTop;
  if (delta !== 0) {
    //console.log("Adjusting scroll position by " + delta);
    this.scrollTop += delta;
    this.syncScrollPosition();
  }

  // this.debug();

  // Report after timeout, to include the browser rendering time.
  //var midTime = Date.now();
  //setTimeout(function() {
  //  var endTime = Date.now();
  //  console.log("Scrolly render took " + (midTime - startTime) + " + " +
  //              (endTime - midTime) + " = " + (endTime - startTime) + " ms");
  //}, 0);
};


/**
 * Re-measure the given array of rows. Re-measures all rows if no array is given.
 */
Scrolly.prototype.resetHeights = function(optRowIndexList) {
  var array = this.data.peek();
  if (optRowIndexList) {
    for (var i = 0; i < optRowIndexList.length; i++) {
      var index = optRowIndexList[i];
      var item = array[index];
      if (item) {
        item._rowHeightPx("");
      }
    }
  } else {
    this.activeItemModels.forEach(function(item) {
      item._rowHeightPx("");
    });
  }
  this.render();
};

/**
 * Re-measure the given array of items.
 * @param {Array[ItemModel]} items: The affected models (as returned by this.createItemModel).
 */
Scrolly.prototype.resetItemHeights = function(items) {
  if (!this.isDisposed()) {
    items.forEach(item => item._rowHeightPx(""));
    this.render();
  }
};

/**
 * Scrolls to the position in pixels returned by calcPosition() function. The argument is a
 * function because after the initial re-render, some rows may get re-measured and require
 * an adjustment to the pixel position. So calcPosition() actually gets called twice.
 */
Scrolly.prototype.scrollToPosition = function(calcPosition) {
  var scrollTop = calcPosition();
  this.scrollTo(scrollTop);

  // Repeat in case rows got re-measured during rendering and ended up being below the fold.
  // We only may need to scroll a bit further, we should never have to re-render.
  scrollTop = calcPosition();
  if (scrollTop !== this.scrollTop) {
    this.scrollTop = scrollTop;
    this.syncScrollPosition();
  }
};

/**
 * Scrolls the given row into view.
 */
Scrolly.prototype.scrollRowIntoView = function(rowIndex) {
  this.scrollToPosition(() => {
    var top = this.rowOffsetTree.getSumTo(rowIndex);
    var bottom = top + this.rowHeights[rowIndex];
    // 43 = 23px to adjust for header, + 20px space
    return gutil.clamp(this.scrollTop, bottom - this.shownHeight + 43, top - 10);
  });
};

/**
 * Takes a scroll position object, as stored in the section model, and scrolls to the saved
 * position.
 * @param {Integer} scrollPos.rowIndex: The index of the row to be scrolled to.
 * @param {Integer} scrollPos.offset: The pixel distance of the scroll from the top of the row.
 */
Scrolly.prototype.scrollToSavedPos = function(scrollPos) {
  this.scrollToPosition(() => this.rowOffsetTree.getSumTo(scrollPos.rowIndex) + scrollPos.offset);
};


/**
 * Returns an object with the index of the first visible row in the view pane, and the
 * scroll offset from the top of that row.
 * Useful for recording the current state of the scrolly for later re-initialization.
 *
 * NOTE: There is a compelling case to scroll to the cursor after scrolling to the previous
 * scroll position in either the case where rows are added/rearranged/removed, or simply in
 * all cases. While this would likely prevent confusion in case changes push the cursor out
 * of view, the case that the user scrolled away from the cursor intentionally should also be
 * considered.
 */
Scrolly.prototype.getScrollPos = function() {
  var rowIndex = this.rowOffsetTree.getIndex(this.scrollTop);
  return {
    rowIndex: rowIndex,
    offset: this.scrollTop - this.rowOffsetTree.getSumTo(rowIndex)
  };
};

/**
 * Destroys a scrolly pane.
 */
Scrolly.prototype.destroyPane = function(pane) {
  // When the last pane is removed, destroy the scrolly.
  gutil.arrayRemove(this.panes, pane);
  if (this.panes.length === 0) {
    this.dispose();
  }
};

/**
 * Updates indexes of rows to render.
 */
Scrolly.prototype._updateRange = function() {
  // If we are scrolled from the top, start at the first visible row with some buffer.
  const begin = this.rowOffsetTree.getIndex(this.scrollTop) - this.numBuffered;
  this.begin = gutil.clamp(begin, 0, this.numRows - this.numRendered);
  this.end = gutil.clamp(this.begin + this.numRendered, 0, this.numRows);
}

//----------------------------------------------------------------------

/**
 * Creates a virtual scrolling interface attached to a LazyArray. Multiple scrolly() calls used
 * with the same `data` array will create parallel scrolling panes (e.g. row numbers and data
 * scrolling together).
 *
 * The DOM for items is created using `itemCreateFunc`. As the user scrolls
 * around, the item models are assigned to different items, and the DOM is moved around the page,
 * to minimize rendering. This is intended to be used with koModel.mappedLazyArray.
 *
 * @param {LazyModelArray} data A LazyModelArray instance.
 * @param {Object} options - Supported options include:
 *    paddingBottom {number} - Number of pixels to add to bottom of scrolly
 *    paddingRight {number} - Number of pixels to add to right of scrolly
 *    fitToWidth {bool} - Whether the scrolly holds a list of layouts
 * @param {Function} itemCreateFunc A function called as `itemCreateFunc(item)` for a number of
 *    item models (which can get assigned to different items in `data`). Must return a single
 *    Node (not a DocumentFragment or null).
 */
function scrolly(data, options, itemCreateFunc) {
  assert.equal(typeof itemCreateFunc, 'function');
  options = options || {};
  return function(elem) {
    var scrollyObj = getInstance(data);
    scrollyObj.addPane(elem, options, itemCreateFunc);
    ko.utils.domData.set(elem, "scrolly", scrollyObj);
  };
}
exports.scrolly = scrolly;
