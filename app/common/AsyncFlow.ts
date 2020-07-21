/**
 * This module is a helper for asynchronous work. It allows resources acquired asynchronously to
 * be conveniently and reliably released.
 *
 * Usage:
 * (1) Implement a function `myFunc(flow: AsyncFlow)`. The `flow` argument provides some helpers:
 *
 *      // Create a disposable, making it owned by the flow. It will be disposed when the flow
 *      // ends, whether successfully, on error, or by being cancelled.
 *      const foo = Foo.create(flow, ...);
 *
 *      // As with Disposables in general, schedule a callback to be called when the flow ends.
 *      flow.onDispose(...);
 *
 *      // Release foo from the flow's ownership, and give its ownership to another object. This way
 *      // `other` will be responsible for disposing foo, and not flow.
 *      other.autoDispose(flow.release(foo))
 *
 *      // Abort the flow (by throwing CancelledError) if cancellation is requested. This should
 *      // be called after async work, in case the flow shouldn't be continued.
 *      checkIfCancelled();
 *
 * (2) Call `runner = FlowRunner.create(owner, myFunc)`. The flow will start. Once myFunc's
 *     promise resolves (including on failure), the objects owned by the flow will be disposed.
 *
 *     The runner exposes the promise for when the flow ends as `runner.resultPromise`.
 *
 *     If the runner itself is disposed, the flow will be cancelled, and disposed once it notices
 *     the cancellation.
 *
 * To replace one FlowRunner with another, put it in a grainjs Holder.
 */
import {Disposable, IDisposable} from 'grainjs';

type DisposeListener = ReturnType<Disposable["onDispose"]>;

export class CancelledError extends Error {}

export class FlowRunner extends Disposable {
  public resultPromise: Promise<void>;

  constructor(func: (flow: AsyncFlow) => Promise<void>) {
    super();
    const flow = AsyncFlow.create(null);
    async function runFlow() {
      try {
        return await func(flow);
      } finally {
        flow.dispose();
      }
    }
    this.resultPromise = runFlow();
    this.onDispose(flow.cancel, flow);
  }
}

export class AsyncFlow extends Disposable {
  private _handles = new Map<IDisposable, DisposeListener>();
  private _isCancelled = false;

  public autoDispose<T extends IDisposable>(obj: T): T {
    const lis = this.onDispose(obj.dispose, obj);
    this._handles.set(obj, lis);
    return obj;
  }

  public release<T extends IDisposable>(obj: T): T {
    const h = this._handles.get(obj);
    if (h) { h.dispose(); }
    this._handles.delete(obj);
    return obj;
  }

  public checkIfCancelled() {
    if (this._isCancelled) {
      throw new CancelledError('cancelled');
    }
  }

  public cancel() {
    this._isCancelled = true;
  }
}
