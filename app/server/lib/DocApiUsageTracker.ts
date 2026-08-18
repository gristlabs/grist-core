import { ApiError } from "app/common/ApiError";
import { commonUrls } from "app/common/gristUrls";
import { appSettings } from "app/server/lib/AppSettings";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import { docApiUsagePeriods, getDocApiUsageKeysToIncr } from "app/server/lib/DocApi";
import log from "app/server/lib/log";
import { getDocId } from "app/server/lib/requestUtils";
import { billingMonthlyApiUsageKey, getDailyMax, getOrgUsageLimit, OrgUsageLimit } from "app/server/lib/usageKeys";

import { NextFunction, RequestHandler, Response } from "express";
import LRUCache from "lru-cache";
import * as moment from "moment";
import { RedisClient } from "redis";

// Upper bound on number of docs being actively used via API at any moment.
// If there are more docs than this, the _dailyUsage cache may become unreliable.
const MAX_ACTIVE_DOCS_USAGE_CACHE = 1000;

// Upper bound on number of orgs being actively used via API at any moment. Kept separate
// from the doc cache so that the short-lived per-minute doc keys cannot evict a monthly
// count, which stands for a whole month of usage.
const MAX_ACTIVE_ORGS_USAGE_CACHE = 1000;

export interface DocApiUsageTrackerOptions {
  getRedisClient?: () => RedisClient | null;
}

type Handler = (req: RequestWithLogin, res: Response, next: NextFunction) => void | Promise<void>;

/**
 * Tracks per-document API usage: parallel request limits and daily usage limits,
 * plus a monthly limit for the whole site the document belongs to.
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

  // Map from (billingAccountId, month) key to number of requests served.
  private _monthlyUsage = new LRUCache<string, number>({ max: MAX_ACTIVE_ORGS_USAGE_CACHE });

  // Reads of a monthly count that are still running, by key.
  private _monthlyRefreshes = new Map<string, Promise<void>>();

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
   * Check parallel, daily and monthly limits for a document. Throws ApiError(429) if exceeded.
   *
   * The parallel counter is incremented unconditionally before checking limits,
   * so callers MUST call release() in a finally block even if acquire() throws.
   *
   * @param docId - The document ID.
   * @param dailyMax - The daily API usage limit. If undefined, skip daily check.
   * @param org - The site the document belongs to. If undefined, skip monthly check.
   */
  public acquire(docId: string, dailyMax: number | undefined, org?: OrgUsageLimit): void {
    // Increment first — caller must release() in a finally block even on rejection.
    const count = this._currentUsage.get(docId) || 0;
    this._currentUsage.set(docId, count + 1);
    if (this._maxParallelRequestsPerDoc > 0 && count + 1 > this._maxParallelRequestsPerDoc) {
      throw new ApiError(`Too many backlogged requests for document ${docId} - ` +
        `try again later?`, 429);
    }

    // Taken once, so that both limits agree on the period even when a request lands on
    // the boundary of a day or a month.
    const now = moment.utc();

    if (isLimitDefined(dailyMax) && this._checkAndUpdateDailyUsageExceeded(docId, dailyMax, now)) {
      throw new ApiError(`Exceeded daily limit for document ${docId}`, 429);
    }

    // Checked after the daily limit so that a request rejected above does not spend any
    // of the monthly budget. A falsy id means the fake org anonymous users get, which has
    // no billing account, and whose counter would otherwise be shared by every site.
    if (org?.billingAccountId && isLimitDefined(org.monthlyMax)) {
      this._checkAndUpdateMonthlyUsage(org.billingAccountId, org.monthlyMax, now);
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
   * Express middleware that enforces parallel, daily and monthly usage limits for a document.
   * Returns an Express RequestHandler so it can be passed directly to app.get/app.post;
   * the `Handler` type uses RequestWithLogin and is too narrow for Express's overloads.
   *
   * Only api traffic counts, as on the websocket path. The web client calls some of these
   * endpoints while a page loads, and those calls are not what the limits are about.
   */
  public throttle(callback: Handler): RequestHandler {
    return async (req, res, next) => {
      const mreq = req as RequestWithLogin;
      if (!mreq.isApiKeyAuth) {
        // Awaited like the call below, or a rejection here would go unhandled.
        try {
          await callback(mreq, res, next);
        } catch (err) {
          next(err);
        }
        return;
      }
      const docId = getDocId(req);
      try {
        const doc = mreq.docAuth!.cachedDoc!;
        this.acquire(docId, getDailyMax(doc), getOrgUsageLimit(doc));
        await callback(mreq, res, next);
      } catch (err) {
        next(err);
      } finally {
        this.release(docId);
      }
    };
  }

  /**
   * Check whether daily usage has been exceeded for a document, and if not,
   * increment the usage counters. Returns true if the limit has been exceeded.
   */
  private _checkAndUpdateDailyUsageExceeded(docId: string, dailyMax: number, m: moment.Moment): boolean {
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

  /**
   * Check whether the site has used up its monthly limit, and if not, count this
   * request against it. Throws ApiError(429) if the limit has been reached.
   */
  private _checkAndUpdateMonthlyUsage(billingAccountId: number, monthlyMax: number, m: moment.Moment): void {
    const cli = this._getRedisClient();
    // Without redis the count would be per worker, and the pages showing it read it from
    // redis, so a limit would be enforced that nobody can see.
    if (!cli) { return; }
    const key = billingMonthlyApiUsageKey(billingAccountId, m);
    const usage = this._monthlyUsage.get(key) ?? 0;
    if (usage >= monthlyMax) {
      // Read the count again, in case we are behind the updates.
      this._refreshMonthlyUsage(key, billingAccountId);
      throw new ApiError(
        `Exceeded monthly API limit for this site`,
        429,
        {
          limit: {
            maximum: monthlyMax,
            projectedValue: usage + 1,
            quantity: "apiCallsPerMonth",
            value: usage,
          },
          tips: [{
            action: "upgrade",
            message: `Upgrade to a paid plan to increase your monthly API limit: ${commonUrls.plans}`,
          }],
        },
      );
    }

    // As for the daily counters, increment locally first so that a burst arriving before
    // Redis answers is still counted.
    this._monthlyUsage.set(key, usage + 1);

    // Expire after two months, so the key outlives the month it counts.
    const expiry = 62 * 24 * 60 * 60;
    cli.multi().incr(key).expire(key, expiry).execAsync().then((result) => {
      this._monthlyUsage.set(key, Number(result![0]));
    }).catch(e => log.error(`Error tracking API usage for billing account ${billingAccountId}: ${e}`));
  }

  /**
   * Copy the count from Redis into the local one. Runs in the background, so it only
   * affects later requests. While one read is in flight, another one is not started,
   * since every rejected request would otherwise ask for the same value.
   */
  private _refreshMonthlyUsage(key: string, billingAccountId: number): void {
    const cli = this._getRedisClient();
    if (!cli || this._monthlyRefreshes.has(key)) { return; }
    const done = cli.getAsync(key).then((value) => {
      // A missing key means the month is over or the count was removed, so start again.
      this._monthlyUsage.set(key, Number(value) || 0);
    }).catch(e => log.error(`Error reading API usage for billing account ${billingAccountId}: ${e}`))
      .then(() => { this._monthlyRefreshes.delete(key); });
    this._monthlyRefreshes.set(key, done);
  }
}

/**
 * Whether a limit read from a product should be enforced. A limit of 0 means the same as
 * an absent one, i.e. unlimited: it is not a way to block all access.
 */
function isLimitDefined(max: number | undefined): max is number {
  return max !== undefined && max > 0;
}
