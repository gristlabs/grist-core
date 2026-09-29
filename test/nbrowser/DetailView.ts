import * as gu from "test/nbrowser/gristUtils";
import { cleanupExtraWindows, server, setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

describe("DetailView", function() {
  this.timeout(20000);
  cleanupExtraWindows();
  const cleanup = setupTestSuite();

  // Before create new document.
  before(async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);

    await gu.sendActions([
      ["AddRecord", "Table1", null, { A: "some text", B: server.getHost() }],
    ]);
    await gu.addNewSection("Card", "Table1");
  });

  it("opens cell for editing when clicked", async () => {
    const fieldA = await gu.getDetailCell("A", 1);

    // Make sure the cell is not in edit mode.
    assert.equal(await fieldA.getText(), "some text");
    assert.equal(await driver.find(".test-widget-text-editor").isPresent(), false);

    // Now click on the cell and make sure it is in edit mode.
    await fieldA.click(); // first is to select it
    await fieldA.click(); // second is to edit it
    assert.equal(await driver.find(".test-widget-text-editor").isPresent(), true);
    await gu.checkTextEditor("some text");

    // The tests below assert that no editor is open. One left behind here is still on its way
    // out while they look, which on a quick machine is what they find.
    await gu.sendKeys(Key.ESCAPE);
    await driver.wait(async () => !(await driver.find(".test-widget-text-editor").isPresent()), 1000);
  });

  it("does not opens cell for editing when clicked on link", async () => {
    const fieldB = await gu.getDetailCell("B", 1);

    // First select the cell.
    await fieldB.click();
    // Now click on the link and make sure it is not in edit mode.
    await fieldB.find(".test-tb-link-icon").click();

    assert.equal(await fieldB.getText(), server.getHost());
    await driver.sleep(100); // This click is ignored, so wait for a bit.
    assert.equal(await driver.find(".test-widget-text-editor").isPresent(), false);
  });

  it("does not open cell for editing when the link is double-clicked", async () => {
    // A double click made of two clicks on different elements lands on the ancestor they share:
    // here the cell, not the link. Raised directly, since two driver clicks may not be doubled.
    const fieldB = await gu.getDetailCell("B", 1);
    await driver.executeScript((cell: HTMLElement, link: HTMLElement) => {
      const box = link.getBoundingClientRect();
      cell.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }));
    }, fieldB, await fieldB.find(".test-tb-link-icon"));

    assert.equal(await fieldB.getText(), server.getHost());
    await driver.sleep(100); // The double click is ignored, so wait for a bit.
    assert.equal(await driver.find(".test-widget-text-editor").isPresent(), false);
  });
});
