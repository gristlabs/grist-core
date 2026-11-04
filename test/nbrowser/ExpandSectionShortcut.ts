import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

describe("ExpandSectionShortcut", function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  it("maximizes and un-maximizes the active section via keyboard shortcut", async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);

    // The overlay element itself is always in the DOM; its close button only renders while a
    // section is maximized, so that's what indicates the maximized state (same as gu.expandSection()).
    await gu.getCell(0, 1).click();
    assert.isFalse(await driver.find(".test-viewLayout-overlay .test-close-button").isPresent());

    // Mod+Shift+F maximizes the active section...
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.SHIFT, "f"));
    await driver.findWait(".test-viewLayout-overlay .test-close-button", 500);

    // ...and pressing it again un-maximizes it.
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.SHIFT, "f"));
    assert.isFalse(await driver.find(".test-viewLayout-overlay .test-close-button").isPresent());

    // Escape also closes it, as it already does when maximizing via the menu.
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.SHIFT, "f"));
    await driver.findWait(".test-viewLayout-overlay .test-close-button", 500);
    await gu.sendKeys(Key.ESCAPE);
    assert.isFalse(await driver.find(".test-viewLayout-overlay .test-close-button").isPresent());

    await gu.checkForErrors();
  });
});
