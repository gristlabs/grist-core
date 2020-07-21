// tslint:disable:max-classes-per-file

import {CellValue} from 'app/common/DocActions';
import * as gristTypes from 'app/common/gristTypes';
import * as gutil from 'app/common/gutil';
import {buildNumberFormat, NumberFormatOptions} from 'app/common/NumberFormat';
import * as moment from 'moment-timezone';

// Some text to show on cells whose values are pending.
export const PENDING_DATA_PLACEHOLDER = "Loading...";

/**
 * Formats a custom object received as a value in a DocAction, as "Constructor(args...)".
 * E.g. ["Foo", 1, 2, 3] becomes the string "Foo(1, 2, 3)".
 */
export function formatObject(args: [string, ...any[]]): string {
  const objType = args[0], objArgs = args.slice(1);
  switch (objType) {
    case 'L': return JSON.stringify(objArgs);
    // First arg is seconds since epoch (moment takes ms), second arg is timezone
    case 'D': return moment.tz(objArgs[0] * 1000, objArgs[1]).format("YYYY-MM-DD HH:mm:ssZ");
    case 'd': return moment.tz(objArgs[0] * 1000, 'UTC').format("YYYY-MM-DD");
    case 'R': return `${objArgs[0]}[${objArgs[1]}]`;
    case 'E': return gristTypes.formatError(args);
    case 'P': return PENDING_DATA_PLACEHOLDER;
  }
  return objType + "(" + JSON.stringify(objArgs).slice(1, -1) + ")";
}

/**
 * Formats a value of unknown type, using formatObject() for encoded objects.
 */
export function formatUnknown(value: any): string {
  return gristTypes.isObject(value) ? formatObject(value) : (value == null ? "" : String(value));
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
    return value;
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
