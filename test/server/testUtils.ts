/**
 * Functions useful for testing.
 *
 * It re-exports chai.assert, so that you can import it from here with confidence
 * that it has been instrumented to support things like assert.isRejected
 * (via chai.use(chaiAsPromised).
 *
 */


/* global before, after */

import * as _ from 'underscore';
import { assert } from 'chai';
import {tmpdir} from 'os';
import * as path from 'path';
import * as fse from 'fs-extra';
import clone = require('lodash/clone');
import * as tmp from 'tmp-promise';
import {Options as TmpOptions} from 'tmp';
import * as winston from 'winston';
import { serialize } from 'winston/lib/winston/common';

import * as docUtils from 'app/server/lib/docUtils';
import log from 'app/server/lib/log';
import { getAppRoot } from 'app/server/lib/places';

/**
 * Creates a temporary file with the given contents.
 * @param {String} content. Data to store in the file.
 * @param {[Boolean]} options.keep. Optionally pass in true to keep the file from being deleted, which
 *    is useful to see the content while debugging a test.
 * @returns {Promise} A promise for the path of the new file.
 */
export async function writeTmpFile(content: any, options: TmpOptions = {}) {
  // discardDescriptor ensures tmp module closes it. It can lead to horrible bugs to close this
  // descriptor yourself, since tmp also closes it on exit, and if it's a different descriptor by
  // that time, it can lead to a crash. See https://github.com/raszi/node-tmp/issues/168
  const obj = await tmp.file({discardDescriptor: true, ...options});
  await fse.writeFile(obj.path, content);
  return obj.path;
}

/**
 * Creates a temporary file with `numLines` of generated data, each line about 30 bytes long.
 * This is useful for testing operations with large files.
 * @param {Number} numLines. How many lines to store in the file.
 * @param {[Boolean]} options.keep. Optionally pass in true to keep the file from being deleted, which
 *    is useful to see the content while debugging a test.
 * @returns {Promise} A promise for the path of the new file.
 */
export async function generateTmpFile(numLines: number, options: TmpOptions = {}) {
  // Generate a bigger data file.
  const data = [];
  for (let i = 0; i < numLines; i++) {
    data.push(i + " abcdefghijklmnopqrstuvwxyz\n");
  }
  return writeTmpFile(data.join(""), options);
}



/**
 * Helper class to capture log output when we want to test it.
 */
class CaptureTransport extends winston.Transport {
  private _captureFunc: (level: string, msg: string, meta: any) => void;

  public constructor(options: any) {
    super(options);
    this._captureFunc = options.captureFunc;
    if (options.name) {
      this.name = options.name;
    }
  }

  public log(level: string, msg: string, meta: any, callback: () => void) {
    this._captureFunc(level, msg, meta);
  }
}


/**
 * When used inside a test suite (inside describe()), changes the log level to the given one
 * before tests, restoring it back afterwards. In addition, if optCaptureFunc is given, it will be
 * called as optCaptureFunc(level, msg) with every message logged (including those suppressed).
 *
 * This should be called at the suite level (i.e. inside describe()).
 */
export function setTmpLogLevel(level: string, optCaptureFunc?: (level: string, msg: string, meta: any) => void) {
  // If verbose is set in the environment, sabotage all reductions in logging level.
  // Handier than modifying the setTmpLogLevel line and then remembering to set it back
  // before committing.
  if (process.env.VERBOSE === '1') {
    level = 'debug';
  }

  let prevLogLevel: string|undefined = undefined;
  const name = _.uniqueId('CaptureLog');

  before(function() {
    if (this.runnable().parent?.root) {
      throw new Error("setTmpLogLevel should be called at suite level, not at root level");
    }

    prevLogLevel = log.transports.file.level;
    log.transports.file.level = level;
    if (optCaptureFunc) {
      log.add(CaptureTransport as any, { captureFunc: optCaptureFunc, name });  // typing is off.
    }
  });

  after(function() {
    if (optCaptureFunc) {
      log.remove(name);
    }
    log.transports.file.level = prevLogLevel;
  });
}


