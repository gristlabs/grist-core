/**
 * SortFunc class interprets the sortSpec (as saved in viewSection.sortColRefs), exposing a
 * compare(rowId1, rowId2) function that can be used to actually sort rows in a view.
 *
 * TODO: When an operation (such as a paste) would cause rows to jump in the sort order, this
 * class should support freezing of row positions until the user chooses to re-sort. This is not
 * currently implemented.
 */
import {ColumnGetter, ColumnGetters} from 'app/common/ColumnGetters';
import {localeCompare, nativeCompare} from 'app/common/gutil';
import {Sort} from 'app/common/SortSpec';

// Function that will amend column getter to return entry index instead
// of entry value. Result will be a string padded with zeros, so the ordering
// between types is preserved.
export function choiceGetter(getter: ColumnGetter, choices: string[]): ColumnGetter {
  return rowId => {
    const value = getter(rowId);
    const index = choices.indexOf(value);
    return index >= 0 ? String(index).padStart(5, "0") : value;
  };
}

type Comparator = (val1: any, val2: any) => number;

/**
 * Natural comparator based on built in method.
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare
 */
const collator = new Intl.Collator(undefined, {numeric: true});
function naturalCompare(val1: any, val2: any) {
  if (typeof val1 === 'string' && typeof val2 === 'string') {
    return collator.compare(val1, val2);
  }
  return typedCompare(val1, val2);
}

/**
 * Empty comparator will treat empty values as last.
 */
export const emptyCompare = (next: Comparator) => (val1: any, val2: any) => {
  const isEmptyValue1 = !val1 && typeof val1 !== 'number';
  const isEmptyValue2 = !val2 && typeof val2 !== 'number';

  // If both values are empty values, rely on next to compare.
  if (isEmptyValue1 && !isEmptyValue2) {
    return 1;
  }
  if (isEmptyValue2 && !isEmptyValue1) {
    return -1;
  }
  return next(val1, val2);
};


/**
 * Compare two cell values, paying attention to types and values. Note that native JS comparison
 * can't be used for sorting because it isn't transitive across types (e.g. both 1 < "2" and "2" <
 * "a" are true, but 1 < "a" is false.). In addition, we handle complex values represented in
 * Grist as arrays.
 *
 * Note that we need to handle different types of values regardless of the column type,
 * because e.g. a numerical column may contain text (alttext) or null values.
 */
export function typedCompare(val1: any, val2: any): number {
  let result: number, type1: string, array1: boolean;
  // tslint:disable-next-line:no-conditional-assignment
  if ((result = nativeCompare(type1 = typeof val1, typeof val2)) !== 0) {
    return result;
  }
  // We need to worry about Array comparisons because formulas returning Any may return null or
  // object values represented as arrays (e.g. ['D', ...] for dates). Comparing those without
  // distinguishing types would break the sort. Also, arrays need a special comparator.
  if (type1 === 'object') {
    // tslint:disable-next-line:no-conditional-assignment
    if ((result = nativeCompare(array1 = val1 instanceof Array, val2 instanceof Array)) !== 0) {
      return result;
    }
    if (array1) {
      return _arrayCompare(val1, val2);
    }
  }
  if (type1 === 'string') {
    return localeCompare(val1, val2);
  }
  return nativeCompare(val1, val2);
}

function _arrayCompare(val1: any[], val2: any[]): number {
  for (let i = 0; i < val1.length; i++) {
    if (i >= val2.length) {
      return 1;
    }
    const value = typedCompare(val1[i], val2[i]);
    if (value) {
      return value;
    }
  }
  return val1.length === val2.length ? 0 : -1;
}

/**
 * getters is an implementation of app.common.ColumnGetters
 */
export class SortFunc {
  // updateSpec() or updateGetters() can populate these fields, used by the compare() method.
  private _colGetters: ColumnGetter[] = [];  // Array of column getters (mapping rowId to column value)
  private _directions: number[] = [];           // Array of 1 (ascending) or -1 (descending) flags.
  private _comparators: Comparator[] = [];

  constructor(private _getters: ColumnGetters) {}

  public updateSpec(sortSpec: Sort.SortSpec): void {
    // Prepare an array of column getters for each column in sortSpec.
    this._colGetters = sortSpec.map(colSpec => {
      return this._getters.getColGetter(colSpec);
    }).filter(getter => getter) as ColumnGetter[];

    // Collect "ascending" flags as an array of 1 or -1, one for each column.
    this._directions = sortSpec.map(colSpec => Sort.direction(colSpec));

    // Collect comparator functions
    this._comparators = sortSpec.map(colSpec => {
      const details = Sort.specToDetails(colSpec);
      let comparator = typedCompare;
      if (details.naturalSort) {
        comparator = naturalCompare;
      }
      // Empty decorator should be added last, as first we want to compare
      // empty values
      if (details.emptyLast) {
        comparator = emptyCompare(comparator);
      }
      return comparator;
    });

    const manualSortGetter = this._getters.getManualSortGetter();
    if (manualSortGetter) {
      this._colGetters.push(manualSortGetter);
      this._directions.push(1);
      this._comparators.push(typedCompare);
    }
  }

  /**
   * Returns 1 or -1 depending on whether rowId1 should be shown before rowId2.
   */
  public compare(rowId1: number, rowId2: number): number {
    for (let i = 0, len = this._colGetters.length; i < len; i++) {
      const getter = this._colGetters[i];
      const val1 = getter(rowId1);
      const val2 = getter(rowId2);
      const comparator = this._comparators[i];
      const result = comparator(val1, val2);
      if (result !== 0 /* not equal */) {
        return result * this._directions[i];
      }
    }
    return nativeCompare(rowId1, rowId2);
  }
}
