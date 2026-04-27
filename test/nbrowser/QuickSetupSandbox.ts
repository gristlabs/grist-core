import { BootProbeResult } from "app/common/BootProbe";
import { SandboxInfo } from "app/common/SandboxInfo";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";

/**
 * In this test we can't really test the sandbox, so we will inject the probe result using test
 * environment variables and check that the UI responds to it as expected. Restarting is also not
 * possible, so here we just check if the UI renders correctly based on our assumption what the
 * probe result looks like, and we try to restart to make sure it shows error.
 */

const WORKS_AND_EFFECTIVE: Partial<SandboxInfo> = {
  available: true,
  effective: true,
  functional: true,
  configured: true,
  lastSuccessfulStep: "all",
};

const NOT_AVAILABLE: Partial<SandboxInfo> = {
  available: false,
};

const UNSANDBOXED: Partial<SandboxInfo> = {
  available: true,
  effective: false,
  functional: true,
  configured: false,
  lastSuccessfulStep: "none",
};

// A typical Linux server where gVisor (runsc) is installed and working.
// Pyodide also works, macOS sandbox is absent, and unsandboxed is always available.
// Current flavor is "unsandboxed" — simulates a fresh install before any choice is made.
const FIXTURE_GVISOR_RECOMMENDED: BootProbeResult = {
  status: "success",
  details: {
    options: [
      {
        flavor: "gvisor",
        ...WORKS_AND_EFFECTIVE,
      },
      {
        flavor: "pyodide",
        ...WORKS_AND_EFFECTIVE,
      },
      {
        flavor: "macSandboxExec",
        ...NOT_AVAILABLE,
        unavailableReason: "sandbox-exec not found (macOS only)",
      },
      {
        flavor: "unsandboxed",
        ...UNSANDBOXED,
      },
    ],
    current: "unsandboxed",
    // flavorInEnv and flavorInDB are not set
  },
};

// The sandbox flavor is set via the GRIST_SANDBOX_FLAVOR environment variable.
// The UI should show a warning that it can't be changed, disable all radios,
// and offer "Skip and Continue" instead of "Apply and Continue".
const FIXTURE_ENV_LOCKED: BootProbeResult = {
  status: "success",
  details: {
    options: [
      {
        flavor: "gvisor",
        ...WORKS_AND_EFFECTIVE,
      },
      {
        flavor: "pyodide",
        ...WORKS_AND_EFFECTIVE,
      },
      {
        flavor: "unsandboxed",
        ...UNSANDBOXED,
      },
    ],
    current: "gvisor",
    flavorInEnv: "gvisor",
  },
};

// gVisor is installed but broken (e.g. runsc crashes on start).
// The UI should promote pyodide as the hero card and show an "ERROR" badge on gVisor.
const FIXTURE_WITH_ERROR: BootProbeResult = {
  status: "warning",
  details: {
    options: [
      {
        flavor: "gvisor",
        ...WORKS_AND_EFFECTIVE, // but overridden by error details below
        functional: false,
        lastSuccessfulStep: "create",
        error: "runsc: exec failed: could not start sandbox",
      },
      {
        flavor: "pyodide",
        ...WORKS_AND_EFFECTIVE,
      },
      // No mac here
      {
        flavor: "unsandboxed",
        ...UNSANDBOXED,
      },
    ],
    current: "unsandboxed",
  },
};

// gVisor is set via GRIST_SANDBOX_FLAVOR env var but it's broken.
// The UI should show gvisor as the hero with an ERROR badge, radios disabled,
// and "Skip and Continue" since it's env-locked.
const FIXTURE_CURRENT_HAS_ERROR: BootProbeResult = {
  status: "warning",
  details: {
    options: [
      {
        flavor: "gvisor",
        ...WORKS_AND_EFFECTIVE,
        functional: false,
        lastSuccessfulStep: "create",
        error: "runsc: exec failed: could not start sandbox",
      },
      {
        flavor: "pyodide",
        ...WORKS_AND_EFFECTIVE,
      },
      {
        flavor: "unsandboxed",
        ...UNSANDBOXED,
      },
    ],
    current: "gvisor",
    flavorInEnv: "gvisor",
  },
};

// No real sandbox is available — only unsandboxed works.
// The UI should show unsandboxed as the hero card (with a warning indicator).
const FIXTURE_ONLY_UNSANDBOXED: BootProbeResult = {
  status: "warning",
  details: {
    options: [
      {
        flavor: "gvisor",
        ...NOT_AVAILABLE,
        unavailableReason: "runsc binary not found",
      },
      {
        flavor: "pyodide",
        ...NOT_AVAILABLE,
        unavailableReason: "Pyodide runtime not installed",
      },
      {
        flavor: "macSandboxExec",
        ...NOT_AVAILABLE,
        unavailableReason: "sandbox-exec not found (macOS only)",
      },
      {
        flavor: "unsandboxed",
        ...UNSANDBOXED,
      },
    ],
    current: "unsandboxed",
  },
};

