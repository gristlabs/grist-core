/**
 * Implements a binary indexed tree, aka Fenwick tree. See
 * http://en.wikipedia.org/wiki/Fenwick_tree
 */
function BinaryIndexedTree(optSize) {
  this.tree = [];
  if (optSize > 0) {
    this.tree.length = optSize;
    for (var i = 0; i < optSize; i++) {
      this.tree[i] = 0;
    }
    // The last valid index rounded down to the nearest power of 2.
    this.mask = mostSignificantOne(this.tree.length - 1);
  }
}

/**
 * Returns a number that contains only the least significant one in `num`.
 * @param {Number} num - Positive integer.
 * @returns {Number} The least significant one in `num`, e.g. for 10110, returns 00010.
 */
function leastSignificantOne(num) {
  return num & (-num);
}
BinaryIndexedTree.leastSignificantOne = leastSignificantOne;


/**
 * Strips the least significant one from `num`.
 * @param {Number} num - Positive integer.
 * @returns {Number} `num` with the least significant one removed, e.g. for 10110, returns 10100.
 */
function stripLeastSignificantOne(num) {
  return num & (num - 1);
}
BinaryIndexedTree.stripLeastSignificantOne = stripLeastSignificantOne;


function mostSignificantOne(num) {
  if (num === 0) {
    return 0;
  }
  var msb = 1;
  while ((num >>>= 1)) {
    msb <<= 1;
  }
  return msb;
}
BinaryIndexedTree.mostSignificantOne = mostSignificantOne;

/**
 * Converts in-place an array of cumulative values to the original values.
 * @param {Array<number>} values - Array of cumulative values, or partial sums.
 * @returns {Array<number>} - same `values` array, with elements replaced by deltas.
 *      E.g. [1,3,6,10] is converted to [1,2,3,4].
 */
function cumulToValues(values) {
  for (var i = values.length - 1; i >= 1; i--) {
    values[i] -= values[i - 1];
  }
  return values;
}
BinaryIndexedTree.cumulToValues = cumulToValues;


/**
 * Converts in-place an array of values to cumulative values, or partial sums.
 * @param {Array<number>} values - Array of numerical values.
 * @returns {Array<number>} - same `values` array, with elements replaced by partial sums.
 *      E.g. [1,2,3,4] is converted to [1,3,6,10].
 */
function valuesToCumul(values) {
  for (var i = 1; i < values.length; i++) {
    values[i] += values[i - 1];
  }
  return values;
}
BinaryIndexedTree.valuesToCumul = valuesToCumul;


/**
 * @returns {Number} length of the tree.
 */
BinaryIndexedTree.prototype.size = function() {
  return this.tree.length;
};


/**
 * Converts the BinaryIndexedTree to a cumulative array.
 * Takes time linear in the size of the array.
 * @returns {Array<number>} - array with each element a partial sum.
 */
BinaryIndexedTree.prototype.toCumulativeArray = function() {
  var cumulValues = [this.tree[0]];
  var len = cumulValues.length = this.tree.length;
  for (var i = 1; i < len; i++) {
    cumulValues[i] = this.tree[i] + cumulValues[stripLeastSignificantOne(i)];
  }
  return cumulValues;
};


/**
 * Converts the BinaryIndexedTree to an array of individual values.
 * Takes time linear in the size of the array.
 * @returns {Array<number>} - array with each element containing the value that was inserted.
 */
BinaryIndexedTree.prototype.toValueArray = function() {
  return cumulToValues(this.toCumulativeArray());
};


/**
 * Creates a tree from an array of cumulative values.
 * Takes time linear in the size of the array.
 * @param {Array<number>} - array with each element a partial sum.
 */
BinaryIndexedTree.prototype.fillFromCumulative = function(cumulValues) {
  var len = this.tree.length = cumulValues.length;
  if (len > 0) {
    this.tree[0] = cumulValues[0];
    for (var i = 1; i < len; i++) {
      this.tree[i] = cumulValues[i] - cumulValues[stripLeastSignificantOne(i)];
    }
    // The last valid index rounded down to the nearest power of 2.
    this.mask = mostSignificantOne(this.tree.length - 1);
  } else {
    this.mask = 0;
  }
};


