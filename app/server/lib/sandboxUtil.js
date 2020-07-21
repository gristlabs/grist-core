/**
 * Various utilities and constants for communicating with the python sandbox.
 */


var MemBuffer = require('app/common/MemBuffer');
var log = require('./log');


/**
 * SandboxError is an error type for reporting errors forwarded from the sandbox.
 */
function SandboxError(message) {
  // Poorly documented node feature, required to make the derived error keep a proper stack trace.
  Error.captureStackTrace(this, this.constructor);
  this.name = 'SandboxError';
  this.message = "[Sandbox] " + (message || 'Python reported an error');
}
SandboxError.prototype = new Error();
// We need to set the .constructor property for Error.captureStackTrace to work correctly.
SandboxError.prototype.constructor = SandboxError;

exports.SandboxError = SandboxError;


/**
 * Special msgCode values that precede msgBody to indicate what kind of message it is.
 * These all cost one byte. If we needed more, we should probably switch to a number (5 bytes)
 *    CALL = call to the other side. The data must be an array of [func_name, arguments...]
 *    DATA = data must be a value to return to a call from the other side
 *    EXC = data must be an exception to return to a call from the other side
 */
exports.CALL = null;
exports.DATA = true;
exports.EXC = false;


/**
 * Returns a function that takes data buffers and logs them to log.info() with the given prefix.
 * The logged output is line-oriented, so that the prefix is only inserted at the start of a line.
 * Binary data is encoded as with JSON.stringify.
 */
function makeLinePrefixer(prefix, logMeta) {
  var partial = '';
  return data => {
    partial += MemBuffer.arrayToString(data);
    var newline;
    while ((newline = partial.indexOf("\n")) !== -1) {
      var line = partial.slice(0, newline);
      partial = partial.slice(newline + 1);
      // Escape some parts of the string by serializing it to JSON (without the quotes).
      log.rawInfo(prefix + JSON.stringify(line).slice(1, -1).replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\'),
        logMeta);
    }
  };
}
exports.makeLinePrefixer = makeLinePrefixer;
