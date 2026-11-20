import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { WebhookQueue } from "app/server/lib/WebhookQueue";

import { assert } from "chai";
import sinon from "sinon";

let clientForQueue: any;

class TestWebhookQueue extends WebhookQueue {
  protected _createRedisClient(): any {
    return clientForQueue;
  }
}

describe("WebhookQueue", function() {
  let originalRedisUrl: string | undefined;

  beforeEach(function() {
    originalRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://127.0.0.1:1/0";
  });

  afterEach(function() {
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
    clientForQueue = undefined;
  });

  describe("restoring the backup queue", function() {
    it("makes a failed restore retryable, and quits the client it opened", async function() {
      const client = {
        connected: true,
        lrangeAsync: sinon.stub().rejects(new Error("connection lost")),
        quitAsync: sinon.stub().resolves("OK"),
        end: sinon.stub(),
        delAsync: sinon.stub().resolves(0),
      };
      clientForQueue = client;
      const queue = new TestWebhookQueue({ docName: "doc1" } as unknown as ActiveDoc);

      await assert.isRejected((queue as any)._getRedisQueuePromise, /connection lost/);

      assert.isUndefined((queue as any)._getRedisQueuePromise);
      assert.isTrue(client.quitAsync.calledOnce);
      assert.isTrue(client.end.notCalled);
      await queue.clearWebhookQueue();
    });

    it("ends a client that never connected instead of waiting for a quit", async function() {
      const client = {
        connected: false,
        lrangeAsync: sinon.stub().rejects(new Error("getaddrinfo EAI_AGAIN")),
        quitAsync: sinon.stub().resolves("OK"),
        end: sinon.stub(),
        delAsync: sinon.stub().resolves(0),
      };
      clientForQueue = client;
      const queue = new TestWebhookQueue({ docName: "doc1" } as unknown as ActiveDoc);

      await assert.isRejected((queue as any)._getRedisQueuePromise, /EAI_AGAIN/);

      assert.isTrue(client.end.calledOnceWith(true));
      assert.isTrue(client.quitAsync.notCalled);
      assert.isUndefined((queue as any)._getRedisQueuePromise);
    });
  });
});
