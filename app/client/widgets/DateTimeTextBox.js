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
const {cssRow, cssLabel} = require('app/client/ui/RightPanel');
const {cssTextInput} = require("app/client/ui2018/editableLabel");
const {dom: gdom, styled, fromKo} = require('grainjs');
const {select} = require('app/client/ui2018/menus');
const {buildTZAutocomplete} = require('app/client/widgets/TZAutocomplete');
const {timeFormatOptions} = require("app/common/parseDate");


/**
 * DateTimeTextBox - The most basic widget for displaying date and time information.
 */
function DateTimeTextBox(field) {
  DateTextBox.call(this, field);

  // Returns the timezone from the end of the type string
  this._timezone = this.autoDispose(ko.computed(() =>
    gutil.removePrefix(field.column().type(), "DateTime:")));

  this._setTimezone = (val) => field.column().type.setAndSave('DateTime:' + val);

  this.timeFormat = this.options.prop('timeFormat');
  this.isCustomTimeFormat = this.options.prop('isCustomTimeFormat');

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
  return dom('div',
    cssLabel("Timezone"),
    cssRow(
      gdom.create(buildTZAutocomplete, moment, fromKo(this._timezone), this._setTimezone,
        { disabled : fromKo(this.field.column().disableEditData)}),
      ),
    self.buildDateConfigDom(),
    cssLabel("Time Format"),
    cssRow(dom(select(fromKo(self.standardTimeFormat), [...timeFormatOptions, "Custom"]), dom.testId("Widget_timeFormat"))),
    kd.maybe(self.isCustomTimeFormat, function() {
      return cssRow(dom(textbox(self.timeFormat), dom.testId("Widget_timeCustomFormat")));
    }),
    isTransformConfig ? null : cssRow(
      alignmentSelect(fromKoSave(this.alignment))
    )
  );
};

DateTimeTextBox.prototype.buildTransformConfigDom = function() {
  return this.buildConfigDom(true);
};

// clean up old koform styles
const cssClean = styled('div', `
  flex: 1;
  margin: 0px;
`)

// override focus - to look like modern ui
const cssFocus = styled('div', `
  &:focus {
    outline: none;
    box-shadow: 0 0 3px 2px #5e9ed6;
    border: 1px solid transparent;
  }
`)


// helper method to create old style textbox that looks like a new one
function textbox(value) {
  const textDom = kf.text(value);
  const tzInput = textDom.querySelector('input');
  dom(tzInput,
    kd.cssClass(cssTextInput.className),
    kd.cssClass(cssFocus.className)
  );
  dom(textDom,
    kd.cssClass(cssClean.className)
  );
  return textDom;
}

module.exports = DateTimeTextBox;
