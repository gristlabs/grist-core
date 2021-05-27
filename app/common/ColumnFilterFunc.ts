import { CellValue } from "app/common/DocActions";
import { FilterState, makeFilterState } from "app/common/FilterState";

export type ColumnFilterFunc = (value: CellValue) => boolean;

// Returns a filter function for a particular column: the function takes a cell value and returns
// whether it's accepted according to the given FilterState.
export function makeFilterFunc({ include, values }: FilterState): ColumnFilterFunc {
  // NOTE: This logic results in complex values and their stringified JSON representations as equivalent.
  // For example, a TypeError in the formula column and the string '["E","TypeError"]' would be seen as the same.
  // TODO: This narrow corner case seems acceptable for now, but may be worth revisiting.
  return (val: CellValue) => (values.has(Array.isArray(val) ? JSON.stringify(val) : val) === include);
}

// Given a JSON string, returns a ColumnFilterFunc
export function buildColFilter(filterJson: string | undefined): ColumnFilterFunc | null {
  return filterJson ? makeFilterFunc(makeFilterState(filterJson)) : null;
}
