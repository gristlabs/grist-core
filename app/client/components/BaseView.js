var _ = require('underscore');
var ko = require('knockout');
var moment = require('moment-timezone');
var {getSelectionDesc} = require('app/common/DocActions');
var {nativeCompare, roundDownToMultiple, waitObs} = require('app/common/gutil');
var gristTypes = require('app/common/gristTypes');
var koUtil = require('../lib/koUtil');
var tableUtil = require('../lib/tableUtil');
var {DataRowModel} = require('../models/DataRowModel');
var {DynamicQuerySet} = require('../models/QuerySet');
var {SortFunc} = require('app/common/SortFunc');
var rowset = require('../models/rowset');
var Base = require('./Base');
var {Cursor} = require('./Cursor');
var FieldBuilder = require('../widgets/FieldBuilder');
var commands = require('./commands');
var BackboneEvents = require('backbone').Events;
const {LinkingState} = require('./LinkingState');
const {ClientColumnGetters} = require('app/client/models/ClientColumnGetters');
const {reportError, reportSuccess} = require('app/client/models/errors');
const {urlState} = require('app/client/models/gristUrlState');
const {SectionFilter} = require('app/client/models/SectionFilter');
const {copyToClipboard} = require('app/client/lib/copyToClipboard');
const {setTestState} = require('app/client/lib/testState');
const {ExtraRows} = require('app/client/models/DataTableModelWithDiff');
const {createFilterMenu} = require('app/client/ui/ColumnFilterMenu');
const {LinkConfig} = require('app/client/ui/selectBy');
const {encodeObject} = require("app/plugin/objtypes");

/**
 * BaseView forms the basis for ViewSection classes.
 * @param {Object} viewSectionModel - The model for the viewSection represented.
 * @param {Boolean} options.isPreview - Whether the view is a read-only preview (e.g. Importer view).
 * @param {Boolean} options.addNewRow - Whether to include an add row in the model.
 */
