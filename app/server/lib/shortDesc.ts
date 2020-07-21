import defaults = require('lodash/defaults');
import identity = require('lodash/identity');
import {inspect} from 'util';

function truncateString(s: string|Uint8Array, maxLen: number, optStringMapper?: (arg: any) => string): string {
  const m: (arg: any) => string = optStringMapper || identity;
  return s.length <= maxLen ? m(s) : m(s.slice(0, maxLen)) + "... (" + s.length + " length)";
}

function formatUint8Array(array: Uint8Array): string {
  const s = Buffer.from(array).toString('binary');
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1f\x7f-\xff]/g, '?');
}

interface DescLimits {
  maxArrayLength: number;
  maxObjectKeys: number;
  maxStringLength: number;
  maxBufferLength: number;
}

const defaultLimits: DescLimits = {
  maxArrayLength: 5,
  maxObjectKeys: 10,
  maxStringLength: 80,
  maxBufferLength: 80,
};

/**
 * Produce a human-readable concise description of the object as a string. Similar to
 * util.inspect(), but more concise and more readable.
 * @param {Object} optLimits: Optional limits on how much of a value to include. Supports
 *    maxArrayLength, maxObjectKeys, maxStringLength, maxBufferLength.
 */
export function shortDesc(topObj: any, optLimits?: DescLimits): string {
  const lim = defaults(optLimits || {}, defaultLimits);
  function _shortDesc(obj: any): string {
    if (Array.isArray(obj)) {
      return "[" +
        obj.slice(0, lim.maxArrayLength).map(_shortDesc).join(", ") +
        (obj.length > lim.maxArrayLength ? ", ... (" + obj.length + " items)" : "") +
        "]";
    } else if (obj instanceof Uint8Array) {
      return "b'" + truncateString(obj, lim.maxBufferLength, formatUint8Array) + "'";
    } else if (obj && typeof obj === 'object' && !Buffer.isBuffer(obj)) {
      const keys = Object.keys(obj);
      return "{" + keys.slice(0, lim.maxObjectKeys).map(function(key) {
        return key + ": " + _shortDesc(obj[key]);
      }).join(", ") +
        (keys.length > lim.maxObjectKeys ? ", ... (" + keys.length + " keys)" : "") +
        "}";
    } else if (typeof obj === 'string') {
      return inspect(truncateString(obj, lim.maxStringLength));
    } else {
      return inspect(obj);
    }
  }
  return _shortDesc(topObj);
}
