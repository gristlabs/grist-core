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
const {cssRow, cssLabel} = require('app/client/ui/RightPanel');
const {cssTextInput} = require("app/client/ui2018/editableLabel");
const {styled, fromKo} = require('grainjs');
const {select} = require('app/client/ui2018/menus');


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
  var textDom = textbox(self.timezone);
  var tzInput = textDom.querySelector('input');
  $(tzInput).autocomplete({
    source: self.timezoneOptions,
    classes : {
      "ui-autocomplete": cssAutocomplete.className
    },
    minLength: 1,
    delay: 10,
    position : { my: "left top", at: "left bottom+4" },
    select: function(event, ui) {
      self.timezone(ui.item.value);
      return false;
    }
  });

  return dom('div',
    cssLabel("Timezone"),
    cssRow(
      dom(textDom,
        kd.toggleClass('invalid-text', this.isInvalidTimezone),
        dom.testId("Widget_tz"),
        dom.on('keydown', (e) => {
          switch (e.keyCode) {
            case 13: $(tzInput).autocomplete('close'); break;
          }
        }),
        testId('widget-tz')
      )
    ),
    self.buildDateConfigDom(),
    cssLabel("Time Format"),
    cssRow(dom(select(fromKo(self.standardTimeFormat), self.timeFormatOptions), dom.testId("Widget_timeFormat"))),
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

// override styles for jquery auto-complete - to make it look like weasel select menu
const cssAutocomplete = styled('ui', `
  min-width: 208px;
  font-family: var(--grist-font-family);
  font-size: var(--grist-medium-font-size);
  line-height: initial;
  max-width: 400px;
  border: 0px !important;
  max-height: 500px;
  overflow-y: auto;
  margin-top: 3px;
  padding: 8px 0px 16px 0px;
  box-shadow: 0 2px 20px 0 rgb(38 38 51 / 60%);
  & li {
    padding: 8px 16px;
  }
  & li:hover {
    background: #5AC09C;
  }
  & li div {
    border: 0px !important;
    margin: 0px !important;
  }
  & li:hover div {
    background: transparent !important;
    color: white !important;
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
