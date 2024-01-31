var assert = require('chai').assert;
var gutil = require('app/common/gutil');
var _ = require('underscore');

describe('gutil', function() {

  describe("mapToObject", function() {
    it("should produce an object with all keys", function() {
      assert.deepEqual(gutil.mapToObject(["foo", "bar", "baz"], function(value, i) {
        return [value.toUpperCase(), i];
      }), {
        "foo": ["FOO", 0],
        "bar": ["BAR", 1],
        "baz": ["BAZ", 2]
      });

      assert.deepEqual(gutil.mapToObject(["foo", "bar", "baz"], function() {}), {
        "foo": undefined,
        "bar": undefined,
        "baz": undefined,
      });
    });

    it("should work on an empty array", function() {
      var countCalls = 0;
      assert.deepEqual(gutil.mapToObject([], function() { countCalls++; }), {});
      assert.equal(countCalls, 0);
    });

    it("should override values for duplicate keys", function() {
      assert.deepEqual(gutil.mapToObject(["foo", "bar", "foo"], function(val, i) { return i; }),
                       { "foo": 2, "bar": 1 });
    });
  });

  describe('multiCompareFunc', function() {
    var firstName = {
      0: 'John',
      1: 'John',
      2: 'John',
      3: 'John',
      4: 'Johnson',
      5: 'Johnson',
    };
    var lastName = {
      0: 'Smith',
      1: 'Smith',
      2: 'Smith',
      3: 'Smithy',
      4: 'Smithy',
      5: 'Smith',
    };
    var age = {
      0: 20,
      1: 30,
      2: 21,
      3: 31,
      4: 40,
      5: 50,
    };

    it('should do single comparisons', function() {
      var sort1 = [_.propertyOf(firstName)];
      var compareA = gutil.multiCompareFunc(sort1, [gutil.nativeCompare], [1]);
      var compareD = gutil.multiCompareFunc(sort1, [gutil.nativeCompare], [-1]);
      assert.equal(compareA(0, 1), 0);   // John == John
      assert.equal(compareD(0, 1), 0);
      assert.isBelow(compareA(0, 4), 0); // John < Johnson if ascending
      assert.isAbove(compareA(4, 0), 0);
      assert.isAbove(compareD(0, 4), 0); // John > Johnson if descending
      assert.isBelow(compareD(4, 0), 0);
    });

    it('should do multiple comparisons', function() {
      var sort2 = [_.propertyOf(firstName), _.propertyOf(lastName)];
      var sort3 = [_.propertyOf(firstName), _.propertyOf(lastName), _.propertyOf(age)];
      var compare2 = gutil.multiCompareFunc(sort2, [gutil.nativeCompare, gutil.nativeCompare], [1, 1]);
      var compare3 = gutil.multiCompareFunc(sort3,
                       [gutil.nativeCompare, gutil.nativeCompare, gutil.nativeCompare], [1, 1, -1]);

      assert.equal(compare2(0, 1), 0); // John Smith, 20 = John Smith, 30
      assert.equal(compare2(1, 2), 0); // John Smith, 30 = John Smith, 21
      assert.isBelow(compare2(0, 3), 0); // John Smith < John Smithy
      assert.isBelow(compare2(0, 4), 0); // John Smith < Johnson Smithy
      assert.isBelow(compare2(0, 5), 0); // John Smith < Johnson Smith

      assert.isAbove(compare3(0, 1), 0); // John Smith, 20 > John Smith, 30 (age descending)
      assert.isBelow(compare3(1, 2), 0); // John Smith, 30 < John Smith, 21
      assert.isBelow(compare3(0, 3), 0); // John Smith, 20 < John Smithy, 31
      assert.isBelow(compare3(0, 4), 0); // John Smith, 20 < Johnson Smithy, 40
      assert.isBelow(compare3(3, 4), 0); // John Smithy, 20 < Johnson Smithy, 40
      assert.isAbove(compare3(4, 5), 0); // Johnson Smithy > Johnson Smith
    });
  });

  describe("deepExtend", function() {
    var sample = {
      a: 1,
      b: "hello",
      c: [1, 2, 3],
      d: { e: 1, f: 2 }
    };
    it("should copy recursively", function() {
      assert.deepEqual(gutil.deepExtend({}, {}), {});
      assert.deepEqual(gutil.deepExtend({}, sample), sample);
      assert.deepEqual(gutil.deepExtend({}, sample, {}), sample);
      assert.deepEqual(gutil.deepExtend({}, sample, sample), sample);
      assert.deepEqual(gutil.deepExtend({}, sample, {a: 2}).a, 2);
      assert.deepEqual(gutil.deepExtend({}, sample, {d: {g: 3}}).d, {e:1, f:2, g:3});
      assert.deepEqual(gutil.deepExtend({c: [4, 5, 6, 7], d: {g: 3}}, sample).d, {e:1, f:2, g:3});
      assert.deepEqual(gutil.deepExtend({c: [4, 5, 6, 7], d: {g: 3}}, sample).c, [1, 2, 3, 7]);
    });
  });

  describe("maxsplit", function() {
    it("should respect maxNumSplits parameter", function() {
      assert.deepEqual(gutil.maxsplit("foo bar baz", " ", 0), ["foo bar baz"]);
      assert.deepEqual(gutil.maxsplit("foo bar baz", " ", 1), ["foo", "bar baz"]);
      assert.deepEqual(gutil.maxsplit("foo bar baz", " ", 2), ["foo", "bar", "baz"]);
      assert.deepEqual(gutil.maxsplit("foo bar baz", " ", 3), ["foo", "bar", "baz"]);
      assert.deepEqual(gutil.maxsplit("foo<x>bar<x>baz", "<x>", 1), ["foo", "bar<x>baz"]);
    });
  });

  describe("arrayInsertBefore", function() {
    it("should insert before the given nextValue", function() {
      var array = ["foo", "bar", "baz"];
      gutil.arrayInsertBefore(array, "asdf", "foo");
      assert.deepEqual(array, ["asdf", "foo", "bar", "baz"]);
      gutil.arrayInsertBefore(array, "hello", "baz");
      assert.deepEqual(array, ["asdf", "foo", "bar", "hello", "baz"]);
      gutil.arrayInsertBefore(array, "zoo", "unknown");
      assert.deepEqual(array, ["asdf", "foo", "bar", "hello", "baz", "zoo"]);
    });
  });

  describe("popFromMap", function() {
    it("should return the value for the popped key", function() {
      var map = new Map([["foo", 1], ["bar", 2], ["baz", 3]]);
      assert.equal(gutil.popFromMap(map, "bar"), 2);
      assert.deepEqual(Array.from(map), [["foo", 1], ["baz", 3]]);
      assert.strictEqual(gutil.popFromMap(map, "unknown"), undefined);
      assert.deepEqual(Array.from(map), [["foo", 1], ["baz", 3]]);
    });
  });

  describe("isSubset", function() {
    it("should determine the subset relationship for Sets", function() {
      let sEmpty = new Set(),
          sFoo = new Set([1]),
          sBar = new Set([2, 3]),
          sBaz = new Set([1, 2, 3]);

      assert.isTrue(gutil.isSubset(sEmpty, sFoo));
      assert.isFalse(gutil.isSubset(sFoo, sEmpty));

      assert.isTrue(gutil.isSubset(sFoo, sBaz));
      assert.isFalse(gutil.isSubset(sFoo, sBar));

      assert.isTrue(gutil.isSubset(sBar, sBaz));
      assert.isTrue(gutil.isSubset(sBar, sBar));

      assert.isTrue(gutil.isSubset(sBaz, sBaz));
      assert.isFalse(gutil.isSubset(sBaz, sBar));
    });
  });

  describe("growMatrix", function() {
    it("should grow the matrix to the desired size", function() {
      let matrix = [["a", 1], ["b", 2], ["c", 3]];
      assert.deepEqual(gutil.growMatrix(matrix, 4, 4),
       [["a", 1, "a", 1],
        ["b", 2, "b", 2],
        ["c", 3, "c", 3],
        ["a", 1, "a", 1]]);
      assert.deepEqual(gutil.growMatrix(matrix, 3, 4),
       [["a", 1, "a", 1],
        ["b", 2, "b", 2],
        ["c", 3, "c", 3]]);
      assert.deepEqual(gutil.growMatrix(matrix, 6, 2),
       [["a", 1],
        ["b", 2],
        ["c", 3],
        ["a", 1],
        ["b", 2],
        ["c", 3]]);
    });
  });

  describe("sortedScan", function() {
    it("should callback on the correct items for simple arrays", function() {
      const a = [1, 2, 4, 5, 7, 8, 9, 10, 11, 15, 17];
      const b = [2, 3, 4, 5, 9, 11, 19];

      // Run the scan function, allowing it to populate callArgs.
      let callArgs = [];
      gutil.sortedScan(a, b, (ai, bi) => { callArgs.push([ai, bi]); });

      assert.deepEqual(callArgs,
       [[1, null], [2, 2], [null, 3], [4, 4],
        [5, 5], [7, null], [8, null], [9, 9],
        [10, null], [11, 11], [15, null], [17, null],
        [null, 19]]);
    });

    it("should callback on the correct items for object arrays", function() {
      const a = [{ id: 1,  fruit: 'apple'     },
                 { id: 2,  fruit: 'banana'    },
                 { id: 4,  fruit: 'orange'    },
                 { id: 5,  fruit: 'peach'     },
                 { id: 6,  fruit: 'plum'      }];
      const b = [{ id: 2,  fruit: 'apple'     },
                 { id: 3,  fruit: 'avocado'   },
                 { id: 4,  fruit: 'peach'     },
                 { id: 6,  fruit: 'pear'      },
                 { id: 9,  fruit: 'plum'      },
                 { id: 10, fruit: 'raspberry' }];

      // Run the scan function.
      let fruitArgs = [];
      gutil.sortedScan(a, b, (ai, bi) => {
        fruitArgs.push([ai ? ai.fruit : '', bi ? bi.fruit : '']);
      }, item => item.id);

      assert.deepEqual(fruitArgs,
       [['apple', ''], ['banana', 'apple'], ['', 'avocado'],
        ['orange', 'peach'], ['peach', ''], ['plum', 'pear'],
        ['', 'plum'], ['', 'raspberry']]);

      // Run the scan function again, using fruit as the key.
      let idArgs = [];
      gutil.sortedScan(a, b, (ai, bi) => {
        idArgs.push([ai ? ai.id : 0, bi ? bi.id : 0]);
      }, item => item.fruit);

      assert.deepEqual(idArgs,
       [[1, 2], [0, 3], [2, 0], [4, 0],
        [5, 4], [0, 6], [6, 9], [0, 10]]);
    });
  });

  describe("isEmail", function() {
    it("should distinguish valid and invalid emails", function() {
      // Reference: https://blogs.msdn.microsoft.com/testing123/2009/02/06/email-address-test-cases/
      assert.isTrue(gutil.isEmail('email@domain.com'));
      assert.isTrue(gutil.isEmail('e-mail_123@domain.com'));
      assert.isTrue(gutil.isEmail('email@subdomain.do-main.com'));
      assert.isTrue(gutil.isEmail('firstname+lastname@domain.com'));
      assert.isTrue(gutil.isEmail('email@domain.co.jp'));
      assert.isTrue(gutil.isEmail('marie@isola.corsica'));

      assert.isFalse(gutil.isEmail('plainaddress'));
      assert.isFalse(gutil.isEmail('@domain.com'));
      assert.isFalse(gutil.isEmail('email@domain@domain.com'));
      assert.isFalse(gutil.isEmail('.email@domain.com'));
      assert.isFalse(gutil.isEmail('email.@domain.com'));
      assert.isFalse(gutil.isEmail('email..email@domain.com'));
      assert.isFalse(gutil.isEmail('あいうえお@domain.com'));
      assert.isFalse(gutil.isEmail('email@domain'));
    });
  });

});
