/**
 *
 * This is a minimal test to make sure documents can be created, edited, and
 * reopened.  Grist has a very extensive test set that has not yet been ported
 * to the grist-core.
 *
 */

import { assert, driver } from 'mocha-webdriver';
import { server, setupTestSuite } from 'test/nbrowser/testUtils';
import * as gu from 'test/nbrowser/gristUtils';

async function openMainPage() {
  await driver.get(`${server.getHost()}`);
  while (true) {    // eslint-disable-line no-constant-condition
    try {
      if (await driver.findContent('button', /Create Empty Document/).isPresent()) {
        return;
      }
    } catch (e) {
      // don't worry about transients.
    }
    await driver.sleep(10);
  }
}

describe("Smoke", function() {
  this.timeout(20000);
  setupTestSuite();

  it('can create, edit, and reopen a document', async function() {
    this.timeout(20000);
    await openMainPage();
    await driver.findContent('button', /Create Empty Document/).click();
    await gu.waitForDocToLoad(20000);
    await gu.dismissWelcomeTourIfNeeded();
    await gu.getCell('A', 1).click();
    await gu.enterCell('123');
    await gu.refreshDismiss();
    assert.equal(await gu.getCell('A', 1).getText(), '123');
  });
});
