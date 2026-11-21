import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

/**
 * The interface is laid out in the direction of its language, stated on the page itself. The
 * parts that cannot yet be laid out either way are held left-to-right, and documents keep the
 * direction of their own language.
 */
describe("InterfaceDirection", function() {
  this.timeout("60s");
  const cleanup = setupTestSuite();

  before(async function() {
    const session = await gu.session().login();
    await session.tempNewDoc(cleanup, "InterfaceDirection");
  });

  it("states the language and the direction of the interface on the page", async function() {
    const page = await driver.find("html");
    assert.equal(await page.getAttribute("lang"), "en");
    assert.equal(await page.getAttribute("dir"), "ltr");
  });

  it("marks every part that is held left-to-right", async function() {
    const holds: string[] = await driver.executeScript(() =>
      [...document.querySelectorAll("[data-direction-hold]")].map(el => el.getAttribute("dir")));
    assert.isAbove(holds.length, 0);
    assert.deepEqual([...new Set(holds)], ["ltr"]);
  });
});