/**
 * Creates a tree from an array of individual values.
 * Takes time linear in the size of the array.
 * @param {Array<number>} - array with each element containing the value to insert.
 */
BinaryIndexedTree.prototype.fillFromValues = function(values) {
  this.fillFromCumulative(valuesToCumul(values.slice()));
};


/**
 * Reads the cumulative value at the given index. Takes time O(log(index)).
 * @param {Number} index - index in the array.
 * @returns {Number} - cumulative values up to and including `index`.
 */
BinaryIndexedTree.prototype.getCumulativeValue = function(index) {
  var sum = this.tree[0];
  while (index > 0) {
    sum += this.tree[index];
    index = stripLeastSignificantOne(index);
  }
  return sum;
};

/**
 * Reads the cumulative value from start(inclusive) to end(exclusive). Takes time O(log(end)).
 * @param {Number} start - start index
 * @param {Number} end - end index
 * @returns {Number} - cumulative values between start(inclusive) and end(exclusive)
 */
BinaryIndexedTree.prototype.getCumulativeValueRange = function(start, end) {
  return this.getSumTo(end) - this.getSumTo(start);
};

/**
 * Returns the sum of values up to the given index. Takes time O(log(index)).
 * @param {Number} index - index in the array.
 * @returns {Number} - cumulative values up to but not including `index`.
 */
BinaryIndexedTree.prototype.getSumTo = function(index) {
  return (index > 0 ? this.getCumulativeValue(index - 1) : 0);
};


/**
 * Returns the total of all values in the tree. Takes time O(log(N)).
 * @returns {Number} - sum of all values.
 */
BinaryIndexedTree.prototype.getTotal = function() {
  return this.getCumulativeValue(this.tree.length - 1);
};


/**
 * Reads a single value at the given index. Takes time O(log(index)).
 * @param {Number} index - index in the array.
 * @returns {Number} - the value that was inserted at `index`.
 */
BinaryIndexedTree.prototype.getValue = function(index) {
  var value = this.tree[index];
  if (index > 0) {
    var parent = stripLeastSignificantOne(index);
    index--;
    while (index !== parent) {
      value -= this.tree[index];
      index = stripLeastSignificantOne(index);
    }
  }
  return value;
};


/**
 * Updates a value at an index. Takes time O(log(table size)).
 * @param {Number} index - index in the array.
 * @param {Number} delta - value to add to the previous value at `index`.
 */
BinaryIndexedTree.prototype.addValue = function(index, delta) {
  if (index === 0) {
    this.tree[0] += delta;
  } else {
    while (index < this.tree.length) {
      this.tree[index] += delta;
      index += leastSignificantOne(index);
    }
  }
};


/**
 * Sets a value at an index. Takes time O(log(table size)).
 * @param {Number} index - index in the array.
 * @param {Number} value - new value to set at `index`.
 */
BinaryIndexedTree.prototype.setValue = function(index, value) {
  this.addValue(index, value - this.getValue(index));
};


/**
 * Given a cumulative value, finds the first element whose inclusion reaches the value.
 * E.g. for values [1,2,3,4] (cumulative [1,3,6,10]), getIndex(3) = 1, getIndex(3.1) = 2.
 * @param {Number} cumulValue - cumulative value to exceed.
 * @returns {Number} index - the first index such that getCumulativeValue(index) >= cumulValue.
 *    If cumulValue is too large, return one more than the highest valid index.
 */
BinaryIndexedTree.prototype.getIndex = function(cumulValue) {
  if (this.tree.length === 0 || this.tree[0] >= cumulValue) {
    return 0;
  }
  var index = 0;
  var mask = this.mask;
  var sum = this.tree[0];
  while (mask !== 0) {
    var testIndex = index + mask;
    if (testIndex < this.tree.length && sum + this.tree[testIndex] < cumulValue) {
      index = testIndex;
      sum += this.tree[index];
    }
    mask >>>= 1;
  }
  return index + 1;
};

module.exports = BinaryIndexedTree;
