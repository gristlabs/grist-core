import {GristDoc} from 'app/client/components/GristDoc';
import {ClientColumnGetters} from 'app/client/models/ClientColumnGetters';
import {ViewSectionRec} from 'app/client/models/entities/ViewSectionRec';
import * as rowset from 'app/client/models/rowset';
import {MANUALSORT} from 'app/common/gristTypes';
import {SortFunc} from 'app/common/SortFunc';
import * as ko from 'knockout';
import range = require('lodash/range');

/**
 * Adds a column to the given sort spec, replacing its previous occurrence if
 * it's already in the sort spec.
 */
export function addToSort(sortSpecObs: ko.Observable<number[]>, colRef: number) {
  const spec = sortSpecObs.peek();
  const index = spec.findIndex((colRefSpec) => Math.abs(colRefSpec) === Math.abs(colRef));
  if (index !== -1) {
    spec.splice(index, 1, colRef);
  } else {
    spec.push(colRef);
  }
  sortSpecObs(spec);
}


// Takes an activeSortSpec and sortRef to flip (negative sortRefs signify descending order) and returns a new
// activeSortSpec with that sortRef flipped (or original spec if sortRef not found).
export function flipColDirection(spec: number[], sortRef: number): number[] {
  const idx = spec.findIndex(c => c === sortRef);
  if (idx !== -1) {
    const newSpec = Array.from(spec);
    newSpec[idx] *= -1;
    return newSpec;
  }
  return spec;
}

// Parses the sortColRefs string, defaulting to an empty array on invalid input.
export function parseSortColRefs(sortColRefs: string): number[] {
  try {
    return JSON.parse(sortColRefs);
  } catch (err) {
    return [];
  }
}

// Given the current sort spec, moves sortRef to be immediately before nextSortRef. Moves sortRef
// to the end of the sort spec if nextSortRef is null.
// If the given sortRef or nextSortRef cannot be found, return sortSpec unchanged.
export function reorderSortRefs(spec: number[], sortRef: number, nextSortRef: number|null): number[] {
  const updatedSpec = spec.slice();

  // Remove sortRef from sortSpec.
  const _idx = updatedSpec.findIndex(c => c === sortRef);
  if (_idx === -1) { return spec; }
  updatedSpec.splice(_idx, 1);

  // Add sortRef to before nextSortRef
  const _nextIdx = nextSortRef ? updatedSpec.findIndex(c => c === nextSortRef) : updatedSpec.length;
  if (_nextIdx === -1) { return spec; }
  updatedSpec.splice(_nextIdx, 0, sortRef);

  return updatedSpec;
}

// Updates the manual sort positions to the positions currently displayed in the view, sets the
// view's default sort spec to be manual sort and broadcasts these changes.
// This is excel/google sheets' sort behavior.
export async function updatePositions(gristDoc: GristDoc, section: ViewSectionRec): Promise<void> {
  const tableId = section.table.peek().tableId.peek();
  const tableModel = gristDoc.getTableModel(tableId);

  // Build a sorted array of rowIds the way a view would, using the active sort spec. We just need
  // the sorted list, and can dispose the observable array immediately.
  const sortFunc = new SortFunc(new ClientColumnGetters(tableModel, {unversioned: true}));
  sortFunc.updateSpec(section.activeDisplaySortSpec.peek());
  const sortedRows = rowset.SortedRowSet.create(null, (a: rowset.RowId, b: rowset.RowId) =>
    sortFunc.compare(a as number, b as number), tableModel.tableData);
  sortedRows.subscribeTo(tableModel);
  const sortedRowIds = sortedRows.getKoArray().peek().slice(0);
  sortedRows.dispose();

  // The action just assigns consecutive positions to the sorted rows.
  const colInfo = {[MANUALSORT]: range(0, sortedRowIds.length)};
  await gristDoc.docData.sendActions([
    // Update row positions and clear the saved sort spec as a single action bundle.
    ['BulkUpdateRecord', tableId, sortedRowIds, colInfo],
    ['UpdateRecord', '_grist_Views_section', section.getRowId(), {sortColRefs: '[]'}]
  ], `Updated table ${tableId} row positions.`);
  // Finally clear out the local sort spec.
  section.activeSortJson.revert();
}
