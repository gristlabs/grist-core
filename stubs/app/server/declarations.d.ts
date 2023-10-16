// Copy official sqlite3 types to apply to @gristlabs/sqlite3.
declare module "@gristlabs/sqlite3" {
  export * from 'sqlite3';

  // Add minimal typings for sqlite backup api.
  // TODO: remove this once the type definitions are updated upstream.
  import {Database} from 'sqlite3';
  export class Backup {
    public readonly remaining: number;
    public readonly pageCount: number;
    public readonly idle: boolean;
    public readonly completed: boolean;
    public readonly failed: boolean;
    public step(pages: number, callback?: (err: Error|null) => void): void;
  }
  export class DatabaseWithBackup extends Database {
    public backup(filename: string, callback?: (err: Error|null) => void): Backup;
    public backup(filename: string, destDbName: 'main', srcDbName: 'main',
                  filenameIsDest: boolean, callback?: (err: Error|null) => void): Backup;
  }
}


// Add declarations of the promisified methods of redis.
// This is not exhaustive, there are a *lot* of methods.

declare module "redis" {
  function createClient(url?: string): RedisClient;

  class RedisClient {
    public eval(args: any[], callback?: (err: Error | null, res: any) => void): any;

    public subscribe(channel: string): void;
    public on(eventType: string, callback: (...args: any[]) => void): void;
    public publishAsync(channel: string, message: string): Promise<number>;

    public delAsync(key: string): Promise<'OK'>;
    public flushdbAsync(): Promise<void>;
    public getAsync(key: string): Promise<string|null>;
    public hdelAsync(key: string, field: string): Promise<number>;
    public hgetallAsync(key: string): Promise<{[field: string]: any}|null>;
    public hkeysAsync(key: string): Promise<string[]|null>;
    public hmsetAsync(key: string, val: {[field: string]: any}): Promise<'OK'>;
    public hsetAsync(key: string, field: string, val: string): Promise<1|0>;
    public keysAsync(pattern: string): Promise<string[]>;
    public multi(): Multi;
    public quitAsync(): Promise<void>;
    public saddAsync(key: string, val: string): Promise<'OK'>;
    public selectAsync(db: number): Promise<void>;
    public setAsync(key: string, val: string): Promise<'OK'>;
    public setexAsync(key: string, ttl: number, val: string): Promise<'OK'>;
    public sismemberAsync(key: string, val: string): Promise<0|1>;
    public smembersAsync(key: string): Promise<string[]>;
    public srandmemberAsync(key: string): Promise<string|null>;
    public sremAsync(key: string, val: string): Promise<'OK'>;
    public ttlAsync(key: string): Promise<number|null>;
    public unwatchAsync(): Promise<'OK'>;
    public watchAsync(key: string): Promise<void>;
    public lrangeAsync(key: string, start: number, end: number): Promise<string[]>;
    public rpushAsync(key: string, ...vals: string[]): Promise<number>;
    public pingAsync(): Promise<string>;
  }

  class Multi {
    public del(key: string): Multi;
    public execAsync(): Promise<any[]|null>;
    public get(key: string): Multi;
    public hgetall(key: string): Multi;
    public hmset(key: string, val: {[field: string]: any}): Multi;
    public hset(key: string, field: string, val: string): Multi;
    public sadd(key: string, val: string): Multi;
    public set(key: string, val: string): Multi;
    public setex(key: string, ttl: number, val: string): Multi;
    public ttl(key: string): Multi;
    public smembers(key: string): Multi;
    public srandmember(key: string): Multi;
    public srem(key: string, val: string): Multi;
    public rpush(key: string, ...vals: string[]): Multi;
    public ltrim(key: string, start: number, end: number): Multi;
    public incr(key: string): Multi;
    public expire(key: string, seconds: number): Multi;
  }
}
