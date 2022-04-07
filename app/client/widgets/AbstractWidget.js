var dispose = require('../lib/dispose');
const {CellStyle} = require('app/client/widgets/CellStyle');
const {dom} = require('grainjs');

/**
 * AbstractWidget - The base of the inheritance tree for widgets.
 * @param {Function} field - The RowModel for this view field.
 * @param {string|undefined} options.defaultTextColor - A hex value to set the default text color
 * for the widget. Omit defaults to '#000000'.
 */
function AbstractWidget(field, opts = {}) {
  this.field = field;
  this.options = field.widgetOptionsJson;
  const {defaultTextColor = '#000000'} = opts;
  this.defaultTextColor = defaultTextColor;
  this.valueFormatter = this.field.visibleColFormatter;
  this.defaultTextColor = opts.defaultTextColor || '#000000';
}
dispose.makeDisposable(AbstractWidget);

/**
 * Builds the DOM showing configuration buttons and fields in the sidebar.
 */
AbstractWidget.prototype.buildConfigDom = function() {
  throw new Error("Not Implemented");
};

/**
 * Builds the transform prompt config DOM in the few cases where it is necessary.
 * Child classes need not override this function if they do not require transform config options.
 */
AbstractWidget.prototype.buildTransformConfigDom = function() {
  return null;
};

/**
 * Builds the data cell DOM.
 * @param {DataRowModel} row - The rowModel object.
 */
AbstractWidget.prototype.buildDom = function(row) {
  throw new Error("Not Implemented");
};

AbstractWidget.prototype.buildColorConfigDom = function(gristDoc) {
  return dom.create(CellStyle, this.field, gristDoc, this.defaultTextColor);
};

module.exports = AbstractWidget;