function BaseView(gristDoc, viewSectionModel, options) {
  Base.call(this, gristDoc);

  this.options = options || {};
  this.viewSection = viewSectionModel;
  this._name = this.viewSection.titleDef.peek();

  //--------------------------------------------------
  // Observable models mapped to the document

  // Instantiate the models for the view metadata and for the data itself.
  // The table should never change for a given view, so no need to watch the table() observable.
  this.schemaModel = this.viewSection.table();

  // Check if we are making a comparison with another document.
  this.comparison = this.gristDoc.comparison;

  // TODO: but accessing by tableId identifier may be problematic when the table is renamed.
  this.tableModel = this.gristDoc.getTableModelMaybeWithDiff(this.schemaModel.tableId());
  this.extraRows = new ExtraRows(this.schemaModel.tableId(), this.comparison && this.comparison.details);

  // We use a DynamicQuerySet as the underlying RowSource, with ColumnFilters applies on top of
  // it. It filters based on section linking, re-querying as needed in case of onDemand tables.
  this._queryRowSource = DynamicQuerySet.create(this, gristDoc.querySetManager, this.tableModel);

  // When we have a summary table, filter out rows corresponding to empty groups.
  // (TODO this may be better implemented by deleting empty groups in the data engine.)
  if (this.viewSection.table().summarySourceTable()) {
    const groupGetter = this.tableModel.tableData.getRowPropFunc('group');
    this._mainRowSource = rowset.BaseFilteredRowSource.create(this,
      rowId => !gristTypes.isEmptyList(groupGetter(rowId)));
    this._mainRowSource.subscribeTo(this._queryRowSource);
  } else {
    this._mainRowSource = this._queryRowSource;
  }

  if (this.comparison) {
    // Assign extra row ids for any rows added in the remote (right) table or removed in the
    // local (left) table.
    const extraRowIds = this.extraRows.getExtraRows();
    this._mainRowSource = rowset.ExtendedRowSource.create(this, this._mainRowSource, extraRowIds);
  }

  // Create a section filter and a filtered row source that subscribes to its changes.
  // `sectionFilter` also provides an `addTemporaryRow()` to allow views to display newly inserted rows,
  // and `setFilterOverride()` to allow controlling a filter from a column menu.
  this._sectionFilter = SectionFilter.create(this, this.viewSection, this.tableModel.tableData);
  this._filteredRowSource = rowset.FilteredRowSource.create(this, this._sectionFilter.sectionFilterFunc.get());
  this._filteredRowSource.subscribeTo(this._mainRowSource);
  this.autoDispose(this._sectionFilter.sectionFilterFunc.addListener(filterFunc => {
    this._filteredRowSource.updateFilter(filterFunc);
  }));

  // Sorted collection of all rows to show in this view.
  this.sortedRows = rowset.SortedRowSet.create(this, null, this.tableModel.tableData);

  // Re-sort when sortSpec changes.
  this.sortFunc = new SortFunc(new ClientColumnGetters(this.tableModel, {unversioned: true}));
  this.autoDispose(this.viewSection.activeDisplaySortSpec.subscribeInit(function(spec) {
    this.sortFunc.updateSpec(spec);
    this.sortedRows.updateSort((rowId1, rowId2) => {
      var value = nativeCompare(rowId1 === "new", rowId2 === "new");
      return value || this.sortFunc.compare(rowId1, rowId2);
    });
  }, this));

  // Here we are subscribed to the bulk of the data (main table, possibly filtered).
  this.sortedRows.subscribeTo(this._filteredRowSource);

  // We create a special one-row RowSource for the "Add new" row, in case we need it.
  this.newRowSource = rowset.RowSource.create(this);
  this.newRowSource.getAllRows = function() { return ['new']; };

  // This is the LazyArrayModel containing DataRowModels, for rendering, e.g. with scrolly.
  this.viewData = this.autoDispose(this.tableModel.createLazyRowsModel(this.sortedRows));

  // Floating row model that is not destroyed when the row is scrolled out of view. It must be
  // assigned manually to a rowId. Additionally, we override the saving of field values with a
  // custom method that handles better positioning of cursor on adding a new row.
  this.editRowModel = this.autoDispose(this.tableModel.createFloatingRowModel());
  this.editRowModel._saveField =
    (colName, value) => this._saveEditRowField(this.editRowModel, colName, value);

  // Reset heights of rows when there is an action that affects them.
  this.listenTo(this.viewData, 'rowModelNotify', rowModels => this.onRowResize(rowModels));

  this.listenTo(this.viewSection.events, 'rowHeightChange', this.onResize );

  // Create a command group for keyboard shortcuts common to all views.
  this.autoDispose(commands.createGroup(BaseView.commonCommands, this, this.viewSection.hasFocus));

  //--------------------------------------------------
  // Prepare logic for linking with other sections.

  // Linking state maintains .filterFunc and .cursorPos observables which we use for
  // auto-scrolling and filtering.
  this._linkingState = this.autoDispose(koUtil.computedBuilder(() => {
    let v = this.viewSection;
    let src = v.linkSrcSection();
    if (!src.getRowId()) {
      return null;
    }
    try {
      const config = new LinkConfig(v);
      return LinkingState.create.bind(LinkingState, null, this.gristDoc, config);
    } catch (err) {
      console.warn(`Can't create LinkingState: ${err.message}`);
      return null;
    }
  }));

  this._linkingFilter = this.autoDispose(ko.computed(() => {
    const linking = this._linkingState();
    const result = linking && linking.filterColValues ? linking.filterColValues() : {filters: {}};
    result.operations = result.operations || {};
    for (const key in result.filters) {
      result.operations[key] = result.operations[key] || 'in';
    }
    return result;
  }));

  // A computed for the rowId of the row selected by section linking.
  this.linkedRowId = this.autoDispose(ko.computed(() => {
    let linking = this._linkingState();
    return linking && linking.cursorPos ? linking.cursorPos() : null;
  }).extend({deferred: true}));

  // Update the cursor whenever linkedRowId() changes.
  this.autoDispose(this.linkedRowId.subscribe(rowId => this.setCursorPos({rowId})));

  // Indicated whether editing the section should be disabled given the current linking state.
  this.disableEditing = this.autoDispose(ko.computed(() => {
    const linking = this._linkingState();
    return linking && linking.disableEditing();
  }));

  this.isPreview = this.options.isPreview;

  this.enableAddRow = this.autoDispose(ko.computed(() => this.options.addNewRow &&
    !this.viewSection.disableAddRemoveRows() && !this.disableEditing()));

  // Hide the add row if editing is disabled via filter linking.
  this.autoDispose(this.enableAddRow.subscribeInit(_enableAddRow => {
    if (_enableAddRow) {
      this.sortedRows.subscribeTo(this.newRowSource);
    } else {
      this.sortedRows.unsubscribeFrom(this.newRowSource);
    }
  }));

  //--------------------------------------------------
  // Observables local to this view
  this._isLoading = ko.observable(true);
  this._pendingCursorPos = this.viewSection.lastCursorPos;

  // Initialize the cursor with the previous cursor position indicies, if they exist.
  console.log("%s BaseView viewSection %s (%s) lastCursorPos %s", this._debugName, this.viewSection.getRowId(),
    this.viewSection.table().tableId(), JSON.stringify(this.viewSection.lastCursorPos));
  this.cursor = this.autoDispose(Cursor.create(null, this, this.viewSection.lastCursorPos));

  this.currentColumn = this.autoDispose(ko.pureComputed(() =>
    this.viewSection.viewFields().at(this.cursor.fieldIndex()).column()
  ).extend({rateLimit: 0}));     // TODO Test this without the rateLimit

  this.currentEditingColumnIndex = ko.observable(-1);

  // A koArray of FieldBuilder objects, one for each view-section field.
  this.fieldBuilders = this.autoDispose(
    FieldBuilder.createAllFieldWidgets(this.gristDoc, this.viewSection.viewFields, this.cursor, {
      isPreview: this.isPreview,
    })
  );

  // An observable evaluating to the FieldBuilder for the field where the cursor is.
  this.activeFieldBuilder = this.autoDispose(ko.pureComputed(() =>
    this.fieldBuilders.at(this.cursor.fieldIndex())
  ));

  // Observable for whether the data in this view is truncated, i.e. not all rows are included
  // (this can only be true for on-demand tables).
  this.isTruncated = ko.observable(false);

  // This computed's purpose is the side-effect of calling makeQuery() initially and when any
  // dependency changes.
  this.autoDispose(ko.computed(() => {
    this._isLoading(true);
    const linkingFilter = this._linkingFilter();
    this._queryRowSource.makeQuery(linkingFilter.filters, linkingFilter.operations, (err) => {
      if (this.isDisposed()) { return; }
      if (err) { reportError(err); }
      this.onTableLoaded();
    });
  }));

  // Reset cursor to the first row when filtering changes.
  this.autoDispose(this._linkingFilter.subscribe((x) => this.onLinkFilterChange()));

  // When sorting changes, reset the cursor to the first row. (The alternative of moving the
  // cursor to stay at the same record is sometimes better, but sometimes more annoying.)
  this.autoDispose(this.viewSection.activeSortSpec.subscribe(() => this.setCursorPos({rowIndex: 0})));

  this.copySelection = ko.observable(null);

  // Whether parts needed for printing should be rendered now.
  this._isPrinting = ko.observable(false);
}
Base.setBaseFor(BaseView);
_.extend(Base.prototype, BackboneEvents);

