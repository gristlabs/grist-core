import { drainWhenSettled } from 'app/server/utils/streams';
import { assert } from "chai";
import stream from 'node:stream';

describe('streams', function() {
  describe('drainWhenSettled', function() {
    it('drains a stream when a promise is resolved', async function () {
      const readable = stream.Readable.from(Buffer.from('Some content'));
      assert.isTrue(readable.readable);
      const value = await drainWhenSettled(readable, Promise.resolve("Some value"));
      assert.isFalse(readable.readable);
      assert.equal(value, "Some value");
    });

    it('drain a stream when a promise is rejected, and rejects', async function () {
      const readable = stream.Readable.from(Buffer.from('Some content'));
      assert.isTrue(readable.readable);
      await assert.isRejected(drainWhenSettled(readable, Promise.reject(new Error("Some value"))), "Some value");
      assert.isFalse(readable.readable);
    });
  });
});
