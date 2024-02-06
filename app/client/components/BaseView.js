/* globals KeyboardEvent */

const _ = require('underscore');
const ko = require('knockout');
const moment = require('moment-timezone');
const {nativeCompare, roundDownToMultiple, waitObs} = require('app/common/gutil');
const gutil = require('app/common/gutil');
const MANUALSORT  = require('app/common/gristTypes').MANUALSORT;
const gristTypes = require('app/common/gristTypes');
const tableUtil = require('../lib/tableUtil');
const {DataRowModel} = require('../models/DataRowModel');
const {DynamicQuerySet} = require('../models/QuerySet');
const {SortFunc} = require('app/common/SortFunc');
const rowset = require('../models/rowset');
const Base = require('./Base');
const {getDefaultColValues} = require("./BaseView2");
const {Cursor} = require('./Cursor');
const FieldBuilder = require('../widgets/FieldBuilder');
const commands = require('./commands');
const BackboneEvents = require('backbone').Events;
const {ClientColumnGetters} = require('app/client/models/ClientColumnGetters');
const {reportError, reportSuccess} = require('app/client/models/errors');
const {urlState} = require('app/client/models/gristUrlState');
const {SectionFilter} = require('app/client/models/SectionFilter');
const {UnionRowSource} = require('app/client/models/UnionRowSource');
const {copyToClipboard} = require('app/client/lib/clipboardUtils');
const {setTestState} = require('app/client/lib/testState');
const {ExtraRows} = require('app/client/models/DataTableModelWithDiff');
const {createFilterMenu} = require('app/client/ui/ColumnFilterMenu');
const {closeRegisteredMenu} = require('app/client/ui2018/menus');
const {COMMENTS} = require('app/client/models/features');
const {DismissedPopup} = require('app/common/Prefs');
const {markAsSeen} = require('app/client/models/UserPrefs');
const {buildConfirmDelete, reportUndo} = require('app/client/components/modals');

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
  this._mainRowSource = this._queryRowSource;

  if (this.comparison) {
    // Assign extra row ids for any rows added in the remote (right) table or removed in the
    // local (left) table.
    const extraRowIds = this.extraRows.getExtraRows();
    this._mainRowSource = rowset.ExtendedRowSource.create(this, this._mainRowSource, extraRowIds);
  }

  // Rows that should temporarily be visible even if they don't match filters.
  // This is so that a newly added row doesn't immediately disappear, which would be confusing.
  this._exemptFromFilterRows = rowset.ExemptFromFilterRowSource.create(this);
  this._exemptFromFilterRows.subscribeTo(this.tableModel);

  // Create a section filter and a filtered row source that subscribes to its changes.
  // `sectionFilter` also provides `setFilterOverride()` to allow controlling a filter from a column menu.
  this._sectionFilter = SectionFilter.create(this, this.viewSection, this.tableModel.tableData);
  this._filteredRowSource = rowset.FilteredRowSource.create(this, this._sectionFilter.sectionFilterFunc.get());
  this._filteredRowSource.subscribeTo(this._mainRowSource);
  this.autoDispose(this._sectionFilter.sectionFilterFunc.addListener(filterFunc => {
    this._exemptFromFilterRows.reset();
    this._filteredRowSource.updateFilter(filterFunc);
  }));

  this.rowSource = UnionRowSource.create(this, [this._filteredRowSource, this._exemptFromFilterRows]);

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
  this.sortedRows.subscribeTo(this.rowSource);

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

  // A computed for the rowId of the row selected by section linking.
  this.linkedRowId = this.autoDispose(ko.computed(() => {
    let linking = this.viewSection.linkingState();
    return linking && linking.cursorPos ? linking.cursorPos() : null;
  }).extend({deferred: true}));

  // Update the cursor whenever linkedRowId() changes (but only if we have any linking).
  this.autoDispose(this.linkedRowId.subscribe(rowId => {
    if (this.viewSection.linkingState.peek()) {
      this.setCursorPos({rowId: rowId || 'new'}, true);
    }
  }));

  this.isLinkSource = this.autoDispose(ko.pureComputed(() => this.viewSection.linkedSections().all().length > 0));

  // Indicated whether editing the section should be disabled given the current linking state.
  this.disableEditing = this.autoDispose(ko.computed(() => {
    const linking = this.viewSection.linkingState();
    return linking && linking.disableEditing();
  }));

  this.isPreview = this.options.isPreview ?? false;

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

  // Initialize the cursor with the previous cursor position indices, if they exist.
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

  // By default, a view doesn't support selectedColumns, but it can be overridden.
  this.selectedColumns = null;

  // Observable for whether the data in this view is truncated, i.e. not all rows are included
  // (this can only be true for on-demand tables).
  this.isTruncated = ko.observable(false);

  // This computed's purpose is the side-effect of calling makeQuery() initially and when any
  // dependency changes.
  this.autoDispose(ko.computed(() => {
    this._isLoading(true);
    const linkingFilter = this.viewSection.linkingFilter();
    this._queryRowSource.makeQuery(linkingFilter.filters, linkingFilter.operations, (err) => {
      if (this.isDisposed()) { return; }
      if (err) { reportError(err); }
      this._exemptFromFilterRows.reset();
      this.onTableLoaded();
    });
  }));

  // Reset cursor to the first row when filtering changes.
  this.autoDispose(this.viewSection.linkingFilter.subscribe((x) => this.onLinkFilterChange()));

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
  input: function(init) {
    this.scrollToCursor(true).catch(reportError);
    this.activateEditorAtCursor({init});
  },
  editField: function(event) { closeRegisteredMenu(); this.scrollToCursor(true); this.activateEditorAtCursor({event}); },

  insertRecordBefore: function() { this.insertRow(this.cursor.rowIndex()); },
  insertRecordAfter: function() { this.insertRow(this.cursor.rowIndex() + 1); },

  insertCurrentDate: function() { this.insertCurrentDate(false); },
  insertCurrentDateTime: function() { this.insertCurrentDate(true); },

  copyLink: function() { this.copyLink().catch(reportError); },

  deleteRecords: function(source) { this.deleteRecords(source); },

  filterByThisCellValue: function() { this.filterByThisCellValue(); },
  duplicateRows: function() { this._duplicateRows().catch(reportError); },
  openDiscussion: function() { this.openDiscussionAtCursor(); },
  viewAsCard: function() {
    /* Overridden by subclasses.
     *
     * This is still needed so that <space> doesn't trigger the `input` command
     * if a subclass doesn't support opening the current record as a card. */
  },
};

