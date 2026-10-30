import * as gu from "test/nbrowser/gristUtils";
import { cleanupExtraWindows, server, setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key, WebElement } from "mocha-webdriver";

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
      ["AddRecord", "Table1", null, { A: "other text", B: server.getHost() }],
    ]);
    await gu.addNewSection("Card", "Table1");
    await gu.addNewSection("Card List", "Table1");
  });

  it("does not edit when the same field is selected in another record", async () => {
    const firstRecord = await gu.getDetailCell("A", 1, "TABLE1 Card List");
    const secondRecord = await gu.getDetailCell("A", 2, "TABLE1 Card List");

    await firstRecord.click();
    await secondRecord.click();
    assert.equal(await driver.find(".test-widget-text-editor").isPresent(), false);

    // A second click on the newly selected cell should still start editing it.
    await secondRecord.click();
    assert.equal(await driver.find(".test-widget-text-editor").isPresent(), true);
    await gu.checkTextEditor("other text");

    await gu.sendKeys(Key.ESCAPE);
    await driver.wait(async () => !(await driver.find(".test-widget-text-editor").isPresent()), 1000);
    await gu.getSection("TABLE1 Card").click();
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

  describe("with cards taller than their section", function() {
    before(async function() {
      // Enough cards that a card list doesn't render them all at once.
      const numCards = 60;
      const colIds = Array.from({ length: 50 }, (_, i) => `F${i}`);
      await gu.sendActions([
        ["AddTable", "Tall", colIds.map(id => ({ id, type: "Text" }))],
        ["BulkAddRecord", "Tall", Array(numCards).fill(null), {
          F0: Array.from({ length: numCards }, (_, i) => `first${i + 1}`),
          F49: Array.from({ length: numCards }, (_, i) => `last${i + 1}`),
        }],
      ]);
    });

    it("scrolls a tall card to keep the selected field in view", async () => {
      await gu.addNewPage("Card", "Tall");
      await gu.getDetailCell("F0", 1).click();

      // The last field is well below the fold.
      await gu.sendKeys(Key.END);
      assert.equal((await gu.getCursorPosition()).col, "F49");
      assert.equal(await gu.getActiveCell().getText(), "last1");
      assert.isTrue(await isCursorInView(".detailview_single"));

      await gu.sendKeys(Key.HOME);
      assert.equal((await gu.getCursorPosition()).col, "F0");
      assert.equal(await gu.getActiveCell().getText(), "first1");
      assert.isTrue(await isCursorInView(".detailview_single"));

      // Opening an editor brings back a field that was scrolled out of sight.
      await scrollPaneBy(".detailview_single", 1000);
      assert.isFalse(await isCursorInView(".detailview_single"));
      await gu.sendKeys(Key.ENTER);
      await gu.checkTextEditor("first1");
      assert.isTrue(await isCursorInView(".detailview_single"));
      await gu.sendKeys(Key.ESCAPE);
    });

    it("scrolls tall cards in a card list to keep the selected field in view", async () => {
      await gu.addNewPage("Card List", "Tall");
      await gu.getDetailCell("F0", 1).click();

      await gu.sendKeys(Key.END);
      assert.deepEqual(await gu.getCursorPosition(), { rowNum: 1, col: "F49" });
      assert.equal(await gu.getActiveCell().getText(), "last1");
      assert.isTrue(await isCursorInView(".detailview_scroll_pane"));

      // Moving to another card scrolls that card into view, which must not hide the selected field,
      // whether it is at the bottom of the card or the top.
      await gu.sendKeys(Key.PAGE_DOWN);
      assert.deepEqual(await gu.getCursorPosition(), { rowNum: 2, col: "F49" });
      assert.equal(await gu.getActiveCell().getText(), "last2");
      assert.isTrue(await isCursorInView(".detailview_scroll_pane"));

      await gu.sendKeys(Key.HOME);
      assert.deepEqual(await gu.getCursorPosition(), { rowNum: 2, col: "F0" });
      assert.equal(await gu.getActiveCell().getText(), "first2");
      assert.isTrue(await isCursorInView(".detailview_scroll_pane"));

      // Opening an editor brings back a field that was scrolled out of sight, within its card.
      await scrollPaneBy(".detailview_scroll_pane", 1000);
      assert.isFalse(await isCursorInView(".detailview_scroll_pane"));
      await gu.sendKeys(Key.ENTER);
      await gu.checkTextEditor("first2");
      assert.isTrue(await isCursorInView(".detailview_scroll_pane"));
      await gu.sendKeys(Key.ESCAPE);

      await gu.sendKeys(Key.PAGE_DOWN);
      assert.deepEqual(await gu.getCursorPosition(), { rowNum: 3, col: "F0" });
      assert.equal(await gu.getActiveCell().getText(), "first3");
      assert.isTrue(await isCursorInView(".detailview_scroll_pane"));

      await gu.sendKeys(Key.PAGE_UP);
      assert.deepEqual(await gu.getCursorPosition(), { rowNum: 2, col: "F0" });
      assert.equal(await gu.getActiveCell().getText(), "first2");
      assert.isTrue(await isCursorInView(".detailview_scroll_pane"));
    });

    it("does not scroll back to the cursor while scrolling a card list", async () => {
      await gu.addNewPage("Card List", "Tall");
      await gu.getDetailCell("F0", 1).click();

      // Scroll far enough for the cursor's card to stop being rendered, then back to just past
      // it, so that it is rendered again (off-screen).
      const pane = await driver.find(".detailview_scroll_pane");
      const cardHeight: number = await driver.executeScript((p: HTMLElement) => {
        const [card1, card2] = p.querySelectorAll(".g_record_detail");
        return card2.getBoundingClientRect().top - card1.getBoundingClientRect().top;
      }, pane);
      await scrollPaneTo(pane, 1e6);
      assert.isFalse(await isValueRendered(pane, /^last1$/));
      const target = Math.round(cardHeight * 1.5);
      await scrollPaneTo(pane, target);
      assert.isTrue(await isValueRendered(pane, /^last1$/));

      const scrollTop: number = await driver.executeScript((p: HTMLElement) => p.scrollTop, pane);
      assert.closeTo(scrollTop, target, 2);
      assert.deepEqual(await gu.getCursorPosition(), { rowNum: 1, col: "F0" });
    });

    it("shows the top of a tall card when a linked card list moves to it", async () => {
      await gu.addNewPage("Table", "Tall");
      await gu.addNewSection("Card List", "Tall", { selectBy: /TALL/ });

      // The card list follows the table without being focused, so only its card is scrolled to.
      await gu.getCell("F0", 5, "TALL").click();
      const pane = await driver.find(".detailview_scroll_pane");
      await gu.waitToPass(async () => {
        assert.isTrue(await isInView(await pane.findContent(".g_record_detail_value", /^first5$/), pane));
      });
    });
  });
});

