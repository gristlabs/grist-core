/* globals $, window */

const _         = require('underscore');
const ko        = require('knockout');
const debounce = require('lodash/debounce');

const gutil             = require('app/common/gutil');
const BinaryIndexedTree = require('app/common/BinaryIndexedTree');
const {Sort} = require('app/common/SortSpec');

const dom           = require('../lib/dom');
const kd            = require('../lib/koDom');
const kf            = require('../lib/koForm');
const koDomScrolly  = require('../lib/koDomScrolly');
const tableUtil     = require('../lib/tableUtil');
const {addToSort, sortBy}   = require('../lib/sortUtil');

const commands      = require('./commands');
const viewCommon    = require('./viewCommon');
const Base          = require('./Base');
const BaseView      = require('./BaseView');
const selector      = require('./CellSelector');
const {CopySelection} = require('./CopySelection');
const {SelectionSummary} = require('./SelectionSummary');
const koUtil      = require('app/client/lib/koUtil');
const convert       = require('color-convert');

const {renderAllRows} = require('app/client/components/Printing');
const {reportWarning} = require('app/client/models/errors');
const {reportUndo} = require('app/client/components/modals');

const {onDblClickMatchElem} = require('app/client/lib/dblclick');
const {FocusLayer} = require('app/client/lib/FocusLayer');

// Grist UI Components
const {dom: grainjsDom, Holder, Computed} = require('grainjs');
const {closeRegisteredMenu, menu} = require('../ui2018/menus');
const {RowContextMenu} = require('../ui/RowContextMenu');
const {setPopupToCreateDom} = require('popweasel');
const {CellContextMenu} = require('app/client/ui/CellContextMenu');
const {testId, isNarrowScreen} = require('app/client/ui2018/cssVars');
const {contextMenu} = require('app/client/ui/contextMenu');
const {
  buildAddColumnMenu,
  buildColumnContextMenu,
  buildMultiColumnMenu,
  calcFieldsCondition,
  freezeAction,
} = require('app/client/ui/GridViewMenus');
const {mouseDragMatchElem} = require('app/client/ui/mouseDrag');
const {menuToggle} = require('app/client/ui/MenuToggle');
const {descriptionInfoTooltip, showTooltip} = require('app/client/ui/tooltips');
const {parsePasteForView} = require("./BaseView2");
const {NEW_FILTER_JSON} = require('app/client/models/ColumnFilter');
const {CombinedStyle} = require("app/client/models/Styles");
const {buildRenameColumn} = require('app/client/ui/ColumnTitle');
const {makeT} = require('app/client/lib/localization');
const { isList } = require('app/common/gristTypes');

