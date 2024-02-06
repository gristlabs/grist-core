import {
  BindableValue,
  Computed,
  DomElementMethod,
  Holder,
  IDisposableOwner,
  IKnockoutReadObservable,
  ISubscribable,
  Listener,
  MultiHolder,
  Observable,
  subscribeElem,
  UseCB,
  UseCBOwner
} from 'grainjs';
import {Observable as KoObservable} from 'knockout';
import identity = require('lodash/identity');

// Some definitions have moved to be used by plugin API.
export {arrayRepeat} from 'app/plugin/gutil';

export const UP_TRIANGLE = '\u25B2';
export const DOWN_TRIANGLE = '\u25BC';

const EMAIL_RE = new RegExp("^\\w[\\w%+/='-]*(\\.[\\w%+/='-]+)*@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z" +
  "0-9])?\\.)+[A-Za-z]{2,24}$", "u");

// Returns whether str starts with prefix. (Note that this implementation avoids creating a new
// string, and only checks a single location.)
export function startsWith(str: string, prefix: string): boolean {
  return str.lastIndexOf(prefix, 0) === 0;
}

// Returns whether str ends with suffix.
export function endsWith(str: string, suffix: string): boolean {
  return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

// If str starts with prefix, removes it and returns what remains. Otherwise, returns null.
export function removePrefix(str: string, prefix: string): string|null {
  return startsWith(str, prefix) ? str.slice(prefix.length) : null;
}


// If str ends with suffix, removes it and returns what remains. Otherwise, returns null.
export function removeSuffix(str: string, suffix: string): string|null {
  return endsWith(str, suffix) ? str.slice(0, str.length - suffix.length) : null;
}

export function removeTrailingSlash(str: string): string {
  const result = removeSuffix(str, '/');
  return result === null ? str : result;
}

// Expose <string>.padStart.  The version of node we use has it, but they typings
// need the es2017 typescript target.  TODO: replace once typings in place.
export function padStart(str: string, targetLength: number, padString: string) {
  return (str as any).padStart(targetLength, padString);
}

// Capitalizes every word in a string.
export function capitalize(str: string): string {
  return str.replace(/\b[a-z]/gi, c => c.toUpperCase());
}

// Capitalizes the first word in a string.
export function capitalizeFirstWord(str: string): string {
  return str.replace(/\b[a-z]/i, c => c.toUpperCase());
}

// Returns whether the string n represents a valid number.
// http://stackoverflow.com/questions/18082/validate-numbers-in-javascript-isnumeric
export function isNumber(n: string): boolean {
  // This wasn't right for a long time: isFinite() is key to failing on strings like "5a".
  return !isNaN(parseFloat(n)) && isFinite(n as any);
}

/**
 * Returns a value clamped to the given min-max range.
 * @param {Number} value - some numeric value.
 * @param {Number} min - minimum value allowed.
 * @param {Number} max - maximum value allowed. Must have min <= max.
 * @returns {Number} - value restricted to the given range.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Checks if ele is contained within the given bounds.
 * @param {Number} value
 * @param {Number} bound1 - does not have to be less than/equal to bound2
 * @param {Number} bound2
 * @returns {Boolean} - True/False
 */
export function between(value: number, bound1: number, bound2: number): boolean {
  const lower = Math.min(bound1, bound2);
  const upper = Math.max(bound1, bound2);
  return lower <= value && value <= upper;
}

/**
 * Returns the positive modulo of x by n. (Javascript default allows negatives)
 */
export function mod(x: number, n: number): number {
  return ((x % n) + n) % n;
}

/**
 * Returns a number that is n rounded down to the next nearest number divisible by m
 */

export function roundDownToMultiple(n: number, m: number): number {
  return Math.floor(n / m) * m;
}

/**
 * Returns the first argument unless it's undefined, in which case returns the second one.
 */
export function undefDefault<T>(x: T|undefined, y: T): T {
  return (x !== void 0) ? x : y;
}

// for typescript 4
// type Undef<T> = T extends [infer A, ...infer B] ? undefined extends A ? NonNullable<A> | Undef<B> : A : unknown;

type Undef1<T> = T extends [infer A] ? A : unknown;

type Undef2<T> = T extends [infer A, infer B] ?
    undefined extends A ? NonNullable<A> | Undef1<[B]> : A : Undef1<T>;

type Undef3<T> = T extends [infer A, infer B, infer C] ?
    undefined extends A ? NonNullable<A> | Undef2<[B, C]> : A : Undef2<T>;

type Undef<T> = T extends [infer A, infer B, infer C, infer D] ?
    undefined extends A ? NonNullable<A> | Undef3<[B, C, D]> : A : Undef3<T>;

/*

Undef<T> can detect correct type that will be returned as a first defined value:

const t1: number = undef(1, 1 as number | undefined);
const t1: number | undefined = undef(2 as number | undefined, 3 as number | undefined);
const t3: number = undef(3 as number | undefined, undefined, 4);
const t4: number = undef(1, '');
const t5: number = undef(1 as number | undefined, 4);
const t6: string = undef('1', 2);
const t7: string | number = undef(undefined, 2 as number | undefined, '3');
const t8: string = undef(undefined, undefined, '3');
const t9: string = undef(undefined, '2' as string | undefined, '3');
const ta: string | number | undefined = undef(undefined, '2' as string | undefined, 3 as number | undefined);
const tb: string | number = undef(undefined, '2' as string | undefined, 3 as number | undefined, 5);
*/

/**
 * Returns the first defined value from the list or unknown.
 * Use with typed result, so the typescript type checker can provide correct type.
 */
export function undef<T extends Array<any>>(...list: T): Undef<T> {
  for(const value of list) {
    if (value !== undefined) { return value; }
  }
  return undefined as any;
}

/**
 * Like undef, but each element of list is a method that is only called
 * if needed, and promises are supported. No fancy type inference though, sorry.
 */
export async function firstDefined<T>(...list: Array<() => Promise<T>>): Promise<T | undefined> {
  for(const op of list) {
    const value = await op();
    if (value !== undefined) { return value; }
  }
  return undefined;
}

/**
 * Parses json and returns the result, or returns defaultVal if parsing fails.
 */
export function safeJsonParse(json: string, defaultVal: any): any {
  try {
    return json !== '' && json !== undefined ? JSON.parse(json) : defaultVal;
  } catch (e) {
    return defaultVal;
  }
}

/**
 * Just like encodeURIComponent, but does not encode slashes. Slashes don't hurt to be included in
 * URL parameters, and look much friendlier not encoded.
 */
export function encodeQueryParam(str: string|number|undefined): string {
  return encodeURIComponent(String(str === undefined ? null : str)).replace(/%2F/g, '/');
}

/**
 * Encode an object into a querystring ("key=value&key2=value2").
 * This is similar to JQuery's $.param, but only works on shallow objects.
 */
export function encodeQueryParams(obj: {[key: string]: string|number|undefined}): string {
  return Object.keys(obj).map((k: string) => encodeQueryParam(k) + '=' + encodeQueryParam(obj[k])).join('&');
}

/**
 * Return a list of the words in the string, using the given separator string. At most
 * maxNumSplits splits are done, so the result will have at most maxNumSplits + 1 elements (this
 * is the main difference from how JS built-in string.split() works, and similar to Python split).
 * @param {String} str: String to split.
 * @param {String} sep: Separator to split on.
 * @param {Number} maxNumSplits: Maximum number of splits to do.
 * @return {Array[String]} Array of words, of length at most maxNumSplits + 1.
 */
export function maxsplit(str: string, sep: string, maxNumSplits: number): string[] {
  const result: string[] = [];
  let start = 0, pos;
  for (let i = 0; i < maxNumSplits; i++) {
    pos = str.indexOf(sep, start);
    if (pos === -1) {
      break;
    }
    result.push(str.slice(start, pos));
    start = pos + sep.length;
  }
  result.push(str.slice(start));
  return result;
}


// Compare arrays of scalars for equality.
export function arraysEqual(a: any[], b: any[]): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) { return false; }
  }
  return true;
}


