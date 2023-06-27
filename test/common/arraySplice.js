var _ = require('underscore');
var assert = require('chai').assert;
var gutil = require('app/common/gutil');
var utils = require('../utils');

/**
 * Set env ENABLE_TIMING_TESTS=1 to run the timing tests.
 * These tests rely on mocha's reported timings to allow you to compare the performance of
 * different implementations.
 */
var ENABLE_TIMING_TESTS = Boolean(process.env.ENABLE_TIMING_TESTS);

//----------------------------------------------------------------------

// Following recommendations such as here:
// http://stackoverflow.com/questions/7032550/javascript-insert-an-array-inside-another-array
// However, this won't work for large arrToInsert because .apply has a limit on length of args.
function spliceApplyConcat(target, start, arrToInsert) {
  target.splice.apply(target, [start, 0].concat(arrToInsert));
  return target;
}

//----------------------------------------------------------------------

// Seems like could be faster, but disturbingly mutates the last argument.
// However, this won't work for large arrToInsert because .apply has a limit on length of args.
function spliceApplyUnshift(target, start, arrToInsert) {
  var spliceArgs = arrToInsert;
  spliceArgs.unshift(start, 0);
  try {
    target.splice.apply(target, spliceArgs);
  } finally {
    spliceArgs.splice(0, 2);
  }
  return target;
}

//----------------------------------------------------------------------

// This is from the same stackoverflow answer, but builds a new array instead of mutating target.
function nonSpliceUsingSlice(target, start, arrToInsert) {
  return target.slice(0, start).concat(arrToInsert, target.slice(start));
}

//----------------------------------------------------------------------

// A simple manual implementation, that performs reasonably well in all environments.
function spliceManualWithTailCopy(target, start, arrToInsert) {
  var insLen = arrToInsert.length;
  if (insLen === 1) {
    target.splice(start, 0, arrToInsert[0]);
  } else if (insLen > 1) {
    var i, len, tail = target.slice(start);
    for (i = 0; i < insLen; i++, start++) {
      target[start] = arrToInsert[i];
    }
    for (i = 0, len = tail.length; i < len; i++, start++) {
      target[start] = tail[i];
    }
  }
  return target;
}

//----------------------------------------------------------------------

function spliceCopyWithTail(helpers) {
  var copyForward = helpers.copyForward;
  return function(target, start, arrToInsert) {
    var tail = target.slice(start), insLen = arrToInsert.length;
    copyForward(target, start, arrToInsert, 0, insLen);
    copyForward(target, start + insLen, tail, 0, tail.length);
    return target;
  };
}

//----------------------------------------------------------------------

// This implementation avoids creating a copy of the tail, but fills in the array
// non-contiguously.
function spliceFwdBackCopy(helpers) {
  var copyForward = helpers.copyForward,
      copyBackward = helpers.copyBackward;
  return function(target, start, arrayToInsert) {
    var count = arrayToInsert.length;
    copyBackward(target, start + count, target, start, target.length - start);
    copyForward(target, start, arrayToInsert, 0, count);
    return target;
  };
}

//----------------------------------------------------------------------

// This implementation tries to be smarter by avoiding allocations, appending to the array
// contiguously, then filling in the gap.
function spliceAppendCopy(helpers) {
  var appendFunc = helpers.append,
      copyForward = helpers.copyForward,
      copyBackward = helpers.copyBackward;
  return function(target, start, arrToInsert) {
    var origLen = target.length;
    var tailLen = origLen - start;
    var insLen = arrToInsert.length;
    if (insLen > tailLen) {
      appendFunc(target, arrToInsert, tailLen, insLen - tailLen);
      appendFunc(target, target, start, tailLen);
      copyForward(target, start, arrToInsert, 0, tailLen);
    } else {
      appendFunc(target, target, origLen - insLen, insLen);
      copyBackward(target, start + insLen, target, start, tailLen - insLen);
      copyForward(target, start, arrToInsert, 0, insLen);
    }
    return target;
  };
}

//----------------------------------------------------------------------

