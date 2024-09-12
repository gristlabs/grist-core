import {GristLoadConfig} from 'app/common/gristUrls';
import {TelemetryLevel} from 'app/common/Telemetry';
import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import * as testUtils from 'test/server/testUtils';

const sponsorshipUrl = 'https://github.com/sponsors/gristlabs';

describe('SupportGrist', function() {
  this.timeout(30000);
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let session: gu.Session;

  afterEach(() => gu.checkForErrors());

  after(async function() {
    await server.restart();
  });

  describe('in grist-core', function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = 'core';
      process.env.GRIST_DEFAULT_EMAIL = gu.session().email;
      await server.restart();
    });

    after(async function() {
      oldEnv.restore();
    });

    describe('when user is not a manager', function() {
      before(async function() {
        session = await gu.session().user('user2').personalSite.login();
        await session.loadDocMenu('/');
      });

      it('shows a button in the top bar', async function() {
        await assertSupportButtonShown(true, {isSponsorLink: true});
      });

      it('shows a link to the Support Grist page in the user menu', async function() {
        await gu.openAccountMenu();
        await assertMenuHasAdminPanel(false);
        await assertMenuHasSupportGrist(true);
      });
    });

    describe('when user is a manager', function() {
      before(async function() {
        session = await gu.session().personalSite.login();
        await session.loadDocMenu('/');
      });

      it('shows a button in the top bar', async function() {
        await assertSupportButtonShown(true, {isSponsorLink: false});

        // Dismiss the button and check that it's now gone, even after reloading.
        await driver.find('.test-support-grist-button').mouseMove();
        await driver.find('.test-support-grist-button-dismiss').click();
        await assertSupportButtonShown(false);
        await session.loadDocMenu('/');
        await assertSupportButtonShown(false);
      });

      it('shows a link to Admin Panel and Support Grist in the user menu', async function() {
        await gu.openAccountMenu();
        await assertMenuHasAdminPanel(true);
        await assertMenuHasSupportGrist(true);
      });

      it('supports opting in to telemetry', async function() {
        // Reset all dismissed popups, which includes the telemetry button.
        await driver.executeScript('resetDismissedPopups();');
        await gu.waitForServer();
        await session.loadDocMenu('/');

        // Opt in to telemetry and reload the page.
        await driver.find('.test-support-grist-button').click();
        await driver.find('.test-support-nudge-opt-in').click();
        await driver.findWait('.test-support-nudge-close-button', 1000).click();
        await assertSupportButtonShown(false);
        await session.loadDocMenu('/');

        // Check that the button is no longer shown and telemetry is set to "limited".
        await assertSupportButtonShown(false);
        await assertTelemetryLevel('limited');
      });

      it('does not show the button if telemetry is enabled', async function() {
        await driver.executeScript('resetDismissedPopups();');
        await gu.waitForServer();

        // Reload the doc menu and check that We show the "Support Grist" button linking to sponsorship page.
        await session.loadDocMenu('/');
        await assertSupportButtonShown(true, {isSponsorLink: true});

        // Disable telemetry from the Support Grist page.
        await gu.openAccountMenu();
        await driver.find('.test-usermenu-admin-panel').click();
        await driver.findWait('.test-admin-panel', 2000);
        await driver.find('.test-admin-panel-item-name-telemetry').click();
        await driver.sleep(500);  // Wait for section to expand.
        await driver.findContentWait(
          '.test-support-grist-page-telemetry-section button', /Opt out of Telemetry/, 2000).click();
        await driver.findContentWait('.test-support-grist-page-telemetry-section button', /Opt in to Telemetry/, 2000);

        // Reload the doc menu and check that the button is now shown.
        await gu.loadDocMenu('/');
        await assertSupportButtonShown(true, {isSponsorLink: false});
      });

      it('shows sponsorship link when no telemetry nudge, and allows dismissing it', async function() {
        // Reset all dismissed popups, including the telemetry nudge.
        await driver.executeScript('resetDismissedPopups();');
        await gu.waitForServer();

        // Opt in to telemetry
        const api = session.createHomeApi();
        await api.testRequest(`${api.getBaseUrl()}/api/install/prefs`, {
          method: 'patch',
          body: JSON.stringify({telemetry: {telemetryLevel: 'limited'}}),
        });

        await session.loadDocMenu('/');
        await assertTelemetryLevel('limited');

        // We still show the "Support Grist" button linking to sponsorship page.
        await assertSupportButtonShown(true, {isSponsorLink: true});

        // We can dismiss it.
        await driver.find('.test-support-grist-button').mouseMove();
        await driver.find('.test-support-grist-button-dismiss').click();
        await assertSupportButtonShown(false);

        // And this will get remembered.
        await session.loadDocMenu('/');
        await assertSupportButtonShown(false);
      });
    });
  });

  describe('in grist-saas', function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = 'saas';
      process.env.GRIST_DEFAULT_EMAIL = gu.session().email;
      await server.restart();
      session = await gu.session().personalSite.login();
      await session.loadDocMenu('/');
    });

    after(async function() {
      oldEnv.restore();
    });

    it('does not show a button in the top bar', async function() {
      await assertSupportButtonShown(false);
    });

    it('shows Admin Panel but not Support Grist in the user menu for admin', async function() {
      await gu.openAccountMenu();
      await assertMenuHasAdminPanel(true);
      await assertMenuHasSupportGrist(false);
    });

    it('does not show Admin Panel or Support Grist in the user menu for non-admin', async function() {
      session = await gu.session().user('user2').personalSite.login();
      await session.loadDocMenu('/');
      await gu.openAccountMenu();
      await assertMenuHasAdminPanel(false);
      await assertMenuHasSupportGrist(false);
    });
  });

  describe('in grist-enterprise', function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = 'enterprise';
      process.env.GRIST_DEFAULT_EMAIL = gu.session().email;
      await server.restart();
      session = await gu.session().personalSite.login();
      await session.loadDocMenu('/');
    });

    after(async function() {
      oldEnv.restore();
    });

    it('does not show a button in the top bar', async function() {
      await assertSupportButtonShown(false);
    });

    it('shows Admin Panel but not Support Grist page in the user menu', async function() {
      await gu.openAccountMenu();
      await assertMenuHasAdminPanel(true);
      await assertMenuHasSupportGrist(false);
    });
  });
});

