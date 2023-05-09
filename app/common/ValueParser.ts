import {csvDecodeRow} from 'app/common/csvFormat';
import {BulkColValues, CellValue, ColValues, UserAction} from 'app/common/DocActions';
import {DocData} from 'app/common/DocData';
import {DocumentSettings} from 'app/common/DocumentSettings';
import * as gristTypes from 'app/common/gristTypes';
import {getReferencedTableId, isFullReferencingType} from 'app/common/gristTypes';
import * as gutil from 'app/common/gutil';
import {safeJsonParse} from 'app/common/gutil';
import {NumberFormatOptions} from 'app/common/NumberFormat';
import NumberParse from 'app/common/NumberParse';
import {parseDateStrict, parseDateTime} from 'app/common/parseDate';
import {MetaRowRecord, TableData} from 'app/common/TableData';
import {DateFormatOptions, DateTimeFormatOptions, formatDecoded, FormatOptions} from 'app/common/ValueFormatter';
import {encodeObject} from 'app/plugin/objtypes';
import flatMap = require('lodash/flatMap');
import mapValues = require('lodash/mapValues');


export class ValueParser {
  constructor(public type: string, public widgetOpts: FormatOptions, public docSettings: DocumentSettings) {
  }

  public cleanParse(value: string): any {
    if (!value) {
      return value;
    }
    return this.parse(value) ?? value;
  }

  public parse(value: string): any {
    return value;
  }

}

class IdentityParser extends ValueParser {
}

export class NumericParser extends ValueParser {
  private _parse: NumberParse;

  constructor(type: string, options: NumberFormatOptions, docSettings: DocumentSettings) {
    super(type, options, docSettings);
    this._parse = NumberParse.fromSettings(docSettings, options);
  }

  public parse(value: string): number | null {
    return this._parse.parse(value)?.result ?? null;
  }
}

class DateParser extends ValueParser {
  public parse(value: string): any {
    return parseDateStrict(value, (this.widgetOpts as DateFormatOptions).dateFormat!);
  }
}

class DateTimeParser extends ValueParser {
  constructor(type: string, widgetOpts: DateTimeFormatOptions, docSettings: DocumentSettings) {
    super(type, widgetOpts, docSettings);
    const timezone = gutil.removePrefix(type, "DateTime:") || '';
    this.widgetOpts = {...widgetOpts, timezone};
  }

  public parse(value: string): any {
    return parseDateTime(value, this.widgetOpts);
  }
}


class ChoiceListParser extends ValueParser {
  public cleanParse(value: string): string[] | null {
    value = value.trim();
    const result = (
      this._parseJson(value) ||
      this._parseCsv(value)
    ).map(v => v.trim())
      .filter(v => v);
    if (!result.length) {
      return null;
    }
    return ["L", ...result];
  }

  private _parseJson(value: string): string[] | undefined {
    // Don't parse JSON non-arrays
    if (value[0] === "[") {
      const arr: unknown[] | null = safeJsonParse(value, null);
      return arr
        // Remove nulls and empty strings
        ?.filter(v => v || v === 0)
        // Convert values to strings, formatting nested JSON objects/arrays as JSON
        .map(v => formatDecoded(v));
    }
  }

  private _parseCsv(value: string): string[] {
    // Split everything on newlines which are not allowed by the choice editor.
    return flatMap(value.split(/[\n\r]+/), row => {
      return csvDecodeRow(row)
        .map(v => v.trim());
    });
  }
}

/**
 * This is different from other widget options which are simple JSON
 * stored on the field. These have to be specially derived
 * for referencing columns. See createParser.
 */
export interface ReferenceParsingOptions {
  visibleColId: string;
  visibleColType: string;
  visibleColWidgetOpts: FormatOptions;

  // If this is provided and loaded, the ValueParser will look up values directly.
  // Otherwise an encoded lookup will be produced for the data engine to handle.
  tableData?: TableData;
}

export class ReferenceParser extends ValueParser {
  public widgetOpts: ReferenceParsingOptions;
  public tableData = this.widgetOpts.tableData;
  public visibleColParser = createParserRaw(
    this.widgetOpts.visibleColType,
    this.widgetOpts.visibleColWidgetOpts,
    this.docSettings,
  );