// This implementation only appends, but requires splicing out the tail from the original.
// It is consistently slower on Node.
function spliceAppendOnly(helpers) {
  var appendFunc = helpers.append;
  return function(target, start, arrToInsert) {
    var tail = target.splice(start, target.length);
    appendFunc(target, arrToInsert, 0, arrToInsert.length);
    appendFunc(target, tail, 0, tail.length);
    return target;
  };
}

//----------------------------------------------------------------------
// COPY-FORWARD FUNCTIONS
//----------------------------------------------------------------------
var copyForward = {
  gutil: gutil.arrayCopyForward,

  copyForward1: function(toArray, toStart, fromArray, fromStart, count) {
    for (var end = toStart + count; toStart < end; ++toStart, ++fromStart) {
      toArray[toStart] = fromArray[fromStart];
    }
  },

  copyForward8: function(toArray, toStart, fromArray, fromStart, count) {
    var end = toStart + count;
    for (var xend = end - 7; toStart < xend; fromStart += 8, toStart += 8) {
      toArray[toStart] = fromArray[fromStart];
      toArray[toStart+1] = fromArray[fromStart+1];
      toArray[toStart+2] = fromArray[fromStart+2];
      toArray[toStart+3] = fromArray[fromStart+3];
      toArray[toStart+4] = fromArray[fromStart+4];
      toArray[toStart+5] = fromArray[fromStart+5];
      toArray[toStart+6] = fromArray[fromStart+6];
      toArray[toStart+7] = fromArray[fromStart+7];
    }
    for (; toStart < end; ++fromStart, ++toStart) {
      toArray[toStart] = fromArray[fromStart];
    }
  },

  copyForward64: function(toArray, toStart, fromArray, fromStart, count) {
    var end = toStart + count;
    for (var xend = end - 63; toStart < xend; fromStart += 64, toStart += 64) {
      toArray[toStart]=fromArray[fromStart]; toArray[toStart+1]=fromArray[fromStart+1];
      toArray[toStart+2]=fromArray[fromStart+2]; toArray[toStart+3]=fromArray[fromStart+3];
      toArray[toStart+4]=fromArray[fromStart+4]; toArray[toStart+5]=fromArray[fromStart+5];
      toArray[toStart+6]=fromArray[fromStart+6]; toArray[toStart+7]=fromArray[fromStart+7];
      toArray[toStart+8]=fromArray[fromStart+8]; toArray[toStart+9]=fromArray[fromStart+9];
      toArray[toStart+10]=fromArray[fromStart+10]; toArray[toStart+11]=fromArray[fromStart+11];
      toArray[toStart+12]=fromArray[fromStart+12]; toArray[toStart+13]=fromArray[fromStart+13];
      toArray[toStart+14]=fromArray[fromStart+14]; toArray[toStart+15]=fromArray[fromStart+15];
      toArray[toStart+16]=fromArray[fromStart+16]; toArray[toStart+17]=fromArray[fromStart+17];
      toArray[toStart+18]=fromArray[fromStart+18]; toArray[toStart+19]=fromArray[fromStart+19];
      toArray[toStart+20]=fromArray[fromStart+20]; toArray[toStart+21]=fromArray[fromStart+21];
      toArray[toStart+22]=fromArray[fromStart+22]; toArray[toStart+23]=fromArray[fromStart+23];
      toArray[toStart+24]=fromArray[fromStart+24]; toArray[toStart+25]=fromArray[fromStart+25];
      toArray[toStart+26]=fromArray[fromStart+26]; toArray[toStart+27]=fromArray[fromStart+27];
      toArray[toStart+28]=fromArray[fromStart+28]; toArray[toStart+29]=fromArray[fromStart+29];
      toArray[toStart+30]=fromArray[fromStart+30]; toArray[toStart+31]=fromArray[fromStart+31];
      toArray[toStart+32]=fromArray[fromStart+32]; toArray[toStart+33]=fromArray[fromStart+33];
      toArray[toStart+34]=fromArray[fromStart+34]; toArray[toStart+35]=fromArray[fromStart+35];
      toArray[toStart+36]=fromArray[fromStart+36]; toArray[toStart+37]=fromArray[fromStart+37];
      toArray[toStart+38]=fromArray[fromStart+38]; toArray[toStart+39]=fromArray[fromStart+39];
      toArray[toStart+40]=fromArray[fromStart+40]; toArray[toStart+41]=fromArray[fromStart+41];
      toArray[toStart+42]=fromArray[fromStart+42]; toArray[toStart+43]=fromArray[fromStart+43];
      toArray[toStart+44]=fromArray[fromStart+44]; toArray[toStart+45]=fromArray[fromStart+45];
      toArray[toStart+46]=fromArray[fromStart+46]; toArray[toStart+47]=fromArray[fromStart+47];
      toArray[toStart+48]=fromArray[fromStart+48]; toArray[toStart+49]=fromArray[fromStart+49];
      toArray[toStart+50]=fromArray[fromStart+50]; toArray[toStart+51]=fromArray[fromStart+51];
      toArray[toStart+52]=fromArray[fromStart+52]; toArray[toStart+53]=fromArray[fromStart+53];
      toArray[toStart+54]=fromArray[fromStart+54]; toArray[toStart+55]=fromArray[fromStart+55];
      toArray[toStart+56]=fromArray[fromStart+56]; toArray[toStart+57]=fromArray[fromStart+57];
      toArray[toStart+58]=fromArray[fromStart+58]; toArray[toStart+59]=fromArray[fromStart+59];
      toArray[toStart+60]=fromArray[fromStart+60]; toArray[toStart+61]=fromArray[fromStart+61];
      toArray[toStart+62]=fromArray[fromStart+62]; toArray[toStart+63]=fromArray[fromStart+63];
    }
    for (; toStart < end; ++fromStart, ++toStart) {
      toArray[toStart] = fromArray[fromStart];
    }
  }
};

