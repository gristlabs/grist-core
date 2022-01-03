import {typedCompare} from 'app/common/SortFunc';
import {decodeObject} from 'app/plugin/objtypes';
import {Datum} from 'plotly.js';
import range = require('lodash/range');
import uniqBy = require('lodash/uniqBy');
import flatten = require('lodash/flatten');

/**
 * Sort all values in a list of series according to the values in the first one.
 */
export function sortByXValues(series: Array<{values: Datum[]}>): void {
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
    s.values = indices.map((i) => values[i]);
  }
}

// Makes series so that the values of series[0] are duplicate free.
export function uniqXValues<T extends {values: Datum[]}>(series: Array<T>) {
  if (!series[0]) { return; }
  const n = series[0].values.length;
  const indexToKeep = new Set(uniqBy(range(n), (i) => series[0].values[i]));
  series.forEach((line: T) => {
    line.values = line.values.filter((_val, i) => indexToKeep.has(i));
  });
}

// Creates new version of series that split any entry whose value in the first series is a list into
// multiple entries, one entry for each list's item. For all other series, newly created entries have
// the same value as the original.
export function splitValues<T extends {values: Datum[]}>(series: Array<T>): Array<T> {
  return splitValuesByIndex(series, 0);
}

// This method is like splitValues except it splits according to the values of the series at position index.
export function splitValuesByIndex<T extends {values: Datum[]}>(series: Array<T>, index: number): Array<T> {
  const decoded = (series[index].values as any[]).map(decodeObject);

  return series.map((s, si) => {
    if (si === index) {
      return {...series[index], values: flatten(decoded)};
    }
    let values: Datum[] = [];
    for (const [i, splitByValue] of decoded.entries()) {
      if (Array.isArray(splitByValue)) {
        values = values.concat(Array(splitByValue.length).fill(s.values[i]));
      } else {
        values.push(s.values[i]);
      }
    }
    return {...s, values};
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
export function consolidateValues(series: Array<{values: Datum[]}>, xvalues: Datum[]) {
  let i = 0;
  for (const xval of xvalues) {
    if (i < series[0].values.length && xval !== series[0].values[i]
        || i > series[0].values.length - 1) {
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
