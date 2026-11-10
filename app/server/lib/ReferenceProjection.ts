import { ApiError } from "app/common/ApiError";
import { CellValue, TableDataAction } from "app/common/DocActions";
import {
  matchesReferenceFilter, REFERENCE_TYPES, ReferenceSnapshot, ReferenceTableSnapshot, ReferenceTransfer,
} from "app/common/ReferenceTables";
import { ReferencePublication } from "app/gen-server/entity/ReferencePublication";
import { GristObjCode } from "app/plugin/GristData";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { getReferenceState, ReferenceRevision, setReferenceState } from "app/server/lib/ReferenceDocState";
import { assertReferenceSize, assertReferenceTablesSize, REFERENCE_MAX_BYTES } from "app/server/lib/ReferenceLimits";
import { makeReferenceSession } from "app/server/lib/ReferenceTableAccess";

import isEqual from "lodash/isEqual";
interface ProjectionCache {
  generation: string;
  revision: number;
  spec: string;
  raw: Record<string, Record<string, Record<string, CellValue>>>;
  snapshot: ReferenceSnapshot;
  changed: Record<string, Record<string, number>>;
  removed: Record<string, Record<string, number>>;
}
function rowsFromTable(data: TableDataAction): Record<string, Record<string, CellValue>> {
  return Object.fromEntries(data[2].map((id, i) => [String(id),
    Object.fromEntries(Object.entries(data[3]).map(([col, values]) => [col, values[i]]))]));
}
/** Execute under ActiveDoc.withReferenceRead: no writer may move the revision under the snapshot. */
export async function readReferenceProjection(
  doc: ActiveDoc, publication: ReferencePublication, since?: number,
): Promise<ReferenceTransfer> {
  const storage = doc.docStorage;
  await assertReferenceTablesSize(storage, publication.spec.tables.map(t =>
    doc.docData!.getMetaTable("_grist_Tables").getRecord(t.tableRef)?.tableId).filter((t): t is string => Boolean(t)));
  let revision = await getReferenceState<ReferenceRevision>(storage, "revision");
  if (!revision || revision.docId !== doc.docName || revision.generation !== publication.generation) {
    throw new ApiError("REAUTH_REQUIRED", 409);
  }
  const columnEpochs = await getReferenceState<Record<string, string>>(storage, "columnEpochs") || {};
  if (publication.spec.tables.some(t => [...t.colRefs, ...t.filters.map(f => f.colRef)].some(id =>
    (publication.columnEpochs?.[String(id)] || "") !== (columnEpochs[String(id)] || "")))) {
    throw new ApiError("SCHEMA_BLOCKED", 409);
  }
  const cacheKey = `projection:${publication.id}`;
  let cache = await getReferenceState<ProjectionCache>(storage, cacheKey);
  const tablesMeta = doc.docData!.getMetaTable("_grist_Tables");
  const columnsMeta = doc.docData!.getMetaTable("_grist_Tables_column");
  const specKey = JSON.stringify(publication.spec);
  if (cache && cache.spec !== specKey) {
    // Configuration changes also advance the durable source cursor, under the same read barrier.
    revision = { ...revision, revision: revision.revision + 1 };
    await storage.execTransaction(async () => {
      await setReferenceState(storage, "revision", revision);
      await storage.run("INSERT INTO _gristsys_ReferenceChanges(revision, changes) VALUES (?, ?)",
        revision!.revision, JSON.stringify({ _grist_Tables: null }));
    });
  }
  if (cache?.generation === revision.generation && cache.revision === revision.revision && cache.spec === specKey) {
    if (since === revision.revision) {
      return { ...cache.snapshot, baseRevision: since,
        tables: cache.snapshot.tables.map(t => ({ ...t, rows: {} })), removed: {} };
    }
    if (since === undefined) { return cache.snapshot; }
  }
  const selectedTables = new Set(publication.spec.tables.map(t => String(t.tableRef)));
  const changes = cache && await storage.all(
    "SELECT revision, changes FROM _gristsys_ReferenceChanges WHERE revision > ? ORDER BY revision", cache.revision);
  const reload = !cache || cache.generation !== revision.generation || cache.spec !== specKey ||
    (cache.revision < revision.revision && (!changes?.length || changes[0].revision !== cache.revision + 1));
  const dirty: Record<string, Set<number> | null> = {};
  let schemaChanged = reload;
  for (const change of changes || []) {
    for (const [tableId, ids] of Object.entries(JSON.parse(change.changes) as Record<string, number[] | null>)) {
      if (tableId.startsWith("_grist_")) { schemaChanged = true; }
      if (ids === null) { dirty[tableId] = null; } else if (dirty[tableId] !== null) {
        const set = dirty[tableId] || (dirty[tableId] = new Set());
        ids.forEach(id => set.add(id));
      }
    }
  }
  const raw: ProjectionCache["raw"] = cache?.raw || {};
  const tables: ReferenceTableSnapshot[] = [];
  const identities: Record<string, Map<number, string>> = {};
  for (const selection of publication.spec.tables) {
    const meta = tablesMeta.getRecord(selection.tableRef);
    if (!meta || meta.onDemand || meta.summarySourceTable || meta.referenceSource || !meta.referenceIdentity ||
      publication.identities[String(selection.tableRef)] !== meta.referenceIdentity) {
      throw new ApiError("SCHEMA_BLOCKED", 409);
    }
    const key = String(selection.tableRef);
    if (schemaChanged || dirty[meta.tableId] === null || !raw[key]) {
      raw[key] = rowsFromTable((await doc.fetchTable(makeReferenceSession(), meta.tableId, true)).tableData);
    } else if (dirty[meta.tableId]?.size) {
      const ids = [...dirty[meta.tableId]!];
      ids.forEach(id => delete raw[key][String(id)]);
      Object.assign(raw[key], rowsFromTable((await doc.fetchQuery(makeReferenceSession(), {
        tableId: meta.tableId, filters: { id: ids },
      }, true)).tableData));
    }
    const columns = selection.colRefs.map((ref) => {
      const col = columnsMeta.getRecord(ref);
      if (!col || col.parentId !== selection.tableRef || !REFERENCE_TYPES.has(col.type.split(":")[0]) ||
        (col.colId.startsWith("_") || col.colId === "manualSort")) { throw new ApiError("SCHEMA_BLOCKED", 409); }
      const targetName = /^(Ref|RefList):(.+)$/.exec(col.type)?.[2];
      const target = targetName && tablesMeta.getRecords().find(t => t.tableId === targetName);
      if (targetName && (!target || !selectedTables.has(String(target.id)))) {
        throw new ApiError("Every referenced table must be explicitly published", 400);
      }
      return {
        key: String(ref), colId: col.colId, label: col.label,
        type: target ? `${col.type.split(":")[0]}:${target.id}` : col.type,
        ...(target ? { target: String(target.id) } : {}),
      };
    });
    const filterCols = selection.filters.map((filter) => {
      const col = columnsMeta.getRecord(filter.colRef);
      if (!col || col.parentId !== selection.tableRef) { throw new ApiError("SCHEMA_BLOCKED", 409); }
      return col.colId;
    });
    const rows: ReferenceTableSnapshot["rows"] = {};
    identities[key] = new Map();
    const seen = new Set<string>();
    for (const [rowId, row] of Object.entries(raw[key])) {
      const identity = row[meta.referenceIdentity];
      if (typeof identity !== "string" || !identity || seen.has(identity)) {
        throw new ApiError("Invalid or duplicate reference identity", 409);
      }
      seen.add(identity);
      if (!selection.filters.every((filter, i) => matchesReferenceFilter(row[filterCols[i]], filter))) { continue; }
      identities[key].set(Number(rowId), identity);
      rows[identity] = columns.map(c => row[c.colId]);
    }
    tables.push({ key, tableId: meta.tableId, columns, rows });
  }
  // Only identities of visible target rows cross the publication boundary.
  for (const table of tables) {
    for (const row of Object.values(table.rows)) {
      table.columns.forEach((col, i) => {
        if (!col.target) { return; }
        const resolve = (id: unknown) => typeof id === "number" ? identities[col.target!].get(id) : undefined;
        const value = row[i];
        if (col.type.startsWith("RefList:")) {
          row[i] = Array.isArray(value) && value[0] === GristObjCode.List ?
            [GristObjCode.List, ...value.slice(1).map(resolve).filter((v): v is string => Boolean(v))] : value;
        } else if (typeof value === "number") {
          const identity = resolve(value);
          row[i] = identity ? [GristObjCode.Reference, col.target, identity] : 0;
        }
        // Error, pending and invalid cell values keep their native Grist encoding.
      });
    }
  }
  const snapshot: ReferenceSnapshot = { generation: revision.generation, revision: revision.revision, tables };
  const changed = cache?.changed || {};
  const removed = cache?.removed || {};
  for (const table of tables) {
    changed[table.key] ||= {};
    removed[table.key] ||= {};
    const previous = cache?.snapshot.tables.find(t => t.key === table.key);
    for (const [id, row] of Object.entries(table.rows)) {
      if (!isEqual(row, previous?.rows[id]) || schemaChanged) { changed[table.key][id] = revision.revision; }
      delete removed[table.key][id];
    }
    for (const id of Object.keys(previous?.rows || {})) {
      if (!Object.prototype.hasOwnProperty.call(table.rows, id)) {
        removed[table.key][id] = revision.revision;
        delete changed[table.key][id];
      }
    }
  }
  const canDelta = cache?.spec === specKey && since !== undefined && since <= cache.revision &&
    since >= 0 && !reload;
  cache = { generation: revision.generation, revision: revision.revision, spec: specKey, raw, snapshot, changed,
    removed };
  // Raw rows, projection and identity history are separate bounded representations.
  assertReferenceSize(cache, 4 * REFERENCE_MAX_BYTES);
  await setReferenceState(storage, cacheKey, cache);
  if (!canDelta) { return snapshot; }
  return {
    ...snapshot, baseRevision: since,
    tables: tables.map(table => ({ ...table,
      rows: Object.fromEntries(Object.entries(table.rows).filter(([id]) => changed[table.key][id] > since)),
    })),
    removed: Object.fromEntries(tables.map(table => [table.key,
      Object.entries(removed[table.key]).filter(([, r]) => r > since).map(([id]) => id)])),
  };
}
