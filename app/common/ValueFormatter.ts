// tslint:disable:max-classes-per-file

import {csvEncodeRow} from 'app/common/csvFormat';
import {CellValue} from 'app/common/DocActions';
import {DocData} from 'app/common/DocData';
import {DocumentSettings} from 'app/common/DocumentSettings';
import * as gristTypes from 'app/common/gristTypes';
import {getReferencedTableId, isList} from 'app/common/gristTypes';
import * as gutil from 'app/common/gutil';
import {isHiddenTable} from 'app/common/isHiddenTable';
import {buildNumberFormat, NumberFormatOptions} from 'app/common/NumberFormat';
import {createParserOrFormatterArguments, ReferenceParsingOptions} from 'app/common/ValueParser';
import {GristObjCode} from 'app/plugin/GristData';
import {decodeObject, GristDateTime} from 'app/plugin/objtypes';
import moment from 'moment-timezone';
import isPlainObject = require('lodash/isPlainObject');

export {PENDING_DATA_PLACEHOLDER} from 'app/plugin/objtypes';

export interface FormatOptions {
  [option: string]: any;
}

/**
 * Formats a value of any type generically (with no type-specific options).
 */
export function formatUnknown(value: CellValue): string {
  return formatDecoded(decodeObject(value));
}

/**
 * Returns true if the array contains other arrays or structured objects,
 * indicating that the list should be formatted like JSON rather than CSV.
 */
function hasNestedObjects(value: any[]) {
  return value.some(v => typeof v === 'object' && v && (Array.isArray(v) || isPlainObject(v)));
}

/**
 * Formats a decoded Grist value for displaying it. For top-level values, formats them the way we
 * like to see them in a cell or in, say, CSV export.
 * For top-level lists containing only simple values like strings and dates, formats them as a CSV row.
 * Nested lists and objects are formatted slightly differently, with quoted strings and ISO format for dates.
 */
