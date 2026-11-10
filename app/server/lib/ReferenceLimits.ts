import { ApiError } from "app/common/ApiError";
import { DocStorage } from "app/server/lib/DocStorage";
import { quoteIdent } from "app/server/lib/SQLiteDB";

export const REFERENCE_MAX_BYTES = 32 * 1024 * 1024;
export const REFERENCE_MAX_CELLS = 2_000_000;

/** Reject before serializing large objects, including JSON escape expansion. */
export function assertReferenceSize(value: unknown, maxBytes = REFERENCE_MAX_BYTES): void {
  let bytes = 0;
  function visit(item: unknown): void {
    bytes += typeof item === "string" ? Buffer.byteLength(item) + 2 : 32;
    if (bytes > maxBytes) { throw new ApiError("REFERENCE_SIZE_LIMIT", 413); }
    if (typeof item === "string") {
      for (const char of item) {
        const code = char.charCodeAt(0);
        if (code < 32) { bytes += 5; } else if (char === '"' || char === "\\") { bytes++; } else if (
          char.length === 1 && code >= 0xD800 && code <= 0xDFFF) { bytes += 3; }
      }
      if (bytes > maxBytes) { throw new ApiError("REFERENCE_SIZE_LIMIT", 413); }
    }
    if (Array.isArray(item)) {
      for (const child of item) { visit(child); }
    } else if (item && typeof item === "object") {
      for (const key of Object.keys(item)) {
        visit(key); visit((item as Record<string, unknown>)[key]);
      }
    }
  }
  visit(value);
}

/** Check SQLite data before copying tables into Node/Python. Called under the document read barrier. */
export async function assertReferenceTablesSize(storage: DocStorage, names: string[],
  maxCells = REFERENCE_MAX_CELLS): Promise<void> {
  let bytes = 0;
  let cells = 0;
  for (const name of names) {
    const columns = await storage.all(`PRAGMA table_info(${quoteIdent(name)})`);
    if (!columns.length) { continue; }
    const sizes = columns.map(c => `COALESCE(length(CAST(${quoteIdent(c.name)} AS BLOB)), 0) + 16`);
    const counts = await storage.get(`SELECT COUNT(*) AS rows, COALESCE(SUM(${sizes.join(" + ")}), 0) AS bytes
      FROM ${quoteIdent(name)}`);
    bytes += counts!.bytes;
    cells += counts!.rows * columns.length;
    if (bytes > REFERENCE_MAX_BYTES || cells > maxCells) { throw new ApiError("REFERENCE_SIZE_LIMIT", 413); }
  }
}

/** No unbounded waiting queue. Shared by cookie/API-key requests and background work alike. */
export class ReferenceWorkLimiter {
  private _active = new Set<string>();
  private _groups = new Map<string, number>();
  constructor(private _maximum = 4, private _perGroup = _maximum) {}
  public async run<T>(key: string, callback: () => Promise<T>, group?: string): Promise<T> {
    const used = group === undefined ? 0 : this._groups.get(group) || 0;
    if (this._active.has(key) || this._active.size >= this._maximum || used >= this._perGroup) {
      throw new ApiError("REFERENCE_BUSY", 429);
    }
    this._active.add(key);
    if (group !== undefined) { this._groups.set(group, used + 1); }
    try { return await callback(); } finally {
      this._active.delete(key);
      if (group !== undefined) {
        const remaining = this._groups.get(group)! - 1;
        if (remaining) { this._groups.set(group, remaining); } else { this._groups.delete(group); }
      }
    }
  }
}
