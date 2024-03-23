import {TelemetryLevel} from 'app/common/Telemetry';
import {assert, driver, Key, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import * as testUtils from 'test/server/testUtils';

describe('AdminPanel', function() {
  this.timeout(30000);
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let session: gu.Session;

  afterEach(() => gu.checkForErrors());

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = 'core';
    process.env.GRIST_DEFAULT_EMAIL = gu.session().email;
    await server.restart(true);
  });

  after(async function() {
    oldEnv.restore();
    await server.restart(true);
  });

  it('should not be shown to non-managers', async function() {
    session = await gu.session().user('user2').personalSite.login();
    await session.loadDocMenu('/');

    await gu.openAccountMenu();
    assert.equal(await driver.find('.test-usermenu-admin-panel').isPresent(), false);
    await driver.sendKeys(Key.ESCAPE);
    assert.equal(await driver.find('.test-dm-admin-panel').isPresent(), false);

    // Try loading the URL directly.
    await driver.get(`${server.getHost()}/admin`);
    assert.match(await driver.findWait('.test-error-header', 2000).getText(), /Access denied/);
    assert.equal(await driver.find('.test-admin-panel').isPresent(), false);
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
    assert.equal(await waitForAdminPanel().isDisplayed(), true);
  });

  it('should include support-grist section', async function() {
    assert.match(await driver.find('.test-admin-panel-item-sponsor').getText(), /Support Grist Labs on GitHub/);
    await withExpandedItem('sponsor', async () => {
      const button = await driver.find('.test-support-grist-page-sponsorship-section');
      assert.equal(await button.isDisplayed(), true);
      assert.match(await button.getText(), /You can support Grist open-source/);
    });
  });

  it('supports opting in to telemetry from the page', async function() {
    await assertTelemetryLevel('off');

    let toggle = driver.find('.test-admin-panel-item-value-telemetry .widget_switch');
    assert.equal(await isSwitchOn(toggle), false);

    await withExpandedItem('telemetry', async () => {
      assert.isFalse(await driver.find('.test-support-grist-page-telemetry-section-message').isPresent());
      await driver.findContentWait(
        '.test-support-grist-page-telemetry-section button', /Opt in to Telemetry/, 2000).click();
      await driver.findContentWait('.test-support-grist-page-telemetry-section button', /Opt out of Telemetry/, 2000);
      assert.equal(
        await driver.find('.test-support-grist-page-telemetry-section-message').getText(),
        'You have opted in to telemetry. Thank you! 🙏'
      );
      assert.equal(await isSwitchOn(toggle), true);
    });

    // Check it's still on after collapsing.
    assert.equal(await isSwitchOn(toggle), true);

    // Reload the page and check that the Grist config indicates telemetry is set to "limited".
    await driver.navigate().refresh();
    await waitForAdminPanel();
    toggle = driver.find('.test-admin-panel-item-value-telemetry .widget_switch');
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
    assert.isFalse(await driver.find('.test-support-grist-page-telemetry-section-message').isPresent());
    let toggle = driver.find('.test-admin-panel-item-value-telemetry .widget_switch');
    assert.equal(await isSwitchOn(toggle), false);

    // Reload the page and check that the Grist config indicates telemetry is set to "off".
    await driver.navigate().refresh();
    await waitForAdminPanel();
    await toggleItem('telemetry');
    await driver.findContentWait('.test-support-grist-page-telemetry-section button', /Opt in to Telemetry/, 2000);
    assert.isFalse(await driver.find('.test-support-grist-page-telemetry-section-message').isPresent());
    await assertTelemetryLevel('off');
    toggle = driver.find('.test-admin-panel-item-value-telemetry .widget_switch');
    assert.equal(await isSwitchOn(toggle), false);
  });

  it('supports toggling telemetry from the toggle in the top line', async function() {
    const toggle = driver.find('.test-admin-panel-item-value-telemetry .widget_switch');
    assert.equal(await isSwitchOn(toggle), false);
    await toggle.click();
    await gu.waitForServer();
    assert.equal(await isSwitchOn(toggle), true);
    assert.match(await driver.find('.test-support-grist-page-telemetry-section-message').getText(),
      /You have opted in/);
    await toggle.click();
    await gu.waitForServer();
    assert.equal(await isSwitchOn(toggle), false);
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
    await waitForAdminPanel();
    const toggle = driver.find('.test-admin-panel-item-value-telemetry .widget_switch');
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
    assert.equal(await driver.find('.test-admin-panel-item-version').isDisplayed(), true);
    assert.match(await driver.find('.test-admin-panel-item-value-version').getText(), /^Version \d+\./);
  });
});

async function assertTelemetryLevel(level: TelemetryLevel) {
  const telemetryLevel = await driver.executeScript('return window.gristConfig.telemetry?.telemetryLevel');
  assert.equal(telemetryLevel, level);
}

async function toggleItem(itemId: string) {
  const header = await driver.find(`.test-admin-panel-item-name-${itemId}`);
  await header.click();
  await driver.sleep(500);    // Time to expand or collapse.
  return header;
}

async function withExpandedItem(itemId: string, callback: () => Promise<void>) {
  const header = await toggleItem(itemId);
  await callback();
  await header.click();
  await driver.sleep(500);    // Time to collapse.
}

const isSwitchOn = (switchElem: WebElement) => switchElem.matches('[class*=switch_on]');
const waitForAdminPanel = () => driver.findWait('.test-admin-panel', 2000);
