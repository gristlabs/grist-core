import {CellValue} from 'app/common/DocActions';
import * as gristTypes from 'app/common/gristTypes';
import * as gutil from 'app/common/gutil';
import {NumberFormatOptions} from 'app/common/NumberFormat';
import {FormatOptions, formatUnknown, IsRightTypeFunc} from 'app/common/ValueFormatter';
import {GristType} from 'app/plugin/GristData';
import {decodeObject} from 'app/plugin/objtypes';
import getSymbolFromCurrency from 'currency-symbol-map';
import {Style} from 'exceljs';
import moment from 'moment-timezone';

interface WidgetOptions extends NumberFormatOptions {
  textColor?: 'string';
  fillColor?: 'string';
  alignment?: 'left' | 'center' | 'right';
  dateFormat?: string;
  timeFormat?: string;
}
class BaseFormatter {
  protected isRightType: IsRightTypeFunc;
  protected widgetOptions: WidgetOptions;

  constructor(public type: string, public opts: FormatOptions) {
    this.isRightType = gristTypes.isRightType(gristTypes.extractTypeFromColType(type)) ||
      gristTypes.isRightType('Any')!;
    this.widgetOptions = opts;
  }

  /**
   * Formats a value that matches the type of this formatter. This should be overridden by derived
   * classes to handle values in formatter-specific ways.
   */
  public format(value: any): any {
    return value;
  }

  public style(): Partial<Style> {
    const argb = (hex: string) => `FF${hex.substr(1)}`;
    const style: Partial<Style> = {};
    if (this.widgetOptions.fillColor) {
      style.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: argb(this.widgetOptions.fillColor) }
      };
    }
    if (this.widgetOptions.textColor) {
      style.font = {
        color: { argb: argb(this.widgetOptions.textColor) }
      };
    }
    if (this.widgetOptions.alignment) {
      style.alignment = {
        horizontal: this.widgetOptions.alignment
      };
    }
    if (this.widgetOptions.dateFormat) {
      style.numFmt = excelDateFormat(this.widgetOptions.dateFormat, 'yyyy-mm-dd');
    }
    if (this.widgetOptions.timeFormat) {
      style.numFmt = excelDateFormat(this.widgetOptions.dateFormat!, 'yyyy-mm-dd') + ' ' +
        excelDateFormat(this.widgetOptions.timeFormat, 'h:mm am/pm');
    }
    // For number formats - we will support default excel formatting only,
    // those formats strings are the defaults that LibreOffice Calc is using.
    if (this.widgetOptions.numMode) {
      if (this.widgetOptions.numMode === 'currency') {
        // If currency name is undefined or null, it should be cast to unknown currency, because
        // "getSymbolFromCurrency" expect argument to be string
        const currencyName = this.widgetOptions.currency??"";
        const currencySymbol = getSymbolFromCurrency(currencyName)
          ?? this.widgetOptions.currency
          ?? "$";
        style.numFmt = `"${currencySymbol} "#,##0.000`;
      } else if (this.widgetOptions.numMode === 'percent') {
        style.numFmt = '0.00%';
      } else if (this.widgetOptions.numMode === 'decimal') {
        style.numFmt = '0.00';
      } else if (this.widgetOptions.numMode === 'scientific') {
        style.numFmt = '0.00E+00';
      }
    }
    return style;
  }

  /**
   * Formats using this.format() if a value is of the right type for this formatter, or using
   * formatUnknown (like AnyFormatter) otherwise, resulting in a string representation.
   */
  public formatAny(value: any): any {
    return this.isRightType(value) ? this.format(value) : formatUnknown(value);
  }
}

class AnyFormatter extends BaseFormatter {
  public format(value: any): any {
    return formatUnknown(value);
  }
}

class ChoiceListFormatter extends BaseFormatter {
  public format(value: any): any {
    const obj = decodeObject(value);
    if (Array.isArray(obj)) {
      return obj.join("; ");
    }
    return formatUnknown(value);
  }
}

class UnsupportedFormatter extends BaseFormatter {
  public format(value: any): any {
    return '';
  }
}

class NumberFormatter extends BaseFormatter {
  public format(value: any): any {
    return Number.isFinite(value) ? value : '';
  }
}

class DateFormatter extends BaseFormatter {
  private _timezone: string;

  constructor(type: string, opts: WidgetOptions, timezone: string = 'UTC') {
    opts.dateFormat = opts.dateFormat || 'YYYY-MM-DD';
    super(type, opts);
    this._timezone = timezone || 'UTC';
    // For native conversion - booleans are not a right type.
    this.isRightType = (value: CellValue) => typeof value === 'number';
  }

