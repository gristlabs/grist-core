/**
 * A class for scheduling a particular operation on resources
 * identified by a key.  For operations which should be applied
 * some time after an event.
 */
export class KeyedOps {
  private _operations = new Map<string, OperationStatus>();  // status of operations
  private _history = new Map<string, OperationHistory>();    // history of operations
                                                             // (will accumulate without limit)
  private _changed = new Set<string>();    // set when key needs an operation
  private _operating = new Set<string>();  // set when operation is in progress for key
  private _stopped: boolean = false;       // set to prohibit all new operations or retries

  /**
   * Provide a function to apply operation, and some optional
   * parameters.
   *
   *   - delayBeforeOperationMs: if set, a call to addOperation(key) will have
   *     a delayed effect.  It will schedule (or reschedule) the operation to occur
   *     after this interval.  If the operation is currently in progress, it will
   *     get rerun after it completes.
   *
   *   - minDelaybetweenOperationsMs: is set, scheduling for operations will have
   *     additional delays inserted as necessary to keep this minimal delay between
   *     the start of successive operations.
   *
   *   - retry: if `retry` is set, the operation will be retried
   *     indefinitely with a rather primitive retry mechanism -
   *     otherwise no attempt is made to retry failures.
   *
   *   - logError: called when errors occur, with a count of number of failures so
   *     far.
   */
  constructor(private _op: (key: string) => Promise<void>, private _options: {
    delayBeforeOperationMs?: number,
    minDelayBetweenOperationsMs?: number,
    retry?: boolean,
    logError?: (key: string, failureCount: number, err: Error) => void
  }) {
  }

  /**
   * Request an operation be done (eventually) on the specified resourse.
   */
  public addOperation(key: string) {
    this._changed.add(key);
    this._schedule(key);
  }

  /**
   * Check whether any work is scheduled or in progress.
   */
  public hasPendingOperations() {
    return this._changed.size > 0 || this._operating.size > 0;
  }

  /**
   * Check whether any work is scheduled or in progress for a specific resource.
   */
  public hasPendingOperation(key: string) {
    return this._changed.has(key) || this._operating.has(key);
  }

  /**
   * Take all scheduled operations and re-schedule them for right now.  Useful
   * when shutting down.  Affects retries.  Cannot be undone.  Returns immediately.
   */
  public expediteOperations() {
    this._options.delayBeforeOperationMs = 0;
    this._options.minDelayBetweenOperationsMs = 0;
    for (const op of this._operations.values()) {
      if (op.timeout) {
        this._schedule(op.key, true);
      }
    }
  }

  /**
   * Don't allow any more operations, or retries of existing operations.
   */
  public stopOperations() {
    this._stopped = true;
    this.expediteOperations();
  }

  /**
   * Wait for all operations to complete.  This makes most sense to use during
   * shutdown - otherwise it might be a very long wait to reach a moment where
   * there are no operations.
   */
  public async wait(logRepeat?: (count: number) => void) {
    let repeats: number = 0;
    while (this.hasPendingOperations()) {
      if (repeats && logRepeat) { logRepeat(repeats); }
      await Promise.all([...this._operating.keys(), ...this._changed.keys()]
                        .map(key => this.expediteOperationAndWait(key)));
      repeats++;
    }
  }

  /**
   * Re-schedules any pending operation on a resource for right now.  Returns
   * when operations on the resource are complete.  Does not affect retries.
   */
  public async expediteOperationAndWait(key: string) {
    const status = this._getOperationStatus(key);
    if (status.promise) {
      await status.promise;
      return;
    }
    if (!this._changed.has(key)) { return; }
    const callback = new Promise((resolve) => {
      status.callbacks.push(resolve);
    });
    this._schedule(key, true);
    await callback;
  }

  /**
   * Schedule an operation for a resource.
   * If the operation is already in progress, we do nothing.
   * If the operation has not yet happened, it is rescheduled.
   * If `immediate` is set, the operation is scheduled with no delay.
   */
  private _schedule(key: string, immediate: boolean = false) {
    const status = this._getOperationStatus(key);
    if (status.promise) { return; }
    if (status.timeout) {
      clearTimeout(status.timeout);
      delete status.timeout;
    }
    let ticks = this._options.delayBeforeOperationMs || 0;
    const {lastStart} = this._getOperationHistory(key);
    if (lastStart && this._options.minDelayBetweenOperationsMs && !immediate) {
      ticks = Math.max(ticks, lastStart + this._options.minDelayBetweenOperationsMs - Date.now());
    }
    // Primitive slow-down on retries.
    // Will do nothing if neither delayBeforeOperationMs nor minDelayBetweenOperationsMs
    // are set.
    ticks *= 1 + Math.min(5, status.failures);
    status.timeout = setTimeout(() => this._update(key), immediate ? 0 : ticks);
  }

  private _getOperationStatus(key: string): OperationStatus {
    let status = this._operations.get(key);
    if (!status) {
      status = {
        key,
        failures: 0,
        callbacks: []
      };
      this._operations.set(key, status);
    }
    return status;
  }

  private _getOperationHistory(key: string): OperationHistory {
    let hist = this._history.get(key);
    if (!hist) {
      hist = {};
      this._history.set(key, hist);
    }
    return hist;
  }

  private async _doOp(key: string) {
    if (this._stopped) { throw new Error('operations forcibly stopped'); }
    return this._op(key);
  }

  // Implement the next scheduled operation for a resource.
  private _update(key: string) {
    const status = this._getOperationStatus(key);
    delete status.timeout;

    // We don't have to do anything if there have been no changes.
    if (!this._changed.has(key)) { return; }
    // We don't have to do anything (yet) if an operation is already in progress.
    if (status.promise) { return; }

    // Switch status from changed to operating.
    this._changed.delete(key);
    this._operating.add(key);
    const history = this._getOperationHistory(key);
    history.lastStart = Date.now();

    // Store a promise for the operation.
    status.promise = this._doOp(key).then(() => {
      // Successful push!  Reset failure count, notify callbacks.
      status.failures = 0;
      status.callbacks.forEach(callback => callback());
      status.callbacks = [];
    }).catch(err => {
      // Operation failed.  Increment failure count, notify callbacks.
      status.failures++;
      if (this._options.retry && !this._stopped) {
        this._changed.add(key);
      }
      if (this._options.logError) {
        this._options.logError(key, status.failures, err);
      }
      status.callbacks.forEach(callback => callback(err));
      status.callbacks = [];
    }).then(() => {
      // Clean up and schedule follow-up if necessary.
      this._operating.delete(key);
      delete status.promise;
      if (this._changed.has(key)) {
        this._schedule(key);
      } else {
        // No event information left to track, we can delete our OperationStatus entry.
        if (status.failures === 0 && !status.timeout) {
          this._operations.delete(key);
        }
      }
    });
  }
}

/**
 * Status of an operation.
 */
interface OperationStatus {
  timeout?: NodeJS.Timeout;  // a timeout for a scheduled future operation
  promise?: Promise<void>;   // a promise for an operation that is under way
  key: string;               // the operation key
  failures: number;          // consecutive number of times the operation has failed
  callbacks: Array<(err?: Error) => void>;  // callbacks for notifications when op is done/fails
}


/**
 * History of an operation.
 */
interface OperationHistory {
  lastStart?: number;        // last time operation was started, in ms since epoch
}