//----------------------------------------------------------------------
// COPY-BACKWARD FUNCTIONS
//----------------------------------------------------------------------

var copyBackward = {
  gutil: gutil.arrayCopyBackward,

  copyBackward1: function(toArray, toStart, fromArray, fromStart, count) {
    for (var i = toStart + count - 1, j = fromStart + count - 1; i >= toStart; --i, --j) {
      toArray[i] = fromArray[j];
    }
  },

  copyBackward8: function(toArray, toStart, fromArray, fromStart, count) {
    var i = toStart + count - 1, j = fromStart + count - 1;
    for (var xStart = toStart + 7; i >= xStart; i -= 8, j -= 8) {
      toArray[i] = fromArray[j];
      toArray[i-1] = fromArray[j-1];
      toArray[i-2] = fromArray[j-2];
      toArray[i-3] = fromArray[j-3];
      toArray[i-4] = fromArray[j-4];
      toArray[i-5] = fromArray[j-5];
      toArray[i-6] = fromArray[j-6];
      toArray[i-7] = fromArray[j-7];
    }
    for ( ; i >= toStart; --i, --j) {
      toArray[i] = fromArray[j];
    }
  },

  copyBackward64: function(toArray, toStart, fromArray, fromStart, count) {
    var i = toStart + count - 1, j = fromStart + count - 1;
    for (var xStart = toStart + 63; i >= xStart; i -= 64, j -= 64) {
      toArray[i]=fromArray[j]; toArray[i-1]=fromArray[j-1];
      toArray[i-2]=fromArray[j-2]; toArray[i-3]=fromArray[j-3];
      toArray[i-4]=fromArray[j-4]; toArray[i-5]=fromArray[j-5];
      toArray[i-6]=fromArray[j-6]; toArray[i-7]=fromArray[j-7];
      toArray[i-8]=fromArray[j-8]; toArray[i-9]=fromArray[j-9];
      toArray[i-10]=fromArray[j-10]; toArray[i-11]=fromArray[j-11];
      toArray[i-12]=fromArray[j-12]; toArray[i-13]=fromArray[j-13];
      toArray[i-14]=fromArray[j-14]; toArray[i-15]=fromArray[j-15];
      toArray[i-16]=fromArray[j-16]; toArray[i-17]=fromArray[j-17];
      toArray[i-18]=fromArray[j-18]; toArray[i-19]=fromArray[j-19];
      toArray[i-20]=fromArray[j-20]; toArray[i-21]=fromArray[j-21];
      toArray[i-22]=fromArray[j-22]; toArray[i-23]=fromArray[j-23];
      toArray[i-24]=fromArray[j-24]; toArray[i-25]=fromArray[j-25];
      toArray[i-26]=fromArray[j-26]; toArray[i-27]=fromArray[j-27];
      toArray[i-28]=fromArray[j-28]; toArray[i-29]=fromArray[j-29];
      toArray[i-30]=fromArray[j-30]; toArray[i-31]=fromArray[j-31];
      toArray[i-32]=fromArray[j-32]; toArray[i-33]=fromArray[j-33];
      toArray[i-34]=fromArray[j-34]; toArray[i-35]=fromArray[j-35];
      toArray[i-36]=fromArray[j-36]; toArray[i-37]=fromArray[j-37];
      toArray[i-38]=fromArray[j-38]; toArray[i-39]=fromArray[j-39];
      toArray[i-40]=fromArray[j-40]; toArray[i-41]=fromArray[j-41];
      toArray[i-42]=fromArray[j-42]; toArray[i-43]=fromArray[j-43];
      toArray[i-44]=fromArray[j-44]; toArray[i-45]=fromArray[j-45];
      toArray[i-46]=fromArray[j-46]; toArray[i-47]=fromArray[j-47];
      toArray[i-48]=fromArray[j-48]; toArray[i-49]=fromArray[j-49];
      toArray[i-50]=fromArray[j-50]; toArray[i-51]=fromArray[j-51];
      toArray[i-52]=fromArray[j-52]; toArray[i-53]=fromArray[j-53];
      toArray[i-54]=fromArray[j-54]; toArray[i-55]=fromArray[j-55];
      toArray[i-56]=fromArray[j-56]; toArray[i-57]=fromArray[j-57];
      toArray[i-58]=fromArray[j-58]; toArray[i-59]=fromArray[j-59];
      toArray[i-60]=fromArray[j-60]; toArray[i-61]=fromArray[j-61];
      toArray[i-62]=fromArray[j-62]; toArray[i-63]=fromArray[j-63];
    }
    for ( ; i >= toStart; --i, --j) {
      toArray[i] = fromArray[j];
    }
  }
};

