/* globals alert, document, $ */

var _         = require('underscore');
var ko        = require('knockout');
const debounce = require('lodash/debounce');

var gutil             = require('app/common/gutil');
var BinaryIndexedTree = require('app/common/BinaryIndexedTree');
var MANUALSORT        = require('app/common/gristTypes').MANUALSORT;
const {Sort} = require('app/common/SortSpec');

var dom           = require('../lib/dom');
var kd            = require('../lib/koDom');
var kf            = require('../lib/koForm');
var koDomScrolly  = require('../lib/koDomScrolly');
var tableUtil     = require('../lib/tableUtil');
var {addToSort, sortBy}   = require('../lib/sortUtil');

var commands      = require('./commands');
var viewCommon    = require('./viewCommon');
var Base          = require('./Base');
var BaseView      = require('./BaseView');
var selector      = require('./Selector');
var {CopySelection} = require('./CopySelection');

const {renderAllRows} = require('app/client/components/Printing');
const {reportError} = require('app/client/models/AppModel');
const {onDblClickMatchElem} = require('app/client/lib/dblclick');

// Grist UI Components
const {Holder, Computed} = require('grainjs');
const {menu} = require('../ui2018/menus');
const {calcFieldsCondition} = require('../ui/GridViewMenus');
const {ColumnAddMenu, ColumnContextMenu, MultiColumnMenu, freezeAction} = require('../ui/GridViewMenus');
const {RowContextMenu} = require('../ui/RowContextMenu');

const {setPopupToCreateDom} = require('popweasel');
const {testId} = require('app/client/ui2018/cssVars');
const {menuToggle} = require('app/client/ui/MenuToggle');
const {showTooltip} = require('app/client/ui/tooltips');


// A threshold for interpreting a motionless click as a click rather than a drag.
// Anything longer than this time (in milliseconds) should be interpreted as a drag
// even if there is no movement.
// This is relevant for distinguishing clicking an already-selected column in order
// to rename it, and starting to drag that column and then deciding to leave it where
// it was.
const SHORT_CLICK_IN_MS = 500;

// size of the plus width ()
const PLUS_WIDTH = 40;
// size of the row number field (we assume 4rem)
const ROW_NUMBER_WIDTH = 52;

/**
 * GridView component implements the view of a grid of cells.
 */
function GridView(gristDoc, viewSectionModel, isPreview = false) {
  BaseView.call(this, gristDoc, viewSectionModel, { isPreview, 'addNewRow': true });

  this.viewSection = viewSectionModel;

  //--------------------------------------------------
  // Observables local to this view

  // Some observables/variables used for select and drag/drop
  this.dragX = ko.observable(0); // x coord of mouse during drag mouse down
  this.dragY = ko.observable(0); // ^ for y coord
  this.rowShadowAdjust = 0; // pixel dist from mouse click y-coord and the clicked row's top offset
  this.colShadowAdjust = 0; // ^ for x-coord and clicked col's left offset
  this.scrollLeft = ko.observable(0);
  this.isScrolledLeft = this.autoDispose(ko.computed(() => this.scrollLeft() > 0));
  this.scrollTop = ko.observable(0);
  this.isScrolledTop = this.autoDispose(ko.computed(() => this.scrollTop() > 0));

  this.cellSelector = this.autoDispose(selector.CellSelector.create(this, {
    // This is a bit of a hack to prevent dragging when there's an open column menu
    isDisabled: () => Boolean(!this.ctxMenuHolder.isEmpty())
  }));
  this.colMenuTargets = {}; // Reference from column ref to its menu target dom

  // Cache of column right offsets, used to determine the col select range
  this.colRightOffsets = this.autoDispose(ko.computed(() => {
    let fields = this.viewSection.viewFields();
    let tree = new BinaryIndexedTree();
    tree.fillFromValues(fields.all().map(field => field.widthDef()));
    return tree;
  }));

  // Create observable holding current rowIndex that the view should be scrolled to.
  // We will always notify, because we want to scroll to the row even when only the
  // column is changed (in situation when the row is not visible).
  this.visibleRowIndex = ko.observable(this.cursor.rowIndex()).extend({notify: 'always'});
  // Create grain's Computed with current cursor position (we need it to examine position
  // before the change and after).
  this.currentPosition = Computed.create(this, (use) => ({
    rowIndex : use(this.cursor.rowIndex),
    fieldIndex : use(this.cursor.fieldIndex)
  }));
  // Add listener, and check if the cursor is indeed changed, if so, update the row
  // and scroll it into view (using kd.scrollChildIntoView in buildDom function).
  this.autoDispose(this.currentPosition.addListener((cur, prev) => {
    if (cur.rowIndex !== prev.rowIndex || cur.fieldIndex !== prev.fieldIndex) {
      this.visibleRowIndex(cur.rowIndex);
    }
  }));

  this.autoDispose(this.cursor.fieldIndex.subscribe(idx => {
    const offset = this.colRightOffsets.peek().getSumTo(idx);

    const rowNumsWidth = this._cornerDom.clientWidth;
    const viewWidth = this.scrollPane.clientWidth - rowNumsWidth;
    const fieldWidth = this.colRightOffsets.peek().getValue(idx) + 1; // +1px border

    // Left and right pixel edge of 'viewport', starting from edge of row nums
    const leftEdge = this.scrollPane.scrollLeft;
    const rightEdge = leftEdge + viewWidth;

    //If cell doesn't fit onscreen, scroll to fit
    const scrollShift = offset - gutil.clamp(offset, leftEdge, rightEdge - fieldWidth);
    this.scrollPane.scrollLeft = this.scrollPane.scrollLeft + scrollShift;
  }));

  this.isPreview = isPreview;

  // Some observables for the scroll markers that show that the view is cut off on a side.
  this.scrollShadow = {
    left: this.isScrolledLeft,
    top: this.isScrolledTop
  };

  //--------------------------------------------------
  // Set up row and column context menus.
  this.ctxMenuHolder = Holder.create(this);

  //--------------------------------------------------
  // Set frozen columns variables

  // keep track of the width for this component
  this.width = ko.observable(0);
  // helper for clarity
  this.numFrozen = this.viewSection.numFrozen;
  // calculate total width of all frozen columns
  this.frozenWidth = this.autoDispose(ko.pureComputed(() => this.colRightOffsets().getSumTo(this.numFrozen())));
  // show frozenLine when have some frozen columns and not scrolled left
  this.frozenLine = this.autoDispose(ko.pureComputed(() => this.numFrozen() && !this.isScrolledLeft()));
  // even if some columns are frozen, we still want to move them left
  // when screen is too narrow - here we will calculate how much space
  // is needed to move all the frozen columns left in order to show some
  // unfrozen columns to user (by default we will try to show at least one not
  // frozen column and a plus button)
  this.frozenOffset = this.autoDispose(ko.computed(() => {
    // get the last field
    const fields = this.viewSection.viewFields().all();
    const lastField = fields[fields.length-1];
    // get the last field width (or zero - grid can have zero columns)
    const revealWidth = lastField ? lastField.widthDef() : 0;
    // calculate the offset: start from zero, then move all left to hide frozen columns,
    // then to right to fill whole width, then to left to reveal last column and plus button
    const initialOffset = -this.frozenWidth() - ROW_NUMBER_WIDTH + this.width() - revealWidth - PLUS_WIDTH;
    // Final check - we actually don't want to have
    // the split (between frozen and normal columns) be moved left too far,
    // it should stop at the middle of the available grid space (whole width - row number width).
    // This can happen when last column is too wide, and we are not able to show it in a full width.
    // To calculate the middle point: hide all frozen columns (by moving them maximum to the left)
    // and then move them to right by half width of the section.
    const middleOffset = -this.frozenWidth() - ROW_NUMBER_WIDTH + this.width() / 2;
    // final offset is the bigger number of those two (offsets are negative - so take
    // the number that is closer to 0)
    const offset = Math.floor(Math.max(initialOffset, middleOffset));
    // offset must be negative (we are moving columns left), if we ended up moving
    // frozen columns to the right, don't move them at all
    return offset > 0 ? 0 : Math.abs(offset);
  }));
  // observable for left scroll - but return left only when columns are frozen
  // this will be used to move frozen border alongside with the scrollpane
  this.frozenScrollOffset = this.autoDispose(ko.computed(() => this.numFrozen() ? this.scrollLeft() : 0));
  // observable that will indicate if shadow is needed on top of frozen columns
  this.frozenShadow = this.autoDispose(ko.computed(() => {
    return this.numFrozen() && this.frozenOffset() && this.isScrolledLeft();
  }));
  // calculate column right offsets
  this.frozenPositions = this.autoDispose(this.viewSection.viewFields().map(function(field){
    return ko.pureComputed(() => this.colRightOffsets().getSumTo(field._index()));
  }, this));
  // calculate frozen state for all columns
  this.frozenMap = this.autoDispose(this.viewSection.viewFields().map(function(field){
    return ko.pureComputed(() => field._index() < this.numFrozen());
  }, this));

  // Holds column index that is hovered, works only in full-edit formula mode.
  this.hoverColumn = ko.observable(-1);
  // Debounced method to change current hover column, this is needed
  // as mouse when moved from field to field will switch the hover-column
  // observable from current index to -1 and then immediately back to current index.
  // With debounced version, call to set -1 that is followed by call to set back to the field index
  // will be discarded.
  this.changeHover = debounce((index) => {
    if (this.isDisposed()) { return; }
    if (this.gristDoc.docModel.editingFormula()) {
      this.hoverColumn(index);
    }
  }, 0);

  //--------------------------------------------------
  // Create and attach the DOM for the view.

  this.isColSelected = this.autoDispose(this.viewSection.viewFields().map(function(field) {
    return this._createColSelectedObs(field);
  }, this));
  this.header = null;
  this._cornerDom = null;
  // dom for adding new column - used by freeze calculation
  this._modField = null;
  this.scrollPane = null;
  this.viewPane = this.autoDispose(this.buildDom());
  this.attachSelectorHandlers();
  this.scrolly = koDomScrolly.getInstance(this.viewData);

  //--------------------------------------------------
  // Set up DOM event handling.
  onDblClickMatchElem(this.scrollPane, '.field', () => this.activateEditorAtCursor());
  this.onEvent(this.scrollPane, 'scroll', this.onScroll);

  //--------------------------------------------------
  // Command group implementing all grid level commands.
  this.autoDispose(commands.createGroup(GridView.gridCommands, this, this.viewSection.hasFocus));

  // Timer to allow short, otherwise non-actionable clicks on column names to trigger renaming.
  this._colClickTime = 0;  // Units: milliseconds.
}
Base.setBaseFor(GridView);
_.extend(GridView.prototype, BaseView.prototype);