/**
 * These commands are common to GridView and DetailView.
 */
BaseView.commonCommands = {
  input: function(input) { this.activateEditorAtCursor({init: input}); },
  editField: function() { this.activateEditorAtCursor(); },

  insertRecordBefore: function() { this.insertRow(this.cursor.rowIndex()); },
  insertRecordAfter: function() { this.insertRow(this.cursor.rowIndex() + 1); },

  insertCurrentDate: function() { this.insertCurrentDate(false); },
  insertCurrentDateTime: function() { this.insertCurrentDate(true); },

  copyLink: function() { this.copyLink().catch(reportError); },
};

/**
 * Sets the cursor to the given position, deferring if necessary until the current query finishes
 * loading.
 */
BaseView.prototype.setCursorPos = function(cursorPos) {
  if (!this._isLoading.peek()) {
    this.cursor.setCursorPos(cursorPos);
  } else {
    // This is the first step; the second happens in onTableLoaded.
    this._pendingCursorPos = cursorPos;
    this.cursor.setLive(false);
  }
};

/**
 * Returns a promise that's resolved when the query being loaded finishes loading.
 * If no query is being loaded, it will resolve immediately.
 */
BaseView.prototype.getLoadingDonePromise = function() {
  return waitObs(this._isLoading, (value) => !value);
};

