import { DisposableWithEvents } from 'app/common/DisposableWithEvents';
import { Disposable, IDisposable, IDisposableOwner, Observable } from 'grainjs';

/**
 * A simple abstraction for events composition. It is an object that can emit a single value of type T,
 * and holds the last value emitted. It can be used to compose events from other events.
 *
 * Simple observables can't be used for this purpose because they are not reentrant. We can't update
 * an observable from within a listener, because it won't trigger a new event.
 *
 * This class is basically a wrapper around Observable, that emits events when the value changes after it is
 * set.
 *
 * Example:
 *  const signal = Signal.create(null, 0);
 *  signal.listen(value => console.log(value));
 *  const onlyEven = signal.filter(value => value % 2 === 0);
 *  onlyEven.listen(value => console.log('even', value));
 *
 *  const flag1 = Signal.create(null, false);
 *  const flag2 = Signal.create(null, false);
 *  const flagAnd = Signal.compute(null, on => on(flag1) && on(flag2));
 *  // This will still emit multiple times with the same value repeated.
 *  flagAnd.listen(value => console.log('Both are true', value));
 *
 *  // This will emit only when both are true, and will ignore further changes while both are true.
 *  const toggle = flagAnd.distinct();
 *
 *  // Current value can be accessed via signal.state.get()
 *  const emitter = Signal.from(null, 0);
 *  // Emit values only when the toggle is true.
 *  const emitterWhileAnd = emitter.filter(() => toggle.state.get());
 *  // Equivalent to:
 *  const emitterWhileAnd = Signal.compute(null, on => on(toggle) ? on(emitter) : null).distinct();
 */
export class Signal<T = any> implements IDisposable, IDisposableOwner {
  /**
   * Creates a new event with a default value. A convenience method for creating an event that supports
   * generic attribute.
   */
  public static create<T>(owner: IDisposableOwner | null, value: T) {
    return new Signal(owner, value);
  }

  /**
   * Creates an event from a set of events. Holds last value emitted by any of the events.
   */
  public static fromEvents<T = any>(
    owner: Disposable | null,
    emitter: any,
    first: string,
    ...rest: string[]
  ) {
    const signal = Signal.create(owner, null);
    for(const event of [first, ...rest]) {
      signal._emitter.listenTo(emitter, event, (value: any) => signal.emit(value));
    }
    return signal as Signal<T | null>;
  }

  /**
   * Helper methods that creates a signal that emits the result of a function that takes a function
   */
  public static compute<T>(owner: Disposable | null, compute: ComputeFunction<T>) {
    const signal = Signal.create(owner, null as any);
    const on: any = (s: Signal) => {
      if (!signal._listeners.has(s)) {
        signal._listeners.add(s);
        signal._emitter.listenTo(s._emitter, 'signal', () => signal.emit(compute(on)));
      }
      return s.state.get();
    };
    signal.state.set(compute(on));
    return signal as Signal<T>;
  }

  /**
   * Last value emitted if any.
   */
  public state: Observable<T>;

  /**
   * List of signals that we are listening to. Stored in a WeakSet to avoid memory leaks.
   */
  private _listeners: WeakSet<Signal> = new WeakSet();

  /**
   * Flag that can be changed by stateless() function. It won't hold last value (but can't be used in compute function).
   */
  private _emitter: DisposableWithEvents;

  private _beforeHandler: CustomEmitter<T>;

  constructor(owner: IDisposableOwner|null, initialValue: T) {
    this._emitter = DisposableWithEvents.create(owner);
    this.state = Observable.create(this, initialValue);
  }

  public dispose() {
    this._emitter.dispose();
  }

  public autoDispose(disposable: IDisposable) {
    this._emitter.autoDispose(disposable);
  }

  /**
   * Push all events from this signal to another signal.
   */
  public pipe(signal: Signal<T>) {
    this.autoDispose(this.listen(value => signal.emit(value)));
    return this;
  }

  /**
   * Modify all values emitted by this signal.
   */
  public map<Z>(selector: (value: T) => Z): Signal<Z> {
    const signal = Signal.create(this, selector(this.state.get()));
    this.listen(value => {
      signal.emit(selector(value));
    });
    return signal;
  }

  /**
   * Creates a new signal with the same state, but it will only
   * emit those values that pass the test implemented by the provided function.
   */
  public filter(selector: (value: T) => boolean): Signal<T> {
    const signal = Signal.create(this, this.state.get());
    this.listen(value => {
      if (selector(value)) {
        signal.emit(value);
      }
    });
    return signal;
  }

  /**
   * Emit only the value that is different from the previous one.
   */
  public distinct(): Signal<T> {
    let last = this.state.get();
    const signal = this.filter((value: any) => {
      if (value !== last) {
        last = value;
        return true;
      }
      return false;
    });
    signal.state.set(last);
    return signal;
  }

  /**
   * Emits true or false only when the value is changed from truthy to falsy or vice versa.
   */
  public flag() {
    return this.map(Boolean).distinct();
  }

  /**
   * Listen to changes of the signal.
   */
  public listen(handler: (value: T) => any) {
    const stateHandler = () => {
      handler(this.state.get());
    };
    this._emitter.on('signal', stateHandler);
    return {
      dispose: () => this._emitter.off('signal', stateHandler),
    };
  }

  public emit(value: T) {
    if (this._beforeHandler) {
      this._beforeHandler(value, (emitted: T) => {
        this.state.set(emitted);
        this._emitter.trigger('signal', emitted);
      });
    } else {
      this.state.set(value);
      this._emitter.trigger('signal', value);
    }
  }

  public before(handler: CustomEmitter<T>) {
    this._beforeHandler = handler;
  }
}

type ComputeFunction<T> = (on: <TS>(s: Signal<TS>) => TS) => T;
type CustomEmitter<T> = (value: T, emit: (value: T) => void) => any;
