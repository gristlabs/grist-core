import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import * as testUtils from 'test/server/testUtils';

describe('Boot', function() {
  this.timeout(30000);
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;

  afterEach(() => gu.checkForErrors());

  async function hasPrompt() {
    assert.include(
      await driver.findContentWait('p', /diagnostics page/, 2000).getText(),
      'A diagnostics page can be made available');
  }

  it('gives prompt about how to enable boot page', async function() {
    await driver.get(`${server.getHost()}/boot`);
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
      await driver.get(`${server.getHost()}/boot`);
      await hasPrompt();
    });

    it('gives prompt when key is wrong', async function() {
      await driver.get(`${server.getHost()}/boot/bilbo`);
      await hasPrompt();
    });

    it('gives page when key is right', async function() {
      await driver.get(`${server.getHost()}/boot/lala`);
      await driver.findContentWait('h2', /Grist is reachable/, 2000);
    });
  });
});
