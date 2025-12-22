import { delay } from 'app/common/delay';
import { createPubSubManager, IPubSubManager } from 'app/server/lib/PubSubManager';
import { getPubSubPrefix } from 'app/server/lib/serverUtils';
import { assert } from 'chai';
import * as sinon from 'sinon';
import IORedis from 'ioredis';
import { setupCleanup } from 'test/server/testCleanup';

describe('PubSubManager', function() {
  const sandbox = sinon.createSandbox();
  const cleanup = setupCleanup();
  const prefix: string = getPubSubPrefix();

  describe('with redis', function() {
    before(function() {
      if (!process.env.TEST_REDIS_URL) {
        this.skip();
      }
    });

    afterEach(function() {
      sandbox.restore();
    });

    it('subscribes and unsubscribes once for multiple listeners', async function() {
      const manager: IPubSubManager = createPubSubManager(process.env.TEST_REDIS_URL);
      cleanup.addAfterEach(() => manager.close());

      const subSpy = sandbox.spy(IORedis.prototype, 'subscribe');
      const unsubSpy = sandbox.spy(IORedis.prototype, 'unsubscribe');

      const cbA1 = sandbox.spy();
      const cbA2 = sandbox.spy();
      const cbB1 = sandbox.spy();
      const resetHistory = () => { [cbA1, cbA2, cbB1].forEach(spy => spy.resetHistory()); };

      // first subscription
      const unsubscribe1 = manager.subscribe('testChanA', cbA1).unsubscribeCB;
      assert.deepEqual(subSpy.args, [[`${prefix}testChanA`]]);

      // second subscription to same channel
      const unsubscribe2 = manager.subscribe('testChanA', cbA2).unsubscribeCB;
      assert.equal(subSpy.callCount, 1, 'subscribe should only be called once');

      const unsubscribe3 = await manager.subscribe('testChanB', cbB1);
      assert.equal(subSpy.callCount, 2);

      await manager.publish('testChanA', 'foo');
      await manager.publish('testChanB', 'bar');
      await delay(200);   // Give subscriptions a chance to get called.
      assert.deepEqual(cbA1.args, [['foo']]);
      assert.deepEqual(cbA2.args, [['foo']]);
      assert.deepEqual(cbB1.args, [['bar']]);
      resetHistory();

      // cleanup first A listener
      unsubscribe1();
      assert.isFalse(unsubSpy.called, 'unsubscribe should not be called after removing first listener');

      await manager.publishBatch([
        {channel: 'testChanA', message: 'foo2'},
        {channel: 'testChanB', message: 'bar2'}],
      );
      await delay(200);   // Give subscriptions a chance to get called.
      assert.deepEqual(cbA1.args, []);
      assert.deepEqual(cbA2.args, [['foo2']]);
      assert.deepEqual(cbB1.args, [['bar2']]);
      resetHistory();

      // cleanup second (last) A listener
      unsubscribe2();
      assert.deepEqual(unsubSpy.args, [[`${prefix}testChanA`]],
        'unsubscribe should be called once on last listener removal');

      await manager.publish('testChanA', 'foo3');
      await manager.publish('testChanB', 'bar3');
      await delay(200);   // Give subscriptions a chance to get called.
      assert.deepEqual(cbA1.args, []);
      assert.deepEqual(cbA2.args, []);
      assert.deepEqual(cbB1.args, [['bar3']]);
      resetHistory();

      // clean up the only B listener.
      unsubscribe3();
      await manager.publish('testChanA', 'foo4');
      await manager.publish('testChanB', 'bar4');
      await delay(200);   // Give subscriptions a chance to get called.
      assert.deepEqual(cbA1.args, []);
      assert.deepEqual(cbA2.args, []);
      assert.deepEqual(cbB1.args, []);
      resetHistory();
    });

    it('delivers to multiple instances', async function() {
      const manager1 = createPubSubManager(process.env.TEST_REDIS_URL);
      const manager2 = createPubSubManager(process.env.TEST_REDIS_URL);
      cleanup.addAfterEach(() => manager1.close());
      cleanup.addAfterEach(() => manager2.close());

      const subSpy = sandbox.spy(IORedis.prototype, 'subscribe');
      const unsubSpy = sandbox.spy(IORedis.prototype, 'unsubscribe');

      const cbA1 = sandbox.spy();
      const cbA2 = sandbox.spy();
      const cbB1 = sandbox.spy();
      const resetHistory = () => { [cbA1, cbA2, cbB1].forEach(spy => spy.resetHistory()); };

      const unsubscribeA1 = manager1.subscribe('testChanA', cbA1).unsubscribeCB;
      const unsubscribeA2 = await manager1.subscribe('testChanA', cbA2);
      assert.deepEqual(subSpy.args, [[`${prefix}testChanA`]]);

      // Publish on the OTHER manager. It should be noticed by the first manager's subscribers.
      await manager2.publish('testChanA', 'foo');
      await delay(200);   // Give subscriptions a chance to get called.
      assert.deepEqual(cbA1.args, [['foo']]);
      assert.deepEqual(cbA2.args, [['foo']]);
      resetHistory();

      // Subscribe a callback on the other manager.
      void manager2.subscribe('testChanA', cbB1);
      assert.deepEqual(subSpy.args, [[`${prefix}testChanA`], [`${prefix}testChanA`]]);

      // Messages from either manager should be seen on both.
      await manager1.publish('testChanA', 'a');
      await manager2.publish('testChanA', 'b');
      await delay(200);   // Give subscriptions a chance to get called.
      assert.deepEqual(cbA1.args, [['a'], ['b']]);
      assert.deepEqual(cbA2.args, [['a'], ['b']]);
      assert.deepEqual(cbB1.args, [['a'], ['b']]);
      resetHistory();

      // cleanup the first manager's listeners.
      unsubscribeA1();
      unsubscribeA2();
      assert.deepEqual(unsubSpy.args, [[`${prefix}testChanA`]]);

      // We can still publish on the first manager, and get noticed by the second.
      await manager1.publish('testChanA', 'b2');
      await delay(200);   // Give subscriptions a chance to get called.
      assert.deepEqual(cbA1.args, []);
      assert.deepEqual(cbA2.args, []);
      assert.deepEqual(cbB1.args, [['b2']]);
      resetHistory();
    });

    it('should handle errors', async function() {
      const manager: IPubSubManager = createPubSubManager(process.env.TEST_REDIS_URL);
      cleanup.addAfterEach(() => manager.close());

      const subStub = sandbox.stub(IORedis.prototype, 'subscribe').callsFake(() =>
        Promise.reject(new Error('Fake subscribe error')));
      const unsubSpy = sandbox.spy(IORedis.prototype, 'unsubscribe');

      const cbA1 = sandbox.spy();
      const sub1 = manager.subscribe('testChanA', cbA1);
      assert.equal(subStub.callCount, 1);

      await assert.isRejected(sub1, /Fake subscribe error/);

      // But it should be safe to call unsubscribeCB.
      sub1.unsubscribeCB();
      assert.equal(unsubSpy.callCount, 1);

      // Try subscribing again, first with a failure.
      const sub2 = manager.subscribe('testChanA', cbA1);
      assert.equal(subStub.callCount, 2);
      await assert.isRejected(sub2, /Fake subscribe error/);

      // Then successfully.
      subStub.resetBehavior();
      const cbA3 = sandbox.spy();
      const sub3 = manager.subscribe('testChanA', cbA3);
      assert.equal(subStub.callCount, 3);
      assert.equal(await sub3, sub3.unsubscribeCB);

      // It should still be safe to call any unsubscribeCBs.
      sub2.unsubscribeCB();
      assert.equal(unsubSpy.callCount, 1);    // no change from last call.

      // When the last subscription is gone, the actual redis-unsubscribe happens.
      sub3.unsubscribeCB();
      assert.equal(unsubSpy.callCount, 2);

      // Let calls complete before after-test cleanup closes the connection.
      await delay(50);
    });
  });

  describe('without redis', function() {
    after(function() {
      sandbox.restore();
    });

    it('works in-memory without redis', async function() {
      const manager = createPubSubManager(undefined);
      cleanup.addAfterEach(() => manager.close());

      const subSpy = sandbox.spy(IORedis.prototype, 'subscribe');
      const unsubSpy = sandbox.spy(IORedis.prototype, 'unsubscribe');

      const cbA1 = sandbox.spy();
      const cbA2 = sandbox.spy();
      const cbB1 = sandbox.spy();
      const resetHistory = () => { [cbA1, cbA2, cbB1].forEach(spy => spy.resetHistory()); };

      const unsubscribe1 = manager.subscribe('testChanA', cbA1).unsubscribeCB;
      const unsubscribe2 = manager.subscribe('testChanA', cbA2).unsubscribeCB;
      const unsubscribe3 = manager.subscribe('testChanB', cbB1).unsubscribeCB;

      await manager.publish('testChanA', 'foo');
      await manager.publish('testChanB', 'bar');
      assert.deepEqual(cbA1.args, [['foo']]);
      assert.deepEqual(cbA2.args, [['foo']]);
      assert.deepEqual(cbB1.args, [['bar']]);
      resetHistory();

      // cleanup first A listener
      unsubscribe1();

      await manager.publishBatch([
        {channel: 'testChanA', message: 'foo2'},
        {channel: 'testChanB', message: 'bar2'}],
      );
      await delay(200);   // Give subscriptions a chance to get called.
      assert.deepEqual(cbA1.args, []);
      assert.deepEqual(cbA2.args, [['foo2']]);
      assert.deepEqual(cbB1.args, [['bar2']]);
      resetHistory();

      // cleanup second (last) A listener
      unsubscribe2();

      await manager.publish('testChanA', 'foo3');
      await manager.publish('testChanB', 'bar3');
      await delay(200);   // Give subscriptions a chance to get called.
      assert.deepEqual(cbA1.args, []);
      assert.deepEqual(cbA2.args, []);
      assert.deepEqual(cbB1.args, [['bar3']]);
      resetHistory();

      // clean up the only B listener.
      unsubscribe3();
      await manager.publish('testChanA', 'foo4');
      await manager.publish('testChanB', 'bar4');
      await delay(200);   // Give subscriptions a chance to get called.
      assert.deepEqual(cbA1.args, []);
      assert.deepEqual(cbA2.args, []);
      assert.deepEqual(cbB1.args, []);
      resetHistory();

      assert.equal(subSpy.callCount, 0, 'this test case should not involve Redis');
      assert.equal(unsubSpy.callCount, 0, 'this test case should not involve Redis');
    });
  });
});
