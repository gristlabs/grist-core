var _ = require('underscore');
var assert = require('assert');
var ko = require('knockout');
var sinon = require('sinon');

var clientUtil = require('../clientUtil');
var koArray = require('app/client/lib/koArray');

describe('koArray', function() {
  clientUtil.setTmpMochaGlobals();

  it("should emit spliceChange events", function() {
    var arr = koArray([1, 2, 3]);

    var events = [];

    // Whenever we get an event, push it to events.
    ['change', 'spliceChange'].forEach(function(type) {
      arr.subscribe(function(data) {
        events.push({ type: type, data: data });
      }, null, type);
    });

    function expectSplice(start, num, deleted, options) {
      assert.equal(events.length, 2);
      var e = events.shift();
      assert.equal(e.type, 'spliceChange');
      assert.equal(e.data.start, start);
      assert.equal(e.data.added, num);
      assert.deepEqual(e.data.deleted, deleted);

      e = events.shift();
      assert.equal(e.type, 'change');
    }

    assert.deepEqual(arr.all(), [1, 2, 3]);

    // push should work fine.
    arr.push("foo");
    expectSplice(3, 1, []);

    arr.push("bar");
    expectSplice(4, 1, []);
    assert.deepEqual(arr.all(), [1, 2, 3, "foo", "bar"]);
    assert.deepEqual(arr.peek(), [1, 2, 3, "foo", "bar"]);
    assert.equal(arr.peekLength, 5);

    // insertions via splice should work.
    arr.splice(1, 0, "hello", "world");
    expectSplice(1, 2, []);
    assert.deepEqual(arr.all(), [1, "hello", "world", 2, 3, "foo", "bar"]);

    // including using negative indices.
    arr.splice(-6, 2, "blah");
    expectSplice(1, 1, ["hello", "world"]);
    assert.deepEqual(arr.all(), [1, "blah", 2, 3, "foo", "bar"]);

    // slice should work but not emit anything.
    assert.deepEqual(arr.slice(3, 5), [3, "foo"]);
    assert.equal(events.length, 0);

    // deletions using splice should work
    arr.splice(-2, 1);
    expectSplice(4, 0, ["foo"]);
    assert.deepEqual(arr.all(), [1, "blah", 2, 3, "bar"]);

    // including deletions to the end
    arr.splice(1);
    expectSplice(1, 0, ["blah", 2, 3, "bar"]);
    assert.deepEqual(arr.all(), [1]);

    // setting a new array should also produce a splice event.
    var newValues = [4, 5, 6];
    arr.assign(newValues);
    expectSplice(0, 3, [1]);

    // Check that koArray does not affect the array passed-in on assignment.
    arr.push(7);
    expectSplice(3, 1, []);
    assert.deepEqual(newValues, [4, 5, 6]);
    assert.deepEqual(arr.peek(), [4, 5, 6, 7]);

    // We don't support various observableArray() methods. If we do start supporting them, we
    // need to make sure they emit correct events.
    assert.throws(function() { arr.pop(); }, Error);
    assert.throws(function() { arr.remove("b"); }, Error);
  });

  it("should create dependencies when needed", function() {
    var arr = koArray([1, 2, 3]);
    var sum = ko.computed(function() {
      return arr.all().reduce(function(sum, item) { return sum + item; }, 0);
    });
    var peekSum = ko.computed(function() {
      return arr.peek().reduce(function(sum, item) { return sum + item; }, 0);
    });

    assert.equal(sum(), 6);
    assert.equal(peekSum(), 6);
    arr.push(10);
    assert.equal(sum(), 16);
    assert.equal(peekSum(), 6);
    arr.splice(1, 1);
    assert.equal(sum(), 14);
    assert.equal(peekSum(), 6);
    arr.splice(0);
    assert.equal(sum(), 0);
    assert.equal(peekSum(), 6);
  });

  describe("#arraySplice", function() {
    it("should work similarly to splice", function() {
      var arr = koArray([1, 2, 3]);
      arr.arraySplice(1, 2, []);
      assert.deepEqual(arr.peek(), [1]);
      arr.arraySplice(1, 0, [10, 11]);
      assert.deepEqual(arr.peek(), [1, 10, 11]);
      arr.arraySplice(0, 0, [4, 5]);
      assert.deepEqual(arr.peek(), [4, 5, 1, 10, 11]);
    });
  });

  describe("#makeLiveIndex", function() {
    it("should be kept valid", function() {
      var arr = koArray([1, 2, 3]);
      var index = arr.makeLiveIndex();
      assert.equal(index(), 0);

      index(-1);
      assert.equal(index(), 0);

      index(null);
      assert.equal(index(), 0);

      index(100);
      assert.equal(index(), 2);

      arr.splice(1, 1);
      assert.deepEqual(arr.peek(), [1, 3]);
      assert.equal(index(), 1);

      arr.splice(0, 1, 5, 6, 7);
      assert.deepEqual(arr.peek(), [5, 6, 7, 3]);
      assert.equal(index(), 3);

      arr.push(10);
      arr.splice(2, 2);
      assert.deepEqual(arr.peek(), [5, 6, 10]);
      assert.equal(index(), 2);

      arr.splice(2, 1);
      assert.deepEqual(arr.peek(), [5, 6]);
      assert.equal(index(), 1);

      arr.splice(0, 2);
      assert.deepEqual(arr.peek(), []);
      assert.equal(index(), null);

      arr.splice(0, 0, 1, 2, 3);
      assert.deepEqual(arr.peek(), [1, 2, 3]);
      assert.equal(index(), 0);
    });
  });

  describe("#map", function() {
    it("should map immediately and continuously", function() {
      var arr = koArray([1, 2, 3]);
      var mapped = arr.map(function(orig) { return orig * 10; });
      assert.deepEqual(mapped.peek(), [10, 20, 30]);
      arr.push(4);
      assert.deepEqual(mapped.peek(), [10, 20, 30, 40]);
      arr.splice(1, 1);
      assert.deepEqual(mapped.peek(), [10, 30, 40]);
      arr.splice(0, 1, 5, 6, 7);
      assert.deepEqual(mapped.peek(), [50, 60, 70, 30, 40]);
      arr.splice(2, 0, 2);
      assert.deepEqual(mapped.peek(), [50, 60, 20, 70, 30, 40]);
      arr.splice(1, 3);
      assert.deepEqual(mapped.peek(), [50, 30, 40]);
      arr.splice(0, 0, 1, 2, 3);
      assert.deepEqual(mapped.peek(), [10, 20, 30, 50, 30, 40]);
      arr.splice(3, 3);
      assert.deepEqual(mapped.peek(), [10, 20, 30]);

      // Check that `this` argument works correctly.
      var foo = { test: function(orig) { return orig * 100; } };
      var mapped2 = arr.map(function(orig) { return this.test(orig); }, foo);
      assert.deepEqual(mapped2.peek(), [100, 200, 300]);
      arr.splice(1, 0, 4, 5);
      assert.deepEqual(mapped2.peek(), [100, 400, 500, 200, 300]);
    });
  });

  describe("#syncMap", function() {
    it("should keep two arrays in sync", function() {
      var arr1 = koArray([1, 2, 3]);
      var arr2 = koArray([4, 5, 6]);
      var mapped = koArray();

      mapped.syncMap(arr1);
      assert.deepEqual(mapped.peek(), [1, 2, 3]);
      arr1.splice(1, 1, 8, 9);
      assert.deepEqual(mapped.peek(), [1, 8, 9, 3]);

      mapped.syncMap(arr2, function(x) { return x * 10; });
      assert.deepEqual(mapped.peek(), [40, 50, 60]);
      arr1.splice(1, 1, 8, 9);
      assert.deepEqual(mapped.peek(), [40, 50, 60]);
      arr2.push(8, 9);
      assert.deepEqual(mapped.peek(), [40, 50, 60, 80, 90]);
    });
  });

  describe('#subscribeForEach', function() {
    it('should call onAdd and onRemove callbacks', function() {
      var arr1 = koArray([1, 2, 3]);
      var seen = [];
      function onAdd(x) { seen.push(["add", x]); }
      function onRm(x) { seen.push(["rm", x]); }
      var sub = arr1.subscribeForEach({ add: onAdd, remove: onRm });
      assert.deepEqual(seen, [["add", 1], ["add", 2], ["add", 3]]);

      seen = [];
      arr1.push(4);
      assert.deepEqual(seen, [["add", 4]]);

      seen = [];
      arr1.splice(1, 2);
      assert.deepEqual(seen, [["rm", 2], ["rm", 3]]);

      seen = [];
      arr1.splice(0, 1, 5, 6);
      assert.deepEqual(seen, [["rm", 1], ["add", 5], ["add", 6]]);

      // If subscription is disposed, callbacks should no longer get called.
      sub.dispose();
      seen = [];
      arr1.push(10);
      assert.deepEqual(seen, []);
    });
  });

  describe('#setAutoDisposeValues', function() {
    it('should dispose elements when asked', function() {
      var objects = _.range(5).map(function(n) { return { value: n, dispose: sinon.spy() }; });
      var arr = koArray(objects.slice(0, 3)).setAutoDisposeValues();

      // Just to check what's in the array to start with.
      assert.equal(arr.all().length, 3);
      assert.strictEqual(arr.at(0), objects[0]);

      // Delete two elements: they should get disposed, but the remaining one should not.
      var x = arr.splice(0, 2);
      assert.equal(arr.all().length, 1);
      assert.strictEqual(arr.at(0), objects[2]);
      assert.equal(x.length, 2);
      sinon.assert.calledOnce(x[0].dispose);
      sinon.assert.calledOnce(x[1].dispose);
      sinon.assert.notCalled(objects[2].dispose);

      // Reassign: the remaining element should now also get disposed.
      arr.assign(objects.slice(3, 5));
      assert.equal(arr.all().length, 2);
      assert.strictEqual(arr.at(0), objects[3]);
      sinon.assert.calledOnce(objects[2].dispose);
      sinon.assert.notCalled(objects[3].dispose);
      sinon.assert.notCalled(objects[4].dispose);

      // Dispose the entire array: previously assigned elements should be disposed.
      arr.dispose();
      sinon.assert.calledOnce(objects[3].dispose);
      sinon.assert.calledOnce(objects[4].dispose);

      // Check that elements disposed earlier haven't been disposed more than once.
      sinon.assert.calledOnce(objects[0].dispose);
      sinon.assert.calledOnce(objects[1].dispose);
      sinon.assert.calledOnce(objects[2].dispose);
    });
  });

  describe('syncedKoArray', function() {
    it("should return array synced to the value of the observable", function() {
      var arr1 = koArray(["1", "2", "3"]);
      var arr2 = koArray(["foo", "bar"]);
      var arr3 = ["hello", "world"];
      var obs = ko.observable(arr1);

      var combined = koArray.syncedKoArray(obs);

      // The values match the array returned by the observable, but mapped using wrap().
      assert.deepEqual(combined.all(), ["1", "2", "3"]);

      // Changes to the array changes the synced array.
      arr1.push("4");
      assert.deepEqual(combined.all(), ["1", "2", "3", "4"]);

      // Changing the observable changes the synced array; the value may be a plain array.
      obs(arr3);
      assert.deepEqual(combined.all(), ["hello", "world"]);

      // Previously mapped observable array no longer affects the combined one. And of course
      // modifying the non-observable array makes no difference either.
      arr1.push("4");
      arr3.splice(0, 1);
      arr3.push("qwer");
      assert.deepEqual(combined.all(), ["hello", "world"]);

      // Test assigning again to a koArray.
      obs(arr2);
      assert.deepEqual(combined.all(), ["foo", "bar"]);
      arr2.splice(0, 1);
      assert.deepEqual(combined.all(), ["bar"]);
      arr2.splice(0, 0, "this", "is", "a", "test");
      assert.deepEqual(combined.all(), ["this", "is", "a", "test", "bar"]);
      arr2.assign(["10", "20"]);
      assert.deepEqual(combined.all(), ["10", "20"]);

      // Check that only arr2 has a subscriber (not arr1), and that disposing unsubscribes from
      // both the observable and the currently active array.
      assert.equal(arr1.getObservable().getSubscriptionsCount(), 1);
      assert.equal(arr2.getObservable().getSubscriptionsCount(), 2);
      assert.equal(obs.getSubscriptionsCount(), 1);
      combined.dispose();
      assert.equal(obs.getSubscriptionsCount(), 0);
      assert.equal(arr2.getObservable().getSubscriptionsCount(), 1);
    });

    it("should work with a mapper callback", function() {
      var arr1 = koArray(["1", "2", "3"]);
      var obs = ko.observable();

      function wrap(value) { return "x" + value; }
      var combined = koArray.syncedKoArray(obs, wrap);
      assert.deepEqual(combined.all(), []);
      obs(arr1);
      assert.deepEqual(combined.all(), ["x1", "x2", "x3"]);
      arr1.push("4");
      assert.deepEqual(combined.all(), ["x1", "x2", "x3", "x4"]);
      obs(["foo", "bar"]);
      assert.deepEqual(combined.all(), ["xfoo", "xbar"]);
      arr1.splice(1, 1);
      obs(arr1);
      arr1.splice(1, 1);
      assert.deepEqual(combined.all(), ["x1", "x4"]);
    });
  });

  describe("syncedMap", function() {
    it("should associate state with each item and dispose it", function() {
      var arr = koArray(["1", "2", "3"]);
      var constructSpy = sinon.spy(), disposeSpy = sinon.spy();
      var map = koArray.syncedMap(arr, (state, val) => {
        constructSpy(val);
        state.autoDisposeCallback(() => disposeSpy(val));
      });
      assert.deepEqual(constructSpy.args, [["1"], ["2"], ["3"]]);
      assert.deepEqual(disposeSpy.args, []);
      arr.splice(1, 0, "4", "5");
      assert.deepEqual(arr.peek(), ["1", "4", "5", "2", "3"]);
      assert.deepEqual(constructSpy.args, [["1"], ["2"], ["3"], ["4"], ["5"]]);
      assert.deepEqual(disposeSpy.args, []);
      arr.splice(0, 2);
      assert.deepEqual(constructSpy.args, [["1"], ["2"], ["3"], ["4"], ["5"]]);
      assert.deepEqual(disposeSpy.args, [["1"], ["4"]]);
      map.dispose();
      assert.deepEqual(constructSpy.args, [["1"], ["2"], ["3"], ["4"], ["5"]]);
      assert.deepEqual(disposeSpy.args, [["1"], ["4"], ["2"], ["3"], ["5"]]);
    });
  });
});
