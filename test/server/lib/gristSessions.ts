import { SessionObj } from "app/server/lib/BrowserSession";
import { createDummyGristServer } from "app/server/lib/GristServer";
import { initGristSessions, SessionStore } from "app/server/lib/gristSessions";
import { Sessions } from "app/server/lib/Sessions";
import { EnvironmentSnapshot } from "test/server/testUtils";

import { promisifyAll } from "bluebird";
import { assert } from "chai";
import { createClient, RedisClient } from "redis";

promisifyAll(RedisClient.prototype);

const SESSION: SessionObj = { cookie: {} };

// A key standing in for pub/sub, job queues and the doc worker map, which all
// share the same redis db as sessions.
const NON_SESSION_KEY = "gristSessions-test-not-a-session";

describe("gristSessions", function() {
  // The redis store is loaded by require() and cast, so TypeScript cannot check
  // that it really implements SessionStore.
  describe("redis session store", function() {
    let oldEnv: EnvironmentSnapshot;
    let cli: RedisClient;
    let store: SessionStore;
    let sessions: Sessions;

    before(function() {
      // The server suite sets TEST_REDIS_URL, the nbrowser suite sets REDIS_URL.
      if (!process.env.TEST_REDIS_URL && !process.env.REDIS_URL) { this.skip(); }
    });

    beforeEach(function() {
      oldEnv = new EnvironmentSnapshot();
      // The store picks redis over sqlite based on REDIS_URL.
      process.env.REDIS_URL = process.env.TEST_REDIS_URL || process.env.REDIS_URL;
      cli = createClient(process.env.REDIS_URL);
      // The redis branch ignores instanceRoot, no sqlite file is created.
      const inst = initGristSessions("anything", createDummyGristServer());
      store = inst.sessionStore;
      sessions = inst.sessions;
    });

    afterEach(async function() {
      await store.close();
      await cli.flushdbAsync();
      await cli.quitAsync();
      oldEnv.restore();
    });

    it("removes every session", async function() {
      await store.setAsync("session-a", SESSION);
      await store.setAsync("session-b", SESSION);

      await sessions.clearAllSessions();

      assert.isNotOk(await store.getAsync("session-a"));
      assert.isNotOk(await store.getAsync("session-b"));
    });

    it("keeps keys that are not sessions", async function() {
      await cli.setAsync(NON_SESSION_KEY, "keep me");
      await store.setAsync("session-a", SESSION);

      await sessions.clearAllSessions();

      assert.isNotOk(await store.getAsync("session-a"));
      assert.equal(await cli.getAsync(NON_SESSION_KEY), "keep me");
    });

    // Covers the clearAsync workaround in createSessionStoreFactory, without which
    // connect-redis sends DEL with no keys and redis rejects it.
    it("clears an empty store", async function() {
      assert.equal(await store.lengthAsync(), 0);
      await sessions.clearAllSessions();
    });
  });
});
