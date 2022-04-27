/**
 * MetaTableModel maintains the model for a built-in table, with MetaRowModels. It provides
 * access to individual row models, as well as to collections of rows in that table.
 */


var _ = require('underscore');
var ko = require('knockout');
var dispose = require('../lib/dispose');
var MetaRowModel = require('./MetaRowModel');
var TableModel = require('./TableModel');
var rowset = require('./rowset');
var assert = require('assert');
var gutil = require('app/common/gutil');

/**
 * MetaTableModel maintains observables for one table's rows. It accepts a list of fields to
 * include into each RowModel, and an additional constructor to call when constructing RowModels.
 * It exposes all rows, as well as groups of rows, as observable collections.
 */
function MetaTableModel(docModel, tableData, fields, rowConstructor) {
  TableModel.call(this, docModel, tableData);

  this._fields = fields;
  this._rowConstructor = rowConstructor;

  // Start out with empty list of row models. It's populated in loadData().
  this.rowModels = [];

  // It is possible for a new rowModel to be deleted and replaced with a new one for the same
  // rowId. To allow a computed() to depend on the row version, we keep a permanent observable
  // "version" associated with each rowId, which is incremented any time a rowId is replaced.
  this._rowModelVersions = [];

  // Whenever rowNotify is triggered, also send the action to all row RowModels that we maintain.
  this.listenTo(this, 'rowNotify', function(rows, action) {
    assert(rows !== rowset.ALL, "Unexpected schema action on a metadata table");
    for (let r of rows) {
      if (this.rowModels[r]) {
        this.rowModels[r].dispatchAction(action);
      }
    }
  });
}
dispose.makeDisposable(MetaTableModel);
_.extend(MetaTableModel.prototype, TableModel.prototype);

/**
 * This is called from DocModel as soon as all the MetaTableModel objects have been created.
 */
MetaTableModel.prototype.loadData = function() {
  // Whereas user-defined tables may not be initially loaded, MetaTableModels should only exist
  // for built-in tables, which *should* already be loaded (and should never be reloaded).
  assert(this.tableData.isLoaded, "MetaTableModel: tableData not yet loaded");

  // Create and populate the array mapping rowIds to RowModels.
  this.getAllRows().forEach(function(rowId) {
    this._createRowModel(rowId);
  }, this);
};

/**
 * Returns an existing or a blank row. Used for `recordRef` descriptor in DocModel.
 *
 * A computed() that uses getRowModel() may not realize if a rowId gets deleted and later re-used
 * for another row. If optDependOnVersion is set, then a dependency on the row version gets
 * created automatically. It is only relevant when the computed is pure and may not get updated
 * when the row is deleted; in that case lacking such dependency may cause subtle rare bugs.
 */
MetaTableModel.prototype.getRowModel = function(rowId, optDependOnVersion) {
  const rowIdModel = this.rowModels[rowId];
  const r = rowIdModel || this.getEmptyRowModel();
  if (optDependOnVersion) {
    // Versions are never deleted, so even if the rowModel is deleted, we still have its version
    // in this list.
    const version = this._rowModelVersions[rowId];
    if (version) {
      // Subscribe to updates for rowModel at rowId.
      version();
    } else {
      // It shouldn't happen, but maybe it would be better to add an empty version observable at rowId.
      // If it happens, it means we tried to get non existing row (row that wasn't created previously).
    }
  }
  return r;
};

/**
 * Returns the RowModel to use for invalid rows.
 */
MetaTableModel.prototype.getEmptyRowModel = function() {
  return this._createRowModel(0);
};

/**
 * Private helper to create a MetaRowModel for the given rowId. For public use, there are
 * getRowModel(rowId) and createFloatingRowModel(rowIdObs).
 */
MetaTableModel.prototype._createRowModel = function(rowId) {
  if (!this.rowModels[rowId]) {
    // When creating a new row, we create new MetaRowModels which use observables. If
    // _createRowModel is called from within the evaluation of a computed(), we do NOT want that
    // computed to subscribe to observables used by individual MetaRowModels.
    ko.ignoreDependencies(() => {
      this.rowModels[rowId] = MetaRowModel.create(this, this._fields, this._rowConstructor, rowId);

      // Whenever a rowModel is created, increment its version number.
      let inc = this._rowModelVersions[rowId] || (this._rowModelVersions[rowId] = ko.observable(0));
      inc(inc.peek() + 1);
    });
  }
  return this.rowModels[rowId];
};


/**
 * Returns a MetaRowModel-like object tied to an observable rowId. When the observable changes,
 * the fields of the returned model start reflecting the values for the new rowId. See also
 * MetaRowModel.Floater docs.
 *
 * There should be very few such floating rows. If you ever want a set, you should be using
 * createAllRowsModel() or createRowGroupModel().
 *
 * @param {ko.observable} rowIdObs: observable that evaluates to a rowId.
 */
