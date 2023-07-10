import {GristLoadConfig} from 'app/common/gristUrls';
import {TelemetryLevel} from 'app/common/Telemetry';
import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import * as testUtils from 'test/server/testUtils';

describe('SupportGrist', function() {
  this.timeout(30000);
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let session: gu.Session;

  afterEach(() => gu.checkForErrors());

  describe('in grist-core', function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = 'core';
      process.env.GRIST_DEFAULT_EMAIL = gu.session().email;
      await server.restart();
    });

    after(async function() {
      oldEnv.restore();
      await server.restart();
    });

    describe('when user is not a manager', function() {
      before(async function() {
        oldEnv = new testUtils.EnvironmentSnapshot();
        await server.restart();
        session = await gu.session().user('user2').personalSite.login();
        await session.loadDocMenu('/');
      });

      after(async function() {
        oldEnv.restore();
      });

      it('does not show a nudge on the doc menu', async function() {
        await assertNudgeButtonShown(false);
        await assertNudgeCardShown(false);
      });

      it('shows a link to the Support Grist page in the user menu', async function() {
        await gu.openAccountMenu();
        await driver.find('.test-usermenu-support-grist').click();
        assert.isTrue(await driver.findContentWait(
          '.test-support-grist-page-sponsorship-section',
          /Sponsor Grist Labs on GitHub/,
          4000
        ).isDisplayed());
      });

      it('shows a message that telemetry is managed by the site administrator', async function() {
        assert.isTrue(await driver.findContentWait(
          '.test-support-grist-page-telemetry-section',
          /This instance is opted out of telemetry\. Only the site administrator has permission to change this\./,
          4000
        ).isDisplayed());

        process.env.GRIST_TELEMETRY_LEVEL = 'limited';
        await server.restart();
        await driver.navigate().refresh();
        assert.isTrue(await driver.findContentWait(
          '.test-support-grist-page-telemetry-section',
          /This instance is opted in to telemetry\. Only the site administrator has permission to change this\./,
          4000
        ).isDisplayed());
      });
    });

    describe('when user is a manager', function() {
      before(async function() {
        oldEnv = new testUtils.EnvironmentSnapshot();
        await server.restart();
        session = await gu.session().personalSite.login();
        await session.loadDocMenu('/');
      });

      after(async function() {
        oldEnv.restore();
      });

      it('shows a nudge on the doc menu', async function() {
        // Check that the nudge is expanded by default.
        await assertNudgeButtonShown(false);
        await assertNudgeCardShown(true);

        // Reload the doc menu and check that it's still expanded.
        await session.loadDocMenu('/');
        await assertNudgeButtonShown(false);
        await assertNudgeCardShown(true);

        // Close the nudge and check that it's now collapsed.
        await driver.find('.test-support-grist-nudge-card-close').click();
        await assertNudgeButtonShown(true);
        await assertNudgeCardShown(false);

        // Reload again, and check that it's still collapsed.
        await session.loadDocMenu('/');
        await assertNudgeButtonShown(true);
        await assertNudgeCardShown(false);

        // Dismiss the contribute button and check that it's now gone, even after reloading.
        await driver.find('.test-support-grist-nudge-contribute-button').mouseMove();
        await driver.find('.test-support-grist-nudge-contribute-button-close').click();
        await assertNudgeButtonShown(false);
        await assertNudgeCardShown(false);
        await session.loadDocMenu('/');
        await assertNudgeButtonShown(false);
        await assertNudgeCardShown(false);
      });

      it('shows a link to the Support Grist page in the user menu', async function() {
        await gu.openAccountMenu();
        await driver.find('.test-usermenu-support-grist').click();
        await driver.findContentWait('.test-support-grist-page-telemetry-section button', /Opt in to Telemetry/, 2000);
        assert.isFalse(await driver.find('.test-support-grist-page-telemetry-section-message').isPresent());
      });

      it('supports opting in to telemetry from the page', async function() {
        await assertTelemetryLevel('off');
        await driver.findContentWait(
          '.test-support-grist-page-telemetry-section button', /Opt in to Telemetry/, 2000).click();
        await driver.findContentWait('.test-support-grist-page-telemetry-section button', /Opt out of Telemetry/, 2000);
        assert.equal(
          await driver.find('.test-support-grist-page-telemetry-section-message').getText(),
          'You have opted in to telemetry. Thank you! 🙏'
        );

        // Reload the page and check that the Grist config indicates telemetry is set to "limited".
        await driver.navigate().refresh();
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

        // Reload the page and check that the Grist config indicates telemetry is set to "off".
        await driver.navigate().refresh();
        await driver.findContentWait('.test-support-grist-page-telemetry-section button', /Opt in to Telemetry/, 2000);
        assert.isFalse(await driver.find('.test-support-grist-page-telemetry-section-message').isPresent());
        await assertTelemetryLevel('off');
      });

      it('supports opting in to telemetry from the nudge', async function() {
        // Reset all dismissed popups, including the telemetry nudge.
        await driver.executeScript('resetDismissedPopups();');
        await gu.waitForServer();
        await session.loadDocMenu('/');

        // Opt in to telemetry and reload the page.
        await driver.find('.test-support-grist-nudge-card-opt-in').click();
        await driver.findWait('.test-support-grist-nudge-card-close-button', 1000).click();
        await assertNudgeButtonShown(false);
        await assertNudgeCardShown(false);
        await session.loadDocMenu('/');

        // Check that the nudge is no longer shown and telemetry is set to "limited".
        await assertNudgeButtonShown(false);
        await assertNudgeCardShown(false);
        await assertTelemetryLevel('limited');
      });

      it('does not show the nudge if telemetry is enabled', async function() {
        // Reset all dismissed popups, including the telemetry nudge.
        await driver.executeScript('resetDismissedPopups();');
        await gu.waitForServer();

        // Reload the doc menu and check that the nudge still isn't shown.
        await session.loadDocMenu('/');
        await assertNudgeButtonShown(false);
        await assertNudgeCardShown(false);

        // Disable telemetry from the Support Grist page.
        await gu.openAccountMenu();
        await driver.find('.test-usermenu-support-grist').click();
        await driver.findContentWait(
          '.test-support-grist-page-telemetry-section button', /Opt out of Telemetry/, 2000).click();
        await driver.findContentWait('.test-support-grist-page-telemetry-section button', /Opt in to Telemetry/, 2000);

        // Reload the doc menu and check that the nudge is now shown.
        await gu.loadDocMenu('/');
        await assertNudgeButtonShown(false);
        await assertNudgeCardShown(true);
      });

      it('shows telemetry opt-in status even when set via environment variable', async function() {
        // Set the telemetry level to "limited" via environment variable and restart the server.
        process.env.GRIST_TELEMETRY_LEVEL = 'limited';
        await server.restart();

        // Check that the Support Grist page reports telemetry is enabled.
        await gu.loadDocMenu('/');
        await gu.openAccountMenu();
        await driver.find('.test-usermenu-support-grist').click();
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
        await gu.loadDocMenu('/');
        await gu.openAccountMenu();
        await driver.find('.test-usermenu-support-grist').click();
        assert.equal(
          await driver.findWait('.test-support-grist-page-telemetry-section-message', 2000).getText(),
          'You have opted out of telemetry.'
        );
        assert.isFalse(await driver.findContent('.test-support-grist-page-telemetry-section button',
        /Opt in to Telemetry/).isPresent());
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
      await server.restart();
    });

    it('does not show a nudge on the doc menu', async function() {
      await assertNudgeButtonShown(false);
      await assertNudgeCardShown(false);
    });

    it('does not show a link to the Support Grist page in the user menu', async function() {
      await gu.openAccountMenu();
      assert.isFalse(await driver.find('.test-usermenu-support-grist').isPresent());
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
      await server.restart();
    });

    it('does not show a nudge on the doc menu', async function() {
      await assertNudgeButtonShown(false);
      await assertNudgeCardShown(false);
    });

    it('does not show a link to the Support Grist page in the user menu', async function() {
      await gu.openAccountMenu();
      assert.isFalse(await driver.find('.test-usermenu-support-grist').isPresent());
    });
  });
});

async function assertNudgeButtonShown(isShown: boolean) {
  if (isShown) {
    assert.isTrue(
      await driver.find('.test-support-grist-nudge-contribute-button').isDisplayed()
    );
  } else {
    assert.isFalse(await driver.find('.test-support-grist-nudge-contribute-button').isPresent());
  }
}

async function assertNudgeCardShown(isShown: boolean) {
  if (isShown) {
    assert.isTrue(
      await driver.find('.test-support-grist-nudge-card').isDisplayed()
    );
  } else {
    assert.isFalse(await driver.find('.test-support-grist-nudge-card').isPresent());
  }
}

async function assertTelemetryLevel(level: TelemetryLevel) {
  const {telemetry}: GristLoadConfig = await driver.executeScript('return window.gristConfig');
  assert.equal(telemetry?.telemetryLevel, level);
}
