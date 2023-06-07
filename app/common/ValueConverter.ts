import {DocData} from 'app/common/DocData';
import * as gristTypes from 'app/common/gristTypes';
import {isList} from 'app/common/gristTypes';
import {BaseFormatter, createFullFormatterFromDocData} from 'app/common/ValueFormatter';
import {
  createParserOrFormatterArgumentsRaw,
  createParserRaw,
  ReferenceListParser,
  ReferenceParser,
  ValueParser
} from 'app/common/ValueParser';
import {CellValue, GristObjCode} from 'app/plugin/GristData';
import { TableDataActionSet } from "./DocActions";


/**
 * Base class for converting values from one type to another with the convert() method.
 * Has a formatter for the source column
 * and a parser for the destination column.
 *
 * The default convert() is for non-list destination types, so if the source value
 * is a list it only converts nicely if the list contains exactly one element.
 */
export class ValueConverter {
  private _isTargetText: boolean = ["Text", "Choice"].includes(this.parser.type);

  constructor(public formatter: BaseFormatter, public parser: ValueParser) {
  }

  public convert(value: any): any {
    if (isList(value)) {
      if (value.length === 1) {
        // Empty list: ['L']
        return null;
      } else if (value.length > 2 || this._isTargetText) {
        // List with multiple values, or the target type is text.
        // Since we're converting to just one value,
        // format the whole thing as text, which is an error for most types.
        return this.formatter.formatAny(value);
      } else {
        // Singleton list: ['L', value]
        // Convert just that one value.
        value = value[1];
      }
    }
    return this.convertInner(value);
  }

  protected convertInner(value: any): any {
    const formatted = this.formatter.formatAny(value);
    return this.parser.cleanParse(formatted);
  }
}

/**
 * Base class for converting to a list type (Reference List or Choice List).
 *
 * Wraps single values in a list, and converts lists elementwise.
 */
class ListConverter extends ValueConverter {
  // Don't parse strings like "Smith, John" which may look like lists but represent a single choice.
  // TODO this works when the source is a Choice column, but not when it's a Reference to a Choice column.
  //   But the guessed choices are also broken in that case.
  private _choices: Set<string> = new Set((this.formatter.widgetOpts as any).choices || []);

  public convert(value: any): any {
    if (typeof value === "string" && !this._choices.has(value)) {
      // Parse CSV/JSON
      return this.parser.cleanParse(value);
    }
    const values = isList(value) ? value.slice(1) : [value];
    if (!values.length || value == null) {
      return null;
    }
    return this.handleValues(value, values.map(v => this.convertInner(v)));
  }

  protected handleValues(originalValue: any, values: any[]) {
    return ['L', ...values];
  }
}

class ChoiceListConverter extends ListConverter {
  /**
   * Convert each source value to a 'Choice'
   */
  protected convertInner(value: any): any {
    return this.formatter.formatAny(value);
  }
}

class ReferenceListConverter extends ListConverter {
  private _innerConverter = new ReferenceConverter(
    this.formatter,
    new ReferenceParser("Ref", this.parser.widgetOpts, this.parser.docSettings),
  );

  constructor(public formatter: BaseFormatter, public parser: ReferenceListParser) {
    super(formatter, parser);
    // Prevent the parser from looking up reference values in the frontend.
    // Leave it to the data engine which has a much more efficient algorithm for long lists of values.
    delete parser.tableData;
  }

  public handleValues(originalValue: any, values: any[]): any {
    const result = [];
    let lookupColumn: string = "";
    const raw = this.formatter.formatAny(originalValue);  // AltText if the reference lookup fails
    for (const value of values) {
      if (typeof value === "string") {
        // Failed to parse one of the references, so return a raw string for the whole thing
        return raw;
      } else {
        // value is a lookup tuple: ['l', value, options]
        result.push(value[1]);
        lookupColumn = value[2].column;
      }
    }
    return ['l', result, {column: lookupColumn, raw}];
  }

  /**
   * Convert each source value to a 'Reference'
   */
  protected convertInner(value: any): any {
    return this._innerConverter.convert(value);
  }
}

class ReferenceConverter extends ValueConverter {
  private _innerConverter: ValueConverter = createConverter(this.formatter, this.parser.visibleColParser);

