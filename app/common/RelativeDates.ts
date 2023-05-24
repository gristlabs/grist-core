// Relative date spec describes a date that is distant to the current date by a series of jumps in
// time defined as a series of periods. Hence, starting from the current date, each one of the
// periods gets applied successively which eventually yields to the final date. Typical relative

import { isEqual, isNumber, isUndefined, omitBy } from "lodash";
import moment from "moment-timezone";
import getCurrentTime from "app/common/getCurrentTime";

// Relative date uses one or two periods. When relative dates are defined by two periods, they are
// applied successively to the start date to resolve the target date. In practice in grist, as of
// the time of writing, relative date never uses more than 2 periods and the second period's unit is
// always day.
export type IRelativeDateSpec = IPeriod[];

// IPeriod describes a period of time: when used along with a start date, it allows to target a new
// date. It allows to encode simple periods such as `30 days ago` as `{quantity: -30, unit:
// 'day'}`. Or `The last day of last week` as `{quantity: -1, unit: 'week', endOf: true}`. Not that
// .endOf flag is only relevant when the unit is one of 'week', 'month' or 'year'. When `endOf` is
// false or missing then it will target the first day (of the week, month or year).
export interface IPeriod {
  quantity: number;
  unit: 'day'|'week'|'month'|'year';
  endOf?: boolean;
}

export const CURRENT_DATE: IRelativeDateSpec = [{quantity: 0, unit: 'day'}];


export function isRelativeBound(bound?: number|IRelativeDateSpec): bound is IRelativeDateSpec {
  return !isUndefined(bound) && !isNumber(bound);
}

// Returns the number of seconds between 1 January 1970 00:00:00 UTC and the given bound, may it be
// a relative date.
export function relativeDateToUnixTimestamp(bound: IRelativeDateSpec): number {
  const localDate = getCurrentTime().startOf('day');
  const date = moment.utc(localDate.toObject());
  const periods = Array.isArray(bound) ? bound : [bound];

  for (const period of periods) {
    const {quantity, unit, endOf} = period;

    date.add(quantity, unit);
    if (endOf) {
      date.endOf(unit);

      // date must have "hh:mm:ss" set to "00:00:00"
      date.startOf('day');
    } else {
      date.startOf(unit);
    }
  }
  return Math.floor(date.valueOf() / 1000);
}

// Format a relative date.
export function formatRelBounds(periods: IPeriod[]): string {

  // if 2nd period is moot revert to one single period
  periods = periods[1]?.quantity ? periods : [periods[0]];

  if (periods.length === 1) {
    const {quantity, unit, endOf} = periods[0];
    if (unit === 'day') {
      if (quantity === 0) { return 'Today'; }
      if (quantity === -1) { return 'Yesterday'; }
      if (quantity === 1) { return 'Tomorrow'; }
      return formatReference(periods[0]);
    }

    if (endOf) {
      return `Last day of ${formatReference(periods[0])}`;
    } else {
      return `1st day of ${formatReference(periods[0])}`;
    }
  }

  if (periods.length === 2) {
    let dayQuantity = periods[1].quantity;

    // If the 1st period has the endOf flag, we're already 1 day back.
    if (periods[0].endOf) { dayQuantity -= 1; }

    let startOrEnd = '';
    if (periods[0].unit === 'week') {
      if (periods[1].quantity === 0) {
        startOrEnd = 'start ';
      } else if (periods[1].quantity === 6) {
        startOrEnd = 'end ';
      }
    }

    return `${formatDay(dayQuantity, periods[0].unit)} ${startOrEnd}of ${formatReference(periods[0])}`;
  }

  throw new Error(
    `Relative date spec does not support more that 2 periods: ${periods.length}`
  );
}

/**
 * Returns a new timestamp that is the UTC equivalent of the original local `timestamp`, offset
 * according to the delta between`timezone` and UTC.
 */
export function localTimestampToUTC(timestamp: number, timezone: string): number {
  return moment.unix(timestamp).utc().tz(timezone, true).unix();
}

function formatDay(quantity: number, refUnit: IPeriod['unit']): string {

  if (refUnit === 'week') {
    const n = (quantity + 7) % 7;
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n];
  }

  const ord = (n: number) => moment.localeData().ordinal(n);
  if (quantity < 0) {
    if (quantity === -1) {
      return 'Last day';
    }
    return `${ord(-quantity)} to last day`;
  } else {
    return `${ord(quantity + 1)} day`;
  }
}

function formatReference(period: IPeriod): string {
  const {quantity, unit} = period;
  if (quantity === 0) {
    return `this ${unit}`;
  }

  if (quantity === -1) {
    return `last ${unit}`;
  }

  if (quantity === 1) {
    return `next ${unit}`;
  }

  const n = Math.abs(quantity);
  const plurals = n > 1 ? 's' : '';
  return `${n} ${unit}${plurals} ${quantity < 1 ? 'ago' : 'from now'}`;
}

export function isEquivalentRelativeDate(a: IPeriod|IPeriod[], b: IPeriod|IPeriod[]) {
  a = Array.isArray(a) ? a : [a];
  b = Array.isArray(b) ? b : [b];
  if (a.length === 2 && a[1].quantity === 0) { a = [a[0]]; }
  if (b.length === 2 && b[1].quantity === 0) { b = [b[0]]; }

  const compactA = a.map(period => omitBy(period, isUndefined));
  const compactB = b.map(period => omitBy(period, isUndefined));

  return isEqual(compactA, compactB);
}


// Get the difference in unit of measurement. If unit is week, makes sure that two dates that are in
// two different weeks are always at least 1 number apart. Same for month and year.
export function diffUnit(a: moment.Moment, b: moment.Moment, unit: 'day'|'week'|'month'|'year') {
  return a.clone().startOf(unit).diff(b.clone().startOf(unit), unit);
}
