import { describeReferenceUpdate, referenceSyncDue } from "app/common/ReferenceSynchronization";
import { reconcileReferenceSnapshot, ReferenceMirrorState, ReferenceSnapshot } from "app/common/ReferenceTables";

import { assert } from "chai";

describe("ReferenceSynchronization", function() {
  it("only dispatches live or overdue scheduled subscriptions", function() {
    const settings = { syncMode: "scheduled" as const, syncIntervalMinutes: 1,
      nextSyncAt: new Date(1000).toISOString() };
    assert.isFalse(referenceSyncDue(settings, 999));
    assert.isTrue(referenceSyncDue(settings, 1000));
    assert.isTrue(referenceSyncDue({ ...settings, nextSyncAt: "" }, 0));
    assert.isFalse(referenceSyncDue({ ...settings, syncMode: "manual" }, 2000));
    assert.isTrue(referenceSyncDue({ ...settings, syncMode: "live" }, 0));
  });
  it("requires explicit schema acceptance and preserves local identities", function() {
    const old: ReferenceSnapshot = { generation: "g", revision: 1, tables: [{ key: "1", tableId: "Items",
      columns: [{ key: "a", colId: "Price", label: "Price", type: "Numeric" },
        { key: "b", colId: "Old", label: "Old", type: "Text" }], rows: { x: [5, "gone"], y: [6, "old"] } }] };
    const initial: ReferenceMirrorState = { generation: "g", revision: 1, snapshot: old, tables: {
      1: { tableId: "Catalog", columns: { a: "Price", b: "Old" }, rowIds: { x: 1, y: 2 }, nextRowId: 3 },
    } };
    const next: ReferenceSnapshot = { generation: "g", revision: 2, tables: [{ ...old.tables[0],
      columns: [{ ...old.tables[0].columns[0], type: "Text" }], rows: { x: ["five"], z: ["new"] } }] };
    assert.throws(() => reconcileReferenceSnapshot(initial, next), "SCHEMA_BLOCKED");
    const result = reconcileReferenceSnapshot(initial, next, true);
    assert.deepInclude(result.actions, ["ModifyColumn", "Catalog", "Price", { type: "Text" }]);
    assert.deepInclude(result.actions, ["RemoveColumn", "Catalog", "Old"]);
    assert.deepInclude(result.actions, ["BulkUpdateRecord", "Catalog", [1], { Price: ["five"] }]);
    assert.deepEqual(result.state.tables[1].rowIds, { x: 1, y: 2, z: 3 });
    assert.deepEqual(initial.tables[1].columns, { a: "Price", b: "Old" });
    const preview = describeReferenceUpdate(old, next);
    assert.lengthOf(preview.schema, 2);
    assert.include(preview.tables[0], { added: 1, updated: 1, removed: 1 });
  });
});
