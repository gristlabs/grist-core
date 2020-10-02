var _ = require('underscore');
var assert = require('assert');
var BackboneEvents = require('backbone').Events;

// Common
var gutil      = require('app/common/gutil');

// Libraries
var dispose = require('../lib/dispose');
var koArray = require('../lib/koArray');

// Models
var rowset       = require('./rowset');
var TableModel   = require('./TableModel');
var {DataRowModel} = require('./DataRowModel');
const {TableQuerySets} = require('./QuerySet');

/**
 * DataTableModel maintains the model for an arbitrary data table of a Grist document.
 */
function DataTableModel(docModel, tableData, tableMetaRow) {
  TableModel.call(this, docModel, tableData);

  this.tableMetaRow = tableMetaRow;

  this.tableQuerySets = new TableQuerySets(this.tableData);

  // New RowModels are created by copying fields from this._newRowModel template. This way we can
  // update the template on schema changes in the same way we update individual RowModels.
  // Note that tableMetaRow is incomplete when we get a new table, so we don't rely on it here.
  var fields = tableData.getColIds();
  assert(fields.includes('id'), "Expecting tableData columns to include `id`");

  // This row model gets schema actions via rowNotify, and is used as a template for new rows.
  this._newRowModel = this.autoDispose(new DataRowModel(this, fields));

  // TODO: Disposed rows should be removed from the set.
  this._floatingRows = new Set();

  // Listen for notifications that affect all rows, and apply them to the template row.
  this.listenTo(this, 'rowNotify', function(rows, action) {
    // TODO: (Important) Updates which affect a subset of rows should be handled more efficiently
    // for _floatingRows.
    // Ideally this._floatingRows would be a Map from rowId to RowModel, like in the LazyArrayModel.
    if (rows === rowset.ALL) {
      this._newRowModel.dispatchAction(action);
      this._floatingRows.forEach(row => {
        row.dispatchAction(action);
      });
    } else {
      this._floatingRows.forEach(row => {
        if (rows.includes(row.getRowId())) { row.dispatchAction(action); }
      });
    }
  });

  // TODO: In the future, we may need RowModel to support fields such as SubRecordList, containing
  // collections of records from another table (probably using RowGroupings as in MetaTableModel).
  // We'll need to pay attention to col.type() for that.
}

dispose.makeDisposable(DataTableModel);
_.extend(DataTableModel.prototype, TableModel.prototype);

/**
 * Creates and returns a LazyArrayModel of RowModels for the rows in the given sortedRowSet.
 * @param {Function} optRowModelClass: Class to use for a RowModel in place of DataRowModel.
 */
DataTableModel.prototype.createLazyRowsModel = function(sortedRowSet, optRowModelClass) {
  var RowModelClass = optRowModelClass || DataRowModel;
  var self = this;
  return new LazyArrayModel(sortedRowSet, function makeRowModel() {
    return new RowModelClass(self, self._newRowModel._fields);
  });
};

/**
 * Returns a new rowModel created using `optRowModelClass` or default `DataRowModel`.
 * It is the caller's responsibility to dispose of the returned rowModel.
 */
DataTableModel.prototype.createFloatingRowModel = function(optRowModelClass) {
  var RowModelClass = optRowModelClass || DataRowModel;
  var model = new RowModelClass(this, this._newRowModel._fields);
  this._floatingRows.add(model);
  model.autoDisposeCallback(() => {
    this._floatingRows.delete(model);
  });
  return model;
};

//----------------------------------------------------------------------

