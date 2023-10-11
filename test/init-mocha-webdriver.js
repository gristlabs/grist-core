/**
 * Settings that affect tests using mocha-webdriver. This module is imported by any run of mocha,
 * by being listed in package.json. (Keep in mind that it's imported by non-browser tests, such
 * as test/common, as well.)
 */


// This determines when a failed assertion shows a diff with details or
// "expected [ Array(3) ] to deeply equal [ Array(3) ]".
// Increase the threshold since the default (of 40 characters) is often too low.
// You can override it using CHAI_TRUNCATE_THRESHOLD env var; 0 disables it.
require('chai').config.truncateThreshold = process.env.CHAI_TRUNCATE_THRESHOLD ?
  parseFloat(process.env.CHAI_TRUNCATE_THRESHOLD) : 4000;

// Set an explicit window size (if not set by an external variable), to ensure that manully-run
// and Jenkins-run tests, headless or not, use a consistent size. (Not that height is still not
// identical between regular and headless browsers.)
//
// The size is picked to be on the small size, to ensure we test issues caused by constrained
// space (e.g. scrolling when needed). 1024x640 is a slight increase over 900x600 we used before.
// Note that https://www.hobo-web.co.uk/best-screen-size/ lists 1366×768 as most common desktop
// size, so it's reasonable to assume a browser that takes up most but not all of such a screen.
if (!process.env.MOCHA_WEBDRIVER_WINSIZE) {
  process.env.MOCHA_WEBDRIVER_WINSIZE = "1024x640";
}

// Enable enhanced stacktraces by default. Disable by running with MOCHA_WEBDRIVER_STACKTRACES="".
if (process.env.MOCHA_WEBDRIVER_STACKTRACES === undefined) {
  process.env.MOCHA_WEBDRIVER_STACKTRACES = "1";
}

// Default to chrome for mocha-webdriver testing. Override by setting SELENIUM_BROWSER, as usual.
if (!process.env.SELENIUM_BROWSER) {
  process.env.SELENIUM_BROWSER = "chrome";
}

// Don't fail on mismatched Chrome versions. Disable with MOCHA_WEBDRIVER_IGNORE_CHROME_VERSION="".
if (process.env.MOCHA_WEBDRIVER_IGNORE_CHROME_VERSION === undefined) {
  process.env.MOCHA_WEBDRIVER_IGNORE_CHROME_VERSION = "1";
}

// don't show "Chrome is controlled by..." banner since at time of writing it can
// swallow early clicks on page reload.
if (process.env.MOCHA_WEBDRIVER_NO_CONTROL_BANNER === undefined) {
  process.env.MOCHA_WEBDRIVER_NO_CONTROL_BANNER = "1";
}

// Detect whether there is an nbrowser test. If so,
// set an environment variable that will be available
// in individual processes if --parallel is enabled.
for (const arg of process.argv) {
  if (arg.includes('/nbrowser/')) {
    process.env.MOCHA_WEBDRIVER = '1';
  }
}

// If --parallel is enabled, and we are in an individual
// worker process, set up mochaHooks. Watch out: at the
// time of writing, there's no way to have hooks run at the
// start and end of the worker process.
if (process.env.MOCHA_WORKER_ID !== undefined &&
    process.env.MOCHA_WEBDRIVER !== undefined) {
  const {getMochaHooks} = require('mocha-webdriver');
  exports.mochaHooks = getMochaHooks();
}
