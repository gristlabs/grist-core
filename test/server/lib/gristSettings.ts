import { appSettings } from "app/server/lib/AppSettings";
import { getEdition, getEditionSource } from "app/server/lib/gristSettings";
import * as testUtils from "test/server/testUtils";
import { EnvironmentSnapshot } from "test/server/testUtils";

import { assert } from "chai";

describe("gristSettings", function() {
  testUtils.setTmpLogLevel("error");

  let oldEnv: EnvironmentSnapshot;

  beforeEach(async function() {
    oldEnv = new EnvironmentSnapshot();
    delete process.env.GRIST_SERVER_EDITION;
    delete process.env.GRIST_FORCE_ENABLE_ENTERPRISE;
    setDbEdition(undefined);
  });

  afterEach(async function() {
    oldEnv.restore();
    setDbEdition(undefined);
  });

  function setDbEdition(value: string | undefined): void {
    appSettings.setEnvVars(value === undefined ? {} : { GRIST_SERVER_EDITION: value });
    getEdition.cache.clear();
    getEditionSource.cache.clear();
  }

  describe("getEdition", function() {
    it("is community on a fresh installation", function() {
      assert.equal(getEdition(), "community");
      assert.isUndefined(getEditionSource());
    });

    for (const [label, value] of [["unusable", "nonsense"], ["empty", ""]]) {
      it(`ignores an ${label} stored value, falling back to the default edition`, function() {
        setDbEdition(value);
        assert.equal(getEdition(), "community");
        assert.isUndefined(getEditionSource());
      });

      it(`ignores an ${label} value in the environment, falling back to the default edition`, function() {
        process.env.GRIST_SERVER_EDITION = value;
        assert.equal(getEdition(), "community");
        assert.isUndefined(getEditionSource());
      });
    }

    it("reads the database value", function() {
      setDbEdition("full");
      assert.equal(getEdition(), "full");
      assert.equal(getEditionSource(), "db");
    });

    it("prefers the environment value over the database value", function() {
      process.env.GRIST_SERVER_EDITION = "community";
      setDbEdition("full");
      assert.equal(getEdition(), "community");
      assert.equal(getEditionSource(), "env");
    });
  });

  describe("GRIST_FORCE_ENABLE_ENTERPRISE", function() {
    it("maps an affirmative value to full", function() {
      process.env.GRIST_FORCE_ENABLE_ENTERPRISE = "true";
      assert.equal(getEdition(), "full");
    });

    for (const value of ["false", "0", ""]) {
      it(`does not force with ${JSON.stringify(value)}, leaving other sources in charge`, function() {
        process.env.GRIST_FORCE_ENABLE_ENTERPRISE = value;
        setDbEdition("full");
        assert.equal(getEdition(), "full");
        assert.equal(getEditionSource(), "db");
      });
    }

    it("does not force the community edition on its own", function() {
      process.env.GRIST_FORCE_ENABLE_ENTERPRISE = "false";
      assert.equal(getEdition(), "community");
      assert.isUndefined(getEditionSource());
    });

    it("takes precedence over GRIST_SERVER_EDITION", function() {
      process.env.GRIST_FORCE_ENABLE_ENTERPRISE = "true";
      process.env.GRIST_SERVER_EDITION = "community";
      assert.equal(getEdition(), "full");
      assert.equal(getEditionSource(), "env");
    });

    it("takes precedence over the database value", function() {
      process.env.GRIST_FORCE_ENABLE_ENTERPRISE = "true";
      setDbEdition("community");
      assert.equal(getEdition(), "full");
      assert.equal(getEditionSource(), "env");
    });
  });
});