// Gives a set representing the set difference a - b.
export function setDifference<T>(a: Set<T>, b: Set<T>): Set<T> {
  const c = new Set<T>();
  for (const ai of a) {
    if (!b.has(ai)) { c.add(ai); }
  }
  return c;
}

// Like array.indexOf, but works with array-like objects like HTMLCollection.
export function indexOf<T>(arrayLike: ArrayLike<T>, item: T): number {
  return Array.prototype.indexOf.call(arrayLike, item);
}


/**
 * Removes a value from the given array. Only the first instance is removed.
 * Returns true on success, false if the value was not found.
 */
export function arrayRemove<T>(array: T[], value: T): boolean {
  const index = array.indexOf(value);
  if (index === -1) {
    return false;
  }
  array.splice(index, 1);
  return true;
}


/**
 * Inserts value into the array before nextValue, or at the end if nextValue is not found.
 */
export function arrayInsertBefore<T>(array: T[], value: T, nextValue: T): void {
  const index = array.indexOf(nextValue);
  if (index === -1) {
    array.push(value);
  } else {
    array.splice(index, 0, value);
  }
}


/**
 * Extends the first array with the second. Like native push, but adds all values in anotherArray.
 */
export function arrayExtend<T>(array: T[], anotherArray: T[]): void {
  for (let i = 0, len = anotherArray.length; i < len; i++) {
    array.push(anotherArray[i]);
  }
}


