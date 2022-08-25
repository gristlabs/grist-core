import {Interval} from 'app/common/Interval';
import {delay} from 'bluebird';
import {assert} from 'chai';
import * as sinon from 'sinon';

describe('Interval', function() {
  const delayMs = 100;
  const varianceMs = 50;
  const promiseDelayMs = 200;
  const delayBufferMs = 20;

  let interval: Interval;
  let spy: sinon.SinonSpy;

  beforeEach(() => {
    spy = sinon.spy();
  });

  afterEach(async () => {
    if (interval) {
      await interval.disableAndFinish();
    }
  });

  it('is not enabled by default', async function() {
    interval = new Interval(spy, {delayMs}, {onError: () => { /* do nothing */ }});
    assert.equal(spy.callCount, 0);
    await delay(delayMs + delayBufferMs);
    assert.equal(spy.callCount, 0);
  });

  it('can be disabled', async function() {
    interval = new Interval(spy, {delayMs}, {onError: () => { /* do nothing */ }});
    interval.enable();
    await delay(delayMs + delayBufferMs);
    assert.equal(spy.callCount, 1);

    // Disable the interval, and check that the calls stop.
    interval.disable();
    await delay(delayMs + delayBufferMs);
    assert.equal(spy.callCount, 1);

    // Enable the interval again, and check that the calls resume.
    interval.enable();
    await delay(delayMs + delayBufferMs);
    assert.equal(spy.callCount, 2);
    spy.resetHistory();
  });

  it('calls onError if callback throws an error', async function() {
    const callback = () => { throw new Error('Something bad happened.'); };
    const onErrorSpy = sinon.spy();
    interval = new Interval(callback, {delayMs}, {onError: onErrorSpy});
    interval.enable();

    // Check that onError is called when the callback throws.
    assert.equal(onErrorSpy.callCount, 0);
    await delay(delayMs + delayBufferMs);
    assert.equal(onErrorSpy.callCount, 1);

    // Check that the interval didn't stop (since the onError spy silenced the error).
    await delay(delayMs + delayBufferMs);
    assert.equal(onErrorSpy.callCount, 2);
  });

  describe('with a fixed delay', function() {
    beforeEach(() => {
      interval = new Interval(spy, {delayMs}, {onError: () => { /* do nothing */ }});
      interval.enable();
    });

    it('calls the callback on a fixed interval', async function() {
      await delay(delayMs + delayBufferMs);
      assert.equal(spy.callCount, 1);
      await delay(delayMs + delayBufferMs);
      assert.equal(spy.callCount, 2);
    });
  });

  describe('with a randomized delay', function() {
    beforeEach(() => {
      interval = new Interval(spy, {delayMs, varianceMs}, {
        onError: () => { /* do nothing */ }
      });
      interval.enable();
    });

    it('calls the callback on a randomized interval', async function() {
      const delays: number[] = [];
      for (let i = 1; i <= 10; i++) {
        // Get the current delay and check that it's within the expected range.
        const currentDelayMs = interval.getDelayMs();
        delays.push(currentDelayMs!);
        assert.isDefined(currentDelayMs);
        assert.isAtMost(currentDelayMs!, delayMs + varianceMs);
        assert.isAtLeast(currentDelayMs!, delayMs - varianceMs);

        // Wait for the delay, and check that the spy was called.
        await delay(currentDelayMs!);
        assert.equal(spy.callCount, i);
      }

      // Check that we didn't use the same delay all 10 times.
      assert.notEqual([...new Set(delays)].length, 1);
    });
  });

  describe('with a promise-based callback', function() {
    let promiseSpy: sinon.SinonSpy;

    beforeEach(() => {
      const promise = () => delay(promiseDelayMs);
      promiseSpy = sinon.spy(promise);
      interval = new Interval(promiseSpy, {delayMs}, {onError: () => { /* do nothing */ }});
      interval.enable();
    });

    it('waits for promises to settle before scheduling the next call', async function() {
      assert.equal(promiseSpy.callCount, 0);
      await delay(delayMs + delayBufferMs);
      assert.equal(promiseSpy.callCount, 1);
      await delay(delayMs + delayBufferMs);
      assert.equal(promiseSpy.callCount, 1); // Still 1, because the first promise hasn't settled yet.
      await delay(delayMs + delayBufferMs);
      assert.equal(promiseSpy.callCount, 1); // Promise now settled, but there's still a 100ms delay.
      await delay(delayMs + delayBufferMs);
      assert.equal(promiseSpy.callCount, 2); // Now we finally call the callback again.
    });

    it('can wait for last promise to settle when disabling', async function() {
      assert.equal(promiseSpy.callCount, 0);
      await delay(delayMs + delayBufferMs);
      assert.equal(promiseSpy.callCount, 1);
      await interval.disableAndFinish();

      // Check that once disabled, no more calls are scheduled.
      await delay(promiseDelayMs + delayMs + delayBufferMs);
      assert.equal(promiseSpy.callCount, 1);
    });
  });
});
