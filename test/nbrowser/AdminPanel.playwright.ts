import {TelemetryLevel} from 'app/common/Telemetry';
import * as gu from 'test/nbrowser/playwrightGristUtils';
import {server, setupTestSuite} from 'test/nbrowser/playwrightTestUtils';
import {Defer, serveSomething, Serving} from 'test/server/customUtil';
import * as testUtils from 'test/server/testUtils';
import express from 'express';
import { expect, Locator, Page, test } from '@playwright/test';

test.describe('AdminPanel', function() {
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let fakeServer: FakeUpdateServer;

  test.afterEach(({ page }) => gu.checkForErrors(page));

  test.beforeAll(async ({ browser }) => {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = 'core';
    process.env.GRIST_DEFAULT_EMAIL = gu.session(await browser.newContext()).email;
    fakeServer = await startFakeServer();
    process.env.GRIST_TEST_VERSION_CHECK_URL = `${fakeServer.url()}/version`;
    await server.restart(true);
  });

  test.afterAll(async () => {
    await fakeServer.close();
    oldEnv.restore();
    await server.restart(true);
  });

  const loginNonAdminSession = async (page: Page) => {
    const session = gu.session(page.context()).user('user2').personalSite;
    await session.login();
    return session;
  };

  const loginAdminSession = async (page: Page) => {
    const session = gu.session(page.context()).personalSite;
    await session.login();
    return session;
  };

  test('should show an explanation to non-managers', async ({ page }) => {
    const session = await loginNonAdminSession(page);

    await session.loadDocMenu(page, '/');
    await gu.openAccountMenu(page);

    await expect(page.locator('css=.test-usermenu-admin-panel')).not.toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('css=.test-dm-admin-panel')).not.toBeVisible();

    // Try loading the URL directly.
    await page.goto(`${server.getHost()}/admin`);
    await waitForAdminPanel(page);
    await expect(page.locator('css=.test-admin-panel')).toBeVisible();
    await expect(page.locator('css=.test-admin-panel')).toContainText(/Administrator Panel Unavailable/);
  });

  test('should be shown to managers', async ({ page }) => {
    const session = await loginAdminSession(page);
    console.log(process.env.GRIST_DEFAULT_EMAIL);
    console.log(session.email);

    await session.loadDocMenu(page, '/');
    await expect(page.locator('css=.test-dm-admin-panel')).toBeVisible();
    expect(await page.locator('css=.test-dm-admin-panel').getAttribute('href')).toMatch(/\/admin$/);
    await gu.openAccountMenu(page);
    await expect(page.locator('css=.test-usermenu-admin-panel')).toBeVisible();
    expect(await page.locator('css=.test-usermenu-admin-panel').getAttribute('href')).toMatch(/\/admin$/);
    await page.locator('css=.test-usermenu-admin-panel').click();
    await waitForAdminPanel(page);
  });

  /*
  it('should include support-grist section', async function() {
    assert.match(page.locator('css=.test-admin-panel-item-sponsor').getText(), /Support Grist Labs on GitHub/);
    await withExpandedItem('sponsor', async () => {
      const button = page.locator('css=.test-support-grist-page-sponsorship-section');
      assert.equal(await button.isDisplayed(), true);
      assert.match(await button.getText(), /You can support Grist open-source/);
    });
  });

  it('supports opting in to telemetry from the page', async function() {
    await assertTelemetryLevel('off');

    let toggle = page.locator('css=.test-admin-panel-item-value-telemetry .widget_switch');
    assert.equal(await isSwitchOn(toggle), false);

    await withExpandedItem('telemetry', async () => {
      assert.isFalse(page.locator('css=.test-support-grist-page-telemetry-section-message').isPresent());
      await driver.findContentWait(
        '.test-support-grist-page-telemetry-section button', /Opt in to Telemetry/, 2000).click();
      await driver.findContentWait('.test-support-grist-page-telemetry-section button', /Opt out of Telemetry/, 2000);
      assert.equal(
        page.locator('css=.test-support-grist-page-telemetry-section-message').getText(),
        'You have opted in to telemetry. Thank you! 🙏'
      );
      assert.equal(await isSwitchOn(toggle), true);
    });

    // Check it's still on after collapsing.
    assert.equal(await isSwitchOn(toggle), true);

    // Reload the page and check that the Grist config indicates telemetry is set to "limited".
    await driver.navigate().refresh();
    await waitForAdminPanel();
    toggle = page.locator('css=.test-admin-panel-item-value-telemetry .widget_switch');
    assert.equal(await isSwitchOn(toggle), true);
    await toggleItem('telemetry');
    await driver.findContentWait('.test-support-grist-page-telemetry-section button', /Opt out of Telemetry/, 2000);
    assert.equal(
      await driver.findWait('.test-support-grist-page-telemetry-section-message', 2000).getText(),
      'You have opted in to telemetry. Thank you! 🙏'
    );
    await assertTelemetryLevel('limited');
  });

  it('supports opting out of telemetry from the page', async function() {
    await driver.findContent('.test-support-grist-page-telemetry-section button', /Opt out of Telemetry/).click();
    await driver.findContentWait('.test-support-grist-page-telemetry-section button', /Opt in to Telemetry/, 2000);
    assert.isFalse(page.locator('css=.test-support-grist-page-telemetry-section-message').isPresent());
    let toggle = page.locator('css=.test-admin-panel-item-value-telemetry .widget_switch');
    assert.equal(await isSwitchOn(toggle), false);

    // Reload the page and check that the Grist config indicates telemetry is set to "off".
    await driver.navigate().refresh();
    await waitForAdminPanel();
    await toggleItem('telemetry');
    await driver.findContentWait('.test-support-grist-page-telemetry-section button', /Opt in to Telemetry/, 2000);
    assert.isFalse(page.locator('css=.test-support-grist-page-telemetry-section-message').isPresent());
    await assertTelemetryLevel('off');
    toggle = page.locator('css=.test-admin-panel-item-value-telemetry .widget_switch');
    assert.equal(await isSwitchOn(toggle), false);
  });

  it('supports toggling telemetry from the toggle in the top line', async function() {
    const toggle = page.locator('css=.test-admin-panel-item-value-telemetry .widget_switch');
    assert.equal(await isSwitchOn(toggle), false);
    await toggle.click();
    await gu.waitForServer();
    assert.equal(await isSwitchOn(toggle), true);
    assert.match(page.locator('css=.test-support-grist-page-telemetry-section-message').getText(),
      /You have opted in/);
    await toggle.click();
    await gu.waitForServer();
    assert.equal(await isSwitchOn(toggle), false);
    await withExpandedItem('telemetry', async () => {
      assert.equal(page.locator('css=.test-support-grist-page-telemetry-section-message').isPresent(), false);
    });
  });

  it('shows telemetry opt-in status even when set via environment variable', async function() {
    // Set the telemetry level to "limited" via environment variable and restart the server.
    process.env.GRIST_TELEMETRY_LEVEL = 'limited';
    await server.restart();

    // Check that the Support Grist page reports telemetry is enabled.
    await driver.get(`${server.getHost()}/admin`);
    await waitForAdminPanel();
    const toggle = page.locator('css=.test-admin-panel-item-value-telemetry .widget_switch');
    assert.equal(await isSwitchOn(toggle), true);
    await toggleItem('telemetry');
    assert.equal(
      await driver.findWait('.test-support-grist-page-telemetry-section-message', 2000).getText(),
      'You have opted in to telemetry. Thank you! 🙏'
    );
    assert.isFalse(await driver.findContent('.test-support-grist-page-telemetry-section button',
      /Opt out of Telemetry/).isPresent());

    // Now set the telemetry level to "off" and restart the server.
    process.env.GRIST_TELEMETRY_LEVEL = 'off';
    await server.restart();

    // Check that the Support Grist page reports telemetry is disabled.
    await driver.get(`${server.getHost()}/admin`);
    await waitForAdminPanel();
    await toggleItem('telemetry');
    assert.equal(
      await driver.findWait('.test-support-grist-page-telemetry-section-message', 2000).getText(),
      'You have opted out of telemetry.'
    );
    assert.isFalse(await driver.findContent('.test-support-grist-page-telemetry-section button',
      /Opt in to Telemetry/).isPresent());
  });

  it('should show version', async function() {
    await driver.get(`${server.getHost()}/admin`);
    await waitForAdminPanel();
    assert.equal(page.locator('css=.test-admin-panel-item-version').isDisplayed(), true);
    assert.match(page.locator('css=.test-admin-panel-item-value-version').getText(), /^Version \d+\./);
  });

  it('should show sandbox', async function() {
    await driver.get(`${server.getHost()}/admin`);
    await waitForAdminPanel();
    assert.equal(page.locator('css=.test-admin-panel-item-sandboxing').isDisplayed(), true);
    await gu.waitToPass(
      // unknown for grist-saas, unconfigured for grist-core.
      async () => assert.match(page.locator('css=.test-admin-panel-item-value-sandboxing').getText(),
                               /^((unknown)|(unconfigured))/),
      3000,
    );
    // It would be good to test other scenarios, but we are using
    // a multi-server setup on grist-saas and the sandbox test isn't
    // useful there yet.
  });

  it('should show various self checks', async function() {
    await driver.get(`${server.getHost()}/admin`);
    await waitForAdminPanel();
    await gu.waitToPass(
      async () => {
        assert.equal(page.locator('css=.test-admin-panel-item-name-probe-reachable').isDisplayed(), true);
        assert.match(page.locator('css=.test-admin-panel-item-value-probe-reachable').getText(), /✅/);
      },
      3000,
    );
    assert.equal(page.locator('css=.test-admin-panel-item-name-probe-system-user').isDisplayed(), true);
    await gu.waitToPass(
      async () => assert.match(page.locator('css=.test-admin-panel-item-value-probe-system-user').getText(), /✅/),
      3000,
    );
  });

  const upperCheckNow = () => page.locator('css=.test-admin-panel-updates-upper-check-now');
  const lowerCheckNow = () => page.locator('css=.test-admin-panel-updates-lower-check-now');
  const autoCheckToggle = () => page.locator('css=.test-admin-panel-updates-auto-check');
  const updateMessage = () => page.locator('css=.test-admin-panel-updates-message');
  const versionBox = () => page.locator('css=.test-admin-panel-updates-version');
  function waitForStatus(message: RegExp) {
    return gu.waitToPass(async () => {
      assert.match(await updateMessage().getText(), message);
    });
  }

  it('should check for updates', async function() {
    // Clear any cached settings.
    await driver.executeScript('window.sessionStorage.clear(); window.localStorage.clear();');
    await driver.navigate().refresh();
    await waitForAdminPanel();

    // By default don't have any info.
    await waitForStatus(/No information available/);

    // We see upper check-now button.
    assert.isTrue(await upperCheckNow().isDisplayed());

    // We can expand.
    await toggleItem('updates');

    // We see a toggle to update automatically.
    assert.isTrue(await autoCheckToggle().isDisplayed());
    assert.isFalse(await isSwitchOn(autoCheckToggle()));

    // We can click it, Grist will turn on auto checks and do it right away.
    fakeServer.pause();
    await autoCheckToggle().click();
    assert.isTrue(await isSwitchOn(autoCheckToggle()));

    // It will first show "Checking for updates" message.
    // (Request is blocked by fake server, so it will not complete until we resume it.)
    await waitForStatus(/Checking for updates/);

    // Upper check now button is removed.
    assert.isFalse(await upperCheckNow().isPresent());

    // Resume server and respond.
    fakeServer.resume();

    // It will show "New version available" message.
    await waitForStatus(/Newer version available/);
    // And a version number.
    assert.isTrue(await versionBox().isDisplayed());
    assert.match(await versionBox().getText(), /Version 9\.9\.9/);

    // When we reload, we will auto check for updates.
    fakeServer.pause();
    fakeServer.latestVersion = await currentVersion();
    await driver.navigate().refresh();
    await waitForAdminPanel();
    await waitForStatus(/Checking for updates/);
    fakeServer.resume();
    await waitForStatus(/Grist is up to date/);

    // Disable auto-checks.
    await toggleItem('updates');
    assert.isTrue(await isSwitchOn(autoCheckToggle()));
    await autoCheckToggle().click();
    assert.isFalse(await isSwitchOn(autoCheckToggle()));
    // Nothing should happen.
    await waitForStatus(/Grist is up to date/);
    assert.isTrue(await versionBox().isDisplayed());
    assert.equal(await versionBox().getText(), `Version ${await currentVersion()}`);

    // Refresh to see if we are disabled.
    fakeServer.pause();
    await driver.navigate().refresh();
    await waitForAdminPanel();
    await waitForStatus(/Last checked .+ ago/);
    fakeServer.resume();
    // Expand and see if the toggle is off.
    await toggleItem('updates');
    assert.isFalse(await isSwitchOn(autoCheckToggle()));
  });

  it('shows up-to-date message', async function() {
    fakeServer.latestVersion = await currentVersion();
    // Click upper check now.
    await waitForStatus(/Last checked .+ ago/);
    await upperCheckNow().click();
    await waitForStatus(/Grist is up to date/);

    // Update version once again.
    fakeServer.latestVersion = '9.9.10';
    // Click lower check now.
    fakeServer.pause();
    await lowerCheckNow().click();
    await waitForStatus(/Checking for updates/);
    fakeServer.resume();
    await waitForStatus(/Newer version available/);

    // Make sure we see the new version.
    assert.isTrue(await versionBox().isDisplayed());
    assert.match(await versionBox().getText(), /Version 9\.9\.10/);
  });

  it('shows error message', async function() {
    fakeServer.failNext = true;
    fakeServer.pause();
    await lowerCheckNow().click();
    await waitForStatus(/Checking for updates/);
    fakeServer.resume();
    await waitForStatus(/Error checking for updates/);
    assert.match((await gu.getToasts())[0], /some error/);
    await gu.wipeToasts();
  });

  it('should send telemetry data', async function() {
    assert.deepEqual({...fakeServer.payload, installationId: 'test'}, {
      installationId: 'test',
      deploymentType: 'core',
      currentVersion: await currentVersion(),
    });
    assert.isNotEmpty(fakeServer.payload.installationId);
  });

  it('should survive APP_HOME_URL misconfiguration', async function() {
    process.env.APP_HOME_URL = 'http://misconfigured.invalid';
    process.env.GRIST_BOOT_KEY = 'zig';
    await server.restart(true);
    await driver.get(`${server.getHost()}/admin`);
    await waitForAdminPanel();
  });

  it('should honor GRIST_BOOT_KEY fallback', async function() {
    await gu.removeLogin();
    await driver.get(`${server.getHost()}/admin`);
    await waitForAdminPanel();
    assert.equal(page.locator('css=.test-admin-panel').isDisplayed(), true);
    assert.match(page.locator('css=.test-admin-panel').getText(), /Administrator Panel Unavailable/);

    process.env.GRIST_BOOT_KEY = 'zig';
    await server.restart(true);
    await driver.get(`${server.getHost()}/admin?boot-key=zig`);
    await waitForAdminPanel();
    assert.equal(page.locator('css=.test-admin-panel').isDisplayed(), true);
    assert.notMatch(page.locator('css=.test-admin-panel').getText(), /Administrator Panel Unavailable/);
    await driver.get(`${server.getHost()}/admin?boot-key=zig-wrong`);
    await waitForAdminPanel();
    assert.equal(page.locator('css=.test-admin-panel').isDisplayed(), true);
    assert.match(page.locator('css=.test-admin-panel').getText(), /Administrator Panel Unavailable/);
  });

   */
});