/**
 * Copies count items from fromArray to toArray, copying in a forward direction (which matters
 * when the arrays are the same and source and destination indices overlap).
 *
 * See test/common/arraySplice.js for alternative implementations with timings, from which this
 * one is chosen as consistently among the faster ones.
 */
export function arrayCopyForward<T>(toArray: T[], toStart: number,
                                    fromArray: ArrayLike<T>, fromStart: number, count: number): void {
  const end = toStart + count;
  for (const xend = end - 7; toStart < xend; fromStart += 8, toStart += 8) {
    toArray[toStart] = fromArray[fromStart];
    toArray[toStart + 1] = fromArray[fromStart + 1];
    toArray[toStart + 2] = fromArray[fromStart + 2];
    toArray[toStart + 3] = fromArray[fromStart + 3];
    toArray[toStart + 4] = fromArray[fromStart + 4];
    toArray[toStart + 5] = fromArray[fromStart + 5];
    toArray[toStart + 6] = fromArray[fromStart + 6];
    toArray[toStart + 7] = fromArray[fromStart + 7];
  }
  for (; toStart < end; ++fromStart, ++toStart) {
    toArray[toStart] = fromArray[fromStart];
  }
}


/**
 * Copies count items from fromArray to toArray, copying in a backward direction (which matters
 * when the arrays are the same and source and destination indices overlap).
 *
 * See test/common/arraySplice.js for alternative implementations with timings, from which this
 * one is chosen as consistently among the faster ones.
 */
export function arrayCopyBackward<T>(toArray: T[], toStart: number,
                                     fromArray: ArrayLike<T>, fromStart: number, count: number): void {
  let i = toStart + count - 1, j = fromStart + count - 1;
  for (const xStart = toStart + 7; i >= xStart; i -= 8, j -= 8) {
    toArray[i] = fromArray[j];
    toArray[i - 1] = fromArray[j - 1];
    toArray[i - 2] = fromArray[j - 2];
    toArray[i - 3] = fromArray[j - 3];
    toArray[i - 4] = fromArray[j - 4];
    toArray[i - 5] = fromArray[j - 5];
    toArray[i - 6] = fromArray[j - 6];
    toArray[i - 7] = fromArray[j - 7];
  }
  for ( ; i >= toStart; --i, --j) {
    toArray[i] = fromArray[j];
  }
}


/**
 * Appends a slice of fromArray to the end of toArray.
 *
 * See test/common/arraySplice.js for alternative implementations with timings, from which this
 * one is chosen as consistently among the faster ones.
 */
export function arrayAppend<T>(toArray: T[], fromArray: ArrayLike<T>, fromStart: number, count: number): void {
  if (count === 1) {
    toArray.push(fromArray[fromStart]);
  } else {
    const len = toArray.length;
    toArray.length = len + count;
    arrayCopyForward(toArray, len, fromArray, fromStart, count);
  }
}


/**
 * Splices array arrToInsert into target starting at the given start index.
 * This implementation tries to be smart by avoiding allocations, appending to the array
 * contiguously, then filling in the gap.
 *
 * See test/common/arraySplice.js for alternative implementations with timings, from which this
 * one is chosen as consistently among the faster ones.
 */
export function arraySplice<T>(target: T[], start: number, arrToInsert: ArrayLike<T>): T[] {
  const origLen = target.length;
  const tailLen = origLen - start;
  const insLen = arrToInsert.length;
  target.length = origLen + insLen;
  if (insLen > tailLen) {
    arrayCopyForward(target, origLen, arrToInsert, tailLen, insLen - tailLen);
    arrayCopyForward(target, start + insLen, target, start, tailLen);
    arrayCopyForward(target, start, arrToInsert, 0, tailLen);
  } else {
    arrayCopyForward(target, origLen, target, origLen - insLen, insLen);
    arrayCopyBackward(target, start + insLen, target, start, tailLen - insLen);
    arrayCopyForward(target, start, arrToInsert, 0, insLen);
  }
  return target;
}


// Type for a compare func that returns a positive, negative, or zero value, as used for sorting.
export type CompareFunc<T> = (a: T, b: T) => number;

/**
 * Returns the index at which the given element can be inserted to keep the array sorted.
 * This is equivalent to underscore's sortedIndex and python's bisect_left.
 * @param {Array} array - sorted array of elements based on the given compareFunc
 * @param {object} elem - object to be inserted in the given array
 * @param {function} compareFunc - compares 2 elements. Returns a pos value if the 1st element is
 *                                 larger, 0 if they're equal, a neg value if the 2nd is larger.
 */
