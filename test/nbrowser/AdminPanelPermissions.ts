import { InstallAPIImpl } from "app/common/InstallAPI";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("AdminPanelPermissions", function() {
  this.timeout(process.env.DEBUG ? "10m" : "30s");
  setupTestSuite();
  gu.bigScreen();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let session: gu.Session;
  let installApi: InstallAPIImpl;

  afterEach(() => gu.checkForErrors());

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";
    process.env.GRIST_DEFAULT_EMAIL = gu.session().email;
    await server.restart(true); // clear database
    session = await gu.session().personalSite.login();
    installApi = session.createApi(InstallAPIImpl);
  });

  after(async function() {
    oldEnv.restore();
    await server.restart(true);
  });

  // The grouped Default-permissions row reuses QuickSetup's card, so its
  // inner toggles render with the same `.test-permissions-setup-*` selectors
  // as the wizard. We expand the row first so getText() / clicks land on
  // visible elements (SectionItem uses a max-height transition).
  async function expandPermissionsItem() {
    await driver.findWait(".test-admin-panel-item-default-permissions", 3000);
    await driver.find(".test-admin-panel-item-name-default-permissions").click();
    // SectionItem uses a max-height transition; wait for the toggle label
    // to be visible (isDisplayed implies present) before interacting.
    await driver.wait(
      async () => driver.find(".test-permissions-setup-perm-orgCreationAnyone label").isDisplayed(),
      3000,
    );
  }

  it("groups the toggles under one Default-permissions row, omitting telemetry", async function() {
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    const item = await driver.findWait(".test-admin-panel-item-default-permissions", 3000);
    assert.equal(await item.isDisplayed(), true);
    // Status display should name a preset once loaded. With a clean DB
    // and no env overrides, the four permission defaults are on → preset
    // = "Open". Telemetry is excluded from this card (it lives in the
    // SupportGristPage instead) so its off-by-default state doesn't
    // disqualify the Open match. (The wizard applies "Recommended" on
    // load; the admin panel shows the actual server state.)
    await gu.waitToPass(async () => {
      assert.match(await item.getText(), /\b(Open|Recommended|Locked down|Custom)\b/);
    }, 3000);

    // The telemetry toggle is excluded from the admin panel's card.
    await expandPermissionsItem();
    assert.isFalse(await driver.find(".test-permissions-setup-perm-telemetry").isPresent());
    // The four permission toggles are still rendered.
    assert.isTrue(await driver.find(".test-permissions-setup-perm-orgCreationAnyone").isPresent());
    assert.isTrue(await driver.find(".test-permissions-setup-perm-personalOrgs").isPresent());
    assert.isTrue(await driver.find(".test-permissions-setup-perm-forceLogin").isPresent());
    assert.isTrue(await driver.find(".test-permissions-setup-perm-anonPlayground").isPresent());
  });

  it("flags a draft change and persists via apply-without-restart", async function() {
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await expandPermissionsItem();

    // Default for orgCreationAnyone is `true`. Flip it off.
    assert.isTrue(await isToggleChecked("orgCreationAnyone"));
    await driver.find(".test-permissions-setup-perm-orgCreationAnyone label").click();
    assert.isFalse(await isToggleChecked("orgCreationAnyone"));

    // Restart banner should now show a Permissions entry naming the change.
    // The banner uses a grid-template-rows reveal transition, so wait for
    // text to become visible (zero-height during the transition makes
    // getText() return '').
    const banner = await driver.findWait(".test-admin-panel-draft-changes", 2000);
    await gu.waitToPass(async () => {
      const text = await banner.getText();
      assert.match(text, /Permissions/);
      assert.match(text, /Allow anyone to create team sites/);
    }, 3000);

    // In test mode the server can't auto-restart, so the manual-restart
    // button is exposed. Clicking it routes through DraftChangesManager,
    // which calls the model's apply() — the path we want to verify.
    await driver.findWait(".test-admin-panel-apply-no-restart", 3000);
    await gu.waitToPass(async () => {
      await driver.find(".test-admin-panel-apply-no-restart").click();
    }, 3000);

    // After apply, the draft list should clear (the change is committed
    // to install prefs in the DB).
    await gu.waitToPass(async () => {
      assert.isFalse(await driver.find(".test-admin-panel-draft-changes").isPresent());
    }, 5000);

    // Install prefs only land in process.env on the next server start, so
    // a restart is required before getPermissionsStatus reflects them.
    await server.restart();
    session = await gu.session().personalSite.login();
    installApi = session.createApi(InstallAPIImpl);

    const status = await installApi.getPermissionsStatus();
    assert.equal(status.orgCreationAnyone.value, false);
    assert.equal(status.orgCreationAnyone.source, "preferences");
  });

  it("disables env-locked toggles and shows the env-var warning well", async function() {
    process.env.GRIST_FORCE_LOGIN = "true";
    await server.restart();
    session = await gu.session().personalSite.login();
    installApi = session.createApi(InstallAPIImpl);

    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await expandPermissionsItem();

    // The forceLogin toggle should be disabled and carry the Environment badge.
    const input = await driver.find(".test-permissions-setup-perm-forceLogin input");
    assert.isNotNull(await input.getAttribute("disabled"));
    assert.isTrue(await driver
      .find(".test-permissions-setup-perm-forceLogin .test-permissions-setup-env-badge")
      .isPresent());

    // The env-warning well should mention the locked env var.
    const warning = await driver.find(".test-permissions-setup-env-warning");
    await gu.waitToPass(async () => {
      assert.match(await warning.getText(), /GRIST_FORCE_LOGIN/);
    }, 3000);

    // Other toggles should still be enabled.
    const teamInput = await driver.find(".test-permissions-setup-perm-orgCreationAnyone input");
    assert.isNull(await teamInput.getAttribute("disabled"));

    delete process.env.GRIST_FORCE_LOGIN;
    await server.restart();
  });

  // With personal sites off and no team site, /welcome/teams used to render an empty list of
  // sites, which reads as a broken Grist.
  describe("welcome page with personal sites off", function() {
    before(async function() {
      process.env.GRIST_PERSONAL_ORGS = "false";
      // Restrict team creation too, so the non-admin case is reachable.
      process.env.GRIST_ORG_CREATION_ANYONE = "false";
      await server.restart(true); // clear database
    });

    after(async function() {
      delete process.env.GRIST_PERSONAL_ORGS;
      delete process.env.GRIST_ORG_CREATION_ANYONE;
      await server.restart(true);
    });

    // There is no personal site to log into with personal sites off, so attach the session
    // profile to no org at all rather than going through gu.Session.
    async function loginAs(user: gu.TestUser) {
      const { name, email } = gu.translateUser(user);
      await gu.simulateLogin(name, email);
      await driver.get(`${server.getHost()}/welcome/teams`);
    }

    it("points the install admin at creating a team site", async function() {
      await loginAs("user1");
      const panel = await driver.findWait(".test-welcome-no-sites", 3000);
      assert.match(await panel.getText(), /Personal sites are turned off/);
      // Admins are exempt from GRIST_ORG_CREATION_ANYONE, so they get the button.
      assert.isTrue(await driver.find(".test-welcome-create-team-site").isPresent());
    });

    it("tells other users to ask an admin", async function() {
      await loginAs("user2");
      await driver.findWait(".test-welcome-no-sites", 3000);
      assert.isFalse(await driver.find(".test-welcome-create-team-site").isPresent());
      assert.match(await driver.find(".test-welcome-ask-admin").getText(), /Ask an administrator/);
    });

    it("tells signed-out visitors to sign in", async function() {
      await gu.removeLogin();
      await driver.get(`${server.getHost()}/welcome/teams`);
      const panel = await driver.findWait(".test-welcome-no-sites", 3000);
      assert.isTrue(await driver.find(".test-welcome-sign-in").isPresent());
      // Nothing about how the installation is configured, which they cannot act on.
      assert.notMatch(await panel.getText(), /Personal sites are turned off/);
      assert.isFalse(await driver.find(".test-welcome-ask-admin").isPresent());
      assert.isFalse(await driver.find(".test-welcome-create-team-site").isPresent());
    });
  });

  // Signing out is the same dead end with personal sites on: the page used to greet anonymous
  // visitors with "Welcome back" and offer anon@getgrist.com as a site to enter.
  describe("welcome page when signed out", function() {
    before(async function() {
      process.env.GRIST_PERSONAL_ORGS = "true";
      await server.restart(true); // clear database
    });

    it("offers sign-in rather than a list of nothing", async function() {
      await gu.removeLogin();
      await driver.get(`${server.getHost()}/welcome/teams`);
      const panel = await driver.findWait(".test-welcome-no-sites", 3000);
      assert.isTrue(await driver.find(".test-welcome-sign-in").isPresent());
      assert.notMatch(await panel.getText(), /Welcome back|anon@getgrist.com/);
    });
  });

  async function isToggleChecked(permKey: string): Promise<boolean> {
    const el = await driver.find(`.test-permissions-setup-perm-${permKey} label`);
    const cls = await el.getAttribute("class");
    return cls.includes("--checked");
  }
});