// Whether the selected field is entirely within the visible part of the enclosing scroll pane.
async function isCursorInView(paneSelector: string): Promise<boolean> {
  const cell = await gu.getActiveCell();
  return isInView(cell, cell.findClosest(paneSelector));
}

async function isInView(elem: WebElement, pane: WebElement): Promise<boolean> {
  return driver.executeScript((e: HTMLElement, p: HTMLElement) => {
    const box = e.getBoundingClientRect();
    const paneBox = p.getBoundingClientRect();
    return box.top >= paneBox.top && box.bottom <= paneBox.bottom;
  }, elem, pane);
}

// The scroll helpers send the scroll event right away, since a browser may hold it back, and the
// card list only renders cards when it handles it.
async function scrollPaneBy(paneSelector: string, delta: number) {
  await driver.executeScript((p: HTMLElement, d: number) => {
    p.scrollTop += d;
    p.dispatchEvent(new Event("scroll"));
  }, driver.find(paneSelector), delta);
}

async function scrollPaneTo(pane: WebElement, top: number) {
  await driver.executeScript((p: HTMLElement, t: number) => {
    p.scrollTop = t;
    p.dispatchEvent(new Event("scroll"));
  }, pane, top);
}

async function isValueRendered(pane: WebElement, value: RegExp): Promise<boolean> {
  return pane.findContent(".g_record_detail_value", value).isPresent();
}
