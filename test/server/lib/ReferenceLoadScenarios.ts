/** Opt-in measurements of wide publications, references, formulas, pagination and multiple destinations. */
import { applyReferenceTransfer, reconcileReferenceSnapshot, ReferenceMirrorState } from "app/common/ReferenceTables";
import { ReferencePublication } from "app/gen-server/entity/ReferencePublication";
import { makeExceptionalDocSession } from "app/server/lib/DocSession";
import { initializeReferenceRevision } from "app/server/lib/ReferenceDocState";
import { readReferenceProjection } from "app/server/lib/ReferenceProjection";
import { assembleReferenceSnapshot, readReferenceSnapshotPage,
  stageReferenceSnapshot } from "app/server/lib/ReferenceSnapshotPages";
import { makeReferenceSession } from "app/server/lib/ReferenceTableAccess";
import { createDocTools } from "test/server/docTools";
import * as testUtils from "test/server/testUtils";

import { performance } from "perf_hooks";

import { assert } from "chai";

(process.env.GRIST_REFERENCE_LOAD_SCENARIOS ? describe : describe.skip)("Reference load scenarios", function() {
  this.timeout(300_000);
  testUtils.setTmpLogLevel("error");
  const docs = createDocTools();
  for (const scenario of [
    { rows: 1000, width: 12, consumers: 1, updates: 100 },
    { rows: 10000, width: 12, consumers: 3, updates: 1000 },
  ]) {
    it(JSON.stringify(scenario), async () => {
      const owner = makeExceptionalDocSession("system");
      const source = await docs.createDoc(`load-source-${scenario.rows}`);
      const releases: (() => void)[] = [];
      const holds: Promise<void>[] = [];
      const hold = (doc: typeof source) => {
        const gate = new Promise<void>(resolve => releases.push(resolve));
        holds.push(doc.withReferenceOperation(() => gate));
      };
      hold(source);
      try {
        const names = Array.from({ length: scenario.width - 2 }, (_, i) => `Value${i}`);
        const rowIds = Array.from({ length: scenario.rows }, (_, i) => i + 1);
        await source.applyUserActions(owner, [
          ["AddTable", "Groups", [{ id: "Name", type: "Text", isFormula: false }]],
          ["AddRecord", "Groups", 1, { Name: "Group" }],
          ["AddTable", "Items", [
            ...names.map(id => ({ id, type: "Numeric", isFormula: false })),
            { id: "Group", type: "Ref:Groups", isFormula: false },
            { id: "Label", type: "Text", isFormula: false }]],
          ["BulkAddRecord", "Items", rowIds, { ...Object.fromEntries(names.map(n => [n, rowIds])),
            Group: rowIds.map(() => 1), Label: rowIds.map(i => `Item ${i} ${"text ".repeat(20)}`) }],
        ]);
        const started = performance.now();
        await source.applyUserActions(makeReferenceSession(), [["PrepareReferenceSource", ["Items", "Groups"]]]);
        const tables = source.docData!.getMetaTable("_grist_Tables").getRecords().filter(t => ["Items",
          "Groups"].includes(t.tableId));
        const columns = source.docData!.getMetaTable("_grist_Tables_column").getRecords();
        const revision = await initializeReferenceRevision(source.docStorage, source.docName);
        const pub = Object.assign(new ReferencePublication(), { id: "load", generation: revision.generation,
          identities: Object.fromEntries(tables.map(t => [t.id, t.referenceIdentity])),
          spec: { name: "Load", tables: tables.map(t => ({ tableRef: t.id, filters: [],
            colRefs: columns.filter(c => c.parentId === t.id && !c.colId.startsWith("_gristHelper") &&
              c.colId !== "manualSort")
              .map(c => c.id) })) } });
        const first = await source.withReferenceRead(() => readReferenceProjection(source, pub));
        const projectionMs = performance.now() - started;
        const transportStart = performance.now();
        const manifest = await stageReferenceSnapshot(source.docStorage, "load", "1", { ...first, contractVersion: 1 });
        const chunks: string[] = [];
        for (let page = 0; page < manifest.pages; page++) {
          chunks.push(await readReferenceSnapshotPage(source.docStorage, "load", "1", manifest.token, page));
        }
        const transported = assembleReferenceSnapshot(manifest, chunks);
        const pagingMs = performance.now() - transportStart;
        const consumers = [];
        for (let i = 0; i < scenario.consumers; i++) {
          const dest = await docs.createDoc(`load-${scenario.rows}-${i}`);
          hold(dest);
          const definitions = first.tables.map(t => ({ key: t.key, tableId: `Ref_${t.tableId}`,
            columns: t.columns.map(c => ({ ...c, id: c.colId })) }));
          const initial: ReferenceMirrorState = { generation: first.generation, revision: -1,
            tables: Object.fromEntries(definitions.map(t => [t.key, { tableId: t.tableId,
              columns: Object.fromEntries(t.columns.map(c => [c.key, c.id])), rowIds: {}, nextRowId: 1 }])) };
          const loaded = reconcileReferenceSnapshot(initial, transported);
          await dest.applyUserActions(makeReferenceSession(), [["CreateReferenceTables", "load", definitions],
            ...loaded.actions]);
          await dest.applyUserActions(owner, [["AddTable", "Totals", [
            { id: "Sum", type: "Numeric", isFormula: true, formula: "sum(Ref_Items.all.Value0)" },
            { id: "Group", type: "Text", isFormula: true, formula: "Ref_Items.lookupOne().Group.Name" }]],
          ["AddRecord", "Totals", 1, {}]]);
          consumers.push({ dest, state: loaded.state });
        }
        const initialMs = performance.now() - started;
        const updateStart = performance.now();
        await source.applyUserActions(owner, [["BulkUpdateRecord", "Items", rowIds.slice(0, scenario.updates),
          { Value0: Array(scenario.updates).fill(-1) }]]);
        const delta = await source.withReferenceRead(() => readReferenceProjection(source, pub, first.revision));
        const next = applyReferenceTransfer(first, delta);
        for (const { dest, state } of consumers) {
          const update = reconcileReferenceSnapshot(state, next);
          await dest.applyUserActions(makeReferenceSession(), update.actions);
          const totals = (await dest.fetchTable(owner, "Totals", true)).tableData[3];
          assert.equal(totals.Sum[0], scenario.rows * (scenario.rows + 1) / 2 -
          scenario.updates * (scenario.updates + 1) / 2 - scenario.updates);
          assert.equal(totals.Group[0], "Group");
        }
        const updateMs = performance.now() - updateStart;
        console.log(JSON.stringify({ scenario, projectionMs: Math.round(projectionMs), pagingMs: Math.round(pagingMs),
          initialMs: Math.round(initialMs), updateMs: Math.round(updateMs), pages: manifest.pages,
          snapshotBytes: manifest.bytes, deltaBytes: Buffer.byteLength(JSON.stringify(delta)),
          nodeRssEndBytes: process.memoryUsage().rss, scope: "local engines and SQLite pages; no HTTP or scheduler" }));
      } finally {
        releases.forEach(release => release());
        await Promise.all(holds);
      }
    });
  }
});