async function assertSupportButtonShown(isShown: false): Promise<void>;
async function assertSupportButtonShown(isShown: true, opts: {isSponsorLink: boolean}): Promise<void>;
async function assertSupportButtonShown(isShown: boolean, opts?: {isSponsorLink: boolean}) {
  const button = driver.find('.test-support-grist-button');
  assert.equal(await button.isPresent() && await button.isDisplayed(), isShown);
  if (isShown) {
    assert.equal(await button.getAttribute('href'), opts?.isSponsorLink ? sponsorshipUrl : null);
  }
}

async function assertMenuHasAdminPanel(isShown: boolean) {
  const elem = driver.find('.test-usermenu-admin-panel');
  assert.equal(await elem.isPresent() && await elem.isDisplayed(), isShown);
  if (isShown) {
    assert.match(await elem.getAttribute('href'), /.*\/admin$/);
  }
}

async function assertMenuHasSupportGrist(isShown: boolean) {
  const elem = driver.find('.test-usermenu-support-grist');
  assert.equal(await elem.isPresent() && await elem.isDisplayed(), isShown);
  if (isShown) {
    assert.equal(await elem.getAttribute('href'), sponsorshipUrl);
  }
}

async function assertTelemetryLevel(level: TelemetryLevel) {
  const {telemetry}: GristLoadConfig = await driver.executeScript('return window.gristConfig');
  assert.equal(telemetry?.telemetryLevel, level);
}
