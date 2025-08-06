import {mapGetOrSet, MapWithCustomExpire} from 'app/common/AsyncCreate';
import {makeId} from 'app/server/lib/idUtils';
import {IPubSubManager, UnsubscribeCallbackPromise} from 'app/server/lib/PubSubManager';

/**
 * Cache of value, with a TTL and invalidations.
 */
export class PubSubCache<Key, Value> {
  private _selfId: string = makeId();

  // Invariant: if _cache[key] is set, then _watchedKeys[key] is set.
  private _cache: MapWithCustomExpire<Key, Promise<Value>>;
  private _watchedKeys = new Map<Key, UnsubscribeCallbackPromise>();

  constructor(private _options: {
    pubSubManager: IPubSubManager,
    fetch: (key: Key) => Promise<Value>;      // Fetch the value corresponding to the given key.
    getChannel: (key: Key) => string;         // Turn a key into a channel to use for pub-sub.
    ttlMs: number;    // How long to cache the value; we subscribe to invalidations until it expires.
  }) {
    this._cache = new MapWithCustomExpire<Key, Promise<Value>>(this._options.ttlMs, this._onExpire.bind(this));
  }

  /**
   * Get the value at the given key. It will use the cache, or fetch the value if needed. It will
   * reset the expiration, and will subscribe to pubsub invalidations, if not yet subscribed.
   */
  public getValue(key: Key): Promise<Value> {
    // If there is a cached key, use directly; otherwise, get or create a subscription, and wait
    // it to take effect, to be sure to catch any invalidation that happens after the fetch.
    return mapGetOrSet(this._cache, key, async () => {
      // Find key in _watchedKeys, or create a new subscription to invalidations.
      await mapGetOrSet(this._watchedKeys, key, () => this._subscribe(key));
      return this._options.fetch(key);
    });
  }

  /**
   * Invalidate the given keys, across PubSubCache instances in all servers. In the current
   * server, the invalidation is synchronous.
   */
  public async invalidateKeys(keys: Key[]) {
    // Invalidate our own cache synchronously.
    for (const key of keys) {
      this._cache.delete(key);
    }
    // They key to invalidate is in the channel name; for the message, we only include our own
    // unique ID to avoid a duplicate invalidation when we receive our own published message.
    await this._options.pubSubManager.publishBatch(
      keys.map(key => ({channel: this._options.getChannel(key), message: this._selfId})));
  }

  /**
   * Clear the cache and remove all pubsub subscriptions.
   */
  public clear() {
    this._cache.clear();
    try {
      for (const ucbPromise of this._watchedKeys.values()) {
        ucbPromise.unsubscribeCB();
      }
    } finally {
      this._watchedKeys.clear();
    }
  }

  /**
   * Create a pubsub subscription to invalidation messages for the given key.
   */
  private _subscribe(key: Key): UnsubscribeCallbackPromise {
    return this._options.pubSubManager.subscribe(this._options.getChannel(key),
      // When we receive a message, process the invalidation unless it matches our own unique
      // ID, which indicates this invalidation came from us and already got processed.
      (msg) => (msg === this._selfId ? null : this._cache.delete(key))
    );
  }

  /**
   * When a key expires, unsubscribe from pubsub. We'll re-subscribe next time we need it.
   */
  private _onExpire(key: Key) {
    const ucbPromise = this._watchedKeys.get(key);
    this._watchedKeys.delete(key);
    ucbPromise?.unsubscribeCB();
  }
}
