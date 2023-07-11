import type {CopySelection} from 'app/client/components/CopySelection';
import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import type {KoArray} from 'app/client/lib/koArray';
import {simpleStringHash} from 'app/client/lib/textUtils';
import type {ViewFieldRec} from 'app/client/models/DocModel';
import type {BulkUpdateRecord} from 'app/common/DocActions';
import {safeJsonParse} from 'app/common/gutil';
import type {TableData} from 'app/common/TableData';
import {tsvEncode} from 'app/common/tsvFormat';
import {dom} from 'grainjs';
import zipObject = require('lodash/zipObject');

const G = getBrowserGlobals('document', 'DOMParser');

/**
 * Returns a sorted array of parentPos values for a viewField to be inserted just before index.
 * @param {koArray} viewFields - koArray of viewFields
 * @{param} {number} index - index in viewFields at which to insert the new fields
 * @{param} {number} numInserts - number of new fields to insert
 */
export function fieldInsertPositions(viewFields: KoArray<ViewFieldRec>, index: number, numInserts: number = 1
): Array<number|null> {
  const rightPos = (index < viewFields.peekLength) ? viewFields.at(index)!.parentPos() : null;
  return Array(numInserts).fill(rightPos);
}

/**
 * Returns tsv formatted values from TableData at the given rowIDs and columnIds.
 * @param {TableData} tableData - the table containing the values to convert
 * @param {CopySelection} selection - a CopySelection instance
 * @return {String}
 **/
export function makePasteText(tableData: TableData, selection: CopySelection) {
  // tsvEncode expects data as a 2-d array with each a array representing a row
  // i.e. [["1-1", "1-2", "1-3"],["2-1", "2-2", "2-3"]]
  const values = selection.rowIds.map(rowId =>
    selection.columns.map(col => col.fmtGetter(rowId)));
  return tsvEncode(values);
}

/**
 * Hash of the current docId to allow checking if copying and pasting is happening in the same document,
 * without leaking the actual docId which may allow others to access the document.
 */
export function getDocIdHash(): string {
  const docId = (window as any).gristDocPageModel.currentDocId.get();
  return simpleStringHash(docId);
}

/**
 * Returns an html table of containing the cells denoted by the cross product of
 * the given rows and columns, styled by the given table/row/col style dictionaries.
 * @param {TableData} tableData - the table containing the values denoted by the grid selection
 * @param {CopySelection} selection - a CopySelection instance
 * @param {Boolean} showColHeader - whether to include a column header row
 * @return {String} The html for a table containing the given data.
 **/
export function makePasteHtml(tableData: TableData, selection: CopySelection, includeColHeaders: boolean) {
  const rowStyle = selection.rowStyle || {};    // Maps rowId to style object.
  const colStyle = selection.colStyle || {};    // Maps colId to style object.

  const elem = dom('table',
    {border: '1', cellspacing: '0', style: 'white-space: pre', 'data-grist-doc-id-hash': getDocIdHash()},
    dom('colgroup', selection.colIds.map((colId, idx) =>
      dom('col', {
        style: _styleAttr(colStyle[colId]),
        'data-grist-col-ref': String(selection.colRefs[idx]),
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
        {style: _styleAttr(rowStyle[rowId as number])},
        selection.columns.map(col => {
          const rawValue = col.rawGetter(rowId);
          const fmtValue = col.fmtGetter(rowId);
          const dataOptions = (rawValue === fmtValue) ? {} :
            {'data-grist-raw-value': JSON.stringify(rawValue)};
          return dom('td', dataOptions, fmtValue);
        })
      )
    )
  );
  return elem.outerHTML;
}

export interface RichPasteObject {
  displayValue: string;
  docIdHash?: string|null;
  colType?: string|null;  // Column type of the source column.
  colRef?: number|null;
  rawValue?: unknown;     // Optional rawValue that should be used if colType matches destination.
}

/**
 * Parses a 2-d array of objects from a text string containing an HTML table.
 * @param {string} data - String of an HTML table.
 * @return {Array<Array<RichPasteObj>>} - 2-d array of objects containing details of copied cells.
 */
export function parsePasteHtml(data: string): RichPasteObject[][] {
  const parser = new G.DOMParser() as DOMParser;
  const doc = parser.parseFromString(data, 'text/html');
  const table = doc.querySelector('table')!;
  const docIdHash = table.getAttribute('data-grist-doc-id-hash');

  const cols = [...table.querySelectorAll('col')];
  const rows = [...table.querySelectorAll('tr')];
  const result = rows.map(row =>
    Array.from(row.querySelectorAll('td, th'), (cell, colIdx) => {
      const col = cols[colIdx];
      const colType = col?.getAttribute('data-grist-col-type');
      const colRef = col && Number(col.getAttribute('data-grist-col-ref'));
      const o: RichPasteObject = {displayValue: cell.textContent!, docIdHash, colType, colRef};

      if (cell.hasAttribute('data-grist-raw-value')) {
        o.rawValue = safeJsonParse(cell.getAttribute('data-grist-raw-value')!,
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

// Helper function to add css style properties to an html tag
function _styleAttr(style: object|undefined) {
  if (typeof style !== 'object') {
    return '';
  }
  return Object.entries(style).map(([prop, value]) => `${prop}: ${value};`).join(' ');
}

/**
* Given a selection object, creates a action to set all references in the object to the empty string.
* @param {Object} selection - an object with a list of selected row Ids, selected column Ids, a list of
* column metaRowModels and other information about the currently selected cells.
* See GridView.js getSelection and DetailView.js getSelection.
* @returns {Object} BulkUpdateRecord action
*/
export function makeDeleteAction(selection: CopySelection): BulkUpdateRecord|null {
  // If the selection includes the "new" row, ignore that one.
  const rowIds = selection.rowIds.filter((r): r is number => (typeof r === 'number'));
  if (rowIds.length === 0) {
    return null;
  }
  const blankRow = rowIds.map(() => '');

  const colIds = selection.fields
    .filter(field => !field.column().isRealFormula() && !field.disableEditData())
    .map(field => field.colId());

  // Get the tableId from the first selected column.
  const tableId = selection.fields[0].column().table().tableId();

  if (colIds.length === 0) {
    return null;
  }
  return ['BulkUpdateRecord', tableId, rowIds,
    zipObject(colIds, colIds.map(() => blankRow))];
}
