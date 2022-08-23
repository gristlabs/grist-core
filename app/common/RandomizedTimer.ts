/**
 * RandomizedTimer takes a function to execute, and calls it on a randomized interval
 * between the minimum and maximum delay. The interval delay is randomized between
 * each scheduled call.
 */
export class RandomizedTimer {
  private _timeout?: NodeJS.Timeout | null;

  constructor(
    private _callback: () => void,
    private _minDelayMs: number,
    private _maxDelayMs: number,
  ) {}

  /**
   * Sets the timeout and schedules the callback to be called.
   */
  public enable(): void {
    this._setTimeout();
  }

  /**
   * Clears the timeout and prevents the callback from being called.
   */
  public disable(): void {
    this._clearTimeout();
  }

  private _clearTimeout() {
    if (!this._timeout) { return; }

    clearTimeout(this._timeout);
    this._timeout = null;
  }

  private _setTimeout() {
    this._clearTimeout();
    const [min, max] = [this._minDelayMs, this._maxDelayMs];
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    this._timeout = setTimeout(() => this._onTimeoutTriggered(), delay);
  }

  private _onTimeoutTriggered() {
    this._clearTimeout();
    this._callback();
    this._setTimeout();
  }
}
