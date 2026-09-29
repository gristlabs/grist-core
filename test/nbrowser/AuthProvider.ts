import { expandProviderList, itemValue, toggleItem } from "test/nbrowser/AdminPanelTools";
import * as gu from "test/nbrowser/gristUtils";
import { startMockOIDCIssuer } from "test/nbrowser/oidcMockServer";
import { useFastSandboxProbe } from "test/nbrowser/sandboxProbeFixture";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import { Serving } from "test/server/customUtil";
import * as testUtils from "test/server/testUtils";

import { assert, driver, WebElementPromise } from "mocha-webdriver";

describe("AuthProvider", function() {
  this.timeout("2m");
  setupTestSuite();
  gu.bigScreen();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let serving: Serving;
  const user = gu.translateUser("user1");

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_DEFAULT_EMAIL = user.email;
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";
    process.env.GRIST_IN_SERVICE = "false";
    useFastSandboxProbe();
    await server.restart();

    serving = await startMockOIDCIssuer({ failUnexpectedRequests: true });
  });

  after(async function() {
    oldEnv.restore();
    await server.restart(true); // clear database changes
    await serving?.shutdown();
  });

  it("should show some providers", async function() {
    await server.simulateLogin(user.name, user.email, "docs");
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await toggleItem("authentication");

    // Be default we should see "no authentication" value, as no provider is configured and the default
    // fallback to MinimalProvider is used, which Grists reports as "no authentication".
    await gu.waitToPass(async () => {
      assert.equal(await itemValue("authentication"), "no authentication");
    }, 500);

    // We should see couple of providers, including "OIDC and SAML".
    await driver.findWait(".test-admin-auth-provider-row", 2000); // wait for it to appear
    const providerItems = await driver.findAll(".test-admin-auth-provider-row");
    assert.isAtLeast(providerItems.length, 3); // We expect to see OIDC provider as well.

    assert.match(await providerItems[0].getText(), /Sign in with getgrist\.com/);
    assert.match(await providerItems[1].getText(), /OIDC/);
    assert.match(await providerItems[2].getText(), /SAML/);
    assert.match(await providerItems[3].getText(), /Forwarded headers/);
    // And some others, depending on the build we are in.
  });

  it("all providers should not be configured by default", async function() {
    const providerRows = await driver.findAll(".test-admin-auth-provider-row");
    assert.isAtLeast(providerRows.length, 1);

    // No provider carries a status badge yet. getgrist.com carries its
    // "Recommended" chip while nothing is configured, and the SSO providers
    // carry the "Requires activation key" chip.
    for (const row of providerRows) {
      const badges = await row.findAll(".test-setup-card-badge", e => e.getText());
      const text = await row.getText();
      if (text.includes("getgrist")) {
        assert.deepEqual(badges, ["Recommended"]);
      } else if (/OIDC|SAML/.test(text)) {
        assert.deepEqual(badges, ["Requires activation key"]);
      } else {
        assert.lengthOf(badges, 0);
      }
    }
  });

  it("unconfigured providers should open their configure modal on click", async function() {
    // OIDC and SAML require an activation key (their click opens the
    // key-request modal instead), so exercise the configure modal on the others.
    for (const name of [/Sign in with getgrist/, /Forwarded headers/]) {
      const row = await driver.findContent(".test-admin-auth-provider-row", name);
      await row.click();

      const modalHeader = await driver.findWait(".test-admin-auth-modal-header", 2000);
      assert.isTrue(await modalHeader.isDisplayed());

      const cancelButton = await driver.find(".test-admin-auth-modal-cancel");
      await cancelButton.click();

      await gu.checkForErrors();

      await driver.wait(async () => {
        const modals = await driver.findAll(".test-admin-auth-modal-header");
        return modals.length === 0;
      }, 100);
    }
  });

  it("OIDC and SAML should open the activation-key modal on click", async function() {
    const oidcRow = await driver.findContent(".test-admin-auth-provider-row", /OIDC/);
    await oidcRow.click();
    await driver.findWait(".test-admin-auth-key-modal", 2000);
    // "I have a key" is a plain link to where the key is entered (Admin Panel > Edition).
    const goEdition = await driver.find(".test-admin-auth-key-modal-go-edition");
    assert.match(await goEdition.getAttribute("href") ?? "", /\/admin#edition$/);
    await driver.find(".test-admin-auth-key-modal-close").click();
    await gu.checkForErrors();
  });

  async function restartAdmin() {
    await server.restart();
    await server.simulateLogin(user.name, user.email, "docs");
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await toggleItem("authentication");
  }

  it("should detect misconfigured oidc configuration", async function() {
    // This is minimal thing to make Grist think that OIDC is configured.
    process.env.GRIST_OIDC_IDP_ISSUER = "invalid-url";
    // Now after restarting, Grist should noticed that we attempted to configure OIDC, but failed.
    await restartAdmin();

    // OIDC is the active method, so it is the hero card; it should be flagged
    // as misconfigured there, with a message about the required env vars.
    await gu.waitToPass(async () => {
      assert.match(await heroCard().getText(), /OIDC/);
      assert.includeMembers(await heroBadges(), ["Error"]);
      assert.include(await heroError().getText(), "GRIST_OIDC_");
    }, 1000);

    // The label says "auth error" now (as no valid login is possible).
    assert.equal(await itemValue("authentication"), "auth error");

    // Also check other 2 providers we know about.
    assert.deepEqual(await badges("SAML"), ["Requires activation key"]);
    assert.deepEqual(await badges("Forwarded headers"), []);
  });

  it("should detect properly configured oidc provider", async function() {
    // Configure OIDC provider properly with all required environment variables, it will
    // fail during initialization phase, but from the UI perspective it is properly configured.
    process.env.GRIST_OIDC_IDP_ISSUER = "https://maybe.valid.issu.er";
    process.env.GRIST_OIDC_IDP_CLIENT_ID = "test-client-id";
    process.env.GRIST_OIDC_IDP_CLIENT_SECRET = "test-client-secret";
    process.env.GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT = "true";
    process.env.GRIST_OIDC_SP_HOST = "localhost";

    // Restart to pick up the new configuration.
    await restartAdmin();

    // We now see that there is some auth error, as OIDC appears to be configured, nothing is selected by the
    // user so this was picked as the active method, but the test OIDC server is not responding properly.
    await gu.waitToPass(async () => {
      assert.equal(await itemValue("authentication"), "auth error");
    });

    assert.match(await heroCard().getText(), /OIDC/);
    assert.includeMembers(await heroBadges(), ["Error"]);

    // Other providers should remain unchanged.
    assert.deepEqual(await badges("SAML"), ["Requires activation key"]);
    assert.deepEqual(await badges("Forwarded headers"), []);
  });

  it("should offer to switch to other configured providers", async function() {
    // Now let's configure another provider (ForwardAuth is simpler than SAML)
    process.env.GRIST_FORWARD_AUTH_HEADER = "x-forwarded-user";
    process.env.GRIST_FORWARD_AUTH_LOGOUT_PATH = "/logout";

    // Restart to pick up the new configuration
    await restartAdmin();

    // OIDC should still be active (but with error), as the hero.
    assert.match(await heroCard().getText(), /OIDC/);
    assert.includeMembers(await heroBadges(), ["Error"]);

    // ForwardAuth should now be configured; clicking its card (next test)
    // stages it as the new active method.
    await gu.waitToPass(async () => {
      assert.deepEqual(await badges("Forwarded headers"), ["Configured"]);
    }, 1000);

    // SAML should still be unconfigured
    assert.deepEqual(await badges("SAML"), ["Requires activation key"]);
  });

  it("should switch to ForwardAuth provider", async function() {
    // Clicking a configured provider's card stages it as the active method.
    await (await providerRow("Forwarded headers")).click();

    // Confirm the "Set as active method?" modal.
    const confirmButton = await driver.findWait(".test-modal-confirm", 2000);
    await confirmButton.click();
    await gu.waitForServer();

    // ForwardAuth is now the staged hero (dropped from the list while pending).
    assert.match(await heroCard().getText(), /Forwarded headers/);
    assert.includeMembers(await heroBadges(), ["Active on restart"]);

    // OIDC should still be configured, and disabled on restart
    const oidcBadges = await badges("OIDC");
    assert.includeMembers(oidcBadges, ["Disabled on restart"]);

    // The staged transition can be reverted from the hero card.
    assert.isTrue(await driver.find(".test-admin-auth-hero-revert").isPresent());
  });
});

const providerRow = (text: string) => new WebElementPromise(driver,
  expandProviderList().then(() =>
    driver.findContentWait(".test-admin-auth-provider-row", text, 1000),
  ));

const badges = (text: string) => providerRow(text).findAll(".test-setup-card-badge", e => e.getText());

const heroCard = () => driver.findWait(".test-admin-auth-hero-card", 2000);

const heroBadges = () => driver.findAll(".test-admin-auth-hero-card .test-setup-card-badge", e => e.getText());

const heroError = () => driver.find(".test-admin-auth-hero-error");
