/**
 * Do some timing of promises, as well as of nextTick and setTimeout, so that we have an idea of
 * how long different things take.
 *
 * To see actual timings, comment out the console.log inside the `log` function below.
 */


var assert = require('chai').assert;

var bluebird = require('bluebird');

// Disable longStackTraces, which seem to be enabled in the browser by default.
bluebird.config({ longStackTraces: false });

function log(message) {
  //console.log(message);
}

/**
 * Measurement helpers. Usage:
 *  var start = startTimer();
 *  ...
 *  var usec = usecElapsed(start);    // Returns microseconds.
 */
var startTimer, usecElapsed;
if (typeof process !== 'undefined' && typeof process.hrtime !== 'undefined') {
  startTimer = function() {
    return process.hrtime();
  };
  usecElapsed = function(start) {
    var elapsed = process.hrtime(start);
    return elapsed[0] * 1000000 + elapsed[1] / 1000;
  };
} else {
  startTimer = function() {
    return Date.now();
  };
  usecElapsed = function(start) {
    var elapsedMs = (Date.now() - start);
    return elapsedMs * 1000;
  };
}

/**
 * Helper to run timing tests. Adds a test case to run the given function, possibly multiple
 * times, and check the timing value that it returns.
 *
 * Example:
 *    describe("myClass", function() {
 *      timeIt("myFunc", { reps: 3, expectedUs: 100, fudgeFactor: 4}, myFunc);
 *    });
 * Produces:
 *    myFunc should take ~100us (up to x4) [got 123us]: 316ms
 * Notes:
 *  - The number at the end isn't very meaningful (includes repetitions and measurements).
 *  - Fudge factors should be pretty large, since tests often take shorter or longer depending
 *    on platform, system load, etc.
 *
 * @param {Number} options.reps - Run the test this many times and check the min value.
 * @param {Number} options.expectedUs - Expected number of microseconds to receive from func.
 * @param {Number} options.fudgeFactor - It's fine if the test takes this factor longer or shorter.
 * @param {Number} options.noLowerBound - don't test for being too fast.
 * @param {Function} func - Will call func(reportUs), where reportUs is a function that should be
 *      called with the test measurement when func is done.
 * @return {Function} Function that takes a `done` callback and calls it when all is done.
 */
function timeIt(name, options, func) {
  var reps = options.reps || 1;
  var fudgeFactor = options.fudgeFactor || 1;
  var expectedUs = options.expectedUs;
  var noLowerBound = options.noLowerBound;
  var test = it(name + " should take ~" + expectedUs + "us (up to x" + fudgeFactor + ")",
                function(done) {
    var n = 0;
    var minTimeUs = Infinity;
    function iteration(timeUs) {
      try {
        minTimeUs = Math.min(minTimeUs, timeUs);
        if (n++ < reps) {
          func(next);
          return;
        }
        log("Ran test " + n + " times, min time " + minTimeUs);
        assert(minTimeUs <= expectedUs * fudgeFactor,
               "Time of " + minTimeUs + "us is longer than expected (" + expectedUs + ") " +
               "by more than fudge factor of " + fudgeFactor);
        if (!noLowerBound) {
          assert(minTimeUs >= expectedUs / fudgeFactor,
                 "Time of " + minTimeUs + "us is shorter than expected (" + expectedUs + ") " +
                 "by more than fudge factor of " + fudgeFactor);
        }
        tackOnMeasuredTime(test, minTimeUs);
        done();
      } catch (err) {
        tackOnMeasuredTime(test, minTimeUs);
        done(err);
      }
    }
    function next(timeUs) {
      setTimeout(iteration, 0, timeUs);
    }
    next(Infinity);
  });
}

function tackOnMeasuredTime(test, timeUs) {
  // Output the measured time as 123.1, or 0.0005 when small
  var str = timeUs > 10 ? timeUs.toFixed(0) : timeUs.toPrecision(2);
  test.title = test.title.replace(/( \[got [^]]*us\])?$/, " [got " + str + "us]");
}

