const gutil = require('app/common/gutil');
const {SortFunc} = require('app/common/SortFunc');
const ValueFormatter = require('app/common/ValueFormatter');
const Promise = require('bluebird');
const contentDisposition = require('content-disposition');
const csv = require('csv');
const fs = require('fs-extra');
const log = require('./lib/log');
const {ServerColumnGetters} = require('./lib/ServerColumnGetters');
const multiparty = require('multiparty');
const tmp = require('tmp');
const _ = require('underscore');

Promise.promisifyAll(csv);
Promise.promisifyAll(multiparty, {filter: name => (name === 'parse'), multiArgs: true});
Promise.promisifyAll(fs);
Promise.promisifyAll(tmp);

function generateCSV(req, res, comm) {
  log.info('Generating .csv file...');
  // Get the current table id
  var tableId = req.param('tableId');
  var viewSectionId = parseInt(req.param('viewSection'), 10);
  var activeSortOrder = gutil.safeJsonParse(req.param('activeSortSpec'), null);

  // Get the active doc
  var clientId = req.param('clientId');
  var docFD = parseInt(req.param('docFD'), 10);
  var client = comm.getClient(clientId);
  var docSession = client.getDocSession(docFD);
  var activeDoc = docSession.activeDoc;

  // Generate a decent name for the exported file.
  var docName = req.query.title || activeDoc.docName;
  var name = docName +
    (tableId === docName ? '' : '-' + tableId) + '.csv';

  res.set('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', contentDisposition(name));
  return makeCSV(activeDoc, viewSectionId, activeSortOrder, req)
  .then(data => res.send(data));
}
exports.generateCSV = generateCSV;

/**
 * Returns a csv stream that can be transformed or parsed.  See https://github.com/wdavidw/node-csv
 * for API details.
 *
 * @param {Object} activeDoc - the activeDoc that the table being converted belongs to.
 * @param {Integer} viewSectionId - id of the viewsection to export.
 * @param {Integer[]} activeSortOrder (optional) - overriding sort order.
 * @return {Promise<string>} Promise for the resulting CSV.
 */
function makeCSV(activeDoc, viewSectionId, sortOrder, req) {
  return Promise.try(() => {
    const tables = activeDoc.docData.getTables();
    const viewSection = tables.get('_grist_Views_section').getRecord(viewSectionId);
    const table = tables.get('_grist_Tables').getRecord(viewSection.tableRef);
    const fields = tables.get('_grist_Views_section_field').filterRecords({ parentId: viewSection.id});
    const tableColumns = tables.get('_grist_Tables_column').filterRecords({parentId: table.id});
    const tableColsById = _.indexBy(tableColumns, 'id');

    // Produce a column description matching what user will see / expect to export
    const viewify = (col, field) => {
      field = field || {};
      const displayCol = tableColsById[field.displayCol || col.displayCol || col.id];
      const colWidgetOptions = gutil.safeJsonParse(col.widgetOptions, {});
      const fieldWidgetOptions = gutil.safeJsonParse(field.widgetOptions, {});
      return {
        id: displayCol.id,
        colId: displayCol.colId,
        label: col.label,
        colType: col.type,
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
      if (!col) return 0;
      const effectiveColRef = viewify(col, fieldsByColRef[colRef]).id;
      return directionalColRef > 0 ? effectiveColRef : -effectiveColRef;
    });

    return [activeDoc.fetchTable({client: null, req}, table.tableId, true), tableColumns, viewColumns];
  }).spread((data, tableColumns, viewColumns) => {
    const rowIds = data[2];
    const dataByColId = data[3];
    const getters = new ServerColumnGetters(rowIds, dataByColId, tableColumns);
    const sorter = new SortFunc(getters);
    sorter.updateSpec(sortOrder);
    rowIds.sort((a, b) => sorter.compare(a, b));
    const formatters = viewColumns.map(col =>
      ValueFormatter.createFormatter(col.colType, col.widgetOptions));
    // Arrange the data into a row-indexed matrix, starting with column headers.
    const csvMatrix = [viewColumns.map(col => col.label)];
    const access = viewColumns.map(col => getters.getColGetter(col.id));
    rowIds.forEach(row => {
      csvMatrix.push(access.map((getter, c) => formatters[c].formatAny(getter(row))));
    });
    return csv.stringifyAsync(csvMatrix, {formatters: {bool: v => '' + Number(v)}});
  });
}
exports.makeCSV = makeCSV;
