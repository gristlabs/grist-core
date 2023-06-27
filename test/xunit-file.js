// Based on https://github.com/peerigon/xunit-file, with changes that are impossible to
// monkey-patch. Also refactored, but not converted to typescript, to avoid slowing down mocha
// runs with ts-node.
//
// It also produces a file timings.txt with timings, made of lines of the form:
//    <TEST_SUITE> <top-level-describe-suite> <number-of-milliseconds>
//
// Respects the following environment variables:
//    XUNIT_FILE: path of output XML file (default: xunit.xml)
//    XUNIT_SILENT: suppress human-friendly logging to the console
//    XUNIT_SUITE_NAME: name to use for the top-level <testsuite> (default: "Mocha Tests")
//    XUNIT_CLASS_PREFIX: prefix to use for <testcase classname=...> attribute (default: "")
//    TEST_SUITE: name of the test suite to prefix timings with.



const fse = require('fs-extra');
const {reporters, utils} = require('mocha');
const path = require('path');
const escape = utils.escape;

const filePath = process.env.XUNIT_FILE || "xunit.xml";
const consoleOutput = !process.env.XUNIT_SILENT;
const suiteName = process.env.XUNIT_SUITE_NAME || 'Mocha Tests';
const classPrefix = process.env.XUNIT_CLASS_PREFIX || '';
const timingsPath = path.join(path.dirname(filePath), "timings.txt");
const testSuite = process.env.TEST_SUITE || 'unset_suite';

/**
 * Save reference to avoid Sinon interfering (see GH-237).
 */
const MDate = global.Date;

// Special marker for tag() to produce an unclosed opening XML tag.
const UNCLOSED = Symbol('UNCLOSED');

function logToConsole(msg) {
  if (consoleOutput) { console.log(msg); }
}

const failureNumbers = new Map();   // Maps test object to failure number.

/**
 * Initialize a new `XUnitFile` reporter.
 */
class XUnitFile extends reporters.Base {
  constructor(runner) {
    super(runner);
    const stats = this.stats;
    const tests = [];
    fse.mkdirpSync(path.dirname(filePath));
    const fd = fse.openSync(filePath, 'w', 0o0644);
    const timingsFd = fse.openSync(timingsPath, 'w', 0o0644);
    const startedSuites = new Map();
    let ending = false;

    // We have to be a little clever about closing the timings descriptor because the 'end' event
    // may occur *before* the last 'suite end' event.
    function maybeCloseTimings() {
      if (ending && startedSuites.size === 0) {
        fse.closeSync(timingsFd);
      }
    }

    runner.on('suite', (suite) => {
      logToConsole(suite.fullTitle());
      startedSuites.set(suite, Date.now());
    });

    runner.on('suite end', (suite) => {
      // Every time a (top-level) suite ends, add a line to the timings file.
      if (suite.titlePath?.()?.length == 1) {
        const duration = Date.now() - startedSuites.get(suite);
        appendLine(timingsFd, `${testSuite} ${suite.fullTitle()} ${duration}`);
        startedSuites.delete(suite);
        // If 'end' has already happened, close the file.
        maybeCloseTimings();
      }
    });

    runner.on('pass', (test) => {
      logToConsole(`  ${reporters.Base.symbols.ok} ${test.fullTitle()}`);
      tests.push(test);
    });

    runner.on('fail', (test) => {
      failureNumbers.set(test, failureNumbers.size + 1);
      logToConsole(`  (${failureNumbers.get(test)}) ${test.fullTitle()}`);
      logToConsole(`      ERROR: ${test.err}`);
      tests.push(test);
    });

    runner.on('pending', (test) => {
      logToConsole(`  - ${test.fullTitle()}`);
      tests.push(test);
    });

    runner.once('end', () => {
      const timestampStr = new MDate().toISOString().split('.', 1)[0];
      appendLine(fd, tag('testsuite', {
        name: suiteName,
        tests: stats.tests,
        failures: stats.failures,
        errors: stats.failures,
        skipped: stats.tests - stats.failures - stats.passes,
        timestamp: timestampStr,
        time: (stats.duration || 0) / 1000
      }, UNCLOSED));

      logToConsole("");
      for (const test of tests) {
        writeTest(fd, test);
      }

      appendLine(fd, '</testsuite>');
      fse.closeSync(fd);
      ending = true;
      maybeCloseTimings();
    });
  }
}

/**
 * Output tag for the given `test.`
 */
function writeTest(fd, test) {
  const classname = classPrefix + test.parent.fullTitle();
  const name = test.title;
  const time = (test.duration || 0) / 1000;
  if (test.state === 'failed') {
    const err = test.err;
    appendLine(fd,
      tag('testcase', {classname, name, time},
        tag('failure', {message: err.message}, cdata(err.stack))));
    logToConsole(`***\n(${failureNumbers.get(test)}) ${test.fullTitle()}`);
    logToConsole(err.stack + '\n');
  } else if (test.pending) {
    appendLine(fd, tag('testcase', {classname, name}, tag('skipped', {})));
  } else {
    appendLine(fd, tag('testcase', {classname, name, time}) );
  }
}

/**
 * HTML tag helper.
 * content may be undefined, a string, or the symbol UNCLOSED to produce just an opening tag.
 */
function tag(name, attrs, content) {
  const attrStr = Object.keys(attrs).map((key) => ` ${key}="${escape(String(attrs[key]))}"`).join('');
  return (
    content === undefined ? `<${name}${attrStr}/>` :
    content === UNCLOSED ? `<${name}${attrStr}>` :
    `<${name}${attrStr}>${content}</${name}>`
  );
}

/**
 * Return cdata escaped CDATA `str`.
 */
function cdata(str) {
  return '<![CDATA[' + escape(str) + ']]>';
}

function appendLine(fd, line) {
  fse.writeSync(fd, line + "\n", null, 'utf8');
}

module.exports = XUnitFile;