export function sortedIndex<T>(array: ArrayLike<T>, elem: T, compareFunc: CompareFunc<T>): number {
  let lo = 0, mid;
  let hi = array.length;

  if (array.length === 0) { return 0; }
  while (lo < hi) {
    mid = Math.floor((lo + hi) / 2);
    if (compareFunc(array[mid], elem) < 0) { // mid < elem
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Returns true if an array contains duplicate values.
 * Values are considered equal if their toString() representations are equal.
 */
export function hasDuplicates(array: any[]): boolean {
  const prevVals = Object.create(null);
  for (const value of array) {
    if (value in prevVals) {
      return true;
    }
    prevVals[value] = true;
  }
  return false;
}

/**
 * Counts the number of items in array which satisfy the callback.
 */
export function countIf<T>(array: ReadonlyArray<T>, callback: (item: T) => boolean): number {
  let count = 0;
  array.forEach(item => {
    if (callback(item)) { count++; }
  });
  return count;
}


/**
 * For two parallel arrays, calls mapFunc(a[i], b[i]) for each pair of corresponding elements, and
 * returns an array of the results.
 */
export function map2<T, U, V>(array1: ArrayLike<T>, array2: ArrayLike<U>, mapFunc: (a: T, b: U) => V): V[] {
  const len = array1.length;
  const result: V[] = new Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = mapFunc(array1[i], array2[i]);
  }
  return result;
}

/**
 * Takes a 2d array returns a new matrix with r rows and c columns
 * @param [Array] dataMatrix: a 2d array
 * @param [Number] r: final row length
 * @param [Number] c: final column length
 */
export function growMatrix<T>(dataMatrix: T[][], r: number, c: number): T[][] {
  const colArr = dataMatrix.map(colVals =>
    Array.from({length: c}, (_v, k) => colVals[k % colVals.length])
  );
  return Array.from({length: r}, (_v, k) => colArr[k % colArr.length]);
}

/**
 * Returns a function that compares two elements based on multiple sort keys and the
 * given compare functions.
 * Elements are compared using the sort key functions with index 0 having the greatest priority.
 * Subsequent sort key functions are used as tie breakers.
 * @param {function Array} sortKeyFuncs - a list of sort key functions.
 * @param {function Array} compareKeyFuncs - a list of comparison functions parallel to sortKeyFuncs
 * Each compare function  must satisfy the comparison invariant:
 *   If compare(a, b) > 0 then a > b,
 *   If compare(a, b) < 0 then a < b,
 *   If compare(a, b) == 0 then a == b,
 * @param {Array of 1/-1's} optAscending - Comparison on sortKeyFuncs[i] is inverted if optAscending[i] == -1
 */
export function multiCompareFunc<T, U>(sortKeyFuncs: ReadonlyArray<(a: T) => U>,
                                       compareFuncs: ArrayLike<CompareFunc<U>>,
                                       optAscending?: number[]): CompareFunc<T> {
  if (sortKeyFuncs.length !== compareFuncs.length) {
    throw new Error('Number of sort key funcs must be the same as the number of compare funcs');
  }
  const ascending = optAscending || sortKeyFuncs.map(() => 1);
  return function(a: T, b: T): number {
    let compareOutcome, keyA, keyB;
    for (let i = 0; i < compareFuncs.length; i++) {
      keyA = sortKeyFuncs[i](a);
      keyB = sortKeyFuncs[i](b);
      compareOutcome = compareFuncs[i](keyA, keyB);
      if (compareOutcome !== 0) { return ascending[i] * compareOutcome; }
    }
    return 0;
  };
}


export function nativeCompare<T>(a: T, b: T): number {
  return (a < b ? -1 : (a > b ? 1 : 0));
}

/**
 * Creates a function that compares objects by a property value.
 */
export function propertyCompare<T>(property: keyof T) {
  return function(a: T, b: T) {
    return nativeCompare(a[property], b[property]);
  };
}

// TODO: In the future, locale should be a value associated with the document or the user.
export const defaultLocale = 'en-US';
export const defaultCollator = new Intl.Collator(defaultLocale);
export const localeCompare = defaultCollator.compare;

/**
 * A copy of python`s `setdefault` function.
 * Sets key in mapInst to value, if key is not already set.
 * @param {Map} mapInst: Instance of Map.
 * @param {Object} key: Key into the map.
 * @param {Object} value: Value to insert, possibly.
 */
export function setDefault<K, V>(mapInst: Map<K, V>, key: K, val: V): V {
  if (!mapInst.has(key)) { mapInst.set(key, val); }
  return mapInst.get(key)!;
}


/**
 * Similar to Python's `setdefault`: returns the key `key` from `mapInst`, or if it's not there, sets
 * it to the result buildValue().
 */
export function getSetMapValue<K, V>(mapInst: Map<K, V>, key: K, buildValue: () => V): V {
  if (!mapInst.has(key)) { mapInst.set(key, buildValue()); }
  return mapInst.get(key)!;
}


/**
 * If key is in mapInst, remove it and return its value, else return `undefined`.
 * @param {Map} mapInst: Instance of Map.
 * @param {Object} key: Key into the map to remove.
 */
export function popFromMap<K, V>(mapInst: Map<K, V>, key: K): V|undefined {
  const value = mapInst.get(key);
  mapInst.delete(key);
  return value;
}

/**
 * For each encountered value in `values`, increment the corresponding counter in `valueCounts`.
 */
export function addCountsToMap<T>(valueCounts: Map<T, number>, values: Iterable<T>,
                                  mapFunc: (v: any) => any = identity) {
  for (const v of values) {
    const mappedValue = mapFunc(v);
    valueCounts.set(mappedValue, (valueCounts.get(mappedValue) || 0) + 1);
  }
}

/**
 * Returns whether one Set is a subset of another.
 */
export function isSubset(smaller: Set<any>, larger: Set<any>): boolean {
  for (const value of smaller) {
    if (!larger.has(value)) {
      return false;
    }
  }
  return true;
}


/**
 * Merges the contents of two or more objects together into the first object, recursing into
 * nested objects and arrays (like jquery.extend(true, ...)).
 * @param {Object} target - The object to modify. Use {} to create a new merged object.
 * @param {Object} ... - Additional objects from which to copy properties into target.
 * @returns {Object} The first argument, target, modified.
 */
export function deepExtend(target: any, _varArgObjects: any): any {
  for (let i = 1; i < arguments.length; i++) {
    const object = arguments[i];
    // Extend the base object
    for (const name in object) {
      if (!object.hasOwnProperty(name)) { continue; }
      let src = object[name];
      if (src === target || src === undefined) {
        // Prevent one kind of infinite loop, as JQuery's extend does, and skip undefined values.
        continue;
      }

      if (src) {
        // Recurse if we're merging plain objects or arrays
        const tgt = target[name];
        if (Array.isArray(src)) {
          src = deepExtend(tgt && Array.isArray(tgt) ? tgt : [], src);
        } else if (typeof src === 'object') {
          src = deepExtend(tgt && typeof tgt === 'object' ? tgt : {}, src);
        }
      }
      target[name] = src;
    }
  }
  // Return the modified object
  return target;
}


/**
 * Returns a human-readable string containing a number of bytes, KB, or MB.
 * @param {Number} bytes. Number of bytes.
 * @returns {String} A description such as "4.1KB".
 */
export function byteString(bytes: number): string {
  if (bytes < 1024) {
    return bytes + 'B';
  } else if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + 'KB';
  } else {
    return (bytes / 1024 / 1024).toFixed(1) + 'MB';
  }
}


/**
 * Creates a new object mapping each key in keysArray to the value returned by callback.
 * @param {Array} keysArray - Array of strings to use as the properties of the returned object.
 * @param {Function} callback - Function that produces the value for each key. Called in the same
 *    way as array.map() calls its callbacks.
 * @param {Object} optThisArg - Value to use as `this` when executing callback.
 * @returns {Object} - object mapping keys from `keysArray` to values returned by `callback`.
 */
export function mapToObject<T>(keysArray: string[], callback: (key: string) => T,
                               optThisArg: any): {[key: string]: T} {
  const values: T[] = keysArray.map(callback, optThisArg);
  const map: {[key: string]: T} = {};
  for (let i = 0; i < keysArray.length; i++) {
    map[keysArray[i]] = values[i];
  }
  return map;
}

/**
 * Remove the specified elements from the array, with the elements specified by
 * their index.  The array arr is modified in-place.  The indexes must be provided
 * in order, sorted lowest to highest, with no duplicates, or out-of-bound indices,
 * etc (this method does no error checking; it is used in place of lodash-pullAt
 * for performance reasons).
 */
export function pruneArray<T>(arr: T[], indexes: number[]) {
  if (indexes.length === 0) { return; }
  if (indexes.length === 1) {
    arr.splice(indexes[0], 1);
    return;
  }
  const len = arr.length;
  let arrAt = 0;
  let indexesAt = 0;
  for (let i = 0; i < len; i++) {
    if (i === indexes[indexesAt]) {
      indexesAt++;
      continue;
    }
    if (i !== arrAt) {
      arr[arrAt] = arr[i];
    }
    arrAt++;
  }
  arr.length = arrAt;
}

/**
 * A List of python identifiers; the result of running keywords.kwlist in Python 2.7.6,
 * plus additional illegal identifiers None, False, True
 * Using [] instead of new Array causes a "comprehension error" for some reason
 */
const _kwlist = ['and', 'as', 'assert', 'break', 'class', 'continue', 'def',
             'del', 'elif', 'else', 'except', 'exec', 'finally', 'for', 'from', 'global',
             'if', 'import', 'in', 'is', 'lambda', 'not', 'or', 'pass', 'print', 'raise',
             'return', 'try', 'while', 'with', 'yield', 'None', 'False', 'True'];
/**
 * Given an arbitrary string, makes substitutions to make it a valid SQL/Python identifier.
 * Corresponds to sandbox/grist/gencode.sanitize_ident
 */
export function sanitizeIdent(ident: string, prefix?: string) {
  prefix = prefix || 'c';
  // Remove non-alphanumeric non-_ chars
  ident = ident.replace(/[^a-zA-Z0-9_]+/g, '_');
  // Remove leading and trailing _
  ident = ident.replace(/^_+|_+$/g, '');
  // Place prefix at front if the beginning isn't a number
  ident = ident.replace(/^(?=[0-9])/g, prefix);
  // Append prefix until it is not  python keyword
  while (_kwlist.includes(ident)) {
    ident = prefix + ident;
  }
  return ident;
}


/**
 * Clone a function, returning a function object that represents a brand new function with the
 * same code. If the same function is used with different argument types, it would prevent JS V8
 * engine optimizations (or cause it to deoptimize it). If different clones are called with
 * different argument types, they can be optimized independently.
 *
 * As with all micro-optimizations, only do this when the optimization matters.
 */
export function cloneFunc(fn: Function): Function {     // tslint:disable-line:ban-types
  /* jshint evil:true */  // suppress eval warning.
  return eval('(' + fn.toString() + ')');   // tslint:disable-line:no-eval
}


/**
 * Generates a random id using a sequence of uppercase alphanumeric characters
 * preceded by an optional prefix.
 */
export function genRandomId(len: number, optPrefix?: string): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let ret = optPrefix || '';
  for (let i = 0; i < len; i++) {
    ret += chars[Math.floor(Math.random() * chars.length)];
  }
  return ret;
}

