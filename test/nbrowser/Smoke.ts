/**
 *
 * This is a minimal test to make sure documents can be created, edited, and
 * reopened.  Grist has a very extensive test set that has not yet been ported
 * to the grist-core.
 *
 */

import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

async function openMainPage() {
  await driver.get(`${server.getHost()}`);
  while (true) {
    try {
      if (await driver.find(".test-intro-create-doc").isPresent()) {
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

  it("can create, edit, and reopen a document", async function() {
    this.timeout(20000);
    await openMainPage();
    await driver.find(".test-intro-create-doc").click();
    await gu.waitForDocToLoad(20000);
    await gu.dismissWelcomeTourIfNeeded();
    await gu.getCell("A", 1).click();

    await gu.enterCell(["123"]);
    // Also ensure that we don't require typing Enter to enter in editor mode
    await gu.getCell("B", 1).click();
    await gu.pressKeysOnCell("3");
    await driver.wait(() => driver.find(".cell_editor").isDisplayed(), 1000);
    await gu.pressKeysOnCell("21");
    await gu.reloadDoc();
    assert.equal(await gu.getCell("A", 1).getText(), "123");
  });
});
