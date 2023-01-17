import {
  CURRENT_DATE,
  diffUnit,
  formatRelBounds,
  IPeriod,
  IRelativeDateSpec,
  isEquivalentRelativeDate,
  relativeDateToUnixTimestamp
} from "app/common/RelativeDates";
import { IRangeBoundType, isRelativeBound } from "app/common/FilterState";
import getCurrentTime from "app/common/getCurrentTime";
import moment from "moment-timezone";

export const DEPS = {getCurrentTime};

export interface IRelativeDateOption {
  label: string;
  value: number|IRelativeDateSpec;
}

const DEFAULT_OPTION_LIST: IRelativeDateSpec[] = [
  CURRENT_DATE, [{
    quantity: -3,
    unit: 'day',
  }], [{
    quantity: -7,
    unit: 'day',
  }], [{
    quantity: -30,
    unit: 'day',
  }], [{
    quantity: 0,
    unit: 'year',
  }], [{
    quantity: 3,
    unit: 'day',
  }], [{
    quantity: 7,
    unit: 'day',
  }], [{
    quantity: 30,
    unit: 'day',
  }], [{
    quantity: 0,
    unit: 'year',
    endOf: true,
  }]];


export function relativeDatesOptions(value: IRangeBoundType, valueFormatter: (val: any) => string
                                   ): Array<{label: string, spec: IRangeBoundType}> {
  return relativeDateOptionsSpec(value)
    .map((spec) => ({spec, label: formatBoundOption(spec, valueFormatter)}));
}

// Returns a list of different relative date spec that all match passed in date value. If value is
// undefined it returns a default list of spec meant to showcase user the different flavors of
// relative date.
function relativeDateOptionsSpec(value: IRangeBoundType): Array<IRangeBoundType> {

  if (value === undefined) {
    return DEFAULT_OPTION_LIST;
  } else if (isRelativeBound(value)) {
    value = relativeDateToUnixTimestamp(value);
  }

  const date = moment.utc(value * 1000);
  const res: IRangeBoundType[] = [value];

  let relDate = getMatchingDoubleRelativeDate(value, {unit: 'day'});
  if (Math.abs(relDate[0].quantity) <= 90) {
    res.push(relDate);
  }

  relDate = getMatchingDoubleRelativeDate(value, {unit: 'week'});
  if (Math.abs(relDate[0].quantity) <= 4) {
      res.push(relDate);
  }

  // any day of the month (with longer limit for 1st day of the month)
  relDate = getMatchingDoubleRelativeDate(value, {unit: 'month'});
  if (Math.abs(relDate[0].quantity) <= (date.date() === 1 ? 12  : 3)) {
    res.push(relDate);
  }

  // If date is 1st of Jan show 1st day of year options
  if (date.date() === 1 && date.month() === 0) {
    res.push(getMatchingDoubleRelativeDate(value, {unit: 'year'}));
  }

  // 31st of Dec
  if (date.date() === 31 && date.month() === 11) {
    res.push(getMatchingDoubleRelativeDate(value, {unit: 'year', endOf: true}));
  }

  // Last day of any month
  if (date.clone().endOf('month').date() === date.date()) {
    relDate = getMatchingDoubleRelativeDate(value, {unit: 'month', endOf: true});
    if (Math.abs(relDate[0].quantity) < 12) {
      res.push(relDate);
    }
  }

  return res;
}

function now(): moment.Moment {
  const m = DEPS.getCurrentTime();
  return moment.utc([m.year(), m.month(), m.date()]);
}

// Returns a relative date spec as a sequence of one or two IPeriod that allows to match dateValue
// starting from the current date. The first period has .unit, .startOf and .endOf set according to
// passed in option.
export function getMatchingDoubleRelativeDate(
  dateValue: number,
  option: {unit: 'day'|'week'|'month'|'year', endOf?: boolean}
): IPeriod[] {
  const {unit} = option;
  const date = moment.utc(dateValue * 1000);
  const dateNow = now();
  const quantity = diffUnit(date, dateNow.clone(), unit);
  const m = dateNow.clone().add(quantity, unit);
  if (option.endOf) { m.endOf(unit); m.startOf('day'); }
  else { m.startOf(unit); }
  const dayQuantity = diffUnit(date, m, 'day');
  const res = [{quantity, ...option}];
  // Only add a 2nd period when it is not moot.
  if (dayQuantity) { res.push({quantity: dayQuantity, unit: 'day'}); }
  return res;
}

export function formatBoundOption(bound: IRangeBoundType, valueFormatter: (val: any) => string): string {
  return isRelativeBound(bound) ? formatRelBounds(bound) : valueFormatter(bound);
}


// Update relativeDate to match the new date picked by user.
export function updateRelativeDate(relativeDate: IRelativeDateSpec, date: number): IRelativeDateSpec|number {
  const periods = Array.isArray(relativeDate) ? relativeDate : [relativeDate];

  if ([1, 2].includes(periods.length)) {
    const {unit, endOf} = periods[0];
    const relDate = getMatchingDoubleRelativeDate(date, {unit, endOf});

    // Returns the relative date only if it is one of the suggested relative dates, otherwise
    // returns the absolute date.
    const options = relativeDateOptionsSpec(date);
    if (options.find(opt => isRelativeBound(opt) && isEquivalentRelativeDate(opt, relDate))) {
      return relDate;
    }
    return date;
  }

  throw new Error(
    `Relative date spec does only support 1 or 2 periods, got ${periods.length}!`
  );
}
