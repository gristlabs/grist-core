/**
 * SortFunc class interprets the sortSpec (as saved in viewSection.sortColRefs), exposing a
 * compare(rowId1, rowId2) function that can be used to actually sort rows in a view.
 *
 * TODO: When an operation (such as a paste) would cause rows to jump in the sort order, this
 * class should support freezing of row positions until the user chooses to re-sort. This is not
 * currently implemented.
 */
import { ColumnGetter, ColumnGetters } from "app/common/ColumnGetters";
import { localeCompare, nativeCompare as nativeCompareImport } from "app/common/gutil";
import { Sort } from "app/common/SortSpec";

// Calling the import may cost a module-object lookup each time (for webpack bundles); this local
// alias speeds up sorting because the JS engine can inline.
const nativeCompare = nativeCompareImport;

// Function that will amend column getter to return entry index instead
// of entry value. Result will be a string padded with zeros, so the ordering
// between types is preserved.
export function choiceGetter(getter: ColumnGetter, choices: string[]): ColumnGetter {
  return (rowId) => {
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
const collator = new Intl.Collator(undefined, { numeric: true });
export function naturalCompare(val1: any, val2: any) {
  if (typeof val1 === "string" && typeof val2 === "string") {
    return collator.compare(val1, val2);
  }
  return typedCompare(val1, val2);
}

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
  let result: number, type1: string;
  if ((result = nativeCompare(type1 = typeof val1, typeof val2)) !== 0) {
    return result;
  }

  switch (type1) {
    case "string": return localeCompare(val1, val2);
    case "number": {
      // Check for NaN explicitly since it doesn't satisfy triangle inequality.
      return nativeCompare(Number.isNaN(val1), Number.isNaN(val2)) || nativeCompare(val1, val2);
    }
    case "object": {
      // null sorts before any other object.
      result = nativeCompare(val1 !== null, val2 !== null);
      if (result !== 0) { return result; }

      // We need to worry about Array comparisons because formulas returning Any may return null or
      // object values represented as arrays (e.g. ['D', ...] for dates). Comparing those without
      // distinguishing types would break the sort. Also, arrays need a special comparator.
      const isArray1 = val1 instanceof Array;
      result = nativeCompare(isArray1, val2 instanceof Array);
      if (result !== 0) { return result; }
      if (isArray1) { return _arrayCompare(val1, val2); }  // Both sides are arrays.

      // In cell values, we don't expect any other kinds of objects (those should be encoded),
      // but if typedCompare is used for other values, it's reasonable to at least handle Dates.
      const isDate1 = val1 instanceof Date;
      result = nativeCompare(isDate1, val2 instanceof Date);
      if (result !== 0) { return result; }
      if (isDate1) { return nativeCompare(val1, val2); }  // Both sides are dates.
      return 0;
    }
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
  // updateSpec() populates this field, used by the compare() method.
  private _columns: { getter: ColumnGetter, comparator: Comparator, direction: Sort.Direction }[] = [];

  constructor(private _getters: ColumnGetters) {}

  public updateSpec(sortSpec: Sort.SortSpec): void {
    // Prepare a getter and a comparator (which includes the sort direction) for each column.
    this._columns = sortSpec.flatMap((colSpec) => {
      const getter = this._getters.getColGetter(colSpec);
      const details = Sort.specToDetails(colSpec);
      return getter ? [{ getter, comparator: makeComparator(details), direction: details.direction }] : [];
    });

    const manualSortGetter = this._getters.getManualSortGetter();
    if (manualSortGetter) {
      this._columns.push({ getter: manualSortGetter, comparator: typedCompare, direction: 1 });
    }
  }

  /**
   * Returns 1 or -1 depending on whether rowId1 should be shown before rowId2.
   */
  public compare(rowId1: number, rowId2: number): number {
    for (const { getter, comparator, direction } of this._columns) {
      const result = comparator(getter(rowId1), getter(rowId2));
      if (result) {
        return result * direction;
      }
    }
    return nativeCompare(rowId1, rowId2);
  }
}

/**
 * Builds the comparator for one column of a sort spec: empty values (if the sort spec places
 * them) before the values themselves.
 */
function makeComparator(details: Sort.ColSpecDetails): Comparator {
  const { naturalSort, emptyFirst, emptyLast } = details;
  const compareValues = naturalSort ? naturalCompare : typedCompare;
  if (emptyLast) {
    return (val1, val2) => nativeCompare(isEmpty(val1), isEmpty(val2)) || compareValues(val1, val2);
  } else if (emptyFirst) {
    return (val1, val2) => nativeCompare(isEmpty(val2), isEmpty(val1)) || compareValues(val1, val2);
  } else {
    return compareValues;
  }
}

function isEmpty(val: any): boolean {
  return !val && typeof val !== "number";
}

/**
 * Wrapper for typedCompare that can be used as a sort function for Array.sort().
 * Example:
 * const sorted = rows.sort(orderBy(row => row.name));
 */
export function orderBy<T>(keyFunc: (row: T) => any, options: { desc?: boolean } = { desc: false }) {
  return function(a: T, b: T) {
    const val1 = keyFunc(a);
    const val2 = keyFunc(b);
    return typedCompare(val1, val2) * (options.desc ? -1 : 1);
  };
}
