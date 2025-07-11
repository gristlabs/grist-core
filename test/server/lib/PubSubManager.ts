import { createPubSubManager, IPubSubManager } from 'app/server/lib/PubSubManager';
import { delay } from 'app/common/delay';
import { assert } from 'chai';
import * as sinon from 'sinon';
import IORedis from 'ioredis';
import { setupCleanup } from 'test/server/testCleanup';

describe('PubSubManager', function() {
  const sandbox = sinon.createSandbox();
  const cleanup = setupCleanup();

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
      const unsubscribe1 = manager.subscribe('testChanA', cbA1);
      assert.deepEqual(subSpy.args, [['db-x-testChanA']]);

      // second subscription to same channel
      const unsubscribe2 = manager.subscribe('testChanA', cbA2);
      assert.equal(subSpy.callCount, 1, 'subscribe should only be called once');

      const unsubscribe3 = manager.subscribe('testChanB', cbB1);
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

      await manager.publish('testChanA', 'foo2');
      await manager.publish('testChanB', 'bar2');
      await delay(200);   // Give subscriptions a chance to get called.
      assert.deepEqual(cbA1.args, []);
      assert.deepEqual(cbA2.args, [['foo2']]);
      assert.deepEqual(cbB1.args, [['bar2']]);
      resetHistory();

      // cleanup second (last) A listener
      unsubscribe2();
      assert.deepEqual(unsubSpy.args, [['db-x-testChanA']],
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

      const unsubscribeA1 = manager1.subscribe('testChanA', cbA1);
      const unsubscribeA2 = manager1.subscribe('testChanA', cbA2);
      assert.deepEqual(subSpy.args, [['db-x-testChanA']]);

      // Publish on the OTHER manager. It should be noticed by the first manager's subscribers.
      await manager2.publish('testChanA', 'foo');
      await delay(200);   // Give subscriptions a chance to get called.
      assert.deepEqual(cbA1.args, [['foo']]);
      assert.deepEqual(cbA2.args, [['foo']]);
      resetHistory();

      // Subscribe a callback on the other manager.
      manager2.subscribe('testChanA', cbB1);
      assert.deepEqual(subSpy.args, [['db-x-testChanA'], ['db-x-testChanA']]);

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
      assert.deepEqual(unsubSpy.args, [['db-x-testChanA']]);

      // We can still publish on the first manager, and get noticed by the second.
      await manager1.publish('testChanA', 'b2');
      await delay(200);   // Give subscriptions a chance to get called.
      assert.deepEqual(cbA1.args, []);
      assert.deepEqual(cbA2.args, []);
      assert.deepEqual(cbB1.args, [['b2']]);
      resetHistory();
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

      const unsubscribe1 = manager.subscribe('testChanA', cbA1);
      const unsubscribe2 = manager.subscribe('testChanA', cbA2);
      const unsubscribe3 = manager.subscribe('testChanB', cbB1);

      await manager.publish('testChanA', 'foo');
      await manager.publish('testChanB', 'bar');
      assert.deepEqual(cbA1.args, [['foo']]);
      assert.deepEqual(cbA2.args, [['foo']]);
      assert.deepEqual(cbB1.args, [['bar']]);
      resetHistory();

      // cleanup first A listener
      unsubscribe1();

      await manager.publish('testChanA', 'foo2');
      await manager.publish('testChanB', 'bar2');
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
