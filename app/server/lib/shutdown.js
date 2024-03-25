/**
 * Module for managing graceful shutdown.
 */


var log = require('app/server/lib/log');
var Promise = require('bluebird');

var os = require('os');

var cleanupHandlers = [];

var signalsHandled = {};

/**
 * Adds a handler that should be run on shutdown.
 * @param {Object} context The context with which to run the method, and which can be used to
 *    remove cleanup handlers.
 * @param {Function} method The method to run. It may return a promise, which will be waited on.
 * @param {Number} timeout Timeout in ms, for how long to wait for the returned promise. Required
 *    because it's no good for a cleanup handler to block the shutdown process indefinitely.
 * @param {String} name A title to show in log messages to distinguish one handler from another.
 */
function addCleanupHandler(context, method, timeout = 1000, name = 'unknown') {
  cleanupHandlers.push({
    context,
    method,
    timeout,
    name
  });
}
exports.addCleanupHandler = addCleanupHandler;

/**
 * Removes all cleanup handlers with the given context.
 * @param {Object} context The context with which once or more cleanup handlers were added.
 */
function removeCleanupHandlers(context) {
  // Maybe there should be gutil.removeFilter(func) which does this in-place.
  cleanupHandlers = cleanupHandlers.filter(function(handler) {
    return handler.context !== context;
  });
}
exports.removeCleanupHandlers = removeCleanupHandlers;


var _cleanupHandlersPromise = null;

/**
 * Internal helper which runs all cleanup handlers, with the right contexts and timeouts,
 * waits for them, and reports and swallows any errors. It returns a promise that should always be
 * fulfilled.
 */
function runCleanupHandlers() {
  if (!_cleanupHandlersPromise) {
    // Switch out cleanupHandlers, to leave an empty array at the end.
    var handlers = cleanupHandlers;
    cleanupHandlers = [];
    _cleanupHandlersPromise = Promise.all(handlers.map(function(handler) {
      return Promise.try(handler.method.bind(handler.context)).timeout(handler.timeout)
      .catch(function(err) {
        log.warn(`Cleanup error for '${handler.name}' handler: ` + err);
      });
    }));
  }
  return _cleanupHandlersPromise;
}

/**
 * Internal helper to exit on a signal. It runs the cleanup handlers, and then
 * exits propagating the same signal code than the one caught.
 */
function signalExit(signal) {
  var prog = 'grist[' + process.pid + ']';
  log.info("Server %s got signal %s; cleaning up (%d handlers)",
    prog, signal, cleanupHandlers.length);
  function dup() {
    log.info("Server %s ignoring duplicate signal %s", prog, signal);
  }
  process.on(signal, dup);
  return runCleanupHandlers()
  .finally(function() {
    log.info("Server %s exiting on %s", prog, signal);
    process.removeListener(signal, dup);
    delete signalsHandled[signal];
    // Exit with the expected exit code for being killed by this signal.
    // Unlike re-sending the same signal, the explicit exit works even
    // in a situation when Grist is the init (pid 1) process in a container
    // See https://github.com/gristlabs/grist-core/pull/830 (and #892)
    const signalNumber = os.constants.signals[signal];
    process.exit(process.pid, 128 + signalNumber);
  });
}

/**
 * For the given signals, run cleanup handlers (which may be asynchronous) before re-sending the
 * signals to the process. This should only be used for signals that normally kill the process.
 * E.g. cleanupOnSignals('SIGINT', 'SIGTERM', 'SIGUSR2');
 */
function cleanupOnSignals(varSignalNames) {
  for (var i = 0; i < arguments.length; i++) {
    var signal = arguments[i];
    if (signalsHandled[signal]) { continue; }
    signalsHandled[signal] = true;
    process.once(signal, signalExit.bind(null, signal));
  }
}
exports.cleanupOnSignals = cleanupOnSignals;

/**
 * Run cleanup handlers and exit the process with the given exit code (0 if omitted).
 */
function exit(optExitCode) {
  var prog = 'grist[' + process.pid + ']';
  var code = optExitCode || 0;
  log.info("Server %s cleaning up", prog);
  return runCleanupHandlers()
  .finally(function() {
    log.info("Server %s exiting with code %s", prog, code);
    process.exit(code);
  });
}
exports.exit = exit;