//----------------------------------------------------------------------
// APPEND FUNCTIONS.
//----------------------------------------------------------------------

var append = {
  gutil: gutil.arrayAppend,

  append1: function(toArray, fromArray, fromStart, count) {
    var end = fromStart + count;
    for (var i = fromStart; i < end; i++) {
      toArray.push(fromArray[i]);
    }
  },

  appendCopy1: function(toArray, fromArray, fromStart, count) {
    if (count === 1) {
      toArray.push(fromArray[fromStart]);
    } else if (count > 1) {
      var len = toArray.length;
      toArray.length = len + count;
      copyForward.copyForward1(toArray, len, fromArray, fromStart, count);
    }
  },

  append8: function(toArray, fromArray, fromStart, count) {
    var end = fromStart + count;
    for (var xend = end - 7; fromStart < xend; fromStart += 8) {
      toArray.push(
        fromArray[fromStart],
        fromArray[fromStart + 1],
        fromArray[fromStart + 2],
        fromArray[fromStart + 3],
        fromArray[fromStart + 4],
        fromArray[fromStart + 5],
        fromArray[fromStart + 6],
        fromArray[fromStart + 7]);
    }
    for ( ; fromStart < end; ++fromStart) {
      toArray.push(fromArray[fromStart]);
    }
  },

  append64: function(toArray, fromArray, fromStart, count) {
    var end = fromStart + count;
    for (var xend = end - 63; fromStart < xend; fromStart += 64) {
      toArray.push(
        fromArray[fromStart], fromArray[fromStart + 1],
        fromArray[fromStart + 2], fromArray[fromStart + 3],
        fromArray[fromStart + 4], fromArray[fromStart + 5],
        fromArray[fromStart + 6], fromArray[fromStart + 7],
        fromArray[fromStart + 8], fromArray[fromStart + 9],
        fromArray[fromStart + 10], fromArray[fromStart + 11],
        fromArray[fromStart + 12], fromArray[fromStart + 13],
        fromArray[fromStart + 14], fromArray[fromStart + 15],
        fromArray[fromStart + 16], fromArray[fromStart + 17],
        fromArray[fromStart + 18], fromArray[fromStart + 19],
        fromArray[fromStart + 20], fromArray[fromStart + 21],
        fromArray[fromStart + 22], fromArray[fromStart + 23],
        fromArray[fromStart + 24], fromArray[fromStart + 25],
        fromArray[fromStart + 26], fromArray[fromStart + 27],
        fromArray[fromStart + 28], fromArray[fromStart + 29],
        fromArray[fromStart + 30], fromArray[fromStart + 31],
        fromArray[fromStart + 32], fromArray[fromStart + 33],
        fromArray[fromStart + 34], fromArray[fromStart + 35],
        fromArray[fromStart + 36], fromArray[fromStart + 37],
        fromArray[fromStart + 38], fromArray[fromStart + 39],
        fromArray[fromStart + 40], fromArray[fromStart + 41],
        fromArray[fromStart + 42], fromArray[fromStart + 43],
        fromArray[fromStart + 44], fromArray[fromStart + 45],
        fromArray[fromStart + 46], fromArray[fromStart + 47],
        fromArray[fromStart + 48], fromArray[fromStart + 49],
        fromArray[fromStart + 50], fromArray[fromStart + 51],
        fromArray[fromStart + 52], fromArray[fromStart + 53],
        fromArray[fromStart + 54], fromArray[fromStart + 55],
        fromArray[fromStart + 56], fromArray[fromStart + 57],
        fromArray[fromStart + 58], fromArray[fromStart + 59],
        fromArray[fromStart + 60], fromArray[fromStart + 61],
        fromArray[fromStart + 62], fromArray[fromStart + 63]
      );
    }
    for ( ; fromStart < end; ++fromStart) {
      toArray.push(fromArray[fromStart]);
    }
  },

  appendSlice64: function(toArray, fromArray, fromStart, count) {
    var end = fromStart + count;
    for ( ; fromStart < end; fromStart += 64) {
      Array.prototype.push.apply(toArray, fromArray.slice(fromStart, Math.min(fromStart + 64, end)));
    }
  }
};

