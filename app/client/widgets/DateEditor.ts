import {CommandGroup, createGroup} from 'app/client/components/commands';
import {loadScript} from 'app/client/lib/loadScript';
import {detectCurrentLang} from 'app/client/lib/localization';
import {FieldOptions} from 'app/client/widgets/NewBaseEditor';
import {NTextEditor} from 'app/client/widgets/NTextEditor';
import {CellValue} from "app/common/DocActions";
import {parseDate, TWO_DIGIT_YEAR_THRESHOLD} from 'app/common/parseDate';

import moment from 'moment-timezone';
import {dom} from 'grainjs';

// These are all the locales available for the datepicker. Having a prepared list lets us find a
// suitable one without trying combinations that don't exist. This list can be rebuilt using:
//    ls bower_components/bootstrap-datepicker/dist/locales/bootstrap-datepicker.* | cut -d. -f2 | xargs echo
// eslint-disable-next-line max-len
const availableLocales = 'ar-tn ar az bg bm bn br bs ca cs cy da de el en-AU en-CA en-GB en-IE en-NZ en-ZA eo es et eu fa fi fo fr-CH fr gl he hi hr hu hy id is it-CH it ja ka kh kk km ko kr lt lv me mk mn ms nl-BE nl no oc pl pt-BR pt ro rs-latin rs ru si sk sl sq sr-latin sr sv sw ta tg th tk tr uk uz-cyrl uz-latn vi zh-CN zh-TW';

monkeyPatchDatepicker();

/**
 * DateEditor - Editor for Date type. Includes a dropdown datepicker.
 *  See reference: http://bootstrap-datepicker.readthedocs.org/en/latest/index.html
 */
export class DateEditor extends NTextEditor {
  protected safeFormat: string;     // Format that specifies a complete date.

  private _dateFormat: string|undefined = this.options.field.widgetOptionsJson.peek().dateFormat;
  private _locale = detectCurrentLang();
  private _keyboardNav = false;     // Whether keyboard navigation is active for the datepicker.

  constructor(
    options: FieldOptions,
    protected timezone: string = 'UTC',     // For use by the derived DateTimeEditor.
  ) {
    super(options);

    // Update moment format string to represent a date unambiguously.
    this.safeFormat = makeFullMomentFormat(this._dateFormat || '');

    // Set placeholder to current date(time), unless in read-only mode.
    if (!options.readonly) {
      // Use the default local timezone to format the placeholder date.
      // TODO: this.timezone is better for DateTime; gristDoc.docInfo.timezone.peek() is better for Date.
      const defaultTimezone = moment.tz.guess();
      const placeholder = moment.tz(defaultTimezone).format(this.safeFormat);
      this.textInput.setAttribute('placeholder', placeholder);
    }

    const cellValue = this.formatValue(options.cellValue, this.safeFormat, true);

    // Set the edited value, if not explicitly given, to the formatted version of cellValue.
    this.textInput.value = options.state ?? options.editValue ?? cellValue;

    if (!options.readonly) {
      // When the up/down arrow is pressed, modify the datepicker options to take control of
      // the arrow keys for date selection.
      const datepickerCommands = {
        ...options.commands,
        datepickerFocus: () => { this._allowKeyboardNav(true); }
      };
      const datepickerCommandGroup = this.autoDispose(createGroup(datepickerCommands, this, true));
      this._attachDatePicker(datepickerCommandGroup)
        .catch(e => console.error("Error attaching datepicker", e));
    }
  }

  public getCellValue() {
    const timestamp = parseDate(this.textInput.value, {
      dateFormat: this.safeFormat,
      timezone: this.timezone
    });
    return timestamp !== null ? timestamp : this.textInput.value;
  }

  // Moment value formatting helper.
  protected formatValue(value: CellValue, formatString: string|undefined, shouldFallBackToValue: boolean) {
    if (typeof value === 'number' && formatString) {
      return moment.tz(value*1000, this.timezone).format(formatString);
    } else {
      // If value is AltText, return it unchanged. This way we can see it and edit in the editor.
      return (shouldFallBackToValue && typeof value === 'string') ? value : "";
    }
  }

  // Helper to allow/disallow keyboard navigation within the datepicker.
  private _allowKeyboardNav(bool: boolean) {
    if (this._keyboardNav !== bool) {
      this._keyboardNav = bool;
      $(this.textInput).data().datepicker.o.keyboardNavigation = bool;
      // Force parse must be turned on with keyboard navigation, since it forces the highlighted date
      // to be used when enter is pressed. Otherwise, keyboard date selection will have no effect.
      $(this.textInput).data().datepicker.o.forceParse = bool;
    }
  }

