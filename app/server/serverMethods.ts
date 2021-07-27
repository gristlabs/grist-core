import * as Comm from 'app/server/lib/Comm';
import {parseExportFileName, parseExportParameters} from 'app/server/lib/Export';
import {makeCSV} from 'app/server/lib/ExportCSV';
import {makeXLSX} from 'app/server/lib/ExportXLSX';
import * as log from 'app/server/lib/log';
import {integerParam, stringParam} from 'app/server/lib/requestUtils';
import * as contentDisposition from 'content-disposition';
import * as express from 'express';

export async function generateCSV(req: express.Request, res: express.Response, comm: Comm) {
  log.info('Generating .csv file...');
  const {
    viewSectionId,
    filters,
    sortOrder
  } = parseExportParameters(req);

  const clientId = stringParam(req.query.clientId);
  const docFD = integerParam(req.query.docFD);
  const client = comm.getClient(clientId);
  const docSession = client.getDocSession(docFD);
  const activeDoc = docSession.activeDoc;

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

export async function generateXLSX(req: express.Request, res: express.Response, comm: Comm) {
  log.debug(`Generating .xlsx file`);
  const clientId = stringParam(req.query.clientId);
  const docFD = integerParam(req.query.docFD);
  const client = comm.getClient(clientId);
  const docSession = client.getDocSession(docFD);
  const activeDoc = docSession.activeDoc;
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
