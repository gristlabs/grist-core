/**
 * TableModel maintains the model for an arbitrary data table of a Grist document.
 */


var _ = require('underscore');
var ko = require('knockout');
var dispose = require('../lib/dispose');
var rowset = require('./rowset');
var modelUtil = require('./modelUtil');

function TableModel(docModel, tableData) {
  this.docModel = docModel;
  this.tableData = tableData;

  // Maps groupBy fields to RowGrouping objects.
  this.rowGroupings = {};

  this.isLoaded = ko.observable(tableData.isLoaded);
  this.autoDispose(tableData.dataLoadedEmitter.addListener(this.onDataLoaded, this));
  this.autoDispose(tableData.tableActionEmitter.addListener(this.dispatchAction, this));
}

dispose.makeDisposable(TableModel);
_.extend(TableModel.prototype, rowset.RowSource.prototype, modelUtil.ActionDispatcher);

TableModel.prototype.fetch = function(force) {
  if (this.isLoaded.peek() && force) {
    this.isLoaded(false);
  }
  return this.tableData.docData.fetchTable(this.tableData.tableId, force);
};

TableModel.prototype.getAllRows = function() {
  return this.tableData.getRowIds();
};

TableModel.prototype.getNumRows = function() {
  return this.tableData.numRecords();
};

TableModel.prototype.getRowGrouping = function(groupByCol) {
  var grouping = this.rowGroupings[groupByCol];
  if (!grouping) {
    grouping = rowset.RowGrouping.create(null, this.tableData.getRowPropFunc(groupByCol));
    grouping.subscribeTo(this);
    this.rowGroupings[groupByCol] = grouping;
  }
  return grouping;
};

TableModel.prototype.onDataLoaded = function(oldRowIds, newRowIds) {
  this.trigger('rowChange', 'remove', oldRowIds);
  this.trigger('rowChange', 'add', newRowIds);
  this.isLoaded(true);
};

/**
 * Shortcut for `.tableData.sendTableActions`. See documentation in TableData.js.
 */
TableModel.prototype.sendTableActions = function(actions, optDesc) {
  return this.tableData.sendTableActions(actions, optDesc);
};

/**
 * Shortcut for `.tableData.sendTableAction`. See documentation in TableData.js.
 */
TableModel.prototype.sendTableAction = function(action, optDesc) {
  return this.tableData.sendTableAction(action, optDesc);
};

//----------------------------------------------------------------------
/**
 * Called via `this.dispatchAction`.
 */

TableModel.prototype._process_AddRecord = function(action, tableId, rowId, columnValues) {
  this.trigger('rowChange', 'add', [rowId]);
};
TableModel.prototype._process_RemoveRecord = function(action, tableId, rowId) {
  this.trigger('rowChange', 'remove', [rowId]);
};
TableModel.prototype._process_UpdateRecord = function(action, tableId, rowId, columnValues) {
  this.trigger('rowChange', 'update', [rowId]);
  this.trigger('rowNotify', [rowId], action);
};

TableModel.prototype._process_ReplaceTableData = function() {
  // No-op because TableData.js already translates ReplaceTableData to a 'dataLoaded' event.
};

TableModel.prototype._process_BulkAddRecord = function(action, tableId, rowIds, columns) {
  this.trigger('rowChange', 'add', rowIds);
};
TableModel.prototype._process_BulkRemoveRecord = function(action, tableId, rowIds) {
  this.trigger('rowChange', 'remove', rowIds);
};
TableModel.prototype._process_BulkUpdateRecord = function(action, tableId, rowIds, columns) {
  this.trigger('rowChange', 'update', rowIds);
  this.trigger('rowNotify', rowIds, action);
};

// All schema changes to this table should be forwarded to each row.
// TODO: we may need to worry about groupings (e.g. recreate the grouping function) once we do row
// groupings of user data. Metadata isn't subject to schema changes, so that doesn't matter.
TableModel.prototype.applySchemaAction = function(action) {
  this.trigger('rowNotify', rowset.ALL, action);
};

TableModel.prototype._process_AddColumn = function(action) { this.applySchemaAction(action); };
TableModel.prototype._process_RemoveColumn = function(action) { this.applySchemaAction(action); };
TableModel.prototype._process_RenameColumn = function(action) { this.applySchemaAction(action); };
TableModel.prototype._process_ModifyColumn = function(action) { this.applySchemaAction(action); };

TableModel.prototype._process_RenameTable = _.noop;
TableModel.prototype._process_RemoveTable = _.noop;

module.exports = TableModel;
