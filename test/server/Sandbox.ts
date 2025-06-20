import { setGracefulCleanup } from 'tmp';
import { assert } from 'chai';

import { NSandbox } from 'app/server/lib/NSandbox';
import { timeoutReached } from 'app/server/lib/serverUtils';
import * as testUtils from 'test/server/testUtils';

setGracefulCleanup();

/**
 *
 * These tests were written for pynbox, a specific sandbox used
 * by Grist historically, but unfortunately using a technology
 * that became defunct (NaCl). We now have a variety of sandboxes,
 * but they don't all allow running python with arbitrary command
 * line options, so the tests have been narrowed. Also the file
 * system and permitted operations within the sandbox are now less
 * set in stone.
 *
 */
describe('Sandbox', function () {
  this.timeout(12000);

  const output: { stdout: string[], stderr: string[] } = {
    stdout: [],
    stderr: []
  };

  function capture(level: string, msg: string) {
    const match = /^Sandbox.*(stdout|stderr): (.*)$/s.exec(msg);
    if (match && level === 'info') {
      const stream = match[1] as 'stdout' | 'stderr';
      output[stream].push(match[2]);
    }
  }

  function clear() {
    output.stdout.length = 0;
    output.stderr.length = 0;
  }

  testUtils.setTmpLogLevel('warn', capture);

  beforeEach(function () {
    clear();
  });

  describe("Basic operation", function () {
    it("should echo hello world", async function () {
      const sandbox = new NSandbox({ args: [] });
      try {
        const result = await sandbox.pyCall(
          'test_echo', 'Hello world'
        );
        assert.equal(result, 'Hello world');
      } finally {
        await sandbox.shutdown();
      }
    });

    it("should handle exceptions", async function () {
      const sandbox = new NSandbox({ args: [] });
      try {
        await assert.isRejected(sandbox.pyCall(
          'test_fail', 'Hello world'
        ), /Hello world/);
        assert.deepEqual(output.stdout, []);
        const stderr = output.stderr.join('\n');
        assert.match(stderr, /Traceback \(most recent call last\):/);
        assert.match(stderr, /Exception: Hello world/);
      } finally {
        await sandbox.shutdown();
      }
    });
  });

  describe("sandbox.pyCall", function () {
    it("should invoke python functions", async function () {
      const sandbox = new NSandbox({ args: [] });
      // Startup can be noisy in logs, wait for it to be done
      // and for the sandbox to be available, then clear the logs.
      await sandbox.pyCall('test_echo', '1');
      clear();
      try {
        let value = await sandbox.pyCall("test_operation", 0, "uppercase", "hello");
        assert.equal(value, "HELLO");
        value = await sandbox.pyCall("test_operation", 0, "triple", 2.5);
        assert.equal(value, 7.5);
        assert.deepEqual(output.stdout, []);
        assert.deepEqual(output.stderr, []);
      } finally {
        await sandbox.shutdown();
      }
    });

    it("should fail when sandbox has exited", async function () {
      const sandbox = new NSandbox({ args: [] });
      try {
        // Normally pyCall should succeed.
        const value = await sandbox.pyCall("test_operation", 1.5, "uppercase", "hello");
        assert.equal(value, "HELLO");

        // Now kill the sandbox, and call again. In this case pyCall doesn't know yet that the
        // sandbox has exited, so it should fail on reading the response.
        const assertPromise = assert.isRejected(sandbox.pyCall("test_operation", 1.5, "uppercase", "shouldfail1"),
          /PipeFromSandbox is closed/,
          "When sandbox exits, pyCall should not succeed");

        await sandbox.shutdown();
        assert.equal(await timeoutReached(1000, Promise.resolve(assertPromise)), false,
          "When sandbox exits, pyCall should not hang");
        await assertPromise;

        // Now try to make another pyCall; it should fail too, but this time immediately.
        await assert.isRejected(sandbox.pyCall("test_operation", 1.5, "uppercase", "shouldfail2"),
          /PipeToSandbox is closed/,
          "When sandbox has exited, pyCall should not succeed");
      } finally {
        await sandbox.shutdown();
      }
    });

    it("should get killed if sandbox refuses to exit", async function () {
      const sandbox = new NSandbox({ args: [] });
      const expectedRejection = assert.isRejected(
        sandbox.pyCall("test_operation", 100, "uppercase", "hello"),
        /PipeFromSandbox is closed/
      );
      await sandbox.shutdown();
      await expectedRejection;
    });

    it("should be reasonably quick with big data", async function () {
      const sandbox = new NSandbox({ args: [] });
      const bigString = new Array(1000001).join("*");
      assert.equal(bigString.length, 1000000);

      try {
        let start: number;
        // Make a small call to the sandbox, to ensure if finished startup, before we start timing.
        let count = await sandbox.pyCall("test_operation", 0, "bigToSmall", "test");
        assert.equal(count, 4);
        start = Date.now();
        count = await sandbox.pyCall("test_operation", 0, "bigToSmall", bigString);
        let delta = Date.now() - start;
        assert.equal(count, 1000000);
        assert(delta < 100, "Should really be around 20ms, but took " + delta);

        start = Date.now();
        const value = await sandbox.pyCall("test_operation", 0, "smallToBig", 1000000);
        delta = Date.now() - start;
        assert(delta < 100, "Should really be around 20ms, but took " + delta);
        assert.equal(value, bigString);
      } finally {
        await sandbox.shutdown();
      }
    });
  });

  // pyodide can only do this in very specific narrow circumstances.
  describe.skip("sandbox_py.call_external", function () {
    it("should invoke exported JS functions", async function () {
      let py_code = [
        'import sandbox',
        'results = {}',
        // Simple call to the sandbox.
        'results["quick"] = sandbox.call_external("quick", 1, 2, 3)',
        // A slow call to the sandbox; the JS implementation returns a promise.
        'results["slow"] = sandbox.call_external("slow")',
        // A call to a function that throws an exception; we should see an exception.
        'try:',
        '  sandbox.call_external("bad")',
        'except Exception, e:',
        '  results["bad"] = e.message',
        // Register our own function, and call a JS function which will call back to Python.
        'sandbox.register("py_upper", lambda x: x.upper())',
        'results["complicated"] = sandbox.call_external("complicated", "py_upper", "hello")',
        // When all is done, report the results to the sandbox too.
        'sandbox.call_external("report", results)',
      ].join("\n") + "\n";

      let results: { quick: string; slow: string; bad: string; complicated: string } | undefined;
      const sandbox: NSandbox = new NSandbox({
        args: [],
        exports: {
          quick: function (a, b, c) {
            assert.equal(a, 1);
            assert.equal(b, 2);
            assert.equal(c, 3);
            return "QUICK";
          },
          slow: function () {
            return new Promise(resolve => setTimeout(() => resolve("SLOW"), 10));
          },
          bad: function () {
            throw new Error("BAD WORKS");
          },
          complicated: function (py_func, arg) {
            return sandbox.pyCall(py_func, arg);
          },
          report: function (_results) {
            results = _results;
          },
        },
      });
      await sandbox.pyCall('test_exec', py_code);

      assert.equal(results?.quick, "QUICK");
      assert.equal(results?.slow, "SLOW");
      assert.equal(results?.bad, "Error: BAD WORKS");
      assert.equal(results?.complicated, "HELLO");
      await sandbox.shutdown();
    });
  });

  describe.skip("sandbox restrictions", function () {
    let sandbox: NSandbox;
    before(function () {
      sandbox = new NSandbox({
        args: ["-c", `
import sys
sys.path.insert(0, "/grist")
import sandbox
import os, stat, socket

def test_listdir():
  return sorted(os.listdir('/'))

def test_write():
  with open("/tmp_file", "w") as f:     # This should fail
    f.write("hello\\n")
  os.remove("/tmp_file")

def test_chmod():
  s = os.stat("/test")
  os.chmod("/test", 0700)             # This should fail

def test_socket():
  socket.socket(socket.AF_INET, socket.SOCK_STREAM)   # This should fail

def test_fork():
  pid = os.fork()                       # This should fail
  if pid == 0:    # If we do succeed, the child process shouldn't keep running.
    sys.exit(0)

sandbox.register('test_listdir', test_listdir)
sandbox.register('test_write', test_write)
sandbox.register('test_chmod', test_chmod)
sandbox.register('test_socket', test_socket)
sandbox.register('test_fork', test_fork)
sandbox.run()
`]
      });
    });

    after(function () {
      return sandbox.shutdown();
    });

    // This is different for every sandbox
    it("should have no access to files outside sandbox root", async function () {
      const value = await sandbox.pyCall("test_listdir")
      assert.deepEqual(value, ['grist', 'python', 'slib', 'test', 'thirdparty']);
    });

    // May have write access in sandboxes, just not to "real" files
    it("should have no write access to files", function () {
      return sandbox.pyCall("test_write")
        .then(
          () => assert(false, "test_write should have failed"),
          (err) => assert.match(err.message, /Permission denied:.*\/tmp_file/)
        );
    });

    // May be permitted, just within a sandbox scope
    it("should not be able to chmod files", function () {
      return sandbox.pyCall("test_chmod")
        .then(
          () => assert(false, "test_chmod should have failed"),
          (err) => assert.match(err.message, /Permission denied:.*\/test/)
        );
    });

    // May be permitted, just within a sandbox scope
    it("should not be able to create sockets", function () {
      return sandbox.pyCall("test_socket")
        .then(
          () => assert(false, "test_socket should have failed"),
          (err) => assert.match(err.message, /Function not implemented/)
        );
    });

    // May be permitted, just within a sandbox scope
    it("should not be able to fork", function () {
      return sandbox.pyCall("test_fork")
        .then(
          () => assert(false, "test_socket should have failed"),
          (err) => assert.match(err.message, /Function not implemented/)
        );
    });
  });
});
