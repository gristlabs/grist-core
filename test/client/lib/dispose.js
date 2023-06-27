var dispose = require('app/client/lib/dispose');

var bluebird = require('bluebird');
var {assert} = require('chai');
var sinon = require('sinon');

var clientUtil = require('../clientUtil');
var dom = require('app/client/lib/dom');

require('chai').config.truncateThreshold = 10000;

describe('dispose', function() {

  clientUtil.setTmpMochaGlobals();

  function Bar() {
    this.dispose = sinon.spy();
    this.destroy = sinon.spy();
  }

  describe("Disposable", function() {
    it("should dispose objects passed to autoDispose", function() {

      var bar = new Bar();
      var baz = new Bar();
      var container1 = dom('div', dom('span'));
      var container2 = dom('div', dom('span'));
      var cleanup = sinon.spy();
      var stopListening = sinon.spy();

      function Foo() {
        this.bar = this.autoDispose(bar);
        this.baz = this.autoDisposeWith('destroy', baz);
        this.child1 = this.autoDispose(container1.appendChild(dom('div')));
        this.child2 = container2.appendChild(dom('div'));
        this.autoDisposeWith(dispose.emptyNode, container2);
        this.autoDisposeCallback(cleanup);
        this.stopListening = stopListening;
      }
      dispose.makeDisposable(Foo);

      var foo = new Foo();
      assert(!foo.isDisposed());
      assert.equal(container1.children.length, 2);
      assert.equal(container2.children.length, 2);

      foo.dispose();
      assert(foo.isDisposed());
      assert.equal(bar.dispose.callCount, 1);
      assert.equal(bar.destroy.callCount, 0);
      assert.equal(baz.dispose.callCount, 0);
      assert.equal(baz.destroy.callCount, 1);
      assert.equal(stopListening.callCount, 1);

      assert(bar.dispose.calledOn(bar));
      assert(bar.dispose.calledWithExactly());
      assert(baz.destroy.calledOn(baz));
      assert(baz.destroy.calledWithExactly());
      assert(cleanup.calledOn(foo));
      assert(cleanup.calledWithExactly());

      // Verify that disposal is called in reverse order of autoDispose calls.
      assert(cleanup.calledBefore(baz.destroy));
      assert(baz.destroy.calledBefore(bar.dispose));
      assert(bar.dispose.calledBefore(stopListening));

      // Verify that DOM children got removed: in the second case, the container should be
      // emptied.
      assert.equal(container1.children.length, 1);
      assert.equal(container2.children.length, 0);
    });

    it('should call multiple registered autoDisposeCallbacks in reverse order', function() {
      let spy = sinon.spy();

      function Foo() {
        this.autoDisposeCallback(() => {
          spy(1);
        });
        this.autoDisposeCallback(() => {
          spy(2);
        });
      }
      dispose.makeDisposable(Foo);

      var foo = new Foo(spy);
      foo.autoDisposeCallback(() => {
        spy(3);
      });

      foo.dispose();

      assert(foo.isDisposed());
      assert.equal(spy.callCount, 3);
      assert.deepEqual(spy.firstCall.args,  [3]);
      assert.deepEqual(spy.secondCall.args, [2]);
      assert.deepEqual(spy.thirdCall.args,  [1]);
    });
  });

  describe("create", function() {

    // Capture console.error messages.
    const consoleErrors = [];
    const origConsoleError = console.error;
    before(function() { console.error = (...args) => consoleErrors.push(args.map(x => ''+x)); });
    after(function() { console.error = origConsoleError; });

    it("should dispose partially constructed objects", function() {
      var bar = new Bar();
      var baz = new Bar();

      function Foo(throwWhen) {
        if (throwWhen === 0) { throw new Error("test-error1"); }
        this.bar = this.autoDispose(bar);
        if (throwWhen === 1) { throw new Error("test-error2"); }
        this.baz = this.autoDispose(baz);
        if (throwWhen === 2) { throw new Error("test-error3"); }
      }
      dispose.makeDisposable(Foo);

      var foo;
      // If we throw right away, no surprises, nothing gets called.
      assert.throws(function() { foo = Foo.create(0); }, /test-error1/);
      assert.strictEqual(foo, undefined);
      assert.equal(bar.dispose.callCount, 0);
      assert.equal(baz.dispose.callCount, 0);

      // If we constructed one object, that one object should have gotten disposed.
      assert.throws(function() { foo = Foo.create(1); }, /test-error2/);
      assert.strictEqual(foo, undefined);
      assert.equal(bar.dispose.callCount, 1);
      assert.equal(baz.dispose.callCount, 0);
      bar.dispose.resetHistory();

      // If we constructed two objects, both should have gotten disposed.
      assert.throws(function() { foo = Foo.create(2); }, /test-error3/);
      assert.strictEqual(foo, undefined);
      assert.equal(bar.dispose.callCount, 1);
      assert.equal(baz.dispose.callCount, 1);
      assert(baz.dispose.calledBefore(bar.dispose));
      bar.dispose.resetHistory();
      baz.dispose.resetHistory();

      // If we don't throw, then nothing should get disposed until we call .dispose().
      assert.doesNotThrow(function() { foo = Foo.create(3); });
      assert(!foo.isDisposed());
      assert.equal(bar.dispose.callCount, 0);
      assert.equal(baz.dispose.callCount, 0);
      foo.dispose();
      assert(foo.isDisposed());
      assert.equal(bar.dispose.callCount, 1);
      assert.equal(baz.dispose.callCount, 1);
      assert(baz.dispose.calledBefore(bar.dispose));

      const name = consoleErrors[0][1];  // may be Foo, or minified.
      assert(name === 'Foo' || name === 'o');  // this may not be reliable,
                                               // just what I happen to see.
      assert.deepEqual(consoleErrors[0], ['Error constructing %s:', name, 'Error: test-error1']);
      assert.deepEqual(consoleErrors[1], ['Error constructing %s:', name, 'Error: test-error2']);
      assert.deepEqual(consoleErrors[2], ['Error constructing %s:', name, 'Error: test-error3']);
      assert.equal(consoleErrors.length, 3);
    });

    it("promised objects should resolve during normal creation", function() {
      const bar = new Bar();
      bar.marker = 1;
      const barPromise = bluebird.Promise.resolve(bar);
      function Foo() {
        this.bar = this.autoDisposePromise(barPromise);
      }
      dispose.makeDisposable(Foo);
      const foo = Foo.create();
      return foo.bar.then(bar => {
        assert.ok(bar.marker);
      });
    });

    it("promised objects should resolve to null if owner is disposed", function() {
      let resolveBar;
      const barPromise = new bluebird.Promise(resolve => resolveBar = resolve);
      function Foo() {
        this.bar = this.autoDisposePromise(barPromise);
      }
      dispose.makeDisposable(Foo);
      const foo = Foo.create();
      const fooBar = foo.bar;
      foo.dispose();
      assert(foo.isDisposed);
      assert(foo.bar === null);
      const bar = new Bar();
      resolveBar(bar);
      return fooBar.then(bar => {
        assert.isNull(bar);
      });
    });
  });
});