describe("QuickSetupSandbox", function() {
  this.timeout(process.env.DEBUG ? "10m" : "20s");
  setupTestSuite();
  gu.bigScreen();

  let oldEnv: testUtils.EnvironmentSnapshot;

  afterEach(() => gu.checkForErrors());

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";
    process.env.GRIST_DEFAULT_EMAIL = gu.session().email;
    setProbeFixture(FIXTURE_GVISOR_RECOMMENDED);
    await server.restart(true);
    await gu.session().personalSite.login();
  });

  after(async function() {
    oldEnv.restore();
    await server.restart(true);
  });

  it("should show recommended sandbox as hero card", async function() {
    await navigateToSandboxStep();

    const hero = await flavorAt(0);
    assert.include(hero.header, "gVisor");
    assert.include(hero.tags, "RECOMMENDED");
    assert.isTrue(hero.checked);

    // Pyodide should be selectable, macSandboxExec disabled.
    // Sort order: pyodide(1), unsandboxed(2), macSandboxExec(3).
    const pyodide = await flavorAt(1);
    assert.include(pyodide.header, "Pyodide");
    assert.isFalse(pyodide.disabled);

    const mac = await flavorAt(3);
    assert.include(mac.header, "macOS Sandbox");
    assert.isTrue(mac.disabled);

    assert.include(await buttonText(), "Apply and Continue");
  });

  it("should show other options with badges", async function() {
    await navigateToSandboxStep();

    const unsandboxed = await flavorAt(2);
    assert.include(unsandboxed.badges, "NOT RECOMMENDED");

    const mac = await flavorAt(3);
    assert.include(mac.badges, "NOT AVAILABLE");
  });

  it("should disable radios when env-locked", async function() {
    setProbeFixture(FIXTURE_ENV_LOCKED);
    await server.restart();
    await gu.session().personalSite.login();
    await navigateToSandboxStep();

    assert.isTrue(await hasEnvWarning());

    const hero = await flavorAt(0);
    assert.isTrue(hero.disabled);

    const pyodide = await flavorAt(1);
    assert.isTrue(pyodide.disabled);

    assert.include(await buttonText(), "Skip and Continue");
  });

  it("should show error badge for broken sandbox", async function() {
    setProbeFixture(FIXTURE_WITH_ERROR);
    await server.restart();
    await gu.session().personalSite.login();
    await navigateToSandboxStep();

    // Hero should be pyodide (best functional+effective), not gvisor (broken).
    const hero = await flavorAt(0);
    assert.include(hero.header, "Pyodide");

    // gVisor should be last in "Other options" (not functional → sorted last).
    const gvisor = await flavorAt(2);
    assert.include(gvisor.header, "gVisor");
    assert.include(gvisor.badges, "ERROR");
  });

  it("should show error on hero when env-locked sandbox is broken", async function() {
    setProbeFixture(FIXTURE_CURRENT_HAS_ERROR);
    await server.restart();
    await gu.session().personalSite.login();
    await navigateToSandboxStep();

    const hero = await flavorAt(0);
    assert.include(hero.header, "gVisor");
    assert.include(hero.badges, "ERROR");
    assert.isTrue(hero.disabled);

    assert.isTrue(await hasEnvWarning());
  });

  it("should fall back to unsandboxed as hero when nothing else is available", async function() {
    setProbeFixture(FIXTURE_ONLY_UNSANDBOXED);
    await server.restart();
    await gu.session().personalSite.login();
    await navigateToSandboxStep();

    const hero = await flavorAt(0);
    assert.include(hero.header, "No Sandbox");
    assert.isTrue(hero.checked);

    assert.include(await buttonText(), "Continue");
  });

  async function navigateToSandboxStep() {
    await driver.get(`${server.getHost()}/admin/setup`);
    await driver.findWait(".test-stepper-step-1", 1000);
    await driver.find(".test-stepper-step-1").click();
    // Wait for the probe to load and cards to render with content.
    await gu.waitToPass(async () => {
      const header = await driver.find(".test-setup-card-hero .test-setup-card-header");
      assert.notEqual(await header.getText(), "");
    }, 5000);
  }

  function setProbeFixture(fixture: BootProbeResult) {
    process.env.GRIST_TEST_SANDBOX_PROVIDERS_PROBE_RESULT = JSON.stringify(fixture);
  }

  /** Returns info about the Nth card. 0 = hero, 1+ = items in "Other options" (auto-expanded). */
  async function flavorAt(index: number) {
    if (index > 0) {
      // Expand "Other options" if not already expanded.
      const items = await driver.findAll(`.test-sandbox-section-flavor-${index}`);
      if (items.length === 0) {
        await driver.findContent("div", /Other options/i).click();
        await driver.findWait(`.test-sandbox-section-flavor-${index}`, 1000);
      }
    }
    const el = await driver.find(`.test-sandbox-section-flavor-${index}`);
    const header = await el.find(".test-setup-card-header").getText();
    const badgeEls = await el.findAll(".test-setup-card-badge");
    const badges = await Promise.all(badgeEls.map(b => b.getText()));
    const tagEls = await el.findAll(".test-setup-card-tag");
    const tags = await Promise.all(tagEls.map(t => t.getText()));
    const radio = await el.find("input[type='radio']");
    const checked = (await radio.getAttribute("checked")) === "true";
    const disabled = (await radio.getAttribute("disabled")) === "true";
    return { header, badges, tags, checked, disabled };
  }

  /** Returns the continue button text. */
  async function buttonText() {
    return driver.find(".test-sandbox-section-continue").getText();
  }

  /** Returns whether the env-lock warning is visible. */
  async function hasEnvWarning() {
    return driver.find(".test-sandbox-section-env-warning").isDisplayed();
  }
});