// ======================================================================================
// GRID-LEVEL COMMANDS

GridView.gridCommands = {
  cursorUp: function() {
    // This conditional exists so that when users have the cursor in the top row but are not
    // scrolled to the top i.e. in the case of a tall row, pressing up again will scroll the
    // pane to the top.
    if (this.cursor.rowIndex() === 0) {
      this.scrollPane.scrollTop = 0;
    }
    this.cursor.rowIndex(this.cursor.rowIndex() - 1);
  },
  shiftDown: function() {
    this._shiftSelect(1, this.cellSelector.row.end, selector.COL, this.getLastDataRowIndex());
  },
  shiftUp: function() {
    this._shiftSelect(-1, this.cellSelector.row.end, selector.COL, this.getLastDataRowIndex());
  },
  shiftRight: function() {
    this._shiftSelect(1, this.cellSelector.col.end, selector.ROW,
                      this.viewSection.viewFields().peekLength - 1);
  },
  shiftLeft: function() {
    this._shiftSelect(-1, this.cellSelector.col.end, selector.ROW,
                      this.viewSection.viewFields().peekLength - 1);
  },
  fillSelectionDown: function() { this.fillSelectionDown(); },
  selectAll: function() { this.selectAll(); },

  fieldEditSave: function() { this.cursor.rowIndex(this.cursor.rowIndex() + 1); },
  // Re-define editField after fieldEditSave to make it take precedence for the Enter key.
  editField: function() { this.scrollToCursor(true); this.activateEditorAtCursor(); },

  deleteRecords: function() {
    const saved = this.cursor.getCursorPos();
    this.cursor.setLive(false);

    // Don't return a promise. Nothing will use it, and the Command implementation will not
    // prevent default browser behavior if we return a truthy value.
    this.deleteRows(this.getSelection())
    .finally(() => {
      this.cursor.setCursorPos(saved);
      this.cursor.setLive(true);
    })
    .catch(reportError);
  },
  insertFieldBefore: function() { this.insertColumn(this.cursor.fieldIndex()); },
  insertFieldAfter: function() { this.insertColumn(this.cursor.fieldIndex() + 1); },
  renameField: function() { this.currentEditingColumnIndex(this.cursor.fieldIndex()); },
  hideField: function() { this.hideField(this.cursor.fieldIndex()); },
  deleteFields: function() { this.deleteColumns(this.getSelection()); },
  clearValues: function() { this.clearValues(this.getSelection()); },
  clearColumns: function() { this._clearColumns(this.getSelection()); },
  convertFormulasToData: function() { this._convertFormulasToData(this.getSelection()); },
  copy: function() { return this.copy(this.getSelection()); },
  cut: function() { return this.cut(this.getSelection()); },
  paste: async function(pasteObj, cutCallback) {
    await this.paste(pasteObj, cutCallback);
    await this.scrollToCursor(false);
  },
  cancel: function() { this.clearSelection(); },
  sortAsc: function() {
    sortBy(this.viewSection.activeSortSpec, this.currentColumn().getRowId(), Sort.ASC);
  },
  sortDesc: function() {
    sortBy(this.viewSection.activeSortSpec, this.currentColumn().getRowId(), Sort.DESC);
  },
  addSortAsc: function() {
    addToSort(this.viewSection.activeSortSpec, this.currentColumn().getRowId(), Sort.ASC);
  },
  addSortDesc: function() {
    addToSort(this.viewSection.activeSortSpec, this.currentColumn().getRowId(), Sort.DESC);
  },
  toggleFreeze: function() {
    // get column selection
    const selection = this.getSelection();
    // convert it menu option
    const options = this._getColumnMenuOptions(selection);
    // generate action that is available for freeze toggle
    const action = freezeAction(options);
    // if no action, do nothing
    if (!action) { return; }
    // if grist document is in readonly - simply change the value
    // without saving
    if (this.gristDoc.isReadonly.get()) {
      this.viewSection.rawNumFrozen(action.numFrozen);
      return;
    }
    this.viewSection.rawNumFrozen.setAndSave(action.numFrozen);
  }
};

GridView.prototype.onTableLoaded = function() {
  BaseView.prototype.onTableLoaded.call(this);
  this.onScroll();

  // Initialize scroll position.
  this.scrollPane.scrollLeft = this.viewSection.lastScrollPos.scrollLeft;
  this.scrolly.scrollToSavedPos(this.viewSection.lastScrollPos);
};

/**
 * Update the bounds of the cell selector's selected range for Shift+Direction keyboard shortcuts.
 * @param {integer} step - amount to increase/decrease the select bound
 * @param {Observable} selectObs - observable to change
 * @exemptType {Selector type string} - selector type to noop on
     IE: Shift + Up/Down should noop if columns are selected. And vice versa for rows.
 * @param {integer} maxVal - maximum value allowed for the selectObs
 **/
GridView.prototype._shiftSelect = function(step, selectObs, exemptType, maxVal) {
  console.assert(exemptType === selector.ROW || exemptType === selector.COL);
  if (this.cellSelector.isCurrentSelectType(exemptType)) return;
  if (this.cellSelector.isCurrentSelectType(selector.NONE)) {
    this.cellSelector.currentSelectType(selector.CELL);
  }
  var newVal = gutil.clamp(selectObs() + step, 0, maxVal);
  selectObs(newVal);
};

