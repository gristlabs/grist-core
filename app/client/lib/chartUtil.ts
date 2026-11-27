import { typedCompare } from "app/common/SortFunc";
import { decodeObject } from "app/plugin/objtypes";

import flatten from "lodash/flatten";
import range from "lodash/range";
import uniqBy from "lodash/uniqBy";
import { Datum } from "plotly.js";

/**
 * Sort all values in a list of series according to the values in the first one.
 */
export function sortByXValues(series: { values: Datum[] }[]): void {
  // The order of points matters for graph types that connect points with lines: the lines are
  // drawn in order in which the points appear in the data. For the chart types we support, it
  // only makes sense to keep the points sorted. (The only downside is that Grist line charts can
  // no longer produce arbitrary line drawings.)
  if (!series[0]) { return; }
  const xValues = series[0].values;
  const indices = xValues.map((val, i) => i);
  indices.sort((a, b) => typedCompare(xValues[a], xValues[b]));
  for (const s of series) {
    const values = s.values;
    s.values = indices.map(i => values[i]);
  }
}

/**
 * Returns the distinct values across several lists of x values, sorted as by sortByXValues().
 */
export function sortedCategories(xValueLists: Datum[][]): Datum[] {
  return [...new Set(flatten(xValueLists))].sort(typedCompare);
}

// Makes series so that the values of series[0] are duplicate free.
export function uniqXValues<T extends { values: Datum[] }>(series: T[]) {
  if (!series[0]) { return; }
  const n = series[0].values.length;
  const indexToKeep = new Set(uniqBy(range(n), i => series[0].values[i]));
  series.forEach((line: T) => {
    line.values = line.values.filter((_val, i) => indexToKeep.has(i));
  });
}

// Creates new version of series that split any entry whose value in the first series is a list into
// multiple entries, one entry for each list's item. For all other series, newly created entries have
// the same value as the original.
export function splitValues<T extends { values: Datum[] }>(series: T[]): T[] {
  return splitValuesByIndex(series, 0);
}

// This method is like splitValues except it splits according to the values of the series at position index.
export function splitValuesByIndex<T extends { values: Datum[] }>(series: T[], index: number): T[] {
  const decoded = (series[index].values as any[]).map(decodeObject);

  return series.map((s, si) => {
    if (si === index) {
      return { ...series[index], values: flatten(decoded) };
    }
    let values: Datum[] = [];
    for (const [i, splitByValue] of decoded.entries()) {
      if (Array.isArray(splitByValue)) {
        values = values.concat(Array(splitByValue.length).fill(s.values[i]));
      } else {
        values.push(s.values[i]);
      }
    }
    return { ...s, values };
  });
}

/**
 * Makes sure series[0].values includes all of the values in xvalues and that they appears in the
 * same order. 0 is used to fill missing values in series[i].values for i > 1 (making function
 * suited only for numeric series AND only to use with for bar charts). Function does mutate series.
 *
 * Note it would make more sense to pad missing values with `null`, but plotly handles null the same
 * as missing values. Hence we're padding with 0.
 */
export function consolidateValues(series: { values: Datum[] }[], xvalues: Datum[]) {
  let i = 0;
  for (const xval of xvalues) {
    if (i < series[0].values.length && xval !== series[0].values[i] ||
      i > series[0].values.length - 1) {
      series[0].values.splice(i, 0, xval);
      for (let j = 1; j < series.length; ++j) {
        series[j].values.splice(i, 0, 0);
      }
    }
    while (xval === series[0].values[i] && i < series[0].values.length) {
      i++;
    }
  }
  return series;
}

export function formatPercent(val: number) {
  return Math.floor(val * 100) + " %";
}

/**
 * The most series a single chart may show. Too many series are impossible to make sense of
 * anyway, and can hang the browser.
 */
export const MAX_SERIES_IN_CHART = 100;

/** A series of chart data, as handled by the helpers in this module. */
export interface ChartSeries {
  label: string;      // Corresponds to the column name.
  values: Datum[];
  group?: Datum;      // The group value, when grouped.
}

export interface GroupedSeries<T extends Datum> {
  /** Series grouped by group value, in the order in which the groups should be shown. */
  series: Map<T, ChartSeries[]>;
  /** Whether group values were left out of `series` to stay within MAX_SERIES_IN_CHART. */
  truncated: boolean;
}

/**
 * Group the given array of series by a column of group values. The groupColumn and each of the
 * series should be arrays of the same length.
 *
 * For example, if groupColumn has CompanyID, and valueSeries contains [Date, Employees, Revenues]
 * (each an array of values), then returns a map mapping each CompanyID to the array [Date,
 * Employees, Revenue], each value of which is itself an array of values for that CompanyID.
 *
 * At most MAX_SERIES_IN_CHART series are included in the result, so that the chart can't hang the
 * browser. When some groups are left out, `truncated` is set so that the view can tell the user.
 */
export function groupSeries<T extends Datum>(
  groupColumn: T[], valueSeries: ChartSeries[], sort: boolean,
): GroupedSeries<T> {
  const nseries = new Map<T, ChartSeries[]>();

  const maxGroups = Math.floor(MAX_SERIES_IN_CHART / valueSeries.length);
  let groupValues: T[] = [...new Set(groupColumn)];
  if (sort) {
    groupValues.sort();
  }
  const truncated = groupValues.length > maxGroups;
  groupValues = groupValues.slice(0, maxGroups);

  // Set up empty lists for each group.
  for (const group of groupValues) {
    nseries.set(group, valueSeries.map((s: ChartSeries) => ({
      label: s.label,
      group,
      values: [],
    })));
  }

  // Now fill up the lists.
  for (let row = 0; row < groupColumn.length; row++) {
    const group = groupColumn[row];
    const series: ChartSeries[] | undefined = nseries.get(group);
    if (series) {
      for (let i = 0; i < valueSeries.length; i++) {
        series[i].values.push(valueSeries[i].values[row]);
      }
    }
  }
  return { series: nseries, truncated };
}
