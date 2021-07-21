import {createFormatter} from 'app/common/ValueFormatter';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {ExportData, exportSection, Filter} from 'app/server/lib/Export';
import * as bluebird from 'bluebird';
import * as csv from 'csv';
import * as express from 'express';

// promisify csv
bluebird.promisifyAll(csv);

/**
 * Returns a csv stream that can be transformed or parsed.  See https://github.com/wdavidw/node-csv
 * for API details.
 *
 * @param {Object} activeDoc - the activeDoc that the table being converted belongs to.
 * @param {Integer} viewSectionId - id of the viewsection to export.
 * @param {Integer[]} activeSortOrder (optional) - overriding sort order.
 * @param {Filter[]} filters (optional) - filters defined from ui.
 * @return {Promise<string>} Promise for the resulting CSV.
 */
export async function makeCSV(
  activeDoc: ActiveDoc,
  viewSectionId: number,
  sortOrder: number[],
  filters: Filter[],
  req: express.Request) {

  const data = await exportSection(activeDoc, viewSectionId, sortOrder, filters, req);
  const file = convertToCsv(data);
  return file;
}

function convertToCsv({
  rowIds,
  access,
  columns: viewColumns
}: ExportData) {

  // create formatters for columns
  const formatters = viewColumns.map(col => createFormatter(col.type, col.widgetOptions));
  // Arrange the data into a row-indexed matrix, starting with column headers.
  const csvMatrix = [viewColumns.map(col => col.label)];
  // populate all the rows with values as strings
  rowIds.forEach(row => {
    csvMatrix.push(access.map((getter, c) => formatters[c].formatAny(getter(row))));
  });
  return csv.stringifyAsync(csvMatrix);
}
