import { setGracefulCleanup } from 'tmp';
import { assert } from 'chai';
import * as path from 'path';
import * as fs from "fs";

import { NSandbox } from 'app/server/lib/NSandbox';
import { timeoutReached } from 'app/server/lib/serverUtils';
import * as testUtils from 'test/server/testUtils';

setGracefulCleanup();

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

  describe("sandbox restrictions", function () {
    let sandbox: NSandbox;
    before(function () {
      sandbox = new NSandbox({ args: []});
    });

    after(function () {
      return sandbox.shutdown();
    });

    it("should only have access to directories inside the sandbox root", async function () {
      const sandboxRoot = await sandbox.pyCall('test_get_sandbox_root');
      const sandboxDirs = await sandbox.pyCall('test_list_files', sandboxRoot, false);
      const expectedDirs = [
        '', 'imports', 'functions',
        '__pycache__', 'imports/__pycache__', 'functions/__pycache__',
        'imports/fixtures'].map(
        dir => path.join(sandboxRoot, dir)
      );
      assert.deepEqual(sandboxDirs.sort(), expectedDirs.sort());

      const emptyTmp = await sandbox.pyCall('test_list_files', "/tmp", true);
      assert.deepEqual(emptyTmp, ["/tmp"]);
    });

    it("should have no write access to sandbox files", async function () {
      // gvisor mounts the sandbox files as read-only
      const sandboxRoot = await sandbox.pyCall('test_get_sandbox_root');
      const mainFile = path.join(sandboxRoot, 'main.py');
      await assert.isRejected(
        sandbox.pyCall('test_write_file', mainFile, '# A rambunctious little edit')
      );
      const fileContents = await sandbox.pyCall('test_read_file', mainFile);
      assert.match(fileContents, /defines what sandbox functions are made available to the Node controller/);
      assert.notMatch(fileContents, /rambunctious/);
    });

    it("should have write access to some directories", async function () {
      // gvisor mounts /tmp as a tmpfs, so it can be written to but is
      // invisible to the host
      const tmpFile = '/tmp/grist-fake-file-does-not-exist';
      const testContents = 'chimpy + kiwi = <3';
      await sandbox.pyCall('test_write_file', tmpFile, testContents);
      const fileContents = await sandbox.pyCall('test_read_file', tmpFile);
      assert.equal(fileContents, testContents, 'File should be writable in the sandbox');
      assert.isFalse(fs.existsSync(tmpFile), 'File should not exist in the host OS');
    });
  });
});
