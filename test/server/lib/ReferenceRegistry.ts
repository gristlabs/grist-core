import { withReferenceRegistry } from "app/server/lib/ReferenceRegistry";

import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { assert } from "chai";
import { DataSource } from "typeorm";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("ReferenceRegistry", function() {
  this.timeout(10_000);
  let dir: string;
  let first: DataSource;
  let second: DataSource;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "grist-registry-"));
    const options = { type: "sqlite" as const, database: join(dir, "registry.db") };
    first = await new DataSource(options).initialize();
    second = await new DataSource(options).initialize();
    await first.query("CREATE TABLE reference_registry_lock (id INTEGER PRIMARY KEY)");
    await first.query("INSERT INTO reference_registry_lock VALUES (1)");
    await first.query("CREATE TABLE authorization (revoked INTEGER)");
    await first.query("INSERT INTO authorization VALUES (0)");
    await second.query("PRAGMA busy_timeout = 5000");
  });
  afterEach(async () => {
    await first.destroy();
    await second.destroy();
    await rm(dir, { recursive: true });
  });

  it("holds the cross-connection lock until an admitted document write completes", async () => {
    const entered = gate();
    const release = gate();
    const events: string[] = [];
    const commit = withReferenceRegistry(first, async (manager) => {
      assert.equal((await manager.query("SELECT revoked FROM authorization"))[0].revoked, 0);
      events.push("authorized");
      entered.resolve();
      await release.promise;
      events.push("document committed");
    });
    await entered.promise;
    const revoke = withReferenceRegistry(second, async (manager) => {
      await manager.query("UPDATE authorization SET revoked = 1");
      events.push("revoked");
    });
    release.resolve();
    await Promise.all([commit, revoke]);
    assert.deepEqual(events, ["authorized", "document committed", "revoked"]);
    await assert.isRejected(withReferenceRegistry(first, async (manager) => {
      if ((await manager.query("SELECT revoked FROM authorization"))[0].revoked) {
        throw new Error("ACCESS_REVOKED");
      }
      events.push("unexpected write");
    }), /ACCESS_REVOKED/);
    assert.lengthOf(events, 3);
  });

  it("rolls back and releases the shared-connection mutex after a failed document write", async () => {
    await assert.isRejected(withReferenceRegistry(first, async (manager) => {
      await manager.query("UPDATE authorization SET revoked = 1");
      throw new Error("storage failed");
    }), /storage failed/);
    await Promise.all([0, 1, 2].map(() => withReferenceRegistry(first, async (manager) => {
      assert.equal((await manager.query("SELECT revoked FROM authorization"))[0].revoked, 0);
    })));
  });
});