describe("promises", function() {
  // These are normally skipped. They are not really tests of our code, but timings to help
  // understand how long different things take. Because of global state affecting tests (e.g.
  // longStackTraces setting, async_hooks affecting timings), it doesn't work well to run these as
  // part of the full test suite. Instead, they can be run manually using
  //
  //      ENABLE_TIMING_TESTS=1 bin/mocha test/common/promises.ts
  //
  // (Note that things in mocha.opts, such as report-why-tests-hang, affect them and may need to
  // be commented out to see accurate timings.)
  //
  before(function() {
    if (!process.env.ENABLE_TIMING_TESTS) {
      this.skip();
    }
  });

  function test(arg) {
    return arg + 2;
  }

  timeIt("simple calls", { reps: 3, expectedUs: 0.005, fudgeFactor: 10, noLowerBound: true },
         function(reportUs) {
    var iterations = 10000000;
    var start = startTimer();
    var value = 0;
    for (var i = 0; i < iterations; i++) {
      value = test(value);
    }
    var us = usecElapsed(start) / iterations;
    assert.equal(value, iterations * 2);
    log("Direct calls took " + us + " us / iteration");
    reportUs(us);
  });

  function testPromiseLib(promiseLib, libName, setupFunc, timingOptions) {
    var iterations = timingOptions.iters;
    timeIt(libName + " chain", timingOptions, function(reportUs) {
      setupFunc();
      var start = startTimer();
      var chain = promiseLib.resolve(0);
      for (var i = 0; i < iterations; i++) {
        chain = chain.then(test);
      }
      var chainDone = false;
      chain.then(function(value) {
        var us = usecElapsed(start) / iterations;
        chainDone = true;
        assert.equal(value, iterations * 2);
        log(libName + " promise chain took " + us + " us / iteration");
        reportUs(us);
      });
      assert.equal(chainDone, false);
    });
  }

  // Measure bluebird with and without longStackSupport. If switching promise libraries, we could
  // add similar timings here to compare performance. E.g. Q is nearly two orders of magnitude
  // slower than bluebird.
  var isNode = Boolean(process.version);

  testPromiseLib(bluebird, 'bluebird (no long traces)',
                 // Sadly, no way to turn off bluebird.longStackTraces, so just do this test first.
                 function() {
                   assert.isFalse(bluebird.hasLongStackTraces(), "longStackTraces should be off");
                 },
                 { iters: 20000, reps: 3, expectedUs: isNode ? 0.3 : 1, fudgeFactor: 8});

  // TODO: with bluebird 3, we can no longer switch between having and not having longStackTraces.
  // We'd have to measure it in two different test runs. For now, can run this test with
  // BLUEBIRD_DEBUG=1 environment variable.
  //testPromiseLib(bluebird, 'bluebird (with long traces)',
  //               function() { bluebird.longStackTraces(); },
  //               { iters: 20000, reps: 3, expectedUs: isNode ? 0.3 : 1, fudgeFactor: 8});


  function testRepeater(repeaterFunc, name, timingOptions) {
    var iterations = timingOptions.iters;
    timeIt("timing of " + name, timingOptions, function(reportUs) {
      var count = 0;
      function step() {
        if (count < iterations) {
          repeaterFunc(step);
          count++;
        } else {
          var us = usecElapsed(start) / iterations;
          assert.equal(count, iterations);
          log(name + " took " + us + " us / iteration (" + iterations + " iterations)");
          reportUs(us);
        }
      }
      var start = startTimer();
      step();
    });
  }

  if (process.maxTickDepth) {
    // Probably running under Node
    testRepeater(process.nextTick, "process.nextTick",
                 { iters: process.maxTickDepth*9/10, reps: 20, expectedUs: 0.1, fudgeFactor: 4 });
  }
  if (typeof setImmediate !== 'undefined') {
    testRepeater(setImmediate, "setImmediate",
      { iters: 100, reps: 10, expectedUs: 2.0, fudgeFactor: 4 });
  }
});
