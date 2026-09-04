import { cleanEnv } from "app/server/lib/serverUtils";

import { spawnSync } from "child_process";

import { assert } from "chai";

/**
 * child_process builds a child's environment by iterating the env object with `for..in`,
 * which walks the prototype chain and so includes inherited enumerable properties, not
 * only the object's own variables. cleanEnv() copies the own keys onto a null-prototype
 * object so an inherited property cannot reach a spawned subprocess.
 */
describe("cleanEnv", function() {
  const MARKER = "GRIST_TEST_INHERITED_MARKER";
  const OWN = "GRIST_TEST_OWN_MARKER";

  // An env whose MARKER is inherited rather than own, as a polluted Object.prototype would
  // provide. (Object.prototype itself is non-extensible in server processes; see lockdown.ts.)
  function envWithInherited(): NodeJS.ProcessEnv {
    return Object.assign(Object.create({ [MARKER]: "leaked" }), { PATH: process.env.PATH });
  }

  function childSees(env: any, name: string): string {
    return spawnSync(process.execPath,
      ["-e", `process.stdout.write(String(process.env.${name}))`],
      { env }).stdout.toString();
  }

  it("does not pass inherited properties to the child", function() {
    assert.equal(childSees(cleanEnv(envWithInherited()), MARKER), "undefined");
  });

  it("passes the environment's own variables to the child", function() {
    assert.equal(childSees(cleanEnv({ [OWN]: "kept", PATH: process.env.PATH }), OWN), "kept");
  });

  it("defaults to process.env", function() {
    process.env[OWN] = "kept";
    try {
      assert.equal(childSees(cleanEnv(), OWN), "kept");
    } finally {
      delete process.env[OWN];
    }
  });

  it("preserves the environment's own variables", function() {
    const env = cleanEnv({ PYTHONPATH: "x", FOO: "bar" });
    assert.equal((env as any).PYTHONPATH, "x");
    assert.equal((env as any).FOO, "bar");
  });

  it("returns an object with no prototype", function() {
    assert.equal(Object.getPrototypeOf(cleanEnv({ FOO: "bar" })), null);
    assert.equal(Object.getPrototypeOf(cleanEnv()), null);
  });

  it("control: a plain object would forward an inherited property", function() {
    assert.equal(childSees(envWithInherited(), MARKER), "leaked");
  });
});
