import { ReferenceTransfer } from "app/common/ReferenceTables";
import { getReferenceState, setReferenceState } from "app/server/lib/ReferenceDocState";
import { assembleReferenceSnapshot, readReferenceSnapshotPage, ReferenceSnapshotManifest,
  stageReferenceSnapshot } from "app/server/lib/ReferenceSnapshotPages";
import { createDocTools } from "test/server/docTools";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";

describe("ReferenceSnapshotPages", function() {
  this.timeout(30_000);
  testUtils.setTmpLogLevel("error");
  const docs = createDocTools();
  it("round-trips wide unicode rows and rejects revoked, replaced, expired or corrupt transfers", async () => {
    const doc = await docs.createDoc("paged-reference");
    const transfer: ReferenceTransfer & { contractVersion: number } = { generation: "g", revision: 2,
      baseRevision: 1, removed: { a: ["deleted"] }, contractVersion: 1, tables: [{ key: "a", tableId: "Items",
        columns: [{ key: "1", colId: "Text", label: "Text", type: "Text" }], rows: { x: ["🍵".repeat(150000)] } }] };
    const storage = doc.docStorage;
    const manifest = await stageReferenceSnapshot(storage, "sub", "auth:1", transfer);
    assert.isAbove(manifest.pages, 1);
    const chunks: string[] = [];
    for (let page = 0; page < manifest.pages; page++) {
      chunks.push(await readReferenceSnapshotPage(storage, "sub", "auth:1", manifest.token, page));
    }
    assert.deepEqual(assembleReferenceSnapshot(manifest, chunks), transfer);
    assert.throws(() => assembleReferenceSnapshot(manifest, chunks.slice(1)), /Incomplete/);
    assert.throws(() => assembleReferenceSnapshot(manifest, [...chunks.slice(0, -1), "corrupt"]), /Incomplete/);
    await assert.isRejected(readReferenceSnapshotPage(storage, "sub", "auth:2", manifest.token, 0), /SNAPSHOT_EXPIRED/);
    await assert.isRejected(readReferenceSnapshotPage(storage, "other", "auth:1", manifest.token, 0), /SNAPSHOT_EXPIRED/);
    await assert.isRejected(readReferenceSnapshotPage(storage, "sub", "auth:1", manifest.token, -1), /Invalid/);
    const replacement = await stageReferenceSnapshot(storage, "sub", "auth:1", transfer);
    await assert.isRejected(readReferenceSnapshotPage(storage, "sub", "auth:1", manifest.token, 0), /SNAPSHOT_EXPIRED/);
    const expired = await getReferenceState<ReferenceSnapshotManifest>(storage, "transfer:sub:manifest");
    await setReferenceState(storage, "transfer:sub:manifest", { ...expired, expiresAt: 0 });
    await assert.isRejected(readReferenceSnapshotPage(storage, "sub", "auth:1", replacement.token, 0), /SNAPSHOT_EXPIRED/);
    assert.isEmpty(await storage.all("SELECT key FROM _gristsys_ReferenceState WHERE key LIKE ?", "transfer:sub:%"));
  });
});