/**
 * Scans through two sorted arrays, calling a function on each item or pair of items
 * for every present key in order.
 * @param {Array} arrA - First array to scan. NOTE: Should be sorted by the key value.
 * @param {Array} arrB - Second array to scan. NOTE: Should be sorted by the key value.
 * @param {Function} callback - Called with an item from arrA as the first argument and an
 *  item from arrB as the second. Called for every unique key in order, either with one of the
 *  arguments null if the key is present only in one array, or both non-null if the key is
 *  present in both arrays. NOTE: Key values should not be null.
 * @param {Function} optKeyFunc - Optional function to map each array value to a sort key.
 *  Defaults to the identity function.
 */
export function sortedScan<T, U>(arrA: ArrayLike<T>, arrB: ArrayLike<U>,
                                 callback: (a: T|null, B: U|null) => void,
                                 optKeyFunc?: (item: T|U) => any) {
  const keyFunc = optKeyFunc || identity;
  let i = 0, j = 0;
  while (i < arrA.length || j < arrB.length) {
    const a = arrA[i], b = arrB[j];
    const keyA = i < arrA.length ? keyFunc(a) : null;
    const keyB = j < arrB.length ? keyFunc(b) : null;
    if (keyA !== null && (keyB === null || keyA < keyB)) {
      callback(a, null);
      i++;
    } else if (keyA === null || keyA > keyB) {
      callback(null, b);
      j++;
    } else {
      callback(a, b);
      i++;
      j++;
    }
  }
}

