import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {createExcelFormatter} from 'app/server/lib/ExcelFormatter';
import {DownloadOptions, ExportData, exportDoc, exportSection, exportTable, Filter} from 'app/server/lib/Export';
import {Alignment, Border, Fill, Workbook} from 'exceljs';
import * as express from 'express';
import log from 'app/server/lib/log';
import contentDisposition from 'content-disposition';
import { ApiError } from 'app/common/ApiError';

/**
 * Converts `activeDoc` to XLSX and sends the converted data through `res`.
 */
export async function downloadXLSX(activeDoc: ActiveDoc, req: express.Request,
                                   res: express.Response, options: DownloadOptions) {
  log.debug(`Generating .xlsx file`);
  const {filename, tableId, viewSectionId, filters, sortOrder} = options;
  // hanlding 3 cases : full XLSX export (full file), view xlsx export, table xlsx export
  const data = viewSectionId ? await makeXLSXFromViewSection(activeDoc, viewSectionId, sortOrder, filters, req)
              : tableId ? await makeXLSXFromTable(activeDoc, tableId, req)
              : await makeXLSX(activeDoc, req);

  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', contentDisposition(filename + '.xlsx'));
  res.send(data);
  log.debug('XLSX file generated');
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
  activeDoc: ActiveDoc,
  viewSectionId: number,
  sortOrder: number[],
  filters: Filter[],
  req: express.Request,
) {

  const data = await exportSection(activeDoc, viewSectionId, sortOrder, filters, req);
  const xlsx = await convertToExcel([data], req.hostname === 'localhost');
  return xlsx;
}

/**
 * Returns a XLSX stream of a table that can be transformed or parsed.
 *
 * @param {Object} activeDoc - the activeDoc that the table being converted belongs to.
 * @param {Integer} tableId - id of the table to export.
 */
export async function makeXLSXFromTable(
  activeDoc: ActiveDoc,
  tableId: string,
  req: express.Request
) {
  if (!activeDoc.docData) {
    throw new Error('No docData in active document');
  }

  // Look up the table to make a XLSX from.
  const tables = activeDoc.docData.getMetaTable('_grist_Tables');
  const tableRef = tables.findRow('tableId', tableId);

  if (tableRef === 0) {
    throw new ApiError(`Table ${tableId} not found.`, 404);
  }

  const data = await exportTable(activeDoc, tableRef, req);
  const xlsx = await convertToExcel([data], req.hostname === 'localhost');
  return xlsx;
}

/**
 * Creates excel document with all tables from an active Grist document.
 */
export async function makeXLSX(
  activeDoc: ActiveDoc,
  req: express.Request,
): Promise<ArrayBuffer> {
  const content = await exportDoc(activeDoc, req);
  const data = await convertToExcel(content, req.hostname === 'localhost');
  return data;
}

/**
 * Converts export data to an excel file.
 */
async function convertToExcel(tables: ExportData[], testDates: boolean) {
  // Create workbook and add single sheet to it.
  const wb = new Workbook();
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
  for (const table of tables) {
    const { columns, rowIds, access, tableName } = table;
    const ws = wb.addWorksheet(sanitizeWorksheetName(tableName));
    // Build excel formatters.
    const formatters = columns.map(col => createExcelFormatter(col.formatter.type, col.formatter.widgetOpts));
    // Generate headers for all columns with correct styles for whole column.
    // Actual header style for a first row will be overwritten later.
    ws.columns = columns.map((col, c) => ({ header: col.label, style: formatters[c].style() }));
    // Populate excel file with data
    rowIds.forEach(row => {
      ws.addRow(access.map((getter, c) => formatters[c].formatAny(getter(row))));
    });
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
  }

  return await wb.xlsx.writeBuffer();
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
