/**
 * RefCountMap maintains a reference-counted key-value map. Its sole method is use(key) which
 * increments the counter for the key, and returns a disposable object which exposes the value via
 * the get() method, and decrements the counter back on disposal.
 *
 * The value is constructed on first reference using options.create(key) callback. After the last
 * reference is gone, and an optional gracePeriodMs elapsed, the value is cleaned up using
 * options.dispose(key, value) callback.
 */
import {IDisposable} from 'grainjs';

export interface IRefCountSub<Value> extends IDisposable {
  get(): Value;
  dispose(): void;
}

export class RefCountMap<Key, Value> implements IDisposable {
  private _map: Map<Key, RefCountValue<Value>> = new Map();
  private _createKey: (key: Key) => Value;
  private _disposeKey: (key: Key, value: Value) => void;
  private _gracePeriodMs: number;

  /**
   * Values are created using options.create(key) on first use. They are disposed after last use,
   * using options.dispose(key, value). If options.gracePeriodMs is greater than zero, values
   * stick around for this long after last use.
   */
  constructor(options: {
    create: (key: Key) => Value,
    dispose: (key: Key, value: Value) => void,
    gracePeriodMs: number,
  }) {
    this._createKey = options.create;
    this._disposeKey = options.dispose;
    this._gracePeriodMs = options.gracePeriodMs;
  }

  /**
   * Use a value, constructing it if needed, or only incrementing the reference count if this key
   * is already in the map. The returned subscription object has a get() method which returns the
   * actual value, and a dispose() method, which must be called to release this subscription (i.e.
   * decrement back the reference count).
   */
  public use(key: Key): IRefCountSub<Value> {
    const rcValue = this._useKey(key);
    return {
      get: () => rcValue.value,
      dispose: () => this._releaseKey(rcValue, key),
    };
  }

  /**
   * Return the value for the key, if one is set, or undefined otherwise, without touching
   * reference counts.
   */
  public get(key: Key): Value|undefined {
    return this._map.get(key)?.value;
  }

  /**
   * Purge a key by immediately removing it from the map. Disposing the remaining IRefCountSub
   * values will be no-ops.
   */
  public purgeKey(key: Key): void {
    // Note that we must be careful that disposing stale IRefCountSub values is a no-op even when
    // the same key gets re-added to the map after purgeKey.
    this._doDisposeKey(key);
  }

  /**
   * Disposing clears the map immediately, and calls options.dispose on all values.
   */
  public dispose(): void {
    // Note that a clear() method like this one would not be OK. If the map were to continue being
    // used after clear(), subscriptions created before clear() would wreak havoc when disposed.
    for (const [key, r] of this._map) {
      r.count = 0;
      this._disposeKey.call(null, key, r.value);
    }
    this._map.clear();
  }

  // For testing: set gracePeriodMs, returning the previous value.
  public testSetGracePeriodMs(ms: number): number {
    const prev = this._gracePeriodMs;
    this._gracePeriodMs = ms;
    return prev;
  }

  private _useKey(key: Key): RefCountValue<Value> {
    const r = this._map.get(key);
    if (r) {
      r.count += 1;
      r.unsetTimeout();
      return r;
    }
    const value = this._createKey.call(null, key);
    const rcValue = new RefCountValue(value);
    this._map.set(key, rcValue);
    return rcValue;
  }

  private _releaseKey(r: RefCountValue<Value>, key: Key): void {
    if (r.count > 0) {
      r.count -= 1;
      if (r.count === 0) {
        if (this._gracePeriodMs > 0) {
          if (!r.disposeTimeout) {
            r.disposeTimeout = setTimeout(() => this._doDisposeKey(key), this._gracePeriodMs);
          }
        } else {
          this._doDisposeKey(key);
        }
      }
    }
  }

  private _doDisposeKey(key: Key): void {
    const r = this._map.get(key);
    if (r) {
      this._map.delete(key);
      r.count = 0;
      r.unsetTimeout();   // Important, to avoid timeout triggering after the same key is re-added.
      this._disposeKey.call(null, key, r.value);
    }
  }
}

/**
 * This is an implementation detail of the RefCountMap, which represents a single item.
 */
class RefCountValue<Value> {
  public count: number = 1;
  public disposeTimeout?: ReturnType<typeof setTimeout> = undefined;
  constructor(public value: Value) {}

  public unsetTimeout() {
    if (this.disposeTimeout) {
      clearTimeout(this.disposeTimeout);
      this.disposeTimeout = undefined;
    }
  }
}