/**
 * Captures debug log messages produced by callback. Suppresses ALL messages from console, and
 * captures those at minLevel and higher. Returns a promise for the array of "level: message"
 * strings. These may be tested using testUtils.assertMatchArray(). Callback may return a promise.
 */
export async function captureLog(
  minLevel: string, callback: (messages: string[]) => void|Promise<void>,
  options: {timestamp?: boolean, waitForFirstLog?: boolean} = {timestamp: false, waitForFirstLog: false}
): Promise<string[]> {
  const messages: string[] = [];
  const prevLogLevel = log.transports.file.level;
  const name = _.uniqueId('CaptureLog');

  const captureFirstLogPromise = new Promise((resolve) => {
    function capture(level: string, msg: string, meta: any) {
      if ((log as any).levels[level] <= (log as any).levels[minLevel]) {  // winston types are off?
        const timePrefix = options.timestamp ? new Date().toISOString() + ' ' : '';
        messages.push(`${timePrefix}${level}: ${msg}${meta ? ' ' + serialize(meta) : ''}`);
        resolve(null);
      }
    }

    if (!process.env.VERBOSE) {
      log.transports.file.level = -1 as any;   // Suppress all log output.
    }
    log.add(CaptureTransport as any, { captureFunc: capture, name, level: minLevel});  // types are off.
  });

  try {
    await callback(messages);
    if (options.waitForFirstLog) {
      await captureFirstLogPromise;
    }
  } finally {
    log.remove(name);
    log.transports.file.level = prevLogLevel;
  }
  return messages;
}


/**
 * Asserts that each string of stringArray matches the corresponding regex in regexArray.
 */
export function assertMatchArray(stringArray: string[], regexArray: RegExp[]) {
  for (let i = 0; i < Math.min(stringArray.length, regexArray.length); i++) {
    assert.match(stringArray[i], regexArray[i]);
  }
  assert.isAtMost(stringArray.length, regexArray.length,
    `Unexpected strings seen: ${stringArray.slice(regexArray.length).join('\n')}`);
  assert.isAtLeast(stringArray.length, regexArray.length,
    'Not all expected strings were seen');
}

/**
 * Helper method for handling expected Promise rejections.
 *
 * @param {Promise} promise = the promise we are checking for errors
 * @param {String} errCode - Error code to check against `err.code` from the caller.
 * @param {RegExp} errRegexp - Regular expression to check against `err.message` from the caller.
 */