/**
 * Returns the time in ms to wait until attempting another connection.
 * @param {Number} attemptNumber - Reconnect attempt number starting at 0.
 * @param {Array} intervals - Array of reconnect intervals in ms.
 * @returns {Number}
 */
export function getReconnectTimeout(attemptNumber: number, intervals: ArrayLike<number>): number {
  if (attemptNumber >= intervals.length) {
    // Add an additional wait time if already at max attempts.
    const timeout = intervals[intervals.length - 1];
    return timeout + Math.random() * timeout;
  } else {
    return intervals[attemptNumber];
  }
}

/**
 * Returns whether the given email is a valid formatted email string.
 * @param {String} email - Email to test.
 * @returns {Boolean}
 */
export function isEmail(email: string): boolean {
  return EMAIL_RE.test(email.toLowerCase());
}

/*
 * Takes an observable and returns a promise for when the observable's value matches the given
 * predicate. It then unsubscribes from the observable, and returns its value.
 * If a predicate is not given, resolves to the observable values as soon as it's truthy.
 */
export function waitObs<T>(observable: KoObservable<T>, predicate: (value: T) => boolean = Boolean): Promise<T> {
  return new Promise((resolve, _reject) => {
    const value = observable.peek();
    if (predicate(value)) { return resolve(value); }
    const sub = observable.subscribe((val: T) => {
      if (predicate(val)) {
        sub.dispose();
        resolve(val);
      }
    });
  });
}

