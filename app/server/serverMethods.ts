import {parseExportFileName, parseExportParameters} from 'app/server/lib/Export';
import {makeCSV} from 'app/server/lib/ExportCSV';
import {makeXLSX} from 'app/server/lib/ExportXLSX';
import * as log from 'app/server/lib/log';
import * as contentDisposition from 'content-disposition';
import * as express from 'express';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';

export async function generateCSV(activeDoc: ActiveDoc, req: express.Request, res: express.Response) {
  log.info('Generating .csv file...');
  const {
    viewSectionId,
    filters,
    sortOrder
  } = parseExportParameters(req);

  // Generate a decent name for the exported file.
  const name = parseExportFileName(activeDoc, req);
  try {
    const data = await makeCSV(activeDoc, viewSectionId, sortOrder, filters, req);
    res.set('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', contentDisposition(name + '.csv'));
    res.send(data);
  } catch (err) {
    log.error("Exporting to CSV has failed. Request url: %s", req.url, err);
    const errHtml =
      `<!doctype html>
<html>
  <body>There was an unexpected error while generating a csv file.</body>
</html>
`;
    res.status(400).send(errHtml);
  }
}

export async function generateXLSX(activeDoc: ActiveDoc, req: express.Request, res: express.Response) {
  log.debug(`Generating .xlsx file`);
  try {
    const data = await makeXLSX(activeDoc, req);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', contentDisposition((req.query.title || activeDoc.docName) + '.xlsx'));
    res.send(data);
    log.debug('XLSX file generated');
  } catch (err) {
    log.error("Exporting to XLSX has failed. Request url: %s", req.url, err);
    // send a generic information to client
    const errHtml =
      `<!doctype html>
<html>
  <body>There was an unexpected error while generating a xlsx file.</body>
</html>
`;
    res.status(400).send(errHtml);
  }
}
