/**
 * Implements a pattern for creating objects requiring asynchronous construction. The given
 * asynchronous createFunc() is called on the .get() call, and the result is cached on success.
 * On failure, the result is cleared, so that subsequent calls attempt the creation again.
 *
 * Usage:
 *  this._obj = new AsyncCreate<MyObject>(asyncCreateFunc);
 *  obj = await this._obj.get();    // calls asyncCreateFunc
 *  obj = await this._obj.get();    // uses cached object if asyncCreateFunc succeeded, else calls it again.
 *
 * Note that multiple calls while createFunc() is running will return the same promise, and will
 * succeed or fail together.
 */
export class AsyncCreate<T> {
  private _value?: Promise<T> = undefined;

  constructor(private _createFunc: () => Promise<T>) {}

  /**
   * Returns createFunc() result, returning the cached promise if createFunc() succeeded, or if
   * another call to it is currently pending.
   */
  public get(): Promise<T> {
    return this._value || (this._value = this._clearOnError(this._createFunc.call(null)));
  }

  /** Clears the cached promise, forcing createFunc to be called again on next get(). */
  public clear(): void {
    this._value = undefined;
  }

  /** Returns a boolean indicating whether the object is created. */
  public isSet(): boolean {
    return Boolean(this._value);
  }

  /** Returns the value if it's set and successful, or undefined otherwise. */
  public async getIfValid(): Promise<T|undefined> {
    return this._value ? this._value.catch(() => undefined) : undefined;
  }

  // Helper which clears this AsyncCreate if the given promise is rejected.
  private _clearOnError(p: Promise<T>): Promise<T> {
    p.catch(() => this.clear());
    return p;
  }
}


/**
 * A simpler version of AsyncCreate: given an async function f, returns another function that will
 * call f once, and cache and return its value. On failure the result is cleared, so that
 * subsequent calls will attempt calling f again.
 */
export function asyncOnce<T>(createFunc: () => Promise<T>): () => Promise<T> {
  let value: Promise<T>|undefined;
  function clearOnError(p: Promise<T>): Promise<T> {
    p.catch(() => { value = undefined; });
    return p;
  }
  return () => (value || (value = clearOnError(createFunc.call(null))));
}


/**
 * Supports a usage similar to AsyncCreate in a Map. Returns map.get(key) if it is set to a
 * resolved or pending promise. Otherwise, calls creator(key) to create and return a new promise,
 * and sets the key to it. If the new promise is rejected, the key will be removed from the map,
 * so that subsequent calls would call creator() again.
 *
 * As with AsyncCreate, while the promise for a key is pending, multiple calls to that key will
 * return the same promise, and will succeed or fail together.
 */
export function mapGetOrSet<K, V>(map: Map<K, Promise<V>>, key: K, creator: (key: K) => Promise<V>): Promise<V> {
  return map.get(key) || mapSetOrClear(map, key, creator(key));
}

/**
 * Supports a usage similar to AsyncCreate in a Map. Sets the given key in a map to the given
 * promise, and removes it later if the promise is rejected. Returns the same promise.
 */
export function mapSetOrClear<K, V>(map: Map<K, Promise<V>>, key: K, pvalue: Promise<V>): Promise<V> {
  pvalue.catch(() => map.delete(key));
  map.set(key, pvalue);
  return pvalue;
}

/**
 * A Map implementation that allows for expiration of old values.
 */
export class MapWithTTL<K, V> extends Map<K, V> {
  private _timeouts = new Map<K, NodeJS.Timer>();

  /**
   * Create a map with keys that will be automatically deleted _ttlMs
   * milliseconds after they have been last set.  Precision of timing
   * may vary.
   */
  constructor(private _ttlMs: number) {
    super();
  }

  /**
   * Set a key, with expiration.
   */
  public set(key: K, value: V): this {
    return this.setWithCustomTTL(key, value, this._ttlMs);
  }

  /**
   * Set a key, with custom expiration.
   */
  public setWithCustomTTL(key: K, value: V, ttlMs: number): this {
    const curr = this._timeouts.get(key);
    if (curr) { clearTimeout(curr); }
    super.set(key, value);
    this._timeouts.set(key, setTimeout(this.delete.bind(this, key), ttlMs));
    return this;
  }

  /**
   * Remove a key.
   */
  public delete(key: K): boolean {
    const result = super.delete(key);
    const timeout = this._timeouts.get(key);
    if (timeout) {
      clearTimeout(timeout);
      this._timeouts.delete(key);
    }
    return result;
  }

  /**
   * Forcibly expire everything.
   */
  public clear(): void {
    for (const timeout of this._timeouts.values()) {
      clearTimeout(timeout);
    }
    this._timeouts.clear();
    super.clear();
  }
}

/**
 * Sometimes it is desirable to cache either fulfilled or rejected
 * outcomes.  This method wraps a promise so that it never throws.
 * The result has an unfreeze method which, when called, is either
 * fulfilled or rejected.
 */
export async function freezeError<T>(promise: Promise<T>): Promise<ErrorOrValue<T>> {
  try {
    const value = await promise;
    return { unfreeze: async () => value };
  } catch (error) {
    return { unfreeze: async () => { throw error; } };
  }
}

export interface ErrorOrValue<T> {
  unfreeze(): Promise<T>;
}
