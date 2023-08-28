import {PassThrough} from 'stream';
import {FilterColValues} from "app/common/ActiveDocAPI";
import {ActiveDocSource, doExportDoc, doExportSection, doExportTable, ExportData, Filter} from 'app/server/lib/Export';
import {createExcelFormatter} from 'app/server/lib/ExcelFormatter';
import * as log from 'app/server/lib/log';
import {Alignment, Border, stream as ExcelWriteStream, Fill} from 'exceljs';
import {Rpc} from 'grain-rpc';
import {Stream} from 'stream';
import {MessagePort, threadId} from 'worker_threads';

export const makeXLSX = handleExport(doMakeXLSX);
export const makeXLSXFromTable = handleExport(doMakeXLSXFromTable);
export const makeXLSXFromViewSection = handleExport(doMakeXLSXFromViewSection);

function handleExport<T extends any[]>(
  make: (a: ActiveDocSource, testDates: boolean, output: Stream, ...args: T) => Promise<void>
) {
  return async function({port, testDates, args}: {port: MessagePort, testDates: boolean, args: T}) {
    try {
      const start = Date.now();
      log.debug("workerExporter %s %s: started", threadId, make.name);
      const rpc = new Rpc({
        sendMessage: async (m) => port.postMessage(m),
        logger: { info: m => {}, warn: m => log.warn(m) },
      });
      const activeDocSource = rpc.getStub<ActiveDocSource>("activeDocSource");
      port.on('message', (m) => rpc.receiveMessage(m));
      const outputStream = new PassThrough();
      bufferedPipe(outputStream, (chunk) => rpc.postMessage(chunk));
      await make(activeDocSource, testDates, outputStream, ...args);
      port.close();
      log.debug("workerExporter %s %s: done in %s ms", threadId, make.name, Date.now() - start);
    } catch (e) {
      log.debug("workerExporter %s %s: error %s", threadId, make.name, String(e));
      // When Error objects move across threads, they keep only the 'message' property. We can
      // keep other properties (like 'status') if we throw a plain object instead. (Didn't find a
      // good reference on this, https://github.com/nodejs/node/issues/35506 is vaguely related.)
      throw {message: e.message, ...e};
    }
  };
}

// ExcelJS's WorkbookWriter produces many tiny writes (even though they pass through zipping). To
// reduce overhead and context switching, buffer them and pass on in chunks. (In practice, this
// helps performance only slightly.)
function bufferedPipe(stream: Stream, callback: (chunk: Buffer) => void, threshold = 64*1024) {
  let buffers: Buffer[] = [];
  let length = 0;
  let flushed = 0;

  function flush() {
    if (length > 0) {
      const data = Buffer.concat(buffers);
      flushed += data.length;
      callback(data);
      buffers = [];
      length = 0;
    }
  }

  stream.on('data', (chunk) => {
    // Whenever data is written to the stream, add it to the buffer.
    buffers.push(chunk);
    length += chunk.length;
    // If the buffer is large enough, post it to the callback. Also post the very first chunk:
    // since this becomes an HTTP response, a quick first chunk lets the browser prompt the user
    // more quickly about what to do with the download.
    if (length >= threshold || flushed === 0) {
      flush();
    }
  });

  stream.on('end', flush);
}

/**
 * Returns a XLSX stream of a view section that can be transformed or parsed.
 *
 * @param {Object} activeDoc - the activeDoc that the table being converted belongs to.
 * @param {Integer} viewSectionId - id of the viewsection to export.
 * @param {Integer[]} activeSortOrder (optional) - overriding sort order.
 * @param {Filter[]} filters (optional) - filters defined from ui.
 */
async function doMakeXLSXFromViewSection(
  activeDocSource: ActiveDocSource,
  testDates: boolean,
  stream: Stream,
  viewSectionId: number,
  sortOrder: number[],
  filters: Filter[],
  linkingFilter: FilterColValues,
) {
  const data = await doExportSection(activeDocSource, viewSectionId, sortOrder, filters, linkingFilter);
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
async function doMakeXLSXFromTable(
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
async function doMakeXLSX(
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

// This method exists only to make Piscina happier. With it,
// Piscina will load this file using a regular require(),
// which under Electron will deal fine with Electron's ASAR
// app bundle. Without it, Piscina will try fancier methods
// that aren't at the time of writing correctly patched to
// deal with an ASAR app bundle, and so report that this
// file doesn't exist instead of exporting an XLSX file.
//   https://github.com/gristlabs/grist-electron/issues/9
export default function doNothing() {
}
