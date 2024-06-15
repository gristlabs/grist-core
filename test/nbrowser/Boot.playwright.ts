import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/playwrightGristUtils';
import {server, setupTestSuite} from 'test/nbrowser/playwrightTestUtils';
import * as testUtils from 'test/server/testUtils';
import { test, expect, Page } from '@playwright/test';

/**
 * The boot page functionality has been merged with the Admin Panel.
 * Check that it behaves as a boot page did now.
 */
test.describe('Boot', () => {
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;

  test.afterEach(({ page }) => gu.checkForErrors(page));

  async function hasPrompt(page: Page) {
    // There is some glitchiness to when the text appears.
    const text = await page.getByText(/GRIST_BOOT_KEY/).textContent();
    expect(text).toContain('GRIST_BOOT_KEY=example-');
  }

  test('tells user about /admin', async function() {
    await driver.get(`${server.getHost()}/boot`);
    assert.match(await driver.getPageSource(), /\/admin/);
    // Switch to a regular place to that gu.checkForErrors won't panic -
    // it needs a Grist page.
    await driver.get(`${server.getHost()}`);
  });

  test('gives prompt about how to enable boot page', async function({ page }) {
    await driver.get(`${server.getHost()}/admin`);
    await hasPrompt(page);
  });

  test.describe('with a GRIST_BOOT_KEY', function() {
    test.beforeAll(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_BOOT_KEY = 'lala';
      await server.restart();
    });

    test.afterAll(async function() {
      oldEnv.restore();
      await server.restart();
    });

    test('gives prompt when key is missing', async function({ page }) {
      await driver.get(`${server.getHost()}/admin`);
      await hasPrompt(page);
    });

    test('gives prompt when key is wrong', async function({ page }) {
      await driver.get(`${server.getHost()}/admin?boot-key=bilbo`);
      await hasPrompt(page);
    });

    test('gives page when key is right', async function() {
      await driver.get(`${server.getHost()}/admin?boot-key=lala`);
      await driver.findContentWait('div', /Is home page available/, 2000);
    });
  });
});
