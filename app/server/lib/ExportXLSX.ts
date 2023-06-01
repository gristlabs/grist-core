/**
 * Overview of Excel exports, which now use worker-threads.
 *
 * 1. The flow starts with downloadXLSX() method called in the main thread (or streamXLSX() used for
 *    Google Drive export).
 * 2. It uses the 'piscina' library to call a makeXLSX* method in a worker thread, registered in
 *    workerExporter.ts, to export full doc, a table, or a section.
 * 3. Each of those methods calls a same-named method that's defined in this file. I.e.
 *    downloadXLSX() is called in the main thread, but makeXLSX() is called in the worker thread.
 * 4. makeXLSX* methods here get data using an ActiveDocSource, which uses Rpc (from grain-rpc
 *    module) to request data over a message port from the ActiveDoc in the main thread.
 * 5. The resulting stream of Excel data is streamed back to the main thread using Rpc too.
 */
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {createExcelFormatter} from 'app/server/lib/ExcelFormatter';
import {ActiveDocSource, ActiveDocSourceDirect, DownloadOptions, ExportParameters} from 'app/server/lib/Export';
import {doExportDoc, doExportSection, doExportTable, ExportData, Filter} from 'app/server/lib/Export';
import log from 'app/server/lib/log';
import {Alignment, Border, stream as ExcelWriteStream, Fill} from 'exceljs';
import * as express from 'express';
import contentDisposition from 'content-disposition';
import {Rpc} from 'grain-rpc';
import {AbortController} from 'node-abort-controller';
import {Stream, Writable} from 'stream';
import {MessageChannel} from 'worker_threads';
import Piscina from 'piscina';

// Configure the thread-pool to use for exporting XLSX files.
const exportPool = new Piscina({
  filename: __dirname + '/workerExporter.js',
  minThreads: 0,
  maxThreads: 4,
  maxQueue: 100,          // Fail if this many tasks are already waiting for a thread.
  idleTimeout: 10_000,    // Drop unused threads after 10s of inactivity.
});

/**
 * Converts `activeDoc` to XLSX and sends the converted data through `res`.
 */
export async function downloadXLSX(activeDoc: ActiveDoc, req: express.Request,
                                   res: express.Response, options: DownloadOptions) {
  const {filename} = options;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', contentDisposition(filename + '.xlsx'));
  return streamXLSX(activeDoc, req, res, options);
}

/**
 * Converts `activeDoc` to XLSX and sends to the given outputStream.
 */
export async function streamXLSX(activeDoc: ActiveDoc, req: express.Request,
                                 outputStream: Writable, options: ExportParameters) {
  log.debug(`Generating .xlsx file`);
  const {tableId, viewSectionId, filters, sortOrder} = options;
  const testDates = (req.hostname === 'localhost');

  const { port1, port2 } = new MessageChannel();
  try {
    const rpc = new Rpc({
      sendMessage: async (m) => port1.postMessage(m),
      logger: { info: m => {}, warn: m => log.warn(m) },
    });
    rpc.registerImpl<ActiveDocSource>("activeDocSource", new ActiveDocSourceDirect(activeDoc, req));
    rpc.on('message', (chunk) => { outputStream.write(chunk); });
    port1.on('message', (m) => rpc.receiveMessage(m));

    // When the worker thread is done, it closes the port on its side, and we listen to that to
    // end the original request (the incoming HTTP request, in case of a download).
    port1.on('close', () => { outputStream.end(); });

    // For request cancelling to work, remember that such requests are forwarded via DocApiForwarder.
    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    const run = (method: string, ...args: any[]) => exportPool.run({port: port2, testDates, args}, {
      name: method,
      signal: abortController.signal,
      transferList: [port2],
    });

    // hanlding 3 cases : full XLSX export (full file), view xlsx export, table xlsx export
    try {
      if (viewSectionId) {
        await run('makeXLSXFromViewSection', viewSectionId, sortOrder, filters);
      } else if (tableId) {
        await run('makeXLSXFromTable', tableId);
      } else {
        await run('makeXLSX');
      }
      log.debug('XLSX file generated');
    } catch (e) {
      // We fiddle with errors in workerExporter to preserve extra properties like 'status'. Make
      // the result an instance of Error again here (though we won't know the exact class).
      throw (e instanceof Error) ? e : Object.assign(new Error(e.message), e);
    }
  } finally {
    port1.close();
    port2.close();
  }
}

/**
 * Returns a XLSX stream of a view section that can be transformed or parsed.
 *
 * @param {Object} activeDoc - the activeDoc that the table being converted belongs to.
 * @param {Integer} viewSectionId - id of the viewsection to export.
 * @param {Integer[]} activeSortOrder (optional) - overriding sort order.
 * @param {Filter[]} filters (optional) - filters defined from ui.
 */
