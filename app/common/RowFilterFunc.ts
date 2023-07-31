import {CellValue} from "app/common/DocActions";
import {ColumnFilterFunc} from "app/common/ColumnFilterFunc";
import {FilterColValues} from 'app/common/ActiveDocAPI';
import {isList} from 'app/common/gristTypes';
import {decodeObject} from 'app/plugin/objtypes';
import {ColumnGettersByColId} from 'app/common/ColumnGetters';

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

// Filter rows for the purpose of linked widgets
export function getLinkingFilterFunc(
  columnGetters: ColumnGettersByColId, {filters, operations}: FilterColValues
): RowFilterFunc<number> {
  const colFuncs = Object.keys(filters).sort().map(
    (colId) => {
      const getter = columnGetters.getColGetterByColId(colId);
      if (!getter) { return () => true; }
      const values = new Set(filters[colId]);
      switch (operations[colId]) {
        case "intersects":
          return (rowId: number) => {
            const value = getter(rowId) as CellValue;
            return isList(value) &&
              (decodeObject(value) as unknown[]).some(v => values.has(v));
          };
        case "empty":
          return (rowId: number) => {
            const value = getter(rowId);
            // `isList(value) && value.length === 1` means `value == ['L']` i.e. an empty list
            return !value || isList(value) && value.length === 1;
          };
        case "in":
          return (rowId: number) => values.has(getter(rowId));
      }
    });
  return (rowId: number) => colFuncs.every(f => f(rowId));
}
