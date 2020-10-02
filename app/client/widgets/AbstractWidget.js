var dispose = require('../lib/dispose');
const ko = require('knockout');
const {fromKo} = require('grainjs');
const ValueFormatter = require('app/common/ValueFormatter');

const {cssLabel, cssRow} = require('app/client/ui/RightPanel');
const {colorSelect} = require('app/client/ui2018/buttonSelect');
const {testId} = require('app/client/ui2018/cssVars');
const {cssHalfWidth, cssInlineLabel} = require('app/client/widgets/NewAbstractWidget');

/**
 * AbstractWidget - The base of the inheritance tree for widgets.
 * @param {Function} field - The RowModel for this view field.
 */
function AbstractWidget(field) {
  this.field = field;
  this.options = field.widgetOptionsJson;

  this.valueFormatter = this.autoDispose(ko.computed(() => {
    return ValueFormatter.createFormatter(field.displayColModel().type(), this.options());
  }));
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
      cssHalfWidth(
        colorSelect(
          fromKo(this.field.textColor),
          (val) => this.field.textColor.saveOnly(val),
          testId('text-color'),
        ),
        cssInlineLabel('Text')
      ),
      cssHalfWidth(
        colorSelect(
          fromKo(this.field.fillColor),
          (val) => this.field.fillColor.saveOnly(val),
          testId('fill-color'),
        ),
        cssInlineLabel('Fill')
      )
    )
  ];
};

module.exports = AbstractWidget;
