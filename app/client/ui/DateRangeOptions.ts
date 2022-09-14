import { CURRENT_DATE, IRelativeDateSpec } from "app/common/RelativeDates";

export interface IDateRangeOption {
  label: string;
  min: IRelativeDateSpec;
  max: IRelativeDateSpec;
}

export const DateRangeOptions: IDateRangeOption[] = [{
  label: 'Today',
  min: CURRENT_DATE,
  max: CURRENT_DATE,
}, {
  label: 'Last 7 days',
  min: [{quantity: -7, unit: 'day'}],
  max: [{quantity: -1, unit: 'day'}],
}, {
  label: 'Next 7 days',
  min: [{quantity: 1, unit: 'day'}],
  max: [{quantity: 7, unit: 'day'}],
}, {
  label: 'Last Week',
  min: [{quantity: -1, unit: 'week'}],
  max: [{quantity: -1, unit: 'week', endOf: true}],
}, {
  label: 'Last 30 days',
  min: [{quantity: -30, unit: 'day'}],
  max: [{quantity: -1, unit: 'day'}],
}, {
  label: 'This week',
  min: [{quantity: 0, unit: 'week'}],
  max: [{quantity: 0, unit: 'week', endOf: true}],
}, {
  label: 'This month',
  min: [{quantity: 0, unit: 'month'}],
  max: [{quantity: 0, unit: 'month', endOf: true}],
}, {
  label: 'This year',
  min: [{quantity: 0, unit: 'year'}],
  max: [{quantity: 0, unit: 'year', endOf: true}],
}];
