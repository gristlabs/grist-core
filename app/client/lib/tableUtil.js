var _         = require('underscore');

var dom             = require('./dom');
var gutil           = require('app/common/gutil');
var {tsvEncode}     = require('app/common/tsvFormat');

const G = require('../lib/browserGlobals').get('document', 'DOMParser');

/**
 *  Returns unique positions given upper and lower position. This function returns a suitable
 *  position number for the to-be-inserted element to end up at the given index.
 *  Inserting n elements between a and b should give the positions:
 *  (a+(b-a)/(n+1)), (a+2(b-a)/(n+1)) , ..., (a+(n)(b-a)/(n+1))
 *  @param {number} lowerPos - a lower bound
 *  @param {number} upperPos - an upper bound, must be greater than or equal to lowerPos
 *  @param {number} numInserts - Number of new positions to insert
 *  @returns {number[]} A sorted Array of unique positions bounded by lowerPos and upperPos.
 *                        If neither an upper nor lowerPos is given, return 0, 1, ..., numInserts - 1
 *                        If an upperPos is not given, return consecutive values greater than lowerPos
 *                        If a lowerPos is not given, return consecutive values lower than upperPos
 *                        Else return the avg position of to-be neighboring elements.
 *  Ex: insertPositions(null, 0, 4) = [1, 2, 3, 4]
 *      insertPositions(0, null, 4) = [-4, -3, -2, -1]
 *      insertPositions(0, 1, 4) = [0.2, 0.4, 0.6, 0.8]
 */
function insertPositions(lowerPos, upperPos, numInserts) {
  numInserts = (typeof numInserts === 'undefined') ? 1 : numInserts;
  var start;
  var step = 1;
  var positions = [];

  if (typeof lowerPos !== 'number' && typeof upperPos !== 'number') {
    start = 0;
  } else if (typeof lowerPos !== 'number') {
    start = upperPos - numInserts;
  } else if (typeof upperPos !== 'number') {
    start = lowerPos + 1;
  } else {
    step = (upperPos - lowerPos)/(numInserts + 1);
    start = lowerPos + step;
  }

  for(var i = 0; i < numInserts; i++ ){
    positions.push(start + step*i);
  }
  return positions;
}
exports.insertPositions = insertPositions;

/**
 * Returns a sorted array of parentPos values between the parentPos of the viewField at index-1 and index.
 * @param {koArray} viewFields - koArray of viewFields
 * @{param} {number} index - index to insert the viewFields into
 * @{param} {number} numInserts - number of new fields to insert
 */
function fieldInsertPositions(viewFields, index, numInserts) {
  var leftPos = (index > 0) ? viewFields.at(index-1).parentPos() : null;
  var rightPos = (index < viewFields.peekLength) ? viewFields.at(index).parentPos() : null;
  return insertPositions(leftPos, rightPos, numInserts);
}
exports.fieldInsertPositions = fieldInsertPositions;

/**
 * Returns tsv formatted values from TableData at the given rowIDs and columnIds.
 * @param {TableData} tableData - the table containing the values to convert
 * @param {CopySelection} selection - a CopySelection instance
 * @return {String}
 **/
function makePasteText(tableData, selection) {
  // tsvEncode expects data as a 2-d array with each a array representing a row
  // i.e. [["1-1", "1-2", "1-3"],["2-1", "2-2", "2-3"]]
  const values = selection.rowIds.map(rowId =>
    selection.columns.map(col => col.fmtGetter(rowId)));
  return tsvEncode(values);
}
exports.makePasteText = makePasteText;

/**
 * Returns an html table of containing the cells denoted by the cross product of
 * the given rows and columns, styled by the given table/row/col style dictionaries.
 * @param {TableData} tableData - the table containing the values denoted by the grid selection
 * @param {CopySelection} selection - a CopySelection instance
 * @param {Boolean} showColHeader - whether to include a column header row
 * @return {String} The html for a table containing the given data.
 **/
