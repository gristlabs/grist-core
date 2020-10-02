/* globals $ */
var _ = require('underscore');
var ko = require('knockout');
var moment = require('moment-timezone');
var dom = require('../lib/dom');
var dispose = require('../lib/dispose');
var kd = require('../lib/koDom');
var kf = require('../lib/koForm');
var DateTextBox = require('./DateTextBox');
var gutil = require('app/common/gutil');

const {fromKoSave} = require('app/client/lib/fromKoSave');
const {alignmentSelect} = require('app/client/ui2018/buttonSelect');
const {testId} = require('app/client/ui2018/cssVars');
const {cssRow} = require('app/client/ui/RightPanel');

/**
 * DateTimeTextBox - The most basic widget for displaying date and time information.
 */
function DateTimeTextBox(field) {
  DateTextBox.call(this, field);

  this.timezoneOptions = moment.tz.names();

  this.isInvalidTimezone = ko.observable(false);

  // Returns the timezone from the end of the type string
  this.timezone = this.autoDispose(ko.computed({
    owner: this,
    read: function() {
      return gutil.removePrefix(field.column().type(), "DateTime:");
    },
    write: function(val) {
      if (_.contains(this.timezoneOptions, val)) {
        field.column().type.setAndSave('DateTime:' + val);
        this.isInvalidTimezone(false);
      } else {
        this.isInvalidTimezone(true);
      }
    }
  }));

  this.timeFormat = this.options.prop('timeFormat');
  this.isCustomTimeFormat = this.options.prop('isCustomTimeFormat');

  this.timeFormatOptions = [
    'h:mma',
    'h:mma z',
    'HH:mm',
    'HH:mm z',
    'HH:mm:ss',
    'HH:mm:ss z',
    'Custom'
  ];

  // Helper to set 'timeFormat' and 'isCustomTimeFormat' from the set of default time format strings.
  this.standardTimeFormat = this.autoDispose(ko.computed({
    owner: this,
    read: function() { return this.isCustomTimeFormat() ? 'Custom' : this.timeFormat(); },
    write: function(val) {
      if (val === 'Custom') { this.isCustomTimeFormat.setAndSave(true); }
      else {
        this.isCustomTimeFormat.setAndSave(false);
        this.timeFormat.setAndSave(val);
      }
    }
  }));
}
dispose.makeDisposable(DateTimeTextBox);
_.extend(DateTimeTextBox.prototype, DateTextBox.prototype);

/**
 * Builds the config dom for the DateTime TextBox. If isTransformConfig is true,
 * builds only the necessary dom for the transform config menu.
 */
DateTimeTextBox.prototype.buildConfigDom = function(isTransformConfig) {
  var self = this;

  // Set up autocomplete for the timezone entry.
  var textDom = kf.text(self.timezone);
  var tzInput = textDom.querySelector('input');
  $(tzInput).autocomplete({
    source: self.timezoneOptions,
    minLength: 1,
    delay: 10,
    select: function(event, ui) {
      self.timezone(ui.item.value);
      return false;
    }
  });

  return dom('div',
    kf.row(
      1, dom('div.glyphicon.glyphicon-globe.config_icon'),
      8, kf.label('Timezone'),
      9, dom(textDom,
        kd.toggleClass('invalid-text', this.isInvalidTimezone),
        dom.testId("Widget_tz"),
        testId('widget-tz'))
    ),
    self.buildDateConfigDom(),
    kf.row(
      1, dom('div.glyphicon.glyphicon-dashboard.config_icon'),
      8, kf.label('Time Format'),
      9, dom(kf.select(self.standardTimeFormat, self.timeFormatOptions), dom.testId("Widget_timeFormat"))
    ),
    kd.maybe(self.isCustomTimeFormat, function() {
      return dom(kf.text(self.timeFormat), dom.testId("Widget_timeCustomFormat"));
    }),
    isTransformConfig ? null : cssRow(
      alignmentSelect(fromKoSave(this.alignment))
    )
  );
};

DateTimeTextBox.prototype.buildTransformConfigDom = function() {
  return this.buildConfigDom(true);
};

module.exports = DateTimeTextBox;
