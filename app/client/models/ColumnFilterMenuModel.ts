import { ColumnFilter } from "app/client/models/ColumnFilter";
import { CellValue } from "app/plugin/GristData";
import { normalizeText } from "app/client/lib/ACIndex";
import { Computed, Disposable, Observable } from "grainjs";
import escapeRegExp = require("lodash/escapeRegExp");
import isNull = require("lodash/isNull");

const MAXIMUM_SHOWN_FILTER_ITEMS = 500;

export interface IFilterCount {

  // label is the formatted value
  label: string;

  // number of occurences in the table
  count: number;

  // displayValue is the underlying value (from the display column, if any), useful to perform
  // comparison
  displayValue: any;
}

type ICompare<T> = (a: T, b: T) => number

const localeCompare = new Intl.Collator('en-US', {numeric: true}).compare;

export class ColumnFilterMenuModel extends Disposable {

  public readonly searchValue = Observable.create(this, '');

  public readonly isSortedByCount = Observable.create(this, false);

  // computes a set of all keys that matches the search text.
  public readonly filterSet = Computed.create(this, this.searchValue, (_use, searchValue) => {
    const searchRegex = new RegExp(escapeRegExp(normalizeText(searchValue)), 'i');
    const showAllOptions = ['Bool', 'Choice', 'ChoiceList'].includes(this.columnFilter.columnType);
    return new Set(
      this._valueCount
        .filter(([_, {label, count}]) => (showAllOptions ? true : count) && searchRegex.test(normalizeText(label)))
        .map(([key]) => key)
    );
  });

  // computes the sorted array of all values (ie: pair of key and IFilterCount) that matches the search text.
  public readonly filteredValues = Computed.create(
    this, this.filterSet, this.isSortedByCount,
    (_use, filter, isSortedByCount) => {
      const prop: keyof IFilterCount = isSortedByCount ? 'count' : 'displayValue';
      let isShownFirst: (val: any) => boolean = isNull;
      if (['Date', 'DateTime', 'Numeric', 'Int'].includes(this.columnFilter.visibleColumnType)) {
        isShownFirst = (val) => isNull(val) || isNaN(val);
      }

      const comparator: ICompare<any> = (a, b) => {
        if (isShownFirst(a)) { return -1; }
        if (isShownFirst(b)) { return 1; }
        return localeCompare(a,  b);
      };

      return this._valueCount
        .filter(([key]) => filter.has(key))
        .sort((a, b) => comparator(a[1][prop], b[1][prop]));
    }
  );

  // computes the array of all values that does NOT matches the search text
  public readonly otherValues = Computed.create(this, this.filterSet, (_use, filter) => {
    return this._valueCount.filter(([key]) => !filter.has(key));
  });

  // computes the array of keys that matches the search text
  public readonly filteredKeys = Computed.create(this, this.filterSet, (_use, filter) => {
    return this._valueCount
      .filter(([key]) => filter.has(key))
      .map(([key]) => key);
  });

  public readonly valuesBeyondLimit = Computed.create(this, this.filteredValues, (_use, filteredValues) => {
    return filteredValues.slice(this.limitShown);
  });

  constructor(public columnFilter: ColumnFilter, private _valueCount: Array<[CellValue, IFilterCount]>,
              public limitShown: number = MAXIMUM_SHOWN_FILTER_ITEMS) {
    super();
  }
}