/**
 * Start editing the selected cell.
 * @param {String} input: If given, initialize the editor with the given input (rather than the
 *    original content of the cell).
 */
BaseView.prototype.activateEditorAtCursor = function(options) {
  var builder = this.activeFieldBuilder();
  if (builder.isEditorActive()) {
    return;
  }
  var rowId = this.viewData.getRowId(this.cursor.rowIndex());
  // LazyArrayModel row model which is also used to build the cell dom. Needed since
  // it may be used as a key to retrieve the cell dom, which is useful for editor placement.
  var lazyRow = this.getRenderedRowModel(rowId);
  if (!lazyRow) {
    // TODO scroll into view. For now, just don't activate the editor.
    return;
  }
  this.editRowModel.assign(rowId);
  builder.buildEditorDom(this.editRowModel, lazyRow, options || {});
};

/**
 * Move the floating RowModel for editing to the current cursor position, and return it.
 *
 * This is used for opening the formula editor in the side panel; the current row is used to get
 * possible exception info from the formula.
 */
BaseView.prototype.moveEditRowToCursor = function() {
  var rowId = this.viewData.getRowId(this.cursor.rowIndex());
  this.editRowModel.assign(rowId);
  return this.editRowModel;
};

// Copy an anchor link for the current row to the clipboard.
BaseView.prototype.copyLink = async function() {
  const rowId = this.viewData.getRowId(this.cursor.rowIndex());
  const colRef = this.viewSection.viewFields().peek()[this.cursor.fieldIndex()].colRef();
  const sectionId = this.viewSection.getRowId();
  try {
    const link = urlState().makeUrl({ hash: { sectionId, rowId, colRef } });
    await copyToClipboard(link);
    setTestState({clipboard: link});
    reportSuccess('Link copied to clipboard', {key: 'clipboard'});
  } catch (e) {
    throw new Error('cannot copy to clipboard');
  }
};

/**
 * Insert a new row immediately before the row at the given index if given an Integer. Otherwise
 * insert a new row at the end.
 */
BaseView.prototype.insertRow = function(index) {
  if (this.viewSection.disableAddRemoveRows() || this.disableEditing()) {
    return;
  }
  var rowId = this.viewData.getRowId(index);
  var insertPos = Number.isInteger(rowId) ?
    this.tableModel.tableData.getValue(rowId, 'manualSort') : null;

  return this.sendTableAction(['AddRecord', null, { 'manualSort': insertPos }])
  .then(rowId => {
    if (!this.isDisposed()) {
      this._sectionFilter.addTemporaryRow(rowId);
      this.setCursorPos({rowId});
    }
    return rowId;
  });
};

/**
 * Given a 2-d paste column-oriented paste data and target cols, transform the data to omit
 * fields that shouldn't be pasted over and extract rich paste data if available.
 * @param {Array<Array<(RichPasteObject|string)>>} data - Column-oriented 2-d array of either
 *    plain strings or rich paste data returned by `tableUtil.parsePasteHtml` with `displayValue`
 *    and, optionally, `colType` and `rawValue` attributes.
 * @param {Array<MetaRowModel>} cols - Array of target column objects
 * @returns {Object} - Object mapping colId to array of column values, suitable for use in Bulk
 *                     actions.
 */
