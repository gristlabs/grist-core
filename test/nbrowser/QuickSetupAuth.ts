import { SETUP_RETURN_KEY } from "app/client/ui/GetGristComProvider";
import { FORWARD_AUTH_PROVIDER_KEY } from "app/common/loginProviders";
import { toggleItem } from "test/nbrowser/AdminPanelTools";
import * as gu from "test/nbrowser/gristUtils";
import { startMockOIDCIssuer } from "test/nbrowser/oidcMockServer";
import { server, setupTestSuite } from "test/nbrowser/testUtils";

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
  // Same race as the row click below -- AuthenticationSection's buildDom
  // re-renders when async fetches land, so even the header's aria-expanded
  // read can hit a stale element if the rebuild happens between findWait
  // and getAttribute.
  await gu.waitToPass(async () => {
    const header = await driver.findWait(".test-admin-auth-provider-list-header", 4000);
    if (await header.getAttribute("aria-expanded") === "false") {
      await header.click();
    }
  }, 2000);
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

  const user = gu.translateUser("user1");

  // Share a single env snapshot across all deployment-variant describes so we get one restart
  // per deployment (plus one final restore-restart) rather than two per describe.
  const restartWithEnv = gu.withEnvironmentSnapshot();

  before(() => restartWithEnv({
    GRIST_DEFAULT_EMAIL: user.email,
    GRIST_TEST_SERVER_DEPLOYMENT_TYPE: "core",
    GRIST_LOG_HTTP: "1",
    GRIST_IN_SERVICE: "false",
  }));

  async function navigateToAuthStep() {
    await server.simulateLogin(user.name, user.email, "docs");
    await driver.get(`${server.getHost()}/admin/setup`);
    // Click the "Authentication" step label.
    await driver.findContentWait("button", /Authentication/, 2000).click();
  }

  describe("default-email-set", function() {
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

  describe("auth-config-present", function() {
    before(() => restartWithEnv({
      GRIST_OIDC_IDP_ISSUER: "https://example.com",
      GRIST_OIDC_IDP_CLIENT_ID: "test-id",
      GRIST_OIDC_IDP_CLIENT_SECRET: "test-secret",
      GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT: "true",
      GRIST_OIDC_SP_HOST: "localhost",
      GRIST_IN_SERVICE: "false",
    }));

    it("should enable Continue button when auth is configured but erroring", async function() {
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
  });

  // The redirect test exercises a real /api/admin/restart cycle, which
  // requires the test server to run under RestartShell mode. Setup is
  // heavy (three serial restarts to put forward-auth in prefs while
  // keeping OIDC configured), so it lives in `before()` rather than the
  // `it`. The sub-suite's `after()` restarts out of shell mode so later
  // tests in the parent suite are unaffected.
  describe("session-clearing apply (RestartShell mode)", function() {
    let oidc: Awaited<ReturnType<typeof startMockOIDCIssuer>>;

    before(async function() {
      oidc = await startMockOIDCIssuer({ authorize: true });
      // testServer.ts puts HOME_PORT in the child env only, so read the port off the server URL.
      const homePort = new URL(server.getHost()).port;
      if (!homePort) { throw new Error(`No port in server URL: ${server.getHost()}`); }
      await restartWithEnv({
        // GRIST_RESTART_SHELL=true overrides the GRIST_TESTING_SOCKET gate in
        // shouldRunAsRestartShell so /api/admin/restart actually drives a
        // worker restart in nbrowser (default would 409).
        GRIST_RESTART_SHELL: "true",

        GRIST_IN_SERVICE: "true",

        // Use a single-port setup, including for PORT, which is used for the RestartShell.
        HOME_PORT: homePort,
        STATIC_PORT: homePort,
        DOC_PORT: homePort,
        PORT: homePort,

        // Set a cookie variable in process.env, so that it affects both the process and the test
        // (simulateLogin), whereas without it, core entrypoint sets something different.
        GRIST_SESSION_COOKIE: "grist_test_cookie",

        GRIST_OIDC_IDP_ISSUER: oidc.url,
        GRIST_OIDC_IDP_CLIENT_ID: "test-client-id",
        GRIST_OIDC_IDP_CLIENT_SECRET: "test-client-secret",
        GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT: "true",
        GRIST_FORWARD_AUTH_HEADER: "x-forwarded-user",
        GRIST_FORWARD_AUTH_LOGOUT_PATH: "/logout",

        // GRIST_OIDC_SP_HOST is a full URL used as a base for the callback URL.
        GRIST_OIDC_SP_HOST: `http://localhost:${homePort}`,
      }, undefined, undefined, { useCoreCmd: true });
    });

    after(async function() {
      await oidc?.shutdown();
    });

    it("setup", async function() {
      // Persist active=forward-auth in prefs (not env) so isNewFixedByEnv
      // doesn't block the UI's "Set as active" buttons.
      await server.simulateLogin(user.name, user.email, "docs");
      await driver.get(`${server.getHost()}/admin`);
      const setActiveOk = await driver.executeAsyncScript(
        (providerKey: string, done: any) => {
          fetch(location.origin + "/api/config/auth-providers/set-active", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerKey }),
            credentials: "include",
          }).then(r => done(r.ok)).catch(e => done("error: " + e.message));
        },
        FORWARD_AUTH_PROVIDER_KEY,
      );
      assert.strictEqual(setActiveOk, true);
      await server.restart(undefined, undefined, { useCoreCmd: true });
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

  // The "Return to Admin Panel" button on getgrist.com's registration page
  // hard-codes /admin. A localStorage breadcrumb causes /admin to bounce
  // back into /admin/setup at the auth step and reopen the configure
  // modal so the user can paste the secret they have on the clipboard.
  // The breadcrumb is set only while the wizard's modal is alive and is
  // cleared on dispose, so abandoning the flow does not hijack later
  // /admin visits.
  describe("getgrist.com setup-return breadcrumb", function() {
    before(() => restartWithEnv({
      // Unset ports that are normally unset.
      STATIC_PORT: undefined,
      DOC_PORT: undefined,
      PORT: undefined,
      // Unset OIDC config.
      GRIST_OIDC_IDP_ISSUER: undefined,
      GRIST_OIDC_IDP_CLIENT_ID: undefined,
      GRIST_OIDC_IDP_CLIENT_SECRET: undefined,
      GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT: undefined,
      GRIST_OIDC_SP_HOST: undefined,
    }));

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
