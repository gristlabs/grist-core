import { DocumentSettings } from 'app/common/DocumentSettings';
import * as gristTypes from 'app/common/gristTypes';
import * as gutil from 'app/common/gutil';
import { getCurrency, NumberFormatOptions } from 'app/common/NumberFormat';
import NumberParse from 'app/common/NumberParse';
import { parseDate } from 'app/common/parseDate';
import { DateTimeFormatOptions, FormatOptions } from 'app/common/ValueFormatter';


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
    return parseDate(value, this.widgetOpts);
  }
}

class DateTimeParser extends DateParser {
  constructor(type: string, widgetOpts: DateTimeFormatOptions, docSettings: DocumentSettings) {
    super(type, widgetOpts, docSettings);
    const timezone = gutil.removePrefix(type, "DateTime:") || '';
    this.widgetOpts = {...widgetOpts, timezone};
  }
}

const parsers: { [type: string]: typeof ValueParser } = {
  Numeric: NumericParser,
  Int: NumericParser,
  Date: DateParser,
  DateTime: DateTimeParser,
};

// TODO these are not ready yet
delete parsers.Date;
delete parsers.DateTime;

export function createParser(
  type: string, widgetOpts: FormatOptions, docSettings: DocumentSettings
): ((value: string) => any) | undefined {
  const cls = parsers[gristTypes.extractTypeFromColType(type)];
  if (cls) {
    const parser = new cls(type, widgetOpts, docSettings);
    return parser.cleanParse.bind(parser);
  }
}
