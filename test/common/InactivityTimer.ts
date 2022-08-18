import {InactivityTimer} from 'app/common/InactivityTimer';
import {delay} from 'bluebird';
import {assert} from 'chai';
import * as sinon from 'sinon';


describe("InactivityTimer", function() {

  let spy: sinon.SinonSpy, timer: InactivityTimer;

  beforeEach(() => {
    spy = sinon.spy();
    timer = new InactivityTimer(spy, 100);
  });

  it("if no activity, should trigger when time elapses after ping", async function() {
    timer.ping();
    assert(spy.callCount === 0);
    await delay(150);
    assert.equal(spy.callCount, 1);
    });

  it("disableUntilFinish should clear timeout, and set it back after promise resolved", async function() {
    timer.ping();
    timer.disableUntilFinish(delay(100)); // eslint-disable-line @typescript-eslint/no-floating-promises
    await delay(150);
    assert.equal(spy.callCount, 0);
    await delay(100);
    assert.equal(spy.callCount, 1);
  });

  it("should not trigger during async monitoring", async function() {
    timer.disableUntilFinish(delay(300)); // eslint-disable-line @typescript-eslint/no-floating-promises

    // do not triggers after a ping
    timer.ping();
    await delay(150);
    assert.equal(spy.callCount, 0);

    // nor after an async monitored call
    timer.disableUntilFinish(delay(0)); // eslint-disable-line @typescript-eslint/no-floating-promises
    await delay(150);
    assert.equal(spy.callCount, 0);

    // finally triggers callback
    await delay(150);
    assert.equal(spy.callCount, 1);
  });

  it("should support disabling", async function() {
    timer.disable();
    assert.equal(timer.isEnabled(), false);

    // While disabled, ping doesn't trigger anything.
    timer.ping();
    assert.equal(timer.isScheduled(), false);
    await delay(200);
    assert.equal(spy.callCount, 0);

    // When enabled, it triggers as usual.
    timer.enable();
    assert.equal(timer.isEnabled(), true);
    assert.equal(timer.isScheduled(), true);
    await delay(150);
    assert.equal(spy.callCount, 1);
    spy.resetHistory();

    // When enabled, ping and disableUntilFinish both trigger the callback.
    timer.disableUntilFinish(delay(50)).catch(() => null);
    timer.disableUntilFinish(delay(150)).catch(() => null);
    await delay(100);
    assert.equal(spy.callCount, 0);
    assert.equal(timer.isScheduled(), false);
    await delay(100);
    assert.equal(timer.isScheduled(), true);
    assert.equal(spy.callCount, 0);
    await delay(100);
    assert.equal(spy.callCount, 1);
    spy.resetHistory();

    // When disabled, nothing is triggered.
    timer.disableUntilFinish(delay(50)).catch(() => null);
    timer.disableUntilFinish(delay(150)).catch(() => null);
    await delay(100);
    assert.equal(spy.callCount, 0);
    assert.equal(timer.isEnabled(), true);
    assert.equal(timer.isScheduled(), false);
    timer.disable();
    timer.ping();
    timer.disableUntilFinish(delay(150)).catch(() => null);
    assert.equal(timer.isEnabled(), false);
    assert.equal(timer.isScheduled(), false);

    // Nothing called even after disableUntilFinished have resumed.
    await delay(200);
    assert.equal(spy.callCount, 0);
    assert.equal(timer.isScheduled(), false);

    // Re-enabling will schedule after a new delay.
    timer.enable();
    assert.equal(timer.isEnabled(), true);
    assert.equal(timer.isScheduled(), true);
    await delay(50);
    assert.equal(spy.callCount, 0);
    await delay(150);
    assert.equal(spy.callCount, 1);
    assert.equal(timer.isEnabled(), true);
    assert.equal(timer.isScheduled(), false);
  });
});