//----------------------------------------------------------------------

var helpers1 = {
  copyForward: copyForward.copyForward1,
  copyBackward: copyBackward.copyBackward1,
  append: append.append1,
};

var helpers8 = {
  copyForward: copyForward.copyForward8,
  copyBackward: copyBackward.copyBackward8,
  append: append.append8,
};

var helpers64 = {
  copyForward: copyForward.copyForward64,
  copyBackward: copyBackward.copyBackward64,
  append: append.append64,
};

var allArraySpliceFuncs = {
  spliceApplyConcat:  spliceApplyConcat,
  spliceApplyUnshift:  spliceApplyUnshift,
  nonSpliceUsingSlice:  nonSpliceUsingSlice,

  spliceGutil:  gutil.arraySplice,
  spliceManualWithTailCopy:  spliceManualWithTailCopy,

  spliceCopyWithTail1:  spliceCopyWithTail(helpers1),
  spliceCopyWithTail8:  spliceCopyWithTail(helpers8),
  spliceCopyWithTail64:  spliceCopyWithTail(helpers64),

  spliceFwdBackCopy1:  spliceFwdBackCopy(helpers1),
  spliceFwdBackCopy8:  spliceFwdBackCopy(helpers8),
  spliceFwdBackCopy64:  spliceFwdBackCopy(helpers64),

  spliceAppendCopy1:  spliceAppendCopy(helpers1),
  spliceAppendCopy8:  spliceAppendCopy(helpers8),
  spliceAppendCopy64:  spliceAppendCopy(helpers64),

  spliceAppendOnly1:  spliceAppendOnly(helpers1),
  spliceAppendOnly8:  spliceAppendOnly(helpers8),
  spliceAppendOnly64:  spliceAppendOnly(helpers64),
};