/**
 * Pastes the provided data at the current cursor.
 *
 * TODO: Handle the edge case where more columns are pasted than available.
 *
 * @param {Array} data - Array of arrays of data to be pasted. Each array represents a row.
 * i.e.  [["1-1", "1-2", "1-3"],
 *        ["2-1", "2-2", "2-3"]]
 * @param {Function} cutCallback - If provided returns the record removal action needed for
 *  a cut.
 */
GridView.prototype.paste = function(data, cutCallback) {
  // TODO: If pasting into columns by which this view is sorted, rows may jump. It is still better
  // to allow it, but we should "freeze" the affected rows to prevent them from jumping, until the
  // user re-applies the sort manually. (This is a particularly bad experience when rows get
  // dispersed by the sorting after paste.) We do attempt to keep the cursor in the same row as
  // before even if it jumped. Note when addressing it: currently selected rows should be treated
  // as frozen (and get marked as unsorted if necessary) for any update even if the update comes
  // from a different peer.

  // convert row-wise data to column-wise so that it better resembles a user action
  let pasteData = _.unzip(data);
  let pasteHeight = pasteData[0].length;
  let pasteWidth = pasteData.length;
  // figure out the size of the paste area
  let outputHeight = Math.max(gutil.roundDownToMultiple(this.cellSelector.rowCount(), pasteHeight), pasteHeight);
  let outputWidth = Math.max(gutil.roundDownToMultiple(this.cellSelector.colCount(), pasteWidth), pasteWidth);
  // get the row ids that cover the paste
  let topIndex = this.cellSelector.rowLower();
  let updateRowIndices = _.range(topIndex, topIndex + outputHeight);
  let updateRowIds = updateRowIndices.map(r => this.viewData.getRowId(r));
  // get the col ids that cover the paste
  let leftIndex = this.cellSelector.colLower();
  let updateColIndices = _.range(leftIndex, leftIndex + outputWidth);

  pasteData = gutil.growMatrix(pasteData, updateColIndices.length, updateRowIds.length);

  let fields = this.viewSection.viewFields().peek();
  let pasteFields = updateColIndices.map(i => fields[i] || null);

  let richData = this._parsePasteForView(pasteData, pasteFields);
  let actions = this._createBulkActionsFromPaste(updateRowIds, richData);

  if (actions.length > 0) {
    let cursorPos = this.cursor.getCursorPos();
    return this.sendPasteActions(cutCallback, actions)
    .then(results => {
      // If rows were added, get their rowIds from the action results.
      let addRowIds = (actions[0][0] === 'BulkAddRecord' ? results[0] : []);
      console.assert(addRowIds.length <= updateRowIds.length,
        `Unexpected number of added rows: ${addRowIds.length} of ${updateRowIds.length}`);
      let newRowIds = updateRowIds.slice(0, updateRowIds.length - addRowIds.length)
        .concat(addRowIds);

      // Restore the cursor to the right rowId, even if it jumped.
      this.cursor.setCursorPos({rowId: cursorPos.rowId === 'new' ? addRowIds[0] : cursorPos.rowId});

      // Restore the selection if it would select the correct rows.
      let topRowIndex = this.viewData.getRowIndex(newRowIds[0]);
      if (newRowIds.every((r, i) => r === this.viewData.getRowId(topRowIndex + i))) {
        this.cellSelector.selectArea(topRowIndex, leftIndex,
          topRowIndex + outputHeight - 1, leftIndex + outputWidth - 1);
      }

      this.copySelection(null);
    });
  }
};

/**
 * Given a matrix of values, and an array of colIds and rowId targets, this function returns
 * an array of user actions needed to update the targets to the values in the matrix
 * @param {Array} rowIds - An array of numbers, 'new' or null corresponding to the row ids will
 * be updated or added. Numerical (proper) rowIds must come before special ones.
 * @param {Object<string, Array<string>} bulkUpdate - Object from colId to array of column values.
 */
GridView.prototype._createBulkActionsFromPaste = function(rowIds, bulkUpdate) {
  if (_.isEmpty(bulkUpdate)) {
    return [];
  }

  let addRows = rowIds.filter(rowId => rowId === null || rowId === 'new').length;
  let updateRows = rowIds.length - addRows;

  let actions = [];
  if (addRows > 0) {
    actions.push(['BulkAddRecord', gutil.arrayRepeat(addRows, null),
      _.mapObject(bulkUpdate, values => values.slice(-addRows))
    ]);
  }
  if (updateRows > 0) {
    actions.push(['BulkUpdateRecord', rowIds.slice(0, updateRows),
      _.mapObject(bulkUpdate, values => values.slice(0, updateRows))
    ]);
  }
  return this.prepTableActions(actions);
};

/**
 * Fills currently selected grid with the contents of the top row in that selection.
 */
GridView.prototype.fillSelectionDown = function() {
  var rowLower = this.cellSelector.rowLower();
  var rowIds = _.times(this.cellSelector.rowCount(), i => this.viewData.getRowId(rowLower + i));

  if (rowIds.length <= 1) {
    return;
  }

  var colLower = this.cellSelector.colLower();
  var fields = this.viewSection.viewFields().peek();
  var colIds = _.times(this.cellSelector.colCount(), i => {
    if (!fields[colLower + i].column().isFormula()) {
      return fields[colLower + i].colId();
    }
  }).filter(colId => colId);

  var colInfo = _.object(colIds, colIds.map(colId => {
     var val = this.tableModel.tableData.getValue(rowIds[0], colId);
     return rowIds.map(() => val);
  }));

  this.tableModel.sendTableAction(["BulkUpdateRecord", rowIds, colInfo]);
};




/**
 * Returns a GridSelection of the selected rows and cols
 * @returns {Object} CopySelection
 */
GridView.prototype.getSelection = function() {
  var rowIds = [], fields = [], rowStyle = {}, colStyle = {};
  var colStart = this.cellSelector.colLower();
  var colEnd = this.cellSelector.colUpper();
  var rowStart = this.cellSelector.rowLower();
  var rowEnd = this.cellSelector.rowUpper();

  // If there is no selection, just copy/paste the cursor cell
  if (this.cellSelector.isCurrentSelectType(selector.NONE)) {
    rowStart = rowEnd = this.cursor.rowIndex();
    colStart = colEnd = this.cursor.fieldIndex();
  }

  // Get all the cols if rows are selected, and viceversa
  if (this.cellSelector.isCurrentSelectType(selector.ROW)) {
    colStart = 0;
    colEnd = this.viewSection.viewFields().peekLength - 1;
  } else if(this.cellSelector.isCurrentSelectType(selector.COL)) {
    rowStart = 0;
    rowEnd = this.getLastDataRowIndex();
  }

  var rowId;
  for(var i = colStart; i <= colEnd; i++) {
    let field = this.viewSection.viewFields().at(i);
    fields.push(field);
    colStyle[field.colId()] = this._getColStyle(i);
  }
  for(var j = rowStart; j <= rowEnd; j++) {
    rowId = this.viewData.getRowId(j);
    rowIds.push(rowId);
    rowStyle[rowId] = this._getRowStyle(j);
  }
  return new CopySelection(this.tableModel.tableData, rowIds, fields, {
    rowStyle: rowStyle,
    colStyle: colStyle
  });
};

/**
 * Deselects the currently selected cells.
 */
GridView.prototype.clearSelection = function() {
  this.copySelection(null); // Unset the selection observable
  this.cellSelector.setToCursor();
};

/**
 * Given a selection object, sets all cells referred to by the selection to the empty string. If
 * only formula columns are selected, only open the formula editor to the empty formula.
 * @param {CopySelection} selection
 */
GridView.prototype.clearValues = function(selection) {
  const options = this._getColumnMenuOptions(selection);
  if (options.isFormula === true) {
    this.activateEditorAtCursor({ init: ''});
  } else {
    let clearAction = tableUtil.makeDeleteAction(selection);
    if (clearAction) {
      this.gristDoc.docData.sendAction(clearAction);
    }
  }
};

GridView.prototype._clearColumns = function(selection) {
  const fields = selection.fields;
  return this.gristDoc.clearColumns(fields.map(f => f.colRef.peek()));
};

