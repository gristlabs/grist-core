// tslint:disable:max-classes-per-file

import {CellValue} from 'app/common/DocActions';
import * as gristTypes from 'app/common/gristTypes';
import * as gutil from 'app/common/gutil';
import {buildNumberFormat, NumberFormatOptions} from 'app/common/NumberFormat';
import {decodeObject, GristDateTime} from 'app/plugin/objtypes';
import isPlainObject = require('lodash/isPlainObject');
import * as moment from 'moment-timezone';

export {PENDING_DATA_PLACEHOLDER} from 'app/plugin/objtypes';

/**
 * Formats a value of any type generically (with no type-specific options).
 */
export function formatUnknown(value: CellValue): string {
  return formatHelper(decodeObject(value));
}

/**
 * Formats a decoded Grist value for displaying it. For top-level values, formats them the way we
 * like to see them in a cell or in, say, CSV export. For lists and objects, nested values are
 * formatted slighly differently, with quoted strings and ISO format for dates.
 */
function formatHelper(value: unknown, isTopLevel: boolean = true): string {
  if (typeof value === 'object' && value) {
    if (Array.isArray(value)) {
      return '[' + value.map(v => formatHelper(v, false)).join(', ') + ']';
    } else if (isPlainObject(value)) {
      const obj: any = value;
      const items = Object.keys(obj).map(k => `${JSON.stringify(k)}: ${formatHelper(obj[k], false)}`);
      return '{' + items.join(', ') + '}';
    } else if (isTopLevel && value instanceof GristDateTime) {
      return moment(value).tz(value.timezone).format("YYYY-MM-DD HH:mm:ssZ");
    }
    return String(value);
  }
  if (isTopLevel) {
    return (value == null ? "" : String(value));
  }
  return JSON.stringify(value);
}

export type IsRightTypeFunc = (value: CellValue) => boolean;

export class BaseFormatter {
  public readonly isRightType: IsRightTypeFunc;

  constructor(public type: string, public opts: object) {
    this.isRightType = gristTypes.isRightType(gristTypes.extractTypeFromColType(type)) ||
      gristTypes.isRightType('Any')!;
  }

  /**
   * Formats a value that matches the type of this formatter. This should be overridden by derived
   * classes to handle values in formatter-specific ways.
   */
  public format(value: any): string {
    return String(value);
  }

  /**
   * Formats using this.format() if a value is of the right type for this formatter, or using
   * AnyFormatter otherwise. This method the recommended API. There is no need to override it.
   */
  public formatAny(value: any): string {
    return this.isRightType(value) ? this.format(value) : formatUnknown(value);
  }
}

class AnyFormatter extends BaseFormatter {
  public format(value: any): string {
    return formatUnknown(value);
  }
}

export class NumericFormatter extends BaseFormatter {
  private _numFormat: Intl.NumberFormat;
  private _formatter: (val: number) => string;

  constructor(type: string, options: NumberFormatOptions) {
    super(type, options);
    this._numFormat = buildNumberFormat(options);
    this._formatter = (options.numSign === 'parens') ? this._formatParens : this._formatPlain;
  }

  public format(value: any): string {
    return value === null ? '' : this._formatter(value);
  }

  public _formatPlain(value: number): string {
    return this._numFormat.format(value);
  }

  public _formatParens(value: number): string {
    // Surround positive numbers with spaces to align them visually to parenthesized numbers.
    return (value >= 0) ?
      ` ${this._numFormat.format(value)} ` :
      `(${this._numFormat.format(-value)})`;
  }
}

class IntFormatter extends NumericFormatter {
  constructor(type: string, opts: object) {
    super(type, {decimals: 0, ...opts});
  }
}

class DateFormatter extends BaseFormatter {
  private _dateTimeFormat: string;
  private _timezone: string;

  constructor(type: string, opts: {dateFormat?: string}, timezone: string = 'UTC') {
    super(type, opts);
    this._dateTimeFormat = opts.dateFormat || 'YYYY-MM-DD';
    this._timezone = timezone;
  }

  public format(value: any): string {
    if (value === null) { return ''; }
    const time = moment.tz(value * 1000, this._timezone);
    return time.format(this._dateTimeFormat);
  }
}

class DateTimeFormatter extends DateFormatter {
  constructor(type: string, opts: {dateFormat?: string; timeFormat?: string}) {
    const timezone = gutil.removePrefix(type, "DateTime:") || '';
    const timeFormat = opts.timeFormat === undefined ? 'h:mma' : opts.timeFormat;
    const dateFormat = (opts.dateFormat || 'YYYY-MM-DD') + " " + timeFormat;
    super(type, {dateFormat}, timezone);
  }
}

const formatters: {[name: string]: typeof BaseFormatter} = {
  Numeric: NumericFormatter,
  Int: IntFormatter,
  Bool: BaseFormatter,
  Date: DateFormatter,
  DateTime: DateTimeFormatter,
  // We don't list anything that maps to AnyFormatter, since that's the default.
};

/**
 * Takes column type and widget options and returns a constructor with a format function that can
 * properly convert a value passed to it into the right format for that column.
 */
export function createFormatter(type: string, opts: object): BaseFormatter {
  const ctor = formatters[gristTypes.extractTypeFromColType(type)] || AnyFormatter;
  return new ctor(type, opts);
}
