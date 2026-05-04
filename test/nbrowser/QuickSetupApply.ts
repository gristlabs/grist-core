import { InstallAPIImpl } from "app/common/InstallAPI";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("QuickSetupApply", function() {
  this.timeout(process.env.DEBUG ? "10m" : "20s");
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

  it("should default to Recommended preset and apply presets correctly", async function() {
    await navigateToStep();

    // Should start with "Recommended" preset active.
    assert.isTrue(await isPresetActive("recommended"));
    assert.isFalse(await isToggleChecked("orgCreationAnyone"));
    assert.isTrue(await isToggleChecked("personalOrgs"));
    assert.isTrue(await isToggleChecked("forceLogin"));
    assert.isFalse(await isToggleChecked("anonPlayground"));

    // No env badges, env warning, or single-org warning should be visible.
    assert.isFalse(await driver.find(".test-permissions-setup-env-warning").isPresent());
    assert.isFalse(await driver.find(".test-permissions-setup-single-org-warning").isPresent());
    assert.lengthOf(await driver.findAll(".test-permissions-setup-env-badge"), 0);

    // Click "Open" preset — all toggles should be on.
    await driver.find(".test-permissions-setup-preset-open").click();
    assert.isTrue(await isToggleChecked("orgCreationAnyone"));
    assert.isTrue(await isToggleChecked("personalOrgs"));
    assert.isTrue(await isToggleChecked("forceLogin"));
    assert.isTrue(await isToggleChecked("anonPlayground"));

    // Click "Locked down" preset — all toggles should be off.
    await driver.find(".test-permissions-setup-preset-locked").click();
    assert.isFalse(await isToggleChecked("orgCreationAnyone"));
    assert.isFalse(await isToggleChecked("personalOrgs"));
    assert.isFalse(await isToggleChecked("forceLogin"));
    assert.isFalse(await isToggleChecked("anonPlayground"));
  });

  it("should return defaults before any permissions are saved", async function() {
    const status = await installApi.getPermissionsStatus();
    assert.equal(status.orgCreationAnyone.value, true);
    assert.equal(status.orgCreationAnyone.source, undefined);
    assert.equal(status.personalOrgs.value, true);
    assert.equal(status.personalOrgs.source, undefined);
    assert.equal(status.forceLogin.value, false);
    assert.equal(status.forceLogin.source, undefined);
    assert.equal(status.anonPlayground.value, true);
    assert.equal(status.anonPlayground.source, undefined);
  });

  it("should report env-locked toggles via API and disable them in UI", async function() {
    // Set some vars via real environment and restart.
    process.env.GRIST_FORCE_LOGIN = "true";
    process.env.GRIST_ANON_PLAYGROUND = "false";
    await server.restart();
    session = await gu.session().personalSite.login();

    // API should report those as environment-variable source.
    const status = await installApi.getPermissionsStatus();
    assert.equal(status.forceLogin.value, true);
    assert.equal(status.forceLogin.source, "environment-variable");
    assert.equal(status.anonPlayground.value, false);
    assert.equal(status.anonPlayground.source, "environment-variable");
    // The others should still be defaults (no source).
    assert.equal(status.orgCreationAnyone.source, undefined);
    assert.equal(status.personalOrgs.source, undefined);

    // UI should show env-locked toggles as disabled with "Environment" badges.
    await navigateToStep();
    assert.isTrue(await isToggleDisabled("forceLogin"));
    assert.isTrue(await isToggleDisabled("anonPlayground"));
    assert.isFalse(await isToggleDisabled("orgCreationAnyone"));
    assert.isFalse(await isToggleDisabled("personalOrgs"));

    // Should show "Environment" badges on locked toggles only.
    assert.lengthOf(await driver.findAll(".test-permissions-setup-env-badge"), 2);
    assert.isTrue(await hasBadge("forceLogin"));
    assert.isTrue(await hasBadge("anonPlayground"));
    assert.isFalse(await hasBadge("orgCreationAnyone"));
    assert.isFalse(await hasBadge("personalOrgs"));

    // Should show the env warning well.
    assert.isTrue(await driver.find(".test-permissions-setup-env-warning").isPresent());

    // Restore env and restart for subsequent tests.
    delete process.env.GRIST_FORCE_LOGIN;
    delete process.env.GRIST_ANON_PLAYGROUND;
    await server.restart();
  });

  it("should show conflict when GRIST_SINGLE_ORG=docs", async function() {
    process.env.GRIST_SINGLE_ORG = "docs";
    await server.restart();
    await navigateToStep();

    // personalOrgs should be forced ON — the personal org is the only org
    // when GRIST_SINGLE_ORG=docs. The toggle stays enabled so the user can
    // change it, but the Conflict badge and warning well inform them.
    assert.isTrue(await isToggleChecked("personalOrgs"));
    assert.isFalse(await isToggleDisabled("personalOrgs"));

    // Should show a "Conflict" badge on personalOrgs only.
    assert.isTrue(await hasConflictBadge("personalOrgs"));
    assert.isFalse(await hasConflictBadge("orgCreationAnyone"));
    assert.isFalse(await hasConflictBadge("forceLogin"));
    assert.isFalse(await hasConflictBadge("anonPlayground"));

    // Other toggles should remain normal (not disabled, no badges).
    assert.isFalse(await isToggleDisabled("orgCreationAnyone"));
    assert.isFalse(await isToggleDisabled("forceLogin"));
    assert.isFalse(await isToggleDisabled("anonPlayground"));
    assert.lengthOf(await driver.findAll(".test-permissions-setup-env-badge"), 0);

    // Single-org warning should explain the conflict.
    const warning = await driver.find(".test-permissions-setup-single-org-warning");
    assert.isTrue(await warning.isDisplayed());
    assert.include(await warning.getText(), "GRIST_SINGLE_ORG=docs");
    assert.include(await warning.getText(), "personal");

    // No env warning (singleOrg is not an env-locked toggle).
    assert.isFalse(await driver.find(".test-permissions-setup-env-warning").isPresent());

    // Restore and restart for subsequent tests.
    delete process.env.GRIST_SINGLE_ORG;
    await server.restart();
  });

  it("should show warning when GRIST_SINGLE_ORG is a non-docs value", async function() {
    process.env.GRIST_SINGLE_ORG = "myteam";
    await server.restart();
    session = await gu.session().personalSite.login();
    await navigateToStep();

    // Single-org warning should be shown with the value.
    const warning = await driver.find(".test-permissions-setup-single-org-warning");
    assert.isTrue(await warning.isDisplayed());
    assert.include(await warning.getText(), "GRIST_SINGLE_ORG=myteam");

    // No conflict badge — conflict only applies to docs.
    assert.isFalse(await hasConflictBadge("personalOrgs"));
    assert.isFalse(await hasConflictBadge("orgCreationAnyone"));
    assert.isFalse(await hasConflictBadge("forceLogin"));
    assert.isFalse(await hasConflictBadge("anonPlayground"));

    // No env badges.
    assert.lengthOf(await driver.findAll(".test-permissions-setup-env-badge"), 0);
    assert.isFalse(await driver.find(".test-permissions-setup-env-warning").isPresent());

    // All toggles should be enabled (not disabled).
    assert.isFalse(await isToggleDisabled("orgCreationAnyone"));
    assert.isFalse(await isToggleDisabled("personalOrgs"));
    assert.isFalse(await isToggleDisabled("forceLogin"));
    assert.isFalse(await isToggleDisabled("anonPlayground"));

    // Recommended preset should still be active.
    assert.isTrue(await isPresetActive("recommended"));

    // Restore and restart for subsequent tests.
    delete process.env.GRIST_SINGLE_ORG;
    await server.restart();
  });

  it("should save permissions and show restart error", async function() {
    await (await gu.session().personalSite.login()).loadDocMenu("/");
    // Before saving, all permissions should be at defaults (no source).
    const before = await installApi.getPermissionsStatus();
    assert.isUndefined(before.orgCreationAnyone.source);
    assert.isUndefined(before.personalOrgs.source);
    assert.isUndefined(before.forceLogin.source);
    assert.isUndefined(before.anonPlayground.source);

    await navigateToStep();

    // Select "Open" preset (differs from defaults) and click Go Live.
    await driver.find(".test-permissions-setup-preset-open").click();
    await driver.find(".test-permissions-setup-go-live").click();

    // In test mode the server can't auto-restart, so the UI shows the error.
    await gu.waitToPass(async () => {
      assert.include(
        await driver.find(".test-permissions-setup-section").getText(),
        "Cannot automatically restart",
      );
    }, 5000);

    // Do manual restart to apply settings for subsequent tests.
    await server.restart();
    session = await gu.session().personalSite.login();
    installApi = session.createApi(InstallAPIImpl);

    // Even though restart failed, settings should have been persisted to DB.
    const status = await installApi.getPermissionsStatus();
    assert.equal(status.orgCreationAnyone.value, true);
    assert.equal(status.orgCreationAnyone.source, "preferences");
    assert.equal(status.personalOrgs.value, true);
    assert.equal(status.personalOrgs.source, "preferences");
    assert.equal(status.forceLogin.value, false);
    assert.equal(status.forceLogin.source, "preferences");
    assert.equal(status.anonPlayground.value, true);
    assert.equal(status.anonPlayground.source, "preferences");
  });

  async function navigateToStep() {
    await driver.get(`${server.getHost()}/admin/setup`);
    await driver.findWait(".test-stepper-step-4", 1000);
    await driver.find(".test-stepper-step-4").click();
    await gu.waitToPass(async () => {
      assert.include(
        await driver.find(".test-permissions-setup-section").getText(),
        "Apply & Restart",
      );
    }, 1000);
  }

  async function isPresetActive(preset: string): Promise<boolean> {
    const cls = await driver.find(`.test-permissions-setup-preset-${preset}`).getAttribute("class");
    return cls.includes("active");
  }

  async function isToggleChecked(permKey: string): Promise<boolean> {
    const el = await driver.find(`.test-permissions-setup-perm-${permKey} label`);
    const cls = await el.getAttribute("class");
    return cls.includes("--checked");
  }

  async function isToggleDisabled(permKey: string): Promise<boolean> {
    const input = await driver.find(`.test-permissions-setup-perm-${permKey} input`);
    return input.getAttribute("disabled").then(v => v !== null);
  }

  async function hasBadge(permKey: string): Promise<boolean> {
    return driver.find(`.test-permissions-setup-perm-${permKey} .test-permissions-setup-env-badge`).isPresent();
  }

  async function hasConflictBadge(permKey: string): Promise<boolean> {
    return driver.find(`.test-permissions-setup-perm-${permKey} .test-permissions-setup-conflict-badge`).isPresent();
  }
});
