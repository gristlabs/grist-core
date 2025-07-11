/**
 * RedisPubSubManager simplifies and optimizes pub-sub with Redis:
 *
 * 1. It's a single object in the server, reusing a pair of connections, so that other code
 *    doesn't need to create or maintain additional connections.
 * 2. It exposes a simple interface.
 * 3. It provides an in-memory fallback, to avoid the need for special code paths for
 *    single-server instances without Redis available.
 * 4. It automatically prefixes channels to scope them to the current Redis database using
 *    getPubSubPrefix(), so that calling code doesn't have to worry about it.
 */
import {getPubSubPrefix} from 'app/server/lib/serverUtils';
import log from 'app/server/lib/log';
import {arrayRemove, removePrefix} from 'app/common/gutil';
import IORedis from "ioredis";

/**
 * Creates a new PubSubManager, either redis-based or in-memory, depending on whether redisUrl is
 * truthy. E.g. createPubSubManager(process.env.REDIS_URL).
 */
export function createPubSubManager(redisUrl: string|undefined): IPubSubManager {
  return redisUrl ?
    new PubSubManagerRedis(redisUrl) :
    new PubSubManagerNoRedis();
}

// See PubSubManagerBase below for documentation.
export interface IPubSubManager {
  close(): Promise<void>;
  subscribe(channel: string, callback: Callback): UnsubscribeCallback;
  publish(channel: string, message: string): Promise<void>;
}

export type Callback = (message: string) => void;
export type UnsubscribeCallback = () => void;

abstract class PubSubManagerBase implements IPubSubManager {
  protected _subscriptions = new Map<string, Callback[]>();

  constructor() {}

  /**
   * Close the manager, and close any connections used.
   */
  public async close() {
    this._subscriptions.clear();
  }

  /**
   * Subscribes to the given channel with the given callback. Returns a cleanup function which you
   * should call to remove this subscription.
   *
   * - In Redis, the channel gets prefixed with getPubSubPrefix() to scope it to the current Redis DB.
   * - It's OK to subscribe multiple callbacks to the same channel. When the last one is removed,
   *   the Redis subscription get removed.
   */
  public subscribe(channel: string, callback: Callback): UnsubscribeCallback {
    const subs = this._subscriptions.get(channel);
    if (subs) {
      subs.push(callback);
    } else {
      this._redisSubscribe(channel)
        .catch(err => log.error(`PubSubManager: failed to subscribe to ${channel}`, err));
      this._subscriptions.set(channel, [callback]);
    }
    return () => this._unsubscribe(channel, callback);
  }

  /**
   * Publishes a message to the given channel.
   *
   * - In Redis, the channel gets prefixed with getPubSubPrefix() to scope it to the current Redis DB.
   */
  public abstract publish(channel: string, message: string): Promise<void>;

  protected abstract _redisSubscribe(channel: string): Promise<void>;
  protected abstract _redisUnsubscribe(channel: string): Promise<void>;

  protected _deliverMessage(channel: string, message: string) {
    const callbacks = this._subscriptions.get(channel);
    callbacks?.forEach(cb => cb(message));
  }

  private _unsubscribe(channel: string, callback: Callback): void {
    const callbacks = this._subscriptions.get(channel);
    if (callbacks) {
      arrayRemove(callbacks, callback);
      if (callbacks.length === 0) {
        this._subscriptions.delete(channel);
        this._redisUnsubscribe(channel)
          .catch(err => log.error(`PubSubManager: failed to unsubscribe from ${channel}`, err));
      }
    }
  }
}

class PubSubManagerNoRedis extends PubSubManagerBase {
  public async publish(channel: string, message: string) { this._deliverMessage(channel, message); }
  protected async _redisSubscribe(channel: string): Promise<void> {}
  protected async _redisUnsubscribe(channel: string): Promise<void> {}
}

class PubSubManagerRedis extends PubSubManagerBase {
  private _redisSub: IORedis;
  private _redisPub: IORedis;
  private _pubSubPrefix: string = getPubSubPrefix();

  constructor(redisUrl: string) {
    super();
    // Redis acting as a subscriber can't run other commands. Need a separate one for publishing.
    this._redisSub = new IORedis(redisUrl);
    this._redisPub = new IORedis(redisUrl);

    this._redisSub.on('message', (fullChannel, message) => {
      const channel = this._unprefixChannel(fullChannel);
      if (channel != null) {
        this._deliverMessage(channel, message);
      }
    });
  }

  public async close() {
    await Promise.all([
      this._redisSub.disconnect(),
      this._redisPub.disconnect()
    ]);
    await super.close();
  }

  public async publish(channel: string, message: string): Promise<void> {
    await this._redisPub.publish(this._prefixChannel(channel), message);
  }

  protected async _redisSubscribe(channel: string): Promise<void> {
    await this._redisSub.subscribe(this._prefixChannel(channel));
  }

  protected async _redisUnsubscribe(channel: string): Promise<void> {
    await this._redisSub.unsubscribe(this._prefixChannel(channel));
  }

  private _prefixChannel = (channel: string) => this._pubSubPrefix + channel;
  private _unprefixChannel = (fullChannel: string) => removePrefix(fullChannel, this._pubSubPrefix);
}