  // Attach the datepicker.
  private async _attachDatePicker(datepickerCommands: CommandGroup) {
    const localeToUse = await loadLocale(this._locale);
    if (this.isDisposed()) { return; }    // Good idea to check after 'await'.
    const datePickerWidget = $(this.textInput).datepicker({
      keyboardNavigation: false,
      forceParse: false,
      todayHighlight: true,
      todayBtn: 'linked',
      assumeNearbyYear: TWO_DIGIT_YEAR_THRESHOLD,
      language: localeToUse,
      // Use the stripped format converted to one suitable for the datepicker.
      format: {
        toDisplay: (date: string, format: unknown, lang: unknown) => moment.utc(date).format(this.safeFormat),
        toValue: (date: string, format: unknown, lang: unknown) => {
          const timestampSec = parseDate(date, {
            dateFormat: this.safeFormat,
            // datepicker reads date in utc (ie: using date.getUTCDate()).
            timezone: 'UTC',
          });
          return (timestampSec === null) ? null : new Date(timestampSec * 1000);
        },
      },
    });
    this.onDispose(() => datePickerWidget.datepicker('destroy'));

    // NOTE: Datepicker interferes with normal enter and escape functionality. Add an event handler
    // to the DatePicker to prevent interference with normal behavior.
    datePickerWidget.on('keydown', (e) => {
      // If enter or escape is pressed, destroy the datepicker and re-dispatch the event.
      if (e.keyCode === 13 || e.keyCode === 27) {
        datePickerWidget.datepicker('destroy');
        // The current target of the event will be the textarea.
        setTimeout(() => e.currentTarget?.dispatchEvent(e.originalEvent!), 0);
      }
    });

    datePickerWidget.on('show', () => {
      // A workaround to allow clicking in the datepicker without losing focus.
      const datepickerElem: HTMLElement|null = document.querySelector('.datepicker');
      if (datepickerElem) {
        dom.update(datepickerElem,
          dom.attr('tabIndex', '0'),      // allows datepicker to gain focus
          dom.cls('clipboard_focus')      // tells clipboard to not steal focus from us
        );
      }

      // Attach command group to the input to allow switching keyboard focus to the datepicker.
      dom.update(this.textInput,
        // If the user inputs text into the textbox, take keyboard focus from the datepicker.
        dom.on('input', () => { this._allowKeyboardNav(false); }),
        datepickerCommands.attach()
      );
    });
    datePickerWidget.datepicker('show');
  }
}

// Updates the given Moment format to specify a complete date, so that the datepicker sees an
// unambiguous date in the textbox input. If the format is incomplete, fall back to YYYY-MM-DD.
function makeFullMomentFormat(mFormat: string): string {
  let safeFormat = mFormat;
  if (!safeFormat.includes('Y')) {
    safeFormat += " YYYY";
  }
  if (!safeFormat.includes('D') || !safeFormat.includes('M')) {
    safeFormat = 'YYYY-MM-DD';
  }
  return safeFormat;
}


let availableLocaleSet: Set<string>|undefined;
const loadedLocaleMap = new Map<string, string>();    // Maps requested locale to the one to use.

// Datepicker supports many languages. They just need to be loaded. Here we load the language we
// need on-demand, taking care not to load any language more than once (we don't need to assume
// there is only one language being used on the page, though in practice that may well be true).
async function loadLocale(locale: string): Promise<string> {
  return loadedLocaleMap.get(locale) ||
    loadedLocaleMap.set(locale, await doLoadLocale(locale)).get(locale)!;
}

async function doLoadLocale(locale: string): Promise<string> {
  if (!availableLocaleSet) {
    availableLocaleSet = new Set(availableLocales.split(/\s+/));
  }
  if (!availableLocaleSet.has(locale)) {
    const shortLocale = locale.split("-")[0];            // If "xx-YY" is not available, try "xx"
    if (!availableLocaleSet.has(shortLocale)) {
      // No special locale available. (This is even true for "en", which is fine since that's
      // loaded by default.)
      return locale;
    }
    locale = shortLocale;
  }

  console.debug(`DateEditor: loading locale ${locale}`);
  try {
    await loadScript(`bootstrap-datepicker/dist/locales/bootstrap-datepicker.${locale}.min.js`);
  } catch (e) {
    console.warn(`DateEditor: failed to load ${locale}`);
  }
  return locale;
}

// DatePicker unfortunately requires an <input> (not <textarea>). But textarea is better for us,
// because sometimes it's taller than a line, and an <input> looks worse. The following
// unconsionable hack tricks Datepicker into thinking anything it's attached to is an input.
// It's more reasonable to just modify boostrap-datepicker, but that has its own downside (with
// upgrading and minification). This hack, however, is simpler than other workarounds.
function monkeyPatchDatepicker() {
  const Datepicker = ($.fn as any).datepicker?.Constructor;
  if (Datepicker?.prototype) {
    // datepicker.isInput can now be set to anything, but when read, always returns true. Tricksy.
    Object.defineProperty(Datepicker.prototype, 'isInput', {
      get: function() { return true; },
      set: function(v) {},
    });
  }
}