  protected _visibleColId = this.widgetOpts.visibleColId;

  public parse(raw: string): any {
    const value = this.visibleColParser.cleanParse(raw);
    return this.lookup(value, raw);
  }

  public lookup(value: any, raw: string): any {
    if (value == null || value === "" || !raw) {
      return 0;  // default value for a reference column
    }

    if (this._visibleColId === 'id') {
      const n = Number(value);
      if (Number.isInteger(n)) {
        value = n;
        // Don't return yet because we need to check that this row ID exists
      } else {
        return raw;
      }
    }

    if (!this.tableData?.isLoaded) {
      const options: { column: string, raw?: string } = {column: this._visibleColId};
      if (value !== raw) {
        options.raw = raw;
      }
      return ['l', value, options];
    }

    return this.tableData.findMatchingRowId({[this._visibleColId]: value}) || raw;
  }
}

export class ReferenceListParser extends ReferenceParser {
  public parse(raw: string): any {
    let values: any[] | null;
    try {
      values = JSON.parse(raw);
    } catch {
      values = null;
    }
    if (!Array.isArray(values)) {
      // csvDecodeRow should never raise an exception
      values = csvDecodeRow(raw);
    }
    values = values.map(v => typeof v === "string" ? this.visibleColParser.cleanParse(v) : encodeObject(v));

    if (!values.length || !raw) {
      return null;  // null is the default value for a reference list column
    }

    if (this._visibleColId === 'id') {
      const numbers = values.map(Number);
      if (numbers.every(Number.isInteger)) {
        values = numbers;
        // Don't return yet because we need to check that these row IDs exist
      } else {
        return raw;
      }
    }

    if (!this.tableData?.isLoaded) {
      const options: { column: string, raw?: string } = {column: this._visibleColId};
      if (!(values.length === 1 && values[0] === raw)) {
        options.raw = raw;
      }
      return ['l', values, options];
    }

    const rowIds: number[] = [];
    for (const value of values) {
      const rowId = this.tableData.findMatchingRowId({[this._visibleColId]: value});
      if (rowId) {
        rowIds.push(rowId);
      } else {
        // There's no matching value in the visible column, i.e. this is not a valid reference.
        // We need to return a string which will become AltText.
        return raw;
      }
    }
    return ['L', ...rowIds];
  }
}

export const valueParserClasses: { [type: string]: typeof ValueParser } = {
  Numeric: NumericParser,
  Int: NumericParser,
  Date: DateParser,
  DateTime: DateTimeParser,
  ChoiceList: ChoiceListParser,
  Ref: ReferenceParser,
  RefList: ReferenceListParser,
  Attachments: ReferenceListParser,
};

/**
 * Returns a ValueParser which can parse strings into values appropriate for
 * a specific widget field or table column.
 * widgetOpts is usually the field/column's widgetOptions JSON
 * but referencing columns need more than that, see ReferenceParsingOptions above.
 */
export function createParserRaw(
  type: string, widgetOpts: FormatOptions, docSettings: DocumentSettings
): ValueParser {
  const cls = valueParserClasses[gristTypes.extractTypeFromColType(type)] || IdentityParser;
  return new cls(type, widgetOpts, docSettings);
}

/**
 * Returns a ValueParser which can parse strings into values appropriate for
 * a specific widget field or table column.
 *
 * Pass fieldRef (a row ID of _grist_Views_section_field) to use the settings of that view field
 * instead of the table column.
 */
export function createParser(
  docData: DocData,
  colRef: number,
  fieldRef?: number,
): ValueParser {
  return createParserRaw(...createParserOrFormatterArguments(docData, colRef, fieldRef));
}

/**
 * Returns arguments suitable for createParserRaw or createFormatter. Only for internal use.
 *
 * Pass fieldRef (a row ID of _grist_Views_section_field) to use the settings of that view field
 * instead of the table column.
 */