function makePasteHtml(tableData, selection, includeColHeaders) {
  let rowStyle = selection.rowStyle || {};    // Maps rowId to style object.
  let colStyle = selection.colStyle || {};    // Maps colId to style object.

  let elem = dom('table', {border: '1', cellspacing: '0', style: 'white-space: pre'},
    dom('colgroup', selection.colIds.map(colId =>
      dom('col', {
        style: _styleAttr(colStyle[colId]),
        'data-grist-col-type': tableData.getColType(colId)
      })
    )),
    // Include column headers if requested.
    (includeColHeaders ?
      dom('tr', selection.colIds.map(colId => dom('th', colId))) :
      null
    ),
    // Fill with table cells.
    selection.rowIds.map(rowId =>
      dom('tr',
        {style: _styleAttr(rowStyle[rowId])},
        selection.columns.map(col => {
          let rawValue = col.rawGetter(rowId);
          let fmtValue = col.fmtGetter(rowId);
          let dataOptions = {};
          if (rawValue != fmtValue) {
            dataOptions['data-grist-raw-value'] = JSON.stringify(rawValue);
          }
          return dom('td', dataOptions, fmtValue);
        })
      )
    )
  );
  return elem.outerHTML;
}
exports.makePasteHtml = makePasteHtml;

/**
 * @typedef RichPasteObject
 * @type {object}
 * @property {string} displayValue
 * @property {string} [rawValue] - Optional rawValue that should be used if colType matches
 *    destination.
 * @property {string} [colType] - Column type of the source column.
 */

/**
 * Parses a 2-d array of objects from a text string containing an HTML table.
 * @param {string} data - String of an HTML table.
 * @return {Array<Array<RichPasteObj>>} - 2-d array of objects containing details of copied cells.
 */
function parsePasteHtml(data) {
  let parser = new G.DOMParser();
  let doc = parser.parseFromString(data, 'text/html');
  let table = doc.querySelector('table');

  let colTypes = Array.from(table.querySelectorAll('col'), col =>
    col.getAttribute('data-grist-col-type'));

  let result = Array.from(table.querySelectorAll('tr'), (row, rowIdx) =>
    Array.from(row.querySelectorAll('td, th'), (cell, colIdx) => {
      let o = { displayValue: cell.textContent };

      // If there's a column type, add it to the object
      if (colTypes[colIdx]) {
        o.colType = colTypes[colIdx];
      }

      if (cell.hasAttribute('data-grist-raw-value')) {
        o.rawValue = gutil.safeJsonParse(cell.getAttribute('data-grist-raw-value'),
          o.displayValue);
      }

      return o;
    }))
    .filter((row) => (row.length > 0));
  if (result.length === 0) {
    throw new Error('Unable to parse data from text/html');
  }
  return result;
}
exports.parsePasteHtml = parsePasteHtml;

// Helper function to add css style properties to an html tag
function _styleAttr(style) {
  return _.map(style, (value, prop) => `${prop}: ${value};`).join(' ');
}

/**
 * groupBy takes in tableData and colId and returns an array of objects of unique values and counts.
 *
 * @param tableData
 * @param colId
 * @param {number} =optSort - Optional sort flag to return array sorted by count; 1 for asc, -1 for desc.
 */
function groupBy(tableData, colId, optSort) {
  var groups = _.map(
    _.countBy(tableData.getColValues(colId)),
    function(value, key) {
      return {
        key: key,
        count: value,
      };
    }
  );
  groups = _.sortBy(groups, 'key'); // first sort by key, then by count
  return optSort ? _.sortBy(groups, function(el) { return optSort * el.count; }) : groups;
}
exports.groupBy = groupBy;

/**
* Given a selection object, creates a action to set all references in the object to the empty string.
* @param {Object} selection - an object with a list of selected row Ids, selected column Ids, a list of
* column metaRowModels and other information about the currently selected cells.
* See GridView.js getSelection and DetailView.js getSelection.
* @returns {Object} BulkUpdateRecord action
*/

function makeDeleteAction(selection) {
  let blankRow = selection.rowIds.map(() => '');

  let colIds = selection.fields
    .filter(field => !field.column().isRealFormula() && !field.disableEditData())
    .map(field => field.colId());

  // Get the tableId from the first selected column.
  let tableId = selection.fields[0].column().table().tableId();

  return colIds.length === 0 ? null :
    ['BulkUpdateRecord', tableId, selection.rowIds, _.object(colIds, colIds.map(() => blankRow))];
}

exports.makeDeleteAction = makeDeleteAction;
