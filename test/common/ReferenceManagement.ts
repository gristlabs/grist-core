import { compareReferenceContracts } from "app/common/ReferenceManagement";
import { ReferencePublicationSpec } from "app/common/ReferenceTables";

import { assert } from "chai";

describe("Reference contract comparison", () => {
  it("compares columns and every filter against the accepted contract without changing it", () => {
    const before: ReferencePublicationSpec = { name: "Catalog", tables: [{ tableRef: 1, colRefs: [3, 4],
      filters: [{ colRef: 6, op: "in", values: [true, null] }, { colRef: 3, op: "gte", values: [10] }] }] };
    const after: ReferencePublicationSpec = { name: "Renamed", tables: [{ tableRef: 1, colRefs: [4, 5],
      filters: [{ colRef: 3, op: "lt", values: [20] }] }] };
    const saved = JSON.stringify(before);
    assert.deepEqual(compareReferenceContracts(before, after), [{ tableRef: 1, addedColumns: [5], removedColumns: [3],
      previousFilters: before.tables[0].filters, filters: after.tables[0].filters, filtersChanged: true }]);
    assert.equal(JSON.stringify(before), saved);
    assert.isEmpty(compareReferenceContracts(before, { ...before, name: "Description only", description: "New" }));
  });
});
