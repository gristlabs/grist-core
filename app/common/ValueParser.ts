import {csvDecodeRow} from 'app/common/csvFormat';
import {DocData} from 'app/common/DocData';
import {DocumentSettings} from 'app/common/DocumentSettings';
import {getReferencedTableId, isFullReferencingType} from 'app/common/gristTypes';
import * as gristTypes from 'app/common/gristTypes';
import * as gutil from 'app/common/gutil';
import {safeJsonParse} from 'app/common/gutil';
import {getCurrency, NumberFormatOptions} from 'app/common/NumberFormat';
import NumberParse from 'app/common/NumberParse';
import {parseDateStrict, parseDateTime} from 'app/common/parseDate';
import {MetaRowRecord, TableData} from 'app/common/TableData';
import {DateFormatOptions, DateTimeFormatOptions, formatDecoded, FormatOptions} from 'app/common/ValueFormatter';
import flatMap = require('lodash/flatMap');


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


export class NumericParser extends ValueParser {
  private _parse: NumberParse;

  constructor(type: string, options: NumberFormatOptions, docSettings: DocumentSettings) {
    super(type, options, docSettings);
    this._parse = new NumberParse(docSettings.locale, getCurrency(options, docSettings));
  }

  public parse(value: string): number | null {
    return this._parse.parse(value);
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
interface ReferenceParsingOptions {
  visibleColId: string;
  visibleColType: string;
  visibleColWidgetOpts: FormatOptions;

  // If this is provided and loaded, the ValueParser will look up values directly.
  // Otherwise an encoded lookup will be produced for the data engine to handle.
  tableData?: TableData;
}

export class ReferenceParser extends ValueParser {
  public widgetOpts: ReferenceParsingOptions;

  protected _visibleColId = this.widgetOpts.visibleColId;
  protected _tableData = this.widgetOpts.tableData;
  protected _visibleColParser = createParserRaw(
    this.widgetOpts.visibleColType,
    this.widgetOpts.visibleColWidgetOpts,
    this.docSettings,
  );

  public parse(raw: string): any {
    let value = this._visibleColParser(raw);
    if (!value || !raw) {
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

    if (!this._tableData?.isLoaded) {
      const options: { column: string, raw?: string } = {column: this._visibleColId};
      if (value !== raw) {
        options.raw = raw;
      }
      return ['l', value, options];
    }

    return this._tableData.findMatchingRowId({[this._visibleColId]: value}) || raw;
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
    values = values.map(v => typeof v === "string" ? this._visibleColParser(v) : v);

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

    if (!this._tableData?.isLoaded) {
      const options: { column: string, raw?: string } = {column: this._visibleColId};
      if (!(values.length === 1 && values[0] === raw)) {
        options.raw = raw;
      }
      return ['l', values, options];
    }

    const rowIds: number[] = [];
    for (const value of values) {
      const rowId = this._tableData.findMatchingRowId({[this._visibleColId]: value});
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
};


/**
 * Returns a function which can parse strings into values appropriate for
 * a specific widget field or table column.
 * widgetOpts is usually the field/column's widgetOptions JSON
 * but referencing columns need more than that, see ReferenceParsingOptions above.
 */
export function createParserRaw(
  type: string, widgetOpts: FormatOptions, docSettings: DocumentSettings
): (value: string) => any {
  const cls = valueParserClasses[gristTypes.extractTypeFromColType(type)];
  if (cls) {
    const parser = new cls(type, widgetOpts, docSettings);
    return parser.cleanParse.bind(parser);
  }
  return value => value;
}

/**
 * Returns a function which can parse strings into values appropriate for
 * a specific widget field or table column.
 *
 * Pass fieldRef (a row ID of _grist_Views_section_field) to use the settings of that view field
 * instead of the table column.
 */
export function createParser(
  docData: DocData,
  colRef: number,
  fieldRef?: number,
): (value: string) => any {
  const columnsTable = docData.getMetaTable('_grist_Tables_column');
  const fieldsTable = docData.getMetaTable('_grist_Views_section_field');
  const docInfoTable = docData.getMetaTable('_grist_DocInfo');

  const col = columnsTable.getRecord(colRef)!;

  let fieldOrCol: MetaRowRecord<'_grist_Tables_column' | '_grist_Views_section_field'> = col;
  if (fieldRef) {
    fieldOrCol = fieldsTable.getRecord(fieldRef) || col;
  }

  const widgetOpts = safeJsonParse(fieldOrCol.widgetOptions, {});

  const type = col.type;
  if (isFullReferencingType(type)) {
    const vcol = columnsTable.getRecord(fieldOrCol.visibleCol);
    widgetOpts.visibleColId = vcol?.colId || 'id';
    widgetOpts.visibleColType = vcol?.type;
    widgetOpts.visibleColWidgetOpts = safeJsonParse(vcol?.widgetOptions || '', {});
    widgetOpts.tableData = docData.getTable(getReferencedTableId(type)!);
  }

  const docInfo = docInfoTable.getRecord(1);
  const docSettings = safeJsonParse(docInfo!.documentSettings, {}) as DocumentSettings;

  return createParserRaw(type, widgetOpts, docSettings);
}
