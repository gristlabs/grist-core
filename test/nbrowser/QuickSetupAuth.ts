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

  it("should disable Continue button when no auth is configured", async function() {
    await navigateToAuthStep();

    await gu.waitToPass(async () => {
      const heroText = await driver.findWait(".test-admin-auth-hero-card", 2000).getText();
      assert.match(heroText, /No authentication/);
    }, 2000);

    // Continue button should be present but disabled.
    const continueBtn = await driver.findWait(".test-quick-setup-auth-continue", 2000);
    assert.equal(await continueBtn.getAttribute("disabled"), "true");
  });

  it("should enable Continue and collapse providers after acknowledging no-auth", async function() {
    // Check the "I understand" checkbox.
    await driver.findWait(".test-admin-auth-no-auth-acknowledge", 2000).click();

    // Continue button should now be enabled.
    const continueBtn = await driver.find(".test-quick-setup-auth-continue");
    await gu.waitToPass(async () => {
      assert.equal(await continueBtn.getAttribute("disabled"), null);
    }, 1000);

    // Provider list should be collapsed.
    const header = await driver.find(".test-admin-auth-provider-list-header");
    assert.equal(await header.getAttribute("aria-expanded"), "false");

    // Provider rows should not be visible.
    assert.lengthOf(await driver.findAll(".test-admin-auth-provider-row"), 0);
  });

  it("should keep providers collapsed after page reload when no-auth is acknowledged", async function() {
    // Reload the page — noAuthAcknowledged is persisted in localStorage.
    await navigateToAuthStep();

    await gu.waitToPass(async () => {
      await driver.findWait(".test-admin-auth-hero-card", 2000);
    }, 2000);

    // Provider list should still be collapsed from the previous acknowledgment.
    const header = await driver.findWait(".test-admin-auth-provider-list-header", 2000);
    assert.equal(await header.getAttribute("aria-expanded"), "false");
    assert.lengthOf(await driver.findAll(".test-admin-auth-provider-row"), 0);

    // Uncheck to clean up for later tests.
    await driver.find(".test-admin-auth-no-auth-acknowledge").click();
    // Clear localStorage so it doesn't affect other test suites.
    await driver.executeScript("window.localStorage.removeItem('noAuthAcknowledged');");
  });

  it("should enable Continue button when auth is configured but erroring", async function() {
    process.env.GRIST_OIDC_IDP_ISSUER = "https://example.com";
    process.env.GRIST_OIDC_IDP_CLIENT_ID = "test-id";
    process.env.GRIST_OIDC_IDP_CLIENT_SECRET = "test-secret";
    process.env.GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT = "true";
    process.env.GRIST_OIDC_SP_HOST = "localhost";
    await server.restart();
    await navigateToAuthStep();

    // OIDC is active but erroring (bad issuer). Continue should still be enabled.
    const continueBtn = await driver.findWait(".test-quick-setup-auth-continue", 2000);
    await gu.waitToPass(async () => {
      assert.equal(await continueBtn.getAttribute("disabled"), null);
    }, 2000);
  });

  it("should not show restart warning when auth changes are made", async function() {
    // Reuses the OIDC env from the previous test.
    await navigateToAuthStep();

    // Wait for auth section to load.
    await driver.findWait(".test-admin-auth-hero-card", 2000);

    // The "Restart required" warning should NOT appear in the setup wizard.
    const pageText = await driver.find("body").getText();
    assert.notMatch(pageText, /Restart required/,
      "Restart warning should not appear in setup wizard");
  });
});
