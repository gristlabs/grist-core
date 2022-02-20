/**
 * Functions generally useful when dealing with Grist documents.
 */



var fs = require('fs');
var fsPath = require('path');
var Promise = require('bluebird');
Promise.promisifyAll(fs);

var nonIdentRegex = /[^\w_]+/g;

/**
 * Given a string, converts it to a Grist identifier. Identifiers consist of lowercase
 * alphanumeric characters and the underscore.
 * @param {String} name The name to convert.
 * @returns {String} Identifier.
 */
function makeIdentifier(name) {
  // Lowercase and replace consecutive invalid characters with underscores.
  return name.toLowerCase().replace(nonIdentRegex, '_');
}
exports.makeIdentifier = makeIdentifier;


/**
 * Copies a file, returning a promise that is resolved (with no value) when the copy is complete.
 * TODO This needs a unittest.
 */
function copyFile(sourcePath, destPath) {
  var sourceStream, destStream;
  return new Promise(function(resolve, reject) {
    sourceStream = fs.createReadStream(sourcePath);
    destStream = fs.createWriteStream(destPath);

    sourceStream.on('error', reject);
    destStream.on('error', reject);
    destStream.on('finish', resolve);

    sourceStream.pipe(destStream);
  })
  .finally(function() {
    if (destStream) { destStream.destroy(); }
    if (sourceStream) { sourceStream.destroy(); }
  });
}
exports.copyFile = copyFile;


/**
 * Helper for creating numbered files. Tries to call creator() with name, then (name + separator +
 * "2") and so on with incrementing numbers, as long as the promise returned by creator() is
 * rejected with err.code of 'EEXIST'. Creator() must return a promise.
 * @param {String} name The first name to try.
 * @param {String} separator The separator between name and appended numbers.
 * @param {Function} creator The function to call with successive names. Must return a promise.
 * @param {Number} startNum Optional number to start with; omit to try an unnumbered name first.
 * @returns {Promise} Promise for the first name for which creator() succeeded.
 */
function createNumbered(name, separator, creator, startNum) {
  var fullName = name + (startNum === undefined ? '' : separator + startNum);
  var nextNum = (startNum === undefined ? 2 : startNum + 1);
  return creator(fullName)
  .then(() => fullName)
  .catch(function(err) {
    if (err.cause && err.cause.code !== 'EEXIST')
      throw err;
    return createNumbered(name, separator, creator, nextNum);
  });
}
exports.createNumbered = createNumbered;

/**
 * An easier-to-use alternative to createNumbered. Pass in a template string containing the
 * special token "{NUM}". It will first call creator() with "{NUM}" removed, then with "{NUM}"
 * replaced by "-2", "-3", etc, until creator() succeeds, and will return the value for which it
 * succeeded.
 */
function createNumberedTemplate(template, creator) {
  const [prefix, suffix] = template.split("{NUM}");
  if (typeof prefix !== "string" || typeof suffix !== "string") {
    throw new Error(`createNumberedTemplate: invalid template ${template}`);
  }
  return createNumbered(prefix, "-", (uniqPrefix) => creator(uniqPrefix + suffix))
  .then((uniqPrefix) => uniqPrefix + suffix);
}
exports.createNumberedTemplate = createNumberedTemplate;

/**
 * Creates a new file, failing if the path already exists.
 * @param {String} path: The path to try creating.
 * @returns {Promise} Resolved if the path was created, rejected if it already existed (with
 *      err.cause.code === EEXIST) or if there was another error creating it.
 */
function createExclusive(path) {
  return fs.openAsync(path, 'wx').then(fd => fs.closeAsync(fd));
}
exports.createExclusive = createExclusive;


/**
 * Returns the canonicalized absolute path for the given path, using fs.realpath, but allowing
 * non-existent paths. In case of non-existent path, the longest existing prefix is resolved and
 * the rest kept unchanged.
 * @param {String} path: Path to resolve.
 * @return {Promise:String} Promise for the resolved path.
 */
function realPath(path) {
  return fs.realpathAsync(path)
  .catch(() =>
    realPath(fsPath.dirname(path))
    .then(dir => fsPath.join(dir, fsPath.basename(path)))
  );
}
exports.realPath = realPath;


/**
 * Returns a promise that resolves to true or false based on whether the path exists. If other
 * errors occur, this promise may still be rejected.
 */
function pathExists(path) {
  return fs.accessAsync(path)
  .then(() => true)
  .catch({code: 'ENOENT'}, () => false)
  .catch({code: 'ENOTDIR'}, () => false);
}
exports.pathExists = pathExists;

/**
 * Returns a promise that resolves to true or false based on whether the two paths point to the
 * same file. If errors occur, this promise may be rejected.
 */
function isSameFile(path1, path2) {
  return Promise.join(fs.lstatAsync(path1), fs.lstatAsync(path2), (stat1, stat2) => {
    if (stat1.dev === stat2.dev && stat1.ino === stat2.ino) {
      return true;
    }
    return false;
  })
  .catch({code: 'ENOENT'}, () => false)
  .catch({code: 'ENOTDIR'}, () => false);
}
exports.isSameFile = isSameFile;
