/**
 * Counters for client operations in flight, existing purely so browser tests can wait on a
 * condition instead of polling a rendered value. Same idea as BaseAPI.numPendingRequests, which
 * is what makes waitForServer a condition rather than a guess. Named with a test prefix, as the
 * production code gains nothing from these.
 *
 * Keep this a leaf module. App.ts reads the counts and is on the main entry path, so importing the
 * modules that own these operations would pull their top-level makeT() in ahead of setupLocale and
 * blank the page.
 */
export class TestPendingOps {
  private _count: number = 0;

  public get count(): number { return this._count; }

  /**
   * Counts `fn` as in flight until it settles. Increments before calling, so an operation that
   * starts and then yields is never observed at zero.
   */
  public async track<T>(fn: () => Promise<T>): Promise<T> {
    this._count++;
    try {
      return await fn();
    } finally {
      this._count--;
    }
  }

  /** For promise chains that cannot be wrapped in track(). */
  public start(): void { this._count++; }

  public end(): void { this._count--; }
}

/** Admin panel checks (boot probes); results land in observables as they arrive. */
export const testPendingChecks = new TestPendingOps();

/**
 * Paste operations. A file paste is an upload followed by a separate addAttachments action, so
 * in-flight request counts go quiet between the two and look like success.
 */
export const testPendingPastes = new TestPendingOps();
