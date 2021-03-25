import { Computed, Disposable, Observable } from "grainjs";
import escapeRegExp = require("lodash/escapeRegExp");
import { CellValue } from "app/plugin/GristData";
import { localeCompare } from "app/common/gutil";
import { ColumnFilter } from "./ColumnFilter";

const MAXIMUM_SHOWN_FILTER_ITEMS = 500;

export interface IFilterCount {
  label: string;
  count: number;
}


export class ColumnFilterMenuModel extends Disposable {

  public readonly searchValue = Observable.create(this, '');

  // computes a set of all keys that matches the search text.
  public readonly filterSet = Computed.create(this, this.searchValue, (_use, searchValue) => {
    const searchRegex = new RegExp(escapeRegExp(searchValue), 'i');
    return new Set(this._valueCount.filter(([_, {label}]) => searchRegex.test(label)).map(([key]) => key));
  });

  // computes the sorted array of all values (ie: pair of key and IFilterCount) that matches the search text.
  public readonly filteredValues = Computed.create(this, this.filterSet, (_use, filter) => {
    return this._valueCount.filter(([key]) => filter.has(key))
      .sort((a, b) => localeCompare(a[1].label, b[1].label));
  });

  // computes the array of all values that does NOT matches the search text
  public readonly otherValues = Computed.create(this, this.filterSet, (_use, filter) => {
    return this._valueCount.filter(([key]) => !filter.has(key));
  });

  // computes the array of keys that matches the search text
  public readonly filteredKeys = Computed.create(this, this.filteredValues, (_use, values) => (
    values.map(([key]) => key)
  ));

  public readonly valuesBeyondLimit = Computed.create(this, this.filteredValues, (_use, values) => (
    values.slice(this.limitShown)
  ));

  constructor(public columnFilter: ColumnFilter, private _valueCount: Array<[CellValue, IFilterCount]>,
              public limitShown: number = MAXIMUM_SHOWN_FILTER_ITEMS) {
    super();
  }
}
