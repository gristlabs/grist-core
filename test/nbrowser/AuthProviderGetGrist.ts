import { Activation } from "app/gen-server/entity/Activation";
import { itemValue, toggleItem } from "test/nbrowser/AdminPanelTools";
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

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_DEFAULT_EMAIL = gu.translateUser("user1").email;
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";
    process.env.GRIST_FEATURE_GETGRIST_COM = "1";
    // Clear any APP_HOME_URL set by the runner.
    if (process.env.APP_HOME_URL) {
      console.warn(`Clearing APP_HOME_URL=${process.env.APP_HOME_URL} for test`);
    }
    process.env.APP_HOME_URL = "";
    await server.restart();

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
        // Minimal authorize endpoint; no real auth flow needed for tests.
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

  it("should show providers with Grist Login", async function() {
    await server.simulateLogin("user1", process.env.GRIST_DEFAULT_EMAIL!, "docs");
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await toggleItem("authentication");

    await gu.waitToPass(async () => {
      assert.equal(await itemValue("authentication"), "no authentication");
    }, 500);

    // We should see couple of providers, including "Sign in with Grist".
    await driver.findWait(".test-admin-auth-provider-row", 2000); // wait for it to appear
    const providerItems = await driver.findAll(".test-admin-auth-provider-row");
    assert.isAtLeast(providerItems.length, 2); // We expect to see OIDC provider as well.

    // First one should be "Sign in with Grist".
    assert.match(await providerItems[0].getText(), /Sign in with getgrist/);
  });

  it("should allow configuring getgrist.com provider", async function() {
    const configureButton = await providerRow().find(".test-admin-auth-configure-button");
    await configureButton.click();

    const textarea = await driver.findWait(".test-admin-auth-config-key-textarea", 2000);
    const configureModalButton = await driver.find(".test-admin-auth-modal-configure");

    // Button should be grayed out and disabled (should have 'disabled' attribute) when textarea is empty.
    assert.isFalse(await configureModalButton.isEnabled());

    // Click it while disabled.
    await configureModalButton.click();
    // Nothing should happen, modal should stay open.
    await driver.sleep(100);
    await gu.checkForErrors();

    // Type some dummy invalid key.
    await textarea.click();
    await textarea.sendKeys("invalid-key");
    await configureModalButton.click();
    await assertError(/Error configuring provider with the provided key/);

    await textarea.clear();
    await textarea.sendKeys(Buffer.from(JSON.stringify({ random: "json" })).toString("base64"));
    await configureModalButton.click();
    await assertError(/Error configuring provider with the provided key/);

    const validConfig = {
      oidcClientId: "some-id",
      oidcClientSecret: "some-secret",
      oidcIssuer: serving.url + "?provider=getgrist.com",
      oidcSkipEndSessionEndpoint: true,
    };
    await textarea.clear();
    await textarea.sendKeys(Buffer.from(JSON.stringify(validConfig)).toString("base64"));
    await configureModalButton.click();
    await gu.waitForServer();
    await waitForModalToClose();

    // We should see two badges: Configured and Active on restart. GetGrist.com was picked by order.
    const providerBadges = await badges();
    assert.includeMembers(providerBadges, ["CONFIGURED", "ACTIVE ON RESTART"]);
  });

  it("should store config in database", async function() {
    const db = await server.getDatabase();
    const activation = await db.connection.manager.findOne(Activation, { where: {} });
    assert.isDefined(activation);
    const json = activation!.prefs!.envVars;
    assert.isDefined(json);
    assert.isDefined(json!.GRIST_GETGRISTCOM_SECRET);
  });

  it("should use fake getgristlogin service", async function() {
    await server.restart();
    await server.removeLogin();
    await server.simulateLogin("user1", process.env.GRIST_DEFAULT_EMAIL!, "docs");
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await toggleItem("authentication");
    assert.equal(await itemValue("authentication"), "getgrist.com");

    // And check that we still see at least 2 providers, including getgrist.com and OIDC
    const providerItems = await driver.findAll(".test-admin-auth-provider-row");
    assert.isAtLeast(providerItems.length, 2);

    // First one should be "Sign in with getgrist.com".
    assert.match(await providerItems[0].getText(), /Sign in with getgrist/);

    // Second one should be OIDC provider.
    assert.match(await providerItems[1].getText(), /OIDC/);

    // The getgrist.com provider should have Active badge and Configured badge
    const getGristRow = providerItems[0];
    const activeBadges = await getGristRow.findAll(".test-admin-auth-badge-active");
    assert.lengthOf(activeBadges, 1);
    const configuredBadges = await getGristRow.findAll(".test-admin-auth-badge-configured");
    assert.lengthOf(configuredBadges, 1);

    // Second one should have no badges
    const oidcRow = providerItems[1];
    const oidcBadges = await oidcRow.findAll(".test-admin-auth-badge");
    assert.lengthOf(oidcBadges, 0);
  });

  it("should respect GRIST_GETGRISTCOM_SP_HOST env override", async function() {
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
  driver.findAll(".test-admin-auth-provider-row").then(rows => rows[n]));

const badges = (n = 0) => providerRow(n).findAll(".test-admin-auth-badge", e => e.getText());
