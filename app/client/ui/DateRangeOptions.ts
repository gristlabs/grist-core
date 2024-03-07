import {makeT} from 'app/client/lib/localization';
import { CURRENT_DATE, IRelativeDateSpec } from "app/common/RelativeDates";

const t = makeT('DateRangeOptions');

export interface IDateRangeOption {
  label: string;
  min: IRelativeDateSpec;
  max: IRelativeDateSpec;
}

export function getDateRangeOptions(): IDateRangeOption[] {
  return [
    {
      label: t('Today'),
      min: CURRENT_DATE,
      max: CURRENT_DATE,
    },
    {
      label: t('Last 7 days'),
      min: [{quantity: -7, unit: 'day'}],
      max: [{quantity: -1, unit: 'day'}],
    },
    {
      label: t('Next 7 days'),
      min: [{quantity: 1, unit: 'day'}],
      max: [{quantity: 7, unit: 'day'}],
    },
    {
      label: t('Last Week'),
      min: [{quantity: -1, unit: 'week'}],
      max: [{quantity: -1, unit: 'week', endOf: true}],
    },
    {
      label: t('Last 30 days'),
      min: [{quantity: -30, unit: 'day'}],
      max: [{quantity: -1, unit: 'day'}],
    },
    {
      label: t('This week'),
      min: [{quantity: 0, unit: 'week'}],
      max: [{quantity: 0, unit: 'week', endOf: true}],
    },
    {
      label: t('This month'),
      min: [{quantity: 0, unit: 'month'}],
      max: [{quantity: 0, unit: 'month', endOf: true}],
    },
    {
      label: t('This year'),
      min: [{quantity: 0, unit: 'year'}],
      max: [{quantity: 0, unit: 'year', endOf: true}],
    },
  ];
}