BaseView.prototype.selectedRows = function() {
  return [];
};

BaseView.prototype.deleteRows = function(rowIds) {
  return this.tableModel.sendTableAction(['BulkRemoveRecord', rowIds]);
};

BaseView.prototype.deleteRecords = function(source) {
  const rowIds = this.selectedRows();
  if (this.viewSection.disableAddRemoveRows() || rowIds.length === 0){
    return;
  }
  const isKeyboard = source instanceof KeyboardEvent;
  const popups = this.gristDoc.docPageModel.appModel.dismissedPopups;
  const popupName = DismissedPopup.check('deleteRecords');
  const onSave = async (remember) => {
    if (remember) {
      markAsSeen(popups, popupName);
    }
    return this.deleteRows(rowIds);
  };
  if (isKeyboard && !popups.get().includes(popupName)) {
    // If we can't find it, use viewPane itself
    this.scrollToCursor();
    const selectedCell = this.viewPane.querySelector(".selected_cursor") || this.viewPane;
    buildConfirmDelete(selectedCell, onSave, rowIds.length <= 1);
  } else {
    onSave().then(() => {
      if (!this.isDisposed()) {
        reportUndo(this.gristDoc, `You deleted ${rowIds.length} row${rowIds.length > 1 ? 's' : ''}.`);
      }
      return true;
    });
  }
};

/**
 * Sets the cursor to the given position, deferring if necessary until the current query finishes
 * loading. isFromLink will be set when called as result of cursor linking(see Cursor.setCursorPos for info)
 */