  constructor(public formatter: BaseFormatter, public parser: ReferenceParser) {
    super(formatter, parser);
    // Prevent the parser from looking up reference values in the frontend.
    // Leave it to the data engine which has a much more efficient algorithm for long lists of values.
    delete parser.tableData;
  }

  protected convertInner(value: any): any {
    // Convert to the type of the visible column.
    const converted = this._innerConverter.convert(value);
    return this.parser.lookup(converted, this.formatter.formatAny(value));
  }
}

class NumericConverter extends ValueConverter {
  protected convertInner(value: any): any {
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    return super.convertInner(value);
  }
}

class DateConverter extends ValueConverter {
  private _sourceType = gristTypes.extractInfoFromColType(this.formatter.type);

  protected convertInner(value: any): any {
    // When converting Date->DateTime, DateTime->Date, or between DateTime timezones,
    // it's important to send an encoded Date/DateTime object rather than just a timestamp number
    // so that the data engine knows what to do in do_convert, especially regarding timezones.
    // If the source column is a Reference to a Date/DateTime then `value` is already
    // an encoded object from the display column which has type Any.
    value = gristTypes.reencodeAsAny(value, this._sourceType);
    if (Array.isArray(value) && (
      value[0] === GristObjCode.Date ||
      value[0] === GristObjCode.DateTime
    )) {
      return value;
    }
    return super.convertInner(value);
  }
}

export const valueConverterClasses: { [type: string]: typeof ValueConverter } = {
  Date: DateConverter,
  DateTime: DateConverter,
  ChoiceList: ChoiceListConverter,
  Ref: ReferenceConverter,
  RefList: ReferenceListConverter,
  Numeric: NumericConverter,
  Int: NumericConverter,
};

export function createConverter(formatter: BaseFormatter, parser: ValueParser) {
  const cls = valueConverterClasses[gristTypes.extractTypeFromColType(parser.type)] || ValueConverter;
  return new cls(formatter, parser);
}

/**
 * Used by the ConvertFromColumn user action in the data engine.
 * The higher order function separates docData (passed by ActiveDoc)
 * from the arguments passed to call_external in Python.
 */
export function convertFromColumn(
  metaTables: TableDataActionSet,
  sourceColRef: number,
  type: string,
  widgetOpts: string,
  visibleColRef: number,
  values: ReadonlyArray<CellValue>,
  displayColValues?: ReadonlyArray<CellValue>,
): CellValue[] {
  const docData = new DocData(
    (_tableId) => { throw new Error("Unexpected DocData fetch"); },
    metaTables,
  );

  const formatter = createFullFormatterFromDocData(docData, sourceColRef);
  const parser = createParserRaw(
    ...createParserOrFormatterArgumentsRaw(docData, type, widgetOpts, visibleColRef)
  );
  const converter = createConverter(formatter, parser);
  return convertValues(converter, values, displayColValues || values);
}

export function convertValues(
  converter: ValueConverter,
  // Raw values from the actual column, e.g. row IDs for reference columns
  values: ReadonlyArray<CellValue>,
  // Values from the display column, which is the same as the raw values for non-referencing columns.
  // In almost all cases these are the values that actually matter and get converted.
  displayColValues: ReadonlyArray<CellValue>,
): CellValue[] {
  // Converting Ref <-> RefList without changing the target table is a special case - see prepTransformColInfo.
  // In this case we deal with the actual row IDs stored in the real column,
  // whereas in all other cases we use display column values.
  const sourceType = gristTypes.extractInfoFromColType(converter.formatter.type);
  const targetType = gristTypes.extractInfoFromColType(converter.parser.type);
  const refToRefList = (
    sourceType.type === "Ref" &&
    targetType.type === "RefList" &&
    sourceType.tableId === targetType.tableId
  );
  const refListToRef = (
    sourceType.type === "RefList" &&
    targetType.type === "Ref" &&
    sourceType.tableId === targetType.tableId
  );

  return displayColValues.map((displayVal, i) => {
    const actualValue = values[i];

    if (refToRefList && typeof actualValue === "number") {
      if (actualValue === 0) {
        return null;
      } else {
        return ["L", actualValue];
      }
    } else if (refListToRef && isList(actualValue)) {
      if (actualValue.length === 1) {
        // Empty list: ['L']
        return 0;
      } else if (actualValue.length === 2) {
        // Singleton list: ['L', rowId]
        return actualValue[1];
      }
    }

    return converter.convert(displayVal);
  });
}
