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

  // Strip moment format string to remove markers unsupported by the datepicker.
  this.safeFormat = DateEditor.parseMomentToSafe(this.dateFormat);

  this._readonly = options.readonly;

  // Use the default local timezone to format the placeholder date.
  let defaultTimezone = moment.tz.guess();
  let placeholder = moment.tz(defaultTimezone).format(this.safeFormat);
  if (options.readonly) {
    // clear placeholder for readonly mode
    placeholder = null;
  }
  TextEditor.call(this, _.defaults(options, { placeholder: placeholder }));

  const isValid = _.isNumber(options.cellValue);
  const formatted = this.formatValue(options.cellValue, this.safeFormat);
  // Formatted value will be empty if a cell contains an error,
  // but for a readonly mode we actually want to show what user typed
  // into the cell.
  const readonlyValue = isValid ? formatted : options.cellValue;
  const cellValue = options.readonly ? readonlyValue : formatted;

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
      // Convert the stripped format string to one suitable for the datepicker.
      format: DateEditor.parseSafeToCalendar(this.safeFormat)
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
DateEditor.prototype.formatValue = function(value, formatString) {
  if (_.isNumber(value) && formatString) {
    return moment.tz(value*1000, this.timezone).format(formatString);
  } else {
    return "";
  }
};

// Formats Moment string to remove markers unsupported by the datepicker.
// Moment reference: http://momentjs.com/docs/#/displaying/
DateEditor.parseMomentToSafe = function(mFormat) {
  // Remove markers not representing year, month, or date, and also DDD, DDDo, DDDD, d, do,
  // (and following whitespace/punctuation) since they are unsupported by the datepicker.
  mFormat = mFormat.replace(/\b(?:[^DMY\W]+|D{3,4}o*)\b\W+/g, '');
  // Convert other markers unsupported by the datepicker to similar supported markers.
  mFormat = mFormat.replace(/\b([MD])o\b/g, '$1'); // Mo -> M, Do -> D
  // Check which information the format contains. Format is only valid for editing if it
  // contains day, month and year information.
  var dayRe = /D{1,2}/g;
  var monthRe = /M{1,4}/g;
  var yearRe = /Y{2,4}/g;
  var valid = dayRe.test(mFormat) && monthRe.test(mFormat) && yearRe.test(mFormat);
  return valid ? mFormat : 'YYYY-MM-DD'; // Use basic format if given is invalid.
};

// Formats Moment string without datepicker unsupported markers for the datepicker.
// Datepicker reference: http://bootstrap-datepicker.readthedocs.org/en/latest/options.html#format
DateEditor.parseSafeToCalendar = function(sFormat) {
  // M -> m, MM -> mm, D -> d, DD -> dd, YY -> yy, YYYY -> yyyy
  sFormat = sFormat.replace(/\b(?:[MD]{1,2}|Y{2,4})\b/g, function(x) {
    return x.toLowerCase();
  });
  sFormat = sFormat.replace(/\bM{2}(?=M{1,2}\b)/g, ''); // MMM -> M, MMMM -> MM
  sFormat = sFormat.replace(/\bddd\b/g, 'D'); // ddd -> D
  return sFormat.replace(/\bdddd\b/g, 'DD'); // dddd -> DD
};

// Gets the language based on the current locale.
DateEditor.prototype.getLanguage = function() {
  // this requires a polyfill, i.e. https://www.npmjs.com/package/@formatjs/intl-locale
  // more info about ts: https://github.com/microsoft/TypeScript/issues/37326
  // return new Intl.Locale(locale).language;
  return this.locale.substr(0, this.locale.indexOf("-"));
}


module.exports = DateEditor;
