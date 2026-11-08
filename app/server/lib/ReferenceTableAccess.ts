import { ApiError } from "app/common/ApiError";
import { DocAction, getRowIdsFromDocAction, isDataAction, UserAction } from "app/common/DocActions";
import { DocData } from "app/common/DocData";
import { makeExceptionalDocSession, OptDocSession } from "app/server/lib/DocSession";
// Authority is attached by server code, never deserialized from user action options.
const internalSessions = new WeakSet<OptDocSession>();
const historySessions = new WeakSet<OptDocSession>();
export function makeReferenceSession(): OptDocSession {
  const session = makeExceptionalDocSession("system");
  internalSessions.add(session);
  return session;
}
export function isReferenceSession(session: OptDocSession | null): boolean {
  return Boolean(session && internalSessions.has(session));
}
export async function withReferenceHistory<T>(session: OptDocSession,
  fn: (historySession: OptDocSession) => Promise<T>): Promise<T> {
  // An isolated proxy preserves session getters without granting concurrent RPCs history authority.
  const historySession: OptDocSession = new Proxy(session, {});
  historySessions.add(historySession);
  try { return await fn(historySession); } finally { historySessions.delete(historySession); }
}
/** Check both submitted actions and expanded DocActions (the latter before the ACL rollback point). */
export function assertReferenceActions(
  data: DocData | null | undefined,
  session: OptDocSession | null,
  actions: UserAction[],
  expanded = false,
): void {
  if (!data || isReferenceSession(session)) { return; }
  const tables = data.getMetaTable("_grist_Tables");
  const columns = data.getMetaTable("_grist_Tables_column");
  const records = tables.getRecords();
  const mirrors = new Set(records.filter(t => t.referenceSource).map(t => t.tableId));
  const identities = new Map(records.filter(t => t.referenceIdentity).map(t => [t.tableId, t.referenceIdentity]));
  const removedTables = new Set(actions.filter(a => a[0] === "RemoveTable").map(a => a[1]));
  const fail = () => { throw new ApiError("Synchronized reference tables are read-only", 403); };
  for (const action of actions) {
    const name = String(action[0]);
    const tableId = action[1];
    if (["PrepareReferenceSource", "CreateReferenceTables"].includes(name)) { fail(); }
    if (name === "ApplyUndoActions" || name === "ApplyDocActions") {
      assertReferenceActions(data, session, action[1] as UserAction[], expanded);
      continue;
    }
    if (typeof tableId !== "string") { continue; }
    if (mirrors.has(tableId)) { fail(); }
    const dataAction = isDataAction(action as DocAction) ? action as import("app/common/DocActions").DataAction : null;
    const values = dataAction?.[3] || {};
    if (tableId === "_grist_Tables") {
      if ("referenceSource" in values ||
        ("referenceIdentity" in values && !(session && historySessions.has(session)))) { fail(); }
      const ids = dataAction ? getRowIdsFromDocAction(dataAction) : [];
      if (ids.some(id => mirrors.has(tables.getValue(id, "tableId") || "")) &&
        (name.includes("Remove") || "tableId" in values || "onDemand" in values)) { fail(); }
    }
    if (tableId === "_grist_Tables_column") {
      const ids = dataAction ? getRowIdsFromDocAction(dataAction) : [];
      for (const id of ids) {
        const col = columns.getRecord(id);
        const parent = col && tables.getRecord(col.parentId);
        if (parent?.referenceSource || (parent?.referenceIdentity && col?.colId === parent.referenceIdentity &&
          !removedTables.has(parent.tableId))) {
          fail();
        }
      }
      const parents = Array.isArray(values.parentId) ? values.parentId : [values.parentId];
      if (parents.some(id => typeof id === "number" && mirrors.has(tables.getValue(id, "tableId") || ""))) { fail(); }
    }
    const identity = identities.get(tableId);
    if (identity) {
      // Engine-generated UUIDs are trusted; a history replay has been verified by hash.
      if (!expanded && !(session && historySessions.has(session)) && identity in values) { fail(); }
      if (!dataAction && action.slice(2).includes(identity) && !removedTables.has(tableId)) { fail(); }
    }
  }
}
