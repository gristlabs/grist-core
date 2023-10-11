/**
 * This module handles splitting tests for parallelizing them. This module is imported by any run
 * of mocha, due by being listed in package.json.
 *
 * It only does anything if TEST_SPLITS is set, which must have the form "3-of-8".
 *
 * If TEST_SPLITS is set to M-of-N, it is used to divide up all test suites in this mocha run into
 * N groups, and runs the Mth of them. Note that M is 1-based, i.e. in [1..N] range. To have all
 * tests run, each of the groups 1-of-N through N-of-N must run on the same total set of tests.
 *
 * The actual breaking into groups is informed by a timings file, defaulting to
 * test/timings-all.txt. This has the format "<top-suite> <file-suite-title> <duration-in-ms>".
 * Only those lines whose <top-suite> matches process.env.TEST_SUITE_FOR_TIMINGS will be used.
 *
 * The timings for test/timings-all.txt are prepared by our test reporter and written during
 * Jenkins run as the timings/timings-all.txt artifact. After tests are added or changed, if
 * timings may have changed significantly, it's good to update test/timings-all.txt, so that the
 * parallel groups can be evened out as much as possible.
 */

const fs = require('fs');
const { assert } = require('chai');

const testSuite = process.env.TEST_SUITE_FOR_TIMINGS || "unset_suite";
const timingsFile = process.env.TIMINGS_FILE || "test/timings-all.txt";

exports.mochaHooks = {
  beforeAll(done) {
    const testSplits = process.env.TEST_SPLITS;
    if (!testSplits) {
      return done();
    }
    const match = testSplits.match(/^(\d+)-of-(\d+)$/);
    if (!match) {
      assert.fail(`Invalid test split spec '${testSplits}': use format 'N-of-M'`);
    }

    const group = Number(match[1]);
    const groupCount = Number(match[2]);
    if (!(group >= 1 && group <= groupCount)) {
      assert.fail(`Invalid test split spec '${testSplits}': index must be in range 1..{groupCount}`);
    }

    const testParent = this.test.parent;
    const timings = getTimings();
    const groups = groupSuites(testParent.suites, timings, groupCount);

    testParent.suites = groups[group - 1];  // Convert to a 0-based index.
    console.log(`Split tests groups; will run group ${group} of ${groupCount}`);
    done();
  }
};

/**
 * Read timings from timingsFile into a Map mapping file-suite-title to duration.
 */
function getTimings() {
  const timings = new Map();
  try {
    const content = fs.readFileSync(timingsFile, {encoding: 'utf8'})
    for (const line of content.split(/\r?\n/)) {
      const [bigSuite, fileSuite, duration] = line.split(/\s+/);
      if (bigSuite === testSuite && !isNaN(Number(duration))) {
        timings.set(fileSuite, Number(duration));
      }
    }
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.warn(`No timings found in ${timingsFile}; proceeding without timings`);
    } else {
      throw e;
    }
  }
  return timings;
}

/**
 * Splits suites into groups and returns the list of them.
 *
 * The algorithm to group tests into suites starts goes one by one from longest to shortest,
 * adding them to the least filled-up group.
 */
function groupSuites(suites, timings, groupCount) {
  // Calculate a fallback value for durations as the average of existing durations.
  const totalDuration = Array.from(timings.values()).reduce(((s, dur) => s + dur), 0);
  if (!totalDuration) {
    console.warn("No timings; assuming all tests are equally long");
  }
  const fallbackDuration = totalDuration ? totalDuration / timings.size : 1000;

  const groups = Array.from(Array(groupCount), () => []);
  const groupDurations = groups.map(() => 0);

  // Check for duplicate suite titles.
  const suitesByTitle = new Map(suites.map(s => [s.title, s]));
  for (const suite of suites) {
    if (suitesByTitle.get(suite.title) !== suite) {
      assert.fail(`Please fix duplicate suite title: ${suite.title}`);
    }
  }

  // Get timing for the given suite, falling back to fallbackDuration.
  function getTiming(suite) {
    const value = timings.get(suite.title);
    return (typeof value !== 'number' || isNaN(value)) ? fallbackDuration : value;
  }

  // Sort suites by descending duration.
  const sortedSuites = suites.slice().sort((a, b) => getTiming(b) - getTiming(a));

  for (const suite of sortedSuites) {
    // Pick a least-duration group.
    const index = groupDurations.indexOf(Math.min(...groupDurations));
    groups[index].push(suite);
    groupDurations[index] += getTiming(suite);
  }

  // Sort each group alphabetically by title.
  for (const group of groups) {
    group.sort((a, b) => a.title < b.title ? -1 : 1);
  }
  return groups;
}
