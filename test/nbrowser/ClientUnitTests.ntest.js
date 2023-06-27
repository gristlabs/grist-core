import { driver } from 'mocha-webdriver';
import { $, gu, server, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('ClientUnitTests.ntest', function() {
  test.setupTestSuite(this);

  before(async function() {
    await gu.supportOldTimeyTestCode();
    var timingTests = process.env.ENABLE_TIMING_TESTS ? 1 : 0;
    await driver.get(server.getHost() + '/v/gtag/test.html?timing=' + timingTests);
  });

  it('should reach 100% with no failures', async function() {
    this.timeout(30000);  // You've got 30 seconds

    await $('#mocha-status:contains(DONE)').wait();

    const failures = await driver.executeScript('return mocha.failedTests;');
    if (failures.length > 0) {
      var listing = failures.map(fail => fail.title + ': ' + fail.error).join("\n");
      throw new Error("Browser returned " + failures.length + " failed tests:\n" + listing);
    }
  });
});
