var assert = require('assert');
var ko = require('knockout');
var sinon = require('sinon');

var koUtil = require('app/client/lib/koUtil');

describe('koUtil', function() {

  describe("observableWithDefault", function() {
    it("should be an observable with a default", function() {
      var foo = ko.observable();

      var bar1 = koUtil.observableWithDefault(foo, 'defaultValue');

      var obj = { prop: 17 };
      var bar2 = koUtil.observableWithDefault(foo, function() { return this.prop; }, obj);

      assert.equal(bar1(), 'defaultValue');
      assert.equal(bar2(), 17);

      foo('hello');
      assert.equal(bar1(), 'hello');
      assert.equal(bar2(), 'hello');

      obj.prop = 28;
      foo(0);
      assert.equal(bar1(), 'defaultValue');
      assert.equal(bar2(), 28);

      bar1('world');
      assert.equal(foo(), 'world');
      assert.equal(bar1(), 'world');
      assert.equal(bar2(), 'world');

      bar2('blah');
      assert.equal(foo(), 'blah');
      assert.equal(bar1(), 'blah');
      assert.equal(bar2(), 'blah');

      bar1(null);
      assert.equal(foo(), null);
      assert.equal(bar1(), 'defaultValue');
      assert.equal(bar2(), 28);
    });
  });

  describe('computedAutoDispose', function() {
    function testAutoDisposeValue(pure) {
      var obj = [{dispose: sinon.spy()}, {dispose: sinon.spy()}, {dispose: sinon.spy()}];
      var which = ko.observable(0);
      var computedBody = sinon.spy(function() { return obj[which()]; });

      var foo = koUtil.computedAutoDispose({ read: computedBody, pure: pure });

      // An important difference between pure and not is whether it is immediately evaluated.
      assert.equal(computedBody.callCount, pure ? 0 : 1);
      assert.strictEqual(foo(), obj[0]);
      assert.equal(computedBody.callCount, 1);
      which(1);
      assert.strictEqual(foo(), obj[1]);
      assert.equal(computedBody.callCount, 2);
      assert.equal(obj[0].dispose.callCount, 1);
      assert.equal(obj[1].dispose.callCount, 0);

      // Another difference is whether changes cause immediate re-evaluation.
      which(2);
      assert.equal(computedBody.callCount, pure ? 2 : 3);
      assert.equal(obj[1].dispose.callCount, pure ? 0 : 1);

      foo.dispose();
      assert.equal(obj[0].dispose.callCount, 1);
      assert.equal(obj[1].dispose.callCount, 1);
      assert.equal(obj[2].dispose.callCount, pure ? 0 : 1);
    }
    it("autoDisposeValue for pure computed should be pure", function() {
      testAutoDisposeValue(true);
    });
    it("autoDisposeValue for non-pure computed should be non-pure", function() {
      testAutoDisposeValue(false);
    });
  });

  describe('computedBuilder', function() {
    it("should create appropriate dependencies and dispose values", function() {
      var index = ko.observable(0);
      var foo = ko.observable('foo'); // used in the builder's constructor
      var faz = ko.observable('faz'); // used in the builder's dispose

      var obj = [{dispose: sinon.spy(() => faz())}, {dispose: sinon.spy(() => faz())}];
      var builder = sinon.spy(function(i) { obj[i].foo = foo(); return obj[i]; });

      // The built observable should depend on index(), should NOT depend on foo() or faz(), and
      // returned values should get disposed.
      var built = koUtil.computedBuilder(function() { return builder.bind(null, index()); });

      assert.equal(builder.callCount, 1);
      assert.strictEqual(built(), obj[0]);
      assert.equal(built().foo, 'foo');
      foo('bar');
      assert.equal(builder.callCount, 1);
      faz('baz');
      assert.equal(builder.callCount, 1);

      // Changing index should dispose the previous value and rebuild.
      index(1);
      assert.equal(obj[0].dispose.callCount, 1);
      assert.equal(builder.callCount, 2);
      assert.strictEqual(built(), obj[1]);
      assert.equal(built().foo, 'bar');

      // Changing foo() or faz() should continue to have no effect (i.e. disposing the previous
      // value should not have created any dependencies.)
      foo('foo');
      assert.equal(builder.callCount, 2);
      faz('faz');
      assert.equal(builder.callCount, 2);

      // Disposing the built observable should dispose the last returned value.
      assert.equal(obj[1].dispose.callCount, 0);
      built.dispose();
      assert.equal(obj[1].dispose.callCount, 1);
    });
  });
});
