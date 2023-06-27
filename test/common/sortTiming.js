var assert = require('assert');
var gutil = require('app/common/gutil');
var _ = require('underscore');
var utils = require('../utils');

// Uncomment to see logs
function log(messages) {
  //console.log.apply(console, messages);
}
/**
* Compares performance of underscore.sortedIndex and gutil.sortedIndex on ranges of the
* given array.
* @param {array} arr - array to call sortedIndex on
* @param {function} keyFunc - a sort key function used to sort the array
* @param {function} cmp - a compare function used to sort the array
* @param {object} object - object of settings for utils.time
* @param {string} msg - helpful message to display with time results
**/
function benchmarkSortedIndex(arr, keyFunc, cmp, options, msg) {
  var t1, t2;
  var currArray = [], currSearchElems = [];
  var sortedArr = _.sortBy(arr, keyFunc);
  var compareFunc = gutil.multiCompareFunc([keyFunc], [cmp], [true]);

  function testUnderscore(arr, searchElems) {
    searchElems.forEach(function(i) { _.sortedIndex(arr, i, keyFunc); });
  }
  function testGutil(arr, searchElems) {
    searchElems.forEach(function(i) { gutil.sortedIndex(arr, i, compareFunc); });
  }

  // TODO: Write a library function that does this for loop stuff b/c its largely the same
  // across the 3 benchmark functions. This is kind of messy to abstract b/c of issues
  // with array sorting side effects and function context.
  for(var p = 1; 2 * currArray.length <= arr.length; p++) {
    log(['==========================================================']);
    currArray = sortedArr.slice(0, Math.pow(2, p));
    currSearchElems = arr.slice(0, Math.pow(2, p));
    log(['Calling sortedIndex', currArray.length, 'times averaged over', options.iters,
                'iterations |', msg]);
    t1 = utils.time(testUnderscore, null, [currArray, currSearchElems], options);
    t2 = utils.time(testGutil, null, [currArray, currSearchElems], options);
    log(["Underscore.sortedIndex:", t1, 'ms.', 'Avg time per call:', t1/currArray.length]);
    log(["gutil.sortedIndex     :", t2, 'ms.', 'Avg time per call:', t2/currArray.length]);
  }
}

/**
* Compares performance of sorting using 1-key, 2-key, ... (keys.length)-key comparison
* functions on ranges of the given array.
* @param {array} arr - array to sort
* @param {function array} keys - array of sort key functions
* @param {function array} cmps - array of compare functions parallel to keys
* @param {boolean array} asc - array of booleans denoting asc/descending. This is largely
                              irrelevant to performance
* @param {object} object - object of settings for utils.time
* @param {string} msg - helpful message to display with time results
**/
function benchmarkMultiCompareSort(arr, keys, cmps, asc, options, msg) {
  var elapsed;
  var compareFuncs = [], currArray = [];
  for(var l = 0; l < keys.length; l++) {
    compareFuncs.push(gutil.multiCompareFunc(keys.slice(0, l+1), cmps.slice(0, l+1), asc.slice(0, l+1)));
  }

  for(var p = 1; 2 * currArray.length <= arr.length; p++) {
    currArray = arr.slice(0, Math.pow(2, p));
    log(['==========================================================']);
    log(['Sorting', currArray.length, 'elements averaged over', options.iters,
         'iterations |', msg]);
    for(var i = 0; i < compareFuncs.length; i++) {
      elapsed = utils.time(Array.prototype.sort, currArray, [compareFuncs[i]], options);
      log([(i+1) + "-key compare sort took: ", elapsed, 'ms']);
    }
  }
}

