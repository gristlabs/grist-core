import { createRedisClient } from "app/server/lib/redisClient";

import { assert } from "chai";
import sinon from "sinon";

describe("redisClient", function() {
  describe("createRedisClient", function() {
    it("reports a connection error rather than throwing it", function() {
      const onError = sinon.spy();
      const client = createRedisClient("redis://127.0.0.1:1/0", onError) as any;
      try {
        const err = new Error("getaddrinfo EAI_AGAIN redis-grist");
        assert.doesNotThrow(() => client.emit("error", err));
        assert.equal(client.listenerCount("error"), 1);
        assert.deepEqual(onError.args, [[err]]);
      } finally {
        client.end(true);
      }
    });
  });
});
