import {CellValue} from "app/common/DocActions";
import {
  FilterState, IRangeBoundType, isRangeFilter, isRelativeBound, makeFilterState
} from "app/common/FilterState";
import {decodeObject} from "app/plugin/objtypes";
import moment from "moment-timezone";
import {isDateLikeType, isList, isListType, isNumberType} from "./gristTypes";
import {toUnixTimestamp} from "app/common/RelativeDates";

export type ColumnFilterFunc = (value: CellValue) => boolean;

// Returns a filter function for a particular column: the function takes a cell value and returns
// whether it's accepted according to the given FilterState.
export function makeFilterFunc(state: FilterState,
                               columnType: string = ''): ColumnFilterFunc {

  if (isRangeFilter(state)) {
    let {min, max} = state;
    if (isNumberType(columnType) || isDateLikeType(columnType)) {

      min = getBoundsValue(state, 'min');
      max = getBoundsValue(state, 'max');

      return (val) => {
        if (typeof val !== 'number') { return false; }
        return (
          (max === undefined ? true : val <= max) &&
            (min === undefined ? true : min <= val)
        );
      };
    } else {
      // Although it is not possible to set a range filter for non numeric columns, this still can
      // happen as a result of a column type conversion. In this case, let's include all values.
      return () => true;
    }
  }

  const {include, values} = state;

  // NOTE: This logic results in complex values and their stringified JSON representations as equivalent.
  // For example, a TypeError in the formula column and the string '["E","TypeError"]' would be seen as the same.
  // TODO: This narrow corner case seems acceptable for now, but may be worth revisiting.
  return (val: CellValue) => {
    if (isList(val) && columnType && isListType(columnType)) {
      const list = decodeObject(val) as unknown[];
      if (list.length) {
        return list.some(item => values.has(item as any) === include);
      }
      // If the list is empty, filter instead by an empty value for the whole list
      val = columnType === "ChoiceList" ? "" : null;
    }
    return (values.has(Array.isArray(val) ? JSON.stringify(val) : val) === include);
  };
}

// Given a JSON string, returns a ColumnFilterFunc
export function buildColFilter(filterJson: string | undefined,
                               columnType?: string): ColumnFilterFunc | null {
  return filterJson ? makeFilterFunc(makeFilterState(filterJson), columnType) : null;
}


function getBoundsValue(state: {min?: IRangeBoundType, max?: IRangeBoundType}, minMax: 'min'|'max') {
  const value = state[minMax];
  if (isRelativeBound(value)) {
    const val = toUnixTimestamp(value);
    const m = moment.utc(val * 1000);
    if (minMax === 'min') {
      m.startOf('day');
    } else {
      m.endOf('day');
    }
    return Math.floor(m.valueOf() / 1000);
  }
  return value;
}
