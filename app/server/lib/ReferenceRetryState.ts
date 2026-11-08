/** Local scheduler backoff. Explicit reconciliation bypasses this delay; restart starts a fresh retry cycle. */
export class ReferenceRetryState {
  private _attempts = new Map<string, { failures: number; next: number }>();
  constructor(private _now: () => number = Date.now) {}
  public failed(id: string): void {
    const failures = Math.min((this._attempts.get(id)?.failures || 0) + 1, 6);
    this._attempts.set(id, { failures, next: this._now() + Math.min(300_000, 15_000 * 2 ** (failures - 1)) });
  }

  public ready(id: string): boolean { return (this._attempts.get(id)?.next || 0) <= this._now(); }
  public reset(id: string): void { this._attempts.delete(id); }
  public clear(): void { this._attempts.clear(); }
}
