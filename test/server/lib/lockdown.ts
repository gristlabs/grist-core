import { createTmpDir } from "test/server/docTools";

import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";

import { assert } from "chai";
import * as fse from "fs-extra";

const execFileAsync = promisify(execFile);

// Prints the process's __proto__ protection state.
const PROBE = `
  console.log(Object.hasOwn(Object.prototype, "__proto__") ? "UNPROTECTED" : "DELETED");
`;

async function nodeOutput(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, args, { env });
  return stdout.trim();
}

describe("lockdown", function() {
  this.timeout(30000);

  it("importing FlexServer closes both routes to Object.prototype", async function() {
    const flexPath = require.resolve("app/server/lib/FlexServer");
    const out = await nodeOutput(["-e", `
      require(${JSON.stringify(flexPath)});
      ${PROBE}
      try { ({})["constructor"]["prototype"]["polluted"] = 1; } catch (e) {}
      console.log("polluted" in {} ? "POLLUTED" : "SEALED");
    `], { ...process.env, NODE_OPTIONS: "" });
    assert.equal(out, "DELETED\nSEALED");
  });

  it("does not slow down hot paths", async function() {
    // Changes to intrinsics can disable V8's fast paths: an accessor on
    // Array.prototype[Symbol.iterator] made array spread 30x slower, and any change to
    // RegExp.prototype's extensibility makes split/replace/match on strings 10x slower.
    // Time both in a hardened process and in a plain one.
    const lockdownPath = require.resolve("app/server/lib/lockdown");
    const workload = `
      const arr = Array.from({ length: 1000 }, (_, i) => i);
      const str = "a,b;c d,".repeat(100);
      function time(fn) {
        for (let i = 0; i < 2000; i++) { fn(); }
        const start = process.hrtime.bigint();
        for (let i = 0; i < 20000; i++) { fn(); }
        return Number(process.hrtime.bigint() - start) / 1e6;
      }
      console.log(JSON.stringify({
        spread: time(() => [...arr]),
        split: time(() => str.split(/[,; ]/)),
      }));
    `;
    const env = { ...process.env, NODE_OPTIONS: "" };
    const plain = JSON.parse(await nodeOutput(["-e", workload], env));
    const hardened = JSON.parse(await nodeOutput(["-e", `require(${JSON.stringify(lockdownPath)}); ${workload}`], env));
    for (const op of Object.keys(plain)) {
      assert.isBelow(hardened[op] / plain[op], 5, `${op}: hardened ${hardened[op]}ms vs plain ${plain[op]}ms`);
    }
  });

  describe("RestartShell forked children", function() {
    let wrapper: string;

    // Check that the --disable-proto protection applies to RestartShell's children.
    // We use a probe child that imports nothing from Grist, so it is
    // protected only by inheriting the node flag, whichever way it was passed.
    before(async function() {
      const probeScript = path.join(await createTmpDir(), "probeChild.js");
      await fse.writeFile(probeScript, `${PROBE}\nprocess.send({ action: "ready" });\n`);
      const shellPath = require.resolve("app/server/lib/RestartShell");
      wrapper = `
        require(${JSON.stringify(shellPath)})
          .runRestartShell({ publicPort: 0, childEntryPoint: ${JSON.stringify(probeScript)} })
          .then((shell) => shell.shutdown())
          .then(() => process.exit(0));
      `;
    });

    it("inherit the flag passed as argv", async function() {
      const out = await nodeOutput(["--disable-proto=delete", "-e", wrapper],
        { ...process.env, NODE_OPTIONS: "" });
      assert.include(out, "DELETED");
      assert.notInclude(out, "UNPROTECTED");
    });

    it("inherit the flag passed via NODE_OPTIONS", async function() {
      const out = await nodeOutput(["-e", wrapper],
        { ...process.env, NODE_OPTIONS: "--disable-proto=delete" });
      assert.include(out, "DELETED");
      assert.notInclude(out, "UNPROTECTED");
    });

    it("control: no protection without the flag", async function() {
      const out = await nodeOutput(["-e", wrapper],
        { ...process.env, NODE_OPTIONS: "" });
      assert.include(out, "UNPROTECTED");
      assert.notInclude(out, "DELETED");
    });
  });
});
