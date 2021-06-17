import {ColumnFilterFunc, makeFilterFunc} from "app/common/ColumnFilterFunc";
import {CellValue} from 'app/common/DocActions';
import {FilterSpec, FilterState, makeFilterState} from "app/common/FilterState";
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
  public readonly filterFunc = Observable.create<ColumnFilterFunc>(this, () => true);

  // Computed that returns true if filter is an inclusion filter, false otherwise.
  public readonly isInclusionFilter: Computed<boolean> = Computed.create(this, this.filterFunc, () => this._include);

  // Computed that returns the current filter state.
  public readonly state: Computed<FilterState> = Computed.create(this, this.filterFunc, () => this._getState());

  private _include: boolean;
  private _values: Set<CellValue>;

  constructor(private _initialFilterJson: string, private _columnType?: string) {
    super();
    this.setState(_initialFilterJson);
  }

  public setState(filterJson: string|FilterSpec) {
    const state = makeFilterState(filterJson);
    this._include = state.include;
    this._values = state.values;
    this._updateState();
  }

  public includes(val: CellValue): boolean {
    return this._values.has(val) === this._include;
  }

  public add(val: CellValue) {
    this.addMany([val]);
  }

  public addMany(values: CellValue[]) {
    for (const val of values) {
      this._include ? this._values.add(val) : this._values.delete(val);
    }
    this._updateState();
  }

  public delete(val: CellValue) {
    this.deleteMany([val]);
  }

  public deleteMany(values: CellValue[]) {
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
    const values = Array.from(this._values).sort(nativeCompare);
    return JSON.stringify(this._include ? {included: values} : {excluded: values});
  }

  public hasChanged(): boolean {
    return this.makeFilterJson() !== this._initialFilterJson;
  }

  private _updateState(): void {
    this.filterFunc.set(makeFilterFunc(this._getState(), this._columnType));
  }

  private _getState(): FilterState {
    return {include: this._include, values: this._values};
  }
}

export const allInclusive = '{"excluded":[]}';
