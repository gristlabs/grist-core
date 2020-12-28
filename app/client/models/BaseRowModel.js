var _ = require('underscore');
var ko = require('knockout');

var gutil = require('app/common/gutil');

var dispose = require('../lib/dispose');

var modelUtil = require('./modelUtil');


/**
 * BaseRowModel is an observable model for a record (or row) of a data (DataRowModel) or meta
 * (MetaRowModel) table. It takes a reference to the containing TableModel, and a list of
 * column names, and creates an observable for each field.
 * TODO: We need to have a way to dispose RowModels, and have them dispose individual fields,
 * which should in turn unsubscribe from various events on disposal. And it all should be tested.
 *
 */
function BaseRowModel(tableModel, colNames) {
  this._table  = tableModel;
  this._fields = colNames.slice(0);
  this._index  = ko.observable(null);    // The index in the observable to which it belongs.
  this._rowId  = null;

  // Create a field for everything in `_fields`.
  this._fields.forEach(function(colName) {
    this._createField(colName);
  }, this);
}
dispose.makeDisposable(BaseRowModel);

// This adds the dispatchAction() method to RowModel.
_.extend(BaseRowModel.prototype, modelUtil.ActionDispatcher);

/**
 * Returns the rowId to which this RowModel is assigned. This is also normally available as the
 * `rowModel.id` observable.
 */
BaseRowModel.prototype.getRowId = function() {
  return this._rowId;
};

/**
 * Creates a field for colName. This is either a top level observable like this[colName]
 * for MetaRowModels or a property field like this[name][prop] for DataRowModels
 */
BaseRowModel.prototype._createField = function(colName) {
  this[colName] = modelUtil.addSaveInterface(ko.observable(), v => this._saveField(colName, v));
};

/**
 * Helper method to send a user action to save a field of the current row to the server.
 */
BaseRowModel.prototype._saveField = function(colName, value) {
  var colValues = {};
  colValues[colName] = value;
  return this.updateColValues(colValues);
};

/**
 * Send an update to the server to update multiple columns for this row.
 * @param {Object} colValues: Maps colIds to values.
 * @returns {Promise} Resolved when the update succeeds.
 */
BaseRowModel.prototype.updateColValues = function(colValues) {
  return this._table.sendTableAction(["UpdateRecord", this._rowId, colValues]);
};

/**
 * Assigns the field of this RowModel named by `colName` to its corresponding value.
 */
BaseRowModel.prototype._assignColumn = function(colName) {
  throw new Error("Not Implemented");
};

//----------------------------------------------------------------------

/**
 * Implements the interface expected by modelUtil.ActionDispatcher. We only implement the
 * actions that affect individual rows. Note that BulkUpdateRecord needs to be translated to individual
 * UpdateRecords for RowModel to know what to do. Messages not here must be implemented by subclasses.
 * Some of these require helper methods defined in subclasses
 */

BaseRowModel.prototype._process_RemoveColumn = function(action, tableId, colId) {
  if (!gutil.arrayRemove(this._fields, colId)) {
    console.error("RowModel #RemoveColumn %s %s: column not found", tableId, colId);
  }
  delete this[colId];
};

BaseRowModel.prototype._process_ModifyColumn = function(action, tableId, colId, colInfo) {
  // No-op for us, because we don't care about any of the column properties.
};

BaseRowModel.prototype._process_UpdateRecord = function(action, tableId, rowId, columnValues) {
  for (var colName in columnValues) {
    this._assignColumn(colName);
  }
};

BaseRowModel.prototype._process_BulkUpdateRecord = function(action, tableId, rowId, columnValues) {
  // We get notified when a BulkUpdateRecord affects us, but since we just update all fields from
  // the underlying data, we don't need to find our row in the action.
  for (var colName in columnValues) {
    this._assignColumn(colName);
  }
};

// TODO: if AddColumn messages aren't sent for properties, we will need to find a different
// way to create and set the properties than here
BaseRowModel.prototype._process_AddColumn = function(action, tableId, colId, colInfo) {
  this._fields.push(colId);
  this._createField(colId);
  this._assignColumn(colId);
};

BaseRowModel.prototype._process_RenameColumn = function(action, tableId, oldColId, newColId) {
  // handle standard renames differently
  if (this._fields.indexOf(newColId) !== -1) {
    console.error("RowModel #RenameColumn %s %s %s: already exists", tableId, oldColId, newColId);
    return;
  }
  var index = this._fields.indexOf(oldColId);
  if (index === -1) {
    console.error("RowModel #RenameColumn %s %s %s: not found", tableId, oldColId, newColId);
    return;
  }
  this._fields[index] = newColId;

  // Reuse the old observable, but replace its "save" family of functions.
  this[newColId] = this[oldColId];
  modelUtil.addSaveInterface(this[newColId], this._saveField.bind(this, newColId));
  this._assignColumn(newColId);
  delete this[oldColId];
};

module.exports = BaseRowModel;
