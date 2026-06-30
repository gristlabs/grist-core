import { BootProbeResult } from "app/common/BootProbe";
import { InstallAPIImpl } from "app/common/InstallAPI";
import { SandboxInfo } from "app/common/SandboxInfo";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";

/**
 * Verifies that the Sandboxing row in the admin panel is a real
 * configurable section (not the old read-only probe display). Mirrors
 * QuickSetupSandbox.ts but exercises the panel-level DraftChangesManager
 * path: pick a flavor -> restart banner shows the draft -> apply persists
 * via install prefs.
 *
 * We can't actually restart into the new flavor in tests, so we verify the
 * persisted env-var override via getInstallPrefs and re-read after a fresh
 * server restart -- same approach as AdminPanelPermissions.
 */

const WORKS_AND_EFFECTIVE: Partial<SandboxInfo> = {
  available: true,
  effective: true,
  functional: true,
  configured: true,
  lastSuccessfulStep: "all",
};

const UNSANDBOXED: Partial<SandboxInfo> = {
  available: true,
  effective: false,
  functional: true,
  configured: false,
  lastSuccessfulStep: "none",
};

// gVisor + pyodide both functional; current is unsandboxed (fresh install).
const FIXTURE_GVISOR_AND_PYODIDE: BootProbeResult = {
  status: "success",
  details: {
    options: [
      { flavor: "gvisor", ...WORKS_AND_EFFECTIVE },
      { flavor: "pyodide", ...WORKS_AND_EFFECTIVE },
      { flavor: "unsandboxed", ...UNSANDBOXED },
    ],
    current: "unsandboxed",
  },
};

// GRIST_SANDBOX_FLAVOR is set in the env -- UI should disable radios and
// surface the env-locked warning.
const FIXTURE_ENV_LOCKED: BootProbeResult = {
  status: "success",
  details: {
    options: [
      { flavor: "gvisor", ...WORKS_AND_EFFECTIVE },
      { flavor: "pyodide", ...WORKS_AND_EFFECTIVE },
      { flavor: "unsandboxed", ...UNSANDBOXED },
    ],
    current: "gvisor",
    flavorInEnv: "gvisor",
  },
};

