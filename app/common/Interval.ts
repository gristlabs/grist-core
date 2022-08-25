export interface IntervalOptions {
  /**
   * Handler for errors that are thrown from the callback.
   */
  onError: (e: unknown) => void;
}

export interface IntervalDelay {
  // The base delay in milliseconds.
  delayMs: number;
  // If set, randomizes the base delay (per interval) by this amount of milliseconds.
  varianceMs?: number;
}

/**
 * Interval takes a function to execute, and calls it on an interval based on
 * the provided delay.
 *
 * Supports both fixed and randomized delays between intervals.
 */
export class Interval {
  private _timeout?: NodeJS.Timeout | null;
  private _lastPendingCall?: Promise<unknown> | unknown;
  private _timeoutDelay?: number;
  private _stopped: boolean = true;

  constructor(
    private _callback: () => Promise<unknown> | unknown,
    private _delay: IntervalDelay,
    private _options: IntervalOptions
  ) {}

  /**
   * Sets the timeout and schedules the callback to be called on interval.
   */
  public enable(): void {
    this._stopped = false;
    this._setTimeout();
  }

  /**
   * Clears the timeout and prevents the next call from being scheduled.
   *
   * This method does not currently cancel any pending calls. See `disableAndFinish`
   * for an async version of this method that supports waiting for the last pending
   * call to finish.
   */
  public disable(): void {
    this._stopped = true;
    this._clearTimeout();
  }

  /**
   * Like `disable`, but also waits for the last pending call to finish.
   */
  public async disableAndFinish(): Promise<void> {
    this.disable();
    await this._lastPendingCall;
  }

  /**
   * Gets the delay in milliseconds of the next scheduled call.
   *
   * Primarily useful for tests.
   */
  public getDelayMs(): number | undefined {
    return this._timeoutDelay;
  }

  private _clearTimeout() {
    if (!this._timeout) { return; }

    clearTimeout(this._timeout);
    this._timeout = null;
  }

  private _setTimeout() {
    this._clearTimeout();
    this._timeoutDelay = this._computeDelayMs();
    this._timeout = setTimeout(() => this._onTimeoutTriggered(), this._timeoutDelay);
  }

  private _computeDelayMs() {
    const {delayMs, varianceMs} = this._delay;
    if (varianceMs !== undefined) {
      // Randomize the delay by the specified amount of variance.
      const [min, max] = [delayMs - varianceMs, delayMs + varianceMs];
      return Math.floor(Math.random() * (max - min + 1)) + min;
    } else {
      return delayMs;
    }
  }

  private async _onTimeoutTriggered() {
    this._clearTimeout();
    try {
      await (this._lastPendingCall = this._callback());
    } catch (e: unknown) {
      this._options.onError(e);
    }
    if (!this._stopped) {
      this._setTimeout();
    }
  }
}