export async function makeXLSXFromViewSection(
  activeDocSource: ActiveDocSource,
  testDates: boolean,
  stream: Stream,
  viewSectionId: number,
  sortOrder: number[],
  filters: Filter[],
) {
  const data = await doExportSection(activeDocSource, viewSectionId, sortOrder, filters);
  const {exportTable, end} = convertToExcel(stream, testDates);
  exportTable(data);
  await end();
}

/**
 * Returns a XLSX stream of a table that can be transformed or parsed.
 *
 * @param {Object} activeDoc - the activeDoc that the table being converted belongs to.
 * @param {Integer} tableId - id of the table to export.
 */
export async function makeXLSXFromTable(
  activeDocSource: ActiveDocSource,
  testDates: boolean,
  stream: Stream,
  tableId: string,
) {
  const data = await doExportTable(activeDocSource, {tableId});
  const {exportTable, end} = convertToExcel(stream, testDates);
  exportTable(data);
  await end();
}

/**
 * Creates excel document with all tables from an active Grist document.
 */
export async function makeXLSX(
  activeDocSource: ActiveDocSource,
  testDates: boolean,
  stream: Stream,
): Promise<void> {
  const {exportTable, end} = convertToExcel(stream, testDates);
  await doExportDoc(activeDocSource, async (table: ExportData) => exportTable(table));
  await end();
}

/**
 * Converts export data to an excel file.
 */
function convertToExcel(stream: Stream, testDates: boolean): {
  exportTable: (table: ExportData) => void,
  end: () => Promise<void>,
} {
  // Create workbook and add single sheet to it. Using the WorkbookWriter interface avoids
  // creating the entire Excel file in memory, which can be very memory-heavy. See
  // https://github.com/exceljs/exceljs#streaming-xlsx-writercontents. (The options useStyles and
  // useSharedStrings replicate more closely what was used previously.)
  const wb = new ExcelWriteStream.xlsx.WorkbookWriter({useStyles: true, useSharedStrings: true, stream});
  if (testDates) {
    // HACK: for testing, we will keep static dates
    const date = new Date(Date.UTC(2018, 11, 1, 0, 0, 0));
    wb.modified = date;
    wb.created = date;
    wb.lastPrinted = date;
    wb.creator = 'test';
    wb.lastModifiedBy = 'test';
  }
  // Prepare border - some of the cells can have background colors, in that case border will
  // not be visible
  const borderStyle: Border = {
    color: { argb: 'FFE2E2E3' }, // dark gray - default border color for gdrive
    style: 'thin'
  };
  const borders = {
    left: borderStyle,
    right: borderStyle,
    top: borderStyle,
    bottom: borderStyle
  };
  const headerBackground: Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEEEEEE' } // gray
  };
  const headerFontColor = {
    color: {
      argb: 'FF000000' // black
    }
  };
  const centerAlignment: Partial<Alignment> = {
    horizontal: 'center'
  };
  function exportTable(table: ExportData) {
    const { columns, rowIds, access, tableName } = table;
    const ws = wb.addWorksheet(sanitizeWorksheetName(tableName));
    // Build excel formatters.
    const formatters = columns.map(col => createExcelFormatter(col.formatter.type, col.formatter.widgetOpts));
    // Generate headers for all columns with correct styles for whole column.
    // Actual header style for a first row will be overwritten later.
    ws.columns = columns.map((col, c) => ({ header: col.label, style: formatters[c].style() }));
    // style up the header row
    for (let i = 1; i <= columns.length; i++) {
      // apply to all rows (including header)
      ws.getColumn(i).border = borders;
      // apply only to header
      const header = ws.getCell(1, i);
      header.fill = headerBackground;
      header.font = headerFontColor;
      header.alignment = centerAlignment;
    }
    // Make each column a little wider.
    ws.columns.forEach(column => {
      if (!column.header) {
        return;
      }
      // 14 points is about 100 pixels in a default font (point is around 7.5 pixels)
      column.width = column.header.length < 14 ? 14 : column.header.length;
    });
    // Populate excel file with data
    for (const row of rowIds) {
      ws.addRow(access.map((getter, c) => formatters[c].formatAny(getter(row)))).commit();
    }
    ws.commit();
  }
  function end() { return wb.commit(); }
  return {exportTable, end};
}

/**
 * Removes invalid characters, see https://github.com/exceljs/exceljs/pull/1484
 */
export function sanitizeWorksheetName(tableName: string): string {
  return tableName
    // Convert invalid characters to spaces
    .replace(/[*?:/\\[\]]/g, ' ')

    // Collapse multiple spaces into one
    .replace(/\s+/g, ' ')

    // Trim spaces and single quotes from the ends
    .replace(/^['\s]+/, '')
    .replace(/['\s]+$/, '');
}
