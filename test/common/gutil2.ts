import {delay} from 'app/common/delay';
import * as gutil from 'app/common/gutil';
import {assert} from 'chai';
import {Observable} from 'grainjs';
import * as ko from 'knockout';
import * as sinon from 'sinon';

describe('gutil2', function() {
  describe('waitObs', function() {
    it('should resolve promise when predicate matches', async function() {
      const obs: ko.Observable<number|null> = ko.observable<number|null>(null);
      const promise1 = gutil.waitObs(obs, (val) => Boolean(val));
      const promise2 = gutil.waitObs(obs, (val) => (val === null));
      const promise3 = gutil.waitObs(obs, (val) => (val! > 20));
      const spy1 = sinon.spy(), spy2 = sinon.spy(), spy3 = sinon.spy();
      const done = Promise.all([
        promise1.then((val) => { spy1(); assert.strictEqual(val, 17); }),
        promise2.then((val) => { spy2(); assert.strictEqual(val, null); }),
        promise3.then((val) => { spy3(); assert.strictEqual(val, 30); }),
      ]);

      await delay(1);
      obs(17);
      await delay(1);
      obs(30);
      await delay(1);

      await done;
      sinon.assert.callOrder(spy2, spy1, spy3);
    });
  });

  describe('waitGrainObs', function() {
    it('should resolve promise when predicate matches', async function() {
      const obs = Observable.create<number|null>(null, null);
      const promise1 = gutil.waitGrainObs(obs, (val) => Boolean(val));
      const promise2 = gutil.waitGrainObs(obs, (val) => (val === null));
      const promise3 = gutil.waitGrainObs(obs, (val) => (val! > 20));
      const spy1 = sinon.spy(), spy2 = sinon.spy(), spy3 = sinon.spy();
      const done = Promise.all([
        promise1.then((val) => { spy1(); assert.strictEqual(val, 17); }),
        promise2.then((val) => { spy2(); assert.strictEqual(val, null); }),
        promise3.then((val) => { spy3(); assert.strictEqual(val, 30); }),
      ]);

      await delay(1);
      obs.set(17);
      await delay(1);
      obs.set(30);
      await delay(1);

      await done;
      sinon.assert.callOrder(spy2, spy1, spy3);
    });
  });

  describe('PromiseChain', function() {
    it('should resolve promises in order', async function() {
      const chain = new gutil.PromiseChain();

      const spy1 = sinon.spy(), spy2 = sinon.spy(), spy3 = sinon.spy();
      const done = Promise.all([
        chain.add(() => delay(30).then(spy1).then(() => 1)),
        chain.add(() => delay(20).then(spy2).then(() => 2)),
        chain.add(() => delay(10).then(spy3).then(() => 3)),
      ]);
      assert.deepEqual(await done, [1, 2, 3]);
      sinon.assert.callOrder(spy1, spy2, spy3);
    });

    it('should skip pending callbacks, but not new callbacks, on error', async function() {
      const chain = new gutil.PromiseChain();

      const spy1 = sinon.spy(), spy2 = sinon.spy(), spy3 = sinon.spy();
      let res1: any, res2: any, res3: any;
      await assert.isRejected(Promise.all([
        res1 = chain.add(() => delay(30).then(spy1).then(() => { throw new Error('Err1'); })),
        res2 = chain.add(() => delay(20).then(spy2)),
        res3 = chain.add(() => delay(10).then(spy3)),
      ]), /Err1/);

      // Check that already-scheduled callbacks did not get called.
      sinon.assert.calledOnce(spy1);
      sinon.assert.notCalled(spy2);
      sinon.assert.notCalled(spy3);
      spy1.resetHistory();

      // Ensure skipped add() calls return a rejection.
      await assert.isRejected(res1, /^Err1/);
      await assert.isRejected(res2, /^Skipped due to an earlier error/);
      await assert.isRejected(res3, /^Skipped due to an earlier error/);

      // New promises do get scheduled.
      await assert.isRejected(Promise.all([
        res1 = chain.add(() => delay(1).then(spy1).then(() => 17)),
        res2 = chain.add(() => delay(1).then(spy2).then(() => { throw new Error('Err2'); })),
        res3 = chain.add(() => delay(1).then(spy3)),
      ]), /Err2/);
      sinon.assert.callOrder(spy1, spy2);
      sinon.assert.notCalled(spy3);

      // Check the return values of add() calls.
      assert.strictEqual(await res1, 17);
      await assert.isRejected(res2, /^Err2/);
      await assert.isRejected(res3, /^Skipped due to an earlier error/);
    });
  });

  describe("isLongerThan", function() {
    it('should work correctly', async function() {
      assert.equal(await gutil.isLongerThan(delay(200), 100), true);
      assert.equal(await gutil.isLongerThan(delay(10), 100), false);

      // A promise that throws before the timeout, causes the returned promise to resolve to false.
      const errorObj = {};
      let promise = delay(10).then(() => { throw errorObj; });
      assert.equal(await gutil.isLongerThan(promise, 100), false);
      await assert.isRejected(promise);

      // A promise that throws after the timeout, causes the returned promise to resolve to true.
      promise = delay(200).then(() => { throw errorObj; });
      assert.equal(await gutil.isLongerThan(promise, 100), true);
      await assert.isRejected(promise);
    });
  });

  describe("timeoutReached", function() {
    const DELAY_1 = 20;
    const DELAY_2 = 2 * DELAY_1;
    it("should return true for timed out promise", async function() {
      assert.isTrue(await gutil.timeoutReached(DELAY_1, delay(DELAY_2)));
      assert.isTrue(await gutil.timeoutReached(DELAY_1, delay(DELAY_2).then(() => { throw new Error("test error"); })));
    });

    it("should return false for promise that completes before timeout", async function() {
      assert.isFalse(await gutil.timeoutReached(DELAY_2, delay(DELAY_1)));
      assert.isFalse(await gutil.timeoutReached(DELAY_2, delay(DELAY_1)
        .then(() => { throw new Error("test error"); })));
      assert.isFalse(await gutil.timeoutReached(DELAY_2, Promise.resolve('foo')));
      assert.isFalse(await gutil.timeoutReached(DELAY_2, Promise.reject('bar')));
    });
  });

  describe("isValidHex", function() {
    it('should work correctly', async function() {
      assert.equal(gutil.isValidHex('#FF00FF'), true);
      assert.equal(gutil.isValidHex('#FF00FFF'), false);
      assert.equal(gutil.isValidHex('#FF0'), false);
      assert.equal(gutil.isValidHex('#FF00'), false);
      assert.equal(gutil.isValidHex('FF00FF'), false);
      assert.equal(gutil.isValidHex('#FF00FG'), false);
    });
  });

  describe("pruneArray", function() {
    function check<T>(arr: T[], indexes: number[], expect: T[]) {
      gutil.pruneArray(arr, indexes);
      assert.deepEqual(arr, expect);
    }
    it('should remove correct elements', function() {
      check(['a', 'b', 'c'], [], ['a', 'b', 'c']);
      check(['a', 'b', 'c'], [0], ['b', 'c']);
      check(['a', 'b', 'c'], [1], ['a', 'c']);
      check(['a', 'b', 'c'], [2], ['a', 'b']);
      check(['a', 'b', 'c'], [0, 1], ['c']);
      check(['a', 'b', 'c'], [0, 2], ['b']);
      check(['a', 'b', 'c'], [1, 2], ['a']);
      check(['a', 'b', 'c'], [0, 1, 2], []);
      check([], [], []);
      check(['a'], [], ['a']);
      check(['a'], [0], []);
    });
  });
});