export function createParserOrFormatterArguments(
  docData: DocData,
  colRef: number,
  fieldRef?: number,
): [string, object, DocumentSettings] {
  const columnsTable = docData.getMetaTable('_grist_Tables_column');
  const fieldsTable = docData.getMetaTable('_grist_Views_section_field');

  const col = columnsTable.getRecord(colRef)!;
  let fieldOrCol: MetaRowRecord<'_grist_Tables_column' | '_grist_Views_section_field'> = col;
  if (fieldRef) {
    const field = fieldsTable.getRecord(fieldRef);
    fieldOrCol = field?.widgetOptions ? field : col;
  }

  return createParserOrFormatterArgumentsRaw(docData, col.type, fieldOrCol.widgetOptions, fieldOrCol.visibleCol);
}

export function createParserOrFormatterArgumentsRaw(
  docData: DocData,
  type: string,
  widgetOptions: string,
  visibleColRef: number,
): [string, object, DocumentSettings] {
  const columnsTable = docData.getMetaTable('_grist_Tables_column');
  const widgetOpts = safeJsonParse(widgetOptions, {});

  if (isFullReferencingType(type)) {
    const vcol = columnsTable.getRecord(visibleColRef);
    widgetOpts.visibleColId = vcol?.colId || 'id';
    widgetOpts.visibleColType = vcol?.type;
    widgetOpts.visibleColWidgetOpts = safeJsonParse(vcol?.widgetOptions || '', {});
    widgetOpts.tableData = docData.getTable(getReferencedTableId(type)!);
  }

  return [type, widgetOpts, docData.docSettings()];
}

/**
 * Returns a copy of `colValues` with string values parsed according to the type and options of each column.
 * `bulk` should be `true` if `colValues` is of type `BulkColValues`.
 */
function parseColValues<T extends ColValues | BulkColValues>(
  tableId: string, colValues: T, docData: DocData, bulk: boolean
): T {
  const columnsTable = docData.getMetaTable('_grist_Tables_column');
  const tablesTable = docData.getMetaTable('_grist_Tables');
  const tableRef = tablesTable.findRow('tableId', tableId);
  if (!tableRef) {
    return colValues;
  }

  return mapValues(colValues, (values, colId) => {
    const colRef = columnsTable.findMatchingRowId({colId, parentId: tableRef});
    if (!colRef) {
      // Column not found - let something else deal with that
      return values;
    }

    const parser = createParser(docData, colRef);

    // Optimisation: If there's no special parser for this column type, do nothing
    if (parser instanceof IdentityParser) {
      return values;
    }

    function parseIfString(val: any) {
      return typeof val === "string" ? parser.cleanParse(val) : val;
    }

    if (bulk) {
      if (!Array.isArray(values)) {  // in case of bad input
        return values;
      }
      // `colValues` is of type `BulkColValues`
      return (values as CellValue[]).map(parseIfString);
    } else {
      // `colValues` is of type `ColValues`, `values` is just one value
      return parseIfString(values);
    }
  });
}

export function parseUserAction(ua: UserAction, docData: DocData): UserAction {
  switch (ua[0]) {
    case 'AddRecord':
    case 'UpdateRecord':
      return _parseUserActionColValues(ua, docData, false);
    case 'BulkAddRecord':
    case 'BulkUpdateRecord':
    case 'ReplaceTableData':
      return _parseUserActionColValues(ua, docData, true);
    case 'AddOrUpdateRecord':
      // Parse `require` (2) and `col_values` (3). The action looks like:
      // ['AddOrUpdateRecord', table_id, require, col_values, options]
      // (`col_values` is called `fields` in the API)
      ua = _parseUserActionColValues(ua, docData, false, 2);
      ua = _parseUserActionColValues(ua, docData, false, 3);
      return ua;
    case 'BulkAddOrUpdateRecord':
      ua = _parseUserActionColValues(ua, docData, true, 2);
      ua = _parseUserActionColValues(ua, docData, true, 3);
      return ua;
    default:
      return ua;
  }
}

// Returns a copy of the user action with one element parsed, by default the last one
function _parseUserActionColValues(ua: UserAction, docData: DocData, parseBulk: boolean, index?: number
): UserAction {
  ua = ua.slice();
  const tableId = ua[1] as string;
  if (index === undefined) {
    index = ua.length - 1;
  }
  const colValues = ua[index] as ColValues | BulkColValues;
  ua[index] = parseColValues(tableId, colValues, docData, parseBulk);
  return ua;
}
