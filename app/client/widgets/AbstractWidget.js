var dispose = require('../lib/dispose');
const {Computed, fromKo} = require('grainjs');

const {cssLabel, cssRow} = require('app/client/ui/RightPanel');
const {colorSelect} = require('app/client/ui2018/ColorSelect');

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

  this.valueFormatter = this.field.visibleColFormatter;

  this.textColor = Computed.create(this, (use) => use(this.field.textColor) || defaultTextColor)
    .onWrite((val) => this.field.textColor(val === defaultTextColor ? undefined : val));
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

AbstractWidget.prototype.buildColorConfigDom = function() {
  return [
    cssLabel('CELL COLOR'),
    cssRow(
      colorSelect(
        this.textColor,
        fromKo(this.field.fillColor),
        // Calling `field.widgetOptionsJson.save()` saves both fill and text color settings.
        () => this.field.widgetOptionsJson.save()
      )
    )
  ];
};

module.exports = AbstractWidget;
