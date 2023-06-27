var assert = require('chai').assert;
var sinon = require('sinon');
var Promise = require('bluebird');

var {Delay} = require('app/client/lib/Delay');
var clientUtil = require('../clientUtil');

const DELAY_MS = 50;

describe('Delay', function() {

  clientUtil.setTmpMochaGlobals();

  it("should set and clear timeouts", function() {
    var spy1 = sinon.spy(), spy2 = sinon.spy(), spy3 = sinon.spy(), spy4 = sinon.spy();
    var delay = Delay.create();
    assert(!delay.isPending());

    delay.schedule(DELAY_MS * 2, spy1);
    assert(delay.isPending());

    delay.cancel();
    assert(!delay.isPending());

    delay.schedule(DELAY_MS * 2, spy2);
    return Promise.delay(DELAY_MS).then(function() {
      delay.cancel();
      assert(!delay.isPending());
      delay.schedule(DELAY_MS * 2, spy3);
    })
    .delay(DELAY_MS).then(function() {
      delay.schedule(DELAY_MS * 2, spy4, null, 1, 2);
    })
    .delay(DELAY_MS * 4).then(function() {
      sinon.assert.notCalled(spy1);
      sinon.assert.notCalled(spy2);
      sinon.assert.notCalled(spy3);
      sinon.assert.calledOnce(spy4);
      sinon.assert.calledOn(spy4, null);
      sinon.assert.calledWith(spy4, 1, 2);
      assert(!delay.isPending());
    });
  });
});
