import {ApiError} from 'app/common/ApiError';
import {createFormatter} from 'app/common/ValueFormatter';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {DownloadOptions, ExportData, exportSection, exportTable, Filter} from 'app/server/lib/Export';
import log from 'app/server/lib/log';
import * as bluebird from 'bluebird';
import contentDisposition from 'content-disposition';
import csv from 'csv';
import * as express from 'express';

// promisify csv
bluebird.promisifyAll(csv);

/**
 * Converts `activeDoc` to a CSV and sends the converted data through `res`.
 */
export async function downloadCSV(activeDoc: ActiveDoc, req: express.Request,
                                  res: express.Response, options: DownloadOptions) {
  log.info('Generating .csv file...');
  const {filename, tableId, viewSectionId, filters, sortOrder} = options;
  const data = viewSectionId ?
    await makeCSVFromViewSection(activeDoc, viewSectionId, sortOrder, filters, req) :
    await makeCSVFromTable(activeDoc, tableId, req);
  res.set('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', contentDisposition(filename + '.csv'));
  res.send(data);
}

/**
 * Returns a csv stream of a view section that can be transformed or parsed.
 *
 * See https://github.com/wdavidw/node-csv for API details.
 *
 * @param {Object} activeDoc - the activeDoc that the table being converted belongs to.
 * @param {Integer} viewSectionId - id of the viewsection to export.
 * @param {Integer[]} activeSortOrder (optional) - overriding sort order.
 * @param {Filter[]} filters (optional) - filters defined from ui.
 * @return {Promise<string>} Promise for the resulting CSV.
 */
export async function makeCSVFromViewSection(
  activeDoc: ActiveDoc,
  viewSectionId: number,
  sortOrder: number[],
  filters: Filter[],
  req: express.Request) {

  const data = await exportSection(activeDoc, viewSectionId, sortOrder, filters, req);
  const file = convertToCsv(data);
  return file;
}

/**
 * Returns a csv stream of a table that can be transformed or parsed.
 *
 * @param {Object} activeDoc - the activeDoc that the table being converted belongs to.
 * @param {Integer} tableId - id of the table to export.
 * @return {Promise<string>} Promise for the resulting CSV.
 */
export async function makeCSVFromTable(
  activeDoc: ActiveDoc,
  tableId: string,
  req: express.Request) {

  if (!activeDoc.docData) {
    throw new Error('No docData in active document');
  }

  // Look up the table to make a CSV from.
  const tables = activeDoc.docData.getMetaTable('_grist_Tables');
  const tableRef = tables.findRow('tableId', tableId);

  if (tableRef === 0) {
    throw new ApiError(`Table ${tableId} not found.`, 404);
  }

  const data = await exportTable(activeDoc, tableRef, req);
  const file = convertToCsv(data);
  return file;
}

function convertToCsv({
  rowIds,
  access,
  columns: viewColumns,
  docSettings
}: ExportData) {

  // create formatters for columns
  const formatters = viewColumns.map(col => createFormatter(col.type, col.widgetOptions, docSettings));
  // Arrange the data into a row-indexed matrix, starting with column headers.
  const csvMatrix = [viewColumns.map(col => col.label)];
  // populate all the rows with values as strings
  rowIds.forEach(row => {
    csvMatrix.push(access.map((getter, c) => formatters[c].formatAny(getter(row))));
  });
  return csv.stringifyAsync(csvMatrix);
}
