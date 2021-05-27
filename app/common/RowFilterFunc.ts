import { CellValue } from "app/common/DocActions";
import { ColumnFilterFunc } from "app/common/ColumnFilterFunc";

export type RowFilterFunc<T> = (row: T) => boolean;

// Builds RowFilter for a single column
export function buildRowFilter<T>(
  getter: RowValueFunc<T> | null,
  filterFunc: ColumnFilterFunc | null): RowFilterFunc<T> {
  if (!getter || !filterFunc) {
    return () => true;
  }
  return (rowId: T) => filterFunc(getter(rowId));
}

export type RowValueFunc<T> = (rowId: T) => CellValue;
