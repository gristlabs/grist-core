var _ = require('underscore');
var assert = require('chai').assert;
var sinon = require('sinon');
var rowset = require('app/client/models/rowset');

describe('rowset', function() {
  describe('RowListener', function() {
    it('should translate events to callbacks', function() {
      var src = rowset.RowSource.create(null);
      src.getAllRows = function() { return [1, 2, 3]; };

      var lis = rowset.RowListener.create(null);
      sinon.spy(lis, "onAddRows");
      sinon.spy(lis, "onRemoveRows");
      sinon.spy(lis, "onUpdateRows");

      lis.subscribeTo(src);
      assert.deepEqual(lis.onAddRows.args, [[[1, 2, 3], src]]);
      lis.onAddRows.resetHistory();

      src.trigger('rowChange', 'add', [5, 6]);
      src.trigger('rowChange', 'remove', [6, 1]);
      src.trigger('rowChange', 'update', [3, 5]);
      assert.deepEqual(lis.onAddRows.args, [[[5, 6], src]]);
      assert.deepEqual(lis.onRemoveRows.args, [[[6, 1], src]]);
      assert.deepEqual(lis.onUpdateRows.args, [[[3, 5], src]]);
    });

    it('should support subscribing to multiple sources', function() {
      var src1 = rowset.RowSource.create(null);
      src1.getAllRows = function() { return [1, 2, 3]; };

      var src2 = rowset.RowSource.create(null);
      src2.getAllRows = function() { return ["a", "b", "c"]; };

      var lis = rowset.RowListener.create(null);
      sinon.spy(lis, "onAddRows");
      sinon.spy(lis, "onRemoveRows");
      sinon.spy(lis, "onUpdateRows");

      lis.subscribeTo(src1);
      lis.subscribeTo(src2);
      assert.deepEqual(lis.onAddRows.args, [[[1, 2, 3], src1], [["a", "b", "c"], src2]]);

      src1.trigger('rowChange', 'update', [2, 3]);
      src2.trigger('rowChange', 'remove', ["b"]);
      assert.deepEqual(lis.onUpdateRows.args, [[[2, 3], src1]]);
      assert.deepEqual(lis.onRemoveRows.args, [[["b"], src2]]);

      lis.onAddRows.resetHistory();
      lis.unsubscribeFrom(src1);
      src1.trigger('rowChange', 'add', [4]);
      src2.trigger('rowChange', 'add', ["d"]);
      assert.deepEqual(lis.onAddRows.args, [[["d"], src2]]);
    });
  });

  describe('MappedRowSource', function() {
    it('should map row identifiers', function() {
      var src = rowset.RowSource.create(null);
      src.getAllRows = function() { return [1, 2, 3]; };

      var mapped = rowset.MappedRowSource.create(null, src, r => "X" + r);
      assert.deepEqual(mapped.getAllRows(), ["X1", "X2", "X3"]);

      var changeSpy = sinon.spy(), notifySpy = sinon.spy();
      mapped.on('rowChange', changeSpy);
      mapped.on('rowNotify', notifySpy);
      src.trigger('rowChange', 'add', [4, 5, 6]);
      src.trigger('rowNotify', [2, 3, 4], 'hello');
      src.trigger('rowNotify', rowset.ALL, 'world');
      src.trigger('rowChange', 'remove', [1, 5]);
      src.trigger('rowChange', 'update', [4, 2]);
      assert.deepEqual(changeSpy.args[0], ['add', ['X4', 'X5', 'X6']]);
      assert.deepEqual(changeSpy.args[1], ['remove', ['X1', 'X5']]);
      assert.deepEqual(changeSpy.args[2], ['update', ['X4', 'X2']]);
      assert.deepEqual(changeSpy.callCount, 3);
      assert.deepEqual(notifySpy.args[0], [['X2', 'X3', 'X4'], 'hello']);
      assert.deepEqual(notifySpy.args[1], [rowset.ALL, 'world']);
      assert.deepEqual(notifySpy.callCount, 2);
    });
  });

  function suiteFilteredRowSource(FilteredRowSourceClass) {
    it('should only forward matching rows', function() {
      var src = rowset.RowSource.create(null);
      src.getAllRows = function() { return [1, 2, 3]; };

      // Filter for only rows that are even numbers.
      var filtered = FilteredRowSourceClass.create(null, function(r) { return r % 2 === 0; });
      filtered.subscribeTo(src);
      assert.deepEqual(Array.from(filtered.getAllRows()), [2]);

      var spy = sinon.spy(), notifySpy = sinon.spy();
      filtered.on('rowChange', spy);
      filtered.on('rowNotify', notifySpy);
      src.trigger('rowChange', 'add', [4, 5, 6]);
      src.trigger('rowChange', 'add', [7]);
      src.trigger('rowNotify', [2, 3, 4], 'hello');
      src.trigger('rowNotify', rowset.ALL, 'world');
      src.trigger('rowChange', 'remove', [1, 5]);
      src.trigger('rowChange', 'remove', [2, 3, 6]);
      assert.deepEqual(spy.args[0], ['add', [4, 6]]);
      // Nothing for the middle 'add' and 'remove'.
      assert.deepEqual(spy.args[1], ['remove', [2, 6]]);
      assert.equal(spy.callCount, 2);

      assert.deepEqual(notifySpy.args[0], [[2, 4], 'hello']);
      assert.deepEqual(notifySpy.args[1], [rowset.ALL, 'world']);
      assert.equal(notifySpy.callCount, 2);

      assert.deepEqual(Array.from(filtered.getAllRows()), [4]);
    });

    it('should translate updates to adds or removes if needed', function() {
      var src = rowset.RowSource.create(null);
      src.getAllRows = function() { return [1, 2, 3]; };
      var includeSet = new Set([2, 3, 6]);

      // Filter for only rows that are in includeMap.
      var filtered = FilteredRowSourceClass.create(null, function(r) { return includeSet.has(r); });
      filtered.subscribeTo(src);
      assert.deepEqual(Array.from(filtered.getAllRows()), [2, 3]);

      var spy = sinon.spy();
      filtered.on('rowChange', spy);

      src.trigger('rowChange', 'add', [4, 5]);
      assert.equal(spy.callCount, 0);

      includeSet.add(4);
      includeSet.delete(2);
      src.trigger('rowChange', 'update', [3, 2, 4, 5]);
      assert.equal(spy.callCount, 3);
      assert.deepEqual(spy.args[0], ['remove', [2]]);
      assert.deepEqual(spy.args[1], ['update', [3]]);
      assert.deepEqual(spy.args[2], ['add', [4]]);

      spy.resetHistory();
      src.trigger('rowChange', 'update', [1]);
      assert.equal(spy.callCount, 0);
    });
  }

  describe('BaseFilteredRowSource',  () => {
    suiteFilteredRowSource(rowset.BaseFilteredRowSource);
  });

  describe('FilteredRowSource',  () => {
    suiteFilteredRowSource(rowset.FilteredRowSource);

    // One extra test case for FilteredRowSource.
    it('should support changing the filter function', function() {
      var src = rowset.RowSource.create(null);
      src.getAllRows = function() { return [1, 2, 3, 4, 5]; };
      var includeSet = new Set([2, 3, 6]);

      // Filter for only rows that are in includeMap.
      var filtered = rowset.FilteredRowSource.create(null, function(r) { return includeSet.has(r); });
      filtered.subscribeTo(src);
      assert.deepEqual(Array.from(filtered.getAllRows()), [2, 3]);

      var spy = sinon.spy();
      filtered.on('rowChange', spy);
      includeSet.add(4);
      includeSet.delete(2);
      filtered.updateFilter(function(r) { return includeSet.has(r); });
      assert.equal(spy.callCount, 2);
      assert.deepEqual(spy.args[0], ['remove', [2]]);
      assert.deepEqual(spy.args[1], ['add', [4]]);
      assert.deepEqual(Array.from(filtered.getAllRows()), [3, 4]);

      spy.resetHistory();
      includeSet.add(5);
      includeSet.add(17);
      includeSet.delete(3);
      filtered.refilterRows([2, 4, 5, 17]);
      // 3 is still in because we didn't ask to refilter it. 17 is still out because it's not in
      // any original source.
      assert.deepEqual(Array.from(filtered.getAllRows()), [3, 4, 5]);
      assert.equal(spy.callCount, 1);
      assert.deepEqual(spy.args[0], ['add', [5]]);
    });
  });

  describe('RowGrouping', function() {
    it('should add/remove/notify rows in the correct group', function() {
      var src = rowset.RowSource.create(null);
      src.getAllRows = function() { return ["a", "b", "c"]; };
      var groups = {a: 1, b: 2, c: 2, d: 1, e: 3, f: 3};

      var grouping = rowset.RowGrouping.create(null, function(r) { return groups[r]; });
      grouping.subscribeTo(src);

      var group1 = grouping.getGroup(1), group2 = grouping.getGroup(2);
      assert.deepEqual(Array.from(group1.getAllRows()), ["a"]);
      assert.deepEqual(Array.from(group2.getAllRows()), ["b", "c"]);

      var lis1 = sinon.spy(), lis2 = sinon.spy(), nlis1 = sinon.spy(), nlis2 = sinon.spy();
      group1.on('rowChange', lis1);
      group2.on('rowChange', lis2);
      group1.on('rowNotify', nlis1);
      group2.on('rowNotify', nlis2);

      src.trigger('rowChange', 'add', ["d", "e", "f"]);
      assert.deepEqual(lis1.args, [['add', ["d"]]]);
      assert.deepEqual(lis2.args, []);

      src.trigger('rowNotify', ["a", "e"], "foo");
      src.trigger('rowNotify', rowset.ALL, "bar");
      assert.deepEqual(nlis1.args, [[["a"], "foo"], [rowset.ALL, "bar"]]);
      assert.deepEqual(nlis2.args, [[rowset.ALL, "bar"]]);

      lis1.resetHistory();
      lis2.resetHistory();
      src.trigger('rowChange', 'remove', ["a", "b", "d", "e"]);
      assert.deepEqual(lis1.args, [['remove', ["a", "d"]]]);
      assert.deepEqual(lis2.args, [['remove', ["b"]]]);

      assert.deepEqual(Array.from(group1.getAllRows()), []);
      assert.deepEqual(Array.from(group2.getAllRows()), ["c"]);
      assert.deepEqual(Array.from(grouping.getGroup(3).getAllRows()), ["f"]);
    });

    it('should translate updates to adds or removes if needed', function() {
      var src = rowset.RowSource.create(null);
      src.getAllRows = function() { return ["a", "b", "c", "d", "e"]; };
      var groups = {a: 1, b: 2, c: 2, d: 1, e: 3, f: 3};

      var grouping = rowset.RowGrouping.create(null, function(r) { return groups[r]; });
      var group1 = grouping.getGroup(1), group2 = grouping.getGroup(2);
      grouping.subscribeTo(src);
      assert.deepEqual(Array.from(group1.getAllRows()), ["a", "d"]);
      assert.deepEqual(Array.from(group2.getAllRows()), ["b", "c"]);

      var lis1 = sinon.spy(), lis2 = sinon.spy();
      group1.on('rowChange', lis1);
      group2.on('rowChange', lis2);
      _.extend(groups, {a: 2, b: 3, e: 1});
      src.trigger('rowChange', 'update', ["a", "b", "d", "e"]);
      assert.deepEqual(lis1.args, [['remove', ['a']], ['update', ['d']], ['add', ['e']]]);
      assert.deepEqual(lis2.args, [['remove', ['b']], ['add', ['a']]]);

      lis1.resetHistory();
      lis2.resetHistory();
      src.trigger('rowChange', 'update', ["a", "b", "d", "e"]);
      assert.deepEqual(lis1.args, [['update', ['d', 'e']]]);
      assert.deepEqual(lis2.args, [['update', ['a']]]);
    });
  });

  describe('SortedRowSet', function() {
    var src, order, sortedSet, sortedArray;
    beforeEach(function() {
      src = rowset.RowSource.create(null);
      src.getAllRows = function() { return ["a", "b", "c", "d", "e"]; };
      order = {a: 4, b: 0, c: 1, d: 2, e: 3};
      sortedSet = rowset.SortedRowSet.create(null, function(a, b) { return order[a] - order[b]; });
      sortedArray = sortedSet.getKoArray();
    });

    it('should sort on first subscribe', function() {
      assert.deepEqual(sortedArray.peek(), []);
      sortedSet.subscribeTo(src);
      assert.deepEqual(sortedArray.peek(), ["b", "c", "d", "e", "a"]);
    });

    it('should maintain sort on adds and removes', function() {
      sortedSet.subscribeTo(src);

      var lis = sinon.spy();
      sortedArray.subscribe(lis, null, 'spliceChange');
      _.extend(order, {p: 2.5, q: 3.5});

      // Small changes (currently < 2 elements) trigger individual splice events.
      src.trigger('rowChange', 'add', ['p', 'q']);
      assert.deepEqual(sortedArray.peek(), ["b", "c", "d", "p", "e", "q", "a"]);
      assert.equal(lis.callCount, 2);
      assert.equal(lis.args[0][0].added, 1);
      assert.equal(lis.args[1][0].added, 1);

      lis.resetHistory();
      src.trigger('rowChange', 'remove', ["a", "c"]);
      assert.deepEqual(sortedArray.peek(), ["b", "d", "p", "e", "q"]);
      assert.equal(lis.callCount, 2);
      assert.deepEqual(lis.args[0][0].deleted, ["a"]);
      assert.deepEqual(lis.args[1][0].deleted, ["c"]);

      // Bigger changes trigger full array reassignment.
      lis.resetHistory();
      src.trigger('rowChange', 'remove', ['d', 'e', 'q']);
      assert.deepEqual(sortedArray.peek(), ["b", "p"]);
      assert.equal(lis.callCount, 1);

      lis.resetHistory();
      src.trigger('rowChange', 'add', ['a', 'c', 'd', 'e', 'q']);
      assert.deepEqual(sortedArray.peek(), ["b", "c", "d", "p", "e", "q", "a"]);
      assert.equal(lis.callCount, 1);
    });

    it('should maintain sort on updates', function() {
      var lis = sinon.spy();
      sortedArray.subscribe(lis, null, 'spliceChange');
      sortedSet.subscribeTo(src);
      assert.deepEqual(sortedArray.peek(), ["b", "c", "d", "e", "a"]);
      assert.equal(lis.callCount, 1);
      assert.equal(lis.args[0][0].added, 5);

      // Small changes (currently < 2 elements) trigger individual splice events.
      lis.resetHistory();
      _.extend(order, {"b": 1.5, "a": 2.5});
      src.trigger('rowChange', 'update', ["b", "a"]);
      assert.deepEqual(sortedArray.peek(), ["c", "b", "d", "a", "e"]);
      assert.equal(lis.callCount, 4);
      assert.deepEqual(lis.args[0][0].deleted, ["b"]);
      assert.deepEqual(lis.args[1][0].deleted, ["a"]);
      assert.deepEqual(lis.args[2][0].added, 1);
      assert.deepEqual(lis.args[3][0].added, 1);

      // Bigger changes trigger full array reassignment.
      lis.resetHistory();
      _.extend(order, {"b": 0, "a": 5, "c": 6});
      src.trigger('rowChange', 'update', ["c", "b", "a"]);
      assert.deepEqual(sortedArray.peek(), ["b", "d", "e", "a", "c"]);
      assert.equal(lis.callCount, 1);
      assert.deepEqual(lis.args[0][0].added, 5);
    });

    it('should not splice on irrelevant changes', function() {
      var lis = sinon.spy();
      sortedArray.subscribe(lis, null, 'spliceChange');
      sortedSet.subscribeTo(src);
      assert.deepEqual(sortedArray.peek(), ["b", "c", "d", "e", "a"]);

      // Changes that don't affect the order do not cause splices.
      lis.resetHistory();
      src.trigger('rowChange', 'update', ["d"]);
      src.trigger('rowChange', 'update', ["a", "b", "c"]);
      assert.deepEqual(sortedArray.peek(), ["b", "c", "d", "e", "a"]);
      assert.equal(lis.callCount, 0);
    });

    it('should pass on rowNotify events', function() {
      var lis = sinon.spy(), spy = sinon.spy();
      sortedSet.subscribeTo(src);
      assert.deepEqual(sortedArray.peek(), ["b", "c", "d", "e", "a"]);

      sortedArray.subscribe(lis, null, 'spliceChange');
      sortedSet.on('rowNotify', spy);

      src.trigger('rowNotify', ["b", "e"], "hello");
      src.trigger('rowNotify', rowset.ALL, "world");
      assert.equal(lis.callCount, 0);
      assert.deepEqual(spy.args, [[['b', 'e'], 'hello'], [rowset.ALL, 'world']]);
    });

    it('should allow changing compareFunc', function() {
      sortedSet.subscribeTo(src);
      assert.deepEqual(sortedArray.peek(), ["b", "c", "d", "e", "a"]);

      var lis = sinon.spy();
      sortedArray.subscribe(lis, null, 'spliceChange');

      // Replace the compare function with its negation.
      sortedSet.updateSort(function(a, b) { return order[b] - order[a]; });
      assert.equal(lis.callCount, 1);
      assert.deepEqual(lis.args[0][0].added, 5);
      assert.deepEqual(sortedArray.peek(), ["a", "e", "d", "c", "b"]);
    });

    it('should defer sorting while paused', function() {
      var sortCalled = false;
      assert.deepEqual(sortedArray.peek(), []);
      sortedSet.updateSort(function(a, b) { sortCalled = true; return order[a] - order[b]; });
      sortCalled = false;

      var lis = sinon.spy();
      sortedArray.subscribe(lis, null, 'spliceChange');

      // Check that our little setup catching sort calls works; then reset.
      sortedSet.subscribeTo(src);
      assert.equal(sortCalled, true);
      assert.equal(lis.callCount, 1);
      sortedSet.unsubscribeFrom(src);
      sortCalled = false;
      lis.resetHistory();

      // Now pause, do a bunch of operations, and check that sort has not been called.
      function checkNoEffect() {
        assert.equal(sortCalled, false);
        assert.equal(lis.callCount, 0);
      }
      sortedSet.pause(true);

      // Note that the initial order is ["b", "c", "d", "e", "a"]
      sortedSet.subscribeTo(src);
      checkNoEffect();

      _.extend(order, {p: 2.5, q: 3.5});
      src.trigger('rowChange', 'add', ['p', 'q']);
      checkNoEffect();  // But we should now expect b,c,d,p,e,q,a

      src.trigger('rowChange', 'remove', ["q", "c"]);
      checkNoEffect();  // But we should now expect b,d,p,e,a

      _.extend(order, {"b": 2.7, "a": 1});
      src.trigger('rowChange', 'update', ["b", "a"]);
      checkNoEffect();  // But we should now expect a,d,p,b,e

      sortedSet.updateSort(function(a, b) { sortCalled = true; return order[b] - order[a]; });
      checkNoEffect();  // We should expect a reversal: e,b,p,d,a

      // rowNotify events should still be passed through.
      var spy = sinon.spy();
      sortedSet.on('rowNotify', spy);
      src.trigger('rowNotify', ["p", "e"], "hello");
      assert.deepEqual(spy.args[0], [['p', 'e'], 'hello']);

      checkNoEffect();

      // Now unpause, check that things get updated, and that the result is correct.
      sortedSet.pause(false);
      assert.equal(sortCalled, true);
      assert.equal(lis.callCount, 1);
      assert.deepEqual(sortedArray.peek(), ["e", "b", "p", "d", "a"]);
    });
  });
});
