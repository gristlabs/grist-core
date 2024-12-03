/**
 *
 * This is a minimal test to make sure documents can be created, edited, and
 * reopened.  Grist has a very extensive test set that has not yet been ported
 * to the grist-core.
 *
 */

import { assert, driver, Key} from 'mocha-webdriver';
import { server, setupTestSuite } from 'test/nbrowser/testUtils';
import * as gu from 'test/nbrowser/gristUtils';

async function openMainPage() {
  await driver.get(`${server.getHost()}`);
  while (true) {    // eslint-disable-line no-constant-condition
    try {
      if (await driver.find('.test-intro-create-doc').isPresent()) {
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
    await driver.find('.test-intro-create-doc').click();
    await gu.waitForDocToLoad(20000);
    await gu.dismissWelcomeTourIfNeeded();
    await gu.getCell('A', 1).click();

    // Shouldn't be necessary, but an attempt to reduce flakiness that has shown up about opening the cell for editing.
    await gu.sendKeys(Key.ENTER);

    await gu.enterCell('123');
    await gu.refreshDismiss();
    assert.equal(await gu.getCell('A', 1).getText(), '123');
  });
});