BaseView.prototype._parsePasteForView = function(data, fields) {
  const updateCols = fields.map(field => {
    const col = field && field.column();
    if (col && !col.isRealFormula() && !col.disableEditData()) {
      return col;
    } else {
      return null; // Don't include formulas and missing columns
    }
  });
  const updateColIds = updateCols.map(c => c && c.colId());
  const updateColTypes = updateCols.map(c => c && c.type());
  const parsers = fields.map(field => field && field.createValueParser() || (x => x));
  const docIdHash = tableUtil.getDocIdHash();

  const richData = data.map((col, idx) => {
    if (!col.length) {
      return col;
    }
    const typeMatches = col[0] && col[0].colType === updateColTypes[idx] && (
        // When copying references, only use the row ID (raw value) when copying within the same document
        // to avoid referencing the wrong rows.
        col[0].docIdHash === docIdHash || !gristTypes.isFullReferencingType(updateColTypes[idx])
    );
    const parser = parsers[idx];
    return col.map(v => {
      if (v) {
        if (typeMatches && v.hasOwnProperty('rawValue')) {
          return v.rawValue;
        }
        if (v.hasOwnProperty('displayValue')) {
          return parser(v.displayValue);
        }
        if (typeof v === "string") {
          return parser(v);
        }
      }
      return v;
    });
  });

  return _.omit(_.object(updateColIds, richData), null);
};

BaseView.prototype._getDefaultColValues = function() {
  const {filters, operations} = this._linkingFilter.peek();
  return _.mapObject(
      _.pick(filters, (value, key) => value.length > 0 && key !== "id"),
      (value, key) => operations[key] === "intersects" ? encodeObject(value) : value[0]
  );
};

/**
 * Enhances [Bulk]AddRecord actions to include the default values determined by the current
 * section-linking filter.
 */
BaseView.prototype._enhanceAction = function(action) {
  if (action[0] === 'AddRecord' || action[0] === 'BulkAddRecord') {
    let colValues = this._getDefaultColValues();
    let rowIds = action[1];
    if (action[0] === 'BulkAddRecord') {
      colValues = _.mapObject(colValues, v => rowIds.map(() => v));
    }
    Object.assign(colValues, action[2]);
    return [action[0], rowIds, colValues];
  } else {
    return action;
  }
};

/**
 * Enhances a list of table actions and turns them from implicit-table actions into
 * proper actions.
 */
BaseView.prototype.prepTableActions = function(actions) {
  actions = actions.map(a => this._enhanceAction(a));
  actions.forEach(action_ => {
    action_.splice(1, 0, this.tableModel.tableData.tableId);
  });
  return actions;
};

/**
 * Shortcut for `.tableModel.tableData.sendTableActions`, which also sets default values
 * determined by the current section-linking filter, if any.
 */
BaseView.prototype.sendTableActions = function(actions, optDesc) {
  return this.tableModel.sendTableActions(actions.map(a => this._enhanceAction(a)), optDesc);
};


/**
 * Shortcut for `.tableModel.tableData.sendTableAction`, which also sets default values
 * determined by the current section-linking filter, if any.
 */
BaseView.prototype.sendTableAction = function(action, optDesc) {
  return action ? this.tableModel.sendTableAction(this._enhanceAction(action), optDesc) : null;
};


/**
 * Inserts the current date/time into the selected cell if the cell is of a compatible type
 * (Text/Date/DateTime/Any).
 * @param {Boolean} withTime: Whether to include the time in addition to the date. This is ignored
 *    for Date columns (assumed false) and for DateTime (assumed true).
 */
