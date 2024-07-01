import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import * as testUtils from 'test/server/testUtils';

/**
 * The boot page functionality has been merged with the Admin Panel.
 * Check that it behaves as a boot page did now.
 */
describe('Boot', function() {
  this.timeout(30000);
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;

  afterEach(() => gu.checkForErrors());

  async function hasPrompt() {
    // There is some glitchiness to when the text appears.
    await gu.waitToPass(async () => {
      assert.include(
        await driver.findContentWait('pre', /GRIST_BOOT_KEY/, 2000).getText(),
        'GRIST_BOOT_KEY=example-');
    }, 3000);
  }

  it('tells user about /admin', async function() {
    await driver.get(`${server.getHost()}/boot`);
    assert.match(await driver.getPageSource(), /\/admin/);
    // Switch to a regular place to that gu.checkForErrors won't panic -
    // it needs a Grist page.
    await driver.get(`${server.getHost()}`);
  });

  it('gives prompt about how to enable boot page', async function() {
    await driver.get(`${server.getHost()}/admin`);
    await hasPrompt();
  });

  describe('with a GRIST_BOOT_KEY', function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_BOOT_KEY = 'lala';
      await server.restart();
    });

    after(async function() {
      oldEnv.restore();
      await server.restart();
    });

    it('gives prompt when key is missing', async function() {
      await driver.get(`${server.getHost()}/admin`);
      await hasPrompt();
    });

    it('gives prompt when key is wrong', async function() {
      await driver.get(`${server.getHost()}/admin?boot-key=bilbo`);
      await hasPrompt();
    });

    it('gives page when key is right', async function() {
      await driver.get(`${server.getHost()}/admin?boot-key=lala`);
      await driver.findContentWait('div', /Is home page available/, 2000);
    });
  });
});
