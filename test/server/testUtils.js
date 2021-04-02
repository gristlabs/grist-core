/**
 * Functions useful for testing.
 *
 * It re-exports chai.assert, so that you can import it from here with confidence
 * that it has been instrumented to support things like assert.isRejected
 * (via chai.use(chaiAsPromised).
 *
 */


/* global before, after */

const _         = require('underscore');
const chai      = require('chai');
const assert    = chai.assert;
const chaiAsPromised = require('chai-as-promised');
const path      = require('path');
const util = require('util');

const Promise   = require('bluebird');
const fs        = Promise.promisifyAll(require('fs'));
const tmp       = Promise.promisifyAll(require('tmp'));
const tmpFile   = Promise.promisify(tmp.file, {multiArgs: true});
const winston   = require('winston');
const {serialize}   = require('winston/lib/winston/common');

const docUtils  = require('app/server/lib/docUtils');
const log       = require('app/server/lib/log');
const {getAppRoot} = require('app/server/lib/places');

chai.use(chaiAsPromised);
Promise.config({longStackTraces: true});

/**
 * Creates a temporary file with the given contents.
 * @param {String} content. Data to store in the file.
 * @param {[Boolean]} optKeep. Optionally pass in true to keep the file from being deleted, which
 *    is useful to see the content while debugging a test.
 * @returns {Promise} A promise for the path of the new file.
 */
function writeTmpFile(content, optKeep) {
  // discardDescriptor ensures tmp module closes it. It can lead to horrible bugs to close this
  // descriptor yourself, since tmp also closes it on exit, and if it's a different descriptor by
  // that time, it can lead to a crash. See https://github.com/raszi/node-tmp/issues/168
  return tmpFile({keep: optKeep, discardDescriptor: true})
  .spread(function(path) {
    return fs.writeFileAsync(path, content)
    .thenReturn(path);
  });
}
exports.writeTmpFile = writeTmpFile;

/**
 * Creates a temporary file with `numLines` of generated data, each line about 30 bytes long.
 * This is useful for testing operations with large files.
 * @param {Number} numLines. How many lines to store in the file.
 * @param {[Boolean]} optKeep. Optionally pass in true to keep the file from being deleted, which
 *    is useful to see the content while debugging a test.
 * @returns {Promise} A promise for the path of the new file.
 */
function generateTmpFile(numLines, optKeep) {
  // Generate a bigger data file.
  var data = [];
  for (var i = 0; i < numLines; i++) {
    data.push(i + " abcdefghijklmnopqrstuvwxyz\n");
  }
  return writeTmpFile(data.join(""), optKeep);
}
exports.generateTmpFile = generateTmpFile;



/**
 * Helper class to capture log output when we want to test it.
 */
var CaptureTransport = function(options) {
  this._captureFunc = options.captureFunc;
  if (options.name) {
    this.name = options.name;
  }
};
util.inherits(CaptureTransport, winston.Transport);
CaptureTransport.prototype.name = 'CaptureTransport';
CaptureTransport.prototype.log = function(level, msg, meta, callback) {
  this._captureFunc(level, msg, meta);
  callback(null);
};


/**
 * When used inside a test suite (inside describe()), changes the log level to the given one
 * before tests, restoring it back afterwards. In addition, if optCaptureFunc is given, it will be
 * called as optCaptureFunc(level, msg) with every message logged (including those suppressed).
 *
 * This should be called at the suite level (i.e. inside describe()).
 */
function setTmpLogLevel(level, optCaptureFunc) {
  // If verbose is set in the environment, sabotage all reductions in logging level.
  // Handier than modifying the setTmpLogLevel line and then remembering to set it back
  // before committing.
  if (process.env.VERBOSE === '1') {
    level = 'debug';
  }

  var prevLogLevel = null;

  before(function() {
    if (this.runnable().parent.root) {
      throw new Error("setTmpLogLevel should be called at suite level, not at root level");
    }

    prevLogLevel = log.transports.file.level;
    log.transports.file.level = level;
    if (optCaptureFunc) {
      log.add(CaptureTransport, { captureFunc: optCaptureFunc });
    }
  });

  after(function() {
    if (optCaptureFunc) {
      log.remove(CaptureTransport);
    }
    log.transports.file.level = prevLogLevel;
  });
}
exports.setTmpLogLevel = setTmpLogLevel;


/**
 * Captures debug log messages produced by callback. Suppresses ALL messages from console, and
 * captures those at minLevel and higher. Returns a promise for the array of "level: message"
 * strings. These may be tested using testUtils.assertMatchArray(). Callback may return a promise.
 */
function captureLog(minLevel, callback) {
  const messages = [];
  const prevLogLevel = log.transports.file.level;
  const name = _.uniqueId('CaptureLog');

  function capture(level, msg, meta) {
    if (log.levels[level] <= log.levels[minLevel]) {
      messages.push(level + ': ' + msg + (meta ? ' ' + serialize(meta) : ''));
    }
  }

  log.transports.file.level = -1;   // Suppress all log output.
  log.add(CaptureTransport, { captureFunc: capture, name: name });
  return Promise.try(() => callback())
  .finally(() => {
    log.remove(name);
    log.transports.file.level = prevLogLevel;
  })
  .return(messages);
}
exports.captureLog = captureLog;


