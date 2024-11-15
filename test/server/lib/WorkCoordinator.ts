import {WorkCoordinator} from 'app/server/lib/WorkCoordinator';
import * as bluebird from 'bluebird';
import { assert } from 'chai';
import * as sinon from 'sinon';
import * as testUtils from 'test/server/testUtils';

describe('WorkCoordinator', function() {
  let wc: WorkCoordinator;
  const doWork = sinon.stub();

  beforeEach(() => {
    wc = new WorkCoordinator(doWork);
  });

  function rejectionHandler(reason: Error, promise: Promise<any>) {
    assert.equal(reason.message, "test");
  }

  before(() => {
    process.on("unhandledRejection", rejectionHandler);
  });

  after(() => {
    process.removeListener("unhandledRejection" as any, rejectionHandler);
  });

  async function sleep(ms: number) {
    return bluebird.delay(ms);
  }

  it('should call doWork() after ping()', async function() {
    doWork.reset();
    wc.ping();
    await sleep(25);
    sinon.assert.calledOnce(doWork);
  });

  it('should call doWork() again after success, but not on idle or failure', async function() {
    doWork.reset();
    doWork.onCall(0).callsFake(() => bluebird.delay(50));
    doWork.onCall(1).callsFake(() => bluebird.reject(new Error("test17")));
    doWork.onCall(2).callsFake(() => null);
    doWork.onCall(3).callsFake(() => bluebird.delay(50));
    doWork.returns(undefined);

    const msgs = await testUtils.captureLog('error', async () => {
      assert.equal(doWork.callCount, 0);
      wc.ping();
      await sleep(25);
      assert.equal(doWork.callCount, 1);
      await sleep(50);
      assert.equal(doWork.callCount, 2);    // 2nd call fails, so there is no retry.
      await sleep(50);
      assert.equal(doWork.callCount, 2);

      wc.ping();
      await sleep(25);
      assert.equal(doWork.callCount, 3);    // 3rd call returns null, so there is no retry.
      await sleep(50);
      assert.equal(doWork.callCount, 3);

      wc.ping();
      await sleep(25);
      assert.equal(doWork.callCount, 4);    // 4th call succeeds, so there is a retry.
      await sleep(50);
      assert.equal(doWork.callCount, 5);
      await sleep(50);
      assert.equal(doWork.callCount, 5);    // later calls return undefined, so there is no retry.
    });
    testUtils.assertMatchArray(msgs, [
      /WorkCoordinator.*Error: test17/
    ]);
  });

  it('should not call doWork() while it is running', async function() {
    doWork.reset();
    doWork.onCall(0).callsFake(() => bluebird.delay(50));
    wc.ping();
    assert.equal(doWork.callCount, 0);
    wc.ping();
    await sleep(10);
    wc.ping();
    assert.equal(doWork.callCount, 1);
    await sleep(10);
    wc.ping();
    assert.equal(doWork.callCount, 1);
    await sleep(50);
    assert.equal(doWork.callCount, 2);
  });

  it('should guarantee retry if ping() called while doWork() is running', async function() {
    doWork.reset();
    doWork.onCall(0).callsFake(() => bluebird.delay(50).throw(new Error("test-foo")));
    wc.ping();

    const msgs = await testUtils.captureLog('error', async () => {
      // Case without a ping() while running.
      await sleep(25);
      assert.equal(doWork.callCount, 1);
      await sleep(50);
      assert.equal(doWork.callCount, 1);

      doWork.reset();
      doWork.onCall(0).callsFake(() => bluebird.delay(50).throw(new Error("test-bar")));
      wc.ping();

      // Case WITH a ping() while running.
      await sleep(25);
      wc.ping();
      assert.equal(doWork.callCount, 1);
      await sleep(50);
      assert.equal(doWork.callCount, 2);
      await sleep(50);
      assert.equal(doWork.callCount, 2);
    });
    testUtils.assertMatchArray(msgs, [
      /WorkCoordinator.*Error: test-foo/,
      /WorkCoordinator.*Error: test-bar/
    ]);
  });
});