/**
 * Same as waitObs but for grainjs observables.
 */
export async function waitGrainObs<T>(observable: Observable<T>): Promise<NonNullable<T>>;
export async function waitGrainObs<T>(observable: Observable<T>, predicate?: (value: T) => boolean): Promise<T>;
export async function waitGrainObs<T>(observable: Observable<T>,
                                      predicate: (value: T) => boolean = Boolean): Promise<T> {
  let sub: Listener|undefined;
  const res: T = await new Promise((resolve, _reject) => {
    const value = observable.get();
    if (predicate(value)) { return resolve(value); }
    sub = observable.addListener((val: T) => {
      if (predicate(val)) {
        resolve(val);
      }
    });
  });
  if (sub) { sub.dispose(); }
  return res;
}


// `dom.style` does not work here because custom css property (ie: `--foo`) needs to be set using
// `style.setProperty` (credit: https://vanseodesign.com/css/custom-properties-and-javascript/).
// TODO: consider making PR to fix `dom.style` in grainjs.
export function inlineStyle(property: string, valueObs: BindableValue<any>): DomElementMethod {
  return (elem) => subscribeElem(elem, valueObs, (val) => {
    elem.style.setProperty(property, String(val ?? ''));
  });
}


/**
 * Class to maintain a chain of promise-returning callbacks. All scheduled callbacks will be
 * called in order as long as the previous one is successful. If a callback fails is rejected,
 * already-scheduled callbacks will be skipped, but newly-scheduled ones will be run.
 */
export class PromiseChain<T> {
  private _last: Promise<T|void> = Promise.resolve();

  // Adds a callback to the chain. If the callback runs, the return value is the return value of
  // the callback. If it's skipped due to a failure earlier in the chain, the return value is the
  // rejection with the message "Skipped due to an earlier error".
  public add(nextCB: () => Promise<T>): Promise<T> {
    const next = this._last.catch(() => { throw new Error("Skipped due to an earlier error"); }).then(nextCB);
    // If any callback fails, all queued ones will be skipped. Here we reset the chain, so that
    // callbacks added later do get run.
    next.catch(() => { this._last = Promise.resolve(); });
    this._last = next;
    return next;
  }
}

/**
 * Indicates if a hex color value, e.g. '#000000', is darker than the given value.
 * Darkness is measured from 0..255, where 0 is the darkest and 255 is the lightest.
 *
 * Taken from: https://stackoverflow.com/questions/12043187/how-to-check-if-hex-color-is-too-black
 */
export function isColorDark(hexColor: string, isDarkBelow: number = 220): boolean {
  const c = hexColor.substring(1);  // strip #
  const rgb = parseInt(c, 16);      // convert rrggbb to decimal
  // Extract RGB components
  const r = (rgb >> 16) & 0xff;     // tslint:disable-line:no-bitwise
  const g = (rgb >>  8) & 0xff;     // tslint:disable-line:no-bitwise
  const b = (rgb >>  0) & 0xff;     // tslint:disable-line:no-bitwise

  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;  // per ITU-R BT.709
  return luma < isDarkBelow;
}

/**
 * Returns true if val is a valid hex color value. For instance: #aabbaa is valid, #aabba is not. Do
 * not accept neither short notation nor hex with transparency, ie: #aab, #aabb and #aabbaabb are
 * invalid.
 */
export function isValidHex(val: string): boolean {
  return /^#([0-9A-F]{6})$/i.test(val);
}

/**
 * Resolves to true if promise is still pending after msec milliseconds have passed. Otherwise
 * returns false, including when promise is rejected.
 */
