import { ApiError } from "app/common/ApiError";
import { appSettings } from "app/server/lib/AppSettings";
import { docApiUsagePeriods, getDocApiUsageKeysToIncr } from "app/server/lib/DocApi";
import log from "app/server/lib/log";

import LRUCache from "lru-cache";
import * as moment from "moment";
import { RedisClient } from "redis";

// Upper bound on number of docs being actively used via API at any moment.
// If there are more docs than this, the _dailyUsage cache may become unreliable.
const MAX_ACTIVE_DOCS_USAGE_CACHE = 1000;

export interface DocApiUsageTrackerOptions {
  getRedisClient?: () => RedisClient | null;
}

/**
 * Tracks per-document API usage: parallel request limits and daily usage limits.
 * Shared between REST API (DocWorkerApi) and WebSocket (activeDocMethod) paths
 * so that both protocols consume the same rate-limit budget.
 */
export class DocApiUsageTracker {
  // Map from docId to number of requests currently being handled for that doc.
  private _currentUsage = new Map<string, number>();

  // Map from (docId, time period) key to number of requests served.
  // We multiply by 5 because there are 5 relevant keys per doc at any time
  // (current/next day/hour and current minute).
  private _dailyUsage = new LRUCache<string, number>({ max: 5 * MAX_ACTIVE_DOCS_USAGE_CACHE });

  // Cap on the number of parallel requests per document. 0 means unlimited.
  private _maxParallelRequestsPerDoc = appSettings.section("docApi").flag("maxParallelRequestsPerDoc")
    .requireInt({
      envVar: "GRIST_MAX_PARALLEL_REQUESTS_PER_DOC",
      defaultValue: 10,
      minValue: 0,
    });

  private _getRedisClient: () => RedisClient | null;

  constructor(options: DocApiUsageTrackerOptions = {}) {
    this._getRedisClient = options.getRedisClient ?? (() => null);
  }

  /**
   * Check parallel and daily limits for a document. Throws ApiError(429) if exceeded.
   *
   * The parallel counter is incremented unconditionally before checking limits,
   * so callers MUST call release() in a finally block even if acquire() throws.
   *
   * @param docId - The document ID.
   * @param dailyMax - The daily API usage limit. If undefined, skip daily check.
   */
  public acquire(docId: string, dailyMax: number | undefined): void {
    // Increment first — caller must release() in a finally block even on rejection.
    const count = this._currentUsage.get(docId) || 0;
    this._currentUsage.set(docId, count + 1);
    if (this._maxParallelRequestsPerDoc > 0 && count + 1 > this._maxParallelRequestsPerDoc) {
      throw new ApiError(`Too many backlogged requests for document ${docId} - ` +
        `try again later?`, 429);
    }

    if (dailyMax !== undefined && dailyMax > 0) {
      if (this._checkAndUpdateDailyUsageExceeded(docId, dailyMax)) {
        throw new ApiError(`Exceeded daily limit for document ${docId}`, 429);
      }
    }
  }

  /**
   * Release one parallel request slot for a document.
   */
  public release(docId: string): void {
    const count = this._currentUsage.get(docId);
    if (count) {
      if (count === 1) {
        this._currentUsage.delete(docId);
      } else {
        this._currentUsage.set(docId, count - 1);
      }
    }
  }

  /**
   * Check whether daily usage has been exceeded for a document, and if not,
   * increment the usage counters. Returns true if the limit has been exceeded.
   */
  private _checkAndUpdateDailyUsageExceeded(docId: string, dailyMax: number): boolean {
    const m = moment.utc();
    const keys = getDocApiUsageKeysToIncr(docId, this._dailyUsage, dailyMax, m);
    if (!keys) {
      // The limit has been exceeded, reject the request.
      return true;
    }

    // Always increment local cache to prevent bursts between Redis updates (or when Redis
    // isn't configured at all).
    for (const key of keys) {
      this._dailyUsage.set(key, (this._dailyUsage.get(key) ?? 0) + 1);
    }

    // If Redis is available, also track there for cross-worker consistency.
    const cli = this._getRedisClient();
    if (cli) {
      const multi = cli.multi();
      for (let i = 0; i < keys.length; i++) {
        const period = docApiUsagePeriods[i];
        // Expire after two periods to handle 'next' buckets.
        const expiry = 2 * 24 * 60 * 60 / period.periodsPerDay;
        multi.incr(keys[i]).expire(keys[i], expiry);
      }
      multi.execAsync().then((result) => {
        for (let i = 0; i < keys.length; i++) {
          const newCount = Number(result![i * 2]);
          // Redis count may be higher if other workers are also incrementing.
          this._dailyUsage.set(keys[i], newCount);
        }
      }).catch(e => log.error(`Error tracking API usage for doc ${docId}: ${e}`));
    }

    return false;
  }
}
