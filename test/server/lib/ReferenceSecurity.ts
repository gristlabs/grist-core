import { ReferenceAuditEvent } from "app/gen-server/entity/ReferenceAuditEvent";
import { ReferenceAuditKey } from "app/gen-server/entity/ReferenceAuditKey";
import { getCreate } from "app/server/lib/create";
import { makeExceptionalDocSession } from "app/server/lib/DocSession";
import { ISandbox } from "app/server/lib/ISandbox";
import { flushReferenceAudit, ReferenceAuditRecord, signReferenceAudit } from "app/server/lib/ReferenceAuditOutbox";
import { getReferenceState, referenceCommit, setReferenceState } from "app/server/lib/ReferenceDocState";
import { previewReferenceFormulas } from "app/server/lib/ReferenceFormulaPreview";
import { assertReferenceSize, ReferenceWorkLimiter } from "app/server/lib/ReferenceLimits";
import { ReferenceSnapshotManifest, validateReferenceManifest } from "app/server/lib/ReferenceSnapshotPages";
import { makeReferenceSession } from "app/server/lib/ReferenceTableAccess";
import { createDocTools } from "test/server/docTools";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";
import sinon from "sinon";
import { DataSource } from "typeorm";

describe("Reference security", function() {
  this.timeout(30_000);
  testUtils.setTmpLogLevel("error");
  const docs = createDocTools();
  const owner = makeExceptionalDocSession("system");

  it("does not let preview formulas mutate Python modules in the live sandbox", async () => {
    const doc = await docs.createDoc("preview-process-isolation");
    await doc.applyUserActions(owner, [["AddTable", "Items", [
      { id: "Price", type: "Numeric", isFormula: false },
      { id: "Poison", type: "Numeric", isFormula: true,
        formula: "import math\nif $Price == 99:\n  math.preview_poison = True\nreturn $Price" },
      { id: "Check", type: "Bool", isFormula: true,
        formula: "import math\nreturn hasattr(math, 'preview_poison') or $Price == 0" }]],
    ["AddRecord", "Items", 1, { Price: 5 }]]);
    const preview = await doc.withReferenceRead(() => doc.previewReferenceActions([
      ["UpdateRecord", "Items", 1, { Price: 99 }],
    ]));
    assert.isAbove(preview.changed, 0);
    await doc.applyUserActions(owner, [["UpdateRecord", "Items", 1, { Price: 6 }]]);
    const rows = (await doc.fetchTable(owner, "Items", true)).tableData[3];
    assert.deepEqual(rows.Price, [6]);
    assert.deepEqual(rows.Check, [false]);
  });

  it("stops the disposable sandbox on timeout and excessive memory, releasing capacity", async () => {
    const doc = await docs.createDoc("preview-budgets");
    for (const mode of ["timeout", "memory"]) {
      const shutdown = sinon.stub().resolves();
      const sandbox = { pyCall: () => new Promise(() => {}), shutdown,
        reportMemoryUsage: async () => mode === "memory" ? 2048 : 0 } as unknown as ISandbox;
      await assert.isRejected(previewReferenceFormulas(doc.docStorage, [], () => sandbox,
        { timeoutMs: 100, memoryBytes: 1024, pollMs: 5 }), /REFERENCE_PREVIEW_(TIMEOUT|MEMORY_LIMIT)/);
      assert.equal(shutdown.callCount, 1);
    }
    const limiter = new ReferenceWorkLimiter(1);
    let release!: () => void;
    const work = limiter.run("first", () => new Promise<void>((resolve) => { release = resolve; }));
    await assert.isRejected(limiter.run("second", async () => undefined), /REFERENCE_BUSY/);
    release();
    await work;
    await assert.isRejected(limiter.run("failure", async () => { throw new Error("failed"); }), /failed/);
    await limiter.run("again", async () => undefined);
    const shared = new ReferenceWorkLimiter(4, 1);
    const oneUser = shared.run("first", () => new Promise<void>((resolve) => { release = resolve; }), "alice");
    await assert.isRejected(shared.run("second", async () => undefined, "alice"), /REFERENCE_BUSY/);
    await shared.run("other", async () => undefined, "bob");
    release();
    await oneUser;
    await shared.run("again", async () => undefined, "alice");
  });

  it("kills a real infinite preview calculation while keeping the live document usable", async () => {
    const doc = await docs.createDoc("preview-kill");
    await doc.applyUserActions(owner, [["AddTable", "Items", [
      { id: "Price", type: "Numeric", isFormula: false },
      { id: "Value", type: "Numeric", isFormula: true,
        formula: "if $Price == 99:\n  while True:\n    pass\nreturn $Price" }]],
    ["AddRecord", "Items", 1, { Price: 5 }]]);
    let sandbox: ISandbox | undefined;
    await assert.isRejected(doc.withReferenceRead(() => previewReferenceFormulas(doc.docStorage,
      [["UpdateRecord", "Items", 1, { Price: 99 }]], () => {
        sandbox = getCreate().NSandbox({ preferredPythonVersion: "3", sandboxOptions: { exports: {} } });
        return sandbox;
      }, { timeoutMs: 1500, memoryBytes: 512 * 1024 * 1024, pollMs: 100 })), /REFERENCE_PREVIEW_TIMEOUT/);
    assert.isTrue(sandbox!.isProcessDown());
    await doc.applyUserActions(owner, [["UpdateRecord", "Items", 1, { Price: 6 }]]);
    assert.deepEqual((await doc.fetchTable(owner, "Items", true)).tableData[3].Value, [6]);
  });

  it("rejects oversized values and hostile manifests before page assembly", () => {
    assert.throws(() => assertReferenceSize({ text: "x".repeat(100) }, 100), /REFERENCE_SIZE_LIMIT/);
    for (const values of [{ bytes: 33 * 1024 * 1024, pages: 1 }, { bytes: 1, pages: Infinity },
      { bytes: 1, pages: 1000000 }, { bytes: -1, pages: 1 }]) {
      assert.throws(() => validateReferenceManifest(values as ReferenceSnapshotManifest), /REFERENCE_SIZE_LIMIT/);
    }
  });

  it("commits audit with document data and retries delivery without duplicates after an acknowledgement failure",
    async () => {
      const doc = await docs.createDoc("audit-outbox");
      const db = await new DataSource({ type: "sqlite", database: ":memory:",
        entities: [ReferenceAuditEvent, ReferenceAuditKey], synchronize: true }).initialize();
      await db.query("CREATE TABLE reference_registry_lock (id INTEGER PRIMARY KEY)");
      await db.query("INSERT INTO reference_registry_lock VALUES (1)");
      const event: ReferenceAuditRecord = { id: "audit-one", documentId: doc.docName, actorId: 1,
        createdAt: new Date().toISOString(), operation: "subscription.synchronized", details: {} };
      try {
        await doc.applyUserActions(owner, [["AddTable", "Table1", []]]);
        const session = makeReferenceSession();
        referenceCommit(session, "mirror:test", { revision: 1 }, undefined, undefined,
          await signReferenceAudit(db, event));
        await doc.applyUserActions(session, [["AddRecord", "Table1", 1, {}]]);
        assert.equal((await getReferenceState<ReferenceAuditRecord>(doc.docStorage, "audit:audit-one"))?.id, event.id);
        const run = doc.docStorage.run.bind(doc.docStorage);
        const failAck = sinon.stub(doc.docStorage, "run").callsFake(async (sql, ...params) => {
          if (sql.startsWith("DELETE FROM _gristsys_ReferenceState")) { throw new Error("ack failed"); }
          return run(sql, ...params);
        });
        await assert.isRejected(flushReferenceAudit(doc.docStorage, doc.docName, db), /ack failed/);
        failAck.restore();
        assert.equal(await db.manager.count(ReferenceAuditEvent), 1);
        await flushReferenceAudit(doc.docStorage, doc.docName, db);
        assert.equal(await db.manager.count(ReferenceAuditEvent), 1);
        assert.isUndefined(await getReferenceState(doc.docStorage, "audit:audit-one"));
        // A copied document must never publish a foreign document's retained outbox.
        await setReferenceState(doc.docStorage, "audit:copied", { ...event, id: "copied", documentId: "other-doc" });
        await flushReferenceAudit(doc.docStorage, doc.docName, db);
        assert.equal(await db.manager.count(ReferenceAuditEvent), 1);
        await setReferenceState(doc.docStorage, "audit:forged", { ...event, id: "forged" });
        await assert.isRejected(flushReferenceAudit(doc.docStorage, doc.docName, db), /REFERENCE_AUDIT_INVALID/);
        assert.equal(await db.manager.count(ReferenceAuditEvent), 1);
        await doc.docStorage.run("DELETE FROM _gristsys_ReferenceState WHERE key = ?", "audit:forged");
        const rejected = makeReferenceSession();
        referenceCommit(rejected, "mirror:test", { revision: 2 }, undefined, undefined, { ...event, id: "rejected" });
        const failWrite = sinon.stub(doc.docStorage, "run").callsFake(async (sql, ...params) => {
          if (params[0] === "audit:rejected") { throw new Error("audit write failed"); }
          return run(sql, ...params);
        });
        await assert.isRejected(doc.applyUserActions(rejected, [["AddRecord", "Table1", 2, {}]]), /audit write failed/);
        failWrite.restore();
        await doc.shutdown();
        const reopened = await docs.loadDoc(doc.docName);
        assert.deepEqual((await reopened.fetchTable(owner, "Table1", true)).tableData[2], [1]);
        assert.deepEqual(await getReferenceState(reopened.docStorage, "mirror:test"), { revision: 1 });
        assert.isUndefined(await getReferenceState(reopened.docStorage, "audit:rejected"));
      } finally { sinon.restore(); await db.destroy(); }
    });
});
