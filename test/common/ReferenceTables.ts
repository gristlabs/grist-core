import { applyReferenceTransfer, matchesReferenceFilter, reconcileReferenceSnapshot,
  ReferenceMirrorState, ReferenceSnapshot, validateReferenceSpec } from "app/common/ReferenceTables";
import { GristObjCode as G } from "app/plugin/GristData";

import { assert } from "chai";
describe("ReferenceTables", function() {
  const snapshot = (): ReferenceSnapshot => ({ generation: "g", revision: 1, tables: [
    { key: "1", tableId: "Products", columns: [
      { key: "11", colId: "Name", label: "Name", type: "Text" },
      { key: "12", colId: "Category", label: "Category", type: "Ref:2", target: "2" },
    ], rows: { product: ["Tea", "category"] } },
    { key: "2", tableId: "Categories", columns: [
      { key: "21", colId: "Name", label: "Name", type: "Text" },
      { key: "22", colId: "Products", label: "Products", type: "RefList:1", target: "1" },
    ], rows: { category: ["Drinks", [G.List, "product"]] } },
  ] });
  const empty = (): ReferenceMirrorState => ({ generation: "g", revision: -1, tables: {
    1: { tableId: "Ref_Products", columns: { 11: "Name", 12: "Category" }, rowIds: {}, nextRowId: 1 },
    2: { tableId: "Ref_Categories", columns: { 21: "Name", 22: "Products" }, rowIds: {}, nextRowId: 1 },
  } });
  it("reserves identities before translating cyclic references and does not mutate inputs", function() {
    const initial = empty();
    const { actions, state } = reconcileReferenceSnapshot(initial, snapshot());
    assert.deepEqual(actions, [
      ["BulkAddRecord", "Ref_Products", [1], { Name: ["Tea"], Category: [1] }],
      ["BulkAddRecord", "Ref_Categories", [1], { Name: ["Drinks"], Products: [[G.List, 1]] }],
    ]);
    assert.deepEqual(initial, empty());
    assert.equal(state.revision, 1);
    assert.deepEqual(reconcileReferenceSnapshot(state, snapshot()).actions, []);
  });
  it("recalculates references when a target exits the projection and preserves identities on re-entry", function() {
    const first = reconcileReferenceSnapshot(empty(), snapshot()).state;
    const filtered = snapshot();
    filtered.revision = 2;
    filtered.tables[1].rows = {};
    const second = reconcileReferenceSnapshot(first, filtered);
    assert.deepInclude(second.actions, ["BulkUpdateRecord", "Ref_Products", [1], { Name: ["Tea"], Category: [0] }]);
    assert.deepInclude(second.actions, ["BulkRemoveRecord", "Ref_Categories", [1]]);
    const restored = snapshot();
    restored.revision = 3;
    const third = reconcileReferenceSnapshot(second.state, restored);
    assert.equal(third.state.tables["2"].rowIds.category, 1);
    assert.deepInclude(third.actions, ["BulkAddRecord", "Ref_Categories", [1], { Name: ["Drinks"],
      Products: [[G.List, 1]] }]);
  });
  it("never reuses deleted local identities for a new source record", function() {
    const first = reconcileReferenceSnapshot(empty(), snapshot()).state;
    const next = snapshot();
    next.revision = 2;
    delete next.tables[0].rows.product;
    next.tables[0].rows.replacement = ["Coffee", "category"];
    const { state, actions } = reconcileReferenceSnapshot(first, next);
    assert.equal(state.tables["1"].rowIds.replacement, 2);
    assert.equal(state.tables["1"].rowIds.product, 1);
    assert.deepInclude(actions, ["BulkRemoveRecord", "Ref_Products", [1]]);
  });
  it("accepts renames with stable column keys, but blocks incompatible schemas and generations", function() {
    const first = reconcileReferenceSnapshot(empty(), snapshot()).state;
    const next = snapshot();
    next.revision = 2;
    next.tables[0].columns[0].colId = "Renamed";
    assert.deepEqual(reconcileReferenceSnapshot(first, next).actions, []);
    next.tables[0].columns[0].type = "Int";
    assert.throws(() => reconcileReferenceSnapshot(first, next), "SCHEMA_BLOCKED");
    next.generation = "restored";
    assert.throws(() => reconcileReferenceSnapshot(first, next), "REAUTH_REQUIRED");
  });
  it("merges only deltas with the expected base cursor", function() {
    const old = snapshot();
    const delta = { ...snapshot(), revision: 2, baseRevision: 1, removed: { 1: ["product"] } };
    delta.tables[0].rows = {};
    delta.tables[1].rows = {};
    const merged = applyReferenceTransfer(old, delta);
    assert.deepEqual(merged.tables[0].rows, {});
    assert.property(merged.tables[1].rows, "category");
    assert.property(old.tables[0].rows, "product");
    assert.throws(() => applyReferenceTransfer(undefined, delta));
    assert.throws(() => applyReferenceTransfer({ ...old, revision: 0 }, delta));
  });
  it("evaluates typed filters without coercion or executable expressions", function() {
    assert.isTrue(matchesReferenceFilter(2, { colRef: 1, op: "gte", values: [2] }));
    assert.isFalse(matchesReferenceFilter("2", { colRef: 1, op: "gte", values: [2] }));
    assert.isFalse(matchesReferenceFilter(null, { colRef: 1, op: "gt", values: [0] }));
    assert.isTrue(matchesReferenceFilter(false, { colRef: 1, op: "in", values: [false] }));
    assert.throws(() => validateReferenceSpec({ name: "x", tables: [{ tableRef: 1, colRefs: [1],
      filters: [{ colRef: 1, op: "eval", values: [] }] }] }));
    assert.throws(() => validateReferenceSpec({ name: "x", tables: [{ tableRef: 1, colRefs: [1, 1], filters: [] }] }));
  });
});
