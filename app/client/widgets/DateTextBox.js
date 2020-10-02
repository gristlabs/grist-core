var _ = require('underscore');
var ko = require('knockout');
var dom = require('../lib/dom');
var dispose = require('../lib/dispose');
var kd = require('../lib/koDom');
var kf = require('../lib/koForm');
var AbstractWidget = require('./AbstractWidget');

const {fromKoSave} = require('app/client/lib/fromKoSave');
const {alignmentSelect} = require('app/client/ui2018/buttonSelect');
const {cssRow} = require('app/client/ui/RightPanel');

/**
 * DateTextBox - The most basic widget for displaying simple date information.
 */
function DateTextBox(field) {
  AbstractWidget.call(this, field);

  this.alignment = this.options.prop('alignment');
  this.dateFormat = this.options.prop('dateFormat');
  this.isCustomDateFormat = this.options.prop('isCustomDateFormat');

  this.dateFormatOptions = [
    'YYYY-MM-DD',
    'MM-DD-YYYY',
    'MM/DD/YYYY',
    'MM-DD-YY',
    'MM/DD/YY',
    'DD MMM YYYY',
    'MMMM Do, YYYY',
    'DD-MM-YYYY',
    'Custom'
  ];

  // Helper to set 'dateFormat' and 'isCustomDateFormat' from the set of default date format strings.
  this.standardDateFormat = this.autoDispose(ko.computed({
    owner: this,
    read: function() { return this.isCustomDateFormat() ? 'Custom' : this.dateFormat(); },
    write: function(val) {
      if (val === 'Custom') { this.isCustomDateFormat.setAndSave(true); }
      else {
        this.options.update({isCustomDateFormat: false, dateFormat: val});
        this.options.save();
      }
    }
  }));

  // An observable that always returns `UTC`, eases DateTimeEditor inheritance.
  this.timezone = ko.observable('UTC');
}
dispose.makeDisposable(DateTextBox);
_.extend(DateTextBox.prototype, AbstractWidget.prototype);

DateTextBox.prototype.buildDateConfigDom = function() {
  var self = this;
  return dom('div',
    kf.row(
      1, dom('div.glyphicon.glyphicon-calendar.config_icon'),
      8, kf.label('Date Format'),
      9, dom(kf.select(self.standardDateFormat, self.dateFormatOptions), dom.testId("Widget_dateFormat"))
    ),
    kd.maybe(self.isCustomDateFormat, function() {
      return dom(kf.text(self.dateFormat), dom.testId("Widget_dateCustomFormat"));
    })
  );
};

DateTextBox.prototype.buildConfigDom = function() {
  return dom('div',
    this.buildDateConfigDom(),
    cssRow(
      alignmentSelect(fromKoSave(this.alignment))
    )
  );
};

DateTextBox.prototype.buildTransformConfigDom = function() {
  return this.buildDateConfigDom();
};

DateTextBox.prototype.buildDom = function(row) {
  let value = row[this.field.colId()];
  return dom('div.field_clip',
    kd.style('text-align', this.alignment),
    kd.text(() => row._isAddRow() ? '' : this.valueFormatter().format(value()))
  );
};

module.exports = DateTextBox;