  public format(value: any): any {
    if (value === null) { return ''; }
    // convert time to correct timezone
    const time = moment(value * 1000).tz(this._timezone);
    // in case moment is not able to interpret this as a valid date
    // fallback to formatUnknown, for example for 0, NaN, Infinity
    if (!time) {
      return formatUnknown(value);
    }
    // make it look like a local time
    time.utc(true).local();
    // moment objects are mutable so we can just return original object.
    return time.toDate();
  }
}

class DateTimeFormatter extends DateFormatter {
  constructor(type: string, opts: WidgetOptions) {
    const timezone = gutil.removePrefix(type, "DateTime:") || '';
    opts.timeFormat = opts.timeFormat === undefined ? 'h:mma' : opts.timeFormat;
    super(type, opts, timezone);
  }
}

const formatters: Partial<Record<GristType, typeof BaseFormatter>> = {
  // for numbers - return javascript number
  Numeric: NumberFormatter,
  Int: NumberFormatter,
  // for booleans - return javascript booleans
  Bool: BaseFormatter,
  // for dates - return javascript Date object
  Date: DateFormatter,
  DateTime: DateTimeFormatter,
  ChoiceList: ChoiceListFormatter,
  // for attachments - return blank cell
  Attachments: UnsupportedFormatter,
  // for anything else - return string (use default AnyFormatter)
};

/**
 * Takes column type and format options and returns a constructor with a format function that can
 * properly convert a value passed to it into the right javascript object for that column.
 * Exceljs library is using javascript primitives to specify correct excel type.
 */
export function createExcelFormatter(type: string, opts: FormatOptions): BaseFormatter {
  const ctor = formatters[gristTypes.extractTypeFromColType(type) as GristType] || AnyFormatter;
  return new ctor(type, opts);
}

// ----------------------------------------------------------------------
// Helper functions
// ----------------------------------------------------------------------

// Mapping from moment-js basic date format tokens to excel numFmt basic tokens.
// We will convert all our predefined format to excel ones, and try to do our
// best on converting custom formats. If we fail on custom formats we will fall
// back to default ones.
// More on formats can be found:
// https://docs.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.numberingformats?view=openxml-2.8.1
// http://officeopenxml.com/WPdateTimeFieldSwitches.php
const mapping = new Map<string, string>();
mapping.set('YYYY', 'yyyy');
mapping.set('YY', 'yy');
mapping.set('M', 'm');
mapping.set('MM', 'mm');
mapping.set('MMM', 'mmm');
mapping.set('MMMM', 'mmmm');
mapping.set('D', 'd');
mapping.set('DD', 'dd');
mapping.set('DDD', 'ddd');
mapping.set('DDDD', 'dddd');
mapping.set('Do', 'dd'); // no direct match
mapping.set('L', 'yyyy-mm-dd');
mapping.set('LL', 'mmmmm d yyyy');
mapping.set('LLL', 'mmmmm d yyyy h:mm am/pm');
mapping.set('LLLL', 'ddd, mmmmm d yyyy h:mm am/pm');
mapping.set('h', 'h');
mapping.set('HH', 'hh');
// Minutes formats are the same as month's ones, but when they are after hour format
// they are treated as minutes.
mapping.set('m', 'm');
mapping.set('mm', 'mm');
mapping.set('mma', 'mm am/pm');
mapping.set('ss', 'ss');
mapping.set('s', 's');
mapping.set('a', 'am/pm');
mapping.set('A', 'am/pm');
mapping.set('S', '0');
mapping.set('SS', '00');
mapping.set('SSS', '000');
mapping.set('SSSS', '0000');
mapping.set('SSSSS', '00000');
mapping.set('SSSSSS', '000000');
// We will omit timezone formats
mapping.set('z', '');
mapping.set('zz', '');
mapping.set('Z', '');
mapping.set('ZZ', '');

/**
 * Converts Moment js format string to excel numFormat
 * @param format Moment js format string
 * @param def Default excel format string
 */
function excelDateFormat(format: string, def: string) {
  // split format to chunks by common separator
  const chunks = format.split(/([\s:.,-/]+)/);

  // try to map chunks
  for (let i = 0; i < chunks.length; i += 2) {
    const chunk = chunks[i];
    if (mapping.has(chunk)) {
      chunks[i] = mapping.get(chunk)!;
    } else {
      // fail on first mismatch
      return def;
    }
  }
  // fix the separators - they need to be prefixed by backslash
  for (let i = 1; i < chunks.length; i += 2) {
    const sep = chunks[i];
    if (sep === '-') {
      chunks[i] = '\\-';
    }
    if (sep.trim() === '') {
      chunks[i] = '\\' + sep;
    }
  }

  return chunks.join('');
}
