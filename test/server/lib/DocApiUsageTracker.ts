import { commonUrls } from "app/common/gristUrls";
import { DocApiUsageTracker } from "app/server/lib/DocApiUsageTracker";
import { EnvironmentSnapshot } from "test/server/testUtils";

import { promisifyAll } from "bluebird";
import { assert } from "chai";
import { createClient, RedisClient } from "redis";

promisifyAll(RedisClient.prototype);

describe("DocApiUsageTracker", function() {
  let oldEnv: EnvironmentSnapshot;
  beforeEach(function() { oldEnv = new EnvironmentSnapshot(); });
  afterEach(function() { oldEnv.restore(); });

  describe("parallel limits", function() {
    it("should allow requests up to the max", function() {
      process.env.GRIST_MAX_PARALLEL_REQUESTS_PER_DOC = "2";
      const tracker = new DocApiUsageTracker();
      // First two should succeed
      tracker.acquire("doc1", undefined);
      tracker.acquire("doc1", undefined);
      // Third should fail
      assert.throws(() => tracker.acquire("doc1", undefined), /Too many backlogged/);
    });

    it("should allow next request after release", function() {
      process.env.GRIST_MAX_PARALLEL_REQUESTS_PER_DOC = "1";
      const tracker = new DocApiUsageTracker();
      tracker.acquire("doc1", undefined);
      // Next should fail
      assert.throws(() => tracker.acquire("doc1", undefined), /Too many backlogged/);
      // Release and try again
      tracker.release("doc1");
      tracker.release("doc1");  // release the rejected one too
      tracker.acquire("doc1", undefined);  // should succeed now
    });

    it("should track different docs independently", function() {
      process.env.GRIST_MAX_PARALLEL_REQUESTS_PER_DOC = "1";
      const tracker = new DocApiUsageTracker();
      tracker.acquire("doc1", undefined);
      tracker.acquire("doc2", undefined);  // different doc, should succeed
      assert.throws(() => tracker.acquire("doc1", undefined), /Too many backlogged/);
    });
  });

  describe("daily limits", function() {
    it("should reject when daily limit exceeded", function() {
      process.env.GRIST_MAX_PARALLEL_REQUESTS_PER_DOC = "0";  // disable parallel limit
      const tracker = new DocApiUsageTracker();
      // Set daily max to 1, so the second request should fail.
      // The first one passes and increments the bucket counts.
      tracker.acquire("doc1", 1);
      tracker.release("doc1");
      // Now usage == 1 which matches the max for the current day bucket.
      // The minute bucket has a max of ceil(1/1440)=1, also reached.
      // So the next acquire should be rejected.
      assert.throws(() => tracker.acquire("doc1", 1), /Exceeded daily limit/);
      tracker.release("doc1");
    });

    it("should skip daily check when dailyMax is undefined", function() {
      process.env.GRIST_MAX_PARALLEL_REQUESTS_PER_DOC = "0";
      const tracker = new DocApiUsageTracker();
      // With undefined dailyMax, requests should never be rejected for daily usage.
      for (let i = 0; i < 10; i++) {
        tracker.acquire("doc1", undefined);
        tracker.release("doc1");
      }
    });
  });

  describe("acquire + release lifecycle", function() {
    it("release with no prior acquire is a no-op", function() {
      process.env.GRIST_MAX_PARALLEL_REQUESTS_PER_DOC = "10";
      const tracker = new DocApiUsageTracker();
      // Should not throw
      tracker.release("nonexistent");
    });
  });

  // The monthly count is only kept in redis, so these need one. Counts left by an earlier
  // run are removed first, or they would reject the requests these tests make. Every suite
  // gets a redis db of its own, so no other test can be counting at the same time.
  describe("monthly limits", function() {
    let cli: RedisClient;

    before(async function() {
      if (!process.env.TEST_REDIS_URL) { this.skip(); return; }
      cli = createClient(process.env.TEST_REDIS_URL);
      const keys = await cli.keysAsync("*monthlyApiUsage*");
      await Promise.all(keys.map(key => cli.delAsync(key)));
    });

    after(async function() {
      await cli?.quitAsync();
    });

    function makeTracker() {
      return new DocApiUsageTracker({ getRedisClient: () => cli });
    }

    it("should reject once the whole site has reached the limit", function() {
      process.env.GRIST_MAX_PARALLEL_REQUESTS_PER_DOC = "0";  // disable parallel limit
      const tracker = makeTracker();
      const org = { billingAccountId: 7, monthlyMax: 2 };
      // Every doc of the site shares the same limit, so two docs use it up.
      tracker.acquire("doc1", undefined, org);
      tracker.release("doc1");
      tracker.acquire("doc2", undefined, org);
      tracker.release("doc2");
      try {
        tracker.acquire("doc3", undefined, org);
        assert.fail();
      } catch (e) {
        assert.match(e.message, /Exceeded monthly API limit/);
        assert.equal(e.status, 429);
        assert.deepEqual(e.details.limit, {
          maximum: 2,
          projectedValue: 3,
          quantity: "apiCallsPerMonth",
          value: 2,
        });
        assert.equal(e.details.tips[0].action, "upgrade");
        // The url is part of the message, since MCP clients only relay text.
        assert.include(e.details.tips[0].message, commonUrls.plans);
      } finally {
        tracker.release("doc3");
      }
    });

    it("should track different sites independently", function() {
      process.env.GRIST_MAX_PARALLEL_REQUESTS_PER_DOC = "0";
      const tracker = makeTracker();
      tracker.acquire("doc1", undefined, { billingAccountId: 8, monthlyMax: 1 });
      tracker.release("doc1");
      // Same doc id, but another site, so it has its own limit.
      tracker.acquire("doc1", undefined, { billingAccountId: 9, monthlyMax: 1 });
      tracker.release("doc1");
      assert.throws(() => tracker.acquire("doc1", undefined, { billingAccountId: 8, monthlyMax: 1 }),
        /Exceeded monthly API limit/);
      tracker.release("doc1");
    });

    it("should skip the check when the limit is unset, zero, or the org is fake", function() {
      process.env.GRIST_MAX_PARALLEL_REQUESTS_PER_DOC = "0";
      const tracker = makeTracker();
      for (let i = 0; i < 10; i++) {
        tracker.acquire("doc1", undefined, { billingAccountId: 10, monthlyMax: undefined });
        // A limit of 0 means unlimited, as it does for the daily limit.
        tracker.acquire("doc1", undefined, { billingAccountId: 10, monthlyMax: 0 });
        // A zero id is the fake org anonymous users get; every site would otherwise share it.
        tracker.acquire("doc1", undefined, { billingAccountId: 0, monthlyMax: 1 });
        tracker.release("doc1");
        tracker.release("doc1");
        tracker.release("doc1");
      }
    });
  });
});
