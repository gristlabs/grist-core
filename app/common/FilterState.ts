import { CellValue } from "app/common/DocActions";

// Filter object as stored in the db
export interface FilterSpec {
  included?: CellValue[];
  excluded?: CellValue[];
}

// A more efficient representation of filter state for a column than FilterSpec.
export interface FilterState {
  include: boolean;
  values: Set<CellValue>;
}

// Creates a FilterState. Accepts spec as a json string or a FilterSpec.
export function makeFilterState(spec: string | FilterSpec): FilterState {
  if (typeof (spec) === 'string') {
    return makeFilterState((spec && JSON.parse(spec)) || {});
  }
  return {
    include: Boolean(spec.included),
    values: new Set(spec.included || spec.excluded || []),
  };
}

// Returns true if state and spec are equivalent, false otherwise.
export function isEquivalentFilter(state: FilterState, spec: FilterSpec): boolean {
  const other = makeFilterState(spec);
  if (state.include !== other.include) { return false; }
  if (state.values.size !== other.values.size) { return false; }
  for (const val of other.values) { if (!state.values.has(val)) { return false; } }
  return true;
}
