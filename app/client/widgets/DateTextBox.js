var _ = require('underscore');
var ko = require('knockout');
var dom = require('../lib/dom');
var dispose = require('../lib/dispose');
var kd = require('../lib/koDom');
var kf = require('../lib/koForm');
var AbstractWidget = require('./AbstractWidget');

const {FieldRulesConfig} = require('app/client/components/Forms/FormConfig');
const {fromKoSave} = require('app/client/lib/fromKoSave');
const {alignmentSelect, cssButtonSelect} = require('app/client/ui2018/buttonSelect');
const {cssLabel, cssRow} = require('app/client/ui/RightPanelStyles');
const {cssTextInput} = require("app/client/ui2018/editableLabel");
const {dom: gdom, styled, fromKo} = require('grainjs');
const {select} = require('app/client/ui2018/menus');
const {dateFormatOptions} = require('app/common/parseDate');

/**
 * DateTextBox - The most basic widget for displaying simple date information.
 */
function DateTextBox(field) {
  AbstractWidget.call(this, field);

  this.alignment = this.options.prop('alignment');

  // These properties are only used in configuration.
  this.dateFormat = this.field.config.options.prop('dateFormat');
  this.isCustomDateFormat = this.field.config.options.prop('isCustomDateFormat');
  this.mixedDateFormat = ko.pureComputed(() => this.dateFormat() === null || this.isCustomDateFormat() === null);

  // Helper to set 'dateFormat' and 'isCustomDateFormat' from the set of default date format strings.
  this.standardDateFormat = this.autoDispose(ko.computed({
    owner: this,
    read: function() { return this.mixedDateFormat() ? null : this.isCustomDateFormat() ? 'Custom' : this.dateFormat(); },
    write: function(val) {
      if (val === 'Custom') { this.isCustomDateFormat.setAndSave(true); }
      else {
        this.field.config.options.update({isCustomDateFormat: false, dateFormat: val});
        this.field.config.options.save();
      }
    }
  }));

  // An observable that always returns `UTC`, eases DateTimeEditor inheritance.
  this.timezone = ko.observable('UTC');
}
dispose.makeDisposable(DateTextBox);
_.extend(DateTextBox.prototype, AbstractWidget.prototype);

DateTextBox.prototype.buildDateConfigDom = function() {
  const disabled = this.field.config.options.disabled('dateFormat');
  return dom('div',
    cssLabel("Date Format"),
    cssRow(dom(select(
      fromKo(this.standardDateFormat),
      [...dateFormatOptions, "Custom"],
      { disabled, defaultLabel: "Mixed format" },
    ), dom.testId("Widget_dateFormat"))),
    kd.maybe(() => !this.mixedDateFormat() && this.isCustomDateFormat(), () => {
      return cssRow(dom(
        textbox(this.dateFormat, { disabled }),
      dom.testId("Widget_dateCustomFormat")));
    })
  );
};

DateTextBox.prototype.buildConfigDom = function() {
  return dom('div',
    this.buildDateConfigDom(),
    cssRow(
      alignmentSelect(
        fromKoSave(this.field.config.options.prop('alignment')),
        cssButtonSelect.cls('-disabled', this.field.config.options.disabled('alignment')),
      ),
    )
  );
};

DateTextBox.prototype.buildTransformConfigDom = function() {
  return this.buildDateConfigDom();
};

DateTextBox.prototype.buildFormConfigDom = function() {
  return [
    gdom.create(FieldRulesConfig, this.field),
  ];
};

DateTextBox.prototype.buildDom = function(row) {
  let value = row[this.field.colId()];
  return dom('div.field_clip',
    kd.style('text-align', this.alignment),
    kd.text(() => row._isAddRow() || this.isDisposed() ? '' : this.valueFormatter().format(value()))
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
function textbox(value, options) {
  const textDom = kf.text(value, options ?? {});
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