/**
 * LazyArrayModel inherits from koArray, and stays parallel to sortedRowSet.getKoArray(),
 * maintaining RowModels for only *some* items, with nulls for the rest.
 *
 * It's tailored for use with koDomScrolly.
 *
 * You must not modify LazyArrayModel, but are free to use non-modifying koArray methods on it.
 * It also exposes methods:
 *    makeItemModel()
 *    setItemModel(rowModel, index)
 * And it takes responsibility for maintaining
 *    rowModel._index() - An observable equal to the current index of this item in the array.
 *
 * @param {rowset.SortedRowSet} sortedRowSet: SortedRowSet to mirror.
 * @param {Function} makeRowModelFunc: A function that creates and returns a DataRowModel.
 *
 * @event rowModelNotify(rowModels, action):
 *    Forwards the action from 'rowNotify' event, but with a list of affected RowModels rather
 *    than a list of affected rowIds. Only instantiated RowModels are included.
 */
function LazyArrayModel(sortedRowSet, makeRowModelFunc) {
  // The underlying koArray contains some rowModels, and nulls for other elements. We keep it in
  // sync with rowIdArray. First, initialize a koArray of proper length with all nulls.
  koArray.KoArray.call(this, sortedRowSet.getKoArray().peek().map(function(r) { return null; }));
  this._rowIdArray = sortedRowSet.getKoArray();
  this._makeRowModel = makeRowModelFunc;

  this._assignedRowModels = new Map();    // Assigned rowModels by rowId.
  this._allRowModels = new Set();         // All instantiated rowModels.

  this.autoDispose(this._rowIdArray.subscribe(this._onSpliceChange, this, 'spliceChange'));
  this.listenTo(sortedRowSet, 'rowNotify', this.onRowNotify);

  // On disposal, dispose each instantiated RowModel.
  this.autoDisposeCallback(function() {
    for (let r of this._allRowModels) {
      // TODO: Ideally, row models should be disposable.
      if (typeof r.dispose === 'function') {
        r.dispose();
      }
    }
  });
}

/**
 * LazyArrayModel inherits from koArray.
 */
LazyArrayModel.prototype = Object.create(koArray.KoArray.prototype);
dispose.makeDisposable(LazyArrayModel);
_.extend(LazyArrayModel.prototype, BackboneEvents);


/**
 * Returns a new item model, as needed by setItemModel(). It is the only way for a new item
 * model to get instantiated.
 */
LazyArrayModel.prototype.makeItemModel = function() {
  var rowModel = this._makeRowModel();
  this._allRowModels.add(rowModel);
  return rowModel;
};

/**
 * Unassigns a given rowModel, removing it from the LazyArrayModel.
 * @returns {Boolean} True if rowModel got unset, false if it was already unset.
 */
LazyArrayModel.prototype.unsetItemModel = function(rowModel) {
  this.setItemModel(rowModel, null);
};

/**
 * Assigns a given rowModel to the given index. If the rowModel was previously assigned to a
 * different index, the old index reverts to null. If index is null, unsets the rowModel.
 */
LazyArrayModel.prototype.setItemModel = function(rowModel, index) {
  var arr = this.peek();

  // Remove the rowModel from its old index in the observable array, and in _assignedRowModels.
  var oldIndex = rowModel._index.peek();
  if (oldIndex !== null && arr[oldIndex] === rowModel) {
    arr[oldIndex] = null;
  }
  if (rowModel._rowId !== null) {
    this._assignedRowModels.delete(rowModel._rowId);
  }

  // Handles logic to set the rowModel to the given index.
  this._setItemModel(rowModel, index);

  if (index !== null && arr.length !== 0) {
    // Ensure that index is in-range.
    index = gutil.clamp(index, 0, arr.length - 1);

    // If there is already a model at the destination index, unassign that one.
    if (arr[index] !== null && arr[index] !== rowModel) {
      this.unsetItemModel(arr[index]);
    }

    // Add the newly-assigned model in its place in the array and in _assignedRowModels.
    arr[index] = rowModel;
    this._assignedRowModels.set(rowModel._rowId, rowModel);
  }
};

/**
 * Assigns a given floating rowModel to the given index.
 * If index is null, unsets the floating rowModel.
 */
LazyArrayModel.prototype.setFloatingRowModel = function(rowModel, index) {
  this._setItemModel(rowModel, index);
};

