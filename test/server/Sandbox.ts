import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { makeExceptionalDocSession } from "app/server/lib/DocSession";
import { ISandbox } from "app/server/lib/ISandbox";
import { createSandbox, NSandbox } from "app/server/lib/NSandbox";
import { timeoutReached } from "app/server/lib/serverUtils";
import { createDocTools } from "test/server/docTools";
import { createTmpDir } from "test/server/docTools";
import * as testUtils from "test/server/testUtils";

import * as fs from "fs";
import * as path from "path";

import { assert } from "chai";

describe("Sandbox", function() {
  this.timeout(12000);

  const docTools = createDocTools({ });
  let seedTables: Buffer;
  let seedColumns: Buffer;
  let tmpDir: string;

  const output: { stdout: string[], stderr: string[] } = {
    stdout: [],
    stderr: [],
  };

  function capture(level: string, msg: string) {
    const match = /^Sandbox.*(stdout|stderr): (.*)$/s.exec(msg);
    if (match && level === "info") {
      const stream = match[1] as "stdout" | "stderr";
      output[stream].push(match[2]);
    }
  }

  function clear() {
    output.stdout.length = 0;
    output.stderr.length = 0;
  }

  testUtils.setTmpLogLevel("warn", capture);

  before(async function() {
    tmpDir = await createTmpDir();
    const doc = new ActiveDoc(docTools.getDocManager(), "xxx");
    const session = makeExceptionalDocSession("system");
    await doc.loadDoc(session, {
      forceNew: true,
      skipInitialTable: false,
      useExisting: false,
    });
    seedTables = await doc.docStorage.fetchTable("_grist_Tables");
    seedColumns = await doc.docStorage.fetchTable("_grist_Tables_column");
    await doc.shutdown();
  });

  async function prepareFormula(sandbox: ISandbox) {
    await sandbox.pyCall(
      "load_meta_tables", seedTables, seedColumns,
    );
    await sandbox.pyCall("apply_user_actions", [
      ["UpdateRecord", "_grist_Tables_column", 2, {
        isFormula: true,
        formula: "$id",
      }],
      ["AddRecord", "Table1", null, {}],
    ]);
  }

  async function tryFormula(sandbox: ISandbox, formula: string): Promise<any> {
    await sandbox.pyCall("apply_user_actions", [
      ["UpdateRecord", "_grist_Tables_column", 2, {
        isFormula: true,
        formula,
      }],
    ]);
    const { result } = await sandbox.pyCall("evaluate_formula", "Table1", "A", 1);
    return result;
  }

  beforeEach(function() {
    clear();
  });

  describe("Basic operation", function() {
    it("should echo hello world", async function() {
      const sandbox = createSandbox("sandboxed", {});
      try {
        const result = await sandbox.pyCall(
          "test_echo", "Hello world",
        );
        assert.equal(result, "Hello world");
      } finally {
        await sandbox.shutdown();
      }
    });

    it("should handle exceptions", async function() {
      const sandbox = createSandbox("sandboxed", {});
      try {
        await assert.isRejected(sandbox.pyCall(
          "test_fail", "Hello world",
        ), /Hello world/);
        assert.deepEqual(output.stdout, []);
        const stderr = output.stderr.join("\n");
        assert.match(stderr, /Traceback \(most recent call last\):/);
        assert.match(stderr, /Exception: Hello world/);
      } finally {
        await sandbox.shutdown();
      }
    });
  });

  describe("sandbox.pyCall", function() {
    it("should invoke python functions", async function() {
      const sandbox = createSandbox("sandboxed", {});
      // Startup can be noisy in logs, wait for it to be done
      // and for the sandbox to be available, then clear the logs.
      await sandbox.pyCall("test_echo", "1");
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

    it("should fail when sandbox has exited", async function() {
      const sandbox = createSandbox("sandboxed", {});
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

    it("should get killed if sandbox refuses to exit", async function() {
      const sandbox = createSandbox("sandboxed", {});
      const expectedRejection = assert.isRejected(
        sandbox.pyCall("test_operation", 100, "uppercase", "hello"),
        /PipeFromSandbox is closed/,
      );
      await sandbox.shutdown();
      await expectedRejection;
    });

    it("should be reasonably quick with big data", async function() {
      const sandbox = createSandbox("sandboxed", {});
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

  describe("sandbox restrictions", function() {
    let sandbox: NSandbox;
    beforeEach(async function() {
      sandbox = createSandbox("sandboxed", {}) as NSandbox;
      await prepareFormula(sandbox);
    });

    afterEach(function() {
      return sandbox.shutdown();
    });

    it("should only have access to directories inside the sandbox root", async function() {
      const sandboxRoot = await sandbox.pyCall("test_get_sandbox_root");
      const sandboxDirs = await sandbox.pyCall("test_list_files", sandboxRoot, false);
      const hostDirs = getSubDirs(`${testUtils.appRoot}/sandbox/grist`, sandboxRoot);
      assert.deepEqual(sandboxDirs.sort(), hostDirs.sort());

      if (sandbox.getFlavor() === "macSandboxExec") {
        // Mac sandbox doesn't allow this kind of tmpfs overlay. End
        // this test early.
        return;
      }
      const emptyTmp = await sandbox.pyCall("test_list_files", "/tmp", true);
      assert.deepEqual(emptyTmp, ["/tmp"]);
    });

    it("should have write access to some directories", async function() {
      if (sandbox.getFlavor() === "macSandboxExec") {
        // Mac sandbox doesn't allow this kind of tmpfs overlay.
        this.skip();
      }
      // gvisor mounts /tmp as a tmpfs, so it can be written to but is
      // invisible to the host
      const tmpFile = "/tmp/grist-fake-file-does-not-exist";
      const testContents = "chimpy + kiwi = <3";
      await sandbox.pyCall("test_write_file", tmpFile, testContents);
      const fileContents = await sandbox.pyCall("test_read_file", tmpFile);
      assert.equal(fileContents, testContents, "File should be writable in the sandbox");
      assert.isFalse(fs.existsSync(tmpFile), "File should not exist in the host OS");
    });

    /**
     * This test was added because the pyodide "sandbox" is built on emscripten
     * and exposes spawnSync via os.system
     *   https://github.com/emscripten-core/emscripten/blob/a6bc307592f189288215ea539ec0d1126a0daa72/src/lib/libcore.js#L355
     * For pyodide, we would now expect the os.system to fail since pyodide is
     * now run via deno without the --allow-run command. If it were to succeed,
     * it shouldn't have file access since --allow-read and --allow-write permissions
     * are dropped.
     *
     * Other sandboxes should also fail, although the details why will vary.
     * gvisor will allow running a process, but it will be sandboxed.
     */
    it("should not have write access to tmpDir via os.system", async function() {
      const fname = path.join(tmpDir, "test.txt");
      await tryFormula(sandbox, `import os; os.system('echo "hello" > ${fname}')`);
      assert.throw(() => fs.statSync(fname));
    });

    it("should not have read access to tmpDir via os.system", async function() {
      const fname = path.join(tmpDir, "test.txt");
      const secretContent = "secret content";
      fs.writeFileSync(fname, secretContent);
      const result = await tryFormula(sandbox, `import os; os.system('exit $(wc -c < ${fname})')`);
      // The exit code from os.system is in the upper byte.
      const count = result >> 8;
      assert.notEqual(count, secretContent.length);
    });

    it("should not have write access to mapped directories", async function() {
      const sandboxRoot = await sandbox.pyCall("test_get_sandbox_root");

      // First, check we see matching files where we expect, using fs.
      const mainPyPath = getSandboxPaths(sandboxRoot, "main.py");
      const sandboxContent = await sandbox.pyCall("test_read_file", mainPyPath.sandbox);
      const hostContent = fs.readFileSync(mainPyPath.host, "utf8");
      assert.equal(sandboxContent, hostContent);
      assert.isAbove(sandboxContent.length, 10);

      // Try to add a file using os.system.
      const testPath = getSandboxPaths(sandboxRoot, "test_write_via_os_system.txt");
      await tryFormula(sandbox, `import os; os.system('echo "hello" > ${testPath.sandbox}')`);

      // Verify the file doesn't exist on the host in the obvious places.
      assert.isFalse(fs.existsSync(testPath.host), "File should not exist on host");
      assert.isFalse(fs.existsSync(testPath.sandbox), "File should not even exist on confused host");

      // Try to add a file using fs.
      await tryFormula(sandbox, `open("${testPath.sandbox}", "w").write("hello")`);

      // Verify the file still doesn't exist.
      assert.isFalse(fs.existsSync(testPath.host), "File should not exist on host");
      assert.isFalse(fs.existsSync(testPath.sandbox), "File should not even exist on confused host");

      // Try to change a file using os.system.
      // Try both with sandbox and host paths.
      await tryFormula(sandbox, `import os; os.system('echo "hello" > ${mainPyPath.sandbox}')`);
      await tryFormula(sandbox, `import os; os.system('echo "hello" > ${mainPyPath.host}')`);

      // Verify the change didn't take effect.
      let hostContentRechecked = fs.readFileSync(mainPyPath.host, "utf8");
      assert.equal(hostContent, hostContentRechecked);

      // Try to change a file using fs.
      await tryFormula(sandbox, `open("${mainPyPath.sandbox}", "w").write("hello")`);

      // Verify the change didn't take effect.
      hostContentRechecked = fs.readFileSync(mainPyPath.host, "utf8");
      assert.equal(hostContent, hostContentRechecked);
    });

    it("should not see files created in tmpDir on host", async function() {
      const fname = "host_created_file.txt";
      const testFile = path.join(tmpDir, fname);
      const secretContent = "secret";

      // Create a file on the host
      fs.writeFileSync(testFile, secretContent);
      try {
        let sandboxContent = "";
        try {
          sandboxContent = await sandbox.pyCall("test_read_file", path.join("/tmp", fname));
        } catch (e) {
          // File not found or PermissionError is acceptable.
          if (!String(e).match(/FileNotFoundError/) &&
            !String(e).match(/PermissionError/)) {
            throw e;
          }
        }
        assert.lengthOf(sandboxContent, 0);
      } finally {
        fs.unlinkSync(testFile);
      }
    });

    // Pyodide specific test. Should fail for pyodide if GRIST_PYODIDE_SKIP_DENO=1 is set.
    // Should succeed with deno, and of course in all other sandboxes.
    it("should not have write access via emscripten_run_script_string", async function() {
      const testFile = path.join(tmpDir, "emscripten_test.txt");

      try {
        // Try to write using emscripten_run_script_string
        const result = await tryFormula(sandbox, `
import sys
from ctypes import cdll, c_char_p
libc = cdll.LoadLibrary(None)
libc.emscripten_run_script_string.argtypes = [c_char_p]
libc.emscripten_run_script_string.restype = c_char_p
libc.emscripten_run_script_string(b"require('fs').writeFileSync('${testFile}', 'hello')")
return 'done'
`);
        if (!result.match("done") &&
          !result.match(/undefined symbol: emscripten_run_script_string/) &&
          !result.match(/symbol not found/)) {
          throw new Error("unexpected result " + String(result));
        }
      } catch (e) {
        if (
          // this is how pyodide sandbox should fail.
          !String(e).match(/NotCapable: Requires write access/)
        ) {
          throw e;
        }
      }

      // Verify the file doesn't exist
      assert.isFalse(fs.existsSync(testFile), "emscripten_run_script_string should not allow file writes");
    });

    // Note: this test may modify the sandboxed main.py in place
    it("pyodide writes to sandbox files should not survive outside the sandbox", async function() {
      if (sandbox.getFlavor() !== "pyodide") {
        this.skip();
      }
      try {
        const sandboxRoot = await sandbox.pyCall("test_get_sandbox_root");
        const mainFile = path.join(sandboxRoot, "main.py");

        // pyodide works on a copy of the original files
        await sandbox.pyCall("test_write_file", mainFile, "# A rambunctious little edit");
        const fileContentsInSandbox = await sandbox.pyCall("test_read_file", mainFile);
        assert.match(fileContentsInSandbox, /defines what sandbox functions are made available to the Node controller/);
        assert.match(fileContentsInSandbox, /rambunctious/);

        const fileContents = fs.readFileSync(`./sandbox/${mainFile}`).toString();
        assert.match(fileContents, /defines what sandbox functions are made available to the Node controller/);
        assert.notMatch(fileContents, /rambunctious/);
      } catch (e) {
        // Writes may fail entirely.
        if (
          !String(e).match(/NotCapable: Requires write access/)
        ) {
          throw e;
        }
      }
    });

    // Note: this test may modify the sandboxed main.py in place
    it("gvisor and macSandboxExec should have no write access to sandbox files", async function() {
      if (!["gvisor", "macSandboxExec"].includes(sandbox.getFlavor())) {
        this.skip();
      }
      const sandboxRoot = await sandbox.pyCall("test_get_sandbox_root");
      const mainFile = path.join(sandboxRoot, "main.py");

      // gvisor mounts the sandbox files as read-only
      await assert.isRejected(
        sandbox.pyCall("test_write_file", mainFile, "# A rambunctious little edit"),
      );
      const fileContents = await sandbox.pyCall("test_read_file", mainFile);
      assert.match(fileContents, /defines what sandbox functions are made available to the Node controller/);
      assert.notMatch(fileContents, /rambunctious/);
    });

    it("gvisor and pyodide should fail after unreasonnable number of calls to os.fork()", async function() {
      if (!["gvisor", "pyodide"].includes(sandbox.getFlavor())) {
        this.skip();
      }

      const result = await tryFormula(sandbox, `
import os
os.fork()
os.fork()
return str(os.fork())
`);
      if (!result.match(/BlockingIOError/) &&
        !result.match(/OSError/)) {
        throw new Error("unexpected result " + String(result));
      }
    });
  });

  describe("pyodide", function() {
    before(function() {
      if (process.env.GRIST_SANDBOX_FLAVOR !== "pyodide") {
        this.skip();
      }
    });

    describe("execute via external node command", function() {
      let oldEnv: testUtils.EnvironmentSnapshot;
      before(function() {
        oldEnv = new testUtils.EnvironmentSnapshot();
        process.env.GRIST_SANDBOX = process.execPath;
        // Using node executable, not deno executable
        process.env.GRIST_PYODIDE_SKIP_DENO = "true";
      });

      after(function() {
        oldEnv?.restore();
      });

      it("can create a pyodide sandbox by spawning", async function() {
        const sandbox = createSandbox("sandboxed", {});
        try {
          const result = await sandbox.pyCall(
            "test_echo", "Hello world",
          );
          assert.equal(result, "Hello world");
        } finally {
          await sandbox.shutdown();
        }
      });
    });
  });
});

function getSubDirs(dir: string, root: string): string[] {
  // Walk directories but replace the root with the given root
  return [root, ...fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) {
      return [];
    }
    const full = path.join(dir, entry.name);
    const mapped = path.join(root, entry.name);
    return getSubDirs(full, mapped);
  })];
}

function getSandboxPaths(sandboxRoot: string, fname: string) {
  return {
    sandbox: path.join(sandboxRoot, fname),
    host: path.join(testUtils.appRoot, "sandbox/grist", fname),
  };
}
