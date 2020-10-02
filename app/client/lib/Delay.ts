/**
 * A little class to make it easier to work with setTimeout/clearTimeout when it may need to get
 * cancelled or rescheduled.
 */

import {Disposable} from 'app/client/lib/dispose';

export class Delay extends Disposable {

  /**
   * Returns a function which will schedule a call to cb(), forwarding the arguments.
   * This is a static method that may be used without a Delay object.
   * E.g. wrapWithDelay(10, cb)(1,2,3) will call cb(1,2,3) in 10ms.
   */
  public static wrapWithDelay(ms: number, cb: (this: void, ...args: any[]) => any,
                              optContext?: any): (...args: any[]) => void;
  public static wrapWithDelay<T>(ms: number, cb: (this: T, ...args: any[]) => any,
                                 optContext: T): (...args: any[]) => void {
    return function(this: any, ...args: any[]) {
      const ctx = optContext || this;
      setTimeout(() => cb.apply(ctx, args), ms);
    };
  }

  /**
   * Returns a wrapped callback whose execution is delayed until the next animation frame. The
   * returned callback may be disposed to cancel the delayed execution.
   */
  public static untilAnimationFrame(cb: (this: void, ...args: any[]) => void,
                                    optContext?: any): DisposableCB;
  public static untilAnimationFrame<T>(cb: (this: T, ...args: any[]) => void,
                                       optContext: T): DisposableCB {
    let reqId: number|null = null;
    const f = function(...args: any[]) {
      if (reqId === null) {
        reqId = window.requestAnimationFrame(() => {
          reqId = null;
          cb.apply(optContext, args);
        });
      }
    };
    f.dispose = function() {
      if (reqId !== null) {
        window.cancelAnimationFrame(reqId);
      }
    };
    return f;
  }

  private _timeoutId: ReturnType<typeof setTimeout> | null = null;

  public create() {
    this.autoDisposeCallback(this.cancel);
  }

  /**
   * If there is a scheduled callback, clear it.
   */
  public cancel() {
    if (this._timeoutId !== null) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
  }

  /**
   * Returns whether there is a scheduled callback.
   */
  public isPending() {
    return this._timeoutId !== null;
  }

  /**
   * Schedule a new callback, to be called in ms milliseconds, optionally bound to the passed-in
   * arguments. If another callback was scheduled, it is cleared first.
   */

  public schedule(ms: number, cb: (this: void, ...args: any[]) => any, optContext?: any, ...optArgs: any[]): void;
  public schedule<T>(ms: number, cb: (this: T, ...args: any[]) => any, optContext: T, ...optArgs: any[]): void {
    this.cancel();
    this._timeoutId = setTimeout(() => {
      this._timeoutId = null;
      cb.apply(optContext, optArgs);
    }, ms);
  }
}

export interface DisposableCB {
  (...args: any[]): void;
  dispose(): void;
}
