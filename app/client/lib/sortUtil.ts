import { GristDoc } from 'app/client/components/GristDoc';
import { ClientColumnGetters } from 'app/client/models/ClientColumnGetters';
import { ViewSectionRec } from 'app/client/models/entities/ViewSectionRec';
import * as rowset from 'app/client/models/rowset';
import { MANUALSORT } from 'app/common/gristTypes';
import { SortFunc } from 'app/common/SortFunc';
import { Sort } from 'app/common/SortSpec';
import { UIRowId } from 'app/plugin/GristAPI';
import * as ko from 'knockout';
import range = require('lodash/range');


/**
 * Adds a column to the given sort spec, replacing its previous occurrence if
 * it's already in the sort spec.
 */
export function addToSort(sortSpecObs: ko.Observable<Sort.SortSpec>, colRef: number, direction: -1|1) {
  const spec = sortSpecObs.peek();
  const index = Sort.findColIndex(spec, colRef);
  if (index !== -1) {
    spec.splice(index, 1, colRef * direction);
  } else {
    spec.push(colRef * direction);
  }
  sortSpecObs(spec);
}

export function sortBy(sortSpecObs: ko.Observable<Sort.SortSpec>, colRef: number, direction: -1|1) {
  let spec = sortSpecObs.peek();
  const colSpec = Sort.findCol(spec, colRef) ?? colRef;
  spec = [Sort.setColDirection(colSpec, direction)];
  sortSpecObs(spec);
}

// Updates the manual sort positions to the positions currently displayed in the view, sets the
// view's default sort spec to be manual sort and broadcasts these changes.
// This is excel/google sheets' sort behavior.
export async function updatePositions(gristDoc: GristDoc, section: ViewSectionRec): Promise<void> {
  const tableId = section.table.peek().tableId.peek();
  const tableModel = gristDoc.getTableModel(tableId);

  // Build a sorted array of rowIds the way a view would, using the active sort spec. We just need
  // the sorted list, and can dispose the observable array immediately.
  const sortFunc = new SortFunc(new ClientColumnGetters(tableModel, { unversioned: true }));
  sortFunc.updateSpec(section.activeDisplaySortSpec.peek());
  const sortedRows = rowset.SortedRowSet.create(
    null,
    (a: UIRowId, b: UIRowId) => sortFunc.compare(a as number, b as number),
    tableModel.tableData
  );
  sortedRows.subscribeTo(tableModel);
  const sortedRowIds = sortedRows.getKoArray().peek().slice(0);
  sortedRows.dispose();

  // The action just assigns consecutive positions to the sorted rows.
  const colInfo = {[MANUALSORT]: range(0, sortedRowIds.length)};
  await gristDoc.docData.sendActions(
    [
      // Update row positions and clear the saved sort spec as a single action bundle.
      ['BulkUpdateRecord', tableId, sortedRowIds, colInfo],
      ['UpdateRecord', '_grist_Views_section', section.getRowId(), {sortColRefs: '[]'}],
    ],
    `Updated table ${tableId} row positions.`
  );
  // Finally clear out the local sort spec.
  section.activeSortJson.revert();
}
