import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {createExcelFormatter} from 'app/server/lib/ExcelFormatter';
import {ExportData, exportDoc} from 'app/server/lib/Export';
import {Alignment, Border, Fill, Workbook} from 'exceljs';
import * as express from 'express';

/**
 * Creates excel document with all tables from an active Grist document.
 */
export async function makeXLSX(
  activeDoc: ActiveDoc,
  req: express.Request): Promise<ArrayBuffer> {
  const content = await exportDoc(activeDoc, req);
  const data = await convertToExcel(content, req.host === 'localhost');
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
    const ws = wb.addWorksheet(tableName);
    // Build excel formatters.
    const formatters = columns.map(col => createExcelFormatter(col.type, col.widgetOptions));
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
