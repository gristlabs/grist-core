import { makeGristConfig } from "app/server/lib/sendAppPage";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";

describe("sendAppPage", function() {
  describe("makeGristConfig", function() {
    let oldEnv: testUtils.EnvironmentSnapshot;

    beforeEach(function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
    });

    afterEach(function() {
      oldEnv.restore();
    });

    it("reports whether Redis is configured", function() {
      delete process.env.REDIS_URL;
      delete process.env.TEST_REDIS_URL;
      assert.isFalse(makeGristConfig({ homeUrl: null, extra: {} }).redisAvailable);

      process.env.REDIS_URL = "redis://localhost";
      assert.isTrue(makeGristConfig({ homeUrl: null, extra: {} }).redisAvailable);

      // A test Redis counts too, matching how GristJobs picks its queue backend.
      delete process.env.REDIS_URL;
      process.env.TEST_REDIS_URL = "redis://localhost/11";
      assert.isTrue(makeGristConfig({ homeUrl: null, extra: {} }).redisAvailable);
    });
  });
});
