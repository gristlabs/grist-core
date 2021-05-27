import * as gutil from 'app/common/gutil';
import { SortFunc } from "app/common/SortFunc";
import { docSessionFromRequest } from "app/server/lib/DocSession";
import * as bluebird from "bluebird";
import * as contentDisposition from "content-disposition";
import * as csv from "csv";
import * as log from "./lib/log";
import { ServerColumnGetters } from "./lib/ServerColumnGetters";
import * as _ from "underscore";
import * as express from "express";
import * as Comm from 'app/server/lib/Comm';
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { createFormatter } from "app/common/ValueFormatter";
import { SchemaTypes } from "app/common/schema";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import { RowRecord } from "app/common/DocActions";
import { buildColFilter } from "app/common/ColumnFilterFunc";
import { buildRowFilter } from "app/common/RowFilterFunc";

// promisify csv
bluebird.promisifyAll(csv);

export async function generateCSV(req: express.Request, res: express.Response, comm: Comm) {

  log.info('Generating .csv file...');
  // Get the current table id
  const tableId = req.param('tableId');
  const viewSectionId = parseInt(req.param('viewSection'), 10);
  const activeSortOrder = gutil.safeJsonParse(req.param('activeSortSpec'), null);
  const filters: Filter[] = gutil.safeJsonParse(req.param("filters"), []) || [];

  // Get the active doc
  const clientId = req.param('clientId');
  const docFD = parseInt(req.param('docFD'), 10);
  const client = comm.getClient(clientId);
  const docSession = client.getDocSession(docFD);
  const activeDoc = docSession.activeDoc;

  // Generate a decent name for the exported file.
  const docName = req.query.title || activeDoc.docName;
  const name = docName +
    (tableId === docName ? '' : '-' + tableId) + '.csv';

  try {
    const data = await makeCSV(activeDoc, viewSectionId, activeSortOrder, filters, req);
    res.set('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', contentDisposition(name));
    res.send(data);
  } catch (err) {
    log.error("Exporting to CSV has failed. Request url: %s", req.url, err);
    // send a generic information to client
    const errHtml =
      `<!doctype html>
<html>
  <body>There was an unexpected error while generating a csv file.</body>
</html>
`;
    res.status(400).send(errHtml);
  }
}

/**
 * Returns a csv stream that can be transformed or parsed.  See https://github.com/wdavidw/node-csv
 * for API details.
 *
 * @param {Object} activeDoc - the activeDoc that the table being converted belongs to.
 * @param {Integer} viewSectionId - id of the viewsection to export.
 * @param {Integer[]} activeSortOrder (optional) - overriding sort order.
 * @return {Promise<string>} Promise for the resulting CSV.
 */
