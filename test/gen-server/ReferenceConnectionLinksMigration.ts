import { ReferenceTables1790400000000 } from "app/gen-server/migration/1790400000000-ReferenceTables";
import { ReferenceConnectionLinks1790486400000 } from "app/gen-server/migration/1790486400000-ReferenceConnectionLinks";
import {
  ReferenceConsumerControls1790572800000,
} from "app/gen-server/migration/1790572800000-ReferenceConsumerControls";
import { ReferenceContracts1790576400000 } from "app/gen-server/migration/1790576400000-ReferenceContracts";
import { ReferenceManagement1790580000000 } from "app/gen-server/migration/1790580000000-ReferenceManagement";
import { ReferenceSynchronization1790583600000 } from "app/gen-server/migration/1790583600000-ReferenceSynchronization";
import { ReferenceAuditSigning1790587200000 } from "app/gen-server/migration/1790587200000-ReferenceAuditSigning";

import { assert } from "chai";
import { DataSource } from "typeorm";

describe("Reference connection links migration", function() {
  it("adds and removes the server signing key table without changing existing audit events", async () => {
    const db = await new DataSource({ type: "sqlite", database: ":memory:" }).initialize();
    const runner = db.createQueryRunner();
    try {
      await new ReferenceTables1790400000000().up(runner);
      await new ReferenceSynchronization1790583600000().up(runner);
      await runner.query("INSERT INTO reference_audit_events VALUES ('event', 'doc', '2026-09-27', 1, 'test', '{}')");
      const before = await runner.query("SELECT * FROM reference_audit_events");
      const migration = new ReferenceAuditSigning1790587200000();
      await migration.up(runner);
      assert.isEmpty(await runner.query("SELECT * FROM reference_audit_keys"));
      await migration.down(runner);
      assert.deepEqual(await runner.query("SELECT * FROM reference_audit_events"), before);
    } finally { await runner.release(); await db.destroy(); }
  });
  it("defaults existing subscriptions to live mode and rolls synchronization fields back", async () => {
    const db = await new DataSource({ type: "sqlite", database: ":memory:" }).initialize();
    const runner = db.createQueryRunner();
    try {
      await new ReferenceTables1790400000000().up(runner);
      await runner.query(`INSERT INTO reference_subscriptions
        (id, publication_id, destination_doc_id, destination_org_id, status, aliases)
        VALUES ('existing', 'pub', 'doc', 1, 'UP_TO_DATE', '{}')`);
      const before = await runner.query("SELECT * FROM reference_subscriptions");
      const migration = new ReferenceSynchronization1790583600000();
      await migration.up(runner);
      assert.deepEqual(await runner.query("SELECT * FROM reference_subscriptions"), before.map((row: object) => ({
        ...row, sync_mode: "live", sync_interval_minutes: 60, next_sync_at: "",
      })));
      assert.deepEqual(await runner.query("SELECT * FROM reference_audit_events"), []);
      await migration.down(runner);
      assert.deepEqual(await runner.query("SELECT * FROM reference_subscriptions"), before);
    } finally {
      await runner.release();
      await db.destroy();
    }
  });
  it("preserves existing grants and revocations without issuing links, including rollback", async () => {
    const db = await new DataSource({ type: "sqlite", database: ":memory:" }).initialize();
    const runner = db.createQueryRunner();
    try {
      await new ReferenceTables1790400000000().up(runner);
      for (const [id, status, revoked] of [["active", "UP_TO_DATE", false], ["revoked", "ACCESS_REVOKED", true]]) {
        await runner.query(`INSERT INTO reference_subscriptions
          (id, publication_id, destination_doc_id, destination_org_id, status, aliases, revoked)
          VALUES (?, 'publication', ?, 1, ?, '{}', ?)`, [id, id, status, revoked]);
      }
      const before = await runner.query("SELECT * FROM reference_subscriptions ORDER BY id");
      const migration = new ReferenceConnectionLinks1790486400000();
      await migration.up(runner);
      assert.deepEqual(await runner.query("SELECT * FROM reference_connection_links"), []);
      const after = await runner.query("SELECT * FROM reference_subscriptions ORDER BY id");
      assert.deepEqual(after, before.map((row: object) => ({
        ...row, connection_link_id: "", connected_at: "", checked_at: "",
      })));
      await migration.down(runner);
      assert.deepEqual(await runner.query("SELECT * FROM reference_subscriptions ORDER BY id"), before);
    } finally {
      await runner.release();
      await db.destroy();
    }
  });
  it("adds consumer controls to existing subscriptions without altering their state", async () => {
    const db = await new DataSource({ type: "sqlite", database: ":memory:" }).initialize();
    const runner = db.createQueryRunner();
    try {
      await new ReferenceTables1790400000000().up(runner);
      await new ReferenceConnectionLinks1790486400000().up(runner);
      await runner.query(`INSERT INTO reference_subscriptions
        (id, publication_id, destination_doc_id, destination_org_id, status, aliases, revoked, connected_at)
        VALUES ('existing', 'publication', 'document', 1, 'ACCESS_REVOKED', '{}', 1, '2026-09-26')`);
      const before = await runner.query("SELECT * FROM reference_subscriptions");
      const migration = new ReferenceConsumerControls1790572800000();
      await migration.up(runner);
      assert.deepEqual(await runner.query("SELECT * FROM reference_subscriptions"), before.map((row: object) => ({
        ...row, source_paused: 0, destination_paused: 0, authorization_version: 0,
      })));
      await migration.down(runner);
      assert.deepEqual(await runner.query("SELECT * FROM reference_subscriptions"), before);
    } finally {
      await runner.release();
      await db.destroy();
    }
  });
  it("preserves accepted contracts on upgrade and leaves new grants pending", async () => {
    const db = await new DataSource({ type: "sqlite", database: ":memory:" }).initialize();
    const runner = db.createQueryRunner();
    try {
      await new ReferenceTables1790400000000().up(runner);
      await new ReferenceConnectionLinks1790486400000().up(runner);
      await new ReferenceConsumerControls1790572800000().up(runner);
      const states = [
        ["active", "UP_TO_DATE", "2026-09-26", 1, 1],
        ["initial", "INITIALIZING", "", 1, 0],
        ["revoked", "ACCESS_REVOKED", "2026-09-26", 1, 1],
        ["pending", "AUTHORIZED", "", 0, 0],
        ["reauthorized", "AUTHORIZED", "2026-09-26", 1, 1],
      ];
      for (const [id, status, appliedAt] of states) {
        await runner.query(`INSERT INTO reference_subscriptions
          (id, publication_id, destination_doc_id, destination_org_id, status, aliases, revoked, applied_at)
          VALUES (?, 'publication', ?, 1, ?, '{}', 0, ?)`, [id, id, status, appliedAt]);
      }
      const before = await runner.query("SELECT * FROM reference_subscriptions ORDER BY id");
      const migration = new ReferenceContracts1790576400000();
      await migration.up(runner);
      for (const [id, , , accepted, applied] of states) {
        const [row] = await runner.query("SELECT * FROM reference_subscriptions WHERE id = ?", [id]);
        assert.equal(row.accepted_contract_version, accepted);
        assert.equal(row.applied_contract_version, applied);
      }
      await migration.down(runner);
      assert.deepEqual(await runner.query("SELECT * FROM reference_subscriptions ORDER BY id"), before);
    } finally {
      await runner.release();
      await db.destroy();
    }
  });
  it("backfills only known accepted contracts and rolls management fields back without losing state", async () => {
    const db = await new DataSource({ type: "sqlite", database: ":memory:" }).initialize();
    const runner = db.createQueryRunner();
    try {
      await new ReferenceTables1790400000000().up(runner);
      await new ReferenceConnectionLinks1790486400000().up(runner);
      await new ReferenceConsumerControls1790572800000().up(runner);
      await new ReferenceContracts1790576400000().up(runner);
      const spec = JSON.stringify({ name: "Published", tables: [{ tableRef: 1, colRefs: [1], filters: [] }] });
      await runner.query(`INSERT INTO reference_publications
        (id, source_doc_id, source_org_id, spec, identities, "columnEpochs", generation, contract_version)
        VALUES ('pub', 'source', 1, ?, '{}', '{}', 'generation', 2)`, [spec]);
      for (const [id, accepted] of [["known", 2], ["unknown", 1], ["pending", 0]]) {
        await runner.query(`INSERT INTO reference_subscriptions
          (id, publication_id, destination_doc_id, destination_org_id, status, aliases, accepted_contract_version)
          VALUES (?, 'pub', ?, 1, 'UP_TO_DATE', '{}', ?)`, [id, id, accepted]);
      }
      const before = await runner.query("SELECT * FROM reference_subscriptions ORDER BY id");
      const migration = new ReferenceManagement1790580000000();
      await migration.up(runner);
      const after = await runner.query("SELECT id, accepted_contract FROM reference_subscriptions ORDER BY id");
      assert.deepEqual(after, [{ id: "known", accepted_contract: spec }, { id: "pending", accepted_contract: null },
        { id: "unknown", accepted_contract: null }]);
      await migration.down(runner);
      assert.deepEqual(await runner.query("SELECT * FROM reference_subscriptions ORDER BY id"), before);
    } finally {
      await runner.release();
      await db.destroy();
    }
  });
});
