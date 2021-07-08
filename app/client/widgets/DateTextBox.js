var _ = require('underscore');
var ko = require('knockout');
var dom = require('../lib/dom');
var dispose = require('../lib/dispose');
var kd = require('../lib/koDom');
var kf = require('../lib/koForm');
var AbstractWidget = require('./AbstractWidget');

const {fromKoSave} = require('app/client/lib/fromKoSave');
const {alignmentSelect} = require('app/client/ui2018/buttonSelect');
const {cssRow, cssLabel} = require('app/client/ui/RightPanel');
const {cssTextInput} = require("app/client/ui2018/editableLabel");
const {styled, fromKo} = require('grainjs');
const {select} = require('app/client/ui2018/menus');

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
    cssLabel("Date Format"),
    cssRow(dom(select(fromKo(self.standardDateFormat), self.dateFormatOptions), dom.testId("Widget_dateFormat"))),
    kd.maybe(self.isCustomDateFormat, function() {
      return cssRow(dom(textbox(self.dateFormat), dom.testId("Widget_dateCustomFormat")));
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

// clean up old koform styles
const cssClean = styled('div', `
  flex: 1;
  margin: 0px;
`)

// override focus - to look like modern ui
const cssFocus = styled('div', `
  &:focus {
    outline: none;
    box-shadow: 0 0 3px 2px var(--grist-color-cursor);
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

module.exports = DateTextBox;
