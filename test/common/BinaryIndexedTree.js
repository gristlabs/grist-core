var assert = require('assert');
var BinaryIndexedTree = require('app/common/BinaryIndexedTree');

describe("BinaryIndexedTree", function() {
  describe('#leastSignificantOne', function() {
    it("should only keep the least significant one", function() {
      assert.equal(BinaryIndexedTree.leastSignificantOne(1), 1);
      assert.equal(BinaryIndexedTree.leastSignificantOne(6), 2);
      assert.equal(BinaryIndexedTree.leastSignificantOne(15), 1);
      assert.equal(BinaryIndexedTree.leastSignificantOne(16), 16);
      assert.equal(BinaryIndexedTree.leastSignificantOne(0), 0);
    });
  });

  describe('#stripLeastSignificantOne', function() {
    it("should strip the least significant one", function() {
      assert.equal(BinaryIndexedTree.stripLeastSignificantOne(1), 0);
      assert.equal(BinaryIndexedTree.stripLeastSignificantOne(6), 4);
      assert.equal(BinaryIndexedTree.stripLeastSignificantOne(15), 14);
      assert.equal(BinaryIndexedTree.stripLeastSignificantOne(16), 0);
      assert.equal(BinaryIndexedTree.stripLeastSignificantOne(0), 0);
      assert.equal(BinaryIndexedTree.stripLeastSignificantOne(24), 16);
    });
  });

  describe('#mostSignificantOne', function() {
    it("should keep the most significant one", function() {
      assert.equal(BinaryIndexedTree.mostSignificantOne(1), 1);
      assert.equal(BinaryIndexedTree.mostSignificantOne(6), 4);
      assert.equal(BinaryIndexedTree.mostSignificantOne(15), 8);
      assert.equal(BinaryIndexedTree.mostSignificantOne(16), 16);
      assert.equal(BinaryIndexedTree.mostSignificantOne(24), 16);
      assert.equal(BinaryIndexedTree.mostSignificantOne(0), 0);
    });
  });

  describe('#cumulToValues', function() {
    it("should convert cumulative array to regular values", function() {
      assert.deepEqual(BinaryIndexedTree.cumulToValues([1, 3, 6, 10]), [1, 2, 3, 4]);
      assert.deepEqual(BinaryIndexedTree.cumulToValues([1, 3, 6, 10, 15, 21]), [1, 2, 3, 4, 5, 6]);
      assert.deepEqual(BinaryIndexedTree.cumulToValues([]), []);
    });
  });

  describe('#valuesToCumul', function() {
    it("should convert value array to cumulative array", function() {
      assert.deepEqual(BinaryIndexedTree.valuesToCumul([1, 2, 3, 4]), [1, 3, 6, 10]);
      assert.deepEqual(BinaryIndexedTree.valuesToCumul([1, 2, 3, 4, 5, 6]), [1, 3, 6, 10, 15, 21]);
      assert.deepEqual(BinaryIndexedTree.valuesToCumul([]), []);
    });
  });

  //----------------------------------------------------------------------

  // Test array of length 25.
  var data1 = [47, 17, 28, 96, 10, 2, 11, 43, 7, 94, 37, 81, 75, 2, 33, 57, 68, 71, 68, 86, 27, 44, 64, 41, 23];

  // Test array of length 64.
  var data2 = [722, 106, 637, 881, 752, 940, 989, 295, 344, 716, 283, 609, 482, 268, 884, 782, 628, 778, 442, 456, 171, 821, 346, 367, 12, 46, 582, 164, 876, 421, 749, 357, 586, 319, 847, 79, 649, 353, 545, 353, 609, 865, 229, 476, 697, 579, 109, 935, 412, 286, 701, 712, 288, 45, 990, 176, 775, 143, 187, 241, 721, 691, 162, 460];
  var cdata1, cdata2;   // Cumulative versions.

  function dumbGetCumulativeValue(array, index) {
    for (var i = 0, x = 0; i <= index; i++) {
      x += array[i];
    }
    return x;
  }

  /*
  function dumbGetIndex(array, cumulValue) {
    for (var i = 0, x = 0; i <= array.length && x <= cumulValue; i++) {
      x += array[i];
    }
    return i;
  }
 */

  before(function() {
    cdata1 = data1.map(function(value, i) { return dumbGetCumulativeValue(data1, i); });
    cdata2 = data2.map(function(value, i) { return dumbGetCumulativeValue(data2, i); });
  });

  describe('BinaryIndexedTree class', function() {
    it("should construct trees with zeroes", function() {
      var bit = new BinaryIndexedTree();
      assert.equal(bit.size(), 0);
      bit.fillFromValues([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      var bit2 = new BinaryIndexedTree(10);
      assert.deepEqual(bit, bit2);
    });

    it("should convert from cumulative array and back", function() {
      var bit = new BinaryIndexedTree();
      bit.fillFromCumulative(cdata1);
      assert.equal(bit.size(), 25);
      assert.deepEqual(bit.toCumulativeArray(), cdata1);
      assert.deepEqual(bit.toValueArray(), data1);

      bit.fillFromCumulative([]);
      assert.equal(bit.size(), 0);
      assert.deepEqual(bit.toCumulativeArray(), []);
      assert.deepEqual(bit.toValueArray(), []);

      bit.fillFromCumulative(cdata2);
      assert.equal(bit.size(), 64);
      assert.deepEqual(bit.toCumulativeArray(), cdata2);
      assert.deepEqual(bit.toValueArray(), data2);
    });

    it("should convert from value array and back", function() {
      var bit = new BinaryIndexedTree();
      bit.fillFromValues(data1);
      assert.equal(bit.size(), 25);
      assert.deepEqual(bit.toCumulativeArray(), cdata1);
      assert.deepEqual(bit.toValueArray(), data1);

      bit.fillFromValues([]);
      assert.equal(bit.size(), 0);
      assert.deepEqual(bit.toCumulativeArray(), []);
      assert.deepEqual(bit.toValueArray(), []);

      bit.fillFromValues(data2);
      assert.equal(bit.size(), 64);
      assert.deepEqual(bit.toCumulativeArray(), cdata2);
      assert.deepEqual(bit.toValueArray(), data2);

      bit.fillFromValues([1, 2, 3, 4, 5]);
      assert.equal(bit.size(), 5);
      assert.deepEqual(bit.toCumulativeArray(), [1, 3, 6, 10, 15]);
      assert.deepEqual(bit.toValueArray(), [1, 2, 3, 4, 5]);
    });

    it("should compute individual and cumulative values", function() {
      var i, bit = new BinaryIndexedTree();
      bit.fillFromValues(data1);
      assert.equal(bit.size(), 25);
      for (i = 0; i < 25; i++) {
        assert.equal(bit.getValue(i), data1[i]);
        assert.equal(bit.getCumulativeValue(i), cdata1[i]);
        assert.equal(bit.getSumTo(i), cdata1[i] - data1[i]);
      }
      assert.equal(bit.getTotal(), data1.reduce(function(a, b) { return a + b; }));

      bit.fillFromValues(data2);
      assert.equal(bit.size(), 64);
      for (i = 0; i < 64; i++) {
        assert.equal(bit.getValue(i), data2[i]);
        assert.equal(bit.getCumulativeValue(i), cdata2[i]);
        assert.equal(bit.getSumTo(i), cdata2[i] - data2[i]);
      }
      assert.equal(bit.getTotal(), data2.reduce(function(a, b) { return a + b; }));
    });

    it("should compute cumulative range values", function() {
      var i, bit = new BinaryIndexedTree();
      bit.fillFromValues(data1);

      assert.equal(bit.getCumulativeValueRange(0, data1.length),
                   bit.getCumulativeValue(data1.length-1));
      for(i = 1; i < 25; i++) {
        assert.equal(bit.getCumulativeValueRange(i, 25),
                     cdata1[24] - cdata1[i-1]);
      }
      for(i = 24; i >= 0; i-- ){
        assert.equal(bit.getCumulativeValueRange(0, i+1), cdata1[i]);
      }

      bit.fillFromValues(data2);
      assert.equal(bit.getCumulativeValueRange(0, 64),
                   bit.getCumulativeValue(63));
      for(i = 1; i < 64; i++) {
        assert.equal(bit.getCumulativeValueRange(i, 64),
                     cdata2[63] - cdata2[i-1]);
      }
      for(i = 63; i >= 0; i-- ){
        assert.equal(bit.getCumulativeValueRange(0, i+1), cdata2[i]);
      }


    });

    it("should search by cumulative value", function() {
      var bit = new BinaryIndexedTree();
      bit.fillFromValues([1, 2, 3, 4]);
      assert.equal(bit.getIndex(-1), 0);
      assert.equal(bit.getIndex(0), 0);
      assert.equal(bit.getIndex(1), 0);
      assert.equal(bit.getIndex(2), 1);
      assert.equal(bit.getIndex(3), 1);
      assert.equal(bit.getIndex(4), 2);
      assert.equal(bit.getIndex(5), 2);
      assert.equal(bit.getIndex(6), 2);
      assert.equal(bit.getIndex(7), 3);
      assert.equal(bit.getIndex(8), 3);
      assert.equal(bit.getIndex(9), 3);
      assert.equal(bit.getIndex(10), 3);
      assert.equal(bit.getIndex(11), 4);

      bit.fillFromValues(data1);
      // data1 is [47,17,28,96,10,2,11,43,7,94,37,81,75,2,33,57,68,71,68,86,27,44,64,41,23];
      assert.equal(bit.getIndex(0), 0);
      assert.equal(bit.getIndex(1), 0);
      assert.equal(bit.getIndex(46.9), 0);
      assert.equal(bit.getIndex(47), 0);
      assert.equal(bit.getIndex(63), 1);
      assert.equal(bit.getIndex(64), 1);
      assert.equal(bit.getIndex(64.1), 2);
      assert.equal(bit.getIndex(bit.getCumulativeValue(5)), 5);
      assert.equal(bit.getIndex(bit.getCumulativeValue(20)), 20);
      assert.equal(bit.getIndex(bit.getCumulativeValue(24)), 24);
      assert.equal(bit.getIndex(1000000), 25);
    });

    it("should support add and set", function() {
      var i, bit = new BinaryIndexedTree(4);
      bit.setValue(1, 2);
      assert.deepEqual(bit.toValueArray(), [0, 2, 0, 0]);
      bit.setValue(3, 4);
      assert.deepEqual(bit.toValueArray(), [0, 2, 0, 4]);
      bit.setValue(0, 1);
      assert.deepEqual(bit.toValueArray(), [1, 2, 0, 4]);
      bit.addValue(2, 1);
      assert.deepEqual(bit.toValueArray(), [1, 2, 1, 4]);
      bit.addValue(2, 1);
      assert.deepEqual(bit.toValueArray(), [1, 2, 2, 4]);
      bit.addValue(2, 1);
      assert.deepEqual(bit.toValueArray(), [1, 2, 3, 4]);

      bit.fillFromValues(data1);
      for (i = 0; i < data1.length; i++) {
        bit.addValue(i, -data1[i]);
      }
      assert.deepEqual(bit.toValueArray(), data1.map(function() { return 0; }));

      bit.fillFromValues(data1);
      for (i = data1.length - 1; i >= 0; i--) {
        bit.addValue(i, data1[i]);
      }
      assert.deepEqual(bit.toValueArray(), data1.map(function(x) { return 2*x; }));
    });
  });
});
