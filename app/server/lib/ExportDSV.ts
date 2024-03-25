import {ApiError} from 'app/common/ApiError';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {FilterColValues} from "app/common/ActiveDocAPI";
import {DownloadOptions, ExportData, ExportHeader, exportSection, exportTable, Filter} from 'app/server/lib/Export';
import log from 'app/server/lib/log';
import * as bluebird from 'bluebird';
import contentDisposition from 'content-disposition';
import csv from 'csv';
import * as express from 'express';

// promisify csv
bluebird.promisifyAll(csv);

export interface DownloadDsvOptions extends DownloadOptions {
  delimiter: Delimiter;
}

type Delimiter = ',' | '\t' | '💩';

/**
 * Converts `activeDoc` to delimiter-separated values (e.g. CSV) and sends
 * the converted data through `res`.
 */
export async function downloadDSV(
  activeDoc: ActiveDoc,
  req: express.Request,
  res: express.Response,
  options: DownloadDsvOptions
) {
  const {filename, tableId, viewSectionId, filters, sortOrder, linkingFilter, delimiter, header} = options;
  const extension = getDSVFileExtension(delimiter);
  log.info(`Generating ${extension} file...`);
  const data = viewSectionId ?
    await makeDSVFromViewSection({
      activeDoc, viewSectionId, sortOrder: sortOrder || null, filters: filters || null,
      linkingFilter: linkingFilter || null, header, delimiter, req
    }) :
    await makeDSVFromTable({activeDoc, tableId, header, delimiter, req});
  res.set('Content-Type', getDSVMimeType(delimiter));
  res.setHeader('Content-Disposition', contentDisposition(filename + extension));
  res.send(data);
}

/**
 * Returns a DSV stream of a view section that can be transformed or parsed.
 *
 * See https://github.com/wdavidw/node-csv for API details.
 *
 * @param {Object} options - options for the export.
 * @param {Object} options.activeDoc - the activeDoc that the table being converted belongs to.
 * @param {Integer} options.viewSectionId - id of the viewsection to export.
 * @param {Integer[]} options.activeSortOrder (optional) - overriding sort order.
 * @param {Filter[]} options.filters (optional) - filters defined from ui.
 * @param {FilterColValues} options.linkingFilter (optional) - linking filter defined from ui.
 * @param {Delimiter} options.delimiter - delimiter to separate fields with
 * @param {string} options.header (optional) - which field of the column to use as header
 * @param {express.Request} options.req - the request object.
 *
 * @return {Promise<string>} Promise for the resulting DSV.
 */
export async function makeDSVFromViewSection({
  activeDoc,
  viewSectionId,
  sortOrder = null,
  filters = null,
  linkingFilter = null,
  delimiter,
  header,
  req
}: {
  activeDoc: ActiveDoc,
  viewSectionId: number,
  sortOrder: number[] | null,
  filters: Filter[] | null,
  linkingFilter: FilterColValues | null,
  header?: ExportHeader,
  delimiter: Delimiter,
  req: express.Request
}) {

  const data = await exportSection(activeDoc, viewSectionId, sortOrder, filters, linkingFilter, req);
  const file = convertToDsv(data, { header, delimiter });
  return file;
}

/**
 * Returns a DSV stream of a table that can be transformed or parsed.
 *
 * @param {Object} options - options for the export.
 * @param {Object} options.activeDoc - the activeDoc that the table being converted belongs to.
 * @param {Integer} options.tableId - id of the table to export.
 * @param {Delimiter} options.delimiter  - delimiter to separate fields with
 * @param {string} options.header (optional) - which field of the column to use as header
 * @param {express.Request} options.req - the request object.
 *
 * @return {Promise<string>} Promise for the resulting DSV.
 */
export async function makeDSVFromTable({ activeDoc, tableId, delimiter, header, req }: {
  activeDoc: ActiveDoc,
  tableId: string,
  delimiter: Delimiter,
  header?: ExportHeader,
  req: express.Request
}) {

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
  const file = convertToDsv(data, { header, delimiter });
  return file;
}

interface ConvertToDsvOptions {
  delimiter: Delimiter;
  header?: ExportHeader;
}

function convertToDsv(data: ExportData, options: ConvertToDsvOptions) {
  const {rowIds, access, columns: viewColumns} = data;
  const {delimiter, header} = options;
  // create formatters for columns
  const formatters = viewColumns.map(col => col.formatter);
  // Arrange the data into a row-indexed matrix, starting with column headers.
  const colPropertyAsHeader = header ?? 'label';
  const csvMatrix = [viewColumns.map(col => col[colPropertyAsHeader])];
  // populate all the rows with values as strings
  rowIds.forEach(row => {
    csvMatrix.push(access.map((getter, c) => formatters[c].formatAny(getter(row))));
  });
  return csv.stringifyAsync(csvMatrix, {delimiter});
}

type DSVFileExtension = '.csv' | '.tsv' | '.dsv';

function getDSVFileExtension(delimiter: Delimiter): DSVFileExtension {
  switch (delimiter) {
    case ',': {
      return '.csv';
    }
    case '\t': {
      return '.tsv';
    }
    case '💩': {
      return '.dsv';
    }
  }
}

type DSVMimeType =
  | 'text/csv'
  // Reference: https://www.iana.org/assignments/media-types/text/tab-separated-values
  | 'text/tab-separated-values'
  // Note: not a registered MIME type, hence the "x-" prefix.
  | 'text/x-doo-separated-values';

function getDSVMimeType(delimiter: Delimiter): DSVMimeType {
  switch (delimiter) {
    case ',': {
      return 'text/csv';
    }
    case '\t': {
      return 'text/tab-separated-values';
    }
    case '💩': {
      return 'text/x-doo-separated-values';
    }
  }
}
