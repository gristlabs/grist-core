/* global $, document */
const moment = require('moment-timezone');
const _ = require('underscore');
const gutil = require('app/common/gutil');
const commands = require('../components/commands');
const dispose = require('../lib/dispose');
const dom = require('../lib/dom');
const kd = require('../lib/koDom');
const TextEditor = require('./TextEditor');
const { parseDate, TWO_DIGIT_YEAR_THRESHOLD } = require('app/common/parseDate');

// DatePicker unfortunately requires an <input> (not <textarea>). But textarea is better for us,
// because sometimes it's taller than a line, and an <input> looks worse. The following
// unconsionable hack tricks Datepicker into thinking anything it's attached to is an input.
// It's more reasonable to just modify boostrap-datepicker, but that has its own downside (with
// upgrading and minification). This hack, however, is simpler than other workarounds.
var Datepicker = $.fn.datepicker.Constructor;
// datepicker.isInput can now be set to anything, but when read, always returns true. Tricksy.
Object.defineProperty(Datepicker.prototype, 'isInput', {
  get: function() { return true; },
  set: function(v) {},
});

/**
 * DateEditor - Editor for Date type. Includes a dropdown datepicker.
 *  See reference: http://bootstrap-datepicker.readthedocs.org/en/latest/index.html
 *
 * @param {String} options.timezone: Optional timezone to use instead of UTC.
 */
function DateEditor(options) {
  // A string that is always `UTC` in the DateEditor, eases DateTimeEditor inheritance.
  this.timezone = options.timezone || 'UTC';

  this.dateFormat = options.field.widgetOptionsJson.peek().dateFormat;
  this.locale = options.field.documentSettings.peek().locale;

  // Update moment format string to represent a date unambiguously.
  this.safeFormat = makeFullMomentFormat(this.dateFormat);

  // Use the default local timezone to format the placeholder date.
  const defaultTimezone = moment.tz.guess();
  let placeholder = moment.tz(defaultTimezone).format(this.safeFormat);
  if (options.readonly) {
    // clear placeholder for readonly mode
    placeholder = null;
  }
  TextEditor.call(this, _.defaults(options, { placeholder: placeholder }));

  const cellValue = this.formatValue(options.cellValue, this.safeFormat, true);

  // Set the edited value, if not explicitly given, to the formatted version of cellValue.
  this.textInput.value = gutil.undef(options.state, options.editValue, cellValue);

  if (!options.readonly) {
    // Indicates whether keyboard navigation is active for the datepicker.
    this._keyboardNav = false;

    // Attach the datepicker.
    this._datePickerWidget = $(this.textInput).datepicker({
      keyboardNavigation: false,
      forceParse: false,
      todayHighlight: true,
      todayBtn: 'linked',
      assumeNearbyYear: TWO_DIGIT_YEAR_THRESHOLD,
      // Datepicker supports most of the languages. They just need to be included in the bundle
      // or by script tag, i.e.
      // <script src="bootstrap-datepicker/dist/locales/bootstrap-datepicker.pl.min.js"></script>
      language : this.getLanguage(),
      // Use the stripped format converted to one suitable for the datepicker.
      format: {
        toDisplay: (date, format, language) => moment.utc(date).format(this.safeFormat),
        toValue: (date, format, language) => {
          const timestampSec = parseDate(date, {
            dateFormat: this.safeFormat,
            // datepicker reads date in utc (ie: using date.getUTCDate()).
            timezone: 'UTC',
          });
          return (timestampSec === null) ? null : new Date(timestampSec * 1000);
        },
      },
    });
    this.autoDisposeCallback(() => this._datePickerWidget.datepicker('destroy'));

    // NOTE: Datepicker interferes with normal enter and escape functionality. Add an event handler
    // to the DatePicker to prevent interference with normal behavior.
    this._datePickerWidget.on('keydown', e => {
      // If enter or escape is pressed, destroy the datepicker and re-dispatch the event.
      if (e.keyCode === 13 || e.keyCode === 27) {
        this._datePickerWidget.datepicker('destroy');
        // The current target of the event will be the textarea.
        setTimeout(() => e.currentTarget.dispatchEvent(e.originalEvent), 0);
      }
    });

    // When the up/down arrow is pressed, modify the datepicker options to take control of
    // the arrow keys for date selection.
    let datepickerCommands = Object.assign({}, options.commands, {
      datepickerFocus: () => { this._allowKeyboardNav(true); }
    });
    this._datepickerCommands = this.autoDispose(commands.createGroup(datepickerCommands, this, true));

    this._datePickerWidget.on('show', () => {
      // A workaround to allow clicking in the datepicker without losing focus.
      dom(document.querySelector('.datepicker'),
        kd.attr('tabIndex', 0),                   // allows datepicker to gain focus
        kd.toggleClass('clipboard_focus', true)   // tells clipboard to not steal focus from us
      );
      // Attach command group to the input to allow switching keyboard focus to the datepicker.
      dom(this.textInput,
        // If the user inputs text into the textbox, take keyboard focus from the datepicker.
        dom.on('input', () => { this._allowKeyboardNav(false); }),
        this._datepickerCommands.attach()
      );
    });
  }
}

dispose.makeDisposable(DateEditor);
_.extend(DateEditor.prototype, TextEditor.prototype);

/** @inheritdoc */
DateEditor.prototype.getCellValue = function() {
  let timestamp = parseDate(this.textInput.value, {
    dateFormat: this.safeFormat,
    timezone: this.timezone
  });
  return timestamp !== null ? timestamp : this.textInput.value;
};

// Helper to allow/disallow keyboard navigation within the datepicker.
DateEditor.prototype._allowKeyboardNav = function(bool) {
  if (this._keyboardNav !== bool) {
    this._keyboardNav = bool;
    $(this.textInput).data().datepicker.o.keyboardNavigation = bool;
    // Force parse must be turned on with keyboard navigation, since it forces the highlighted date
    // to be used when enter is pressed. Otherwise, keyboard date selection will have no effect.
    $(this.textInput).data().datepicker.o.forceParse = bool;
  }
};

// Moment value formatting helper.
DateEditor.prototype.formatValue = function(value, formatString, shouldFallBackToValue) {
  if (_.isNumber(value) && formatString) {
    return moment.tz(value*1000, this.timezone).format(formatString);
  } else {
    // If value is AltText, return it unchanged. This way we can see it and edit in the editor.
    return (shouldFallBackToValue && typeof value === 'string') ? value : "";
  }
};

// Gets the language based on the current locale.
DateEditor.prototype.getLanguage = function() {
  // this requires a polyfill, i.e. https://www.npmjs.com/package/@formatjs/intl-locale
  // more info about ts: https://github.com/microsoft/TypeScript/issues/37326
  // return new Intl.Locale(locale).language;
  return this.locale.substr(0, this.locale.indexOf("-"));
}

// Updates the given Moment format to specify a complete date, so that the datepicker sees an
// unambiguous date in the textbox input. If the format is incomplete, fall back to YYYY-MM-DD.
function makeFullMomentFormat(mFormat) {
  let safeFormat = mFormat;
  if (!safeFormat.includes('Y')) {
    safeFormat += " YYYY";
  }
  if (!safeFormat.includes('D') || !safeFormat.includes('M')) {
    safeFormat = 'YYYY-MM-DD';
  }
  return safeFormat;
}

module.exports = DateEditor;