const t = makeT('GridView');

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

  this.cellSelector = selector.CellSelector.create(this, this);

  if (!isPreview) {
    // Disable summaries in import previews, for now.
    this.selectionSummary = SelectionSummary.create(this,
      this.cellSelector, this.tableModel.tableData, this.sortedRows, this.viewSection.viewFields);
  }

  this.colMenuTargets = {}; // Reference from column ref to its menu target dom

  this.selectedColumns = this.autoDispose(ko.pureComputed(() => {
    const result = this.viewSection.viewFields().all().filter((field, index) => {
      // During column removal or restoring (with undo), some columns fields
      // might be disposed.
      if (field.isDisposed() || field.column().isDisposed()) { return false; }
      return this.cellSelector.containsCol(index);
    });
    return result;
  }));

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
    this._scrollColumnIntoView(idx);
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

  this._insertColumnIndex = ko.observable(null);

  // Checks if there is active formula editor for a column in this table.
  this.editingFormula = ko.pureComputed(() => {
    const isEditing = this.gristDoc.docModel.editingFormula();
    if (!isEditing) { return false; }
    return this.viewSection.viewFields().all().some(field => field.editingFormula());
  });

  // Debounced method to change current hover column, this is needed
  // as mouse when moved from field to field will switch the hover-column
  // observable from current index to -1 and then immediately back to current index.
  // With debounced version, call to set -1 that is followed by call to set back to the field index
  // will be discarded.
  this.changeHover = debounce((index) => {
    if (this.isDisposed()) { return; }
    if (this.editingFormula()) {
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
  onDblClickMatchElem(this.scrollPane, '.field:not(.column_name)', () => this.activateEditorAtCursor());
  if (!this.isPreview) {
    grainjsDom.onMatchElem(this.scrollPane, '.field:not(.column_name)', 'contextmenu', (ev, elem) => this.onCellContextMenu(ev, elem), {useCapture: true});
  }
  this.onEvent(this.scrollPane, 'scroll', this.onScroll);

  //--------------------------------------------------
  // Command group implementing all grid level commands (except cancel)
  this.autoDispose(commands.createGroup(GridView.gridCommands, this, this.viewSection.hasFocus));
  // Cancel command is registered conditionally, only when there is an active
  // cell selection. This command is also used by Raw Data Views, to close the Grid popup.
  const hasSelection = this.autoDispose(ko.pureComputed(() =>
    !this.cellSelector.isCurrentSelectType('') || this.copySelection()));
  this.autoDispose(commands.createGroup(GridView.selectionCommands, this, hasSelection));

  // Timer to allow short, otherwise non-actionable clicks on column names to trigger renaming.
  this._colClickTime = 0;  // Units: milliseconds.
}
Base.setBaseFor(GridView);
_.extend(GridView.prototype, BaseView.prototype);



// ======================================================================================
// GRID-LEVEL COMMANDS

// Moved out of all commands to support Raw Data Views (which use this command to close
// the Grid popup).
GridView.selectionCommands = {
  clearCopySelection: function() { this._clearCopySelection(); },
  cancel: function() { this.clearSelection(); }
}

GridView.gridCommands = {
  cursorDown: function() {
    if (this.cursor.rowIndex() === this.viewData.peekLength - 1) {
      // When the cursor is in the bottom row, the view may not be scrolled all the way to
      // the bottom (i.e. in the case of a tall row).
      this.scrollPaneBottom();
    }
    this.cursor.rowIndex(this.cursor.rowIndex() + 1);
  },
  cursorUp: function() {
    if (this.cursor.rowIndex() === 0) {
      // When the cursor is in the top row, the view may not be scrolled all the way to
      // the top (i.e. in the case of a tall row).
      this.scrollPaneTop();
    }
    this.cursor.rowIndex(this.cursor.rowIndex() - 1);
  },
  cursorRight: function() {
    if (this.cursor.fieldIndex() === this.viewSection.viewFields().peekLength - 1) {
      // When the cursor is in the rightmost column, the view may not be scrolled all the way to
      // the right (i.e. in the case of a wide column).
      this.scrollPaneRight();
    }
    this.cursor.fieldIndex(this.cursor.fieldIndex() + 1);
  },
  cursorLeft: function() {
    if (this.cursor.fieldIndex() === 0) {
      // When the cursor is in the leftmost column, the view may not be scrolled all the way to
      // the left (i.e. in the case of a wide column).
      this.scrollPaneLeft();
    }
    this.cursor.fieldIndex(this.cursor.fieldIndex() - 1);
  },
  shiftDown: function() { this._shiftSelect({step: 1, direction: 'down'}); },
  shiftUp: function() { this._shiftSelect({step: 1, direction: 'up'}); },
  shiftRight: function() { this._shiftSelect({step: 1, direction: 'right'}); },
  shiftLeft: function() { this._shiftSelect({step: 1, direction: 'left'}); },
  ctrlShiftDown: function () { this._shiftSelectUntilFirstOrLastNonEmptyCell({direction: 'down'}); },
  ctrlShiftUp: function () { this._shiftSelectUntilFirstOrLastNonEmptyCell({direction: 'up'}); },
  ctrlShiftRight: function () { this._shiftSelectUntilFirstOrLastNonEmptyCell({direction: 'right'}); },
  ctrlShiftLeft: function () { this._shiftSelectUntilFirstOrLastNonEmptyCell({direction: 'left'}); },
  fillSelectionDown: function() { this.fillSelectionDown(); },
  selectAll: function() { this.selectAll(); },

  fieldEditSave: function() { this.cursor.rowIndex(this.cursor.rowIndex() + 1); },
  // Re-define editField after fieldEditSave to make it take precedence for the Enter key.
  editField: function(event) { closeRegisteredMenu(); this.scrollToCursor(true); this.activateEditorAtCursor({event}); },

  insertFieldBefore: function(maybeKeyboardEvent) {
    if (!maybeKeyboardEvent) {
      this._openInsertColumnMenu(this.cursor.fieldIndex());
    } else {
      this.insertColumn(null, {index: this.cursor.fieldIndex()});
    }
  },
  insertFieldAfter: function(maybeKeyboardEvent) {
    if (!maybeKeyboardEvent) {
      this._openInsertColumnMenu(this.cursor.fieldIndex() + 1);
    } else {
      this.insertColumn(null, {index: this.cursor.fieldIndex() + 1});
    }
  },
  makeHeadersFromRow: function() { this.makeHeadersFromRow(this.getSelection()); },
  renameField: function() { this.renameColumn(this.cursor.fieldIndex()); },
  hideFields: function() { this.hideFields(this.getSelection()); },
  deleteFields: function() {
    const selection = this.getSelection();
    const count = selection.colIds.length;
    this.deleteColumns(selection).then((result) => {
      if (result !== false) {
        reportUndo(this.gristDoc, `You deleted ${count} column${count > 1 ? 's' : ''}.`);
      }
    });
  },
  clearValues: function() { this.clearValues(this.getSelection()); },
  clearColumns: function() { this._clearColumns(this.getSelection()); },
  convertFormulasToData: function() { this._convertFormulasToData(this.getSelection()); },
  copy: function() { return this.copy(this.getSelection()); },
  cut: function() { return this.cut(this.getSelection()); },
  paste: async function(pasteObj, cutCallback) {
    await this.gristDoc.docData.bundleActions(null, () => this.paste(pasteObj, cutCallback));
    await this.scrollToCursor(false);
  },
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
  },
  viewAsCard() {
    const selectedRows = this.selectedRows();
    if (selectedRows.length !== 1) { return; }

    this.viewSelectedRecordAsCard();
  },
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
 */
GridView.prototype._shiftSelect = function({step, direction}) {
  const type = ['up', 'down'].includes(direction) ? selector.ROW : selector.COL;
  const exemptType = type === selector.ROW ? selector.COL : selector.ROW;
  if (this.cellSelector.isCurrentSelectType(exemptType)) { return; }

  if (this.cellSelector.isCurrentSelectType(selector.NONE)) {
    this.cellSelector.currentSelectType(selector.CELL);
  }
  let selectObs;
  let maxVal;
  if (type === 'row') {
    selectObs = this.cellSelector.row.end;
    maxVal = this.getLastDataRowIndex();
  } else {
    selectObs = this.cellSelector.col.end;
    maxVal = this.viewSection.viewFields().peekLength - 1;
  }
  step = ['up', 'left'].includes(direction) ? -step : step;
  const newVal = gutil.clamp(selectObs() + step, 0, maxVal);
  selectObs(newVal);
  if (type === 'row') {
    this.scrolly.scrollRowIntoView(newVal);
  } else {
    this._scrollColumnIntoView(newVal);
  }
};

/**
 * Shifts the current selection in the specified `direction` until the first or last
 * non-empty cell.
 *
 * If the current selection ends on an empty cell, the selection will be shifted to
 * the first non-empty cell in the specified direction. Otherwise, the selection
 * will be shifted to the last non-empty cell.
 */
GridView.prototype._shiftSelectUntilFirstOrLastNonEmptyCell = function({direction}) {
  const steps = this._stepsToContent({direction});
  if (steps > 0) { this._shiftSelect({step: steps, direction}); }
}

/**
 * Gets the number of rows/columns until the first or last non-empty cell in the specified
 * `direction`.
 */
GridView.prototype._stepsToContent = function ({direction}) {
  const colEnd = this.cellSelector.col.end();
  const rowEnd = this.cellSelector.row.end();
  const cursorCol = this.cursor.fieldIndex();
  const cursorRow = this.cursor.rowIndex();
  const type = ['up', 'down'].includes(direction) ? selector.ROW : selector.COL;
  const maxVal = type === selector.ROW
    ? this.getLastDataRowIndex()
    : this.viewSection.viewFields().peekLength - 1;

  // Get table data for the current selection plus additional data in the specified `direction`.
  let selectionData;
  switch (direction) {
    case 'right': {
      if (colEnd + 1 > maxVal) { return 0; }

      selectionData = this._selectionData({colStart: colEnd, colEnd: maxVal, rowStart: cursorRow, rowEnd: cursorRow});
      break;
    }
    case 'left': {
      if (colEnd - 1 < 0) { return 0; }

      selectionData = this._selectionData({colStart: 0, colEnd, rowStart: cursorRow, rowEnd: cursorRow});
      break;
    }
    case 'up': {
      if (rowEnd - 1 > maxVal) { return 0; }

      selectionData = this._selectionData({colStart: cursorCol, colEnd: cursorCol, rowStart: 0, rowEnd});
      break;
    }
    case 'down': {
      if (rowEnd + 1 > maxVal) { return 0; }

      selectionData = this._selectionData({colStart: cursorCol, colEnd: cursorCol, rowStart: rowEnd, rowEnd: maxVal});
      break;
    }
  }

  const {fields, rowIndices} = selectionData;
  if (direction === 'left') {
    // When moving selection left, we step through fields in reverse order.
    fields.reverse();
  }
  if (direction === 'up') {
    // When moving selection up, we step through rows in reverse order.
    rowIndices.reverse();
  }

  // Prepare a map of field indexes to their respective column values. We'll consult these
  // values below when looking for the first (or last) non-empty cell value in the direction
  // of the new selection.
  const colValuesByIndex = {};
  for (const field of fields) {
    const displayColId = field.displayColModel.peek().colId.peek();
    colValuesByIndex[field._index()] = this.tableModel.tableData.getColValues(displayColId);
  }

  // Count the number of steps until the first or last non-empty cell.
  let steps = 0;
  if (type === selector.COL) {
    // The selection is changing on the x-axis (i.e. the selected columns changed).
    const rowIndex = rowIndices[0];
    const isLastColEmpty = this._isCellValueEmpty(colValuesByIndex[colEnd][rowIndex]);
    const isNextColEmpty = this._isCellValueEmpty(
      colValuesByIndex[colEnd + (direction === 'right' ? 1 : -1)][rowIndex]);
    const shouldStopOnEmptyValue = !isLastColEmpty && !isNextColEmpty;
    for (let i = 1; i < fields.length; i++) {
      const hasEmptyValues = this._isCellValueEmpty(colValuesByIndex[fields[i]._index()][rowIndex]);
      if (hasEmptyValues && shouldStopOnEmptyValue) {
        return steps;
      } else if (!hasEmptyValues && !shouldStopOnEmptyValue) {
        return steps + 1;
      }

      steps += 1;
    }
  } else {
    // The selection is changing on the y-axis (i.e. the selected rows changed).
    const colValues = colValuesByIndex[fields[0]._index()];
    const isLastRowEmpty = this._isCellValueEmpty(colValues[rowIndices[0]]);
    const isNextRowEmpty = this._isCellValueEmpty(colValues[rowIndices[1]]);
    const shouldStopOnEmptyValue = !isLastRowEmpty && !isNextRowEmpty;
    for (let i = 1; i < rowIndices.length; i++) {
      const hasEmptyValues = this._isCellValueEmpty(colValues[rowIndices[i]]);
      if (hasEmptyValues && shouldStopOnEmptyValue) {
        return steps;
      } else if (!hasEmptyValues && !shouldStopOnEmptyValue) {
        return steps + 1;
      }

      steps += 1;
    }
  }

  return steps;
}

GridView.prototype._selectionData = function({colStart, colEnd, rowStart, rowEnd}) {
  const fields = [];
  for (let i = colStart; i <= colEnd; i++) {
    const field = this.viewSection.viewFields().at(i);
    if (!field) { continue; }

    fields.push(field);
  }

  const rowIndices = [];
  for (let i = rowStart; i <= rowEnd; i++) {
    const rowId = this.viewData.getRowId(i);
    if (!rowId) { continue; }

    rowIndices.push(this.tableModel.tableData.getRowIdIndex(rowId));
  }

  return {fields, rowIndices};
}

GridView.prototype._isCellValueEmpty = function(value) {
  return value === null || value === undefined || value === '' || value === 'false';
}

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
GridView.prototype.paste = async function(data, cutCallback) {
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

  const richData = await parsePasteForView(pasteData, pasteFields, this.gristDoc);
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

      commands.allCommands.clearCopySelection.run();
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
 * Returns a CopySelection of the selected rows and cols
 * @returns {Object} CopySelection
 */
GridView.prototype.getSelection = function() {
  let rowIds = [], fields = [], rowStyle = {}, colStyle = {};
  let colStart = this.cellSelector.colLower();
  let colEnd = this.cellSelector.colUpper();
  let rowStart = this.cellSelector.rowLower();
  let rowEnd = this.cellSelector.rowUpper();

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

  // Start or end will be null if no fields are visible.
  if (colStart !== null && colEnd !== null) {
    for(var i = colStart; i <= colEnd; i++) {
      let field = this.viewSection.viewFields().at(i);
      fields.push(field);
      colStyle[field.colId()] = this._getColStyle(i);
    }
  }

  var rowId;
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
  this.cellSelector.selectArea(0, 0, Math.max(0, this.getLastDataRowIndex()),
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

  /* CellSelector already updates the selection whenever rowIndex/fieldIndex is changed, but
   * since those observables don't currently notify subscribers when an unchanged value is
   * written, there are cases where the selection doesn't get updated. For example, when doing
   * a click and drag to select cells and then clicking the "selected" cell that's outlined in
   * green, the row/column numbers remain highlighted as if they are still selected, while
   * GridView indicates the cells are not selected. This causes bugs that range from the
   * aformentioned visual discrepancy to incorrect copy/paste behavior due to out-of-date
   * selection ranges.
   *
   * We address this by calling setToCursor here unconditionally, but another possible approach
   * might be to extend rowIndex/fieldIndex to always notify their subscribers. Always notifying
   * currently introduces some bugs, and we'd also need to check that it doesn't cause too
   * much unnecessary UI recomputation elsewhere, so in the interest of time we use the first
   * approach. */
  this.cellSelector.setToCursor(elemType);
};

/**
 * Schedules cursor assignment to happen at end of tick. Calling `preventAssignCursor()` before
 * prevents assignment to happen. This was added to prevent cursor assignment on a `context click`
 * on a cell that is already selected.
 */
GridView.prototype.scheduleAssignCursor = function(elem, elemType) {
  this._assignCursorTimeoutId = setTimeout(() => {
    this.assignCursor(elem, elemType);
    this._assignCursorTimeoutId = null;
  }, 0);
}

/**
 * See `scheduleAssignCursor()` for doc.
 */
GridView.prototype.preventAssignCursor = function() {
  clearTimeout(this._assignCursorTimeoutId);
  this._assignCursorTimeoutId = null;
}

GridView.prototype.selectedRows = function() {
  const selection = this.getSelection();
  return _.without(selection.rowIds, 'new');
};

GridView.prototype.deleteRows = async function(rowIds) {
  const saved = this.cursor.getCursorPos();
  this.cursor.setLive(false);
  try {
    await BaseView.prototype.deleteRows.call(this, rowIds);
  } finally {
    this.cursor.setCursorPos(saved);
    this.cursor.setLive(true);
    this.clearSelection();
  }
};

GridView.prototype.insertColumn = async function(colId = null, options = {}) {
  const {
    colInfo = {},
    index = this.viewSection.viewFields().peekLength,
    skipPopup = false
  } = options;
  const newColInfo = await this.viewSection.insertColumn(colId, {colInfo, index});
  this.selectColumn(index);
  if (!skipPopup) { this.currentEditingColumnIndex(index); }
  // we want to show creator panel in some cases, but only when "rename panel" is dismissed
  const sub = this.currentEditingColumnIndex.subscribe(state=>{
    // if no column is edited we can assume that rename panel is closed
    if(state<0){
      options.onPopupClose?.();
      sub.dispose();
    }
  });
  return newColInfo;
};

GridView.prototype.makeHeadersFromRow = async function(selection) {
  if (this._getCellContextMenuOptions().disableMakeHeadersFromRow){
    return;
  }
  const record = this.tableModel.tableData.getRecord(selection.rowIds[0]);
  const actions = this.viewSection.viewFields().peek().reduce((acc, field) => {
    const col = field.column();
    const colId = col.colId.peek();
    let formatter = field.formatter();
    let newColLabel = record[colId];
    // Manage column that are references
    if (col.refTable()) {
      const refTableDisplayCol = this.gristDoc.docModel.columns.getRowModel(col.displayCol());
      newColLabel =  record[refTableDisplayCol.colId()];
      formatter = field.visibleColFormatter();
    }
    // Manage column that are lists
    if (isList(newColLabel)) {
      newColLabel = newColLabel[1];
    }
    if (typeof newColLabel === 'string') {
      newColLabel = newColLabel.trim();
    }
    // Check value is not empty but accept 0 and false as valid values
    if (newColLabel !== null && newColLabel !== undefined && newColLabel !== "") {
      return [...acc, ['ModifyColumn', colId, {"label": formatter.formatAny(newColLabel)}]];
    }
    return acc
  }, []);
  this.tableModel.sendTableActions(actions, "Use as table headers");
};

GridView.prototype.renameColumn = function(index) {
  this.currentEditingColumnIndex(index);
};

GridView.prototype.scrollPaneBottom = function() {
  this.scrollPane.scrollTop = this.scrollPane.scrollHeight;
};

GridView.prototype.scrollPaneTop = function() {
  this.scrollPane.scrollTop = 0;
};

GridView.prototype.scrollPaneRight = function() {
  this.scrollPane.scrollLeft = this.scrollPane.scrollWidth;
};

GridView.prototype.scrollPaneLeft = function() {
  this.scrollPane.scrollLeft = 0;
};

GridView.prototype.selectColumn = function(colIndex) {
  this.cursor.fieldIndex(colIndex);
  this.cellSelector.currentSelectType(selector.COL);
};

GridView.prototype.showColumn = async function(
  colRef,
  index = this.viewSection.viewFields().peekLength
) {
  await this.viewSection.showColumn(colRef, index);
  this.selectColumn(index);
};

// TODO: Replace alerts with custom notifications
GridView.prototype.deleteColumns = function(selection) {
  var fields = selection.fields;
  if (fields.length === this.viewSection.viewFields().peekLength) {
    reportWarning("You can't delete all the columns on the grid.", {
      key: 'delete-all-columns',
    });
    return Promise.resolve(false);
  }
  const columns = fields.filter(col => !col.disableModify());
  const colRefs = columns.map(col => col.colRef.peek());
  if (colRefs.length > 0) {
    return this.gristDoc.docData.sendAction(
        ['BulkRemoveRecord', '_grist_Tables_column', colRefs],
        `Removed columns ${columns.map(col => col.colId.peek()).join(', ')} ` +
        `from ${this.tableModel.tableData.tableId}.`
    ).then(() => this.clearSelection());
  }
  return Promise.resolve(false);
};

GridView.prototype.hideFields = function(selection) {
  var actions = selection.fields.map(field => ['RemoveRecord', field.id()]);
  return this.gristDoc.docModel.viewFields.sendTableActions(actions, `Hide columns ${actions.map(a => a[1]).join(', ')} ` +
  `from ${this.tableModel.tableData.tableId}.`);
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
  const newPos = newIndex < this.cellSelector.colLower() ? newIndex : newIndex - numCols;
  viewFieldsTable.sendTableAction(vsfAction).then(() => {
    this.cursor.fieldIndex(newPos);
    this.cellSelector.currentSelectType(selector.COL);
    this.cellSelector.col.start(newPos);
    this.cellSelector.col.end(newPos + numCols - 1);
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
  const newPos = newIndex < this.cellSelector.rowLower() ? newIndex : newIndex - numRows;
  this.tableModel.sendTableAction(action).then(() => {
    this.cursor.rowIndex(newPos);
    this.cellSelector.currentSelectType(selector.ROW);
    this.cellSelector.row.start(newPos);
    this.cellSelector.row.end(newPos + numRows - 1);
  });
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
  return Math.min(this.getMousePosRow(this.scrollTop() + yCoord), Math.max(0, this.getLastDataRowIndex()));
};

/**
 *  Returns the column index of the column whose left position is closest to and
 *  no greater than given x-position.
 *  param{xCoord}: The mouse x-position (absolute position on a page).
 *  Grid scroll offset and frozen columns are taken into account.
 *  Assumes that this.colRightOffsets is up to date
 *  In the following examples, let * denote the current mouse position.
 *      * |0____|1____|2____|3____|       Returns 0
 *        |0__*_|1____|2____|3____|       Returns 0
 *        |0____|1__*_|2____|3____|       Returns 1
 *        |0____|1____|2__*_|3____|       Returns 2
 *        |0____|1____|2____|3__*_|       Returns 3
 *        |0____|1____|2____|3____| *     Returns 4
 *
 * For frozen columns and a scrolled view:
 *      * |0____|1____|..5|6____|         Returns 0
 *        |0__*_|1____|..5|6____|         Returns 0
 *        |0____|1__*_|..5|6____|         Returns 1
 *        |0____|1____|*.5|6____|         Returns 5
 *        |0____|1____|..5|6__*_|         Returns 6
 *        |0____|1____|..5|6____| *       Returns 6
 **/
GridView.prototype.getMousePosCol = function (mouseX) {
  const scrollLeft = this.scrollLeft();
  // Offset to left edge of gridView viewports
  const headerOffset = this._cornerDom.getBoundingClientRect().right;
  // Convert mouse x to grid x (not including scroll yet).
  // GridX now has x position as if the grid pane is covering
  // the whole screen, it still can be scrolled, so 0px is not equal to A column yet.
  const gridX = mouseX - headerOffset;
  // Total width of frozen columns (if zero, no frozen column set)
  const frozenWidth = this.frozenWidth.peek();
  // Frozen columns can be scrolled also, but not more then frozenOffset.
  const frozenScroll = Math.min(this.frozenOffset.peek(), scrollLeft);
  // If gridX is in frozen section or outside. Frozen section can be scrolled also
  // on narrow screens so take this into account.
  const inFrozen = this.numFrozen.peek() && gridX <= (frozenWidth - frozenScroll);
  // If grid x (mouse converted to grid pane coordinates) is in frozen area
  // we need to use frozenScroll value (how much frozen area is scrolled),
  // but if it is outside we want to take the scroll offset into account.
  // Here we wil calculate where exactly is mouse (over which column),
  // to do that, we will pretend that nothing is scrolled - so we need
  // to move gridX a little to the right, either by grid offset (how much whole grid
  // is scrolled to the left) or a frozen set offset (how much frozen columns
  // are scrolled to the left).
  const scrollX = gridX + (inFrozen ? frozenScroll : scrollLeft);
  return this.colRightOffsets.peek().getIndex(scrollX);
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
      return undefined;
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
      return undefined;
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
      if (editIndex() === v.viewFields().peekLength - 1) {
        // Turn off editing if we're on the last field.
        editIndex(-1);
      } else {
        editIndex(editIndex() + 1);
        self.selectColumn(editIndex.peek());
      }
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
    // When there are frozen columns, right border for number row will not be visible (as actually there is no border,
    // it comes from the first cell in the grid) making a gap between row-number and actual column. So when we scroll
    // the content of the scrolled columns will be visible to the user (as there is blank space there).
    // This line fills the gap. NOTE that we are using number here instead of a boolean.
    dom('div.gridview_left_border', kd.show(this.numFrozen),
      kd.style("left", ROW_NUMBER_WIDTH + 'px')
    ),
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
              const isEditingLabel = koUtil.withKoUtils(ko.pureComputed({
                read: () => {
                  const goodIndex = () => editIndex() === field._index();
                  const isReadonly = () => this.gristDoc.isReadonlyKo() || self.isPreview;
                  const isSummary = () => Boolean(field.column().disableEditData());
                  return goodIndex() && !isReadonly() && !isSummary();
                },
                write: val => {
                  if (val) {
                    // Turn on editing.
                    editIndex(field._index());
                  } else {
                    // Turn off editing only if it wasn't changed to another field (e.g. by tabbing).
                    const isCurrent = editIndex.peek() === field._index.peek();
                    if (isCurrent) {
                      editIndex(-1);
                    }
                  }
                }
              }).extend({ rateLimit: 0 })).onlyNotifyUnequal();

              let filterTriggerCtl;
              const isTooltip = ko.pureComputed(() =>
                self.editingFormula() &&
                ko.unwrap(self.hoverColumn) === field._index()
              );

              const headerTextColor = ko.computed(() => field.headerTextColor() || '');
              const headerFillColor = ko.computed(() => field.headerFillColor() || '');
              const headerFontBold = ko.computed(() => field.headerFontBold());
              const headerFontItalic = ko.computed(() => field.headerFontItalic());
              const headerFontUnderline = ko.computed(() => field.headerFontUnderline());
              const headerFontStrikethrough = ko.computed(() => field.headerFontStrikethrough());

              return dom(
                'div.column_name.field',
                dom.autoDispose(headerTextColor),
                dom.autoDispose(headerFillColor),
                dom.autoDispose(headerFontBold),
                dom.autoDispose(headerFontItalic),
                dom.autoDispose(headerFontUnderline),
                dom.autoDispose(headerFontStrikethrough),
                kd.style('--grist-header-color', headerTextColor),
                kd.style('--grist-header-background-color', headerFillColor),
                kd.toggleClass('font-bold', headerFontBold),
                kd.toggleClass('font-italic', headerFontItalic),
                kd.toggleClass('font-underline', headerFontUnderline),
                kd.toggleClass('font-strikethrough', headerFontStrikethrough),
                kd.style('--frozen-position', () => ko.unwrap(this.frozenPositions.at(field._index()))),
                kd.toggleClass("frozen", () => ko.unwrap(this.frozenMap.at(field._index()))),
                dom.autoDispose(isEditingLabel),
                dom.autoDispose(isTooltip),
                dom.testId("GridView_columnLabel"),
                (el) => {
                  const tooltip = new HoverColumnTooltip(el);
                  return [
                     dom.autoDispose(tooltip),
                     dom.autoDispose(isTooltip.subscribe((show) => {
                      if (show) {
                        tooltip.show(t(`Click to insert`) + ` $${field.origCol.peek().colId.peek()}`);
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
                  kd.scope(field.description, desc => desc ? descriptionInfoTooltip(desc, "column") : null),
                  dom.on('mousedown', ev => isEditingLabel() ? ev.stopPropagation() : true),
                  // We are using editableLabel here, but we don't use it for editing.
                  kf.editableLabel(self.isPreview ? field.label : field.displayLabel, ko.observable(false)),
                  kd.scope(field.description, desc => desc ? dom('div.g-column-label-spacer') : null),
                  buildRenameColumn({
                    field,
                    isEditing: isEditingLabel,
                    optCommands: renameCommands
                  }),
                ),
                self._showTooltipOnHover(field, isTooltip),
                self.isPreview ? null : menuToggle(null,
                  kd.cssClass('g-column-main-menu'),
                  kd.cssClass('g-column-menu-btn'),
                  // Prevent mousedown on the dropdown triangle from initiating column drag.
                  dom.on('mousedown', () => false),
                  // Select the column if it's not part of a multiselect.
                  dom.on('click', (ev) => this.maybeSelectColumn(ev.currentTarget.parentNode, field)),
                  (elem) => {
                    filterTriggerCtl = setPopupToCreateDom(
                      elem,
                      ctl => this._columnFilterMenu(ctl, field, {showAllFiltersButton: true}),
                      {
                        attach: 'body',
                        placement: 'bottom-start',
                        boundaries: 'viewport',
                        trigger: [],
                      }
                    );
                  },
                  menu(ctl => this.columnContextMenu(ctl, this.getSelection(), field, filterTriggerCtl)),
                  testId('column-menu-trigger'),
                ),
                dom('div.selection'),
                this._buildInsertColumnMenu({field}),
              );
            }),
            this.isPreview ? null : kd.maybe(() => !this.gristDoc.isReadonlyKo(), () => (
              this._modField = dom('div.column_name.mod-add-column.field',
                '+',
                kd.style("width", PLUS_WIDTH + 'px'),
                this._buildInsertColumnMenu(),
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

    const computedFlags = ko.pureComputed(() => {
      return self.viewSection.rulesColsIds().map(colRef => {
        if (row.cells[colRef]) { return row.cells[colRef]() || false; }
        return false;
      });
    });

    const computedRule = koUtil.withKoUtils(ko.pureComputed(() => {
      if (row._isAddRow() || !row.id()) { return null; }
      const flags = computedFlags();
      if (flags.length === 0) { return null; }
      const styles = self.viewSection.rulesStyles() || [];
      return { style : new CombinedStyle(styles, flags) };
    }, this).extend({deferred: true}));

    const fillColor = buildStyleOption(self, computedRule, 'fillColor');
    const zebraColor = ko.pureComputed(() => calcZebra(fillColor()));
    const textColor = buildStyleOption(self, computedRule, 'textColor');
    const fontBold = buildStyleOption(self, computedRule, 'fontBold');
    const fontItalic = buildStyleOption(self, computedRule, 'fontItalic');
    const fontUnderline = buildStyleOption(self, computedRule, 'fontUnderline');
    const fontStrikethrough = buildStyleOption(self, computedRule, 'fontStrikethrough');

    return dom('div.gridview_row',
      dom.autoDispose(isRowActive),
      dom.autoDispose(computedFlags),
      dom.autoDispose(computedRule),
      dom.autoDispose(textColor),
      dom.autoDispose(fillColor),
      dom.autoDispose(zebraColor),
      dom.autoDispose(fontBold),
      dom.autoDispose(fontItalic),
      dom.autoDispose(fontUnderline),
      dom.autoDispose(fontStrikethrough),

      kd.toggleClass('link_selector_row', () => self.isLinkSource() && isRowActive()),

      // rowid dom
      dom('div.gridview_data_row_num',
        kd.style("width", ROW_NUMBER_WIDTH + 'px'),
        dom('div.gridview_data_row_info',
          kd.toggleClass('linked_dst', () => {
            const myRowId = row.id();
            const linkedRowId = self.linkedRowId();
            // Must ensure that linkedRowId is not null to avoid drawing on rows whose
            // row ids are null.
            return linkedRowId && linkedRowId === myRowId;
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
          menu((ctx) => {
            ctx.autoDispose(isRowActive.subscribe(() => ctx.close()));
            return self.rowContextMenu();
          }, { trigger: ['click'] }),
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
        kd.toggleClass('font-bold', fontBold),
        kd.toggleClass('font-underline', fontUnderline),
        kd.toggleClass('font-italic', fontItalic),
        kd.toggleClass('font-strikethrough', fontStrikethrough),
        kd.style('--grist-row-rule-background-color', fillColor),
        kd.style('--grist-row-rule-background-color-zebra', zebraColor),
        kd.style('--grist-row-color', textColor),
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
        self.isPreview ? null : contextMenu((ctx) => {
          // We need to close the menu when the row is removed, but the dom of the row is not
          // disposed when the record is removed (this is probably due to how scrolly work). Hence,
          // we need to subscribe to `isRowActive` to close the menu.
          ctx.autoDispose(isRowActive.subscribe(() => ctx.close()));
          return self.cellContextMenu();
        }),
        self.comparison ? kd.cssClass(() => {
          const rowType = self.extraRows.getRowType(row.id());
          return rowType && `diff-${rowType}` || '';
        }) : null,

        kd.foreach(v.viewFields(), function(field) {
          // Whether the cell has a cursor (possibly in an inactive view section).
          var isCellSelected = ko.computed(() =>
            isRowActive() &&
            field._index() === self.cursor.fieldIndex() &&
            self._insertColumnIndex() === null
          );

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

          var isTooltip = ko.pureComputed(() =>
            self.editingFormula() &&
            ko.unwrap(self.hoverColumn) === field._index()
          );

          return dom(
            'div.field',
            kd.toggleClass('field-insert-before', () =>
              self._insertColumnIndex() === field._index()),
            kd.style('--frozen-position', () => ko.unwrap(self.frozenPositions.at(field._index()))),
            kd.toggleClass("frozen", () => ko.unwrap(self.frozenMap.at(field._index()))),
            kd.toggleClass('scissors', isCopyActive),
            dom.autoDispose(isCopyActive),
            dom.autoDispose(isCellSelected),
            dom.autoDispose(isCellActive),
            dom.autoDispose(isSelected),
            self._showTooltipOnHover(field, isTooltip),
            kd.style('width', field.widthPx),
            //TODO: Ensure that fields in a row resize when
            //a cell in that row becomes larger
            kd.style('borderRightWidth', v.borderWidthPx),
            kd.toggleClass('selected', isSelected),
            // Optional icon. Currently only use to show formula icon.
            dom('div.field-icon'),
            fieldBuilder.buildDomWithCursor(row, isCellActive, isCellSelected),
            dom('div.selection'),
          );
        })
      )
    );
  }
};

/** @inheritdoc */
GridView.prototype.onResize = function() {
  const activeFieldBuilder = this.activeFieldBuilder();
  let height = null;
  if (isNarrowScreen()) {
    height = window.outerHeight;
  }
  if (activeFieldBuilder && activeFieldBuilder.isEditorActive()) {
    // When the editor is active, the common case for a resize is if the virtual keyboard is being
    // shown on mobile device. In that case, we need to scroll active cell into view, and need to
    // do it synchronously, to allow repositioning the editor to it in response to the same event.
    this.scrolly.updateSize(height);
    this.scrolly.scrollRowIntoView(this.cursor.rowIndex.peek());
  } else {
    this.scrolly.scheduleUpdateSize(height);
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

GridView.prototype.onCellContextMenu = function(ev, elem) {
  let row = this.domToRowModel(elem, selector.CELL);
  let col = this.domToColModel(elem, selector.CELL);

  if (this.cellSelector.containsCell(row._index(), col._index())) {
    // contextmenu event could be preceded by a mousedown event (ie: when ctrl+click on
    // mac) which triggers a cursor assignment that we need to prevent.
    this.preventAssignCursor();
  } else {
    this.assignCursor(elem, selector.NONE);
  }
}

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
  let col = this.domToColModel(elem, selector.CELL);
  if (this.hoverColumn() === col._index()) {
    return this._tooltipMouseDown(elem, selector.CELL);
  }

  if (event.shiftKey) {
    // Change focus before running command so that the correct viewsection's cursor is moved.
    this.viewSection.hasFocus(true);
    let row = this.domToRowModel(elem, selector.CELL);
    this.cellSelector.selectArea(this.cursor.rowIndex(), this.cursor.fieldIndex(),
                                 row._index(), col._index());
  } else {
    this.assignCursor(elem, selector.NONE);
  }
};

GridView.prototype.colMouseDown = function(elem, event) {
  let col = this.domToColModel(elem, selector.COL);
  if (this.hoverColumn() === col._index()) {
    return this._tooltipMouseDown(elem, selector.COL);
  }

  this._colClickTime = Date.now();
  this.assignCursor(elem, selector.COL);
  // Clicking the column header selects all rows except the add row.
  this.cellSelector.row.end(this.getLastDataRowIndex());
};

GridView.prototype._tooltipMouseDown = function(elem, elemType) {
  let row = this.domToRowModel(elem, elemType);
  let col = this.domToColModel(elem, elemType);
  // FormulaEditor.ts overrides this command to insert the column id of the clicked column.
  commands.allCommands.setCursor.run(row, col);
};

GridView.prototype.rowMouseDown = function(elem, event) {
  if (event.shiftKey) {
    this.cellSelector.currentSelectType(selector.ROW);
    this.cellSelector.row.end(this.currentMouseRow(event.pageY));
  } else {
    this.assignCursor(elem, selector.ROW);
  }
};

GridView.prototype.rowMouseMove = function(event) {
  this.cellSelector.row.end(this.currentMouseRow(event.pageY));
};

GridView.prototype.colMouseMove = function(event) {
  if (this.editingFormula()) { return; }

  var currentCol = Math.min(this.getMousePosCol(event.pageX),
                            this.viewSection.viewFields().peekLength - 1);
  this.cellSelector.col.end(currentCol);
};

GridView.prototype.cellMouseMove = function(event) {
  if (this.editingFormula()) { return; }

  this.colMouseMove(event);
  this.rowMouseMove(event);
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
  const ignoreEvent = (event, elem) => (
    event.button !== 0 ||
    event.target.classList.contains('ui-resizable-handle') ||
    // This is a bit of a hack to prevent dragging when there's an open column menu
    // TODO: disable dragging when there is an open cell context menu as well
    !this.ctxMenuHolder.isEmpty()
  );

  this.autoDispose(mouseDragMatchElem(this.viewPane, '.gridview_data_row_num', (event, elem) => {
    if (!ignoreEvent(event, elem)) {
      if (!this.cellSelector.isSelected(elem, selector.ROW)) {
        this.rowMouseDown(elem, event);
        return {
          onMove: (ev) => this.rowMouseMove(ev),
          onStop: (ev) => {},
        };
      } else if (!this.viewSection.disableDragRows()) {
        this.styleRowDragElements(elem, event);
        return {
          onMove: (ev) => this.dragRows(ev),
          onStop: (ev) => this.dropRows(),
        };
      }
    }
  }));

  // Trigger on column headings but not on the add column button
  this.autoDispose(mouseDragMatchElem(this.viewPane, '.column_name.field:not(.mod-add-column)', (event, elem) => {
    if (!ignoreEvent(event, elem)) {
      if (!this.cellSelector.isSelected(elem, selector.COL)) {
        this.colMouseDown(elem, event);
        return {
          onMove: (ev) => this.colMouseMove(ev),
          onStop: (ev) => {},
        };
      } else {
        this.styleColDragElements(elem, event);
        return {
          onMove: (ev) => this.dragCols(ev),
          onStop: (ev) => this.dropCols(),
        };
      }
    }
  }));

  this.autoDispose(mouseDragMatchElem(this.scrollPane, '.field:not(.column_name)', (event, elem) => {
    if (!ignoreEvent(event, elem)) {
      this.cellMouseDown(elem, event);
      return {
        onMove: (ev) => this.cellMouseMove(ev),
        onStop: (ev) => {},
      }
    }
  }));
}

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
GridView.prototype.dragRows = function(event) {
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

GridView.prototype.dragCols = function(event) {
  let dropIndex = Math.min(this.getMousePosCol(event.pageX),
                           this.viewSection.viewFields().peekLength - 1);
  if (this.cellSelector.containsCol(dropIndex)) {
    dropIndex = this.cellSelector.colLower();
  } else if (dropIndex > this.cellSelector.colUpper()) {
    dropIndex += 1;
  }
  if (this.cellSelector.colUpper() === this.viewSection.viewFields().peekLength - 1) {
    dropIndex = Math.min(dropIndex, this.cellSelector.colLower());
  }

  const viewDataNumsWidth = $('.gridview_corner_spacer').width();
  let linePos = viewDataNumsWidth + this.colRightOffsets.peek().getSumTo(dropIndex);
  // If there are frozen columns and dropIndex (column index) is inside the frozen set.
  const frozenCount = this.numFrozen();
  const inFrozen = frozenCount > 0 && dropIndex < frozenCount;
  const scrollLeft = this.scrollLeft();
  // Move line left by the number of pixels the frozen set is scrolled.
  if (inFrozen) {
    linePos -= Math.min(this.frozenOffset.peek(), scrollLeft);
  } else {
    // Else move left by the whole amount.
    linePos -= scrollLeft;
  }
  this.cellSelector.col.linePos(linePos + 'px');
  this.cellSelector.col.dropIndex(dropIndex);
  this.dragX(event.pageX);
};

GridView.prototype.dropRows = function() {
  var oldIndices = _.range(this.cellSelector.rowLower(), this.cellSelector.rowUpper() + 1);
  this.moveRows(oldIndices, this.cellSelector.row.dropIndex());
  this.cellSelector.currentDragType(selector.NONE);
};

GridView.prototype.dropCols = function() {
  var oldIndices = _.range(this.cellSelector.colLower(), this.cellSelector.colUpper() + 1);
  const idx = this.cellSelector.col.dropIndex();
  this.moveColumns(oldIndices, idx);
  // If this was a short click on a single already-selected column that results in no
  // column movement, propose renaming the column.
  if (Date.now() - this._colClickTime < SHORT_CLICK_IN_MS && oldIndices.length === 1 &&
      idx === oldIndices[0]) {
    commands.allCommands.renameField.run();
  }
  this._colClickTime = 0;
  this.cellSelector.currentDragType(selector.NONE);
};

// End of Dragging logic


// ===========================================================================
// CONTEXT MENUS

GridView.prototype.columnContextMenu = function(ctl, copySelection, field, filterTriggerCtl) {
  const selectedColIds = copySelection.colIds;
  this.ctxMenuHolder.autoDispose(ctl);
  const options = this._getColumnMenuOptions(copySelection);

  if (selectedColIds.length > 1 && selectedColIds.includes(field.column().colId())) {
    return buildMultiColumnMenu(options);
  } else {
    return buildColumnContextMenu({
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
    isRaw: this.viewSection.isRaw(),
    isFiltered: this.isFiltered(),
    isFormula: calcFieldsCondition(copySelection.fields, f => f.column.peek().isRealFormula.peek()),
  };
}

GridView.prototype._columnFilterMenu = function(ctl, field, options) {
  this.ctxMenuHolder.autoDispose(ctl);
  const filterInfo = this.viewSection.filters()
    .find(({fieldOrColumn}) => fieldOrColumn.origCol().origColRef() === field.column().origColRef());
  if (!filterInfo.isFiltered.peek()) {
    // This is a new filter - initialize its spec and pin it.
    this.viewSection.setFilter(filterInfo.fieldOrColumn.origCol().origColRef(), {
      filter: NEW_FILTER_JSON,
      pinned: true,
    });
  }
  return this.createFilterMenu(ctl, filterInfo, options);
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

GridView.prototype.rowContextMenu = function() {
  return RowContextMenu(this._getRowContextMenuOptions());
};

GridView.prototype._getRowContextMenuOptions = function() {
  return {
    ...this._getCellContextMenuOptions(),
    disableShowRecordCard: this.isRecordCardDisabled(),
  };
};

GridView.prototype.isRecordCardDisabled = function() {
  return BaseView.prototype.isRecordCardDisabled.call(this) ||
    this.getSelection().onlyAddRowSelected();
}

GridView.prototype.cellContextMenu = function() {
  return CellContextMenu(
    this._getCellContextMenuOptions(),
    this._getColumnMenuOptions(this.getSelection())
  );
};

GridView.prototype._getCellContextMenuOptions = function() {
  return {
    disableInsert: Boolean(
      this.gristDoc.isReadonly.get() ||
      this.viewSection.disableAddRemoveRows() ||
      this.tableModel.tableMetaRow.onDemand()
    ),
    disableDelete: Boolean(
      this.gristDoc.isReadonly.get() ||
      this.viewSection.disableAddRemoveRows() ||
      this.getSelection().onlyAddRowSelected()
    ),
    disableMakeHeadersFromRow: Boolean (
      this.gristDoc.isReadonly.get() || this.getSelection().rowIds.length !== 1 || this.getSelection().onlyAddRowSelected()
    ),
    isViewSorted: this.viewSection.activeSortSpec.peek().length > 0,
    numRows: this.getSelection().rowIds.length,
  };
};

// End Context Menus

GridView.prototype.scrollToCursor = function(sync = true) {
  return kd.doScrollChildIntoView(this.scrollPane, this.cursor.rowIndex(), sync);
}

GridView.prototype._duplicateRows = async function() {
  const addRowIds = await BaseView.prototype._duplicateRows.call(this);
  // Highlight duplicated rows if the grid is not sorted (or the sort doesn't affect rowIndex).
  const topRowIndex = this.viewData.getRowIndex(addRowIds[0]);
  // Set row on the first record added.
  this.setCursorPos({rowId: addRowIds[0]});
  // Highlight inserted area (if we inserted rows in correct order)
  if (addRowIds.every((r, i) => r === this.viewData.getRowId(topRowIndex + i))) {
    this.cellSelector.selectArea(topRowIndex, 0,
      topRowIndex + addRowIds.length - 1, this.viewSection.viewFields().peekLength - 1);
  }
}

GridView.prototype._clearCopySelection = function() {
  this.copySelection(null);
};

GridView.prototype._showTooltipOnHover = function(field, isShowingTooltip) {
  return [
    kd.toggleClass("hover-column", isShowingTooltip),
    dom.on('mouseenter', () => {
      this.changeHover(field._index());
    }),
    dom.on('mousedown', (ev) => {
      if (isShowingTooltip()) {
        ev.preventDefault();
      }
    }),
  ];
};

GridView.prototype._scrollColumnIntoView = function(colIndex) {
  // If there are some frozen columns.
  if (this.numFrozen.peek() && colIndex < this.numFrozen.peek()) { return; }

  if (colIndex === 0) {
    this.scrollPaneLeft();
  } else if (colIndex === this.viewSection.viewFields().peekLength - 1) {
    this.scrollPaneRight();
  } else {
    const offset = this.colRightOffsets.peek().getSumTo(colIndex);

    const rowNumsWidth = this._cornerDom.clientWidth;
    const viewWidth = this.scrollPane.clientWidth - rowNumsWidth;
    const fieldWidth = this.colRightOffsets.peek().getValue(colIndex) + 1; // +1px border

    // Left and right pixel edge of 'viewport', starting from edge of row nums.
    const frozenWidth = this.frozenWidth.peek();
    const leftEdge = this.scrollPane.scrollLeft + frozenWidth;
    const rightEdge = leftEdge + (viewWidth - frozenWidth);

    // If cell doesn't fit onscreen, scroll to fit.
    const scrollShift = offset - gutil.clamp(offset, leftEdge, rightEdge - fieldWidth);
    this.scrollPane.scrollLeft = this.scrollPane.scrollLeft + scrollShift;
  }
}

/**
 * Attaches the Add Column menu.
 *
 * The menu can be triggered in two ways, depending on the presence of a `field`
 * in `options`.
 *
 * If a field is present, the menu is triggered only when `_insertColumnIndex` is set
 * to the index of the field the menu is attached to.
 *
 * If a field is not present, the menu is triggered either when `_insertColumnIndex`
 * is set to `-1` or when the attached element is clicked. In practice, there will
 * only be one element attached this way: the "+" field, which appears at the end of
 * the GridView.
 */
GridView.prototype._buildInsertColumnMenu = function(options = {}) {
  const {field} = options;
  const triggers = [];
  if (!field) { triggers.push('click'); }

  return [
    field ? kd.toggleClass('field-insert-before', () =>
      this._insertColumnIndex() === field._index()) : null,
    menu(
      ctl => {
        ctl.onDispose(() => this._insertColumnIndex(null));

        let index = this._insertColumnIndex.peek();
        if (index === null || index === -1) {
          index = undefined;
        }

        return [
          buildAddColumnMenu(this, index),
          elem => { FocusLayer.create(ctl, {defaultFocusElem: elem, pauseMousetrap: true}); },
          testId('new-columns-menu'),
        ];
      },
      {
        modifiers: {
          offset: {
            offset: '8,8',
          },
        },
        selectOnOpen: true,
        trigger: [
          ...triggers,
          (_, ctl) => {
            ctl.autoDispose(this._insertColumnIndex.subscribe((index) => {
              if (field?._index() === index || (!field && index === -1)) {
                ctl.open();
              } else if (!ctl.isDisposed()) {
                ctl.close();
              }
            }));
          },
        ],
      }
    ),
  ];
}

GridView.prototype._openInsertColumnMenu = function(columnIndex) {
  if (columnIndex < this.viewSection.viewFields().peekLength) {
    this._scrollColumnIntoView(columnIndex);
    this._insertColumnIndex(columnIndex);
  } else {
    this.scrollPaneRight();
    this._insertColumnIndex(-1);
  }
}

function buildStyleOption(owner, computedRule, optionName) {
  return ko.computed(() => {
    if (owner.isDisposed()) { return null; }
    const rule = computedRule();
    if (!rule || !rule.style) { return ''; }
    return rule.style[optionName] || '';
  });
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

// Simple function that calculates good color for zebra stripes.
function calcZebra(hex) {
  if (!hex || hex.length !== 7) { return hex; }
  // HSL: [HUE, SATURATION, LIGHTNESS]
  const hsl = convert.hex.hsl(hex.substr(1));
  // For bright color, we will make it darker. Value was picked by hand, to
  // produce #f8f8f8f out of #ffffff.
  if (hsl[2] > 50) { hsl[2] -= 2.6; }
  // For darker color, we will make it brighter. Value was picked by hand to look
  // good for the darkest colors in our palette.
  else if (hsl[2] > 1) { hsl[2] += 11; }
  // For very dark colors
  else { hsl[2] += 16; }
  return `#${convert.hsl.hex(hsl)}`;
}

module.exports = GridView;
