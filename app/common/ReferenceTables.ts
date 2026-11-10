/** Contracts shared by reference publishers, subscribers and the management UI. */
import { CellValue, UserAction } from "app/common/DocActions";
import { GristObjCode } from "app/plugin/GristData";

import isEqual from "lodash/isEqual";
export interface ReferenceFilter {
  colRef: number;
  op: "in" | "notIn" | "gt" | "gte" | "lt" | "lte";
  values: CellValue[];
}
export interface ReferenceTableSelection {
  tableRef: number;
  colRefs: number[];
  filters: ReferenceFilter[];
}
export interface ReferencePublicationSpec {
  name: string;
  description?: string;
  tables: ReferenceTableSelection[];
}
export interface ReferenceColumn {
  key: string;
  colId: string;
  label: string;
  type: string;
  target?: string;
}
export interface ReferenceTableSnapshot {
  key: string;
  tableId: string;
  columns: ReferenceColumn[];
  // Keys are durable source identities, NOT Grist row numbers.
  rows: Record<string, CellValue[]>;
}
export interface ReferenceSnapshot {
  generation: string;
  revision: number;
  tables: ReferenceTableSnapshot[];
}
export interface ReferenceTransfer extends ReferenceSnapshot {
  // Absent for a full snapshot. A delta is only applicable to this exact local revision.
  baseRevision?: number;
  removed?: Record<string, string[]>;
}
export function applyReferenceTransfer(previous: ReferenceSnapshot | undefined,
  transfer: ReferenceTransfer): ReferenceSnapshot {
  if (transfer.baseRevision === undefined) { return transfer; }
  if (!previous || previous.generation !== transfer.generation || previous.revision !== transfer.baseRevision) {
    throw new Error("Reference delta requires a new snapshot");
  }
  return {
    generation: transfer.generation, revision: transfer.revision,
    tables: transfer.tables.map((table) => {
      const rows = { ...previous.tables.find(t => t.key === table.key)?.rows, ...table.rows };
      for (const key of transfer.removed?.[table.key] || []) { delete rows[key]; }
      return { ...table, rows };
    }),
  };
}
export interface ReferenceMirrorTable {
  tableId: string;
  columns: Record<string, string>;
  rowIds: Record<string, number>;
  nextRowId: number;
}
export interface ReferenceMirrorState {
  generation: string;
  revision: number;
  tables: Record<string, ReferenceMirrorTable>;
  snapshot?: ReferenceSnapshot;
}
export type ReferenceStatus = "INITIALIZING" | "WAITING" | "UP_TO_DATE" | "RETRYING" | "PAUSED" | "CONTRACT_CHANGED" |
  "ACCESS_REVOKED" | "SCHEMA_BLOCKED" | "REAUTH_REQUIRED" | "DETACHED";
export const REFERENCE_TYPES = new Set([
  "Text", "Numeric", "Int", "Bool", "Date", "DateTime", "Choice", "Ref", "RefList",
]);
/** Deliberately bounded syntax, with no eval and no user-dependent predicates. */
export function matchesReferenceFilter(value: CellValue, filter: ReferenceFilter): boolean {
  if (filter.op === "in") { return filter.values.some(v => isEqual(value, v)); }
  if (filter.op === "notIn") { return !filter.values.some(v => isEqual(value, v)); }
  const other = filter.values[0];
  if (typeof value !== "number" || typeof other !== "number") { return false; }
  switch (filter.op) {
    case "gt": return value > other;
    case "gte": return value >= other;
    case "lt": return value < other;
    case "lte": return value <= other;
  }
}
export function validateReferenceSpec(value: unknown): asserts value is ReferencePublicationSpec {
  const fail = () => { throw new Error("Invalid reference publication"); };
  if (!value || typeof value !== "object") { return fail(); }
  const spec = value as ReferencePublicationSpec;
  if (typeof spec.name !== "string" || !spec.name.trim() || spec.name.length > 200 ||
    (spec.description !== undefined && (typeof spec.description !== "string" || spec.description.length > 2000)) ||
    !Array.isArray(spec.tables) || !spec.tables.length) { return fail(); }
  const tables = new Set<number>();
  for (const table of spec.tables) {
    if (!table || !Number.isSafeInteger(table.tableRef) || table.tableRef <= 0 || tables.has(table.tableRef) ||
      !Array.isArray(table.colRefs) || !table.colRefs.length ||
      table.colRefs.some(c => !Number.isSafeInteger(c) || c <= 0) ||
      new Set(table.colRefs).size !== table.colRefs.length || !Array.isArray(table.filters)) { return fail(); }
    tables.add(table.tableRef);
    for (const filter of table.filters) {
      if (!filter || !Number.isSafeInteger(filter.colRef) || filter.colRef <= 0 ||
        !["in", "notIn", "gt", "gte", "lt", "lte"].includes(filter.op) ||
        !Array.isArray(filter.values) || filter.values.some(v =>
        v !== null && !["string", "number", "boolean"].includes(typeof v)) ||
        (!["in", "notIn"].includes(filter.op) &&
          (filter.values.length !== 1 || typeof filter.values[0] !== "number"))) { return fail(); }
    }
  }
}
/**
 * Produce a transactional differential. Reserve every identity before translating references,
 * so self references and cycles work. Tombstones retain their IDs across filter exit/re-entry.
 * The returned state is independent of the input and must only be saved after commit.
 */
