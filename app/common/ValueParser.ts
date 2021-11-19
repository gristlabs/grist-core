import {csvDecodeRow} from 'app/common/csvFormat';
import {DocumentSettings} from 'app/common/DocumentSettings';
import * as gristTypes from 'app/common/gristTypes';
import * as gutil from 'app/common/gutil';
import {safeJsonParse} from 'app/common/gutil';
import {getCurrency, NumberFormatOptions} from 'app/common/NumberFormat';
import NumberParse from 'app/common/NumberParse';
import {parseDateStrict} from 'app/common/parseDate';
import {DateFormatOptions, DateTimeFormatOptions, formatDecoded, FormatOptions} from 'app/common/ValueFormatter';
import flatMap = require('lodash/flatMap');


export class ValueParser {
  constructor(public type: string, public widgetOpts: object, public docSettings: DocumentSettings) {
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

class DateTimeParser extends DateParser {
  constructor(type: string, widgetOpts: DateTimeFormatOptions, docSettings: DocumentSettings) {
    super(type, widgetOpts, docSettings);
    const timezone = gutil.removePrefix(type, "DateTime:") || '';
    this.widgetOpts = {...widgetOpts, timezone};
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

const parsers: { [type: string]: typeof ValueParser } = {
  Numeric: NumericParser,
  Int: NumericParser,
  Date: DateParser,
  DateTime: DateTimeParser,
  ChoiceList: ChoiceListParser,
};

// TODO these are not ready yet
delete parsers.DateTime;

export function createParser(
  type: string, widgetOpts: FormatOptions, docSettings: DocumentSettings
): (value: string) => any {
  const cls = parsers[gristTypes.extractTypeFromColType(type)];
  if (cls) {
    const parser = new cls(type, widgetOpts, docSettings);
    return parser.cleanParse.bind(parser);
  }
  return value => value;
}