GridView.prototype._convertFormulasToData = function(selection) {
  // Convert all isFormula columns to data, including empty columns. This is sometimes useful
  // (e.g. since a truly empty column undergoes a conversion on first data entry, which may be
  // prevented by ACL rules).
  const fields = selection.fields.filter(f => f.column.peek().isFormula.peek());
  if (!fields.length) { return null; }
  return this.gristDoc.convertIsFormula(fields.map(f => f.colRef.peek()), {toFormula: false});
};

GridView.prototype.selectAll = function() {
  this.cellSelector.selectArea(0, 0, this.getLastDataRowIndex(),
    this.viewSection.viewFields().peekLength - 1);
};


// End of actions



// ======================================================================================
// GRIDVIEW PRIMITIVES (for manipulating grid, rows/cols, selections)


/**
 * Assigns the cursor.rowIndex and cursor.fieldIndex observable to the correct row/column/cell
 * depending on the supplied dom element.
 * @param {DOM element} elem - extract the col/row index from the element
 * @param {Selector.ROW/COL/CELL} elemType - denotes whether the clicked element was
 *                                           a row header, col header or cell
 */
GridView.prototype.assignCursor = function(elem, elemType) {
  // Change focus before running command so that the correct viewsection's cursor is moved.
  this.viewSection.hasFocus(true);

  try {
    let row = this.domToRowModel(elem, elemType);
    let col = this.domToColModel(elem, elemType);
    commands.allCommands.setCursor.run(row, col);
  } catch(e) {
    console.error(e);
    console.error("GridView.assignCursor expects a row/col header, or cell as an input.");
  }


  this.cellSelector.currentSelectType(elemType);
};

GridView.prototype.deleteRows = function(selection) {
  if (!this.viewSection.disableAddRemoveRows()) {
    var rowIds = _.without(selection.rowIds, 'new');
    if (rowIds.length > 0) {
      return this.tableModel.sendTableAction(['BulkRemoveRecord', rowIds]);
    }
  }
  return Promise.resolve();
};

GridView.prototype.addNewColumn = function() {
  this.insertColumn(this.viewSection.viewFields().peekLength)
 .then(() => this.scrollPaneRight());
};

GridView.prototype.insertColumn = function(index) {
  var pos = tableUtil.fieldInsertPositions(this.viewSection.viewFields(), index)[0];
  var action = ['AddColumn', null, {"_position": pos}];
  return this.tableModel.sendTableAction(action)
  .bind(this).then(function() {
    this.selectColumn(index);
    this.currentEditingColumnIndex(index);
    // this.columnConfigTab.show();
  });
};

GridView.prototype.scrollPaneRight = function() {
  this.scrollPane.scrollLeft = Number.MAX_SAFE_INTEGER;
};

GridView.prototype.selectColumn = function(colIndex) {
  this.cursor.fieldIndex(colIndex);
  this.cellSelector.currentSelectType(selector.COL);
};

GridView.prototype.showColumn = function(colId, index) {
  let fieldPos = tableUtil.fieldInsertPositions(this.viewSection.viewFields(), index, 1)[0];
  let colInfo = {
    parentId: this.viewSection.id(),
    colRef: colId,
    parentPos: fieldPos
  };
  return this.gristDoc.docModel.viewFields.sendTableAction(['AddRecord', null, colInfo])
  .then(() => this.selectColumn(index))
  .then(() => this.scrollPaneRight());
};

// TODO: Replace alerts with custom notifications
GridView.prototype.deleteColumns = function(selection) {
  var fields = selection.fields;
  if (fields.length === this.viewSection.viewFields().peekLength) {
    alert("You can't delete all the columns on the grid.");
    return;
  }
  let actions = fields.filter(col => !col.disableModify()).map(col => ['RemoveColumn', col.colId()]);
  if (actions.length > 0) {
    this.tableModel.sendTableActions(actions, `Removed columns ${actions.map(a => a[1]).join(', ')} ` +
      `from ${this.tableModel.tableData.tableId}.`);
  }
};

GridView.prototype.hideField = function(index) {
  var field = this.viewSection.viewFields().at(index);
  var action = ['RemoveRecord', field.id()];
  return this.gristDoc.docModel.viewFields.sendTableAction(action);
};

GridView.prototype.moveColumns = function(oldIndices, newIndex) {
  if (oldIndices.length === 0) return;
  if (oldIndices[0] === newIndex || oldIndices[0] + 1 === newIndex) return;

  var newPositions = tableUtil.fieldInsertPositions(this.viewSection.viewFields(), newIndex,
                                                    oldIndices.length);
  var vsfRowIds = oldIndices.map(function(i) {
    return this.viewSection.viewFields().at(i).id();
  }, this);
  var colInfo = { 'parentPos': newPositions };
  var vsfAction = ['BulkUpdateRecord', vsfRowIds, colInfo];
  var viewFieldsTable =  this.gristDoc.docModel.viewFields;
  var numCols = oldIndices.length;
  var self = this;
  viewFieldsTable.sendTableAction(vsfAction).then(function() {
    self._selectMovedElements(self.cellSelector.col.start, self.cellSelector.col.end,
                              newIndex, numCols, selector.COL);
  });
};

GridView.prototype.moveRows = function(oldIndices, newIndex) {
  if (oldIndices.length === 0) return;
  if (oldIndices[0] === newIndex || oldIndices[0] + 1 === newIndex) return;

  var newPositions = this._getRowInsertPos(newIndex, oldIndices.length);
  var rowIds = oldIndices.map(function(i) {
    return this.viewData.getRowId(i);
  }, this);
  var colInfo = { 'manualSort': newPositions };
  var action = ['BulkUpdateRecord', rowIds, colInfo];
  var numRows = oldIndices.length;
  var self = this;
  this.tableModel.sendTableAction(action).then(function() {
    self._selectMovedElements(self.cellSelector.row.start, self.cellSelector.row.end,
                              newIndex, numRows, selector.ROW);
  });
};

/**
 * Return a list of manual sort positions so that inserting {numInsert} rows
 * with the returned positions will place them in between index-1 and index.
 * when the GridView is sorted by MANUALSORT
 **/
GridView.prototype._getRowInsertPos = function(index, numInserts) {
  var lowerRowId = this.viewData.getRowId(index-1);
  var upperRowId = this.viewData.getRowId(index);
  if (lowerRowId === 'new') {
    // set the lowerRowId to the rowId of the row before 'new'.
    lowerRowId = this.viewData.getRowId(index - 2);
  }

  var lowerPos = this.tableModel.tableData.getValue(lowerRowId, MANUALSORT);
  var upperPos = this.tableModel.tableData.getValue(upperRowId, MANUALSORT);
  // tableUtil.insertPositions takes care of cases where upper/lowerPos are non-zero & falsy
  return tableUtil.insertPositions(lowerPos, upperPos, numInserts);
};


// ======================================================================================
// MISC HELPERS


/**
 *  Returns the row index of the row whose top offset is closest to and
 *  no greater than given y-position.
 *  param{yCoord}: The mouse y-position (including any scroll top amount).
 *  Assumes that scrolly.rowOffsetTree is up to date.
 *  See the given examples in GridView.getMousePosCol.
 **/
GridView.prototype.getMousePosRow = function (yCoord) {
  var headerOffset = this.header.getBoundingClientRect().bottom;
  return this.scrolly.rowOffsetTree.getIndex(yCoord - headerOffset);
};

/**
 *  Returns the row index of the row whose top offset is closest to and
 *  no greater than given y-position excluding addRows.
 *  param{yCoord}: The mouse y-position on the screen.
 **/
GridView.prototype.currentMouseRow = function(yCoord) {
  return Math.min(this.getMousePosRow(this.scrollTop() + yCoord), this.getLastDataRowIndex());
};

