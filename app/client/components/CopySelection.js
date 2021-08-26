var ValueFormatter = require('app/common/ValueFormatter');

/**
 * The CopySelection class is an abstraction for a subset of currently selected cells.
 * @param {Array} rowIds - row ids of the rows selected
 * @param {Array} fields - MetaRowModels of the selected view fields
 * @param {Object} options.rowStyle - an object that maps rowId to an object containing
 * style options. i.e. { 1: { height: 20px } }
 * @param {Object} options.colStyle - an object that maps colId to an object containing
 * style options.
 */

function CopySelection(tableData, rowIds, fields, options) {
  this.fields = fields;
  this.rowIds = rowIds || [];
  this.colIds = fields.map(f => f.colId());
  this.displayColIds = fields.map(f => f.displayColModel().colId());
  this.rowStyle = options.rowStyle;
  this.colStyle = options.colStyle;
  this.columns = fields.map((f, i) => {
    let formatter = ValueFormatter.createFormatter(
      f.displayColModel().type(),
      f.widgetOptionsJson(),
      f.documentSettings()
    );
    let _fmtGetter = tableData.getRowPropFunc(this.displayColIds[i]);
    let _rawGetter = tableData.getRowPropFunc(this.colIds[i]);

    return {
      colId: this.colIds[i],
      fmtGetter: rowId => formatter.formatAny(_fmtGetter(rowId)),
      rawGetter: rowId => _rawGetter(rowId)
    };
  });
}

CopySelection.prototype.isCellSelected = function(rowId, colId) {
  return this.rowIds.includes(rowId) && this.colIds.includes(colId);
};

CopySelection.prototype.onlyAddRowSelected = function() {
  return this.rowIds.length === 1 && this.rowIds[0] === "new";
};

module.exports = CopySelection;
