/* global location */

var _ = require('underscore');
var Chance = require('chance');
var assert = require('chai').assert;

function mod(r) { return function(x) { return x%r; }; }
exports.mod = mod;

/**
 * Runs the given function for the specified number of iterations and returns the total time taken.
 * This function has no side effects.
 * @param {Function} func - function to apply
 * @param {object} context - this
 * @param {Array} args - array of arguments to apply on the function
 * @param {Integer} options.iters - number of iterations to apply the given function
 * @param {Boolean} options.avg - if true, return the avg iteration time, else return the total time
 */
function time(func, context, args, options) {
  console.assert(options.iters > 0, "Number of iterations must be greater than 0");
  var start, copy;
  var elapsed = 0;
  // Apply the function on a copy of the context on each iteration to avoid side effects
  for (var i = 0; i < options.iters; i++) {
    copy = _.clone(context);
    start = Date.now();
    func.apply(copy, args);
    elapsed += Date.now() - start;
  }

  if (options.avg) return elapsed/options.iters;
  else return elapsed;
}
exports.time = time;


/**
 * Repeats running the given function on the given arguments count times, returning the last
 * result.
 */
function repeat(count, func, varArgs) {
  var ret, args = Array.prototype.slice.call(arguments, 2);
  for (var i = 0; i < count; i++) {
    ret = func.apply(null, args);
  }
  return ret;
}
exports.repeat = repeat;


/**
 * Defines a test suite for running timing tests. See documentation for exports.timing.
 */
function timingDescribe(desc, func) {
  // If under Node, non-empty ENABLE_TIMING_TESTS environment variable turns on the timing tests.
  // If under the Browser, we look for 'timing=1' among URL params, set by test/browser.js.
  var enableTimingTests = (process.browser ?
      (location.search.substr(1).split("&").indexOf("timing=1") !== -1) :
      process.env.ENABLE_TIMING_TESTS);

  function body() {
    func();

    // We collect the tests, then check if any of them exceeded the expected timing. We do it in
    // one pass in after() (rather than in afterEach()) to allow them all to run, since it's
    // useful to see all their timings.
    var testsToCheck = [];
    afterEach(function() {
      testsToCheck.push(this.currentTest);
    });
    after(function() {
      testsToCheck.forEach(function(test) {
        if (test.expectedDuration) {
          assert.isBelow(test.duration, test.expectedDuration * 1.5, "Test took longer than expected");
        }
      });
    });
  }

  if (enableTimingTests) {
    return describe(desc, body);
  } else {
    return describe.skip(desc + " (skipping timing test)", body);
  }
}

/**
 * Defines a test case for a timing test. This should be used in place of it() for timing test
 * cases created inside utils.timing.describe(). See documentation for exports.timing.
 */
function timingTest(expectedMs, desc, testFunc) {
  var test = it(desc + " (exp ~" + expectedMs + "ms)", testFunc);
  test.slow(expectedMs * 1.5);
  test.timeout(expectedMs * 5 + 2000);
  test.expectedDuration = expectedMs;
}

/**
 * To write timing tests, the following pattern is recommended:
 *
 * (1) Use utils.timing.describe() in place of describe().
 * (2) Use utils.timing.it() in place of it(). It takes an extra first parameter with the number
 *     of expected milliseconds. The test will fail if it takes more than 1.5x longer.
 * (3) Place only the code to be timed in utils.timing.it(), and do all setup in before() and all
 *     non-trivial post-test assertions in after().
 *
 * These tests only run when ENABLE_TIMING_TESTS environment variable is non-empty. It enables
 * timing tests both under Node and running in the browser under Selenium. To enable timing tests
 * in the browser when running /test.html manually, go to /test.html?timing=1.
 */
exports.timing = {
 describe: timingDescribe,
 it: timingTest
};


// Dummy object used for tests
function TestPerson(last, first, age, year, month, day) {
  this.last = last;
  this.first = first;
  this.age = age;
  this.year = year;
  this.month = month;
  this.day = day;
}

/**
 * Returns a list of randomly generated TestPersons.
 * @param {integer} num - length of people list to return
 */
function genPeople(num, seed) {
  if (typeof seed === 'undefined') seed = 0;
  var ageOpts = {min: 0, max: 90};
  var monthOpts = {min:1, max:12};
  var dayOpts = {min:1, max:30};
  var people = [];
  var chance = new Chance(seed);
  for (var i = 0; i < num; i++) {
    people.push(new TestPerson(chance.last(),
                               chance.first(),
                               chance.integer(ageOpts),
                               parseInt(chance.year()),
                               chance.integer(monthOpts),
                               chance.integer(dayOpts)
    ));
  }
  return people;
}
exports.genPeople = genPeople;

/**
 * Generates a list of items denoted by the given chanceFunc string.
 * Ex : genItems('integers', 10, {min:0, max:20}) generates a list of 10 integers between 0 and 20
 *    : genItems('string', 10, {length: 6}) generates a list of 10 strings of length 6
 * @param {string} chanceFunc - string name of a chance.js function
 * @param {integer} num - length of item list to return
 * @param {object} options - object denoting options for the given chance.js function
 */
function genItems(chanceFunc, num, options, seed) {
  if (typeof seed === 'undefined') seed = 0;
  console.assert(typeof new Chance()[chanceFunc] === 'function');
  var chance = new Chance(seed);
  var items = [];
  for (var i = 0; i < num; i++) {
    items.push(chance[chanceFunc](options));
  }
  return items;
}
exports.genItems = genItems;