var timedArraySpliceFuncs = {
  // The following two naive implementations cannot cope with large arrays, and raise
  // "RangeError: Maximum call stack size exceeded".

  //spliceApplyConcat:  spliceApplyConcat,
  //spliceApplyUnshift:  spliceApplyUnshift,

  // This isn't a real splice, it doesn't modify the array.
  //nonSpliceUsingSlice:  nonSpliceUsingSlice,

  // The implementations commented out below are the slower ones.
  spliceGutil:  gutil.arraySplice,
  spliceManualWithTailCopy:  spliceManualWithTailCopy,

  spliceCopyWithTail1:  spliceCopyWithTail(helpers1),
  //spliceCopyWithTail8:  spliceCopyWithTail(helpers8),
  //spliceCopyWithTail64:  spliceCopyWithTail(helpers64),

  //spliceFwdBackCopy1:  spliceFwdBackCopy(helpers1),
  //spliceFwdBackCopy8:  spliceFwdBackCopy(helpers8),
  //spliceFwdBackCopy64:  spliceFwdBackCopy(helpers64),

  spliceAppendCopy1:  spliceAppendCopy(helpers1),
  spliceAppendCopy8:  spliceAppendCopy(helpers8),
  spliceAppendCopy64:  spliceAppendCopy(helpers64),

  //spliceAppendOnly1:  spliceAppendOnly(helpers1),
  //spliceAppendOnly8:  spliceAppendOnly(helpers8),
  //spliceAppendOnly64:  spliceAppendOnly(helpers64),
};

//----------------------------------------------------------------------

describe("array copy functions", function() {
  it("copyForward should copy correctly", function() {
    _.each(copyForward, function(copyFunc, name) {
      var data = _.range(10000);
      copyFunc(data, 0, data, 1, 9999);
      copyFunc(data, 0, data, 1, 9999);
      assert.equal(data[0], 2);
      assert.equal(data[1], 3);
      assert.equal(data[9996], 9998);
      assert.equal(data[9997], 9999);
      assert.equal(data[9998], 9999);
      assert.equal(data[9999], 9999);
    });
  });

  it("copyBackward should copy correctly", function() {
    _.each(copyBackward, function(copyFunc, name) {
      var data = _.range(10000);
      copyFunc(data, 1, data, 0, 9999);
      copyFunc(data, 1, data, 0, 9999);
      assert.equal(data[0], 0);
      assert.equal(data[1], 0);
      assert.equal(data[2], 0);
      assert.equal(data[3], 1);
      assert.equal(data[9998], 9996);
      assert.equal(data[9999], 9997);
    });
  });

  it("arrayAppend should append correctly", function() {
    _.each(append, function(appendFunc, name) {
      var out = [];
      var data = _.range(20000);
      appendFunc(out, data, 100, 1);
      appendFunc(out, data, 100, 1000);
      appendFunc(out, data, 100, 10000);
      assert.deepEqual(out.slice(0, 4), [100, 100, 101, 102]);
      assert.deepEqual(out.slice(1000, 1004), [1099, 100, 101, 102]);
      assert.deepEqual(out.slice(11000), [10099]);
    });
  });

  // See ENABLE_TIMING_TESTS flag on top of this file.
  if (ENABLE_TIMING_TESTS) {
    describe("timing", function() {
      var a1m = _.range(1000000);
      describe("copyForward", function() {
        var reps = 40;
        _.each(copyForward, function(copyFunc, name) {
          var b1m = a1m.slice(0);
          it(name, function() {
            utils.repeat(reps, copyFunc, b1m, 0, b1m, 1, 999999);

            // Make sure it actually worked. These checks shouldn't affect timings much.
            assert.deepEqual(b1m.slice(0, 10), _.range(reps, reps + 10));
            assert.equal(b1m[999999-reps-1], 999998);
            assert.equal(b1m[999999-reps], 999999);
            assert.deepEqual(b1m.slice(1000000-reps), _.times(reps, _.constant(999999)));
          });
        });
      });

      describe("copyBackward", function() {
        var reps = 40;
        _.each(copyBackward, function(copyFunc, name) {
          var b1m = a1m.slice(0);
          it(name, function() {
            utils.repeat(reps, copyFunc, b1m, 1, b1m, 0, 999999);

            // Make sure it actually worked. These checks shouldn't affect timings much.
            assert.deepEqual(b1m.slice(0, reps), _.times(reps, _.constant(0)));
            assert.equal(b1m[reps], 0);
            assert.equal(b1m[reps + 1], 1);
            assert.deepEqual(b1m.slice(999990), _.range(999990-reps, 1000000-reps));
          });
        });
      });

      describe("append", function() {
        var data = _.range(1000000);
        function chunkedAppend(appendFunc, data, chunk) {
          var out = [];
          var count = data.length / chunk;
          for (var i = 0; i < count; i++) {
            appendFunc(out, data, i * chunk, chunk);
          }
          return out;
        }

        _.each(append, function(appendFunc, name) {
          it(name, function() {
            var out1 = chunkedAppend(appendFunc, data, 1);
            var out2 = chunkedAppend(appendFunc, data, 1000);
            var out3 = chunkedAppend(appendFunc, data, 1000000);

            // Make sure it actually worked. Keep the checks short to avoid affecting timings.
            assert.deepEqual(out1.slice(0, 10), data.slice(0, 10));
            assert.deepEqual(out1.slice(data.length - 10), data.slice(data.length - 10));
            assert.deepEqual(out2.slice(0, 10), data.slice(0, 10));
            assert.deepEqual(out2.slice(data.length - 10), data.slice(data.length - 10));
            assert.deepEqual(out3.slice(0, 10), data.slice(0, 10));
            assert.deepEqual(out3.slice(data.length - 10), data.slice(data.length - 10));
          });
        });
      });
    });
  }
});

