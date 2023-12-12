var _ = require('underscore');
var ko = require('knockout');
var dispose = require('../lib/dispose');
var BaseRowModel = require('./BaseRowModel');
var modelUtil = require('./modelUtil');
var BackboneEvents = require('backbone').Events;

/**
 * MetaRowModel is a RowModel for built-in (Meta) tables. It takes a list of field names, and an
 * additional constructor called with (docModel, tableModel) arguments (and `this` context), which
 * can add arbitrary additional properties to this RowModel.
 */
function MetaRowModel(tableModel, fieldNames, rowConstructor, rowId) {
  var colNames = ['id'].concat(fieldNames);
  BaseRowModel.call(this, tableModel, colNames);
  this._rowId = rowId;

  // MetaTableModel#_createRowModelItem creates lightweight objects that all reference the same MetaRowModel but are slightly different.
  // We don't derive from BackboneEvents directly so that the lightweight objects created share the same Events object even though they are distinct.
  this.events = this.autoDisposeWith('stopListening', BackboneEvents);

  // Changes to true when this row gets deleted. This also likely means that this model is about
  // to get disposed, except for a floating row model.
  this._isDeleted = ko.observable(false);

  // Populate all fields. Note that MetaRowModels are never get reassigned after construction.
  this._fields.forEach(function(colName) {
    this._assignColumn(colName);
  }, this);

  // Customize the MetaRowModel with a custom additional constructor.
  if (rowConstructor) {
    rowConstructor.call(this, tableModel.docModel, tableModel);
  }
}
dispose.makeDisposable(MetaRowModel);
_.extend(MetaRowModel.prototype, BaseRowModel.prototype);

MetaRowModel.prototype._assignColumn = function(colName) {
  if (this.hasOwnProperty(colName)) {
    this[colName].assign(this._table.tableData.getValue(this._rowId, colName));
  }
};

//----------------------------------------------------------------------

/**
 * MetaRowModel.Floater is an object designed to look like a MetaRowModel. It contains observables
 * that mirror some particular MetaRowModel. The MetaRowModel currently being mirrored is the one
 * corresponding to the value of `rowIdObs`.
 *
 * Mirrored fields are computed observables that support reading, writing, and saving.
 */
MetaRowModel.Floater = function(tableModel, rowIdObs) {
  this._table = tableModel;
  this.rowIdObs = rowIdObs;

  // Some tsc error prevents me from adding this at the module level.
  // This method is part of the interface of MetaRowModel.
  // TODO: Fix the tsc error and move this to the module level.
  if (!this.constructor.prototype.getRowId) {
    this.constructor.prototype.getRowId = function() {
      return this.rowIdObs();
    }
  }

  // Note that ._index isn't supported because it doesn't make sense for a floating row model.

  this._underlyingRowModel = this.autoDispose(ko.computed(function() {
    return tableModel.getRowModel(rowIdObs());
  }));

  _.each(this._underlyingRowModel(), function(propValue, propName) {
    if (ko.isObservable(propValue)) {
      // Forward read/write calls to the observable on the currently-active underlying model.
      this[propName] = this.autoDispose(ko.pureComputed({
        owner: this,
        read: function() { return this._underlyingRowModel()[propName](); },
        write: function(val) { this._underlyingRowModel()[propName](val); }
      }));

      // If the underlying observable supports saving, forward save calls too.
      if (propValue.saveOnly) {
          modelUtil.addSaveInterface(this[propName], (value =>
            this._underlyingRowModel()[propName].saveOnly(value)));
      }
    }
  }, this);
};
dispose.makeDisposable(MetaRowModel.Floater);


module.exports = MetaRowModel;
