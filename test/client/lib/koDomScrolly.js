const {Scrolly} = require('app/client/lib/koDomScrolly');
const clientUtil = require('../clientUtil');
const G = require('app/client/lib/browserGlobals').get('window', '$');
const sinon = require('sinon');
const assert = require('assert');

describe("koDomScrolly", function() {

  clientUtil.setTmpMochaGlobals();

  before(function(){
    sinon.stub(Scrolly.prototype, 'scheduleUpdateSize');
  });

  beforeEach(function(){
    Scrolly.prototype.scheduleUpdateSize.reset();
  });

  after(function(){
    Scrolly.prototype.scheduleUpdateSize.restore();
  });

  it("should not remove other's resize handlers", function(){
    let scrolly1 = createScrolly(),
      scrolly2 = createScrolly();
    G.$(G.window).trigger("resize");
    let updateSpy = Scrolly.prototype.scheduleUpdateSize;
    sinon.assert.called(updateSpy);
    sinon.assert.calledOn(updateSpy, scrolly1);
    sinon.assert.calledOn(updateSpy, scrolly2);
    scrolly2.dispose();
    updateSpy.reset();
    G.$(G.window).trigger("resize");
    assert.deepEqual(updateSpy.thisValues, [scrolly1]);
  });

});


function createScrolly() {
  // subscribe should return a disposable subscription.
  const dispose = () => {};
  const subscription = { dispose };
  const data = {subscribe: () => subscription, all: () => []};
  return new Scrolly(data);
}
