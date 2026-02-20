/**
 * Tests env var flags that affect org creation and viewing:
 * - GRIST_ORG_CREATION_ANYONE - Checks this disables org creation by non-admins
 * - GRIST_PERSONAL_ORGS - Checks this disables personal org creation
 *
 * Tests only run using merged server (as they don't utilise doc workers)
 */

import {
  getAnonPlaygroundEnabled,
  getCanAnyoneCreateOrgs,
  getPersonalOrgsEnabled,
} from "app/server/lib/gristSettings";
import { configForApiKey } from "test/gen-server/testUtils";
import {
  addAllScenarios,
  makeUserApi,
  ORG_NAME,
  TestContext,
} from "test/server/lib/docapi/helpers";
import * as testUtils from "test/server/testUtils";
import { EnvironmentSnapshot } from "test/server/testUtils";

import axios from "axios";
import { assert } from "chai";

describe("DocApiOrgLimitFlags", function() {
  this.timeout(30000);
  testUtils.setTmpLogLevel("error");

  describe("Personal orgs", function() {
    addAllScenarios(addPersonalOrgLimitTests, "docapi-personal orgs disabled", {
      extraEnv: {
        GRIST_TEST_LOGIN: "1",
        GRIST_PERSONAL_ORGS: "false",
      },
    });
  });

  describe("Team orgs", function() {
    addAllScenarios(addTeamOrgLimitTests, "docapi-team org creation disabled", {
      extraEnv: {
        GRIST_ORG_CREATION_ANYONE: "false",
      },
    });
  });

  describe("Org creation setting default values", function() {
    let oldEnv: EnvironmentSnapshot;
    before(async function() {
      oldEnv = new EnvironmentSnapshot();
    });

    after(async function() {
      oldEnv.restore();
    });

    it("GRIST_ORG_CREATION_ANYONE sets the default values of GRIST_PERSONAL_ORGS and GRIST_ANON_PLAYGROUND", () => {
      process.env.GRIST_ORG_CREATION_ANYONE = "true";
      delete process.env.GRIST_PERSONAL_ORGS;
      delete process.env.GRIST_ANON_PLAYGROUND;
      assert.equal(getCanAnyoneCreateOrgs(), true);
      assert.equal(getAnonPlaygroundEnabled(), true);
      assert.equal(getPersonalOrgsEnabled(), true);

      process.env.GRIST_ORG_CREATION_ANYONE = "false";
      assert.equal(getCanAnyoneCreateOrgs(), false);
      assert.equal(getAnonPlaygroundEnabled(), false);
      assert.equal(getPersonalOrgsEnabled(), false);
    });
  });
});

function addPersonalOrgLimitTests(getCtx: () => TestContext) {
  it("should not create personal orgs for users", async () => {
    const { homeUrl } = getCtx();
    // Need to manually login - adding a user to seed.ts isn't enough to test this, as it won't result
    // in a personal org being created when we need it to be.
    const loginResponse = await axios.get(new URL("/test/login", homeUrl).toString(), {
      params: {
        username: "test_personal_org_disabling@getgrist.com",
        name: "Test personal org disabling",
      },
    });
    const apiKeyResponse = await axios.post(
      new URL("/api/profile/apikey", homeUrl).toString(),
      // Needed in case this test runs multiple times against the same DB (e.g. merged server + separate servers)
      { force: true },
      {
        // Copy cookies from login so we're authorized to create an actual API key
        headers: { cookie: loginResponse.headers["set-cookie"] },
        withCredentials: true,
      },
    );

    const apiKey = apiKeyResponse.data;
    const newUserApi = makeUserApi(homeUrl, ORG_NAME, configForApiKey(apiKey));
    const id = (await newUserApi.getUserProfile()).id;
    assert.isNumber(id);
    const orgs = await newUserApi.getOrgs();
    const personalOrg = orgs.find(org => org.owner?.id === id);
    assert.isUndefined(personalOrg);
  });
}

function addTeamOrgLimitTests(getCtx: () => TestContext) {
  it("prevents non-admins creating team orgs", async function() {
    const { homeUrl, chimpy } = getCtx();
    const chimpyApi = makeUserApi(homeUrl, ORG_NAME, chimpy);
    await assert.isRejected(chimpyApi.newOrg({ name: "New org should fail" }), "403: Forbidden");
  });
}
