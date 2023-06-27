/**
 * Mocha 4 no longer forces exit of a process after tests end, so if a setTimeout() or anything
 * else is keeping node running, tests will hang after finishing.
 *
 * This helper module, always included via mocha.opts, ensures we print something if that happens.
 * We use why-is-node-running module to print something informative.
 */

// --no-exit|-E flag is interpreted by mocha-webdriver library to start REPL on failure, and we
// do NOT want to output a big dump about that.
const noexit = process.argv.includes("--no-exit") || process.argv.includes('-E');
// Don't load why-is-node-running if we're not going to use it. It probably means that we're
// in a debugging session, and this module creates async hooks that interfere with debugging.
const whyIsNodeRunning = noexit ? null : require('why-is-node-running');

function report() {
  whyIsNodeRunning?.();
  console.warn("*******************************************************");
  console.warn("Something above prevented node from exiting on its own.");
  console.warn("*******************************************************");
  // We want to exit, but process.exit(1) doesn't work, since mocha catches it and insists on
  // exiting with the test status result (which may be 0, and we need to indicate failure).
  process.kill(process.pid, 'SIGTERM');
}

if (process.env.MOCHA_WORKER_ID === undefined) {
  exports.mochaHooks = {
    afterAll(done) {
      if (noexit) {
        console.log("report-why-tests-hang silenced with --no-exit flag");
      } else {
        // If still hanging after 5s after tests finish, say something. Unref() ensures that THIS
        // timeout doesn't itself keep node from exiting.
        setTimeout(report, 5000).unref();
      }
      done();
    }
  }
}