/**
 *  Returns the column index of the column whose left position is closest to and
 *  no greater than given x-position.
 *  param{xCoord}: The mouse x-position (including any scroll left amount).
 *  Assumes that this.colRightOffsets is up to date
 *  In the following examples, let * denote the current mouse position.
 *      * |0____|1____|2____|3____|       Returns 0
 *        |0__*_|1____|2____|3____|       Returns 0
 *        |0____|1__*_|2____|3____|       Returns 1
 *        |0____|1____|2__*_|3____|       Returns 2
 *        |0____|1____|2____|3__*_|       Returns 3
 *        |0____|1____|2____|3____| *     Returns 4
 **/
GridView.prototype.getMousePosCol = function (xCoord) {
  //offset to left edge of gridView viewports
  var headerOffset = this._cornerDom.getBoundingClientRect().right;
  return this.colRightOffsets.peek().getIndex(xCoord - headerOffset);
};

// Used for styling the paste data the same way the col/row is styled in the GridView.
GridView.prototype._getRowStyle = function(rowIndex) {
  return { 'height': this.scrolly.rowOffsetTree.getValue(rowIndex) + 'px' };
};

GridView.prototype._getColStyle = function(colIndex) {
  return { 'width' : this.viewSection.viewFields().at(colIndex).widthPx() };
};


// TODO: for now lets just assume you are clicking on a .field, .row, or .column
GridView.prototype.domToRowModel = function(elem, elemType) {
  switch (elemType) {
    case selector.COL:
      return 0;
    case selector.ROW: // row > row num: row has record model
      return ko.utils.domData.get(elem.parentNode, 'itemModel');
    case selector.NONE:
    case selector.CELL: // cell: row > .record > .field, row holds row model
      return ko.utils.domData.get(elem.parentNode.parentNode, 'itemModel');
    default:
      throw Error("Unknown elemType in domToRowModel:" + elemType);
  }
};

GridView.prototype.domToColModel = function(elem, elemType) {
  switch (elemType) {
    case selector.ROW:
      return 0;
    case selector.NONE:
    case selector.CELL: // cell: .field has col model
    case selector.COL:  // col:  .column_name I think
      return ko.utils.domData.get(elem, 'itemModel');
    default:
      throw Error("Unknown elemType in domToRowModel");
  }
};

// ======================================================================================
// DOM STUFF

/**
 * Recalculate various positioning variables.
 */
//TODO : is this necessary? make passive. Also this could be removed soon I think
GridView.prototype.onScroll = function() {
  var pane = this.scrollPane;
  this.scrollLeft(pane.scrollLeft);
  this.scrollTop(pane.scrollTop);
  this.width(pane.clientWidth);
};


