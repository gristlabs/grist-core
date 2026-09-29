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
// The UI should promote pyodide as the hero card and show an "Error" badge on gVisor.
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
// The UI should show gvisor as the hero with an Error badge, radios disabled,
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

// GRIST_SANDBOX_FLAVOR=unsandboxed: env-locked on a flavor the wizard would not
// preselect on its own, so nothing can be picked and the step must still be passable.
const FIXTURE_ENV_LOCKED_UNSANDBOXED: BootProbeResult = {
  ...FIXTURE_GVISOR_RECOMMENDED,
  details: { ...FIXTURE_GVISOR_RECOMMENDED.details, flavorInEnv: "unsandboxed" },
};

// The same server as FIXTURE_GVISOR_RECOMMENDED, except the admin explicitly chose
// to run unsandboxed (flavorInDB): the choice, not the recommendation, takes the hero.
const FIXTURE_CHOSE_UNSANDBOXED: BootProbeResult = {
  ...FIXTURE_GVISOR_RECOMMENDED,
  details: { ...FIXTURE_GVISOR_RECOMMENDED.details, flavorInDB: "unsandboxed" },
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
    assert.include(hero.badges, "Recommended");
    assert.include(hero.badges, "Ready");
    assert.notInclude(hero.badges, "Active");
    assert.isTrue(hero.checked);

    // Pyodide should be selectable, macSandboxExec disabled.
    // Sort order: pyodide(1), macSandboxExec(2), then No sandbox muted last (3).
    const pyodide = await flavorAt(1);
    assert.include(pyodide.header, "Pyodide");
    assert.isFalse(pyodide.disabled);

    const mac = await flavorAt(2);
    assert.include(mac.header, "macOS sandbox");
    assert.isTrue(mac.disabled);

    // The running-but-unchosen fallback stays quiet: muted, unchecked, unmarked.
    const unsandboxed = await flavorAt(3);
    assert.include(unsandboxed.header, "No sandbox");
    assert.isFalse(unsandboxed.checked);
    assert.notInclude(unsandboxed.badges, "Active");

    assert.include(await buttonText(), "Apply and Continue");
    assert.isFalse(await buttonDisabled());
  });

  it("should show other options with badges", async function() {
    await navigateToSandboxStep();

    const mac = await flavorAt(2);
    assert.include(mac.badges, "Not available");

    // The muted "No sandbox" card keeps its warning chip, but no Active mark.
    const unsandboxed = await flavorAt(3);
    assert.include(unsandboxed.badges, "Not recommended");
    assert.notInclude(unsandboxed.badges, "Active");

    // The wizard's list header is static: clicking it does not collapse the list.
    await driver.find(".test-sandbox-section-others-header").click();
    assert.isNotEmpty(await driver.findAll(".test-sandbox-section-flavor-1"));
  });

  it("should not stage anything in the admin panel", async function() {
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await driver.find(".test-admin-panel-item-name-sandboxing").click();

    // The state surface: the running (unchosen) fallback leads, quiet --
    // nothing selected, and no pending-changes banner appears uninvited.
    await gu.waitToPass(async () => {
      const hero = await flavorAt(0);
      assert.include(hero.header, "No sandbox");
      assert.notInclude(hero.badges, "Active");
      assert.isFalse(hero.checked);
    }, 8000);
    assert.notMatch(await driver.find("body").getText(), /Restart Grist to apply/);
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

    // gVisor sorts last among real options (not functional).
    const gvisor = await flavorAt(1);
    assert.include(gvisor.header, "gVisor");
    assert.include(gvisor.badges, "Error");
  });

  it("should show error on hero when env-locked sandbox is broken", async function() {
    setProbeFixture(FIXTURE_CURRENT_HAS_ERROR);
    await server.restart();
    await gu.session().personalSite.login();
    await navigateToSandboxStep();

    const hero = await flavorAt(0);
    assert.include(hero.header, "gVisor");
    assert.include(hero.badges, "Error");
    assert.isTrue(hero.disabled);

    assert.isTrue(await hasEnvWarning());
  });

  it("should fall back to unsandboxed as hero when nothing else is available", async function() {
    setProbeFixture(FIXTURE_ONLY_UNSANDBOXED);
    await server.restart();
    await gu.session().personalSite.login();
    await navigateToSandboxStep();

    // With no alternative to recommend and no choice made, nothing is checked
    // and Continue waits for an explicit choice.
    const hero = await flavorAt(0);
    assert.include(hero.header, "No sandbox");
    assert.notInclude(hero.badges, "Active");
    assert.isFalse(hero.checked);
    assert.isTrue(await buttonDisabled());

    // Explicitly choosing it unlocks Continue (nothing to apply: it already runs).
    await driver.find(".test-sandbox-section-flavor-0").click();
    await gu.waitToPass(async () => {
      assert.isTrue((await flavorAt(0)).checked);
      assert.isFalse(await buttonDisabled());
    }, 2000);
    assert.notInclude(await buttonText(), "Apply");
  });

  describe("with unsandboxed explicitly chosen", function() {
    before(async function() {
      setProbeFixture(FIXTURE_CHOSE_UNSANDBOXED);
      await server.restart();
      await gu.session().personalSite.login();
    });

    it("should re-offer the recommendation in the wizard, unstaged", async function() {
      await navigateToSandboxStep();

      // The wizard leads with guidance over any fallback: the recommendation
      // is heroed but not selected, and proceeding takes a this-visit choice.
      const hero = await flavorAt(0);
      assert.include(hero.header, "gVisor");
      assert.include(hero.badges, "Recommended");
      assert.isFalse(hero.checked);
      assert.isTrue(await buttonDisabled());

      // The chosen fallback shows as the muted Active card at the end.
      const unsandboxed = await flavorAt(3);
      assert.include(unsandboxed.header, "No sandbox");
      assert.include(unsandboxed.badges, "Active");
      assert.isFalse(unsandboxed.checked);

      // Re-choosing it this visit unlocks a plain Continue (it already runs).
      await driver.find(".test-sandbox-section-flavor-3").click();
      await gu.waitToPass(async () => {
        assert.isFalse(await buttonDisabled());
      }, 2000);
      assert.notInclude(await buttonText(), "Apply");
    });

    it("should hero the choice in the admin panel, with a working Revert", async function() {
      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();
      // The probe fixture is canned, so seed the real saved pref the revert
      // will clear.
      await setSavedFlavor("unsandboxed");
      await driver.find(".test-admin-panel-item-name-sandboxing").click();

      // The state surface leads with the chosen state and offers Revert.
      await gu.waitToPass(async () => {
        const hero = await flavorAt(0);
        assert.include(hero.header, "No sandbox");
        assert.include(hero.badges, "Active");
      }, 8000);

      // With the state settled, "Other options" starts collapsed.
      assert.isEmpty(await driver.findAll(".test-sandbox-section-flavor-1"));

      await driver.find(".test-sandbox-section-revert").click();
      await gu.waitToPass(async () => {
        assert.isNull(await getSavedFlavor());
      }, 4000);
    });
  });

  it("should let the wizard proceed when env-locked to unsandboxed", async function() {
    setProbeFixture(FIXTURE_ENV_LOCKED_UNSANDBOXED);
    await server.restart();
    await gu.session().personalSite.login();
    await navigateToSandboxStep();

    assert.isTrue(await hasEnvWarning());

    // Nothing is selectable, so nothing is checked, but the step is not a dead end.
    const hero = await flavorAt(0);
    assert.isTrue(hero.disabled);
    assert.isFalse(hero.checked);
    assert.include(await buttonText(), "Skip and Continue");
    assert.isFalse(await buttonDisabled());
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
        await driver.find(".test-sandbox-section-others-header").click();
        await driver.findWait(`.test-sandbox-section-flavor-${index}`, 1000);
      }
    }
    const el = await driver.find(`.test-sandbox-section-flavor-${index}`);
    const header = await el.find(".test-setup-card-header").getText();
    const badgeEls = await el.findAll(".test-setup-card-badge");
    const badges = await Promise.all(badgeEls.map(b => b.getText()));
    // Every card's input is the presentational checkbox glyph.
    const radio = await el.find("input");
    const checked = (await radio.getAttribute("checked")) === "true";
    const disabled = (await radio.getAttribute("disabled")) === "true";
    return { header, badges, checked, disabled };
  }

  // Prefix API fetches with location.origin: the page's <base> points elsewhere,
  // so a relative URL would leave the session's origin (and its cookies) behind.

  /** Reads the saved GRIST_SANDBOX_FLAVOR from install prefs, via the browser session. */
  async function getSavedFlavor(): Promise<string | null> {
    // Note: executeAsyncScript serializes undefined to null.
    return driver.executeAsyncScript<string | null>(async (done: (v: string | null) => void) => {
      const resp = await fetch(location.origin + "/api/install/prefs", { credentials: "include" });
      done((await resp.json()).envVars?.GRIST_SANDBOX_FLAVOR ?? null);
    });
  }

  /** Saves GRIST_SANDBOX_FLAVOR into install prefs, via the browser session. */
  async function setSavedFlavor(flavor: string): Promise<void> {
    const status = await driver.executeAsyncScript(async (flavorArg: string, done: (v: number) => void) => {
      const resp = await fetch(location.origin + "/api/install/prefs", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envVars: { GRIST_SANDBOX_FLAVOR: flavorArg } }),
      });
      done(resp.status);
    }, flavor);
    assert.equal(status, 200);
  }

  /** Returns the continue button text. */
  async function buttonText() {
    return driver.find(".test-quick-setup-sandbox-continue").getText();
  }

  /** Returns whether the continue button is disabled. */
  async function buttonDisabled() {
    const btn = await driver.find(".test-quick-setup-sandbox-continue");
    return (await btn.getAttribute("disabled")) === "true";
  }

  /** Returns whether the env-lock warning is visible. */
  async function hasEnvWarning() {
    return driver.find(".test-sandbox-section-env-warning").isDisplayed();
  }
});