export function expectRejection(promise: Promise<any>, errCode: number|string, errRegexp: RegExp) {
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

/**
 * Reads in doc actions from a test script. Used in DocStorage_Script.js and DocData.js.
 * This parser inserts line numbers into the step names of the test case bodies. Users of the test
 * script should iterate through the steps using processTestScriptSteps, which will strip out the
 * line numbers, and include them into any failure messages.
 *
 * @param {String} file - Input test script
 * @returns {Promise:Object} - Parsed test script object
 */
export async function readTestScript(file: string) {
  const fullText = await fse.readFile(file, {encoding: 'utf8'});
  const allLines: string[] = [];
  fullText.split("\n").forEach(function(line, i) {
    if (line.match(/^\s*\/\//)) {
      allLines.push('');
    } else {
      line = line.replace(/"(APPLY|CHECK_OUTPUT|LOAD_SAMPLE)"\s*,/, '"$1@' + (i + 1) + '",');
      allLines.push(line);
    }
  });
  return JSON.parse(allLines.join("\n"));
}

/**
 * For a test case step, such as ["APPLY", {actions}], checks if the step name has an encoded line
 * number, strips it, runs the callback with the step data, and inserts the line number into any
 * errors thrown by the callback.
 */
export async function processTestScriptSteps<T>(body: Promise<[string, T]>[],
                                                stepCallback: (step: [string, T]) => Promise<void>) {
  for (const promise of body) {
    const step = await promise;
    const stepName = step[0];
    const lineNoPos = stepName.indexOf('@');
    const lineNum = (lineNoPos === -1) ? null : stepName.slice(lineNoPos + 1);
    step[0] = (lineNoPos === -1) ? stepName : stepName.slice(0, lineNoPos);
    try {
      await stepCallback(step);
    } catch (e) {
      e.message = "LINE " + lineNum + ": " + e.message;
      throw e;
    }
  }
}

/**
 * Helper that substitutes every instance of `from` value to `to` value. Iterates down the object.
 */
export function deepSubstitute(obj: any, from: any, to: any): any {
  from = _.isArray(from) ? from : [from];
  if (_.isArray(obj)) {
    return obj.map(el => deepSubstitute(el, from, to));
  } else if (obj && typeof obj === 'object' && !_.isFunction(obj)) {
    return _.mapObject(obj, el => deepSubstitute(el, from, to));
  } else {
    return from.indexOf(obj) !== -1 ? to : obj;
  }
}

export const fixturesRoot = path.resolve(getAppRoot(), 'test', 'fixtures');

export const appRoot = getAppRoot();

/**
 * Copy the given filename from the fixtures directory (test/fixtures)
 * to the storage manager root.
 * @param {string} alias - Optional alias that lets you rename the document on disk.
 */
export async function useFixtureDoc(fileName: string, storageManager: any, alias: string = fileName) {
  const srcPath = path.resolve(fixturesRoot, "docs", fileName);
  const docName = await useLocalDoc(srcPath, storageManager, alias);
  log.info("Using fixture %s as %s", fileName, docName + ".grist");
  return docName;
}

/**
 * Copy the given filename from srcPath to the storage manager root.
 * @param {string} alias - Optional alias that lets you rename the document on disk.
 */
export async function useLocalDoc(srcPath: string, storageManager: any, alias: string = srcPath) {
  let docName = path.basename(alias || srcPath, ".grist");
  docName = await docUtils.createNumbered(
    docName, "-",
    (name: string) => docUtils.createExclusive(storageManager.getPath(name)));
  await docUtils.copyFile(srcPath, storageManager.getPath(docName));
  await storageManager.markAsChanged(docName);
  return docName;
}

// an helper to copy a fixtures document to destPath
export async function copyFixtureDoc(docName: string, destPath: string) {
  const srcPath = path.resolve(fixturesRoot, 'docs', docName);
  await docUtils.copyFile(srcPath, destPath);
}

// a helper to read a fixtures document into memory
export async function readFixtureDoc(docName: string) {
  const srcPath = path.resolve(fixturesRoot, 'docs', docName);
  return fse.readFile(srcPath);
}

// a class to store a snapshot of environment variables, can be reverted to by
// calling .restore()
export class EnvironmentSnapshot {
  private _oldEnv: NodeJS.ProcessEnv;
  public constructor() {
    this._oldEnv = clone(process.env);
  }

  // Reset environment variables.
  public restore() {
    Object.assign(process.env, this._oldEnv);
    for (const key of Object.keys(process.env)) {
      if (this._oldEnv[key] === undefined) {
        delete process.env[key];
      }
    }
  }

  public get(key: string): string|undefined {
    return this._oldEnv[key];
  }
}

export async function createTestDir(suiteName: string): Promise<string> {
  const tmpRootDir = process.env.TESTDIR || tmpdir();
  const workerIdText = process.env.MOCHA_WORKER_ID || '0';
  const username = process.env.USER || "nobody";
  const testDir = path.join(tmpRootDir, `grist_test_${username}_${suiteName}_${workerIdText}`);
  // Remove any previous tmp dir, and create the new one.
  await fse.remove(testDir);
  await fse.mkdirs(testDir);
  log.warn(`Test logs and data are at: ${testDir}/`);
  return testDir;
}

export async function getBuildFile(relativePath: string): Promise<string> {
  if (await fse.pathExists(path.join('_build', relativePath))) {
    return path.join('_build', relativePath);
  }
  return path.join('_build', 'core', relativePath);
}

export { assert };
