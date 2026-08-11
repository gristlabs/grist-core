import { SETUP_RETURN_KEY } from "app/client/ui/GetGristComProvider";
import { FALLBACK_PROVIDER_KEY, FORWARD_AUTH_PROVIDER_KEY } from "app/common/loginProviders";
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
    // Clicking an unconfigured provider's card opens its configure modal.
    await row.click();
  }, 2000);
  await driver.findWait(".test-admin-auth-modal-header", 2000);
}

async function openWizardGetGristModal(): Promise<void> {
  // In the wizard, getgrist.com is presented as the recommended hero card
  // (with a CTA) when no real provider is active; otherwise -- e.g. when an
  // earlier suite left a real provider active -- it appears as a regular
  // provider row with a Configure button. Handle both so the helper is robust
  // to suite ordering. The section re-renders when async fetches land, so
  // retry the lookup and click together.
  await gu.waitToPass(async () => {
    const ctas = await driver.findAll(".test-admin-auth-hero-configure");
    if (ctas.length > 0) {
      await ctas[0].click();
      return;
    }
    const header = await driver.find(".test-admin-auth-provider-list-header");
    if (await header.getAttribute("aria-expanded") === "false") {
      await header.click();
    }
    const row = await driver.findContent(".test-admin-auth-provider-row", /getgrist/i);
    await row.click();
  }, 4000);
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
    await driver.findContentWait("button", /Authentication/, 4000).click();
  }

  describe("default-email-set", function() {
    it("should show the getgrist.com recommended card on the Authentication step", async function() {
      await navigateToAuthStep();

      // The wizard promotes getgrist.com as the recommended hero when
      // nothing real is configured (instead of the admin panel's no-auth
      // warning).
      await gu.waitToPass(async () => {
        const hero = await driver.findWait(".test-admin-auth-hero-card", 2000);
        assert.match(await hero.getText(), /ideal for testing/i);
      }, 2000);
      assert.isTrue(await driver.find(".test-admin-auth-badge-recommended").isDisplayed());
      assert.isTrue(await driver.find(".test-admin-auth-hero-configure").isDisplayed());

      // The one-line intro replaces the old step header.
      assert.match(await driver.find("body").getText(), /Choose how people sign in/);
    });

    it("should exclude getgrist.com from the 'Other methods' list", async function() {
      await navigateToAuthStep();
      await driver.findWait(".test-admin-auth-hero-card", 2000);

      // The "Other methods" list is always expanded in the wizard (static header).
      // Retry the find and read together: the step content fades in (opacity
      // animates from 0) and the section re-renders as async fetches land, so
      // getText can return "" or hit a stale element until it settles.
      await gu.waitToPass(async () => {
        const header = await driver.findWait(".test-admin-auth-provider-list-header", 2000);
        assert.match(await header.getText(), /other methods/i);
      }, 2000);

      await gu.waitToPass(async () => {
        const rowText = (await Promise.all(
          (await driver.findAll(".test-admin-auth-provider-row")).map(r => r.getText()),
        )).join("\n");
        assert.match(rowText, /OIDC/);
        assert.match(rowText, /SAML/);
        // getgrist.com is the hero card here, never a row in this list.
        assert.notMatch(rowText, /getgrist/i);
      }, 2000);
    });

    it("should hide Continue when no auth is configured", async function() {
      await navigateToAuthStep();
      await driver.findWait(".test-admin-auth-hero-card", 2000);

      // Continue only appears once a method is configured or no-auth acknowledged.
      assert.lengthOf(await driver.findAll(".test-quick-setup-auth-continue"), 0);
    });

    it("should confirm the no-auth card click, then stage the choice for apply", async function() {
      await navigateToAuthStep();
      // Retry the find+click together: the section re-renders as async fetches
      // land, so the card can go stale between the find and the click.
      await gu.waitToPass(async () => {
        await driver.findWait(".test-admin-auth-provider-row-no-auth", 2000).click();
      }, 4000);

      // Modal opens with Save disabled until the acknowledgement is ticked.
      const confirm = await driver.findWait(".test-modal-confirm", 2000);
      assert.equal(await confirm.getAttribute("disabled"), "true");
      await driver.find(".test-admin-auth-no-auth-acknowledge").click();
      await gu.waitToPass(async () => {
        assert.notEqual(await confirm.getAttribute("disabled"), "true");
      }, 2000);

      await confirm.click();

      // A choice made in the UI always sticks: it is staged and saved on apply, so the
      // button offers Apply rather than a plain Continue.
      const continueBtn = await driver.findWait(".test-quick-setup-auth-continue", 2000);
      assert.match(await continueBtn.getText(), /Apply and Continue/);
    });

    it("should open the getgrist.com configure modal from the CTA", async function() {
      await navigateToAuthStep();
      await openWizardGetGristModal();
      assert.isTrue(await isModalOpen());
      await cancelConfigureModal();
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

  // Revert discards this visit's unsaved state -- selection, acknowledgement, and
  // configuration drafts together, like a page reload -- and never touches the server
  // (it once deleted the saved no-auth pref, letting a configured-but-inactive provider
  // get auto-picked at the next boot). A choice made in the UI is always saved on apply.
  describe("no-auth choice durability", function() {
    // A syntactically valid getgrist.com configuration key (never used to sign in).
    const DUMMY_GETGRIST_KEY = Buffer.from(JSON.stringify({
      oidcClientId: "test-client-id",
      oidcClientSecret: "test-client-secret",
      oidcIssuer: "https://getgrist-issuer.example.com",
      owner: { name: "Chimpy", email: "chimpy@getgrist.com" },
    })).toString("base64");

    // Prefix API fetches with location.origin: the page's <base> points elsewhere,
    // so a relative URL would leave the session's origin (and its cookies) behind.
    async function patchPrefsEnvVars(envVars: Record<string, string | null>): Promise<void> {
      const status = await driver.executeAsyncScript(async (vars: unknown, done: (v: number) => void) => {
        const resp = await fetch(location.origin + "/api/install/prefs", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ envVars: vars }),
        });
        done(resp.status);
      }, envVars);
      assert.equal(status, 200);
    }

    /** Reads the saved GRIST_LOGIN_SYSTEM_TYPE from install prefs, via the browser session. */
    async function getSavedLoginType(): Promise<string | null> {
      // Note: executeAsyncScript serializes undefined to null.
      return driver.executeAsyncScript<string | null>(async (done: (v: string | null) => void) => {
        const resp = await fetch(location.origin + "/api/install/prefs", { credentials: "include" });
        done((await resp.json()).envVars?.GRIST_LOGIN_SYSTEM_TYPE ?? null);
      });
    }

    /** Clicks the no-auth card (expanding the list if collapsed) and confirms the modal. */
    async function chooseNoAuth(): Promise<void> {
      await gu.waitToPass(async () => {
        const header = await driver.findWait(".test-admin-auth-provider-list-header", 2000);
        if (await header.getAttribute("aria-expanded") === "false") {
          await header.click();
        }
        await driver.findWait(".test-admin-auth-provider-row-no-auth", 1000).click();
      }, 4000);
      const confirm = await driver.findWait(".test-modal-confirm", 2000);
      await driver.find(".test-admin-auth-no-auth-acknowledge").click();
      await gu.waitToPass(async () => {
        assert.notEqual(await confirm.getAttribute("disabled"), "true");
      }, 2000);
      await confirm.click();
    }

    async function heroShowsPendingActivation(): Promise<boolean> {
      const badges = await driver.findAll(
        ".test-admin-auth-hero-card .test-admin-auth-badge-active-on-restart");
      return badges.length === 1;
    }

    after(async function() {
      // Clear everything these tests saved so later suites start clean.
      await server.simulateLogin(user.name, user.email, "docs");
      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();
      await patchPrefsEnvVars({ GRIST_LOGIN_SYSTEM_TYPE: null, GRIST_GETGRISTCOM_SECRET: null });
    });

    it("keeps a saved no-auth choice through choose → revert cycles in the wizard", async function() {
      // A saved no-auth choice alongside a configured provider: the provider is
      // configured but not active, and only the saved choice keeps it that way.
      await server.simulateLogin(user.name, user.email, "docs");
      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();
      await patchPrefsEnvVars({
        GRIST_LOGIN_SYSTEM_TYPE: FALLBACK_PROVIDER_KEY,
        GRIST_GETGRISTCOM_SECRET: DUMMY_GETGRIST_KEY,
      });

      await navigateToAuthStep();
      await chooseNoAuth();
      // A choice always sticks, so it is staged for apply -- even one matching the
      // saved state.
      const continueBtn = await driver.findWait(".test-quick-setup-auth-continue", 2000);
      assert.match(await continueBtn.getText(), /Apply and Continue/);

      // Revert discards this visit's unsaved choice, like a page reload. Continue
      // hides, and the recommendation hero returns with the configured provider
      // ready to activate.
      await driver.findWait(".test-admin-auth-hero-revert", 2000).click();
      await gu.waitToPass(async () => {
        assert.lengthOf(await driver.findAll(".test-quick-setup-auth-continue"), 0);
      }, 2000);
      assert.isTrue(await driver.find(".test-admin-auth-hero-activate").isDisplayed());

      // Choose and revert once more; nothing was ever written or deleted server-side.
      await chooseNoAuth();
      await driver.findWait(".test-admin-auth-hero-revert", 2000).click();
      assert.equal(await getSavedLoginType(), FALLBACK_PROVIDER_KEY);
    });

    it("pins no-auth on apply; revert discards the choice and the config together", async function() {
      await server.simulateLogin(user.name, user.email, "docs");
      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();
      await patchPrefsEnvVars({ GRIST_LOGIN_SYSTEM_TYPE: null, GRIST_GETGRISTCOM_SECRET: null });
      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();
      await toggleItem("authentication");

      // Configuring getgrist.com stages it as the pending activation (configuring
      // means choosing).
      async function configureGetGrist() {
        await openConfigureModal();
        await driver.find(".test-admin-auth-config-key-textarea").sendKeys(DUMMY_GETGRIST_KEY);
        await driver.find(".test-admin-auth-modal-configure").click();
        await gu.waitToPass(async () => {
          assert.isTrue(await heroShowsPendingActivation());
        }, 4000);
      }
      await configureGetGrist();

      // Choose no-auth, then revert: everything from this visit is discarded --
      // the choice and the configuration draft -- as a page reload would.
      await chooseNoAuth();
      await driver.findWait(".test-admin-auth-hero-revert", 2000).click();
      await gu.waitToPass(async () => {
        assert.isFalse(await heroShowsPendingActivation());
        assert.lengthOf(await driver.findAll(".test-admin-auth-hero-revert"), 0);
      }, 2000);

      // Redo the work and apply this time. The configuration and the no-auth choice
      // are saved together, so the configured provider is not auto-picked at the
      // next boot.
      await configureGetGrist();
      await chooseNoAuth();
      // The apply banner animates open (grid-template-rows) and the just-confirmed
      // acknowledgement modal fades out; retry the click until the button is actually
      // interactable rather than mid-reveal or behind the closing overlay.
      await gu.waitToPass(async () => {
        await driver.findWait(".test-admin-panel-apply-no-restart", 2000).click();
      }, 2000);
      await gu.waitToPass(async () => {
        assert.equal(await getSavedLoginType(), FALLBACK_PROVIDER_KEY);
      }, 4000);
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

    // A valid base64 getgrist.com configuration key against the mock OIDC issuer.
    // getgrist.com (unlike OIDC/SAML) does not require an activation key, so the
    // wizard can stage it as the active method in a community install.
    function buildGetGristKey() {
      return Buffer.from(JSON.stringify({
        oidcClientId: "test-client-id",
        oidcClientSecret: "test-client-secret",
        oidcIssuer: oidc.url + "?provider=getgrist.com",
        oidcSkipEndSessionEndpoint: true,
        owner: { name: "Chimpy", email: "chimpy@getgrist.com" },
      })).toString("base64");
    }

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

        GRIST_GETGRISTCOM_SECRET: buildGetGristKey(),
        GRIST_GETGRISTCOM_SP_HOST: `http://localhost:${homePort}`,
        GRIST_FORWARD_AUTH_HEADER: "x-forwarded-user",
        GRIST_FORWARD_AUTH_LOGOUT_PATH: "/logout",
      }, undefined, undefined, { useCoreCmd: true });
    });

    after(async function() {
      // The redirect test applied active=getgrist.com to the server prefs;
      // clear the database so later suites start from a clean no-auth state.
      // Restart while the mock issuer is still up: the restarted server
      // initializes the active getgrist.com OIDC client against it.
      await server.restart(true, undefined, { useCoreCmd: true });
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
        // getgrist.com is configured (via env) but not active; clicking its card
        // stages it as the new active method.
        const row = await driver.findContentWait(
          ".test-admin-auth-provider-row", /getgrist/i, 4000);
        await row.click();
        // Confirm the "Set as active method?" modal to stage the change.
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
      // Unset OIDC and getgrist.com config.
      GRIST_OIDC_IDP_ISSUER: undefined,
      GRIST_OIDC_IDP_CLIENT_ID: undefined,
      GRIST_OIDC_IDP_CLIENT_SECRET: undefined,
      GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT: undefined,
      GRIST_OIDC_SP_HOST: undefined,
      GRIST_GETGRISTCOM_SECRET: undefined,
      GRIST_GETGRISTCOM_SP_HOST: undefined,
    }));

    it("arms when the wizard's configure modal opens, clears when it closes", async function() {
      await navigateToAuthStep();
      await clearBreadcrumb();
      assert.isNull(await readBreadcrumb(), "should start unarmed");

      // In the wizard, getgrist.com is the recommended hero card, so its
      // modal is opened via the CTA rather than a provider row.
      await openWizardGetGristModal();
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