/**
 * Asserts that each string of stringArray matches the corresponding regex in regexArray.
 */
function assertMatchArray(stringArray, regexArray) {
  for (let i = 0; i < Math.min(stringArray.length, regexArray.length); i++) {
    assert.match(stringArray[i], regexArray[i]);
  }
  assert.isAtMost(stringArray.length, regexArray.length,
    `Unexpected strings seen: ${stringArray.slice(regexArray.length).join('\n')}`);
  assert.isAtLeast(stringArray.length, regexArray.length,
    'Not all expected strings were seen');
}
exports.assertMatchArray = assertMatchArray;

/**
 * Helper method for handling expected Promise rejections.
 *
 * @param {Promise} promise = the promise we are checking for errors
 * @param {String} errCode - Error code to check against `err.code` from the caller.
 * @param {RegExp} errRegexp - Regular expression to check against `err.message` from the caller.
 */
function expectRejection(promise, errCode, errRegexp) {
  return promise
  .then(function() {
    assert(false, "Expected promise to return an error: " + errCode);
  })
  .catch(function(err) {
    if (err.cause) {
      err = err.cause;
    }
    assert.strictEqual(err.code, errCode);

    if (errRegexp !== undefined) {
      assert(errRegexp.test(err.message), "Description doesn't match regexp: " +
             errRegexp + ' !~ ' + err.message);
    }
  });
}
exports.expectRejection = expectRejection;

/**
 * Reads in doc actions from a test script. Used in DocStorage_Script.js and DocData.js.
 * This parser inserts line numbers into the step names of the test case bodies. Users of the test
 * script should iterate through the steps using processTestScriptSteps, which will strip out the
 * line numbers, and include them into any failure messages.
 *
 * @param {String} file - Input test script
 * @returns {Promise:Object} - Parsed test script object
 */
exports.readTestScript = function(file) {
  return fs.readFileAsync(file, {encoding: 'utf8'})
  .then(function(fullText) {
    var allLines = [];
    fullText.split("\n").forEach(function(line, i) {
      if (line.match(/^\s*\/\//)) {
        allLines.push('');
      } else {
        line = line.replace(/"(APPLY|CHECK_OUTPUT|LOAD_SAMPLE)"\s*,/, '"$1@' + (i + 1) + '",');
        allLines.push(line);
      }
    });
    return JSON.parse(allLines.join("\n"));
  });
};

/**
 * For a test case step, such as ["APPLY", {actions}], checks if the step name has an encoded line
 * number, strips it, runs the callback with the step data, and inserts the line number into any
 * errors thrown by the callback.
 */
exports.processTestScriptSteps = function(body, stepCallback) {
  return Promise.each(body, function(step) {
    var stepName = step[0];
    var lineNoPos = stepName.indexOf('@');
    var lineNum = (lineNoPos === -1) ? null : stepName.slice(lineNoPos + 1);
    step[0] = (lineNoPos === -1) ? stepName : stepName.slice(0, lineNoPos);
    return Promise.try(() => stepCallback(step))
    .catch(function(e) {
      e.message = "LINE " + lineNum + ": " + e.message;
      throw e;
    });
  });
};

/**
 * Helper that substitutes every instance of `from` value to `to` value. Iterates down the object.
 */
function deepSubstitute(obj, from, to) {
  assert.lengthOf(arguments, 3, 'Must specify obj, from, and to params');
  from = _.isArray(from) ? from : [from];
  if (_.isArray(obj)) {
    return obj.map(el => deepSubstitute(el, from, to));
  } else if (obj && typeof obj === 'object' && !_.isFunction(obj)) {
    return _.mapObject(obj, el => deepSubstitute(el, from, to));
  } else {
    return from.indexOf(obj) !== -1 ? to : obj;
  }
}
exports.deepSubstitute = deepSubstitute;

const fixturesRoot = path.resolve(getAppRoot(), 'test', 'fixtures');
exports.fixturesRoot = fixturesRoot;

exports.appRoot = getAppRoot();

/**
 * Copy the given filename from the fixtures directory (test/fixtures) to the provided copyPath.
 * @param {string} alias - Optional alias that lets you rename the document on disk.
 */
function useFixtureDoc(fileName, storageManager, alias = fileName) {
  var srcPath = path.resolve(fixturesRoot, "docs", fileName);
  var docName = path.basename(alias ? alias : fileName, ".grist");
  return docUtils.createNumbered(docName, "-",
    name => docUtils.createExclusive(storageManager.getPath(name))
  )
  .tap(docName => log.info("Using fixture %s as %s", fileName, docName + ".grist"))
  .tap(docName => docUtils.copyFile(srcPath, storageManager.getPath(docName)))
  .tap(docName => storageManager.markAsChanged(docName));
}
exports.useFixtureDoc = useFixtureDoc;

exports.assert = assert;
