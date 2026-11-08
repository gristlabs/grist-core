import { ApiError } from "app/common/ApiError";

/** Unapplied data belongs to the owner-only preview, never to an exported destination .grist file. */
export class ReferencePreviewCache<T extends { expiresAt: string }> {
  private _entries = new Map<string, { value: T; bytes: number }>();
  constructor(private _maxBytes = 64 * 1024 * 1024, private _now = Date.now) {}

  public set(key: string, value: T): void {
    this.prune();
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > this._maxBytes) { throw new ApiError("Reference preview exceeds the 64 MiB cache limit", 413); }
    this._entries.delete(key);
    let total = [...this._entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const [oldest, entry] of this._entries) {
      if (total + bytes <= this._maxBytes) { break; }
      this._entries.delete(oldest);
      total -= entry.bytes;
    }
    this._entries.set(key, { value, bytes });
  }

  public get(key: string): T | undefined {
    this.prune();
    return this._entries.get(key)?.value;
  }

  public delete(key: string): void { this._entries.delete(key); }
  public clear(): void { this._entries.clear(); }
  public prune(): void {
    for (const [key, entry] of this._entries) {
      if (Date.parse(entry.value.expiresAt) <= this._now()) { this._entries.delete(key); }
    }
  }
}