GridView.prototype.buildDom = function() {
  var self = this;
  var data = this.viewData;
  var v = this.viewSection;
  var editIndex = this.currentEditingColumnIndex;

  //each row has toggle classes on these props, so grab them once to save on lookups
  let vHorizontalGridlines = v.optionsObj.prop('horizontalGridlines');
  let vVerticalGridlines   = v.optionsObj.prop('verticalGridlines');
  let vZebraStripes        = v.optionsObj.prop('zebraStripes');

  var renameCommands = {
    nextField: function() {
      editIndex(editIndex() + 1);
      self.selectColumn(editIndex.peek());
    },
    prevField: function() {
      editIndex(editIndex() - 1);
      self.selectColumn(editIndex.peek());
    }
  };

  return dom(
    'div.gridview_data_pane.flexvbox',
    // offset for frozen columns - how much move them to the left
    kd.style('--frozen-offset', this.frozenOffset),
    // total width of frozen columns
    kd.style('--frozen-width', this.frozenWidth),
    // Corner, bars and shadows
    // Corner and shadows (so it's fixed to the grid viewport)
    self._cornerDom = dom(
      'div.gridview_data_corner_overlay',
      dom.on('click', () => this.selectAll()),
    ),
    dom('div.scroll_shadow_top', kd.show(this.scrollShadow.top)),
    dom('div.scroll_shadow_left',
      kd.show(this.scrollShadow.left),
      // pass current scroll position
      kd.style('--frozen-scroll-offset', this.frozenScrollOffset)),
    dom('div.frozen_line', kd.show(this.frozenLine)),
    dom('div.gridview_header_backdrop_left'), //these hide behind the actual headers to keep them from flashing
    dom('div.gridview_header_backdrop_top'),
    dom('div.gridview_left_border'), //these hide behind the actual headers to keep them from flashing
    // left shadow that will be visible on top of frozen columns
    dom('div.scroll_shadow_frozen', kd.show(this.frozenShadow)),
    // When cursor leaves the GridView, remove hover immediately (without debounce).
    // This guards mouse leaving gridView from the top, as leaving from bottom or left, right, is
    // guarded on the row level.
    dom.on("mouseleave", () => !this.isDisposed() && this.hoverColumn(-1)),
    // Drag indicators
    self.colLine = dom(
      'div.col_indicator_line',
      kd.show(function() { return self.cellSelector.isCurrentDragType(selector.COL); }),
      kd.style('left', self.cellSelector.col.linePos)
    ),
    self.colShadow = dom(
      'div.column_shadow',
      kd.show(function() { return self.cellSelector.isCurrentDragType(selector.COL); }),
      kd.style('left', function() { return (self.dragX() - self.colShadowAdjust) + 'px'; })
    ),
    self.rowLine = dom(
      'div.row_indicator_line',
      kd.show(function() { return self.cellSelector.isCurrentDragType(selector.ROW); }),
      kd.style('top', self.cellSelector.row.linePos)
    ),
    self.rowShadow = dom(
      'div.row_shadow',
      kd.show(function() { return self.cellSelector.isCurrentDragType(selector.ROW); }),
      kd.style('top', function() { return (self.dragY() - self.rowShadowAdjust) + 'px'; })
    ),

    self.scrollPane =
    dom('div.grid_view_data.gridview_data_scroll.show_scrollbar',
      kd.scrollChildIntoView(self.visibleRowIndex),
      dom.onDispose(() => {
        // Save the previous scroll values to the section.
        self.viewSection.lastScrollPos = _.extend({
          scrollLeft: self.scrollPane.scrollLeft
        }, self.scrolly.getScrollPos());
      }),

      // COL HEADER BOX
      dom('div.gridview_stick-top.flexhbox',   // Sticks to top, flexbox makes child enclose its contents
        dom('div.gridview_corner_spacer'),

        self.header = dom('div.gridview_data_header.flexhbox', // main header, flexbox floats contents onto a line

          dom('div.column_names.record',
            kd.style('minWidth', '100%'),
            kd.style('borderLeftWidth', v.borderWidthPx),
            kd.foreach(v.viewFields(), field => {
              var isEditingLabel = ko.pureComputed({
                read: () => {
                  const goodIndex = () => editIndex() === field._index();
                  const isReadonly = () => this.gristDoc.isReadonlyKo() || self.isPreview;
                  const isSummary = () => Boolean(field.column().disableEditData());
                  return goodIndex() && !isReadonly() && !isSummary();
                },
                write: val => editIndex(val ? field._index() : -1)
              }).extend({ rateLimit: 0 });
              let filterTriggerCtl;
              const isTooltip = ko.pureComputed(() =>
                  self.gristDoc.docModel.editingFormula() &&
                  ko.unwrap(self.hoverColumn) === field._index());
              return dom(
                'div.column_name.field',
                kd.style('--frozen-position', () => ko.unwrap(this.frozenPositions.at(field._index()))),
                kd.toggleClass("frozen", () => ko.unwrap(this.frozenMap.at(field._index()))),
                kd.toggleClass("hover-column", isTooltip),
                dom.autoDispose(isEditingLabel),
                dom.autoDispose(isTooltip),
                dom.testId("GridView_columnLabel"),
                (el) => {
                  const tooltip = new HoverColumnTooltip(el);
                  return [
                     dom.autoDispose(tooltip),
                     dom.autoDispose(isTooltip.subscribe((show) => {
                      if (show) {
                        tooltip.show(`Click to insert $${field.colId.peek()}`);
                      } else {
                        tooltip.hide();
                      }
                    })),
                  ]
                },
                kd.style('width', field.widthPx),
                kd.style('borderRightWidth', v.borderWidthPx),
                viewCommon.makeResizable(field.width, {shouldSave: !this.gristDoc.isReadonly.get()}),
                kd.toggleClass('selected', () => ko.unwrap(this.isColSelected.at(field._index()))),
                dom.on('contextmenu', ev => {
                  // This is a little hack to position the menu the same way as with a click
                  ev.preventDefault();
                  const btn = ev.currentTarget.querySelector('.g-column-menu-btn');
                  if (btn) { btn.click(); }
                }),
                dom('div.g-column-label',
                  kf.editableLabel(self.isPreview ? field.label : field.displayLabel, isEditingLabel, renameCommands),
                  dom.on('mousedown', ev => isEditingLabel() ? ev.stopPropagation() : true)
                ),
                dom.on("mouseenter", () => self.changeHover(field._index())),
                dom.on("mouseleave", () => self.changeHover(-1)),
                self.isPreview ? null : menuToggle(null,
                  kd.cssClass('g-column-main-menu'),
                  kd.cssClass('g-column-menu-btn'),
                  // Prevent mousedown on the dropdown triangle from initiating column drag.
                  dom.on('mousedown', () => false),
                  // Select the column if it's not part of a multiselect.
                  dom.on('click', (ev) => this.maybeSelectColumn(ev.currentTarget.parentNode, field)),
                  (elem) => {
                    filterTriggerCtl = setPopupToCreateDom(elem, ctl => this._columnFilterMenu(ctl, field), {
                      attach: 'body',
                      placement: 'bottom-start',
                      boundaries: 'viewport',
                      trigger: [],
                    });
                  },
                  menu(ctl => this.columnContextMenu(ctl, this.getSelection(), field, filterTriggerCtl)),
                  testId('column-menu-trigger'),
                )
              );
            }),
            this.isPreview ? null : kd.maybe(() => !this.gristDoc.isReadonlyKo(), () => (
              this._modField = dom('div.column_name.mod-add-column.field',
                '+',
                kd.style("width", PLUS_WIDTH + 'px'),
                dom.on('click', ev => {
                  // If there are no hidden columns, clicking the plus just adds a new column.
                  // If there are hidden columns, display a dropdown menu.
                  if (this.viewSection.hiddenColumns().length === 0) {
                    ev.stopImmediatePropagation(); // Don't open the menu defined below
                    this.addNewColumn();
                  }
                }),
                menu((ctl => ColumnAddMenu(this, this.viewSection)))
              )
            ))
          )
        ) //end hbox
      ), // END COL HEADER BOX

      koDomScrolly.scrolly(data, { paddingBottom: 80, paddingRight: 28 }, renderRow),

      kd.maybe(this._isPrinting, () =>
        renderAllRows(this.tableModel, this.sortedRows.getKoArray().peek(), renderRow)
      ),
    ) // end scrollpane
  );// END MAIN VIEW BOX

  function renderRow(row) {
    // TODO. There are several ways to implement a cursor; similar concerns may arise
    // when implementing selection and cell editor.
    // (1) Class on 'div.field.field_clip'. Fewest elements, seems possibly best for
    //     performance. Problem is: it's impossible to get cursor exactly right with a
    //     one-sided border. Attaching a cursor as additional element inside the cell
    //     truncates the cursor to the cell's inside because of 'overflow: hidden'.
    // (2) 'div.field' with 'div.field_clip' inside, on which a class is toggled. This
    //     works well. The only concern is whether this slows down rendering. Would be
    //     good to measure and compare rendering speed.
    //     Related: perhaps the fastest rendering would be for a table.
    // (3) Separate element attached to the row, absolutely positioned at left
    //     position and width of the selected cell. This works too. Requires
    //     maintaining a list of leftOffsets (or measuring the cell's), and feels less
    //     clean and more complicated than (2).

    // IsRowActive and isCellActive are a significant optimization. IsRowActive is called
    // for all rows when cursor.rowIndex changes, but the value only changes for two of the
    // rows. IsCellActive is only subscribed to columns for the active row. This way, when
    // the cursor moves, there are (rows+2*columns) calls rather than rows*columns.
    var isRowActive = ko.computed(() => row._index() === self.cursor.rowIndex());
    return dom('div.gridview_row',
      dom.autoDispose(isRowActive),

      // rowid dom
      dom('div.gridview_data_row_num',
        kd.style("width", ROW_NUMBER_WIDTH + 'px'),
        dom('div.gridview_data_row_info',
          kd.toggleClass('linked_dst', () => {
            // Must ensure that linkedRowId is not null to avoid drawing on rows whose
            // row ids are null.
            return self.linkedRowId() && self.linkedRowId() === row.getRowId();
          })
        ),
        kd.text(function() { return row._index() + 1; }),

        kd.scope(row._validationFailures, function(failures) {
          if (!row._isAddRow() && failures.length > 0) {
            return dom('div.validation_error_number', failures.length,
              kd.attr('title', function() {
                return "Validation failed: " +
                  failures.map(function(val) { return val.name(); }).join(", ");
              })
            );
          }
        }),
        dom.on('contextmenu', ev => {
          // This is a little hack to position the menu the same way as with a click,
          // the same hack as on a column menu.
          ev.preventDefault();
          ev.currentTarget.querySelector('.menu_toggle').click();
        }),
        self.isPreview ? null : menuToggle(null,
          dom.on('click', ev => self.maybeSelectRow(ev.currentTarget.parentNode, row.getRowId())),
          menu(() => RowContextMenu({
            disableInsert: Boolean(self.gristDoc.isReadonly.get() || self.viewSection.disableAddRemoveRows() || self.tableModel.tableMetaRow.onDemand()),
            disableDelete: Boolean(self.gristDoc.isReadonly.get() || self.viewSection.disableAddRemoveRows() || self.getSelection().onlyAddRowSelected()),
            isViewSorted: self.viewSection.activeSortSpec.peek().length > 0,
          }), { trigger: ['click'] }),
          // Prevent mousedown on the dropdown triangle from initiating row drag.
          dom.on('mousedown', () => false),
          testId('row-menu-trigger'),
        ),
        kd.toggleClass('selected', () =>
          !row._isAddRow() && self.cellSelector.isRowSelected(row._index())),
      ),
      dom('div.record',
        kd.toggleClass('record-add', row._isAddRow),
        kd.style('borderLeftWidth', v.borderWidthPx),
        kd.style('borderBottomWidth', v.borderWidthPx),
        //These are grabbed from v.optionsObj at start of GridView buildDom
        kd.toggleClass('record-hlines', vHorizontalGridlines),
        kd.toggleClass('record-vlines', vVerticalGridlines),
        kd.toggleClass('record-zebra', vZebraStripes),
        // even by 1-indexed rownum, so +1 (makes more sense for user-facing display stuff)
        kd.toggleClass('record-even', () => (row._index()+1) % 2 === 0 ),
        dom.on("mouseleave", (ev) => {
          // Leave only when leaving record row.
          if (!ev.relatedTarget || !ev.relatedTarget.classList.contains("record")){
            self.changeHover(-1);
          }
        }),
        self.comparison ? kd.cssClass(() => {
          const rowType = self.extraRows.getRowType(row.id());
          return rowType && `diff-${rowType}` || '';
        }) : null,

        kd.foreach(v.viewFields(), function(field) {
          // Whether the cell has a cursor (possibly in an inactive view section).
          var isCellSelected = ko.computed(() =>
            isRowActive() && field._index() === self.cursor.fieldIndex());

          // Whether the cell is active: has the cursor in the active section.
          var isCellActive = ko.computed(() => isCellSelected() && v.hasFocus());

          // Whether the cell is part of an active copy-paste operation.
          var isCopyActive = ko.computed(function() {
            return self.copySelection() &&
              self.copySelection().isCellSelected(row.id(), field.colId());
          });
          var fieldBuilder = self.fieldBuilders.at(field._index());
          var isSelected = ko.computed(() => {
            return !row._isAddRow() &&
              !self.cellSelector.isCurrentSelectType(selector.NONE) &&
              ko.unwrap(self.isColSelected.at(field._index())) &&
              self.cellSelector.isRowSelected(row._index());
          });
          return dom(
            'div.field',
            kd.style('--frozen-position', () => ko.unwrap(self.frozenPositions.at(field._index()))),
            kd.toggleClass("frozen", () => ko.unwrap(self.frozenMap.at(field._index()))),
            kd.toggleClass('scissors', isCopyActive),
            dom.autoDispose(isCopyActive),
            dom.autoDispose(isCellSelected),
            dom.autoDispose(isCellActive),
            dom.autoDispose(isSelected),
            dom.on("mouseenter", () => self.changeHover(field._index())),
            kd.toggleClass("hover-column", () =>
              self.gristDoc.docModel.editingFormula() &&
              ko.unwrap(self.hoverColumn) === (field._index())),
            kd.style('width', field.widthPx),
            //TODO: Ensure that fields in a row resize when
            //a cell in that row becomes larger
            kd.style('borderRightWidth', v.borderWidthPx),

            kd.toggleClass('selected', isSelected),
            fieldBuilder.buildDomWithCursor(row, isCellActive, isCellSelected)
          );
        })
      )
    );
  }
};

