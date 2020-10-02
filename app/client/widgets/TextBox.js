var _ = require('underscore');
var ko = require('knockout');
var dom = require('../lib/dom');
var dispose = require('../lib/dispose');
var kd = require('../lib/koDom');
var AbstractWidget = require('./AbstractWidget');
var modelUtil = require('../models/modelUtil');

const {fromKoSave} = require('app/client/lib/fromKoSave');
const {alignmentSelect, buttonToggleSelect} = require('app/client/ui2018/buttonSelect');
const {testId} = require('app/client/ui2018/cssVars');
const {cssRow} = require('app/client/ui/RightPanel');
const {Computed} = require('grainjs');

/**
 * TextBox - The most basic widget for displaying text information.
 */
function TextBox(field) {
  AbstractWidget.call(this, field);
  this.alignment = this.options.prop('alignment');
  let wrap = this.options.prop('wrap');
  this.wrapping = this.autoDispose(ko.computed({
    read: () => {
      let w = wrap();
      if (w === null || w === undefined) {
        // When user has yet to specify a desired wrapping state, GridView and DetailView have
        // different default states. GridView defaults to wrapping disabled, while DetailView
        // defaults to wrapping enabled.
        return (this.field.viewSection().parentKey() === 'record') ? false : true;
      } else {
        return w;
      }
    },
    write: val => wrap(val)
  }));
  modelUtil.addSaveInterface(this.wrapping, val => wrap.saveOnly(val));

  this.autoDispose(this.wrapping.subscribe(() =>
    this.field.viewSection().events.trigger('rowHeightChange')
  ));

}
dispose.makeDisposable(TextBox);
_.extend(TextBox.prototype, AbstractWidget.prototype);

TextBox.prototype.buildConfigDom = function() {
  const wrapping = Computed.create(null, use => use(this.wrapping));
  wrapping.onWrite((val) => modelUtil.setSaveValue(this.wrapping, Boolean(val)));

  return dom('div',
    cssRow(
      dom.autoDispose(wrapping),
      alignmentSelect(fromKoSave(this.alignment)),
      dom('div', {style: 'margin-left: 8px;'},
        buttonToggleSelect(wrapping, [{value: true, icon: 'Wrap'}]),
        testId('tb-wrap-text')
      )
    )
  );
};

TextBox.prototype.buildDom = function(row) {
  let value = row[this.field.colId()];
  return dom('div.field_clip',
    kd.style('text-align', this.alignment),
    kd.toggleClass('text_wrapping', this.wrapping),
    kd.text(() => row._isAddRow() ? '' : this.valueFormatter().format(value()))
  );
};

module.exports = TextBox;
