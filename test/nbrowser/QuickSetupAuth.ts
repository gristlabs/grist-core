import { expandProviderList } from "test/nbrowser/AdminPanelTools";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("QuickSetupAuth", function() {
  this.timeout("2m");
  setupTestSuite();
  gu.bigScreen();

  let oldEnv: testUtils.EnvironmentSnapshot;
  const user = gu.translateUser("user1");

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_DEFAULT_EMAIL = user.email;
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";
    await server.restart();
  });

  after(async function() {
    oldEnv.restore();
    await server.restart(true);
  });

  async function navigateToAuthStep() {
    await server.simulateLogin(user.name, user.email, "docs");
    await driver.get(`${server.getHost()}/admin/setup`);
    // Click the "Authentication" step label.
    await driver.findContentWait("button", /Authentication/, 2000).click();
  }

  it("should show auth section on the Authentication step", async function() {
    await navigateToAuthStep();

    // Should show the hero card with the no-auth warning.
    await gu.waitToPass(async () => {
      const heroText = await driver.findWait(".test-admin-auth-hero-card", 2000).getText();
      assert.match(heroText, /No authentication/);
    }, 2000);

    // Should show provider rows.
    const rows = await driver.findAll(".test-admin-auth-provider-row");
    assert.isAtLeast(rows.length, 2);
  });

  it("should not show restart warning when auth changes are made", async function() {
    process.env.GRIST_OIDC_IDP_ISSUER = "https://example.com";
    process.env.GRIST_OIDC_IDP_CLIENT_ID = "test-id";
    process.env.GRIST_OIDC_IDP_CLIENT_SECRET = "test-secret";
    process.env.GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT = "true";
    process.env.GRIST_OIDC_SP_HOST = "localhost";
    await server.restart();
    await navigateToAuthStep();

    // Expand the list if collapsed (OIDC is now active with error).
    await expandProviderList();

    // OIDC should be present with Active badge.
    const oidcRow = await driver.findContentWait(".test-admin-auth-provider-row", "OIDC", 2000);
    const badges = await oidcRow.findAll(".test-admin-auth-badge", e => e.getText());
    assert.include(badges, "ACTIVE");

    // The "Restart required" warning should NOT appear in the setup wizard.
    const pageText = await driver.find("body").getText();
    assert.notMatch(pageText, /Restart required/,
      "Restart warning should not appear in setup wizard");
  });
});