/** @inheritdoc */
GridView.prototype.onResize = function() {
  const activeFieldBuilder = this.activeFieldBuilder();
  if (activeFieldBuilder && activeFieldBuilder.isEditorActive()) {
    // When the editor is active, the common case for a resize is if the virtual keyboard is being
    // shown on mobile device. In that case, we need to scroll active cell into view, and need to
    // do it synchronously, to allow repositioning the editor to it in response to the same event.
    this.scrolly.updateSize();
    this.scrolly.scrollRowIntoView(this.cursor.rowIndex.peek());
  } else {
    this.scrolly.scheduleUpdateSize();
  }
  this.width(this.scrollPane.clientWidth)
};

/** @inheritdoc */
GridView.prototype.onRowResize = function(rowModels) {
  this.scrolly.resetItemHeights(rowModels);
};

GridView.prototype.onLinkFilterChange = function(rowId) {
  BaseView.prototype.onLinkFilterChange.call(this, rowId);
  this.clearSelection();
};

// ======================================================================================
// SELECTOR STUFF

/**
 * Returns a pure computed boolean that determines whether the given column is selected.
 * @param {view field object} col - the column to create an observable for
 **/
GridView.prototype._createColSelectedObs = function(col) {
  return ko.pureComputed(function() {
    return this.cellSelector.isCurrentSelectType(selector.ROW) ||
           gutil.between(col._index(), this.cellSelector.col.start(),
                         this.cellSelector.col.end());
  }, this);
};

// Callbacks for mouse events for the selector object

GridView.prototype.cellMouseDown = function(elem, event) {
  if (event.shiftKey) {
    // Change focus before running command so that the correct viewsection's cursor is moved.
    this.viewSection.hasFocus(true);
    let row = this.domToRowModel(elem, selector.CELL);
    let col = this.domToColModel(elem, selector.CELL);
    this.cellSelector.selectArea(this.cursor.rowIndex(), this.cursor.fieldIndex(),
                                 row._index(), col._index());
  } else {
    this.assignCursor(elem, selector.NONE);
  }
};

GridView.prototype.colMouseDown = function(elem, event) {
  this._colClickTime = Date.now();
  this.assignCursor(elem, selector.COL);
  // Clicking the column header selects all rows except the add row.
  this.cellSelector.row.end(this.getLastDataRowIndex());
};

GridView.prototype.rowMouseDown = function(elem, event) {
  if (event.shiftKey) {
    this.cellSelector.currentSelectType(selector.ROW);
    this.cellSelector.row.end(this.currentMouseRow(event.pageY));
  } else {
    this.assignCursor(elem, selector.ROW);
  }
};

GridView.prototype.rowMouseMove = function(elem, event) {
  this.cellSelector.row.end(this.currentMouseRow(event.pageY));
};

GridView.prototype.colMouseMove = function(elem, event) {
  var currentCol = Math.min(this.getMousePosCol(this.scrollLeft() + event.pageX),
                            this.viewSection.viewFields().peekLength - 1);
  this.cellSelector.col.end(currentCol);
};

GridView.prototype.cellMouseMove = function(elem, event, extra) {
  this.colMouseMove(elem, event);
  this.rowMouseMove(elem, event);
  // Maintain single cells cannot be selected invariant
  if (this.cellSelector.onlyCellSelected(this.cursor.rowIndex(), this.cursor.fieldIndex())) {
    this.cellSelector.currentSelectType(selector.NONE);
  } else {
    this.cellSelector.currentSelectType(selector.CELL);
  }
};

GridView.prototype.createSelector = function() {
  this.cellSelector = new selector.CellSelector(this);
};

// buildDom needs some of the row/col/cell selector observables to exist beforehand
// but we can't attach any of the mouse handlers in the Selector class until the
// dom elements exist so we attach the selector handlers separately from instantiation
GridView.prototype.attachSelectorHandlers = function () {
  // We attach mousemove and mouseup to document so that selecting and drag/dropping
  // work even if the mouse leaves the view pane: http://news.qooxdoo.org/mouse-capturing
  // Mousemove/up events fire to document even if the mouse leaves the browser window.
  var rowCallbacks =  {
    'disableDrag': this.viewSection.disableDragRows,
    'mousedown': { 'select': this.rowMouseDown,
                   'drag': this.styleRowDragElements,
                   'elemName': '.gridview_data_row_num',
                   'source': this.viewPane,
    },
    'mousemove':  { 'select': this.rowMouseMove,
                    'drag': this.dragRows,
                    'source': document,
    },
    'mouseup':   { 'select': this.rowMouseUp,
                   'drag': this.dropRows,
                   'source': document,
    }
  };
  var colCallbacks =  {
    'mousedown': { 'select': this.colMouseDown,
                   'drag': this.styleColDragElements,
                   // Trigger on column headings but not on the add column button
                   'elemName': '.column_name.field:not(.mod-add-column)',
                   'source': this.viewPane,
    },
    'mousemove':  { 'select': this.colMouseMove,
                    'drag': this.dragCols,
                    'source': document,
    },
    'mouseup':   { 'drag': this.dropCols,
                   'source': document,
    }
  };
  var cellCallbacks =  {
    'mousedown': { 'select': this.cellMouseDown,
                   'drag' : function(elem) { this.assignCursor(elem, selector.NONE); },
                   'elemName': '.field:not(.column_name)',
                   'source': this.scrollPane
    },
    'mousemove':  { 'select': this.cellMouseMove,
                    'source': document,
    },
    'mouseup':   { 'select': this.cellMouseUp,
                   'source': document,
    }
  };

  this.cellSelector.registerMouseHandlers(rowCallbacks, selector.ROW);
  this.cellSelector.registerMouseHandlers(colCallbacks, selector.COL);
  this.cellSelector.registerMouseHandlers(cellCallbacks, selector.CELL);
};

// End of Selector stuff

// ============================================================================
// DRAGGING LOGIC

GridView.prototype.styleRowDragElements = function(elem, event) {
  var rowStart = this.cellSelector.rowLower();
  var rowEnd = this.cellSelector.rowUpper();
  var shadowHeight = this.scrolly.rowOffsetTree.getCumulativeValueRange(rowStart, rowEnd+1);
  var shadowTop = (this.header.getBoundingClientRect().height +
                   this.scrolly.rowOffsetTree.getSumTo(rowStart) - this.scrollTop());

  this.rowLine.style.top = shadowTop + 'px';
  this.rowShadow.style.top = shadowTop + 'px';
  this.rowShadow.style.height = shadowHeight + 'px';
  this.rowShadowAdjust = event.pageY - shadowTop;
  this.cellSelector.currentDragType(selector.ROW);
  this.cellSelector.row.dropIndex(this.cellSelector.rowLower());
};

