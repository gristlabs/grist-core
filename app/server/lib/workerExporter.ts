import {PassThrough} from 'stream';
import {FilterColValues} from "app/common/ActiveDocAPI";
import {ActiveDocSource, doExportDoc, doExportSection, doExportTable,
        ExportData, ExportHeader, ExportParameters, Filter} from 'app/server/lib/Export';
import {createExcelFormatter} from 'app/server/lib/ExcelFormatter';
import * as log from 'app/server/lib/log';
import {Alignment, Border, Buffer as ExcelBuffer, stream as ExcelWriteStream,
        Fill, Workbook} from 'exceljs';
import {Rpc} from 'grain-rpc';
import {Stream} from 'stream';
import {MessagePort, threadId} from 'worker_threads';

export const makeXLSXFromOptions = handleExport(doMakeXLSXFromOptions);

function handleExport<T extends any[]>(
  make: (a: ActiveDocSource, testDates: boolean, output: Stream, ...args: T) => Promise<void|ExcelBuffer>
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

export async function doMakeXLSXFromOptions(
  activeDocSource: ActiveDocSource,
  testDates: boolean,
  stream: Stream,
  options: ExportParameters
) {
  const {tableId, viewSectionId, filters, sortOrder, linkingFilter, header} = options;
  if (viewSectionId) {
    return doMakeXLSXFromViewSection({activeDocSource, testDates, stream, viewSectionId, header,
      sortOrder: sortOrder || null, filters: filters || null, linkingFilter: linkingFilter || null});
  } else if (tableId) {
    return doMakeXLSXFromTable({activeDocSource, testDates, stream, tableId, header});
  } else {
    return doMakeXLSX({activeDocSource, testDates, stream, header});
  }
}

/**
 * @async
 * Returns a XLSX stream of a view section that can be transformed or parsed.
 *
 * @param {Object} options - options for the export.
 * @param {Object} options.activeDocSource - the activeDoc that the table being converted belongs to.
 * @param {Integer} options.viewSectionId - id of the viewsection to export.
 * @param {Integer[]} options.activeSortOrder (optional) - overriding sort order.
 * @param {Filter[]} options.filters (optional) - filters defined from ui.
 * @param {FilterColValues} options.linkingFilter (optional)
 * @param {Stream} options.stream - the stream to write to.
 * @param {boolean} options.testDates - whether to use static dates for testing.
 * @param {string} options.header (optional) - which field of the column to use as header
 */
async function doMakeXLSXFromViewSection({
  activeDocSource, testDates, stream, viewSectionId, sortOrder, filters, linkingFilter, header
}: {
  activeDocSource: ActiveDocSource,
  testDates: boolean,
  stream: Stream,
  viewSectionId: number,
  sortOrder: number[] | null,
  filters: Filter[] | null,
  linkingFilter: FilterColValues | null,
  header?: ExportHeader,
}) {
  const data = await doExportSection(activeDocSource, viewSectionId, sortOrder, filters, linkingFilter);
  const {exportTable, end} = convertToExcel(stream, testDates, {header});
  exportTable(data);
  return end();
}

/**
 * @async
 * Returns a XLSX stream of a table that can be transformed or parsed.
 *
 * @param {Object} options - options for the export.
 * @param {Object} options.activeDocSource - the activeDoc that the table being converted belongs to.
 * @param {Integer} options.tableId - id of the table to export.
 * @param {Stream} options.stream - the stream to write to.
 * @param {boolean} options.testDates - whether to use static dates for testing.
 * @param {string} options.header (optional) - which field of the column to use as header
 *
 */
async function doMakeXLSXFromTable({activeDocSource, testDates, stream, tableId, header}: {
  activeDocSource: ActiveDocSource,
  testDates: boolean,
  stream: Stream,
  tableId: string,
  header?: ExportHeader,
}) {
  const data = await doExportTable(activeDocSource, {tableId});
  const {exportTable, end} = convertToExcel(stream, testDates, {header});
  exportTable(data);
  return end();
}

/**
 * Creates excel document with all tables from an active Grist document.
 */
async function doMakeXLSX({activeDocSource, testDates, stream, header}: {
  activeDocSource: ActiveDocSource,
  testDates: boolean,
  stream: Stream,
  header?: ExportHeader,
}): Promise<void|ExcelBuffer> {
  const {exportTable, end} = convertToExcel(stream, testDates, {header});
  await doExportDoc(activeDocSource, async (table: ExportData) => exportTable(table));
  return end();
}

/**
 * Converts export data to an excel file.
 * If a stream is provided, use it via the more memory-efficient
 * WorkbookWriter, otherwise fall back on using a Workbook directly,
 * and return a buffer.
 * (The second option is for grist-static; at the time of writing
 * WorkbookWriter doesn't appear to be available in a browser context).
 */
function convertToExcel(stream: Stream|undefined, testDates: boolean, options: { header?: ExportHeader }): {
  exportTable: (table: ExportData) => void,
  end: () => Promise<void|ExcelBuffer>,
} {
  // Create workbook and add single sheet to it. Using the WorkbookWriter interface avoids
  // creating the entire Excel file in memory, which can be very memory-heavy. See
  // https://github.com/exceljs/exceljs#streaming-xlsx-writercontents. (The options useStyles and
  // useSharedStrings replicate more closely what was used previously.)
  // If there is no stream, write with a Workbook.
  const wb: Workbook | ExcelWriteStream.xlsx.WorkbookWriter = stream ?
      new ExcelWriteStream.xlsx.WorkbookWriter({ useStyles: true, useSharedStrings: true, stream }) :
      new Workbook();
  const maybeCommit = stream ? (t: any) => t.commit() : (t: any) => {};
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
    const colHeader = options.header ?? 'label';
    ws.columns = columns.map((col, c) => ({ header: col[colHeader], style: formatters[c].style() }));
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
      maybeCommit(ws.addRow(access.map((getter, c) => formatters[c].formatAny(getter(row)))));
    }
    maybeCommit(ws);
  }
  async function end(): Promise<void|ExcelBuffer> {
    if (!stream) {
      return wb.xlsx.writeBuffer();
    }
    return maybeCommit(wb);
  }
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
