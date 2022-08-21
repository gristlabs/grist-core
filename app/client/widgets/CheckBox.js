var dom = require('../lib/dom');
var dispose = require('../lib/dispose');
var _ = require('underscore');
var kd = require('../lib/koDom');
var AbstractWidget = require('./AbstractWidget');

/**
 * CheckBox - A bi-state CheckBox widget
 */
function CheckBox(field) {
  AbstractWidget.call(this, field, {defaultTextColor: '#606060'});
}
dispose.makeDisposable(CheckBox);
_.extend(CheckBox.prototype, AbstractWidget.prototype);

CheckBox.prototype.buildConfigDom = function() {
  return null;
};

CheckBox.prototype.buildDom = function(row) {
  var value = row[this.field.colId()];
  return dom('div.field_clip',
    dom('div.widget_checkbox',
      dom.on('click', () => {
        if (!this.field.column().isRealFormula()) {
          value.setAndSave(!value.peek());
        }
      }),
      dom('div.widget_checkmark',
        kd.show(value),
        dom('div.checkmark_kick'),
        dom('div.checkmark_stem')
      )
    )
  );
};

module.exports = CheckBox;
