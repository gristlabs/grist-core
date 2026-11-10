import { LocalActionBundle } from "app/common/ActionBundle";
import { getRowIdsFromDocAction, isDataAction } from "app/common/DocActions";
import { OptDocSession } from "app/server/lib/DocSession";
import { ReferenceAuditRecord } from "app/server/lib/ReferenceAuditOutbox";

import { randomUUID } from "crypto";

import type { DocStorage } from "app/server/lib/DocStorage";
interface PendingCommit {
  key: string;
  value: unknown;
  authorize?: () => Promise<unknown>;
  withCommit?: (write: () => Promise<void>) => Promise<void>;
  audit?: ReferenceAuditRecord;
}
// Not an ApplyUA option: callers cannot forge a pending commit over RPC.
const commits = new WeakMap<OptDocSession, PendingCommit>();
export function referenceCommit(session: OptDocSession, key: string, value: unknown,
  authorize?: () => Promise<unknown>, withCommit?: PendingCommit["withCommit"], audit?: ReferenceAuditRecord) {
  commits.set(session, { key, value, authorize, withCommit, audit });
}
export async function authorizeReferenceCommit(session: OptDocSession): Promise<void> {
  await commits.get(session)?.authorize?.();
}
/** Final authorization and durable SQLite commit are ordered together with revocation. */
export async function commitReferenceActions(session: OptDocSession, write: () => Promise<void>): Promise<void> {
  const pending = commits.get(session);
  if (pending?.withCommit) { await pending.withCommit(write); } else {
    await pending?.authorize?.();
    await write();
  }
}
export function hasReferenceCommit(session: OptDocSession): boolean { return commits.has(session); }
export async function getReferenceState<T>(storage: DocStorage, key: string): Promise<T | undefined> {
  const row = await storage.get("SELECT value FROM _gristsys_ReferenceState WHERE key = ?", key);
  return row ? JSON.parse(row.value) : undefined;
}
export async function setReferenceState(storage: DocStorage, key: string, value: unknown): Promise<void> {
  await storage.run("INSERT OR REPLACE INTO _gristsys_ReferenceState(key, value) VALUES (?, ?)",
    key, JSON.stringify(value));
}
export interface ReferenceRevision {
  docId: string;
  generation: string;
  revision: number;
}
export interface ReferenceChange {
  revision: number;
  // null means schema change or whole-table replacement: reload this table.
  tables: Record<string, number[] | null>;
}
/** Called inside the same SQLite transaction as data/history, before any notification. */
export async function recordReferenceChanges(
  storage: DocStorage, docId: string, bundle: LocalActionBundle, session: OptDocSession, retValues: unknown[],
): Promise<void> {
  const pending = commits.get(session);
  if (pending) {
    await setReferenceState(storage, pending.key,
      typeof pending.value === "function" ? pending.value(retValues) : pending.value);
    if (pending.audit) { await setReferenceState(storage, `audit:${pending.audit.id}`, pending.audit); }
  }
  let revision = await getReferenceState<ReferenceRevision>(storage, "revision");
  if (!revision) { return; } // No publication in this document.
  if (revision.docId !== docId) { return; } // A copy must not inherit a live publication.
  const removedColumns = bundle.stored.flatMap(([, action]) =>
    action[1] === "_grist_Tables_column" && (action[0] === "RemoveRecord" || action[0] === "BulkRemoveRecord") ?
      getRowIdsFromDocAction(action) : []);
  if (removedColumns.length) {
    const epochs = await getReferenceState<Record<string, string>>(storage, "columnEpochs") || {};
    for (const id of removedColumns) { epochs[String(id)] = randomUUID(); }
    await setReferenceState(storage, "columnEpochs", epochs);
  }
  revision = { ...revision, revision: revision.revision + 1 };
  const tables: ReferenceChange["tables"] = {};
  for (const [, action] of bundle.stored) {
    const table = action[1];
    if (table.startsWith("_grist_") || !isDataAction(action) || action[0] === "ReplaceTableData") {
      tables[table] = null;
    } else if (tables[table] !== null) {
      tables[table] = [...new Set([...(tables[table] || []), ...getRowIdsFromDocAction(action)])];
    }
  }
  await setReferenceState(storage, "revision", revision);
  await storage.run("INSERT INTO _gristsys_ReferenceChanges(revision, changes) VALUES (?, ?)",
    revision.revision, JSON.stringify(tables));
  // A bounded replay log, with an explicit full-snapshot fallback for older cursors.
  await storage.run("DELETE FROM _gristsys_ReferenceChanges WHERE revision <= ?", revision.revision - 1000);
}
export async function initializeReferenceRevision(storage: DocStorage, docId: string): Promise<ReferenceRevision> {
  const current = await getReferenceState<ReferenceRevision>(storage, "revision");
  if (current?.docId === docId) { return current; }
  const state = { docId, generation: randomUUID(), revision: 1 };
  await setReferenceState(storage, "revision", state);
  return state;
}
