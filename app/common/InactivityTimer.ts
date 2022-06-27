/**
 * InactivityTimer allows to set a function that executes after a certain time of
 * inactivity. Activities can be of two kinds: synchronous or asynchronous. Asynchronous activities,
 * are handle with the `disableUntiFinish` method that takes in a Promise and makes sure that the
 * timer does not start before the promise resolves. Synchronous activities are monitored with the
 * `ping` method which resets the timer if called during inactivity.
 *
 * Timer won't start before any activity happens, but you may simply call ping() after construction
 * to start it. After cb is called, timer is disabled but enabled again if there is more activity.
 *
 * Example usage: InactivityTimer is used internally for implementing the plugins' component
 * deactivation after a certain time of inactivity.
 *
 */

export class InactivityTimer {

  private _timeout?: NodeJS.Timer | null;
  private _counter: number = 0;
  private _enabled: boolean = true;

  constructor(private _callback: () => void, private _delay: number) {}

  // Returns the delay used by InactivityTimer, in ms.
  public getDelay(): number {
    return this._delay;
  }

  // Sets a different delay to use, in ms.
  public setDelay(delayMs: number): void {
    this._delay = delayMs;
    this.ping();
  }

  /**
   * Enable the InactivityTimer and schedule the callback.
   */
  public enable(): void {
    this._enabled = true;
    this.ping();
  }

  /**
   * Clears the timeout and prevents the callback from being called until enable() is called.
   */
  public disable(): void {
    this._enabled = false;
    this._clearTimeout();
  }

  /**
   * Returns whether the InactivityTimer is enabled. If not, the callback will not be scheduled.
   */
  public isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * Whether the callback is currently scheduled, and would trigger if there is no activity and if
   * it's not disabled before it triggers.
   */
  public isScheduled(): boolean {
    return Boolean(this._timeout);
  }

  /**
   * Resets the timer if called during inactivity.
   */
  public ping() {
    if (!this._counter && this._enabled) {
      this._setTimeout();
    }
  }

  /**
   * The `disableUntilFinish` method takes in a promise and makes sure the timer won't start before
   * it resolves. It returns a promise that resolves to the same object.
   */
  public async disableUntilFinish<T>(promise: Promise<T>): Promise<T> {
    this._beginActivity();
    try {
      return await promise;
    } finally {
      this._endActivity();
    }
  }

  private _beginActivity() {
    this._counter++;
    this._clearTimeout();
  }

  private _endActivity() {
    this._counter = Math.max(this._counter - 1, 0);
    this.ping();
  }

  private _clearTimeout() {
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
  }

  private _setTimeout() {
    this._clearTimeout();
    this._timeout = setTimeout(() => this._onTimeoutTriggered(), this._delay);
  }

  private _onTimeoutTriggered() {
    this._clearTimeout();
    // _counter is set to 0, even if there's no reason why it should be any thing else.
    this._counter = 0;
    this._callback();
  }
}