export async function timeoutReached(
  msec: number, promise: Promise<unknown>, options: {rethrow: boolean} = {rethrow: false}
): Promise<boolean> {
  const timedOut = {};
  // Be careful to clean up the timer after ourselves, so it doesn't remain in the event loop.
  let timer: NodeJS.Timer;
  const delayPromise = new Promise<any>((resolve) => { timer = setTimeout(() => resolve(timedOut), msec); });
  try {
    const res = await Promise.race([promise, delayPromise]);
    return res == timedOut;
  } catch (err) {
    if (options.rethrow) {
      throw err;
    }
    return false;
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Returns a promise that resolves to true if promise takes longer than timeoutMsec to resolve. If not
 * or if promise throws returns false. Same as timeoutReached(), with reversed order of arguments.
 */
export async function isLongerThan(promise: Promise<unknown>, timeoutMsec: number): Promise<boolean> {
  return timeoutReached(timeoutMsec, promise);
}

/**
 * Returns true if the parameter, when rendered as a string, matches
 * 1, on, or true (case insensitively).  Useful for processing query
 * parameters that may have been manually set.
 */
export function isAffirmative(parameter: any): boolean {
  return ['1', 'on', 'true', 'yes'].includes(String(parameter).toLowerCase());
}

/**
 * Returns whether a value is neither null nor undefined, with a type guard for the return type.
 *
 * This is particularly useful for filtering, e.g. if `array` includes values of type
 * T|null|undefined, then TypeScript can tell that `array.filter(isNonNullish)` has the type T[].
 */
export function isNonNullish<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Ensures that a value is truthy, with a type guard for the return type.
 */
export function truthy<T>(value: T | null | undefined): value is Exclude<T, false | "" | 0> {
  return Boolean(value);
}

/**
 * Returns the value of both grainjs and knockout observable without creating a dependency.
 */
export const unwrap: UseCB = (obs: ISubscribable) => {
  if ('_getDepItem' in obs) {
    return obs.get();
  }
  return (obs as ko.Observable).peek();
};

/**
 * Subscribes to BindableValue
 */
export function useBindable<T>(use: UseCBOwner, obs: BindableValue<T>): T {
  if (obs === null || obs === undefined) { return obs; }

  const smth = obs as any;

  // If knockout
  if (typeof smth === 'function' && 'peek' in smth) { return use(smth) as T; }
  // If grainjs Observable or Computed
  if (typeof smth === 'object' && '_getDepItem' in smth) { return use(smth) as T; }
  // If use function ComputedCallback
  if (typeof smth === 'function') { return smth(use) as T; }

  return obs as T;
}

/**
 * Useful helper for simple boolean negation.
 */
export const not = (obs: Observable<any>|IKnockoutReadObservable<any>) => (use: UseCBOwner) => !use(obs);

/**
 * Get a set of up to `count` distinct values of `values`.
 */
export function getDistinctValues<T>(values: readonly T[], count: number = Infinity): Set<T> {
  const distinct = new Set<T>();
  // Add values to the set until it reaches the desired size, or until there are no more values.
  for (let i = 0; i < values.length && distinct.size < count; i++) {
    distinct.add(values[i]);
  }
  return distinct;
}

/**
 * Asserts that variable `name` has a non-nullish `value`.
 */
export function assertIsDefined<T>(name: string, value: T): asserts value is NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error(`Expected '${name}' to be defined, but received ${value}`);
  }
}

/**
 * Calls function `fn`, passes any thrown errors to function `recover`, and finally calls `fn`
 * once more if `recover` doesn't throw.
 */
export async function retryOnce<T>(fn: () => Promise<T>, recover: (e: unknown) => Promise<void>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    await recover(e);
    return await fn();
  }
}

/**
 * Checks if value is 'empty' (like null, undefined, empty string, empty array/set/map, empty object).
 * Values like 0, true, false are not empty.
 */
export function notSet(value: any) {
  return value === undefined || value === null || value === ''
         || (Array.isArray(value) && !value.length)
         || (typeof value === 'object' && !Object.keys(value).length)
         || (['[object Map]', '[object Set'].includes(value.toString()) && !value.size);
}

/**
 * Checks if value is 'empty', if it is, returns the default value (which is null).
 */
export function ifNotSet(value: any, def: any = null) {
  return notSet(value) ? def : value;
}

/**
 * Creates a computed observable with a nested owner that can be used to dispose,
 * any disposables created inside the computed. Similar to domComputedOwned method.
 */
export function computedOwned<T>(
  owner: IDisposableOwner,
  func: (owner: IDisposableOwner, use: UseCBOwner) => T
): Computed<T> {
  const holder = Holder.create(owner);
  return Computed.create(owner, use => {
    const computedOwner = MultiHolder.create(holder);
    return func(computedOwner, use);
  });
}

export type Constructor<T> = new (...args: any[]) => T;
