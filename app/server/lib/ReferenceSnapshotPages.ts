import { ApiError } from "app/common/ApiError";
import { ReferenceTransfer } from "app/common/ReferenceTables";
import { DocStorage } from "app/server/lib/DocStorage";
import { getReferenceState, setReferenceState } from "app/server/lib/ReferenceDocState";
import { assertReferenceSize, REFERENCE_MAX_BYTES } from "app/server/lib/ReferenceLimits";

import { createHash, randomUUID } from "crypto";

export interface ReferenceSnapshotManifest {
  token: string;
  pages: number;
  bytes: number;
  sha256: string;
  expiresAt: number;
  binding: string;
}
// Chunk serialized JSON, including oversized rows: even one very wide row cannot produce an unbounded response.
export const REFERENCE_PAGE_CHARS = 128 * 1024;
export function validateReferenceManifest(manifest: ReferenceSnapshotManifest): void {
  if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes < 0 || manifest.bytes > REFERENCE_MAX_BYTES ||
    !Number.isSafeInteger(manifest.pages) || manifest.pages < 1 ||
    manifest.pages > Math.ceil(REFERENCE_MAX_BYTES / REFERENCE_PAGE_CHARS)) {
    throw new ApiError("REFERENCE_SIZE_LIMIT", 413);
  }
}

export async function pruneReferenceSnapshots(storage: DocStorage): Promise<void> {
  const manifests = await storage.all("SELECT key, value FROM _gristsys_ReferenceState WHERE key LIKE ?",
    "transfer:%:manifest");
  for (const row of manifests) {
    if (JSON.parse(row.value).expiresAt <= Date.now()) {
      await storage.run("DELETE FROM _gristsys_ReferenceState WHERE key LIKE ?", `${row.key.slice(0, -8)}%`);
    }
  }
}
export async function stageReferenceSnapshot(storage: DocStorage, id: string, binding: string,
  transfer: ReferenceTransfer & { contractVersion: number }): Promise<ReferenceSnapshotManifest> {
  assertReferenceSize(transfer);
  const json = JSON.stringify(transfer);
  const manifest = { token: randomUUID(), pages: Math.ceil(json.length / REFERENCE_PAGE_CHARS),
    bytes: Buffer.byteLength(json), sha256: createHash("sha256").update(json).digest("hex"),
    expiresAt: Date.now() + 10 * 60_000, binding };
  const prefix = `transfer:${id}:`;
  await storage.execTransaction(async () => {
    await pruneReferenceSnapshots(storage);
    const manifests = await storage.all("SELECT key, value FROM _gristsys_ReferenceState WHERE key LIKE ?",
      "transfer:%:manifest");
    const stagedBytes = manifests.filter(row => row.key !== `${prefix}manifest`)
      .reduce((sum, row) => sum + JSON.parse(row.value).bytes, manifest.bytes);
    if (stagedBytes > 4 * REFERENCE_MAX_BYTES) { throw new ApiError("REFERENCE_STAGING_LIMIT", 413); }
    // Only one staged transfer per subscription. Replacements invalidate old tokens explicitly.
    await storage.run("DELETE FROM _gristsys_ReferenceState WHERE key LIKE ?", `${prefix}%`);
    await setReferenceState(storage, `${prefix}manifest`, manifest);
    for (let page = 0; page < manifest.pages; page++) {
      await setReferenceState(storage, `${prefix}${page}`,
        json.slice(page * REFERENCE_PAGE_CHARS, (page + 1) * REFERENCE_PAGE_CHARS));
    }
  });
  return manifest;
}
export async function readReferenceSnapshotPage(storage: DocStorage, id: string, binding: string,
  token: unknown, page: unknown): Promise<string> {
  const prefix = `transfer:${id}:`;
  const manifest = await getReferenceState<ReferenceSnapshotManifest>(storage, `${prefix}manifest`);
  if (manifest && manifest.expiresAt <= Date.now()) {
    await storage.execTransaction(() => pruneReferenceSnapshots(storage));
  }
  if (!manifest || token !== manifest.token || binding !== manifest.binding || manifest.expiresAt <= Date.now()) {
    throw new ApiError("SNAPSHOT_EXPIRED", 409);
  }
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 0 || page >= manifest.pages) {
    throw new ApiError("Invalid snapshot page", 400);
  }
  const chunk = await getReferenceState<string>(storage, `${prefix}${page}`);
  if (typeof chunk !== "string") { throw new ApiError("SNAPSHOT_EXPIRED", 409); }
  return chunk;
}
export function assembleReferenceSnapshot(manifest: ReferenceSnapshotManifest, chunks: string[]):
ReferenceTransfer & { contractVersion: number } {
  validateReferenceManifest(manifest);
  if (chunks.length !== manifest.pages || chunks.some(c => c.length > REFERENCE_PAGE_CHARS) ||
    chunks.reduce((sum, c) => sum + Buffer.byteLength(c), 0) > REFERENCE_MAX_BYTES + 2 * manifest.pages) {
    throw new ApiError("Incomplete reference snapshot", 409);
  }
  const json = chunks.join("");
  if (chunks.length !== manifest.pages || Buffer.byteLength(json) !== manifest.bytes ||
    createHash("sha256").update(json).digest("hex") !== manifest.sha256) {
    throw new ApiError("Incomplete reference snapshot", 409);
  }
  return JSON.parse(json);
}