// @ts-ignore
async function assertTelemetryLevel(page: Page, level: TelemetryLevel) {
  const telemetryLevel = await page.evaluate(() => (window as any).gristConfig.telemetry?.telemetryLevel);
  expect(telemetryLevel).toEqual(level);
}

async function toggleItem(page: Page, itemId: string) {
  const header = await page.locator(`css=.test-admin-panel-item-name-${itemId}`);
  await header.click();
  // Playwright should handle waiting for expand/collapse
  return header;
}

// @ts-ignore
async function withExpandedItem(page: Page, itemId: string, callback: () => Promise<void>) {
  const header = await toggleItem(page, itemId);
  await callback();
  await header.click();
  // Playwright should wait for collapse.
}

// @ts-ignore
const isSwitchOn = async (switchElem: Locator) => await switchElem.locator('css=[class*=switch_on]').count() > 0;
const waitForAdminPanel = (page: Page) => page.locator('css=.test-admin-panel').waitFor();

interface FakeUpdateServer {
  latestVersion: string;
  failNext: boolean;
  payload: any;
  close: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  url: () => string;
}

async function startFakeServer() {
  let mutex: Defer|null = null;
  const API: FakeUpdateServer = {
    latestVersion: '9.9.9',
    failNext: false,
    payload: null,
    close: async () => {
      mutex?.resolve();
      mutex = null;
      await server?.shutdown();
      server = null;
    },
    pause: () => {
      mutex = new Defer();
    },
    resume: () => {
      mutex?.resolve();
      mutex = null;
    },
    url: () => {
      return server!.url;
    }
  };

  let server: Serving|null = await serveSomething((app) => {
    app.use(express.json());
    app.post('/version', async (req, res, next) => {
      API.payload = req.body;
      try {
        await mutex;
        if (API.failNext) {
          res.status(500).json({error: 'some error'});
          API.failNext = false;
          return;
        }
        res.json({latestVersion: API.latestVersion});
      } catch(ex) {
        next(ex);
      }
    });
  });

  return API;
}

// @ts-ignore
async function currentVersion(page: Page) {
  const currentVersionText = await page.locator("css=.test-admin-panel-item-value-version").textContent() ?? '';
  return currentVersionText.match(/Version (.+)/)![1];
}