export async function makeCSV(
  activeDoc: ActiveDoc,
  viewSectionId: number,
  sortOrder: number[],
  filters: Filter[],
  req: express.Request) {

  const {
    table,
    viewSection,
    tableColumns,
    fields
  } = explodeSafe(activeDoc, viewSectionId);

  const tableColsById = _.indexBy(tableColumns, 'id');

  // Produce a column description matching what user will see / expect to export
  const viewify = (col: GristTablesColumn, field: GristViewsSectionField) => {
    field = field || {};
    const displayCol = tableColsById[field.displayCol || col.displayCol || col.id];
    const colWidgetOptions = gutil.safeJsonParse(col.widgetOptions, {});
    const fieldWidgetOptions = gutil.safeJsonParse(field.widgetOptions, {});
    const filterFunc = buildColFilter(filters.find(x => x.colRef === field.colRef)?.filter);
    return {
      id: displayCol.id,
      colId: displayCol.colId,
      label: col.label,
      colType: col.type,
      filterFunc,
      widgetOptions: Object.assign(colWidgetOptions, fieldWidgetOptions)
    };
  };
  const viewColumns = _.sortBy(fields, 'parentPos').map(
    (field) => viewify(tableColsById[field.colRef], field));

  // The columns named in sort order need to now become display columns
  sortOrder = sortOrder || gutil.safeJsonParse(viewSection.sortColRefs, []);
  const fieldsByColRef = _.indexBy(fields, 'colRef');
  sortOrder = sortOrder.map((directionalColRef) => {
    const colRef = Math.abs(directionalColRef);
    const col = tableColsById[colRef];
    if (!col) {
      return 0;
    }
    const effectiveColRef = viewify(col, fieldsByColRef[colRef]).id;
    return directionalColRef > 0 ? effectiveColRef : -effectiveColRef;
  });

  const data = await activeDoc.fetchTable(docSessionFromRequest(req as RequestWithLogin), table.tableId, true);
  const rowIds = data[2];
  const dataByColId = data[3];
  const getters = new ServerColumnGetters(rowIds, dataByColId, tableColumns);
  const sorter = new SortFunc(getters);
  sorter.updateSpec(sortOrder);
  rowIds.sort((a, b) => sorter.compare(a, b));
  const formatters = viewColumns.map(col =>
    createFormatter(col.colType, col.widgetOptions));
  // Arrange the data into a row-indexed matrix, starting with column headers.
  const csvMatrix = [viewColumns.map(col => col.label)];
  const access = viewColumns.map(col => getters.getColGetter(col.id));
  // create row filter based on all columns filter
  const rowFilter = viewColumns
    .map((col, c) => buildRowFilter(access[c], col.filterFunc))
    .reduce((prevFilter, curFilter) => (id) => prevFilter(id) && curFilter(id), () => true);
  rowIds.forEach(row => {
    if (!rowFilter(row)) {
      return;
    }
    csvMatrix.push(access.map((getter, c) => formatters[c].formatAny(getter!(row))));
  });

  return csv.stringifyAsync(csvMatrix);
}


// helper method that retrieves various parts about view section
// from ActiveDoc
function explodeSafe(activeDoc: ActiveDoc, viewSectionId: number) {
  const docData = activeDoc.docData;

  if (!docData) {
    // Should not happen unless there's a logic error
    // This method is exported (for testing) so it is possible
    // to call it without loading active doc first
    throw new Error("Document hasn't been loaded yet");
  }

  const viewSection = docData
    .getTable('_grist_Views_section')
    ?.getRecord(viewSectionId) as GristViewsSection | undefined;

  if (!viewSection) {
    throw new Error(`No table '_grist_Views_section' in document with id ${activeDoc.docName}`);
  }

  const table = docData
    .getTable('_grist_Tables')
    ?.getRecord(viewSection.tableRef) as GristTables | undefined;

  if (!table) {
    throw new Error(`No table '_grist_Tables' in document with id ${activeDoc.docName}`);
  }

  const fields = docData
    .getTable('_grist_Views_section_field')
    ?.filterRecords({ parentId: viewSection.id }) as GristViewsSectionField[] | undefined;

  if (!fields) {
    throw new Error(`No table '_grist_Views_section_field' in document with id ${activeDoc.docName}`);
  }

  const tableColumns = docData
    .getTable('_grist_Tables_column')
    ?.filterRecords({ parentId: table.id }) as GristTablesColumn[] | undefined;

  if (!tableColumns) {
    throw new Error(`No table '_grist_Tables_column' in document with id ${activeDoc.docName}`);
  }

  return {
    table,
    fields,
    tableColumns,
    viewSection
  };
}


// Type helpers for types used in this export
type RowModel<TName extends keyof SchemaTypes> = RowRecord & {
  [ColId in keyof SchemaTypes[TName]]: SchemaTypes[TName][ColId];
};
type GristViewsSection = RowModel<'_grist_Views_section'>
type GristTables = RowModel<'_grist_Tables'>
type GristViewsSectionField = RowModel<'_grist_Views_section_field'>
type GristTablesColumn = RowModel<'_grist_Tables_column'>

// Type for filters passed from the client
interface Filter { colRef: number, filter: string }
