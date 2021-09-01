import {typedCompare} from 'app/common/SortFunc';
import {Datum} from 'plotly.js';
import range = require('lodash/range');
import uniqBy = require('lodash/uniqBy');

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

// creates new version of series that has a duplicate free version of the values in the first one.
export function uniqXValues<T extends {values: Datum[]}>(series: Array<T>): Array<T> {
  if (!series[0]) { return []; }
  const n = series[0].values.length;
  const indexToKeep = new Set(uniqBy(range(n), (i) => series[0].values[i]));
  return series.map((line: T) => ({
    ...line,
    values: line.values.filter((_val, i) => indexToKeep.has(i))
  }));
}
