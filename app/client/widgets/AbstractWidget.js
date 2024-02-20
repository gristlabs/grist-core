var dispose = require('../lib/dispose');
const {theme} = require('app/client/ui2018/cssVars');
const {CellStyle} = require('app/client/widgets/CellStyle');
const {dom} = require('grainjs');

/**
 * AbstractWidget - The base of the inheritance tree for widgets.
 * @param {Function} field - The RowModel for this view field.
 * @param {string|undefined} options.defaultTextColor - CSS value of the default
 * text color for the widget. Defaults to the current theme's cell fg color.
 *
 */
function AbstractWidget(field, opts = {}) {
  this.field = field;
  this.options = field.widgetOptionsJson;
  this.valueFormatter = this.field.visibleColFormatter;
  this.defaultTextColor = opts.defaultTextColor ?? theme.cellFg.toString();
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

AbstractWidget.prototype.buildFormConfigDom = function() {
  return null;
};

AbstractWidget.prototype.buildFormTransformConfigDom = function() {
  return null;
};

module.exports = AbstractWidget;