export function reconcileReferenceSnapshot(
  previous: ReferenceMirrorState,
  incoming: ReferenceSnapshot,
  acceptSchema = false,
): { actions: UserAction[]; state: ReferenceMirrorState } {
  if (previous.generation !== incoming.generation) { throw new Error("REAUTH_REQUIRED"); }
  if (incoming.revision <= previous.revision) { return { actions: [], state: previous }; }
  const state: ReferenceMirrorState = JSON.parse(JSON.stringify(previous));
  const actions: UserAction[] = [];
  const oldTables = new Map(previous.snapshot?.tables.map(t => [t.key, t]) || []);
  if (Object.keys(state.tables).length !== incoming.tables.length) { throw new Error("SCHEMA_BLOCKED"); }
  for (const table of incoming.tables) {
    const mirror = state.tables[table.key];
    const old = oldTables.get(table.key);
    if (!mirror) { throw new Error("SCHEMA_BLOCKED"); }
    for (const col of old?.columns || []) {
      const next = table.columns.find(c => c.key === col.key);
      if (!next || next.type !== col.type || next.target !== col.target) {
        if (!acceptSchema) { throw new Error("SCHEMA_BLOCKED"); }
        const colId = mirror.columns[col.key];
        if (!next) {
          actions.push(["RemoveColumn", mirror.tableId, colId]);
          delete mirror.columns[col.key];
        } else {
          const type = next.target ? `${next.type.split(":")[0]}:${state.tables[next.target].tableId}` : next.type;
          actions.push(["ModifyColumn", mirror.tableId, colId, { type }]);
        }
      }
    }
    for (const col of table.columns) {
      if (mirror.columns[col.key]) { continue; }
      let colId = col.colId;
      const existing = new Set(Object.values(mirror.columns));
      for (let suffix = 2; existing.has(colId); suffix++) { colId = `${col.colId}_${suffix}`; }
      mirror.columns[col.key] = colId;
      const type = col.target ? `${col.type.split(":")[0]}:${state.tables[col.target].tableId}` : col.type;
      actions.push(["AddColumn", mirror.tableId, colId, { type, label: col.label, isFormula: false }]);
    }
    for (const key of Object.keys(table.rows)) {
      if (!mirror.rowIds[key]) {
        // Explicit IDs accepted by Grist's BulkAddRecord are bounded by the engine.
        if (mirror.nextRowId > 1_000_000) { throw new Error("Reference row identity capacity exceeded"); }
        mirror.rowIds[key] = mirror.nextRowId++;
      }
    }
  }
  const translate = (table: ReferenceTableSnapshot, values: CellValue[], snapshot: ReferenceSnapshot) =>
    table.columns.map((col, i): CellValue => {
      if (!col.target) { return values[i]; }
      const target = snapshot.tables.find(t => t.key === col.target);
      const mapping = state.tables[col.target];
      if (!target || !mapping) { throw new Error("SCHEMA_BLOCKED"); }
      const resolve = (key: unknown) => typeof key === "string" &&
        Object.prototype.hasOwnProperty.call(target.rows, key) ? mapping.rowIds[key] || 0 : 0;
      if (col.type.startsWith("RefList:")) {
        const list = values[i];
        return Array.isArray(list) && list[0] === "L" ?
          [GristObjCode.List, ...list.slice(1).map(resolve).filter(Boolean)] : list;
      }
      const value = values[i];
      if (Array.isArray(value) && value[0] === GristObjCode.Reference) { return resolve(value[2]); }
      if (typeof value === "string" && value && mapping.rowIds[value]) { return resolve(value); }
      return value === "" ? 0 : value;
    });
  for (const table of incoming.tables) {
    const mirror = state.tables[table.key];
    const old = oldTables.get(table.key);
    const removed = Object.keys(old?.rows || {}).filter(key => !Object.prototype.hasOwnProperty.call(table.rows, key));
    if (removed.length) { actions.push(["BulkRemoveRecord", mirror.tableId, removed.map(k => mirror.rowIds[k])]); }
    for (const kind of ["BulkAddRecord", "BulkUpdateRecord"] as const) {
      const ids: number[] = [];
      const values: Record<string, CellValue[]> = Object.fromEntries(
        table.columns.map(c => [mirror.columns[c.key], []]));
      for (const [key, row] of Object.entries(table.rows)) {
        const existed = old && Object.prototype.hasOwnProperty.call(old.rows, key);
        if ((kind === "BulkUpdateRecord") !== Boolean(existed)) { continue; }
        const translated = translate(table, row, incoming);
        if (existed && previous.snapshot && isEqual(table.columns.map(c => [c.key, c.type, c.target]),
          old.columns.map(c => [c.key, c.type, c.target])) && isEqual(translated,
          translate(old, old.rows[key], previous.snapshot))) {
          continue;
        }
        ids.push(mirror.rowIds[key]);
        table.columns.forEach((c, i) => values[mirror.columns[c.key]].push(translated[i]));
      }
      if (ids.length) { actions.push([kind, mirror.tableId, ids, values]); }
    }
  }
  state.snapshot = incoming;
  state.revision = incoming.revision;
  return { actions, state };
}
