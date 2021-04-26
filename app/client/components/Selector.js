/**
 * Selector takes care of attaching callbacks to the relevant mouse events on the given view.
 * Selection and dragging/dropping consists of 3 phases: mouse down -> mouse move -> mouse up
 * The Selector class is purposefully lightweight because different views might have
 * different select/drag/drop behavior. Most of the work is done in the callbacks
 * provided to the Selector class.
 *
 * Usage:
      Selectors are instantiated with a view.
      @param{view}: The view containing the selectable/draggable elements
 *    Views must also supply the Selector class with mousedown/mousemove/mouseup callbacks and
 *    the associated element's that listen for the mouse events.
 *    through registerMouseHandlers.
 */

/* globals document */

var ko = require('knockout');
var _ = require('underscore');
var dispose = require('../lib/dispose');
var gutil = require('app/common/gutil');

var ROW = 'row';
var COL = 'col';
var CELL = 'cell';
var NONE = '';
var SELECT = 'select';
var DRAG = 'drag';

exports.ROW = ROW;
exports.COL = COL;
exports.CELL = CELL;
exports.NONE = NONE;

/**
 * @param {Object} view
 * @param {Object} opt
 * @param {function} opt.isDisabled - Is this selector disabled? Allows caller to specify
 *  conditions for temporarily disabling capturing of mouse events.
 */
function Selector(view, opt) {
  this.view = view;
  // TODO: There should be a better way to ensure that select/drag doesnt happen when clicking
  // on these things. Also, these classes should not be in the generic Selector class.
  // TODO: get rid of the Selector class entirely and make this a Cell/GridSelector class specifically
  // for GridView(and its derived views).
  this.exemptClasses = [
    'glyphicon-pencil',
    'ui-resizable-handle',
    'dropdown-toggle',
  ];

  opt = opt || {};

  this.isDisabled = opt.isDisabled || _.constant(false);
}

/**
 * Register mouse callbacks to various sources.
 * @param {Object} callbacks -  an object containing mousedown/mouseup/mouseup functions
 * for selecting and dragging, along with with the source string name and target element
 * string name to which the mouse events must listen on.
 * @param {string} handlerName - string name of the kind of element that the mouse callbacks
 *                               are acting on.
 * handlerName is used to deduce what kind of element is triggering the mouse callbacks
 * The alternative is to look at triggering DOM element's css classes which is more hacky.
 */
Selector.prototype.registerMouseHandlers = function(callbacks, handlerName) {
  this.setCallbackDefaults(callbacks);
  var self = this;

  this.view.onEvent(callbacks.mousedown.source, 'mousedown', callbacks.mousedown.elemName,
                    function(elem, event) {
    if (self.isExemptMouseTarget(event) || event.button !== 0 || self.isDisabled()) {
      return true; // Do nothing if the mouse event if exempt or not a left click
    }

    if (!self.isSelected(elem, handlerName) && !callbacks.disableSelect()) {
      self.applyCallbacks(SELECT, callbacks, elem, event);
    } else if (!callbacks.disableDrag()) {
      self.applyCallbacks(DRAG, callbacks, elem, event);
    }
  });

};

Selector.prototype.isExemptMouseTarget = function(event) {
  var cl = event.target.classList;
  return _.some(this.exemptClasses, cl.contains.bind(cl));
};

Selector.prototype.setCallbackDefaults = function(callbacks) {
  _.defaults(callbacks, {'mousedown': {}, 'mousemove': {}, 'mouseup': {},
                         'disableDrag': _.constant(false), 'disableSelect': _.constant(false)}
  );
  _.defaults(callbacks.mousedown, {'select': _.noop, 'drag': _.noop, 'elemName': null,
                                   'source': null});
  _.defaults(callbacks.mousemove, {'select': _.noop, 'drag': _.noop, 'elemName': null,
                                   'source': document});
  _.defaults(callbacks.mouseup, {'select': _.noop, 'drag': _.noop, 'elemName': null,
                                 'source': document});
};

/**
 * Applies the drag or select callback for mousedown and then registers
 * the appropriate mousemove and mouseup callbacks. We only register mousemove/mouseup
 * after seeing a mousedown event so that we don't have to constantly listen for
 * mousemove/mouseup.
 * @param {String} dragOrSelect - string that is either 'drag' or 'select' which denotes
 * which mouse methods to apply on mouse events.
 * @param {Object} callbacks -  an object containing mousedown/mouseup/mouseup functions
 * for selecting and dragging, along with with the source string name and target element
 * string name to which the mouse events must listen on.
 */
Selector.prototype.applyCallbacks = function(dragOrSelect, callbacks, mouseDownElem, mouseDownEvent) {
  console.assert(dragOrSelect === DRAG || dragOrSelect === SELECT);
  var self = this;

  callbacks.mousedown[dragOrSelect].call(this.view, mouseDownElem, mouseDownEvent);
  this.view.onEvent(callbacks.mousemove.source, 'mousemove', function(elem, event) {
    callbacks.mousemove[dragOrSelect].call(self.view, elem, event);
  });

  this.view.onEvent(callbacks.mouseup.source, 'mouseup', function(elem, event) {
    callbacks.mouseup[dragOrSelect].call(self.view, elem, event);
    self.view.clearEvent(callbacks.mousemove.source, 'mousemove');
    self.view.clearEvent(callbacks.mouseup.source, 'mouseup');
    if (dragOrSelect === DRAG) self.currentDragType(NONE);
  });
};

