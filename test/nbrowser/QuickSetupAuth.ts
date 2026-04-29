import { SETUP_RETURN_KEY } from "app/client/ui/GetGristComProvider";
import { toggleItem } from "test/nbrowser/AdminPanelTools";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";

async function readBreadcrumb(): Promise<string | null> {
  return driver.executeScript<string | null>(
    `return window.localStorage.getItem(${JSON.stringify(SETUP_RETURN_KEY)});`,
  );
}

async function writeBreadcrumb(value: string): Promise<void> {
  await driver.executeScript(
    `window.localStorage.setItem(${JSON.stringify(SETUP_RETURN_KEY)}, ${JSON.stringify(value)});`,
  );
}

async function clearBreadcrumb(): Promise<void> {
  await driver.executeScript(
    `window.localStorage.removeItem(${JSON.stringify(SETUP_RETURN_KEY)});`,
  );
}

async function isModalOpen(): Promise<boolean> {
  return (await driver.findAll(".test-admin-auth-modal-header")).length > 0;
}

async function openConfigureModal(): Promise<void> {
  // Retry the row lookup and click together: AuthenticationSection's
  // buildDom domComputes over async `_providers` and `_loginSystemId`,
  // so the row subtree can be replaced between the find and the click.
  await gu.waitToPass(async () => {
    const row = await driver.findContent(".test-admin-auth-provider-row",
      /Sign in with getgrist/);
    await row.find(".test-admin-auth-configure-button").click();
  }, 2000);
  await driver.findWait(".test-admin-auth-modal-header", 2000);
}

async function cancelConfigureModal(): Promise<void> {
  await driver.find(".test-admin-auth-modal-cancel").click();
  await driver.wait(async () => !(await isModalOpen()), 2000);
}

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

  // The "Return to Admin Panel" button on getgrist.com's registration page
  // hard-codes /admin. A localStorage breadcrumb causes /admin to bounce
  // back into /admin/setup at the auth step and reopen the configure
  // modal so the user can paste the secret they have on the clipboard.
  // The breadcrumb is set only while the wizard's modal is alive and is
  // cleared on dispose, so abandoning the flow does not hijack later
  // /admin visits.
  describe("getgrist.com setup-return breadcrumb", function() {
    let oldEnv: testUtils.EnvironmentSnapshot;

    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      delete process.env.GRIST_OIDC_IDP_ISSUER;
      delete process.env.GRIST_OIDC_IDP_CLIENT_ID;
      delete process.env.GRIST_OIDC_IDP_CLIENT_SECRET;
      delete process.env.GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT;
      delete process.env.GRIST_OIDC_SP_HOST;
      await server.restart();
    });

    after(async function() {
      oldEnv.restore();
      await server.restart();
    });

    it("arms when the wizard's configure modal opens, clears when it closes", async function() {
      await navigateToAuthStep();
      await clearBreadcrumb();
      assert.isNull(await readBreadcrumb(), "should start unarmed");

      await openConfigureModal();
      assert.equal(await readBreadcrumb(), "auth",
        "opening from the wizard should arm the breadcrumb");

      await cancelConfigureModal();
      assert.isNull(await readBreadcrumb(),
        "closing the modal should clear the breadcrumb");
    });

    it("does NOT arm when the configure modal is opened from the admin panel", async function() {
      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();
      await toggleItem("authentication");
      await clearBreadcrumb();

      await openConfigureModal();
      assert.isNull(await readBreadcrumb(),
        "admin-panel-launched modal must not arm the breadcrumb");

      await cancelConfigureModal();
    });

    it("/admin bounces to /admin/setup, jumps to auth, and reopens the modal", async function() {
      // Land on the same origin so we can seed localStorage, then arm and
      // navigate to /admin to trigger the bounce.
      await driver.get(`${server.getHost()}/admin/setup`);
      await writeBreadcrumb("auth");

      await driver.get(`${server.getHost()}/admin`);

      // Bounced to /admin/setup with the configure modal reopened.
      await driver.findWait(".test-admin-auth-modal-header", 4000);
      assert.match(await driver.getCurrentUrl(), /\/admin\/setup($|\?|#)/);

      // Stepper landed on the Authentication step (index 2).
      const activeStep = await driver.findWait(".test-stepper-step-2", 2000);
      assert.match(await activeStep.getAttribute("class"), /-active/);

      // The reopened modal is itself wizard-launched and re-arms the
      // breadcrumb so a second round-trip through registration still works.
      assert.equal(await readBreadcrumb(), "auth");

      // Closing the reopened modal clears the breadcrumb.
      await cancelConfigureModal();
      assert.isNull(await readBreadcrumb());
    });

    it("/admin does not bounce when the breadcrumb is unset", async function() {
      await driver.get(`${server.getHost()}/admin/setup`);
      await clearBreadcrumb();

      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();

      assert.match(await driver.getCurrentUrl(), /\/admin($|\?|#)/);
      assert.notMatch(await driver.getCurrentUrl(), /\/admin\/setup/);
      assert.isFalse(await isModalOpen());
    });

    it("/admin/setup honors the breadcrumb without needing the bounce", async function() {
      await driver.get(`${server.getHost()}/admin/setup`);
      await writeBreadcrumb("auth");

      // Direct navigation -- AdminPanel does not need to bounce, but
      // QuickSetup should still jump to auth and the AuthenticationSection
      // should still reopen the modal.
      await driver.get(`${server.getHost()}/admin/setup`);
      await driver.findWait(".test-admin-auth-modal-header", 4000);

      const activeStep = await driver.findWait(".test-stepper-step-2", 2000);
      assert.match(await activeStep.getAttribute("class"), /-active/);
      // Reopened modal re-arms; closing it clears.
      assert.equal(await readBreadcrumb(), "auth");
      await cancelConfigureModal();
      assert.isNull(await readBreadcrumb());
    });
  });
});