MetaTableModel.prototype.createFloatingRowModel = function(rowIdObs) {
  return MetaRowModel.Floater.create(this, rowIdObs);
};

/**
 * Override TableModel's _process_RemoveRecord to also remove our reference to this row model.
 */
MetaTableModel.prototype._process_RemoveRecord = function(action, tableId, rowId) {
  TableModel.prototype._process_RemoveRecord.apply(this, arguments);
  this._deleteRowModel(rowId);
};

/**
 * Clean up the RowModel for a row when it's deleted by an action from the server.
 */
MetaTableModel.prototype._deleteRowModel = function(rowId) {
  this.rowModels[rowId]._isDeleted(true);
  this.rowModels[rowId].dispose();
  delete this.rowModels[rowId];
};

/**
 * We have to remember to override Bulk versions too.
 */
MetaTableModel.prototype._process_BulkRemoveRecord = function(action, tableId, rowIds) {
  TableModel.prototype._process_BulkRemoveRecord.apply(this, arguments);
  rowIds.forEach(rowId => this._deleteRowModel(rowId));
};

/**
 * Override TableModel's _process_AddRecord to also add a row model for the given rowId.
 */
MetaTableModel.prototype._process_AddRecord = function(action, tableId, rowId, columnValues) {
  this._createRowModel(rowId);
  TableModel.prototype._process_AddRecord.apply(this, arguments);
};

/**
 * We have to remember to override Bulk versions too.
 */
MetaTableModel.prototype._process_BulkAddRecord = function(action, tableId, rowIds, columns) {
  rowIds.forEach(rowId => this._createRowModel(rowId));
  TableModel.prototype._process_BulkAddRecord.apply(this, arguments);
};

/**
 * Override TableModel's applySchemaAction to assert that there are NO metadata schema changes.
 */
MetaTableModel.prototype.applySchemaAction = function(action) {
  throw new Error("No schema actions should apply to metadata");
};

/**
 * Returns a new observable array (koArray) of MetaRowModels for all the rows in this table,
 * sorted by the given column. It is the caller's responsibility to dispose this array.
 * @param {string} sortColId: Column ID by which to sort.
 */
MetaTableModel.prototype.createAllRowsModel = function(sortColId) {
  return this._createRowSetModel(this, sortColId);
};

/**
 * Returns a new observable array (koArray) of MetaRowModels matching the given `groupValue`.
 * It is the caller's responsibility to dispose this array.
 * @param {String|Number} groupValue - The group value to match.
 * @param {String} options.groupBy  - RowModel field by which to group.
 * @param {String} options.sortBy   - RowModel field by which to sort.
 */
MetaTableModel.prototype.createRowGroupModel = function(groupValue, options) {
  var grouping = this.getRowGrouping(options.groupBy);
  return this._createRowSetModel(grouping.getGroup(groupValue), options.sortBy);
};

/**
 * Helper that returns a new observable koArray of MetaRowModels subscribed to the given
 * rowSource, and sorted by the given column. It is the caller's responsibility to dispose it.
 */
MetaTableModel.prototype._createRowSetModel = function(rowSource, sortColId) {
  var getter = this.tableData.getRowPropFunc(sortColId);
  var sortedRowSet = rowset.SortedRowSet.create(null, function(r1, r2) {
    return gutil.nativeCompare(getter(r1), getter(r2));
  });
  sortedRowSet.subscribeTo(rowSource);

  // When the returned value is disposed, dispose the underlying SortedRowSet too.
  var ret = this._createRowModelArray(sortedRowSet.getKoArray());
  ret.autoDispose(sortedRowSet);
  return ret;
};

/**
 * Helper which takes an observable array (koArray) of rowIds, and returns a new koArray of
 * objects having those RowModels as prototypes, and with an additional `_index` observable to
 * contain their index in the array. The index is kept correct as the array changes.
 *
 * TODO: this needs a unittest.
 */
MetaTableModel.prototype._createRowModelArray = function(rowIdArray) {
  var ret = rowIdArray.map(this._createRowModelItem, this);
  ret.subscribe(function(splice) {
    var arr = splice.array, i;
    for (i = 0; i < splice.deleted.length; i++) {
      splice.deleted[i]._index(null);
    }
    var delta = splice.added - splice.deleted.length;
    if (delta !== 0) {
      for (i = splice.start + splice.added; i < arr.length; i++) {
        arr[i]._index(i);
      }
    }
  }, null, 'spliceChange');
  return ret;
};

/**
 * Creates and returns a RowModel with its own `_index` observable.
 */
MetaTableModel.prototype._createRowModelItem = function(rowId, index) {
  var rowModel = this._createRowModel(rowId);
  assert.ok(rowModel, "MetaTableModel._createRowModelItem called for invalid rowId " + rowId);
  var ret = Object.create(rowModel);    // New object, with rowModel as its prototype.
  ret._index = ko.observable(index);    // New _index observable overrides the existing one.
  return ret;
};

module.exports = MetaTableModel;
