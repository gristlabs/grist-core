import { applyReferenceTransfer, reconcileReferenceSnapshot, ReferenceMirrorState,
  ReferenceSnapshot } from "app/common/ReferenceTables";
import { ReferencePublication } from "app/gen-server/entity/ReferencePublication";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { makeExceptionalDocSession } from "app/server/lib/DocSession";
import { getReferenceState, initializeReferenceRevision, referenceCommit } from "app/server/lib/ReferenceDocState";
import { readReferenceProjection } from "app/server/lib/ReferenceProjection";
import { makeReferenceSession } from "app/server/lib/ReferenceTableAccess";
import { createDocTools } from "test/server/docTools";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";
import sinon from "sinon";
describe("Reference table integration", function() {
  this.timeout(30_000);
  testUtils.setTmpLogLevel("error");
  const docs = createDocTools();
  const owner = makeExceptionalDocSession("system");
  async function source() {
    const doc = await docs.createDoc("reference-source");
    await doc.applyUserActions(owner, [
      ["AddTable", "Categories", [{ id: "Name", type: "Text", isFormula: false }]],
      ["AddTable", "Products", [
        { id: "Name", type: "Text", isFormula: false },
        { id: "Price", type: "Numeric", isFormula: false },
        { id: "Active", type: "Bool", isFormula: false },
        { id: "Category", type: "Ref:Categories", isFormula: false },
        { id: "Double", type: "Numeric", isFormula: true, formula: "$Price * 2" },
        { id: "Private", type: "Text", isFormula: false },
        { id: "Display", type: "Text", isFormula: true, formula: "$Category.Name + ' ' + $Name" },
      ]],
      ["AddRecord", "Categories", 1, { Name: "Drinks" }],
      ["AddRecord", "Products", 1, { Name: "Tea", Price: 3, Active: true, Category: 1, Private: "secret" }],
      ["AddRecord", "Products", 2, { Name: "Hidden", Price: 8, Active: false, Category: 1, Private: "other-secret" }],
    ]);
    await doc.applyUserActions(makeReferenceSession(), [["PrepareReferenceSource", ["Products", "Categories"]]]);
    const rev = await doc.withReferenceRead(() => initializeReferenceRevision(doc.docStorage, doc.docName));
    const tables = doc.docData!.getMetaTable("_grist_Tables").getRecords();
    const columns = doc.docData!.getMetaTable("_grist_Tables_column").getRecords();
    const pub = Object.assign(new ReferencePublication(), { id: "pub", sourceDocId: doc.docName,
      sourceOrgId: 1, generation: rev.generation, paused: false,
      identities: Object.fromEntries(tables.map(t => [String(t.id), t.referenceIdentity])), spec: {
        name: "Products", tables: ["Products", "Categories"].map((name) => {
          const tableRef = tables.find(t => t.tableId === name)!.id;
          const cols = columns.filter(c => c.parentId === tableRef);
          return { tableRef, colRefs: cols.filter(c => ["Name", "Price", "Category",
            "Double", "Display"].includes(c.colId)).map(c => c.id),
          filters: name === "Products" ? [{ colRef: cols.find(c => c.colId === "Active")!.id, op: "in",
            values: [true] }] : [] };
        }),
      } });
    return { doc, pub };
  }
  async function read(doc: ActiveDoc, pub: ReferencePublication, since?: number) {
    return doc.withReferenceRead(() => readReferenceProjection(doc, pub, since));
  }
  async function mirror(doc: ActiveDoc, snapshot: ReferenceSnapshot) {
    const result = await doc.applyUserActions(makeReferenceSession(), [["CreateReferenceTables", "sub",
      snapshot.tables.map(t => ({ key: t.key, tableId: `Ref_${t.tableId}`,
        columns: t.columns.map(c => ({ ...c, id: c.colId })) }))]]);
    return { generation: snapshot.generation, revision: -1, tables: result.retValues[0] } as ReferenceMirrorState;
  }
  async function apply(doc: ActiveDoc, state: ReferenceMirrorState, snapshot: ReferenceSnapshot) {
    const next = reconcileReferenceSnapshot(state, snapshot);
    const session = makeReferenceSession();
    referenceCommit(session, "test-cursor", next.state);
    await doc.applyUserActions(session, next.actions.length ? next.actions : [["Calculate"]]);
    assert.deepEqual(await getReferenceState(doc.docStorage, "test-cursor"), next.state);
    return next.state;
  }
  it("filters rows, translates relations, recalculates formulas and replays incremental changes", async () => {
    const { doc: src, pub } = await source();
    const dest = await docs.createDoc("reference-destination");
    const initial = await read(src, pub);
    assert.notInclude(JSON.stringify(initial), "secret");
    assert.notInclude(JSON.stringify(initial), "Hidden");
    let state = await apply(dest, await mirror(dest, initial), initial);
    await dest.applyUserActions(owner, [
      ["AddTable", "Orders", [
        { id: "Product", type: "Ref:Ref_Products", isFormula: false },
        { id: "Total", type: "Numeric", isFormula: true, formula: "$Product.Price * 10" },
      ]],
      ["AddRecord", "Orders", 1, { Product: 1 }],
    ]);
    assert.equal((await dest.fetchTable(owner, "Orders", true)).tableData[3].Total[0], 30);
    await src.applyUserActions(owner, [["UpdateRecord", "Products", 1, { Price: 7 }]]);
    const transfer = await read(src, pub, state.revision);
    assert.equal(transfer.baseRevision, state.revision);
    const updated = applyReferenceTransfer(state.snapshot, transfer);
    state = await apply(dest, state, updated);
    assert.equal((await dest.fetchTable(owner, "Orders", true)).tableData[3].Total[0], 70);
    assert.equal((await dest.fetchTable(owner, "Ref_Products", true)).tableData[3].Double[0], 14);
    await src.applyUserActions(owner, [["UpdateRecord", "Categories", 1, { Name: "Hot drinks" }]]);
    state = await apply(dest, state, applyReferenceTransfer(state.snapshot, await read(src, pub, state.revision)));
    assert.deepEqual((await dest.fetchTable(owner, "Ref_Products", true)).tableData[3].Display, ["Hot drinks Tea"]);
    await src.applyUserActions(owner, [["UpdateRecord", "Products", 1, { Active: false }]]);
    const filtered = applyReferenceTransfer(state.snapshot, await read(src, pub, state.revision));
    state = await apply(dest, state, filtered);
    assert.deepEqual((await dest.fetchTable(owner, "Ref_Products", true)).tableData[2], []);
    await src.applyUserActions(owner, [["UpdateRecord", "Products", 1, { Active: true }]]);
    await apply(dest, state, applyReferenceTransfer(state.snapshot, await read(src, pub, state.revision)));
    assert.deepEqual((await dest.fetchTable(owner, "Ref_Products", true)).tableData[2], [1]);
  });
  it("rejects direct, nested and metadata writes to mirrors even for document owners", async () => {
    const { doc: src, pub } = await source();
    const dest = await docs.createDoc("reference-protected");
    const initial = await read(src, pub);
    await apply(dest, await mirror(dest, initial), initial);
    const table = dest.docData!.getMetaTable("_grist_Tables").getRecords().find(t => t.tableId === "Ref_Products")!;
    for (const actions of [
      [["UpdateRecord", "Ref_Products", 1, { Price: 999 }]],
      [["ApplyDocActions", [["RemoveRecord", "Ref_Products", 1]]]],
      [["UpdateRecord", "_grist_Tables", table.id, { referenceSource: "" }]],
      [["RemoveTable", "Ref_Products"]],
    ]) {
      await assert.isRejected(dest.applyUserActions(owner, actions), /read-only/);
    }
    assert.equal((await dest.fetchTable(owner, "Ref_Products", true)).tableData[3].Price[0], 3);
  });
  it("does not reuse source identities after deleting and reusing a row number", async () => {
    const { doc, pub } = await source();
    const initial = await read(doc, pub);
    const product = initial.tables.find(t => t.tableId === "Products")!;
    const oldId = Object.keys(product.rows)[0];
    await doc.applyUserActions(owner, [["RemoveRecord", "Products", 1],
      ["AddRecord", "Products", 1, { Name: "New", Price: 5, Active: true }]]);
    const next = await read(doc, pub);
    assert.notProperty(next.tables.find(t => t.key === product.key)!.rows, oldId);
    assert.lengthOf(Object.keys(next.tables.find(t => t.key === product.key)!.rows), 1);
  });
  it("restores the same source identity through verified undo and blocks forged identity writes", async () => {
    const { doc, pub } = await source();
    const initial = await read(doc, pub);
    const products = doc.docData!.getMetaTable("_grist_Tables").getRecords().find(t => t.tableId === "Products")!;
    const identity = products.referenceIdentity;
    await assert.isRejected(doc.applyUserActions(owner, [["UpdateRecord", "Products", 1, { [identity]: "forged" }]]),
      /read-only/);
    const removed = await doc.applyUserActions(owner, [["RemoveRecord", "Products", 1]]);
    await doc.applyUserActionsById(owner, [removed.actionNum], [removed.actionHash!], true);
    const restored = await read(doc, pub);
    assert.deepEqual(Object.keys(restored.tables[0].rows), Object.keys(initial.tables[0].rows));
    const removedTable = await doc.applyUserActions(owner, [["RemoveTable", "Products"]]);
    await assert.isRejected(read(doc, pub), /SCHEMA_BLOCKED/);
    await doc.applyUserActionsById(owner, [removedTable.actionNum], [removedTable.actionHash!], true);
    // Undo restores UUIDs, but a removed schema requires explicit republication, even if row refs were reused.
    await assert.isRejected(read(doc, pub), /SCHEMA_BLOCKED/);
    assert.deepEqual((await doc.fetchTable(owner, "Products", true)).tableData[3][identity].slice(0, 1),
      Object.keys(initial.tables[0].rows));
  });
  it("repairs formulas referencing a not-yet-connected table and keeps their future dependencies", async () => {
    const { doc: src, pub } = await source();
    const snapshot = await read(src, pub);
    const dest = await docs.createDoc("reference-existing-formula");
    await dest.applyUserActions(owner, [
      ["AddTable", "Totals", [
        { id: "Total", type: "Numeric", isFormula: true, formula: "sum(Ref_Products.all.Price)" },
        { id: "Unrelated", type: "Any", isFormula: true, formula: "MissingElsewhere.lookupOne()" },
      ]], ["AddRecord", "Totals", 1, {}],
    ]);
    assert.include(JSON.stringify((await dest.fetchTable(owner, "Totals", true)).tableData[3].Total), "NameError");
    const state = await mirror(dest, snapshot);
    const populated = await apply(dest, state, snapshot);
    assert.deepEqual((await dest.fetchTable(owner, "Totals", true)).tableData[3].Total, [3]);
    assert.include(JSON.stringify((await dest.fetchTable(owner, "Totals", true)).tableData[3].Unrelated), "NameError");
    await src.applyUserActions(owner, [["UpdateRecord", "Products", 1, { Price: 7 }]]);
    await apply(dest, populated, await read(src, pub));
    assert.deepEqual((await dest.fetchTable(owner, "Totals", true)).tableData[3].Total, [7]);
  });

  it("checks authorization after waiting in the action queue, before changing any mirror", async () => {
    const { doc: src, pub } = await source();
    const snapshot = await read(src, pub);
    const dest = await docs.createDoc("reference-denied-commit");
    const state = await mirror(dest, snapshot);
    const next = reconcileReferenceSnapshot(state, snapshot);
    const session = makeReferenceSession();
    referenceCommit(session, "denied", next.state, async () => { throw new Error("ACCESS_REVOKED"); });
    await assert.isRejected(dest.applyUserActions(session, next.actions), /ACCESS_REVOKED/);
    assert.isUndefined(await getReferenceState(dest.docStorage, "denied"));
    assert.isEmpty((await dest.fetchTable(owner, "Ref_Products", true)).tableData[2]);
    let checks = 0;
    referenceCommit(session, "denied", next.state, async () => {
      if (++checks === 2) { throw new Error("ACCESS_REVOKED"); }
    });
    await assert.isRejected(dest.applyUserActions(session, next.actions), /ACCESS_REVOKED/);
    assert.isUndefined(await getReferenceState(dest.docStorage, "denied"));
    assert.isEmpty((await dest.fetchTable(owner, "Ref_Products", true)).tableData[2]);
  });

  it("discards Python results when the final commit authorization fails", async () => {
    const { doc: src, pub } = await source();
    const snapshot = await read(src, pub);
    const dest = await docs.createDoc("reference-denied-final-commit");
    const state = await mirror(dest, snapshot);
    const next = reconcileReferenceSnapshot(state, snapshot);
    const session = makeReferenceSession();
    let checks = 0;
    referenceCommit(session, "denied-final", next.state, async () => { checks++; }, async () => {
      assert.equal(checks, 2); // Both earlier checks passed; Python already processed the update.
      throw new Error("ACCESS_REVOKED");
    });
    await assert.isRejected(dest.applyUserActions(session, next.actions), /ACCESS_REVOKED/);
    await dest.shutdown();
    const reopened = await docs.loadDoc(dest.docName);
    assert.isUndefined(await getReferenceState(reopened.docStorage, "denied-final"));
    assert.isEmpty((await reopened.fetchTable(owner, "Ref_Products", true)).tableData[2]);
    await apply(reopened, state, snapshot);
    assert.deepEqual((await reopened.fetchTable(owner, "Ref_Products", true)).tableData[3].Price, [3]);
  });

  it("reloads the committed state after a failed cursor write without exposing partial records", async () => {
    const { doc: src, pub } = await source();
    const snapshot = await read(src, pub);
    const dest = await docs.createDoc("reference-storage-failure");
    const state = await mirror(dest, snapshot);
    const next = reconcileReferenceSnapshot(state, snapshot);
    const session = makeReferenceSession();
    referenceCommit(session, "broken-cursor", next.state);
    const run = dest.docStorage.run.bind(dest.docStorage);
    const stub = sinon.stub(dest.docStorage, "run").callsFake(async (...args) => {
      if (args[0].includes("INSERT OR REPLACE INTO _gristsys_ReferenceState")) {
        throw new Error("injected cursor failure");
      }
      return run(...args);
    });
    await assert.isRejected(dest.applyUserActions(session, next.actions), /injected cursor failure/);
    stub.restore();
    await dest.shutdown();
    const reopened = await docs.loadDoc(dest.docName);
    assert.isUndefined(await getReferenceState(reopened.docStorage, "broken-cursor"));
    assert.isEmpty((await reopened.fetchTable(owner, "Ref_Products", true)).tableData[2]);
    await apply(reopened, state, snapshot);
    assert.deepEqual((await reopened.fetchTable(owner, "Ref_Products", true)).tableData[3].Price, [3]);
  });

  it("does not bind a deleted and recreated column to an existing publication", async () => {
    const { doc, pub } = await source();
    await read(doc, pub);
    await doc.applyUserActions(owner, [["RemoveColumn", "Products", "Display"],
      ["AddColumn", "Products", "Display", { type: "Text", isFormula: false }]]);
    await assert.isRejected(read(doc, pub), /SCHEMA_BLOCKED/);
  });
});