describe("AdminPanelSandbox", function() {
  this.timeout(process.env.DEBUG ? "10m" : "60s");
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
    process.env.GRIST_TEST_SANDBOX_PROVIDERS_PROBE_RESULT = JSON.stringify(FIXTURE_GVISOR_AND_PYODIDE);
    await server.restart(true); // clear database
    session = await gu.session().personalSite.login();
    installApi = session.createApi(InstallAPIImpl);
  });

  after(async function() {
    oldEnv.restore();
    await server.restart(true);
  });

  async function expandSandboxItem() {
    const header = await driver.findWait(".test-admin-panel-item-name-sandboxing", 3000);
    await gu.scrollIntoView(header);
    await header.click();
    // The heavy probe is mocked, but the section still loads it through the
    // probe pipeline -- wait for a hero card with a header to render.
    await gu.waitToPass(async () => {
      const card = await driver.find(
        ".test-admin-panel-item-sandboxing .test-setup-card-hero .test-setup-card-header",
      );
      assert.notEqual(await card.getText(), "");
    }, 5000);
  }

  // Click the collapsible "Other options" header once if its contents aren't
  // already rendered. The hero flavor (flavor-0) is always present; the rest
  // live inside the collapsible card list.
  async function revealOtherOptions(flavor: string) {
    const selector = `.test-admin-panel-item-sandboxing .test-sandbox-section-flavor-${flavor}`;
    if ((await driver.findAll(selector)).length === 0) {
      await driver.findContent(".test-admin-panel-item-sandboxing div", /Other options/i).click();
    }
    return driver.findWait(selector, 2000);
  }

  it("status badge resolves without expanding the row", async function() {
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    // The badge comes from the cheap `sandboxing` probe, which is the real
    // server-side check. On grist-core with no GRIST_SANDBOX_FLAVOR it reports
    // "unconfigured"; in some environments it may surface "Error: unknown".
    // Either way the badge resolves -- it doesn't sit on "checking" forever.
    await gu.waitToPass(async () => {
      assert.match(
        await driver.find(".test-admin-panel-item-value-sandboxing").getText(),
        /^((Error:.*)|(OK:.*)|(unconfigured))$/,
      );
    }, 5000);
  });

  it("renders hero card plus other options when expanded", async function() {
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await expandSandboxItem();

    // In admin panel mode the hero is the currently-running flavor. The
    // fixture sets current: "unsandboxed" (a fresh install scenario).
    const heroHeader = await driver.find(
      ".test-admin-panel-item-sandboxing .test-sandbox-section-flavor-0 .test-setup-card-header",
    ).getText();
    assert.include(heroHeader, "No Sandbox");

    // gVisor and Pyodide are reachable as non-hero options.
    const gvisor = await revealOtherOptions("gvisor");
    assert.include(await gvisor.find(".test-setup-card-header").getText(), "gVisor");
    const pyodide = await revealOtherOptions("pyodide");
    assert.include(await pyodide.find(".test-setup-card-header").getText(), "Pyodide");
  });

  it("flags a draft change in the restart banner when a flavor is picked", async function() {
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await expandSandboxItem();

    // The current flavor ("unsandboxed") is selected by default. No banner yet.
    assert.isFalse(await driver.find(".test-admin-panel-draft-changes").isPresent());

    const pyodide = await revealOtherOptions("pyodide");
    await pyodide.find("input[type='radio']").click();

    // Restart banner should now list Sandbox: Pyodide.
    const banner = await driver.findWait(".test-admin-panel-draft-changes", 3000);
    await gu.waitToPass(async () => {
      const text = await banner.getText();
      assert.match(text, /Sandbox/);
      assert.match(text, /Pyodide/);
    }, 3000);

    // Dismissing should clear the draft and the banner.
    await driver.find(".test-admin-panel-dismiss-button").click();
    await driver.findContentWait(".test-modal-confirm", /Dismiss/, 2000).click();
    await gu.waitToPass(async () => {
      assert.isFalse(await driver.find(".test-admin-panel-draft-changes").isPresent());
    }, 3000);
  });

  it("apply-without-restart persists the flavor via install prefs", async function() {
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await expandSandboxItem();

    const pyodide = await revealOtherOptions("pyodide");
    await pyodide.find("input[type='radio']").click();
    await driver.findWait(".test-admin-panel-draft-changes", 3000);

    // In test mode the server can't auto-restart, so the manual-apply
    // button is exposed. Click it; the install prefs should pick up the
    // GRIST_SANDBOX_FLAVOR override.
    await driver.findWait(".test-admin-panel-apply-no-restart", 3000);
    await gu.waitToPass(async () => {
      await driver.find(".test-admin-panel-apply-no-restart").click();
    }, 3000);
    await gu.waitToPass(async () => {
      assert.isFalse(await driver.find(".test-admin-panel-draft-changes").isPresent());
    }, 5000);

    const prefs = await installApi.getInstallPrefs();
    assert.equal(prefs.envVars?.GRIST_SANDBOX_FLAVOR, "pyodide");
  });

  it("env-locked installs disable the radios and show the warning", async function() {
    process.env.GRIST_TEST_SANDBOX_PROVIDERS_PROBE_RESULT = JSON.stringify(FIXTURE_ENV_LOCKED);
    await server.restart();
    session = await gu.session().personalSite.login();
    installApi = session.createApi(InstallAPIImpl);

    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await expandSandboxItem();

    assert.isTrue(await driver.find(
      ".test-admin-panel-item-sandboxing .test-sandbox-section-env-warning",
    ).isDisplayed());

    // Hero is the env-locked flavor (gvisor) and its radio is disabled.
    const heroRadio = await driver.find(
      ".test-admin-panel-item-sandboxing .test-sandbox-section-flavor-0 input[type='radio']",
    );
    assert.equal(await heroRadio.getAttribute("disabled"), "true");
  });
});
