import {assert, driver, stackWrapFunc, until} from 'mocha-webdriver';
import {server, setupTestSuite} from './testUtils';

describe('NotifyBar', function() {
  setupTestSuite();
  this.timeout(10000);      // Set a longer default timeout.

  before(async function() {
    this.timeout(90000);      // Set a longer default timeout.
    await driver.get(`${server.getHost()}/ErrorNotify`);
  });

  describe('toasts', function() {
    it('should allow creating default user errors', async function() {
      assert.equal((await toasts()).length, 0);
      await driver.find('.user-error-default').click();
      assert.equal((await toasts()).length, 1);
      const toast = await lastToast();
      await driver.wait(until.elementIsVisible(toast), 1000);
      await driver.wait(until.stalenessOf(toast), 3000);
      assert.equal((await toasts()).length, 0);
    });

    it('should allow creating user errors with custom (2 sec) timeout', async function() {
      this.timeout(3000); // 3 seconds
      assert.equal((await toasts()).length, 0);
      await driver.find('.user-error-2sec').click(); // 2 seconds
      assert.equal((await toasts()).length, 1);
      const toast = await lastToast();
      await driver.wait(until.elementIsVisible(toast), 1000);
      await driver.wait(until.stalenessOf(toast), 4000);
      assert.equal((await toasts()).length, 0);
    });
  });

});

const toasts = stackWrapFunc(async () => await driver.findAll('.test-notifier-toast-wrapper'));
const lastToast = stackWrapFunc(async () => await driver.find('.test-notifier-toast-wrapper:last-child'));
