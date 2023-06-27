import { assert, driver } from 'mocha-webdriver';
import { gu, server, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('Health.ntest', function() {
  test.setupTestSuite(this);

  before(async function() {
    await gu.supportOldTimeyTestCode();
  });

  it('make sure the health check endpoint returns something', async function() {
    await driver.get(server.getHost() + "/status")
    const txt = await driver.getPageSource();
    assert.match(txt, /Grist .* is alive/);
  });

});
