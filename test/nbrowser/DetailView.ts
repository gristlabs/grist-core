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

  it("scrolls a tall card to keep the selected field in view", async () => {
    const colIds = Array.from({ length: 50 }, (_, i) => `F${i}`);
    await gu.sendActions([
      ["AddTable", "Tall", colIds.map(id => ({ id, type: "Text" }))],
      ["AddRecord", "Tall", null, { F0: "first", F49: "last" }],
    ]);
    await gu.addNewPage("Card", "Tall");

    await gu.getDetailCell("F0", 1).click();
    assert.isTrue(await isCursorInView(".detailview_single"));

    // Tab through to the last field, which is well below the fold. It should get scrolled into view.
    for (let i = 1; i < colIds.length; i++) {
      await gu.sendKeys(Key.TAB);
    }
    assert.equal((await gu.getCursorPosition()).col, "F49");
    assert.equal(await gu.getActiveCell().getText(), "last");
    assert.isTrue(await isCursorInView(".detailview_single"));

    // And back up to the first.
    for (let i = 1; i < colIds.length; i++) {
      await gu.sendKeys(Key.chord(Key.SHIFT, Key.TAB));
    }
    assert.equal((await gu.getCursorPosition()).col, "F0");
    assert.isTrue(await isCursorInView(".detailview_single"));
  });

  it("scrolls tall cards in a card list to keep the selected field in view", async () => {
    await gu.sendActions([
      ["AddRecord", "Tall", null, { F0: "first2", F49: "last2" }],
      ["AddRecord", "Tall", null, { F0: "first3", F49: "last3" }],
    ]);
    await gu.addNewPage("Card List", "Tall");

    await gu.getDetailCell("F0", 1).click();
    assert.isTrue(await isCursorInView(".detailview_scroll_pane"));

    for (let i = 1; i < 50; i++) {
      await gu.sendKeys(Key.TAB);
    }
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 1, col: "F49" });
    assert.equal(await gu.getActiveCell().getText(), "last");
    assert.isTrue(await isCursorInView(".detailview_scroll_pane"));

    // Moving to the next card keeps the same field, which should be in view there too.
    await gu.sendKeys(Key.PAGE_DOWN);
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 2, col: "F49" });
    assert.equal(await gu.getActiveCell().getText(), "last2");
    assert.isTrue(await isCursorInView(".detailview_scroll_pane"));

    // And moving back up to the first field of that card.
    for (let i = 1; i < 50; i++) {
      await gu.sendKeys(Key.chord(Key.SHIFT, Key.TAB));
    }
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 2, col: "F0" });
    assert.isTrue(await isCursorInView(".detailview_scroll_pane"));
  });
});

// Whether the selected field is entirely within the visible part of the enclosing scroll pane.
async function isCursorInView(paneSelector: string): Promise<boolean> {
  return driver.executeScript((cell: HTMLElement, selector: string) => {
    const pane = cell.closest(selector)!;
    const box = cell.getBoundingClientRect();
    const paneBox = pane.getBoundingClientRect();
    return box.top >= paneBox.top && box.bottom <= paneBox.bottom;
  }, await gu.getActiveCell(), paneSelector);
}
