/** Run explicitly with GRIST_REFERENCE_BENCHMARK_ROWS=10000 (or a larger engine-supported value). */
import { reconcileReferenceSnapshot, ReferenceMirrorState } from "app/common/ReferenceTables";
import { ReferencePublication } from "app/gen-server/entity/ReferencePublication";
import { makeExceptionalDocSession } from "app/server/lib/DocSession";
import { initializeReferenceRevision, referenceCommit } from "app/server/lib/ReferenceDocState";
import { readReferenceProjection } from "app/server/lib/ReferenceProjection";
import { makeReferenceSession } from "app/server/lib/ReferenceTableAccess";
import { createDocTools } from "test/server/docTools";
import * as testUtils from "test/server/testUtils";

import { performance } from "perf_hooks";

import { assert } from "chai";

(process.env.GRIST_REFERENCE_BENCHMARK_ROWS ? describe : describe.skip)("ReferenceTables benchmark", function() {
  this.timeout(300_000);
  testUtils.setTmpLogLevel("error");
  const docs = createDocTools();
  it("measures initial loading and a single-row incremental update", async () => {
    const rows = Number(process.env.GRIST_REFERENCE_BENCHMARK_ROWS);
    assert.isTrue(Number.isInteger(rows) && rows > 0 && rows <= 1_000_000);
    const owner = makeExceptionalDocSession("system");
    const source = await docs.createDoc("reference-benchmark-source");
    await source.withReferenceOperation(async () => {
      await source.applyUserActions(owner, [
        ["AddTable", "Items", [{ id: "Price", type: "Numeric", isFormula: false }]],
        ["BulkAddRecord", "Items", Array.from({ length: rows }, (_, i) => i + 1),
          { Price: Array.from({ length: rows }, (_, i) => i) }],
      ]);
      const start = performance.now();
      await source.applyUserActions(makeReferenceSession(), [["PrepareReferenceSource", ["Items"]]]);
      const table = source.docData!.getMetaTable("_grist_Tables").getRecords().find(t => t.tableId === "Items")!;
      const column = source.docData!.getMetaTable("_grist_Tables_column").getRecords()
        .find(c => c.parentId === table.id && c.colId === "Price")!;
      const rev = await initializeReferenceRevision(source.docStorage, source.docName);
      const pub = Object.assign(new ReferencePublication(), { id: "benchmark", generation: rev.generation,
        identities: { [table.id]: table.referenceIdentity }, spec: { name: "Items", tables: [
          { tableRef: table.id, colRefs: [column.id], filters: [] },
        ] } });
      const first = await source.withReferenceRead(() => readReferenceProjection(source, pub));
      const dest = await docs.createDoc("reference-benchmark-destination");
      const initial: ReferenceMirrorState = { generation: first.generation, revision: -1, tables: {
        [table.id]: { tableId: "Catalog", columns: { [column.id]: "Price" }, rowIds: {}, nextRowId: 1 },
      } };
      const next = reconcileReferenceSnapshot(initial, first);
      const session = makeReferenceSession();
      referenceCommit(session, "benchmark", next.state);
      await dest.applyUserActions(session, [["CreateReferenceTables", "benchmark", [{
        key: String(table.id), tableId: "Catalog", columns: first.tables[0].columns.map(c => ({ ...c, id: c.colId })),
      }]], ...next.actions]);
      const initialMs = performance.now() - start;
      const updateStart = performance.now();
      await source.applyUserActions(owner, [["UpdateRecord", "Items", 1, { Price: -1 }]]);
      const delta = await source.withReferenceRead(() => readReferenceProjection(source, pub, first.revision));
      assert.equal(Object.keys(delta.tables[0].rows).length, 1);
      const { applyReferenceTransfer } = await import("app/common/ReferenceTables");
      const update = reconcileReferenceSnapshot(next.state, applyReferenceTransfer(first, delta));
      const updateSession = makeReferenceSession();
      referenceCommit(updateSession, "benchmark", update.state);
      await dest.applyUserActions(updateSession, update.actions);
      const updateMs = performance.now() - updateStart;
      const finalRow = await dest.fetchQuery(owner, { tableId: "Catalog", filters: { id: [1] } }, true);
      assert.deepEqual(finalRow.tableData[3].Price,
        [-1]);
      console.log(JSON.stringify({ rows, initialMs: Math.round(initialMs), updateMs: Math.round(updateMs),
        snapshotBytes: Buffer.byteLength(JSON.stringify(first)), deltaBytes: Buffer.byteLength(JSON.stringify(delta)),
        nodeRssBytes: process.memoryUsage().rss }));
    });
  });
});