/**
* Compares performance of Array.sort, Array.sort with a gutilMultiCompareFunc(on 1-key), and
* Underscore's sort function on ranges of the given array.
* @param {array} arr - array to sort
* @param {function} compareKey - compare function to use for sorting
* @param {function} keyFunc - key function used to construct a compare function for sorting with
                              Array.sort
* @param {object} object - object of settings for utils.time
* @param {string} msg - helpful message to display with time results
**/
function benchmarkNormalSort(arr, compareFunc, keyFunc, options, msg) {
  var t1, t2, t3;
  var currArray = [];
  var gutilCompare = gutil.multiCompareFunc([keyFunc], [compareFunc], [true]);

  for (var p = 1; 2 * currArray.length <= arr.length; p++) {
    log(['==========================================================']);
    currArray = arr.slice(0, Math.pow(2, p));
    log(['Sorting', currArray.length, 'elements averaged over', options.iters,
         'iterations |', msg]);
    t1 = utils.time(Array.prototype.sort, currArray, [compareFunc], options);
    t2 = utils.time(Array.prototype.sort, currArray, [gutilCompare], options);
    t3 = utils.time(_.sortBy, null, [currArray, keyFunc], options);
    log(['Array.sort with compare func                 :', t1]);
    log(['Array.sort with constructed multicompare func:', t2]);
    log(['Underscore sort                              :', t3]);
  }
}

describe('Performance tests', function() {
  var maxPower = 10; // tweak as needed
  var options = {'iters': 10, 'avg': true};
  var timeout = 5000000; // arbitrary
  var length = Math.pow(2, maxPower);

  // sample data to do our sorting on. generating these random lists can take a while...
  var nums = utils.genItems('floating', length, {min:0, max:length});
  var people = utils.genPeople(length);
  var strings = utils.genItems('string', length, {length:10});

  describe('Benchmark test for gutil.sortedIndex', function() {
    it('should be close to underscore.sortedIndex\'s performance', function() {
      this.timeout(timeout);
      benchmarkSortedIndex(nums, _.identity, gutil.nativeCompare, options,
                           'Sorted index benchmark on numbers');
      benchmarkSortedIndex(strings, _.identity, gutil.nativeCompare, options,
                           'Sorted index benchmark on strings');
      assert(true);
    });
  });

  describe('Benchmarks for various sorting', function() {
    var peopleKeys = [_.property('last'), _.property('first'), _.property('age'),
                      _.property('year'), _.property('month'), _.property('day')];
    var cmp1 = [gutil.nativeCompare, gutil.nativeCompare, gutil.nativeCompare, gutil.nativeCompare,
                 gutil.nativeCompare, gutil.nativeCompare];
    var stringKeys = [_.identity, function (x) { return x.length; },
                      function (x) { return x[0]; } ];
    var cmp2 = [gutil.nativeCompare, gutil.nativeCompare, gutil.nativeCompare];
    var numKeys = [_.identity, utils.mod(2), utils.mod(3), utils.mod(5)];
    var cmp3 = numKeys.map(function() { return gutil.nativeCompare; });
    var asc = [1, 1, -1, 1, 1]; // bools for ascending/descending in multicompare

    it('should be close to _.sortBy with only 1 compare key', function() {
      this.timeout(timeout);
      benchmarkNormalSort(strings, gutil.nativeCompare, _.identity, options,
                          'Regular sort test on string array');
      benchmarkNormalSort(people, function(a, b) { return a.age - b.age; }, _.property('age'),
                          options, 'Regular sort test on people array using age as sort key');
      benchmarkNormalSort(nums, gutil.nativeCompare, _.identity, options,
                          'Regular sort test on number array');
      assert(true);
    });

    it('should have consistent performance when no tie breakers are needed', function() {
      this.timeout(timeout);
      benchmarkMultiCompareSort(strings, stringKeys, cmp2, asc, options, 'Consistency test on string array');
      benchmarkMultiCompareSort(nums, numKeys, cmp3, asc, options, 'Consistency test on number array');
      assert(true);
    });

    it('should scale linearly in the number of compare keys used', function() {
      this.timeout(timeout);
      benchmarkMultiCompareSort(people, peopleKeys, cmp1, asc, options, 'Linear scaling test on people array');
      assert(true);
    });
  });

});
