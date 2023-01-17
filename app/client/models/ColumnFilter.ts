import {ColumnFilterFunc, makeFilterFunc} from "app/common/ColumnFilterFunc";
import {CellValue} from 'app/common/DocActions';
import {
  FilterSpec, FilterState, IRelativeDateSpec, isRangeFilter, isRelativeBound, makeFilterState
} from "app/common/FilterState";
import {relativeDateToUnixTimestamp} from "app/common/RelativeDates";
import {nativeCompare} from 'app/common/gutil';
import {Computed, Disposable, Observable} from 'grainjs';

/**
 * ColumnFilter implements a custom filter on a column, i.e. a filter that's diverged from what's
 * on the server. It has methods to modify the filter state, and exposes a public filterFunc
 * observable which gets triggered whenever the filter state changes.
 *
 * It does NOT listen to changes in the initial JSON, since it's only used when the filter has
 * been customized.
 */
export class ColumnFilter extends Disposable {

  public min = Observable.create<number|undefined|IRelativeDateSpec>(this, undefined);
  public max = Observable.create<number|undefined|IRelativeDateSpec>(this, undefined);

  public readonly filterFunc = Observable.create<ColumnFilterFunc>(this, () => true);

  // Computed that returns true if filter is an inclusion filter, false otherwise.
  public readonly isInclusionFilter: Computed<boolean> = Computed.create(this, this.filterFunc, () => this._include);

  // Computed that returns the current filter state.
  public readonly state: Computed<FilterState> = Computed.create(this, this.filterFunc, () => this._getState());

  public readonly isRange: Computed<boolean> = Computed.create(this, this.filterFunc, () => this._isRange());

  private _include: boolean;
  private _values: Set<CellValue>;

  constructor(private _initialFilterJson: string, private _columnType: string = '',
              public visibleColumnType: string = '', private _allValues: CellValue[] = []) {
    super();
    this.setState(_initialFilterJson);
    this.autoDispose(this.min.addListener(() => this._updateState()));
    this.autoDispose(this.max.addListener(() => this._updateState()));
  }

  public get columnType() {
    return this._columnType;
  }

  public get initialFilterJson() {
    return this._initialFilterJson;
  }

  public setState(filterJson: string|FilterSpec) {
    const state = makeFilterState(filterJson);
    if (isRangeFilter(state)) {
      this.min.set(state.min);
      this.max.set(state.max);
      // Setting _include to false allows to make sure that the filter reverts to all values
      // included when users delete one bound (min or max) while the other bound is already
      // undefined (filter reverts to switching by value when both min and max are undefined).
      this._include = false;
      this._values = new Set();
    } else {
      this.min.set(undefined);
      this.max.set(undefined);
      this._include = state.include;
      this._values = state.values;
    }
    this._updateState();
  }

  public includes(val: CellValue): boolean {
    return this.filterFunc.get()(val);
  }

  public add(val: CellValue) {
    this.addMany([val]);
  }

  public addMany(values: CellValue[]) {
    this._toValues();
    for (const val of values) {
      this._include ? this._values.add(val) : this._values.delete(val);
    }
    this._updateState();
  }

  public delete(val: CellValue) {
    this.deleteMany([val]);
  }

  public deleteMany(values: CellValue[]) {
    this._toValues();
    for (const val of values) {
      this._include ? this._values.delete(val) : this._values.add(val);
    }
    this._updateState();
  }

  public clear() {
    this._values.clear();
    this._include = true;
    this._updateState();
  }

  public selectAll() {
    this._values.clear();
    this._include = false;
    this._updateState();
  }

  // For saving the filter value back.
  public makeFilterJson(): string {
    let filter: any;
    if (this.min.get() !== undefined || this.max.get() !== undefined) {
      filter = {min: this.min.get(), max: this.max.get()};
    } else {
      const values = Array.from(this._values).sort(nativeCompare);
      filter = {[this._include ? 'included' : 'excluded']: values};
    }
    return JSON.stringify(filter);
  }

  public hasChanged(): boolean {
    return this.makeFilterJson() !== this._initialFilterJson;
  }

  // Retuns min or max as a numeric value.
  public getBoundsValue(minMax: 'min' | 'max'): number {
    const value = this[minMax].get();
    if (value === undefined) { return minMax === 'min' ? -Infinity : +Infinity; }
    return isRelativeBound(value) ? relativeDateToUnixTimestamp(value) : value;
  }


  private _updateState(): void {
    this.filterFunc.set(makeFilterFunc(this._getState(), this._columnType));
  }

  private _getState(): FilterState {
    return {include: this._include, values: this._values, min: this.min.get(), max: this.max.get()};
  }

  private _isRange() {
    return isRangeFilter(this._getState());
  }

  private _toValues() {
    if (this._isRange()) {
      const func = this.filterFunc.get();
      const state = this._include ?
        { included: this._allValues.filter((val) => func(val)) } :
        { excluded: this._allValues.filter((val) => !func(val)) };
      this.setState(state);
    }
  }
}

/**
 * A JSON-encoded filter spec that includes every value.
 */
export const ALL_INCLUSIVE_FILTER_JSON = '{"excluded":[]}';

/**
 * A blank JSON-encoded filter spec.
 *
 * This is interpreted the same as `ALL_INCLUSIVE_FILTER_JSON` in the context
 * of parsing filters. However, it's still useful in scenarios where it's
 * necessary to discern between new filters and existing filters; initializing
 * a `ColumnFilter` with `NEW_FIlTER_JSON` makes it clear that a new filter
 * is being created.
 */
export const NEW_FILTER_JSON = '{}';
