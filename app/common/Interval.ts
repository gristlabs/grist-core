export interface IntervalOptions {
  /**
   * Handler for errors that are thrown from the callback.
   */
  onError: (e: unknown) => void;
}

type IntervalDelay = number | DelayOptions;

interface DelayOptions {
  /**
   * The base delay in milliseconds.
   */
  delayMs: number;
  /**
   * If set, randomizes the base delay (per interval) by this amount of milliseconds.
   */
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
  private _inProgressCall?: Promise<unknown> | unknown | null;
  private _rescheduledDelay?: IntervalDelay | null;
  private _timeoutDelayMs?: number | null;
  private _stopped: boolean = true;

  constructor(
    private _callback: () => Promise<unknown> | unknown,
    private _delay: IntervalDelay,
    private _options: IntervalOptions
  ) {}

  /**
   * Starts calling the callback on interval.
   */
  public enable(): void {
    if (!this._stopped) {
      return;
    }

    this._stopped = false;
    this._setTimeout();
  }

  /**
   * Stops calling the callback on interval.
   *
   * Note that this method does not cancel or wait for calls in progress. For a
   * variant that awaits in progress calls, see `disableAndFinish`.
   */
  public disable(): void {
    this._stopped = true;
    this._clearTimeout();
  }

  /**
   * Stops calling the callback on interval and waits for calls in progress.
   */
  public async disableAndFinish(): Promise<void> {
    this.disable();
    await this._inProgressCall;
  }

  /**
   * Re-schedules the next call to occur immediately.
   */
  public scheduleImmediateCall(): void {
    if (this._stopped) {
      return;
    }

    this._rescheduledDelay = 0;
    if (!this._inProgressCall) {
      this._setTimeout();
    }
  }

  /**
   * Gets the delay in milliseconds of the next scheduled call.
   */
  public getDelayMs(): number | undefined | null {
    return this._timeoutDelayMs;
  }

  private _clearTimeout() {
    if (!this._timeout) { return; }

    clearTimeout(this._timeout);
    this._timeout = null;
    this._timeoutDelayMs = null;
  }

  private _setTimeout() {
    this._clearTimeout();
    this._timeoutDelayMs = this._computeDelayMs();
    this._timeout = setTimeout(() => this._onTimeoutTriggered(), this._timeoutDelayMs);
    this._rescheduledDelay = null;
  }

  private _computeDelayMs() {
    let delayMs: number;
    let varianceMs: number | undefined;
    const delay = this._rescheduledDelay ?? this._delay;
    if (typeof delay === "number") {
      delayMs = delay;
    } else {
      delayMs = delay.delayMs;
      varianceMs = delay.varianceMs;
    }
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
      await (this._inProgressCall = this._callback());
    } catch (e: unknown) {
      this._options.onError(e);
    } finally {
      this._inProgressCall = null;
    }
    if (!this._stopped) {
      this._setTimeout();
    }
  }
}
