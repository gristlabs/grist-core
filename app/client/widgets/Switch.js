var dom = require('../lib/dom');
var dispose = require('../lib/dispose');
var _ = require('underscore');
var kd = require('../lib/koDom');
var AbstractWidget = require('./AbstractWidget');

/**
 * Switch - A bi-state Switch widget
 */
function Switch(field) {
  AbstractWidget.call(this, field);
}
dispose.makeDisposable(Switch);
_.extend(Switch.prototype, AbstractWidget.prototype);

Switch.prototype.buildConfigDom = function() {
  return null;
};

Switch.prototype.buildDom = function(row) {
  var value = row[this.field.colId()];
  return dom('div.field_clip',
    dom('div.widget_switch',
      kd.toggleClass('switch_on', value),
      kd.toggleClass('switch_transition', row._isRealChange),
      dom('div.switch_slider'),
      dom('div.switch_circle'),
      dom.on('click', () => {
        if (!this.field.column().isRealFormula()) {
          value.setAndSave(!value.peek());
        }
      })
    )
  );
};

module.exports = Switch;
