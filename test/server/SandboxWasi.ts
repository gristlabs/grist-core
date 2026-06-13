import { createConcreteSandbox } from "app/server/lib/NSandbox";
import { checkWasiAvailable } from "app/server/lib/SandboxWasi";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";

/**
 * Functional test for the experimental "wasi" sandbox flavor. The wasm runtime
 * is fetched on demand (`make -C sandbox/wasi setup`) and is not committed, so
 * this whole suite skips when the runtime is not installed (e.g. in CI).
 */
describe("SandboxWasi", function() {
  this.timeout(20000);

  testUtils.setTmpLogLevel("warn");

  before(function() {
    const check = checkWasiAvailable();
    if (!check.available) {
      this.skip();
    }
  });

  it("runs the data engine and answers calls", async function() {
    const sandbox = createConcreteSandbox("wasi", { preferredPythonVersion: "3" });
    try {
      // get_version returns the schema version number, proving the engine booted.
      const version = await sandbox.pyCall("get_version");
      assert.isNumber(version);

      // A round-trip through the marshal pipe over stdin/stdout.
      assert.equal(await sandbox.pyCall("test_echo", "hello wasi"), "hello wasi");

      // Exercise a real formula recalc end-to-end.
      await sandbox.pyCall("load_empty");
      await sandbox.pyCall("apply_user_actions", [
        ["AddTable", "T", [
          { id: "A", type: "Numeric", isFormula: false, formula: "" },
          { id: "B", type: "Any", isFormula: true, formula: "$A * 2 + 1" },
        ]],
        ["AddRecord", "T", null, { A: 21 }],
      ]);
      const table = await sandbox.pyCall("fetch_table", "T");
      const columns = table[3];
      assert.equal(columns.B[0], 43);
    } finally {
      await sandbox.shutdown();
    }
  });

  it("sees the engine at its preopened guest path", async function() {
    const sandbox = createConcreteSandbox("wasi", { preferredPythonVersion: "3" });
    try {
      // The engine directory is mapped to /grist inside the guest filesystem.
      const root = await sandbox.pyCall("test_get_sandbox_root");
      assert.include(root, "grist");
    } finally {
      await sandbox.shutdown();
    }
  });
});