/**
 * Helper function to assign a given rowModel to the given index. Used by setItemModel
 * and setFloatingRowModel. Does not interact with the array, only the model itself.
 */
LazyArrayModel.prototype._setItemModel = function(rowModel, index) {
  var arr = this.peek();

  if (index === null || arr.length === 0) {
    // Unassign the rowModel if index is null or if there is no valid place to assign it to.
    rowModel._index(null);
    rowModel.assign(null);
  } else {
    // Otherwise, ensure that index is in-range.
    index = gutil.clamp(index, 0, arr.length - 1);

    // Assign the rowModel and set its index.
    rowModel._index(index);
    rowModel.assign(this._rowIdArray.peek()[index]);
  }
};

/**
 * Called for any updates to rows, including schema changes. This may affect some or all of the
 * rows; in the latter case, rows will be the constant rowset.ALL.
 */
LazyArrayModel.prototype.onRowNotify = function(rows, action) {
  if (rows === rowset.ALL) {
    for (let rowModel of this._allRowModels) {
      rowModel.dispatchAction(action);
    }
    this.trigger('rowModelNotify', this._allRowModels);
  } else {
    var affectedRowModels = [];
    for (let r of rows) {
      var rowModel = this._assignedRowModels.get(r);
      if (rowModel) {
        rowModel.dispatchAction(action);
        affectedRowModels.push(rowModel);
      }
    }
    this.trigger('rowModelNotify', affectedRowModels);
  }
};

/**
 * Internal helper called on any change in the underlying _rowIdArray. We mirror each new rowId
 * with a null. Removed rows are unassigned. We also update subsequent indices.
 */
LazyArrayModel.prototype._onSpliceChange = function(splice) {
  var numDeleted = splice.deleted.length;
  var i, n;

  // Unassign deleted models, and leave for the garbage collector to find.
  var arr = this.peek();
  for (i = splice.start, n = 0; n < numDeleted; i++, n++) {
    if (arr[i]) {
      this.unsetItemModel(arr[i]);
    }
  }

  // Update indices for other affected elements.
  var delta = splice.added - numDeleted;
  if (delta !== 0) {
    var firstToAdjust = splice.start + numDeleted;
    for (let rowModel of this._assignedRowModels.values()) {
      var index = rowModel._index.peek();
      if (index >= firstToAdjust) {
        rowModel._index(index + delta);
      }
    }
  }

  // Construct the arguments for the splice call to apply to ourselves.
  var newSpliceArgs = new Array(2 + splice.added);
  newSpliceArgs[0] = splice.start;
  newSpliceArgs[1] = numDeleted;
  for (i = 2; i < newSpliceArgs.length; i++) {
    newSpliceArgs[i] = null;
  }

  // Apply the splice to ourselves, inserting nulls for the newly-added items.
  this.arraySplice(splice.start, numDeleted, gutil.arrayRepeat(splice.added, null));
};

/**
 * Returns the rowId at the given index from the rowIdArray. (Subscribes if called in a computed.)
 */
LazyArrayModel.prototype.getRowId = function(index) {
  return this._rowIdArray.at(index);
};

/**
 * Returns the index of the given rowId, or -1 if not found. (Does not subscribe to array.)
 */
LazyArrayModel.prototype.getRowIndex = function(rowId) {
  return this._rowIdArray.peek().indexOf(rowId);
};

/**
 * Returns the index of the given rowId, or -1 if not found. (Subscribes if called in a computed.)
 */
LazyArrayModel.prototype.getRowIndexWithSub = function(rowId) {
  return this._rowIdArray.all().indexOf(rowId);
};

/**
 * Returns the rowModel for the given rowId.
 * Returns undefined when there is no rowModel for the given rowId, which is often the case
 *  when it is scrolled out of view.
 */
LazyArrayModel.prototype.getRowModel = function(rowId) {
  return this._assignedRowModels.get(rowId);
};

module.exports = DataTableModel;