BaseView.prototype.setCursorPos = function(cursorPos, isFromLink = false) {
  if (this.isDisposed()) {
    return;
  }
  if (!this._isLoading.peek()) {
    this.cursor.setCursorPos(cursorPos, isFromLink);
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
 * Opens discussion panel at the cursor position. Returns true if discussion panel was opened.
 */
 BaseView.prototype.openDiscussionAtCursor = function(id) {
  if (!COMMENTS().get()) { return false; }
  var builder = this.activeFieldBuilder();
  if (builder.isEditorActive()) {
    return false;
  }
  var rowId = this.viewData.getRowId(this.cursor.rowIndex());
  // LazyArrayModel row model which is also used to build the cell dom. Needed since
  // it may be used as a key to retrieve the cell dom, which is useful for editor placement.
  var lazyRow = this.getRenderedRowModel(rowId);
  if (!lazyRow) {
    // TODO scroll into view. For now, just don't start discussion.
    return false;
  }
  this.editRowModel.assign(rowId);
  builder.buildDiscussionPopup(this.editRowModel, lazyRow, id);
  return true;
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

// Get an anchor link for the current cell and a given view section to the clipboard.
BaseView.prototype.getAnchorLinkForSection = function(sectionId) {
  const rowId = this.viewData.getRowId(this.cursor.rowIndex())
      // If there are no visible rows (happens in some widget linking situations),
      // pick an arbitrary row which will hopefully be close to the top of the table.
      || this.tableModel.tableData.findMatchingRowId({})
      // If there are no rows at all, return the 'new record' row ID.
      // Note that this case only happens in combination with the widget linking mentioned.
      // If the table is empty but the 'new record' row is selected, the `viewData.getRowId` line above works.
      || 'new';
  // The `fieldIndex` will be null if there are no visible columns.
  const fieldIndex = this.cursor.fieldIndex.peek();
  const field = fieldIndex !== null ? this.viewSection.viewFields().peek()[fieldIndex] : null;
  const colRef = field?.colRef.peek();
  const linkingRowIds = sectionId ? this.gristDoc.getLinkingRowIds(sectionId) : undefined;
  return {hash: {sectionId, rowId, colRef, linkingRowIds}};
}

// Copy an anchor link for the current row to the clipboard.
BaseView.prototype.copyLink = async function() {
  const sectionId = this.viewSection.getRowId();
  const anchorUrlState = this.getAnchorLinkForSection(sectionId);
  try {
    const link = urlState().makeUrl(anchorUrlState);
    await copyToClipboard(link);
    setTestState({clipboard: link});
    reportSuccess('Link copied to clipboard', {key: 'clipboard'});
  } catch (e) {
    throw new Error('cannot copy to clipboard');
  }
};

BaseView.prototype.filterByThisCellValue = function() {
  const rowId = this.viewData.getRowId(this.cursor.rowIndex());
  const col = this.viewSection.viewFields().peek()[this.cursor.fieldIndex()].column();
  let value = this.tableModel.tableData.getValue(rowId, col.colId.peek());

  // This mimics the logic in ColumnFilterMenu.addCountsToMap
  // ChoiceList and Reflist values get 'flattened' out so we filter by each element within.
  // In any other column type, complex values (even lists) get converted to JSON.
  let filterValues;
  const colType = col.type.peek();
  if (gristTypes.isList(value) && gristTypes.isListType(colType)) {
    filterValues = value.slice(1);
    if (!filterValues.length) {
      // If the list is empty, filter instead by an empty value for the whole list
      filterValues = [colType === "ChoiceList" ? "" : null];
    }
  } else {
    if (Array.isArray(value)) {
      value = JSON.stringify(value);
    }
    filterValues = [value];
  }
  this.viewSection.setFilter(col.getRowId(), {filter: JSON.stringify({included: filterValues})});
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
      this._exemptFromFilterRows.addExemptRow(rowId);
      this.setCursorPos({rowId});
    }
    return rowId;
  });
};