BaseView.prototype.insertCurrentDate = function(withTime) {
  let column = this.currentColumn();
  if (column.isRealFormula()) {
    // Ignore the shortcut when in a formula column.
    return;
  }
  let type = column.pureType();
  let value, now = Date.now();
  const docTimezone = this.gristDoc.docInfo.timezone.peek();
  if (type === 'Text' || type === 'Any') {
    // Use document timezone. Don't forget to use uppercase HH for 24-hour time.
    value = moment.tz(now, docTimezone).format('YYYY-MM-DD' + (withTime ? ' HH:mm:ss' : ''));
  } else if (type === 'Date') {
    // Get UTC midnight for the current date (as seen in docTimezone). This is a bit confusing. If
    // it's "2019-11-14 23:30 -05:00", then it's "2019-11-15 04:30" in UTC. Since we measure time
    // from Epoch UTC, we want the UTC time to have the correct date, so need to add the offset
    // (-05:00) to get "2019-11-14 23:30" in UTC, and then round down to midnight.
    const offsetMinutes = moment.tz(now, docTimezone).utcOffset();
    value = roundDownToMultiple(now / 1000 + offsetMinutes * 60, 24*3600);
  } else if (type === 'DateTime') {
    value = now / 1000;
  } else {
    // Ignore the shortcut when in a column of an inappropriate type.
    return;
  }
  var rowId = this.viewData.getRowId(this.cursor.rowIndex());
  this.editRowModel.assign(rowId);
  this.editRowModel[column.colId()].setAndSave(value);
};


/**
 * Override the saving of field values to add some extra processing:
 * - If a new row is saved, then we may need to adjust the row where the cursor is.
 * - We add the edited or added row to ensure it's displayed regardless of current columnFilters.
 * - We change the main view's row observables to see the new value immediately.
 * TODO: When saving a formula in the addRow, the cursor moves down instead of staying in place.
 *       To fix that behavior, propose to factor out the `isAddRow` overrides from here
 *       into a `setNewRowColValues` on the editRowModel and have `FieldBuilder._saveEdit` call
 *       that instead of `updateColValues`.
 */
BaseView.prototype._saveEditRowField = function(editRowModel, colName, value) {
  if (editRowModel._isAddRow.peek()) {
    this.cursor.setLive(false);
    const colValues = this._getDefaultColValues();
    colValues[colName] = value;

    return editRowModel.updateColValues(colValues)
    // Once we know the new row's rowId, add it to column filters to make sure it's displayed.
    .then(rowId => {
      if (!this.isDisposed()) {
        this._sectionFilter.addTemporaryRow(rowId);
        this.setCursorPos({rowId});
      }
      return rowId;
    })
    .finally(() => !this.isDisposed() && this.cursor.setLive(true));
  } else {
    var rowId = editRowModel.getRowId();
    // We are editing the floating "edit" rowModel, but to ensure that we see data in the main view
    // (when the editor closes), we immediately update the main view's rowModel, if such exists.
    var mainRowModel = this.getRenderedRowModel(rowId);
    if (mainRowModel) {
      mainRowModel[colName](value);
    }
    const ret = DataRowModel.prototype._saveField.call(editRowModel, colName, value)
      // Display this rowId, even if it doesn't match the filter
      .then((result) => {
        if (!this.isDisposed()) {
          this._sectionFilter.addTemporaryRow(rowId);
        }
        return result;
      })
      .finally(() => !this.isDisposed() && mainRowModel && mainRowModel._assignColumn(colName));
    return this.viewSection.isSorted() ? ret : null;
    // Do not return the saveField call in the case that the column is unsorted: in this case,
    // we assumes optimistically that the action is successful and browser events can
    // continue being processed immediately without waiting.
    // When sorted, we wait on the saveField call so we may determine where the row ends
    // up for cursor movement purposes.
  }
};

/**
 * Uses the current cursor selection to return a rich paste object with a reference to the data,
 * and the selection ranges.  See CopySelection.js
 *
 * @returns {pasteObj} - Paste object
 */
BaseView.prototype.copy = function(selection) {
  this.copySelection(selection);

  return {
    data: this.tableModel.tableData,
    selection: selection
  };
};

/**
 * Uses the current cursor selection to return a rich paste object with a reference to the data,
 * the selection ranges and a callback that when called performs all of the actions needed for a cut.
 *
 * @returns {pasteObj} - Paste object
 */
BaseView.prototype.cut = function(selection) {
  this.copySelection(selection);

  return {
    data: this.tableModel.tableData,
    selection: selection,
    cutCallback: () => tableUtil.makeDeleteAction(selection)
  };
};

