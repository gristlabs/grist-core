import { DocApiUsageTracker } from "app/server/lib/DocApiUsageTracker";
import { EnvironmentSnapshot } from "test/server/testUtils";

import { assert } from "chai";

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
});
