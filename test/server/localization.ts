import { setupLocale } from "app/server/localization";
import * as testUtils from "test/server/testUtils";

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { assert } from "chai";

describe("localization", function() {
  testUtils.setTmpLogLevel("error");

  let tmpDir: string;
  let coreDir: string;
  let extDir: string;
  let saasDir: string;

  const translated = { "Translators: please translate this": "translated" };

  function write(dir: string, name: string, data: any) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(data), "utf8");
  }

  beforeEach(function() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grist_locale_"));
    coreDir = path.join(tmpDir, "core");
    extDir = path.join(tmpDir, "ext");
    saasDir = path.join(tmpDir, "saas");
    write(coreDir, "en.server.json", { Server: { Hello: "Hello" } });
    write(coreDir, "en.client.json", { App: translated, Core: { Hello: "Hello" } });
  });

  afterEach(function() {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads the core directory", function() {
    const instance = setupLocale([coreDir]);
    assert.deepEqual(instance.getResourceBundle("en", "client"), {
      App: translated,
      Core: { Hello: "Hello" },
    });
  });

  it("merges files from the other directories into the core ones", function() {
    write(extDir, "en.client.json", { Ext: { Bye: "Bye" } });
    write(saasDir, "en.client.json", { Saas: { Hi: "Hi" } });
    const instance = setupLocale([coreDir, extDir, saasDir]);
    assert.deepEqual(instance.getResourceBundle("en", "client"), {
      App: translated,
      Core: { Hello: "Hello" },
      Ext: { Bye: "Bye" },
      Saas: { Hi: "Hi" },
    });
  });

  it("keeps keys that a later directory does not mention", function() {
    write(coreDir, "pl.client.json", { App: translated, Core: { Hello: "Czesc", Bye: "Pa" } });
    write(extDir, "pl.client.json", { Core: { Hello: "Czesc z ext" } });
    const instance = setupLocale([coreDir, extDir]);
    assert.deepEqual(instance.getResourceBundle("pl", "client").Core, {
      Hello: "Czesc z ext",
      Bye: "Pa",
    });
  });

  it("decides if a language is complete after merging", function() {
    // Only ext has the "Translators: please" key, but after merging it is there.
    write(coreDir, "pl.client.json", { App: {}, Core: { Hello: "Czesc" } });
    write(extDir, "pl.client.json", { App: translated });
    const instance = setupLocale([coreDir, extDir]);
    assert.deepEqual(instance.getResourceBundle("pl", "client").Core, { Hello: "Czesc" });
  });

  it("ignores a language that no file translates completely", function() {
    write(saasDir, "pl.client.json", { Saas: { Hi: "Czesc" } });
    const instance = setupLocale([coreDir, saasDir]);
    assert.isUndefined(instance.getResourceBundle("pl", "client"));
  });

  it("skips directories that do not exist, except the core one", function() {
    const instance = setupLocale([coreDir, extDir, saasDir]);
    assert.deepEqual(instance.getResourceBundle("en", "client").Core, { Hello: "Hello" });
    assert.throws(() => setupLocale([path.join(tmpDir, "missing"), extDir]), /ENOENT/);
  });

  it("replaces only the core directory with GRIST_LOCALES_DIR", function() {
    const otherCoreDir = path.join(tmpDir, "other");
    write(otherCoreDir, "en.server.json", { Server: { Hello: "Hello" } });
    write(otherCoreDir, "en.client.json", { App: translated, Core: { Hello: "Other" } });
    write(extDir, "en.client.json", { Ext: { Bye: "Bye" } });
    const oldEnv = new testUtils.EnvironmentSnapshot();
    try {
      process.env.GRIST_LOCALES_DIR = otherCoreDir;
      const instance = setupLocale([coreDir, extDir]);
      assert.deepEqual(instance.getResourceBundle("en", "client"), {
        App: translated,
        Core: { Hello: "Other" },
        Ext: { Bye: "Bye" },
      });
    } finally {
      oldEnv.restore();
    }
  });
});