export function formatDecoded(value: unknown, isTopLevel: boolean = true): string {
  if (typeof value === 'object' && value) {
    if (Array.isArray(value)) {
      if (!isTopLevel || hasNestedObjects(value)) {
        return '[' + value.map(v => formatDecoded(v, false)).join(', ') + ']';
      } else {
        return csvEncodeRow(value.map(v => formatDecoded(v, true)), {prettier: true});
      }
    } else if (isPlainObject(value)) {
      const obj: any = value;
      const items = Object.keys(obj).map(k => `${JSON.stringify(k)}: ${formatDecoded(obj[k], false)}`);
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
  protected isRightType: IsRightTypeFunc;

  constructor(public type: string, public widgetOpts: FormatOptions, public docSettings: DocumentSettings) {
    this.isRightType = gristTypes.isRightType(gristTypes.extractTypeFromColType(type)) ||
      gristTypes.isRightType('Any')!;
  }

  /**
   * Formats using this.format() if a value is of the right type for this formatter, or using
   * AnyFormatter otherwise. This method the recommended API. There is no need to override it.
   */
  public formatAny(value: any, translate?: (val: string) => string): string {
    return this.isRightType(value) ? this.format(value, translate) : formatUnknown(value);
  }

  /**
   * Formats a value that matches the type of this formatter. This should be overridden by derived
   * classes to handle values in formatter-specific ways.
   */
  protected format(value: any, _translate?: (val: string) => string): string {
    return String(value);
  }
}

export class BoolFormatter extends BaseFormatter {
  public format(value: boolean | 0 | 1, translate?: (val: string) => string): string {
    if (typeof value === 'boolean' && translate) {
      return translate(String(value));
    }
    return super.format(value, translate);
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

  constructor(type: string, options: NumberFormatOptions, docSettings: DocumentSettings) {
    super(type, options, docSettings);
    this._numFormat = buildNumberFormat(options, docSettings);
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
  constructor(type: string, opts: FormatOptions, docSettings: DocumentSettings) {
    super(type, {decimals: 0, ...opts}, docSettings);
  }
}

export interface DateFormatOptions {
  dateFormat?: string;
}

class DateFormatter extends BaseFormatter {
  protected _dateTimeFormat: string;
  private _timezone: string;

  constructor(type: string, widgetOpts: DateFormatOptions, docSettings: DocumentSettings, timezone: string = 'UTC') {
    super(type, widgetOpts, docSettings);
    // Allow encoded dates/datetimes ([d, number] or [D, number, timezone])
    // which are found in formula columns of type Any,
    // particularly reference display columns which are formatted here according to the visible column
    // which will have the correct column type and options.
    // Since these encoded objects are not expected in a Date/Datetime column and require
    // being handled differently from just a number,
    // we don't change `gristTypes.isRightType` which is used elsewhere.
    this.isRightType = (value: any) => (
      value === null ||
      typeof value === "number" ||
      Array.isArray(value) && (
        value[0] === GristObjCode.Date ||
        value[0] === GristObjCode.DateTime
      )
    );
    this._dateTimeFormat = widgetOpts.dateFormat || 'YYYY-MM-DD';
    this._timezone = timezone;
  }

  public format(value: any): string {
    if (value === null) {
      return '';
    }

    // For a DateTime object in an Any column, use the provided timezone (`value[2]`)
    // Otherwise use the timezone configured for a DateTime column.
    let timezone = this._timezone;
    if (Array.isArray(value)) {
      timezone = value[2] || timezone;
      value = value[1];
    }
    // Now `value` is a number

    const time = moment.tz(value * 1000, timezone);
    return time.format(this._dateTimeFormat);
  }
}

export interface DateTimeFormatOptions extends DateFormatOptions {
  timeFormat?: string;
}

class DateTimeFormatter extends DateFormatter {
  constructor(type: string, widgetOpts: DateTimeFormatOptions, docSettings: DocumentSettings) {
    const timezone = gutil.removePrefix(type, "DateTime:") || '';
    // Pass up the original widgetOpts. It's helpful to have them available; e.g. ExcelFormatter
    // takes options from an initialized ValueFormatter.
    super(type, widgetOpts, docSettings, timezone);
    const timeFormat = widgetOpts.timeFormat === undefined ? 'h:mma' : widgetOpts.timeFormat;
    this._dateTimeFormat = (widgetOpts.dateFormat || 'YYYY-MM-DD') + " " + timeFormat;
  }
}

class RowIdFormatter extends BaseFormatter {
  public widgetOpts: { tableId: string };

  public format(value: number): string {
    return value > 0 ? `${this.widgetOpts.tableId}[${value}]` : "";
  }
}

interface ReferenceFormatOptions {
  visibleColFormatter?: BaseFormatter;
}

class ReferenceFormatter extends BaseFormatter {
  public widgetOpts: ReferenceFormatOptions;
  protected visibleColFormatter: BaseFormatter;

  constructor(type: string, widgetOpts: ReferenceFormatOptions, docSettings: DocumentSettings) {
    super(type, widgetOpts, docSettings);
    // widgetOpts.visibleColFormatter shouldn't be undefined, but it can be if a referencing column
    // is displaying another referencing column, which is partially prohibited in the UI but still possible.
    this.visibleColFormatter = widgetOpts.visibleColFormatter ||
      createFormatter('Id', {tableId: getReferencedTableId(type)}, docSettings);
  }

  public formatAny(value: any): string {
    /*
    An invalid value in a referencing column is saved as a string and becomes AltText in the data engine.
    Then the display column formula (e.g. $person.first_name) raises an InvalidTypedValue trying to access
    an attribute of that AltText.
    This would normally lead to the formatter displaying `#Invalid Ref[List]: ` before the string value.
    That's inconsistent with how the cell is displayed (just the string value in pink)
    and with how invalid values in other columns are formatted (just the string).
    It's just a result of the formatter receiving a value from the display column, not the actual column.
    It's also likely to inconvenience users trying to import/migrate/convert data.
    So we suppress the error here and just show the text.
    It's still technically possible for the column to display an actual InvalidTypedValue exception from a formula
    and this will suppress that too, but this is unlikely and seems worth it.
    */
    if (
      Array.isArray(value)
      && value[0] === GristObjCode.Exception
      && value[1] === "InvalidTypedValue"
      && value[2]?.startsWith?.("Ref")
    ) {
      return value[3];
    }
    return this.formatNotInvalidRef(value);
  }

  protected formatNotInvalidRef(value: any) {
    return this.visibleColFormatter.formatAny(value);
  }
}

class ReferenceListFormatter extends ReferenceFormatter {
  protected formatNotInvalidRef(value: any): string {
    // Part of this repeats the logic in BaseFormatter.formatAny which is overridden in ReferenceFormatter
    // It also ensures that complex lists (e.g. if this RefList is displaying a ChoiceList)
    // are formatted as JSON instead of CSV.
    if (!isList(value) || hasNestedObjects(decodeObject(value) as CellValue[])) {
      return formatUnknown(value);
    }
    // In the most common case, lists of simple objects like strings or dates
    // are formatted like a CSV.
    // This is similar to formatUnknown except the inner values are
    // formatted according to the visible column options.
    const formattedValues = value.slice(1).map(v => super.formatNotInvalidRef(v));
    return csvEncodeRow(formattedValues, {prettier: true});
  }
}

const formatters: { [name: string]: typeof BaseFormatter } = {
  Numeric: NumericFormatter,
  Int: IntFormatter,
  Bool: BoolFormatter,
  Date: DateFormatter,
  DateTime: DateTimeFormatter,
  Ref: ReferenceFormatter,
  RefList: ReferenceListFormatter,
  Id: RowIdFormatter,
  // We don't list anything that maps to AnyFormatter, since that's the default.
};

/**
 * Takes column type, widget options and document settings, and returns a constructor
 * with a format function that can properly convert a value passed to it into the
 * right format for that column.
 */
export function createFormatter(type: string, widgetOpts: FormatOptions, docSettings: DocumentSettings): BaseFormatter {
  const ctor = formatters[gristTypes.extractTypeFromColType(type)] || AnyFormatter;
  return new ctor(type, widgetOpts, docSettings);
}

export interface FullFormatterArgs {
  docData: DocData;
  type: string;
  widgetOpts: FormatOptions;
  visibleColType: string;
  visibleColWidgetOpts: FormatOptions;
  docSettings: DocumentSettings;
}

/**
 * Returns a constructor
 * with a format function that can properly convert a value passed to it into the
 * right format for that column.
 *
 * Pass fieldRef (a row ID of _grist_Views_section_field) to use the settings of that view field
 * instead of the table column.
 */
export function createFullFormatterFromDocData(
  docData: DocData,
  colRef: number,
  fieldRef?: number,
): BaseFormatter {
  const [type, widgetOpts, docSettings] = createParserOrFormatterArguments(docData, colRef, fieldRef);
  const {visibleColType, visibleColWidgetOpts} = widgetOpts as ReferenceParsingOptions;
  return createFullFormatterRaw({
    docData,
    type,
    widgetOpts,
    visibleColType,
    visibleColWidgetOpts,
    docSettings,
  });
}

export function createFullFormatterRaw(args: FullFormatterArgs) {
  const {type, widgetOpts, docSettings} = args;
  const visibleColFormatter = createVisibleColFormatterRaw(args);
  return createFormatter(type, {...widgetOpts, visibleColFormatter}, docSettings);
}

export function createVisibleColFormatterRaw(
  {
    docData,
    docSettings,
    type,
    visibleColType,
    visibleColWidgetOpts,
    widgetOpts
  }: FullFormatterArgs
): BaseFormatter {
  let referencedTableId = gristTypes.getReferencedTableId(type);
  if (!referencedTableId) {
    return createFormatter(type, widgetOpts, docSettings);
  } else if (visibleColType) {
    return createFormatter(visibleColType, visibleColWidgetOpts, docSettings);
  } else {
    // This column displays the Row ID, e.g. Table1[2]
    // Make referencedTableId empty if the table is hidden
    const tablesData = docData.getMetaTable("_grist_Tables");
    const tableRef = tablesData.findRow("tableId", referencedTableId);
    if (isHiddenTable(tablesData, tableRef)) {
      referencedTableId = "";
    }
    return createFormatter('Id', {tableId: referencedTableId}, docSettings);
  }
}
