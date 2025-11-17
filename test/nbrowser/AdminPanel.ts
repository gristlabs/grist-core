import {TelemetryLevel} from 'app/common/Telemetry';
import {assert, driver, Key, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {FakeUpdateServer, startFakeUpdateServer} from 'test/server/customUtil';
import * as testUtils from 'test/server/testUtils';

describe('AdminPanel', function() {
  this.timeout(300000);
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let session: gu.Session;
  let fakeServer: FakeUpdateServer;

  afterEach(() => gu.checkForErrors());

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = 'core';
    process.env.GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING = 'true';
    process.env.GRIST_DEFAULT_EMAIL = gu.session().email;
    fakeServer = await startFakeUpdateServer();
    process.env.GRIST_TEST_VERSION_CHECK_URL = `${fakeServer.url()}/version`;
    await server.restart(true);
  });

  after(async function() {
    await fakeServer.close();
    oldEnv.restore();
    await server.restart(true);
  });

  it('should show an explanation to non-managers', async function() {
    session = await gu.session().user('user2').personalSite.login();
    await session.loadDocMenu('/');

    await gu.openAccountMenu();
    assert.equal(await driver.find('.test-usermenu-admin-panel').isPresent(), false);
    await driver.sendKeys(Key.ESCAPE);
    assert.equal(await driver.find('.test-dm-admin-panel').isPresent(), false);

    // Try loading the URL directly.
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    assert.equal(await driver.find('.test-admin-panel').isDisplayed(), true);
    assert.match(await driver.find('.test-admin-panel').getText(), /Administrator Panel Unavailable/);
  });

  it('should be shown to managers', async function() {
    session = await gu.session().personalSite.login();
    await session.loadDocMenu('/');
    assert.equal(await driver.find('.test-dm-admin-panel').isDisplayed(), true);
    assert.match(await driver.find('.test-dm-admin-panel').getAttribute('href'), /\/admin$/);
    await gu.openAccountMenu();
    assert.equal(await driver.find('.test-usermenu-admin-panel').isDisplayed(), true);
    assert.match(await driver.find('.test-usermenu-admin-panel').getAttribute('href'), /\/admin$/);
    await driver.find('.test-usermenu-admin-panel').click();
    assert.equal(await gu.waitForAdminPanel().isDisplayed(), true);
  });

  it('should include support-grist section', async function() {
    assert.match(
      await driver.findWait('.test-admin-panel-item-sponsor', 3000).getText(),
      /Support Grist Labs on GitHub/
    );
    await withExpandedItem('sponsor', async () => {
      const button = await driver.find('.test-support-grist-page-sponsorship-section');
      assert.equal(await button.isDisplayed(), true);
      assert.match(await button.getText(), /You can support Grist open-source/);
    });
  });

  it('supports opting in to telemetry from the page', async function() {
    await assertTelemetryLevel('off');

    let toggle = driver.find('.test-admin-panel-item-value-telemetry .test-toggle-switch');
    assert.equal(await isEnabled(toggle), false);

    await withExpandedItem('telemetry', async () => {
      assert.isFalse(await driver.find('.test-support-grist-page-telemetry-section-message').isPresent());
      await driver.findContentWait(
        '.test-support-grist-page-telemetry-section button', /Opt in to Telemetry/, 2000).click();
      await driver.findContentWait('.test-support-grist-page-telemetry-section button', /Opt out of Telemetry/, 2000);
      assert.equal(
        await driver.find('.test-support-grist-page-telemetry-section-message').getText(),
        'You have opted in to telemetry. Thank you! 🙏'
      );
      assert.equal(await isEnabled(toggle), true);
    });

    // Check it's still on after collapsing.
    assert.equal(await isEnabled(toggle), true);

    // Reload the page and check that the Grist config indicates telemetry is set to "limited".
    await driver.navigate().refresh();
    await gu.waitForAdminPanel();
    toggle = driver.find('.test-admin-panel-item-value-telemetry .test-toggle-switch');
    assert.equal(await isEnabled(toggle), true);
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
    assert.isFalse(await driver.find('.test-support-grist-page-telemetry-section-message').isPresent());
    let toggle = driver.find('.test-admin-panel-item-value-telemetry .test-toggle-switch');
    assert.equal(await isEnabled(toggle), false);

    // Reload the page and check that the Grist config indicates telemetry is set to "off".
    await driver.navigate().refresh();
    await gu.waitForAdminPanel();
    await toggleItem('telemetry');
    await driver.findContentWait('.test-support-grist-page-telemetry-section button', /Opt in to Telemetry/, 2000);
    assert.isFalse(await driver.find('.test-support-grist-page-telemetry-section-message').isPresent());
    await assertTelemetryLevel('off');
    toggle = driver.find('.test-admin-panel-item-value-telemetry .test-toggle-switch');
    assert.equal(await isEnabled(toggle), false);
  });

  it('supports toggling telemetry from the toggle in the top line', async function() {
    const toggle = driver.find('.test-admin-panel-item-value-telemetry .test-toggle-switch');
    assert.equal(await isEnabled(toggle), false);
    await toggle.click();
    await gu.waitForServer();
    assert.equal(await isEnabled(toggle), true);
    assert.match(await driver.find('.test-support-grist-page-telemetry-section-message').getText(),
      /You have opted in/);
    await toggle.click();
    await gu.waitForServer();
    assert.equal(await isEnabled(toggle), false);
    await withExpandedItem('telemetry', async () => {
      assert.equal(await driver.find('.test-support-grist-page-telemetry-section-message').isPresent(), false);
    });
  });

  it('shows telemetry opt-in status even when set via environment variable', async function() {
    // Set the telemetry level to "limited" via environment variable and restart the server.
    process.env.GRIST_TELEMETRY_LEVEL = 'limited';
    await server.restart();

    // Check that the Support Grist page reports telemetry is enabled.
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    const toggle = driver.find('.test-admin-panel-item-value-telemetry .test-toggle-switch');
    assert.equal(await isEnabled(toggle), true);
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
    await gu.waitForAdminPanel();
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
    await gu.waitForAdminPanel();
    await gu.waitToPass(async () => {
      assert.equal(await driver.find('.test-admin-panel-item-version').isDisplayed(), true);
      assert.match(await driver.find('.test-admin-panel-item-value-version').getText(), /^Version \d+\./);
    }, 3000);
  });

  it('should show admin accounts', async function() {
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    const adminAccounts = await driver.findWait('.test-admin-panel-item-admins', 2000);
    assert.equal(await adminAccounts.isDisplayed(), true);
    const adminDisplay = await driver.find('.test-admin-panel-admin-accounts-display');

    assert.equal('1 admin account', await adminDisplay.getText());

    await toggleItem('admins');

    const adminsList = await driver.find('.test-admin-panel-admin-accounts-list');
    assert.equal(await adminsList.isDisplayed(), true);

    const names = await adminAccounts.findAll('.test-admin-panel-admin-account-name');
    assert.equal(names.length, 1);

    const emails = await adminAccounts.findAll('.test-admin-panel-admin-account-email');
    assert.equal(names.length, 1);

    assert.equal(await emails[0].getText(), gu.session().email);
  });

  it('should show sandbox', async function() {
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    assert.equal(await driver.find('.test-admin-panel-item-sandboxing').isDisplayed(), true);
    await gu.waitToPass(
      // unknown for grist-saas, unconfigured for grist-core.
      async () => assert.match(await driver.find('.test-admin-panel-item-value-sandboxing').getText(),
                               /^((Error: unknown)|(unconfigured))/),
      3000,
    );
    // It would be good to test other scenarios, but we are using
    // a multi-server setup on grist-saas and the sandbox test isn't
    // useful there yet.
  });

  it('should show various self checks', async function() {
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await gu.waitToPass(
      async () => {
        assert.equal(await driver.find('.test-admin-panel-item-name-probe-reachable').isDisplayed(), true);
        assert.match(await driver.find('.test-admin-panel-item-value-probe-reachable').getText(), /✅/);
      },
      3000,
    );
    assert.equal(await driver.find('.test-admin-panel-item-name-probe-system-user').isDisplayed(), true);
    await gu.waitToPass(
      async () => assert.match(await driver.find('.test-admin-panel-item-value-probe-system-user').getText(), /✅/),
      3000,
    );
  });

  const upperCheckNow = () => driver.find('.test-admin-panel-updates-upper-check-now');
  const lowerCheckNow = () => driver.find('.test-admin-panel-updates-lower-check-now');
  const autoCheckToggle = () => driver.find('.test-admin-panel-updates-auto-check');
  const autoCheckToggleDisabled = () => driver.find('.test-admin-panel-updates-auto-check-disabled');
  const updateMessage = () => driver.find('.test-admin-panel-updates-message');
  const versionBox = () => driver.find('.test-admin-panel-updates-version');
  function waitForStatus(message: RegExp) {
    return gu.waitToPass(async () => {
      assert.match(await updateMessage().getText(), message);
    });
  }

  it('should check for updates', async function() {
    // Clear any cached settings.
    await driver.executeScript('window.sessionStorage.clear(); window.localStorage.clear();');
    await driver.navigate().refresh();
    await gu.waitForAdminPanel();

    // By default don't have any info.
    await waitForStatus(/No information available/);

    // We see upper check-now button.
    assert.isTrue(await upperCheckNow().isDisplayed());

    // We can expand.
    await toggleItem('updates');

    // We see a toggle to update automatically, enabled by default
    assert.isTrue(await autoCheckToggle().isDisplayed());
    assert.isTrue(await isEnabled(autoCheckToggle()));

    // We can click it twice, Grist will do a check right away.
    fakeServer.pause();
    await autoCheckToggle().click();
    assert.isFalse(await isEnabled(autoCheckToggle()));
    await autoCheckToggle().click();
    assert.isTrue(await isEnabled(autoCheckToggle()));

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
    assert.match(await versionBox().getText(), new RegExp(`Version ${fakeServer.latestVersion}`));

    // Disable auto-checks.
    assert.isTrue(await isEnabled(autoCheckToggle()));
    await autoCheckToggle().click();
    assert.isFalse(await isEnabled(autoCheckToggle()));
    // We remember that a newer version is available
    await waitForStatus(/Newer version available/);
    assert.isTrue(await versionBox().isDisplayed());
    assert.equal(await versionBox().getText(), `Version ${fakeServer.latestVersion}`);

    // Refresh to see if we are disabled.
    fakeServer.pause();
    await driver.navigate().refresh();
    await gu.waitForAdminPanel();
    await waitForStatus(/Newer version available/);
    fakeServer.resume();
    // Expand and see if the toggle is off.
    await toggleItem('updates');
    assert.isFalse(await isEnabled(autoCheckToggle()));
  });

  it('shows up-to-date message', async function() {
    // Restart the server to clear cached version check
    await server.restart(true);
    session = await gu.session().personalSite.login();
    await session.loadDocMenu('/');
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();

    fakeServer.latestVersion = await currentVersion();

    // Click upper check now.
    await upperCheckNow().click();
    await waitForStatus(/Grist is up to date/);

    // Update version once again.
    fakeServer.bumpVersion();
    // Click lower check now.
    fakeServer.pause();
    await toggleItem('updates');
    await lowerCheckNow().click();
    await waitForStatus(/Checking for updates/);
    fakeServer.resume();
    await waitForStatus(/Newer version available/);

    // Make sure we see the new version.
    assert.isTrue(await versionBox().isDisplayed());
    assert.match(await versionBox().getText(), new RegExp(`Version ${fakeServer.latestVersion}`));

    // Make sure that checking it twice also works when a newer version is available
    await autoCheckToggle().click();
    assert.isFalse(await isEnabled(autoCheckToggle()));
    await autoCheckToggle().click();
    assert.isTrue(await isEnabled(autoCheckToggle()));
    await waitForStatus(/Newer version available/);
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

  it('should show a message if automatic version checking is missing', async function () {
    process.env.GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING='false';
    await server.restart(true);
    session = await gu.session().personalSite.login();
    await session.loadDocMenu('/');
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await toggleItem('updates');
    // The message should be there.
    assert.isTrue(await autoCheckToggleDisabled().isDisplayed());
  });

  it('should survive APP_HOME_URL misconfiguration', async function() {
    process.env.APP_HOME_URL = 'http://misconfigured.invalid';
    process.env.GRIST_BOOT_KEY = 'zig';
    await server.restart(true);
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
  });

  it('should honor GRIST_BOOT_KEY fallback', async function() {
    await gu.removeLogin();
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    assert.equal(await driver.find('.test-admin-panel').isDisplayed(), true);
    assert.match(await driver.find('.test-admin-panel').getText(), /Administrator Panel Unavailable/);

    process.env.GRIST_BOOT_KEY = 'zig';
    await server.restart(true);
    await driver.get(`${server.getHost()}/admin?boot-key=zig`);
    await gu.waitForAdminPanel();
    assert.equal(await driver.find('.test-admin-panel').isDisplayed(), true);
    assert.notMatch(await driver.find('.test-admin-panel').getText(), /Administrator Panel Unavailable/);
    await driver.get(`${server.getHost()}/admin?boot-key=zig-wrong`);
    await gu.waitForAdminPanel();
    assert.equal(await driver.find('.test-admin-panel').isDisplayed(), true);
    assert.match(await driver.find('.test-admin-panel').getText(), /Administrator Panel Unavailable/);
  });

  it('should show no admins if `GRIST_DEFAULT_EMAIL` is unset', async function() {
    // If the env var is unset, core and SaaS handle the situation
    // differently. Core will supply a hardcoded default of you@example.com.
    //
    // For the purpose of this test, let's instead set it to the empty
    // string.
    process.env.GRIST_DEFAULT_EMAIL='';
    await server.restart(true);
    await driver.get(`${server.getHost()}/admin?boot-key=zig`);
    await gu.waitForAdminPanel();

    const adminAccounts = await driver.findWait('.test-admin-panel-item-admins', 2000);
    assert.equal(await adminAccounts.isDisplayed(), true);
    const adminDisplay = await driver.findWait('.test-admin-panel-admin-accounts-display', 1000);

    assert.equal('no admin accounts', await adminDisplay.getText());

    await toggleItem('admins');

    const adminsList = await driver.find('.test-admin-panel-admin-accounts-list');
    assert.equal(await adminsList.isDisplayed(), true);

    const names = await adminAccounts.findAll('.test-admin-panel-admin-accounts-list-item');
    assert.equal(names.length, 1);

    assert.equal(await names[0].getText(), 'Admin account not found\n'
      + 'Missing admin account because GRIST_DEFAULT_EMAIL is not set');
  });
});

async function assertTelemetryLevel(level: TelemetryLevel) {
  const telemetryLevel = await driver.executeScript('return window.gristConfig.telemetry?.telemetryLevel');
  assert.equal(telemetryLevel, level);
}

/**
 * Individual elements of the admin panel.
 */
export function itemElement(itemId: string) {
  return driver.findWait(`.test-admin-panel-item-${itemId}`, 1000);
}

export async function toggleItem(itemId: string) {
  const header = itemElement(itemId).find(`.test-admin-panel-item-name-${itemId}`);
  await header.click();
  await driver.sleep(500);    // Time to expand or collapse.
  return header;
}

export async function withExpandedItem(itemId: string, callback: () => Promise<void>) {
  const header = await toggleItem(itemId);
  await callback();
  await header.click();
  await driver.sleep(500);    // Time to collapse.
}

export async function clickSwitch(name: string) {
  const toggle = driver.find(`.test-admin-panel-item-value-${name} .test-toggle-switch`);
  await toggle.click();
  await gu.waitForServer();
}

export async function isEnabled(switchElem: WebElement|string) {
  if (typeof switchElem === 'string') {
    switchElem = driver.find(`.test-admin-panel-item-value-${switchElem} .test-toggle-switch`);
  }
  return (await switchElem.find('input').getAttribute('checked')) === null ? false : true;
}

async function currentVersion() {
  const currentVersionText = await driver.find(".test-admin-panel-item-value-version").getText();
  const currentVersion = currentVersionText.match(/Version (.+)/)![1];
  return currentVersion;
}