describe('arraySplice', function() {

  // Make sure all our functions produce the same results as spliceApplyConcat for simple cases.
  var refSpliceFunc = spliceApplyConcat;

  it("all candidate functions should be correct for simpler cases", function() {
    _.each(allArraySpliceFuncs, function(spliceFunc, name) {
      var a10 = _.range(10), a100 = _.range(100);
      function checkSpliceFunc(target, start, arrToInsert) {
        assert.deepEqual(spliceFunc(target.slice(0), start, arrToInsert),
          refSpliceFunc(target.slice(0), start, arrToInsert),
          "splice function incorrect for " + name);
      }

      checkSpliceFunc(a10, 5, a100);
      checkSpliceFunc(a100, 50, a10);
      checkSpliceFunc(a100, 90, a10);
      checkSpliceFunc(a100, 0, a10);
      checkSpliceFunc(a100, 100, a10);
      checkSpliceFunc(a10, 0, a100);
      checkSpliceFunc(a10, 10, a100);
      checkSpliceFunc(a10, 1, a10);
      checkSpliceFunc(a10, 5, a10);
      checkSpliceFunc(a10, 5, []);
      assert.deepEqual(spliceFunc(a10.slice(0), 5, a10),
        [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 5, 6, 7, 8, 9]);
    });
  });

  // See ENABLE_TIMING_TESTS flag on top of this file.
  if (ENABLE_TIMING_TESTS) {
    describe("timing", function() {
      var a1 = _.range(1);
      var a1k = _.range(1000);
      var a1m = _.range(1000000);

      describe("insert-one", function() {
        _.each(timedArraySpliceFuncs, function(spliceFunc, name) {
          var b1m = a1m.slice(0);
          it(name, function() {
            utils.repeat(40, spliceFunc, b1m, 500000, a1);
          });
        });
      });

      describe("insert-1k", function() {
        _.each(timedArraySpliceFuncs, function(spliceFunc, name) {
          var b1m = a1m.slice(0);
          it(name, function() {
            utils.repeat(40, spliceFunc, b1m, 500000, a1k);
          });
        });
      });

      describe("insert-1m", function() {
        _.each(timedArraySpliceFuncs, function(spliceFunc, name) {
          var b1m = a1m.slice(0);
          it(name, function() {
            utils.repeat(4, spliceFunc, b1m, 500000, a1m);
          });
        });
      });
    });
  }
});
