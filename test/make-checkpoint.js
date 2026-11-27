/**
 * Makes a sandbox checkpoint before any test runs, when GRIST_SANDBOX_FLAVOR is
 * one that uses them. Otherwise each process would make its own the first time
 * it wanted a sandbox, within whichever test that happened to be. Test servers
 * started as separate processes find it through GRIST_CHECKPOINT.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const flavor = process.env.GRIST_SANDBOX_FLAVOR;
let tmpDir;

exports.mochaHooks = {
  async beforeAll() {
    if (!["gvisor", "pyodide"].includes(flavor) || process.env.GRIST_CHECKPOINT === "none") {
      return;
    }
    // makeCheckpoint has its own time limit.
    this.timeout(0);
    if (!process.env.GRIST_CHECKPOINT) {
      tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "grist-test-checkpoint-")));
      process.env.GRIST_CHECKPOINT = tmpDir;
    }
    const { makeCheckpoint } = require("app/server/lib/NSandbox");
    await makeCheckpoint(flavor, process.env.GRIST_CHECKPOINT);
  },
  afterAll() {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    }
  },
};
