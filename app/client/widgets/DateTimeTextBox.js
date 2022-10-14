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
const {alignmentSelect, cssButtonSelect} = require('app/client/ui2018/buttonSelect');
const {cssRow, cssLabel} = require('app/client/ui/RightPanelStyles');
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

  this.timeFormat = this.field.config.options.prop('timeFormat');
  this.isCustomTimeFormat = this.field.config.options.prop('isCustomTimeFormat');
  this.mixedTimeFormat = ko.pureComputed(() => this.timeFormat() === null || this.isCustomTimeFormat() === null);

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
  const disabled = ko.pureComputed(() => {
    return this.field.config.options.disabled('timeFormat')() || this.field.column().disableEditData();
  });
  const alignment = fromKoSave(this.field.config.options.prop('alignment'));
  return dom('div',
    cssLabel("Timezone"),
    cssRow(
      gdom.create(buildTZAutocomplete, moment, fromKo(this._timezone), this._setTimezone,
        { disabled : fromKo(disabled)}),
      ),
    this.buildDateConfigDom(),
    cssLabel("Time Format"),
    cssRow(dom(
      select(
        fromKo(this.standardTimeFormat),
        [...timeFormatOptions, "Custom"],
        { disabled : fromKo(disabled), defaultLabel: 'Mixed format' }
      ),
      dom.testId("Widget_timeFormat")
    )),
    kd.maybe(() => !this.mixedTimeFormat() && this.isCustomTimeFormat(), () => {
      return cssRow(
        dom(
          textbox(this.timeFormat, { disabled: this.field.config.options.disabled('timeFormat')}),
          dom.testId("Widget_timeCustomFormat")
        )
      );
    }),
    isTransformConfig ? null : cssRow(
      alignmentSelect(
        alignment,
        cssButtonSelect.cls('-disabled', this.field.config.options.disabled('alignment')),
      )
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
function textbox(value, options) {
  const textDom = kf.text(value, options || {});
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
