import { expandProviderList, itemValue, toggleItem } from "test/nbrowser/AdminPanelTools";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import { Defer, serveSomething, Serving } from "test/server/customUtil";
import * as testUtils from "test/server/testUtils";

import * as express from "express";
import { observable } from "grainjs";
import { assert, driver, WebElementPromise } from "mocha-webdriver";

describe("AuthProviderGetGrist", function() {
  this.timeout("2m");
  setupTestSuite();
  gu.bigScreen();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let serving: Serving;
  const currentRequest = observable(null as express.Request | null);

  // Build a valid base64 configuration key against the test's fake OIDC server.
  function buildKey() {
    return Buffer.from(JSON.stringify({
      oidcClientId: "some-id",
      oidcClientSecret: "some-secret",
      oidcIssuer: serving.url + "?provider=getgrist.com",
      oidcSkipEndSessionEndpoint: true,
      owner: { name: "Chimpy", email: "chimpy@getgrist.com" },
    })).toString("base64");
  }

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_DEFAULT_EMAIL = gu.translateUser("user1").email;
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";
    // Make sure no APP_HOME_URL is set, to use calculated one.
    delete process.env.APP_HOME_URL;

    serving = await serveSomething((app) => {
      app.use((req, res, next) => {
        currentRequest.set(req);
        next();
      });
      app.use(express.json());
      app.get("/.well-known/openid-configuration", (req, res) => {
        res.json({
          issuer: `${serving.url}?provider=getgrist.com`,
          authorization_endpoint: `${serving.url}/authorize`,
        });
      });
      app.get("/authorize", (req, res) => {
        res.sendStatus(200);
      });
      app.use((req) => {
        console.warn(`Unexpected request to test OIDC server: ${req.method} ${req.url}`);
      });
    });
  });

  after(async function() {
    oldEnv.restore();
    await server.restart(true); // clear database changes
    await serving?.shutdown();
  });

  // Exercise the configure modal and the section's draft display.
  // Persistence and server behavior are covered by the seeded-env-var
  // tests below.
  describe("UI flow with no auth configured", function() {
    before(async function() {
      delete process.env.GRIST_GETGRISTCOM_SECRET;
      delete process.env.GRIST_LOGIN_SYSTEM_TYPE;
      await server.restart();
    });

    it("should show providers with Grist Login", async function() {
      await server.simulateLogin("user1", process.env.GRIST_DEFAULT_EMAIL!, "docs");
      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();
      await toggleItem("authentication");

      await gu.waitToPass(async () => {
        assert.equal(await itemValue("authentication"), "no authentication");
      }, 500);

      await driver.findWait(".test-admin-auth-provider-row", 2000);
      const providerItems = await driver.findAll(".test-admin-auth-provider-row");
      assert.isAtLeast(providerItems.length, 2);
      assert.match(await providerItems[0].getText(), /Sign in with getgrist/);
    });

    it("should validate the key and stage the configuration as a draft", async function() {
      const configureButton = await providerRow().find(".test-admin-auth-configure-button");
      await configureButton.click();

      const textarea = await driver.findWait(".test-admin-auth-config-key-textarea", 2000);
      const configureModalButton = await driver.find(".test-admin-auth-modal-configure");

      // Empty textarea -> Configure disabled.
      assert.isFalse(await configureModalButton.isEnabled());
      await configureModalButton.click();
      await driver.sleep(100);
      await gu.checkForErrors();

      // Invalid base64.
      await textarea.click();
      await textarea.sendKeys("invalid-key");
      await configureModalButton.click();
      await assertError(/Error configuring provider with the provided key/);

      // Valid base64 but missing required fields.
      await textarea.clear();
      await textarea.sendKeys(Buffer.from(JSON.stringify({ random: "json" })).toString("base64"));
      await configureModalButton.click();
      await assertError(/Error configuring provider with the provided key/);

      // Valid key.
      await textarea.clear();
      await textarea.sendKeys(buildKey());
      await configureModalButton.click();
      await waitForModalToClose();

      // The badge reflects the draft: getgrist.com will be active on apply
      // (because nothing else was active and it's the first configured).
      assert.includeMembers(await badges(), ["ACTIVE ON RESTART"]);
    });
  });

  // Server-side behavior tests seed the secret directly via env vars and
  // restart, bypassing the UI configure modal. They verify how the server
  // behaves when getgrist.com is the active auth provider, and how the
  // section presents that state in the admin panel.
  describe("when getgrist.com is configured via env vars", function() {
    before(async function() {
      process.env.GRIST_GETGRISTCOM_SECRET = buildKey();
      // Don't pin GRIST_LOGIN_SYSTEM_TYPE -- coreLogins picks the first
      // configured system, which is getgrist.com.
      delete process.env.GRIST_LOGIN_SYSTEM_TYPE;
      await server.restart();
    });

    after(async function() {
      delete process.env.GRIST_GETGRISTCOM_SECRET;
      delete process.env.GRIST_GETGRISTCOM_SP_HOST;
    });

    it("shows getgrist.com as the active provider", async function() {
      await server.removeLogin();
      await server.simulateLogin("user1", process.env.GRIST_DEFAULT_EMAIL!, "docs");
      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();
      await toggleItem("authentication");
      assert.equal(await itemValue("authentication"), "getgrist.com");

      // Provider list collapses when a real provider is active; expand to inspect.
      await expandProviderList();
      const providerItems = await driver.findAll(".test-admin-auth-provider-row");
      assert.isAtLeast(providerItems.length, 2);
      assert.match(await providerItems[0].getText(), /Sign in with getgrist/);
      assert.match(await providerItems[1].getText(), /OIDC/);

      const activeBadges = await providerItems[0].findAll(".test-admin-auth-badge-active");
      assert.lengthOf(activeBadges, 1);
      assert.lengthOf(await providerItems[1].findAll(".test-admin-auth-badge"), 0);
    });

    it("shows DISABLED ON RESTART when the user clicks Deactivate", async function() {
      // The previous test left us on the admin panel with getgrist.com active.
      const deactivateButton = await driver.findWait(".test-admin-auth-hero-deactivate", 2000);
      await deactivateButton.click();
      const confirmButton = await driver.findWait(".test-modal-confirm", 2000);
      await confirmButton.click();

      await expandProviderList();
      const getGristBadges = await badges();
      assert.includeMembers(getGristBadges, ["DISABLED ON RESTART"]);
    });

    it("respects GRIST_GETGRISTCOM_SP_HOST when constructing the OAuth redirect", async function() {
      process.env.GRIST_GETGRISTCOM_SP_HOST = "https://invalid-host.example.com";
      await server.restart();
      await server.removeLogin();
      await driver.get(`${server.getHost()}`);
      await gu.waitForDocMenuToLoad();
      currentRequest.set(null);
      const redirectUrl = new Defer<string>();
      currentRequest.addListener((val) => {
        redirectUrl.resolve(val?.query.redirect_uri as string);
      });
      await driver.findWait(".test-user-sign-in", 2000).click();
      assert.equal(await redirectUrl, "https://invalid-host.example.com/oauth2/callback");
    });
  });
});

async function assertError(msg: RegExp) {
  assert.match(
    await driver.findWait(".test-notifier-toast-message", 1000).getText(),
    msg,
  );
  await driver.findWait(".test-notifier-toast-close", 2000).click();
}

async function waitForModalToClose() {
  await driver.wait(async () => {
    const modals = await driver.findAll(".test-admin-auth-modal-header");
    return modals.length === 0;
  }, 2000);
}

const providerRow = (n = 0) => new WebElementPromise(driver,
  expandProviderList().then(() =>
    driver.findAll(".test-admin-auth-provider-row").then(rows => rows[n]),
  ));

const badges = (n = 0) => providerRow(n).findAll(".test-admin-auth-badge", e => e.getText());
