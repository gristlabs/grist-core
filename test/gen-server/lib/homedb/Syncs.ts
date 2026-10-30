import { TEAM_PLAN } from "app/common/Features";
import { SyncHomeConfig } from "app/gen-server/entity/Sync";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { TestServer } from "test/gen-server/apiUtils";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";

import type { SyncStatus } from "app/common/ActiveDocAPI";

const STATUS_1: SyncStatus = { lastSyncSourceHash: "h1", lastSyncedAtMs: 1000 };
const STATUS_2: SyncStatus = { lastSyncSourceHash: "h2", lastSyncedAtMs: 2000 };
const OPTIONS_1: SyncHomeConfig = { authorizedTableIds: ["Alpha"] };
const OPTIONS_2: SyncHomeConfig = { authorizedTableIds: ["Beta", "Gamma"] };

/**
 * Tests the home db's record of document syncs: the source binding, owner and table set that
 * live only here, and the UPDATE-only reconciliation that keeps the record in step with a
 * document's own `_grist_Syncs`.
 */
describe("Syncs", function() {
  let server: TestServer;
  let home: HomeDBManager;
  let chimpyId: number;
  let wsId: number;
  let docCount = 0;

  testUtils.setTmpLogLevel("error");
  this.timeout("30s");

  before(async function() {
    server = new TestServer(this);
    await server.start(["home"]);
    home = server.dbManager;
    const chimpy = await home.getUserByLogin("chimpy@getgrist.com");
    chimpyId = chimpy.id;
    await home.addOrg(chimpy, { name: "syncs", domain: "syncs" }, {
      setUserAsOwner: false, useNewPlan: true, product: TEAM_PLAN,
    });
    wsId = home.unwrapQueryResult(
      await home.getOrgWorkspaces({ userId: chimpyId }, "syncs"),
    )[0].id;
  });

  after(async function() {
    await server.stop();
  });

  async function makeDoc(): Promise<string> {
    const name = `doc${++docCount}`;
    return home.unwrapQueryResult(await home.addDocument({ userId: chimpyId }, wsId, { name })).id;
  }

  async function makeUser(name: string) {
    return home.getUserByLogin(`${name}@getgrist.com`, {
      profile: { email: `${name}@getgrist.com`, name },
    });
  }

  function addSync(destDocId: string, syncId: string, options: {
    sourceDocId?: string | null, ownerId?: number | null, options?: SyncHomeConfig, status?: SyncStatus,
  } = {}) {
    return home.createOrRepairSync({
      destDocId,
      syncId,
      sourceDocId: options.sourceDocId ?? null,
      ownerId: options.ownerId ?? chimpyId,
      options: options.options ?? OPTIONS_1,
      status: options.status ?? STATUS_1,
    });
  }

  it("creates a sync, repairs it on conflict, reads it back and deletes it", async function() {
    const [destDocId, otherDestDocId, source1, source2] =
      await Promise.all([makeDoc(), makeDoc(), makeDoc(), makeDoc()]);
    const other = await makeUser("syncowner1");
    await addSync(destDocId, "s", { sourceDocId: source1 });
    // The same sync id under a different destination is a different sync.
    await addSync(otherDestDocId, "s", { sourceDocId: source1 });

    const created = (await home.getSync(destDocId, "s"))!;
    assert.deepInclude(created, {
      syncId: "s", destDocId, sourceDocId: source1, ownerId: chimpyId,
    });
    assert.deepEqual(created.options, OPTIONS_1);
    assert.deepEqual(created.status, STATUS_1);

    // Repairing re-points the same row rather than adding another. The table set is stored
    // canonicalized: sorted and deduplicated, however the caller listed it.
    await addSync(destDocId, "s", {
      sourceDocId: source2, ownerId: other.id,
      options: { authorizedTableIds: ["Gamma", "Beta", "Beta"] }, status: STATUS_2,
    });
    const repaired = (await home.getSync(destDocId, "s"))!;
    assert.deepInclude(repaired, {
      id: created.id, sourceDocId: source2, ownerId: other.id,
    });
    assert.deepEqual(repaired.options, OPTIONS_2);
    assert.deepEqual(repaired.status, STATUS_2);

    await home.deleteSync(destDocId, "s");
    assert.isNull(await home.getSync(destDocId, "s"));
    assert.isNotNull(await home.getSync(otherDestDocId, "s"));
  });

  it("reconciles a doc's syncs by updating and deleting, and never by inserting", async function() {
    const [destDocId, otherDestDocId, sourceDocId] =
      await Promise.all([makeDoc(), makeDoc(), makeDoc()]);
    await addSync(destDocId, "kept", { sourceDocId });
    await addSync(destDocId, "dropped", { sourceDocId });
    await addSync(otherDestDocId, "kept", { sourceDocId });

    await home.syncSyncs(destDocId, [
      { syncId: "kept", status: STATUS_2 },
      // A document copy lists sync ids whose binding belongs to the original; reconciliation
      // must not invent one for them.
      { syncId: "unknown", status: STATUS_2 },
    ]);

    const kept = (await home.getSync(destDocId, "kept"))!;
    assert.deepEqual(kept.status, STATUS_2);
    // Only the sync endpoints record what a sync covers. Reconciliation carries the status and
    // nothing else, so what a document says about its own table set never becomes authoritative.
    assert.deepEqual(kept.options, OPTIONS_1);
    assert.isNull(await home.getSync(destDocId, "unknown"));
    assert.isNull(await home.getSync(destDocId, "dropped"));
    // Another document's syncs are out of scope, even under the same sync id.
    const untouched = (await home.getSync(otherDestDocId, "kept"))!;
    assert.deepEqual(untouched.status, STATUS_1);

    // A document that lists no syncs at all drops everything recorded for it.
    await home.syncSyncs(destDocId, []);
    assert.isNull(await home.getSync(destDocId, "kept"));
    assert.isNotNull(await home.getSync(otherDestDocId, "kept"));
  });

  it("degrades a sync when its source doc or owner goes away, and removes it with its dest doc",
    async function() {
      const [destDocId, sourceDocId] = await Promise.all([makeDoc(), makeDoc()]);
      const owner = await makeUser("syncowner2");
      await addSync(destDocId, "s", { sourceDocId, ownerId: owner.id });

      home.unwrapQueryResult(
        await home.deleteDocument({ userId: chimpyId, urlId: sourceDocId }));
      const sourceGone = (await home.getSync(destDocId, "s"))!;
      assert.deepInclude(sourceGone, { sourceDocId: null, ownerId: owner.id });

      home.unwrapQueryResult(await home.deleteUser({ userId: owner.id }, owner.id));
      const ownerGone = (await home.getSync(destDocId, "s"))!;
      assert.deepInclude(ownerGone, { sourceDocId: null, ownerId: null });

      home.unwrapQueryResult(
        await home.deleteDocument({ userId: chimpyId, urlId: destDocId }));
      assert.isNull(await home.getSync(destDocId, "s"));
    });
});
