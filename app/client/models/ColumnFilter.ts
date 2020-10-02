import {CellValue} from 'app/common/DocActions';
import {nativeCompare} from 'app/common/gutil';
import {Disposable, Observable} from 'grainjs';

export type ColumnFilterFunc = (value: CellValue) => boolean;

interface FilterSpec { // Filter object as stored in the db
  included?: CellValue[];
  excluded?: CellValue[];
}

// A more efficient representation of filter state for a column than FilterSpec.
interface FilterState {
  include: boolean;
  values: Set<CellValue>;
}

// Converts a JSON string for a filter to a FilterState
function makeFilterState(filterJson: string): FilterState {
  const spec: FilterSpec = (filterJson && JSON.parse(filterJson)) || {};
  return {
    include: Boolean(spec.included),
    values: new Set(spec.included || spec.excluded || []),
  };
}

// Returns a filter function for a particular column: the function takes a cell value and returns
// whether it's accepted according to the given FilterState.
function makeFilterFunc({include, values}: FilterState): ColumnFilterFunc {
  // NOTE: This logic results in complex values and their stringified JSON representations as equivalent.
  // For example, a TypeError in the formula column and the string '["E","TypeError"]' would be seen as the same.
  // TODO: This narrow corner case seems acceptable for now, but may be worth revisiting.
  return (val: CellValue) => (values.has(Array.isArray(val) ? JSON.stringify(val) : val) === include);
}

// Given a JSON string, returns a ColumnFilterFunc
export function getFilterFunc(filterJson: string): ColumnFilterFunc|null {
 return filterJson ? makeFilterFunc(makeFilterState(filterJson)) : null;
}

/**
 * ColumnFilter implements a custom filter on a column, i.e. a filter that's diverged from what's
 * on the server. It has methods to modify the filter state, and exposes a public filterFunc
 * observable which gets triggered whenever the filter state changes.
 *
 * It does NOT listen to changes in the initial JSON, since it's only used when the filter has
 * been customized.
 */
export class ColumnFilter extends Disposable {
  public readonly filterFunc: Observable<ColumnFilterFunc>;

  private _include: boolean;
  private _values: Set<CellValue>;

  constructor(private _initialFilterJson: string) {
    super();
    this.filterFunc = Observable.create<ColumnFilterFunc>(this, () => true);
    this.setState(_initialFilterJson);
  }

  public setState(filterJson: string) {
    const state = makeFilterState(filterJson);
    this._include = state.include;
    this._values = state.values;
    this._updateState();
  }

  public includes(val: CellValue): boolean {
    return this._values.has(val) === this._include;
  }

  public add(val: CellValue) {
    this._include ? this._values.add(val) : this._values.delete(val);
    this._updateState();
  }

  public delete(val: CellValue) {
    this._include ? this._values.delete(val) : this._values.add(val);
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
    this.filterFunc.set(makeFilterFunc({include: this._include, values: this._values}));
  }
}

export const allInclusive = '{"excluded":[]}';