/**
 * Helper to send paste actions from the cutCallback and a list of paste actions.
 */
BaseView.prototype.sendPasteActions = function(cutCallback, actions) {
  let cutAction = null;
  // If this is a cut -> paste, add the cut action and a description.
  if (cutCallback) {
    cutAction = cutCallback();
    // If the cut occurs on an edit restricted cell, there may be no cut action.
    if (cutAction) { actions.unshift(cutAction); }
  }
  return this.gristDoc.docData.sendActions(actions,
    this._getPasteDesc(actions[actions.length - 1], cutAction));
};

/**
 * Returns a string which describes a cut/copy action.
 */
BaseView.prototype._getPasteDesc = function(pasteAction, optCutAction) {
  if (optCutAction) {
    return `Moved ${getSelectionDesc(optCutAction, true)} to ` +
      `${getSelectionDesc(pasteAction, true)}.`;
  } else {
    return `Pasted data to ${getSelectionDesc(pasteAction, true)}.`;
  }
};

BaseView.prototype.buildDom = function() {
  throw new Error("Not Implemented");
};

/**
 * Called by ViewLayout to return view-specific controls to add into its ViewSection's title bar.
 * By default builds nothing. Derived views may override.
 */
BaseView.prototype.buildTitleControls = function() {
  return null;
};

/**
 * Called when table data gets loaded (if already loaded, then called immediately after the
 * constructor). Derived views may override.
 */
BaseView.prototype.onTableLoaded = function() {
  // Complete the setting of a pending cursor position (see setCursorPos() for the first half).
  if (this._pendingCursorPos) {
    this.cursor.setCursorPos(this._pendingCursorPos);
    this._pendingCursorPos = null;
  }
  this._isLoading(false);
  this.isTruncated(this._queryRowSource.isTruncated);
  this.cursor.setLive(true);
};

/**
 * Called when view gets resized. Derived views may override.
 */
BaseView.prototype.onResize = function() {
};

/**
 * Called when rows have changed and may potentially need resizing. Derived views may override.
 * @param {Array<DataRowModel>} rowModels: Array of row models whose size may have changed.
 */
BaseView.prototype.onRowResize = function(rowModels) {
};

/**
 * Called when user selects a different row which drives the link-filtering of this section.
 */
BaseView.prototype.onLinkFilterChange = function(rowId) {
  this.setCursorPos({rowIndex: 0});
};

/**
 * Called before and after printing this section.
 */
BaseView.prototype.prepareToPrint = function(onOff) {
  this._isPrinting(onOff);
};

/**
 * Called to obtain the rowModel for the given rowId. Returns a rowModel if it belongs to the
 * section and is rendered, otherwise returns null.
 * Useful to tie a rendered row to the row being edited. Derived views may override.
 */
BaseView.prototype.getRenderedRowModel = function(rowId) {
  return this.viewData.getRowModel(rowId);
};

/**
 * Returns the index of the last non-AddNew row in the grid.
 */
BaseView.prototype.getLastDataRowIndex = function() {
  let last = this.viewData.peekLength - 1;
  return (last >= 0 && this.viewData.getRowId(last) === 'new') ? last - 1 : last;
};

/**
 * Creates and opens ColumnFilterMenu for a given field/column, and returns its PopupControl.
 */
BaseView.prototype.createFilterMenu = function(openCtl, filterInfo, onClose) {
  return createFilterMenu(openCtl, this._sectionFilter, filterInfo, this._mainRowSource,
    this.tableModel.tableData, onClose);
};

/**
 * Whether the rows shown by this view are a proper subset of all rows in the table.
 */
BaseView.prototype.isFiltered = function() {
  return this._filteredRowSource.getNumRows() < this.tableModel.tableData.numRecords();
};

/**
 * Makes sure that active record is in the view.
 */
BaseView.prototype.revealActiveRecord = function() {
  // to override
  return Promise.resolve();
};

module.exports = BaseView;