// ===========================================================================
// CELL SELECTOR

function CellSelector(view, opt) {
  Selector.call(this, view, opt);

  // row or col.start denotes the anchor/initial index of the select range.
  // start is not necessarily smaller than end.
  // IE: clicking on col 10 and dragging until the mouse is on col 5 will yield: start = 10, end = 5
  this.row = {
    start: ko.observable(0),
    end: ko.observable(0),
    linePos: ko.observable('0px'),
    dropIndex: ko.observable(-1),
  };
  this.col =  {
    start: ko.observable(0),
    end: ko.observable(0),
    linePos: ko.observable('0px'),
    dropIndex: ko.observable(-1),
  };
  this.currentSelectType = ko.observable(NONE);
  this.currentDragType = ko.observable(NONE);

  this.autoDispose(this.view.cursor.rowIndex.subscribeInit(function(rowIndex) {
    this.setToCursor();
  }, this));
  this.autoDispose(this.view.cursor.fieldIndex.subscribeInit(function(colIndex) {
    this.setToCursor();
  }, this));
}

dispose.makeDisposable(CellSelector);
_.extend(CellSelector.prototype, Selector.prototype);

CellSelector.prototype.setToCursor = function(elemType) {
  // Must check that the view contains cursor.rowIndex/cursor.fieldIndex
  // in case it has changed.
  if (this.view.cursor.rowIndex) {
    this.row.start(this.view.cursor.rowIndex());
    this.row.end(this.view.cursor.rowIndex());
  }
  if (this.view.cursor.fieldIndex) {
    this.col.start(this.view.cursor.fieldIndex());
    this.col.end(this.view.cursor.fieldIndex());
  }
  this.currentSelectType(elemType || NONE);
};

CellSelector.prototype.containsCell = function(rowIndex, colIndex) {
  return this.containsCol(colIndex) && this.containsRow(rowIndex);
};

CellSelector.prototype.containsRow = function(rowIndex) {
  return gutil.between(rowIndex, this.row.start(), this.row.end());
};

CellSelector.prototype.containsCol = function(colIndex) {
  return gutil.between(colIndex, this.col.start(), this.col.end());
};

CellSelector.prototype.isSelected = function(elem, handlerName) {
  if (handlerName !== this.currentSelectType()) return false;

  // TODO: this only works with view: GridView.
  // But it seems like we only ever use selectors with gridview anyway
  let row = this.view.domToRowModel(elem, handlerName);
  let col = this.view.domToColModel(elem, handlerName);
  switch (handlerName) {
    case ROW:
      return this.containsRow(row._index());
    case COL:
      return this.containsCol(col._index());
    case CELL:
      return this.containsCell(row._index(), col._index());
    default:
      console.error('Given element is not a row, cell or column');
      return false;
  }
};

CellSelector.prototype.isRowSelected = function(rowIndex) {
  return this.isCurrentSelectType(COL) || this.containsRow(rowIndex);
};

CellSelector.prototype.isColSelected = function(colIndex) {
  return this.isCurrentSelectType(ROW) || this.containsCol(colIndex);
};

CellSelector.prototype.isCellSelected = function(rowIndex, colIndex) {
  return this.isColSelected(colIndex) && this.isRowSelected(rowIndex);
};

CellSelector.prototype.onlyCellSelected = function(rowIndex, colIndex) {
  return (this.row.start() === rowIndex && this.row.end() === rowIndex) &&
         (this.col.start() === colIndex && this.col.end() === colIndex);
};

CellSelector.prototype.isCurrentSelectType = function(elemType) {
  return this._isCurrentType(this.currentSelectType(), elemType);
};

CellSelector.prototype.isCurrentDragType = function(elemType) {
  return this._isCurrentType(this.currentDragType(), elemType);
};

CellSelector.prototype._isCurrentType = function(currentType, elemType) {
  console.assert([ROW, COL, CELL, NONE].indexOf(elemType) !== -1);
  return currentType === elemType;
};

CellSelector.prototype.colLower = function() {
  return Math.min(this.col.start(), this.col.end());
};

CellSelector.prototype.colUpper = function() {
  return Math.max(this.col.start(), this.col.end());
};

CellSelector.prototype.rowLower = function() {
  return Math.min(this.row.start(), this.row.end());
};

CellSelector.prototype.rowUpper = function() {
  return Math.max(this.row.start(), this.row.end());
};

CellSelector.prototype.colCount = function() {
  return this.colUpper() - this.colLower() + 1;
};

CellSelector.prototype.rowCount = function() {
  return this.rowUpper() - this.rowLower() + 1;
};

CellSelector.prototype.selectArea = function(rowStartIdx, colStartIdx, rowEndIdx, colEndIdx) {
  this.row.start(rowStartIdx);
  this.col.start(colStartIdx);
  this.row.end(rowEndIdx);
  this.col.end(colEndIdx);
  // Only select the area if it's not a single cell
  if (this.colCount() > 1 || this.rowCount() > 1) {
    this.currentSelectType(CELL);
  }
};

exports.CellSelector = CellSelector;
