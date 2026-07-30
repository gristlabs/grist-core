import { ActivationsManager } from "app/gen-server/lib/ActivationsManager";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { appSettings } from "app/server/lib/AppSettings";
import { updateDb } from "app/server/lib/dbUtils";
import { getEdition, getEditionSource } from "app/server/lib/gristSettings";
import { initializeAppSettings } from "app/server/lib/initializeAppSettings";
import { Deps } from "app/server/lib/migrateConfigFileEdition";
import { createInitialDb, removeConnection, setUpDB } from "test/gen-server/seed";
import * as testUtils from "test/server/testUtils";
import { EnvironmentSnapshot } from "test/server/testUtils";

import * as os from "os";
import * as path from "path";

import { assert } from "chai";
import * as fse from "fs-extra";
import * as sinon from "sinon";

describe("initializeAppSettings", function() {
  this.timeout(60000);
  testUtils.setTmpLogLevel("error");

  const sandbox = sinon.createSandbox();

  let oldEnv: EnvironmentSnapshot;
  let instRoot: string;
  let db: HomeDBManager;
  let activations: ActivationsManager;

  before(async function() {
    oldEnv = new EnvironmentSnapshot();
    setUpDB(this);
    db = new HomeDBManager();
    await db.connect();
    await createInitialDb(db.connection, false);
    await updateDb(db.connection);
    activations = new ActivationsManager(db);
  });

  after(async function() {
    await removeConnection();
    oldEnv.restore();
  });

  beforeEach(async function() {
    delete process.env.GRIST_SERVER_EDITION;
    delete process.env.GRIST_FORCE_ENABLE_ENTERPRISE;
    instRoot = await fse.mkdtemp(path.join(os.tmpdir(), "grist-migrate-edition-"));
    process.env.GRIST_INST_DIR = instRoot;
    await activations.updateEnvVars({ GRIST_SERVER_EDITION: null });
    resetAppSettings();
  });

  afterEach(async function() {
    sandbox.restore();
    resetAppSettings();
    await fse.remove(instRoot).catch(() => undefined);
  });

  function resetAppSettings(): void {
    appSettings.setEnvVars({});
    getEdition.cache.clear();
    getEditionSource.cache.clear();
  }

  async function writeConfigFile(contents: string): Promise<void> {
    await fse.writeFile(path.join(instRoot, "config.json"), contents);
  }

  async function writeConfigFileEdition(edition: string): Promise<void> {
    await writeConfigFile(JSON.stringify({ version: "1", edition }));
  }

  async function getStoredEdition(): Promise<string | undefined> {
    return (await activations.current()).prefs?.envVars?.GRIST_SERVER_EDITION;
  }

  it("migrates the full edition from the legacy config file", async function() {
    await writeConfigFileEdition("enterprise");
    await initializeAppSettings();

    assert.equal(await getStoredEdition(), "full");
    assert.equal(getEdition(), "full");
    assert.equal(getEditionSource(), "db");
  });

  it("migrates the community edition from the legacy config file", async function() {
    await writeConfigFileEdition("core");
    await initializeAppSettings();

    assert.equal(await getStoredEdition(), "community");
    assert.equal(getEdition(), "community");
    assert.equal(getEditionSource(), "db");
  });

  it("leaves other env vars in the activation record alone", async function() {
    const before = (await activations.current()).prefs?.envVars || {};
    assert.isString(before.GRIST_BOOT_KEY);
    await writeConfigFileEdition("enterprise");
    await initializeAppSettings();
    const after = (await activations.current()).prefs?.envVars || {};

    assert.equal(after.GRIST_BOOT_KEY, before.GRIST_BOOT_KEY);
    assert.equal(after.GRIST_IN_SERVICE, before.GRIST_IN_SERVICE);
  });

  it("does not migrate the edition if GRIST_SERVER_EDITION is set in the db", async function() {
    await activations.updateEnvVars({ GRIST_SERVER_EDITION: "community" });
    await writeConfigFileEdition("enterprise");
    const readFileSync = sandbox.spy(Deps, "readFileSync");
    await initializeAppSettings();

    assert.isFalse(readFileSync.called);
    assert.equal(await getStoredEdition(), "community");
    assert.equal(getEdition(), "community");
  });

  it("migrates the edition if GRIST_SERVER_EDITION is set in the environment", async function() {
    process.env.GRIST_SERVER_EDITION = "community";
    await writeConfigFileEdition("enterprise");
    await initializeAppSettings();

    assert.equal(await getStoredEdition(), "full");
    assert.equal(getEdition(), "community");
    assert.equal(getEditionSource(), "env");
  });

  it("does not migrate the edition again after the first migration", async function() {
    await writeConfigFileEdition("enterprise");
    await initializeAppSettings();

    assert.equal(await getStoredEdition(), "full");

    await activations.updateEnvVars({ GRIST_SERVER_EDITION: "community" });
    resetAppSettings();
    await initializeAppSettings();

    assert.equal(await getStoredEdition(), "community");
    assert.equal(getEdition(), "community");
  });

  for (const [label, contents] of [
    ["is missing"],
    ["is malformed", "{ not json"],
    ["has no edition", JSON.stringify({ version: "1" })],
    ["has an invalid edition", JSON.stringify({ version: "1", edition: "invalid" })],
  ]) {
    it(`does not migrate the editon when the legacy config file ${label}`, async function() {
      if (contents) { await writeConfigFile(contents); }
      await initializeAppSettings();

      assert.isUndefined(await getStoredEdition());
      assert.equal(getEdition(), "community");
      assert.isUndefined(getEditionSource());
    });
  }

  it("does not migrate the edition when the legacy config file can't be read", async function() {
    sandbox.stub(Deps, "readFileSync").throws(Object.assign(new Error("nope"), { code: "EACCES" }));
    await initializeAppSettings();

    assert.isUndefined(await getStoredEdition());
    assert.equal(getEdition(), "community");
  });
});