BaseView.prototype._getDefaultColValues = function() {
  return getDefaultColValues(this.viewSection);
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
        this._exemptFromFilterRows.addExemptRow(rowId);
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
      // Display this rowId, even if it doesn't match the filter,
      // unless the filter is on a Bool column
      .then((result) => {
        if (!this.isDisposed() && this.currentColumn().pureType() !== 'Bool') {
          this._exemptFromFilterRows.addExemptRow(rowId);
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
  // Clear the previous copy selection, if any.
  commands.allCommands.clearCopySelection.run();

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
  // Clear the previous copy selection, if any.
  commands.allCommands.clearCopySelection.run();

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
  return this.gristDoc.docData.sendActions(actions);
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
  // If this section is linked, go to the first row as the row previously selected may no longer
  // be visible.
  if (this.viewSection.linkingState.peek()) {
    this.setCursorPos({rowIndex: 0});
  }
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
BaseView.prototype.createFilterMenu = function(openCtl, filterInfo, options) {
  const {showAllFiltersButton, onClose} = options;
  return createFilterMenu({
    openCtl,
    sectionFilter: this._sectionFilter,
    filterInfo,
    rowSource: this._mainRowSource,
    tableData: this.tableModel.tableData,
    gristDoc: this.gristDoc,
    showAllFiltersButton,
    onClose,
  });
};

/**
 * Whether the rows shown by this view are a proper subset of all rows in the table.
 */
BaseView.prototype.isFiltered = function() {
  return this._filteredRowSource.getNumRows() < this.tableModel.tableData.numRecords();
};

/**
 * Makes sure that active record is in the view.
 * @param {Boolean} sync If the scroll should be performed synchronously. For typing we should scroll synchronously,
 * for other cases asynchronously as there might be some other operations pending (see doScrollChildIntoView in koDom).
 */
BaseView.prototype.scrollToCursor = function() {
  // to override
  return Promise.resolve();
};

/**
 * Return a list of manual sort positions so that inserting {numInsert} rows
 * with the returned positions will place them in between index-1 and index.
 * when the GridView is sorted by MANUALSORT
 **/
BaseView.prototype._getRowInsertPos = function(index, numInserts) {
  var rowId = this.viewData.getRowId(index);
  var insertPos = this.tableModel.tableData.getValue(rowId, MANUALSORT);
  return Array(numInserts).fill(insertPos);
};

/**
 * Duplicates selected row(s) and returns inserted rowIds
 */
BaseView.prototype._duplicateRows = async function() {
  if (this.viewSection.disableAddRemoveRows() || this.disableEditing()) {
    return;
  }
  // Get current selection (we need only rowIds).
  const selection = this.getSelection();
  const rowIds = selection.rowIds;
  const length = rowIds.length;
  // Start assembling action.
  const action = ['BulkAddRecord'];
  // Put nulls as rowIds.
  action.push(gutil.arrayRepeat(length, null));
  const columns = {};
  action.push(columns);
  // Calculate new positions for rows using helper function. It requires
  // index where we want to put new rows (it accepts new row index).
  const lastSelectedIndex = this.viewData.getRowIndex(rowIds[length-1]);
  columns.manualSort = this._getRowInsertPos(lastSelectedIndex + 1, length);
  // Now copy all visible data.
  for(const col of this.viewSection.columns.peek()) {
    // But omit all formula columns (and empty ones).
    const colId = col.colId.peek();
    if (col.isFormula.peek()) {
      continue;
    }
    columns[colId] = rowIds.map(id => this.tableModel.tableData.getValue(id, colId));
    // If all values in a column are censored, remove this column,
    if (columns[colId].every(gristTypes.isCensored)) {
      delete columns[colId]
    } else {
      // else remove only censored values
      columns[colId].forEach((val, i) => {
        if (gristTypes.isCensored(val)) {
          columns[colId][i] = null;
        }
      })
    }
  }
  const result = await this.sendTableAction(action, `Duplicated rows ${rowIds}`);
  return result;
}

BaseView.prototype.viewSelectedRecordAsCard = function() {
  if (this.isRecordCardDisabled()) { return; }

  const colRef = this.viewSection.viewFields().at(this.cursor.fieldIndex()).column().id();
  const rowId = this.viewData.getRowId(this.cursor.rowIndex());
  const sectionId = this.viewSection.tableRecordCard().id();
  const anchorUrlState = {hash: {colRef, rowId, sectionId, recordCard: true}};
  urlState().pushUrl(anchorUrlState, {replace: true}).catch(reportError);
}

BaseView.prototype.isRecordCardDisabled = function() {
  return this.viewSection.isTableRecordCardDisabled();
}

module.exports = BaseView;
