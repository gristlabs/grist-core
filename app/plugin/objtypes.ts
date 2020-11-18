/**
 * Encodes and decodes Grist encoding of values, mirroring similar Python functions in
 * sandbox/grist/objtypes.py.
 */
// tslint:disable:max-classes-per-file

import {CellValue} from 'app/plugin/GristData';
import isPlainObject = require('lodash/isPlainObject');

// The text to show on cells whose values are pending.
export const PENDING_DATA_PLACEHOLDER = "Loading...";

/**
 * A GristDate is just a JS Date object whose toString() method returns YYYY-MM-DD.
 */
export class GristDate extends Date {
  public static fromGristValue(epochSec: number): GristDate {
    return new GristDate(epochSec * 1000);
  }

  public toString() {
    return this.toISOString().slice(0, 10);
  }
}

/**
 * A GristDateTime is a JS Date with an added timezone field. Its toString() returns the date in
 * ISO format. To create a timezone-aware momentjs object, use:
 *
 *    moment(d).tz(d.timezone)
 */
export class GristDateTime extends Date {
  public static fromGristValue(epochSec: number, timezone: string): GristDateTime {
    return Object.assign(new GristDateTime(epochSec * 1000), {timezone});
  }

  public timezone: string;
  public toString() { return this.toISOString(); }
}

/**
 * A Reference represents a reference to a row in a table. It is simply a pair of a string tableId
 * and a numeric rowId.
 */
export class Reference {
  constructor(public tableId: string, public rowId: number) {}

  public toString(): string {
    return `${this.tableId}[${this.rowId}]`;
  }
}

/**
 * A RaisedException represents a formula error. It includes the exception name, message, and
 * optional details.
 */
export class RaisedException {
  constructor(public name: string, public message?: string, public details?: string) {}

  /**
   * This is designed to look somewhat similar to Excel, e.g. #VALUE or #DIV/0!"
   */
  public toString() {
    switch (this.name) {
      case 'ZeroDivisionError': return '#DIV/0!';
      case 'UnmarshallableError': return this.details || ('#' + this.name);
      case 'InvalidTypedValue': return `#Invalid ${this.message}: ${this.details}`;
    }
    return '#' + this.name;
  }
}

/**
 * An UnknownValue is a fallback for values that we don't handle otherwise, e.g. of a Python
 * formula returned a function object, or a value we fail to decode.
 * It is typically the Python repr() string of the value.
 */
export class UnknownValue {
  // When encoding an unknown value, get a best-effort string form of it.
  public static safeRepr(value: unknown): string {
    try {
      return String(value);
    } catch (e) {
      return `<${typeof value}>`;
    }
  }

  constructor(public value: unknown) {}
  public toString() {
    return String(this.value);
  }
}

/**
 * A trivial placeholder for a value that's not yet available.
 */
export class PendingValue {
  public toString() {
    return PENDING_DATA_PLACEHOLDER;
  }
}

/**
 * A trivial placeholder for a value that won't be shown.
 */
export class SkipValue {
  public toString() {
    return '...';
  }
}

/**
 * Produces a Grist-encoded version of the value, e.g. turning a Date into ['d', timestamp].
 * Returns ['U', repr(value)] if it fails to encode otherwise.
 *
 * TODO Add tests. This is not yet used for anything.
 */
export function encodeObject(value: unknown): CellValue {
  try {
    switch (typeof value) {
      case 'string':
      case 'number':
      case 'boolean':
        return value;
    }
    if (value == null) {
      return null;
    } else if (value instanceof Reference) {
      return ['R', value.tableId, value.rowId];
    } else if (value instanceof Date) {
      const timestamp = value.valueOf() / 1000;
      if ('timezone' in value) {
        return ['D', timestamp, (value as GristDateTime).timezone];
      } else {
        // TODO Depending on how it's used, may want to return ['d', timestamp] for UTC midnight.
        return ['D', timestamp, 'UTC'];
      }
    } else if (value instanceof RaisedException) {
      return ['E', value.name, value.message, value.details];
    } else if (Array.isArray(value)) {
      return ['L', ...value.map(encodeObject)];
    } else if (isPlainObject(value)) {
      return ['O', mapValues(value as any, encodeObject, {sort: true})];
    }
  } catch (e) {
    // Fall through to return a best-effort representation.
  }
  // We either don't know how to convert the value, or failed during the conversion. Instead we
  // return an "UnmarshallableValue" object, with repr() of the value to show to the user.
  return ['U', UnknownValue.safeRepr(value)];
}


/**
 * Given a Grist-encoded value, returns an object represented by it.
 * If the type code is unknown, or construction fails for any reason, returns an UnknownValue.
 */
export function decodeObject(value: CellValue): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  const code: string = value[0];
  const args: any[] = value.slice(1);
  let err: Error|undefined;
  try {
    switch (code) {
      case 'D': return GristDateTime.fromGristValue(args[0], String(args[1]));
      case 'd': return GristDate.fromGristValue(args[0]);
      case 'E': return new RaisedException(args[0], args[1], args[2]);
      case 'L': return (args as CellValue[]).map(decodeObject);
      case 'O': return mapValues(args[0] as {[key: string]: CellValue}, decodeObject, {sort: true});
      case 'P': return new PendingValue();
      case 'R': return new Reference(String(args[0]), args[1]);
      case 'S': return new SkipValue();
      case 'U': return new UnknownValue(args[0]);
    }
  } catch (e) {
    err = e;
  }
  // If we can't decode, return an UnknownValue with some attempt to represent what we couldn't
  // decode as long as some info about the error if any.
  return new UnknownValue(`${code}(${JSON.stringify(args).slice(1, -1)})` +
    (err ? `#${err.name}(${err.message})` : ''));
}

// Like lodash's mapValues, with support for sorting keys, for friendlier output.
export function mapValues<A, B>(
  sourceObj: {[key: string]: A}, mapper: (value: A) => B, options: {sort?: boolean} = {}
): {[key: string]: B} {
  const result: {[key: string]: B} = {};
  const keys = Object.keys(sourceObj);
  if (options.sort) {
    keys.sort();
  }
  for (const key of keys) {
    result[key] = mapper(sourceObj[key]);
  }
  return result;
}
