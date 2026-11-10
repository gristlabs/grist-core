import { ApiError } from "app/common/ApiError";
import { ReferenceAuditEvent } from "app/gen-server/entity/ReferenceAuditEvent";
import { ReferenceAuditKey } from "app/gen-server/entity/ReferenceAuditKey";
import { DocStorage } from "app/server/lib/DocStorage";
import { withReferenceRegistry } from "app/server/lib/ReferenceRegistry";

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

import { DataSource } from "typeorm";

export type ReferenceAuditRecord = Pick<ReferenceAuditEvent,
  "id" | "documentId" | "createdAt" | "actorId" | "operation" | "details"> & { signature?: string };

export async function signReferenceAudit(db: DataSource, event: ReferenceAuditRecord): Promise<ReferenceAuditRecord> {
  // Commit the key before any document transaction uses it. A rollback must not orphan signatures.
  const secret = await withReferenceRegistry(db, async (manager) => {
    const key = await manager.getRepository(ReferenceAuditKey).createQueryBuilder("key")
      .addSelect("key.secret").where("key.id = 1").getOne();
    if (key) { return key.secret; }
    const generated = randomBytes(32).toString("hex");
    try { await manager.save(ReferenceAuditKey, { id: 1, secret: generated }); } catch {
      // TypeORM's transaction logger must not receive an error containing the signing key as a SQL parameter.
      throw new ApiError("Reference audit signing key unavailable", 503);
    }
    return generated;
  });
  const payload = { ...event };
  delete payload.signature;
  return { ...payload, signature: createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex") };
}

/** Retry-safe: the document transaction assigns the id; a crash after insert can replay that same id. */
export async function flushReferenceAudit(storage: DocStorage, documentId: string, db: DataSource):
Promise<void> {
  const rows = await storage.all("SELECT key, value FROM _gristsys_ReferenceState WHERE key LIKE ?", "audit:%");
  for (const row of rows) {
    const { signature, ...event }: ReferenceAuditRecord = JSON.parse(row.value);
    // Copies must not impersonate the original document or replay its journal.
    if (event.documentId === documentId) {
      await withReferenceRegistry(db, async (manager) => {
        const key = await manager.getRepository(ReferenceAuditKey).createQueryBuilder("key")
          .addSelect("key.secret").where("key.id = 1").getOne();
        if (!key || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature) ||
          !timingSafeEqual(Buffer.from(signature, "hex"),
            createHmac("sha256", key.secret).update(JSON.stringify(event)).digest())) {
          throw new ApiError("REFERENCE_AUDIT_INVALID", 409);
        }
        if (!await manager.existsBy(ReferenceAuditEvent, { id: event.id })) {
          await manager.save(ReferenceAuditEvent, event);
        }
      });
    }
    await storage.run("DELETE FROM _gristsys_ReferenceState WHERE key = ?", row.key);
  }
}
