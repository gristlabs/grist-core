import { delay } from "app/common/delay";
import { PubSubCache } from "app/server/lib/PubSubCache";
import { createPubSubManager, IPubSubManager } from "app/server/lib/PubSubManager";
import { setupCleanup } from "test/server/testCleanup";
import { waitForIt } from "test/server/wait";

import { assert } from "chai";
import IORedis from "ioredis";
import sinon from "sinon";

describe("PubSubCache", function() {
  this.timeout(5000);
  const sandbox = sinon.createSandbox();
  const cleanup = setupCleanup();

  afterEach(function() {
    sandbox.restore();
  });

  describe("with redis", function() {
    before(function() {
      if (!process.env.TEST_REDIS_URL) {
        this.skip();
      }
    });
    testSuite(true, () => createPubSubManager(process.env.TEST_REDIS_URL));
  });

  describe("without redis", function() {
    testSuite(false, () => createPubSubManager(undefined));
  });

  function testSuite(useRedis: boolean, createPubSubManager: () => IPubSubManager) {
    const fetch = sandbox.stub<[key: string], Promise<string>>();
    const getChannel = sandbox.stub<[key: string], string>();

    function createPubSubCache(options: { ttlMs: number }) {
      fetch.callsFake(async (key: string) => key.toUpperCase());
      getChannel.callsFake((key: string) => `foo:${key}`);
      cleanup.addAfterEach(() => { fetch.reset(); getChannel.reset(); });

      const manager = createPubSubManager();
      const cache = new PubSubCache({ pubSubManager: manager, fetch, getChannel, ...options });
      cleanup.addAfterEach(async () => {
        cache.clear();
        await manager.close();
      });
      return cache;
    }

    it("should refetch after invalidateKeys", async function() {
      const cache = createPubSubCache({ ttlMs: 1000 });
      let suffix = 1;
      fetch.callsFake(async (key: string) => key.toUpperCase() + "@" + suffix);
      assert.equal(await cache.getValue("foo"), "FOO@1");
      assert.equal(await cache.getValue("bar"), "BAR@1");

      // Until invalidated, the cache should be reused.
      suffix = 2;
      assert.equal(await cache.getValue("foo"), "FOO@1");
      assert.equal(await cache.getValue("bar"), "BAR@1");

      // Once invalidated, the new value gets used, just for the key that got invalidated
      await cache.invalidateKeys(["bar"]);
      assert.equal(await cache.getValue("foo"), "FOO@1");
      assert.equal(await cache.getValue("bar"), "BAR@2");

      // Still reused without invalidation.
      suffix = 3;
      assert.equal(await cache.getValue("foo"), "FOO@1");
      assert.equal(await cache.getValue("bar"), "BAR@2");

      // Invalidate two keys at once; now both should get re-fetched.
      await cache.invalidateKeys(["bar", "foo"]);
      assert.equal(await cache.getValue("foo"), "FOO@3");
      assert.equal(await cache.getValue("bar"), "BAR@3");
    });

    it("should refetch after invalidateKeys on another server", async function() {
      if (!useRedis) { this.skip(); }
      const cache = createPubSubCache({ ttlMs: 1000 });
      const cache2 = createPubSubCache({ ttlMs: 1000 });

      let suffix = 1;
      fetch.callsFake(async (key: string) => key.toUpperCase() + "@" + suffix);
      assert.equal(await cache.getValue("foo"), "FOO@1");
      assert.equal(await cache.getValue("bar"), "BAR@1");

      // Until invalidated, the cache should be reused.
      suffix = 2;
      assert.equal(await cache.getValue("foo"), "FOO@1");
      assert.equal(await cache.getValue("bar"), "BAR@1");

      // Once invalidated, the new value gets used, just for the key that got invalidated
      await cache2.invalidateKeys(["bar"]);
      await waitForIt(async () => {
        assert.equal(await cache.getValue("foo"), "FOO@1");
        assert.equal(await cache.getValue("bar"), "BAR@2");
      }, 200, 50);

      // Still reused without invalidation.
      suffix = 3;
      assert.equal(await cache.getValue("foo"), "FOO@1");
      assert.equal(await cache.getValue("bar"), "BAR@2");

      // Invalidate two keys at once; now both should get re-fetched.
      await cache.invalidateKeys(["bar", "foo"]);
      await waitForIt(async () => {
        assert.equal(await cache.getValue("foo"), "FOO@3");
        assert.equal(await cache.getValue("bar"), "BAR@3");
      }, 200, 50);

      // Trigger a condition where immediately after a fetch another server invalidates. We should
      // not miss that invalidation.
      const [val] = await Promise.all([cache.getValue("race"), cache2.invalidateKeys(["race"])]);
      assert.equal(val, "RACE@3");
      suffix = 4;
      await waitForIt(async () => {
        assert.equal(await cache.getValue("race"), "RACE@4");
      }, 200, 50);
    });

    it("should not cache on fetch errors", async function() {
      const cache = createPubSubCache({ ttlMs: 1000 });
      fetch.callsFake(async (key: string) => { throw new Error("dummy"); });
      await assert.isRejected(cache.getValue("foo"), /dummy/);
      await assert.isRejected(cache.getValue("foo"), /dummy/);
      assert.equal(fetch.callCount, 2);
    });

    it("should re-fetch after expiration", async function() {
      const subSpy = sandbox.spy(IORedis.prototype, "subscribe");
      const unsubSpy = sandbox.spy(IORedis.prototype, "unsubscribe");

      function assertSubscriptions(expected: { sub: number, unsub: number }) {
        if (useRedis) {
          assert.equal(subSpy.callCount, expected.sub);
          assert.equal(unsubSpy.callCount, expected.unsub);
        }
      }

      const cache = createPubSubCache({ ttlMs: 100 });
      let suffix = 1;
      fetch.callsFake(async (key: string) => key.toUpperCase() + "@" + suffix);
      assert.equal(await cache.getValue("foo"), "FOO@1");
      suffix = 2;
      assert.equal(await cache.getValue("foo"), "FOO@1");
      assert.equal(fetch.callCount, 1);

      assertSubscriptions({ sub: 1, unsub: 0 });

      // Wait for expiration.
      await delay(100);
      assertSubscriptions({ sub: 1, unsub: 1 });

      suffix = 3;
      assert.equal(await cache.getValue("foo"), "FOO@3");
      assert.equal(fetch.callCount, 2);
      assertSubscriptions({ sub: 2, unsub: 1 });

      suffix = 4;
      assert.equal(await cache.getValue("foo"), "FOO@3");
      assert.equal(fetch.callCount, 2);

      // Try invalidation: it should get fetch() called again, but not subscribe/unsubscribe.
      await cache.invalidateKeys(["foo"]);
      assert.equal(await cache.getValue("foo"), "FOO@4");
      assert.equal(fetch.callCount, 3);
      assertSubscriptions({ sub: 2, unsub: 1 });

      await delay(100);
      assertSubscriptions({ sub: 2, unsub: 2 });
      suffix = 5;
      assert.equal(await cache.getValue("foo"), "FOO@5");
      assert.equal(fetch.callCount, 4);
      assertSubscriptions({ sub: 3, unsub: 2 });
      await waitForIt(async () => {
        assertSubscriptions({ sub: 3, unsub: 3 });
      }, 200, 50);
    });

    it("should re-attempt subscriptions on failure to subscribe", async function() {
      if (!useRedis) { this.skip(); }

      const subStub = sandbox.stub(IORedis.prototype, "subscribe").callsFake(
        () => Promise.reject(new Error("Fake subscribe error")));
      const unsubSpy = sandbox.spy(IORedis.prototype, "unsubscribe");

      const cache = createPubSubCache({ ttlMs: 100 });
      await assert.isRejected(cache.getValue("key1"), /Fake subscribe error/);
      assert.equal(subStub.callCount, 1);

      await delay(50);

      // Another call should try to subscribe again.
      await assert.isRejected(cache.getValue("key1"), /Fake subscribe error/);
      assert.equal(subStub.callCount, 2);

      // There should have been no other calls yet.
      assert.equal(unsubSpy.callCount, 0);
      assert.equal(fetch.callCount, 0);

      // Now make the subscription succeed.
      subStub.resetBehavior();

      assert.equal(await cache.getValue("key1"), "KEY1");
      assert.equal(subStub.callCount, 3);
      assert.equal(fetch.callCount, 1);

      // The next call is cached normally (no new subscribe() or fetch() calls)
      assert.equal(await cache.getValue("key1"), "KEY1");
      assert.equal(subStub.callCount, 3);
      assert.equal(fetch.callCount, 1);

      // After expiration, there should be a single unsubscribe call.
      assert.equal(unsubSpy.callCount, 0);
      await delay(100);
      assert.equal(unsubSpy.callCount, 1);
    });
  }
});
