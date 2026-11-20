import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key, WebElement } from "mocha-webdriver";

/**
 * Menus, dropdown lists and dialogs belong to the interface: they are laid out in its direction
 * wherever they are opened from, and open on the side that suits it. The tests state the
 * direction on the page, the way the language of the interface does.
 */
describe("PopupDirection", function() {
  this.timeout("60s");
  const cleanup = setupTestSuite();

  type Dir = "ltr" | "rtl";

  async function setInterfaceDirection(dir: Dir) {
    await driver.executeScript((d: Dir) => document.documentElement.setAttribute("dir", d), dir);
  }

  async function setSheetDirection(dir: Dir | null) {
    await driver.executeScript((d: Dir | null) => {
      document.querySelectorAll(".gridview_data_pane").forEach((pane) => {
        if (d) { pane.setAttribute("dir", d); } else { pane.removeAttribute("dir"); }
      });
    }, dir);
  }

  // The distance between the start edges of two elements, and between their end edges.
  async function edges(a: WebElement, b: WebElement, dir: Dir): Promise<{ start: number, end: number }> {
    const [ra, rb] = [await a.getRect(), await b.getRect()];
    const left = Math.abs(ra.x - rb.x), right = Math.abs((ra.x + ra.width) - (rb.x + rb.width));
    return dir === "rtl" ? { start: right, end: left } : { start: left, end: right };
  }

  before(async function() {
    const session = await gu.session().login();
    await session.tempNewDoc(cleanup, "PopupDirection");
    await gu.toggleSidePanel("left", "open");
  });

  after(async function() {
    await setInterfaceDirection("ltr");
  });

  afterEach(async function() {
    await gu.sendKeys(Key.ESCAPE);
    await setSheetDirection(null);
  });

  for (const dir of ["ltr", "rtl"] as const) {
    describe(`in a ${dir} interface`, function() {
      before(async function() {
        await setInterfaceDirection(dir);
      });

      it("lays a menu out in the direction of the interface", async function() {
        await driver.find(".test-dp-add-new").click();
        const menu = await gu.findOpenMenu();
        assert.equal(await menu.getCssValue("direction"), dir);
        // The text of an item is where a line starts, and its icon before it.
        const item = await menu.find("li");
        assert.equal(await item.getCssValue("direction"), dir);
      });

      it("lines a menu up with the start edge of what opened it", async function() {
        const button = await driver.find(".test-dp-add-new");
        await button.click();
        const menu = await gu.findOpenMenu();
        const { start, end } = await edges(menu, button, dir);
        assert.isBelow(start, 12);
        assert.isAbove(end, start);
      });

      it("gives a menu opened from a sheet the direction of the interface, not the sheet's", async function() {
        const sheetDir = dir === "rtl" ? "ltr" : "rtl";
        await setSheetDirection(sheetDir);
        const menu = await gu.openColumnMenu("B");
        assert.equal(await menu.getCssValue("direction"), dir);
      });

      it("keeps a key combination in its own order", async function() {
        const menu = await gu.openColumnMenu("B");
        const keys = await menu.findContent("li", /Rename column/).find("span[dir]");
        assert.equal(await keys.getAttribute("dir"), "ltr");
        assert.match(await keys.getText(), /^(Ctrl|⌘)/);
      });

      it("lays a dialog out in the direction of the interface", async function() {
        await driver.find(".test-tb-share").click();
        await driver.findWait(".test-save-copy", 1000).click();
        const dialog = await driver.findWait(".test-modal-dialog", 8000);
        assert.equal(await dialog.getCssValue("direction"), dir);
        await gu.sendKeys(Key.ESCAPE);
      });

      it("holds nothing at the level of the page", async function() {
        assert.equal(await driver.find("body").getCssValue("direction"), dir);
        assert.isNull(await driver.find("body").getAttribute("data-direction-hold"));
      });
    });
  }
});
