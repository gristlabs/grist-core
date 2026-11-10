import { CellValue } from "app/common/DocActions";
import { ReferenceSnapshot } from "app/common/ReferenceTables";

import isEqual from "lodash/isEqual";

export type ReferenceSyncMode = "live" | "manual" | "scheduled";
export interface ReferenceSyncSettings {
  syncMode: ReferenceSyncMode;
  syncIntervalMinutes: number;
}
export function referenceSyncDue(settings: ReferenceSyncSettings & { nextSyncAt: string }, now = Date.now()): boolean {
  return settings.syncMode !== "manual" &&
    (settings.syncMode !== "scheduled" || !settings.nextSyncAt || Date.parse(settings.nextSyncAt) <= now);
}
export interface ReferenceFormulaImpact {
  changed: number;
  newErrors: number;
  samples: { tableId: string; colId: string; rowId: number; before: CellValue; after: CellValue }[];
  externalRequests: boolean;
}
export interface ReferenceUpdatePreview {
  token: string;
  expiresAt: string;
  revision: number;
  contractVersion: number;
  schema: { tableId: string; column: string; before: string; after: string }[];
  tables: { tableId: string; added: number; updated: number; removed: number;
    samples: { key: string; before: Record<string, CellValue> | null; after: Record<string, CellValue> | null }[] }[];
  formulas: ReferenceFormulaImpact;
}
export function describeReferenceUpdate(previous: ReferenceSnapshot, incoming: ReferenceSnapshot):
Pick<ReferenceUpdatePreview, "schema" | "tables"> {
  const schema: ReferenceUpdatePreview["schema"] = [];
  const tables = incoming.tables.map((table) => {
    const old = previous.tables.find(t => t.key === table.key);
    for (const col of old?.columns || []) {
      const next = table.columns.find(c => c.key === col.key);
      if (!next || col.type !== next.type || col.target !== next.target) {
        schema.push({ tableId: table.tableId, column: col.colId, before: col.type, after: next?.type || "" });
      }
    }
    const result: ReferenceUpdatePreview["tables"][number] = {
      tableId: table.tableId, added: 0, updated: 0, removed: 0, samples: [],
    };
    const values = (t: typeof table | undefined, row: CellValue[] | undefined) => !t || !row ? null :
      Object.fromEntries(t.columns.map((c, i) => [c.colId, row[i]]));
    for (const key of new Set([...Object.keys(old?.rows || {}), ...Object.keys(table.rows)])) {
      const before = values(old, old?.rows[key]);
      const after = values(table, table.rows[key]);
      const keyed = (t: typeof table | undefined, row: CellValue[] | undefined) => !t || !row ? null :
        Object.fromEntries(t.columns.map((c, i) => [c.key, row[i]]));
      if (isEqual(keyed(old, old?.rows[key]), keyed(table, table.rows[key]))) { continue; }
      result[before === null ? "added" : after === null ? "removed" : "updated"]++;
      if (result.samples.length < 20) { result.samples.push({ key, before, after }); }
    }
    return result;
  });
  return { schema, tables };
}