GridView.prototype.styleColDragElements = function(elem, event) {
  this._colClickTime = Date.now();
  var colStart = this.cellSelector.colLower();
  var colEnd = this.cellSelector.colUpper();
  var shadowWidth = this.colRightOffsets.peek().getCumulativeValueRange(colStart, colEnd+1);
  var viewDataNumsWidth = $('.gridview_corner_spacer').width();
  var shadowLeft = (viewDataNumsWidth + this.colRightOffsets.peek().getSumTo(colStart) - this.scrollLeft());

  this.colLine.style.left = shadowLeft + 'px';
  this.colShadow.style.left = shadowLeft + 'px';
  this.colShadow.style.width = shadowWidth + 'px';
  this.colShadowAdjust = event.pageX - shadowLeft;
  this.cellSelector.currentDragType(selector.COL);
  this.cellSelector.col.dropIndex(this.cellSelector.colLower());
};

/**
 * GridView.dragRows/dragCols update the row/col shadow and row/col indicator line on mousemove events.
 * Rules for determining where the indicator line should show while dragging cols/rows:
 * 0) The indicator line should not appear after the special add-row.
 * 1) If the mouse position is within the selected range -> the indicator line should show
 *    at the left offset of the start of the select range
 * 2) If the mouse position comes after the select range -> increment the computed dropIndex by 1
 * 3) If the last col/row is in the select range, the indicator line should be clamped to the start of the
 *    select range.
 **/
GridView.prototype.dragRows = function(elem, event) {
  var dropIndex = Math.min(this.getMousePosRow(event.pageY + this.scrollTop()),
                           this.getLastDataRowIndex());
  if (this.cellSelector.containsRow(dropIndex)) {
    dropIndex = this.cellSelector.rowLower();
  } else if (dropIndex > this.cellSelector.rowUpper()) {
    dropIndex += 1;
  }
  if (this.cellSelector.rowUpper() === this.viewData.peekLength - 1) {
    dropIndex = Math.min(dropIndex, this.cellSelector.rowLower());
  }

  var linePos = this.scrolly.rowOffsetTree.getSumTo(dropIndex) +
               this.header.getBoundingClientRect().height - this.scrollTop();
  this.cellSelector.row.linePos(linePos + 'px');
  this.cellSelector.row.dropIndex(dropIndex);
  this.dragY(event.pageY);
};

GridView.prototype.dragCols = function(elem, event) {
  var dropIndex = Math.min(this.getMousePosCol(event.pageX + this.scrollLeft()),
                           this.viewSection.viewFields().peekLength - 1);
  if (this.cellSelector.containsCol(dropIndex)) {
    dropIndex = this.cellSelector.colLower();
  } else if (dropIndex > this.cellSelector.colUpper()) {
    dropIndex += 1;
  }
  if (this.cellSelector.colUpper() === this.viewSection.viewFields().peekLength - 1) {
    dropIndex = Math.min(dropIndex, this.cellSelector.colLower());
  }

  var viewDataNumsWidth = $('.gridview_corner_spacer').width();
  var linePos = viewDataNumsWidth + this.colRightOffsets.peek().getSumTo(dropIndex) - this.scrollLeft();
  this.cellSelector.col.linePos(linePos + 'px');
  this.cellSelector.col.dropIndex(dropIndex);
  this.dragX(event.pageX);
};

GridView.prototype.dropRows = function() {
  var oldIndices = _.range(this.cellSelector.rowLower(), this.cellSelector.rowUpper() + 1);
  this.moveRows(oldIndices, this.cellSelector.row.dropIndex());
};

GridView.prototype.dropCols = function() {
  var oldIndices = _.range(this.cellSelector.colLower(), this.cellSelector.colUpper() + 1);
  const idx = this.cellSelector.col.dropIndex();
  this.moveColumns(oldIndices, idx);
  // If this was a short click on a single already-selected column that results in no
  // column movement, propose renaming the column.
  if (Date.now() - this._colClickTime < SHORT_CLICK_IN_MS && oldIndices.length === 1 &&
      idx === oldIndices[0]) {
    this.currentEditingColumnIndex(idx);
  }
  this._colClickTime = 0;
};

/**
 * After rows/cols in the range start() to end() inclusive are moved to newIndex,
 * update the start and end observables so that they stay selected after the move.
 * @param {observable} start - observable denoting the start index of the moved/dropped elements
 * @param {observable} end - observable denoting the end index of the moved/dropped elements
 * @param {integer} numEles - number of elements to move
 * @param {integer} newIndex - new index of the start of the selected range
 */
GridView.prototype._selectMovedElements = function(start, end, newIndex, numEles, elemType) {
  console.assert(elemType === selector.ROW || elemType === selector.COL);
  var newPos = newIndex < Math.min(start(), end()) ? newIndex : newIndex - numEles;
  if (elemType === selector.COL) this.cursor.fieldIndex(newPos);
  else if (elemType === selector.ROW) this.cursor.rowIndex(newPos);

  this.cellSelector.currentSelectType(elemType);
  start(newPos);
  end(newPos + numEles - 1);
};

// End of Dragging logic


// ===========================================================================
// CONTEXT MENUS

GridView.prototype.columnContextMenu = function(ctl, copySelection, field, filterTriggerCtl) {
  const selectedColIds = copySelection.colIds;
  this.ctxMenuHolder.autoDispose(ctl);
  const options = this._getColumnMenuOptions(copySelection);

  if (selectedColIds.length > 1 && selectedColIds.includes(field.column().colId())) {
    return MultiColumnMenu(options);
  } else {
    return ColumnContextMenu({
      filterOpenFunc: () => filterTriggerCtl.open(),
      sortSpec: this.gristDoc.viewModel.activeSection.peek().activeSortSpec.peek(),
      colId: field.column.peek().id.peek(),
      ...options,
    });
  }
};

GridView.prototype._getColumnMenuOptions = function(copySelection) {
  return {
    columnIndices: copySelection.fields.map(f => f._index()),
    totalColumnCount : this.viewSection.viewFields.peek().peekLength,
    numColumns: copySelection.fields.length,
    numFrozen: this.viewSection.numFrozen.peek(),
    disableModify: calcFieldsCondition(copySelection.fields, f => f.disableModify.peek()),
    isReadonly: this.gristDoc.isReadonly.get() || this.isPreview,
    isFiltered: this.isFiltered(),
    isFormula: calcFieldsCondition(copySelection.fields, f => f.column.peek().isRealFormula.peek()),
  };
}

GridView.prototype._columnFilterMenu = function(ctl, field) {
  this.ctxMenuHolder.autoDispose(ctl);
  const filterInfo = this.viewSection.filters()
    .find(({fieldOrColumn}) => fieldOrColumn.origCol().origColRef() === field.column().origColRef());
  return this.createFilterMenu(ctl, filterInfo);
};

GridView.prototype.maybeSelectColumn = function (elem, field) {
  // Change focus before running command so that the correct viewsection's cursor is moved.
  this.viewSection.hasFocus(true);
  const selectedColIds = this.getSelection().colIds;
  if (selectedColIds.length > 1 && selectedColIds.includes(field.column().colId())) {
    return; // No need to select the column because it's included in the multi-selection
  }
  this.assignCursor(elem, selector.COL);
};

GridView.prototype.maybeSelectRow = function(elem, rowId) {
  // Change focus before running command so that the correct viewsection's cursor is moved.
  this.viewSection.hasFocus(true);
  // If the clicked row was not already in the selection, move the selection to the row.
  if (!this.getSelection().rowIds.includes(rowId)) {
    this.assignCursor(elem, selector.ROW);
  }
};

// End Context Menus

GridView.prototype.scrollToCursor = function(sync = true) {
  return kd.doScrollChildIntoView(this.scrollPane, this.cursor.rowIndex(), sync);
}

// Helper to show tooltip over column selection in the full edit mode.
class HoverColumnTooltip {
  constructor(el) {
    this.el = el;
  }
  show(text) {
    this.hide();
    this.tooltip = showTooltip(this.el, () => dom("span", text, testId("column-formula-tooltip")))
  }
  hide() {
    if (this.tooltip ) {
      this.tooltip.close();
      this.tooltip = null;
    }
  }
  dispose() {
    this.hide();
  }
}

module.exports = GridView;
