import {CellValue} from "app/common/DocActions";
import {FilterState, IRangeBoundType, isRangeFilter, makeFilterState} from "app/common/FilterState";
import {decodeObject} from "app/plugin/objtypes";
import moment, { Moment } from "moment-timezone";
import {extractInfoFromColType, isDateLikeType, isList, isListType, isNumberType} from "app/common/gristTypes";
import {isRelativeBound, relativeDateToUnixTimestamp} from "app/common/RelativeDates";
import {noop} from "lodash";

export type ColumnFilterFunc = (value: CellValue) => boolean;

// Returns a filter function for a particular column: the function takes a cell value and returns
// whether it's accepted according to the given FilterState.
export function makeFilterFunc(state: FilterState,
                               columnType: string = ''): ColumnFilterFunc {

  if (isRangeFilter(state)) {
    let {min, max} = state;
    if (isNumberType(columnType) || isDateLikeType(columnType)) {

      if (isDateLikeType(columnType)) {
        const info = extractInfoFromColType(columnType);
        const timezone = (info.type === 'DateTime' && info.timezone) || 'utc';
        min = changeTimezone(min, timezone, m => m.startOf('day'));
        max = changeTimezone(max, timezone, m => m.endOf('day'));
      }

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

// Returns the unix timestamp for date in timezone. Function support relative date. Also support
// optional mod argument that let you modify date as a moment instance.
function changeTimezone(date: IRangeBoundType,
                        timezone: string,
                        mod: (m: Moment) => void = noop): number|undefined {
  if (date === undefined) { return undefined; }
  const val = isRelativeBound(date) ? relativeDateToUnixTimestamp(date) : date;
  const m = moment.tz(val * 1000, timezone);
  mod(m);
  return Math.floor(m.valueOf() / 1000);
}
