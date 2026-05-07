import { FORWARD_AUTH_PROVIDER_KEY } from "app/common/loginProviders";
import * as gu from "test/nbrowser/gristUtils";
import { startMockOIDCIssuer } from "test/nbrowser/oidcMockServer";
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

  it("should advance to the next step on Continue when nothing is dirty", async function() {
    // OIDC is configured (and erroring) from the earlier test. The continue
    // button is enabled (a real provider is active) but isDirty is false
    // because nothing is pending. Click should advance to the Backups step
    // rather than triggering a restart or sign-in redirect.
    await navigateToAuthStep();
    const continueBtn = await driver.findWait(".test-quick-setup-auth-continue", 2000);
    await gu.waitToPass(async () => {
      assert.equal(await continueBtn.getAttribute("disabled"), null);
    }, 2000);

    await continueBtn.click();
    await driver.findWait(".test-quick-setup-backups-continue", 2000);
  });

  // The redirect test exercises a real /api/admin/restart cycle, which
  // requires the test server to run under RestartShell mode. Setup is
  // heavy (three serial restarts to put forward-auth in prefs while
  // keeping OIDC configured), so it lives in `before()` rather than the
  // `it`. The sub-suite's `after()` restarts out of shell mode so later
  // tests in the parent suite are unaffected.
  describe("session-clearing apply (RestartShell mode)", function() {
    let envSnapshot: testUtils.EnvironmentSnapshot;
    let oidc: Awaited<ReturnType<typeof startMockOIDCIssuer>>;

    before(async function() {
      envSnapshot = new testUtils.EnvironmentSnapshot();
      try {
        oidc = await startMockOIDCIssuer({ authorize: true });

        // GRIST_RESTART_SHELL=true overrides the GRIST_TESTING_SOCKET gate in
        // shouldRunAsRestartShell so /api/admin/restart actually drives a
        // worker restart in nbrowser (default would 409).
        process.env.GRIST_RESTART_SHELL = "true";
        process.env.GRIST_OIDC_IDP_ISSUER = oidc.url;
        process.env.GRIST_OIDC_IDP_CLIENT_ID = "test-client-id";
        process.env.GRIST_OIDC_IDP_CLIENT_SECRET = "test-client-secret";
        process.env.GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT = "true";
        process.env.GRIST_FORWARD_AUTH_HEADER = "x-forwarded-user";
        process.env.GRIST_FORWARD_AUTH_LOGOUT_PATH = "/logout";
        await server.restart();
        // GRIST_OIDC_SP_HOST is a full URL used as a base for the callback URL.
        process.env.GRIST_OIDC_SP_HOST = server.getHost();
        await server.restart();

        // Persist active=forward-auth in prefs (not env) so isNewFixedByEnv
        // doesn't block the UI's "Set as active" buttons.
        await server.simulateLogin(user.name, user.email, "docs");
        await driver.get(`${server.getHost()}/admin`);
        const setActiveOk = await driver.executeAsyncScript(`
          const done = arguments[arguments.length - 1];
          fetch('/api/config/auth-providers/set-active', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ providerKey: ${JSON.stringify(FORWARD_AUTH_PROVIDER_KEY)} }),
            credentials: 'include',
          }).then(r => done(r.ok)).catch(e => done('error: ' + e.message));
        `);
        assert.strictEqual(setActiveOk, true);
        await server.restart();
      } catch (err) {
        // after() doesn't run if before() throws, so undo what we touched.
        envSnapshot.restore();
        await oidc?.shutdown();
        throw err;
      }
    });

    after(async function() {
      envSnapshot.restore();
      // Restart out of shell mode so subsequent suites' testingHooks RPC
      // connection re-initialises against a fresh worker.
      await server.restart();
      await oidc?.shutdown();
    });

    it("should redirect through sign-in after applying a session-clearing auth change",
      async function() {
        await navigateToAuthStep();
        const header = await driver.findWait(".test-admin-auth-provider-list-header", 4000);
        if (await header.getAttribute("aria-expanded") === "false") {
          await header.click();
        }
        const oidcRow = await driver.findContentWait(
          ".test-admin-auth-provider-row", /OIDC/, 4000);
        await oidcRow.find(".test-admin-auth-set-active-button").click();
        await driver.findWait(".test-modal-confirm", 2000).click();
        await gu.waitForServer();

        const continueBtn = await driver.findWait(".test-quick-setup-auth-continue", 2000);
        await gu.waitToPass(async () => {
          assert.match(await continueBtn.getText(), /Apply and Continue/i);
        }, 2000);

        await continueBtn.click();
        await driver.wait(async () => (await driver.getCurrentUrl()).startsWith(oidc.url), 30000);
        assert.match(await driver.getPageSource(), /oidc-mock-authorize/);
      });
  });

  it("should show access denied card to a non-admin visitor", async function() {
    // Sign out and load /admin/setup directly. The page must not render the
    // configure controls -- it should fall back to the boot-key card so a
    // misconfigured-or-curious visitor sees the same "go away" UI as on
    // /admin.
    await server.removeLogin();
    await driver.get(`${server.getHost()}/admin/setup`);
    await driver.findContentWait(
      ".test-admin-panel-error", "Administrator Panel Unavailable", 2000,
    );
    assert.isTrue(await driver.findContent("a", "Sign in with boot key").isDisplayed());
    // Setup steps must not be rendered.
    assert.lengthOf(await driver.findAll(".test-quick-setup-auth-continue"), 0);
    assert.lengthOf(await driver.findAll(".test-quick-setup-server-continue"), 0);
  });

  it("should show access denied card to a signed-in non-admin user", async function() {
    // Same fallback should apply when the visitor is signed in but is not
    // the install admin -- they shouldn't see the configure controls just
    // because they have a session.
    const nonAdmin = gu.translateUser("user2");
    await server.removeLogin();
    try {
      await server.simulateLogin(nonAdmin.name, nonAdmin.email, "docs");
      await driver.get(`${server.getHost()}/admin/setup`);
      await driver.findContentWait(
        ".test-admin-panel-error", "Administrator Panel Unavailable", 2000,
      );
      assert.lengthOf(await driver.findAll(".test-quick-setup-auth-continue"), 0);
      assert.lengthOf(await driver.findAll(".test-quick-setup-server-continue"), 0);
    } finally {
      await server.removeLogin();
    }
  });
});
