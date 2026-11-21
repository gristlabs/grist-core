import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Origin } from "mocha-webdriver";

/**
 * The frame of a page (the navigation panel, the header, the creator panel) is laid out in the
 * direction of the interface, which it reads from the page. What is put into the frame is held
 * left-to-right until it can be laid out either way too. The tests state the direction on the
 * page, the way the language of the interface does.
 */
describe("PanelDirection", function() {
  this.timeout("60s");
  const cleanup = setupTestSuite();

  type Dir = "ltr" | "rtl";

  async function setInterfaceDirection(dir: Dir) {
    await driver.executeScript((d: Dir) => document.documentElement.setAttribute("dir", d), dir);
  }

  // Distance from the start edge of the window to the start edge of the element, and its width.
  async function place(selector: string, dir: Dir): Promise<{ fromStart: number, fromEnd: number, width: number }> {
    const rect = await driver.find(selector).getRect();
    const win: number = await driver.executeScript(() => document.documentElement.clientWidth);
    const left = Math.round(rect.x), right = Math.round(win - rect.x - rect.width);
    return {
      fromStart: dir === "rtl" ? right : left,
      fromEnd: dir === "rtl" ? left : right,
      width: Math.round(rect.width),
    };
  }

  async function dragByX(x: number) {
    await driver.withActions((a) => {
      a.press()
        .move({ x, origin: Origin.POINTER, duration: 20 })
        .pause(500)   // As in test/projects/PagePanels.ts: required at least since Chrome version 146.
        .release();
    });
  }

  // The helpers wait for a panel's own transition; this lets the panes beside it settle too.
  async function waitForPanels() {
    await driver.sleep(600);
  }

  before(async function() {
    const session = await gu.session().login();
    await session.tempNewDoc(cleanup, "PanelDirection");
    await gu.toggleSidePanel("left", "open");
    await gu.toggleSidePanel("right", "open");
  });

  after(async function() {
    await setInterfaceDirection("ltr");
  });

  for (const dir of ["ltr", "rtl"] as const) {
    describe(`in a ${dir} interface`, function() {
      before(async function() {
        await setInterfaceDirection(dir);
        await gu.toggleSidePanel("left", "open");
        await gu.toggleSidePanel("right", "open");
        await waitForPanels();
      });

      it("puts the navigation panel where the page starts and the creator panel where it ends", async function() {
        assert.equal((await place(".test-left-panel", dir)).fromStart, 0);
        assert.equal((await place(".test-right-panel", dir)).fromEnd, 0);
        const main = await place(".test-main-pane", dir);
        assert.closeTo(main.fromStart, (await place(".test-left-panel", dir)).width, 2);
        assert.closeTo(main.fromEnd, (await place(".test-right-panel", dir)).width, 2);
      });

      it("orders the header from the same side", async function() {
        const left = await place(".test-left-opener", dir);
        const right = await place(".test-right-opener", dir);
        assert.isBelow(left.fromStart, right.fromStart);
      });

      it("closes and opens each panel against its own edge", async function() {
        await gu.toggleSidePanel("left", "close");
        await waitForPanels();
        const closed = await place(".test-left-panel", dir);
        assert.equal(closed.fromStart, 0);
        assert.isBelow(closed.width, 60);
        assert.closeTo((await place(".test-main-pane", dir)).fromStart, closed.width, 2);
        await gu.toggleSidePanel("left", "open");
        await waitForPanels();
        assert.isAbove((await place(".test-left-panel", dir)).width, 200);

        await gu.toggleSidePanel("right", "close");
        await waitForPanels();
        assert.closeTo((await place(".test-main-pane", dir)).fromEnd, 0, 2);
        await gu.toggleSidePanel("right", "open");
        await waitForPanels();
        assert.equal((await place(".test-right-panel", dir)).fromEnd, 0);
      });

      it("widens a panel when its edge is dragged toward the middle of the page", async function() {
        const towardMiddle = dir === "rtl" ? -1 : 1;
        const before = (await place(".test-left-panel", dir)).width;
        await driver.find(".test-left-resizer").mouseMove();
        await dragByX(30 * towardMiddle);
        await waitForPanels();
        assert.closeTo((await place(".test-left-panel", dir)).width, before + 30, 2);

        const beforeRight = (await place(".test-right-panel", dir)).width;
        await driver.find(".test-right-resizer").mouseMove();
        await dragByX(-30 * towardMiddle);
        await waitForPanels();
        assert.closeTo((await place(".test-right-panel", dir)).width, beforeRight + 30, 2);
      });

      it("lays out the navigation panel and the header in the direction of the frame", async function() {
        for (const selector of [".test-left-panel .test-dp-add-new", ".test-left-panel .test-treeview-itemHeader",
          ".test-top-header .test-bc-doc", ".test-left-panel .test-tools-raw"]) {
          assert.equal(await driver.find(selector).getCssValue("direction"), dir, selector);
        }
        // An item of the navigation panel has its icon where its line starts.
        const item = await driver.find(".test-left-panel .test-tools-raw");
        const icon = await item.find("[class*=icon], svg, div");
        const [itemRect, iconRect] = [await item.getRect(), await icon.getRect()];
        const fromStart = dir === "rtl" ?
          (itemRect.x + itemRect.width) - (iconRect.x + iconRect.width) : iconRect.x - itemRect.x;
        assert.isBelow(fromStart, itemRect.width / 2);
      });

      it("lays out the creator panel in the direction of the frame", async function() {
        await gu.openColumnPanel("A");
        assert.equal(await driver.find(".test-right-panel .test-right-tab-field").getCssValue("direction"), dir);
        assert.equal(await driver.find(".test-field-label").getCssValue("direction"), dir);
        // A column's identifier is code, and the alignment buttons are sides of the screen.
        assert.equal(await driver.find(".test-field-col-id").getCssValue("direction"), "ltr");
        assert.equal(await driver.find(".test-alignment-select").getCssValue("direction"), "ltr");
      });

      it("holds left-to-right what cannot yet be laid out either way", async function() {
        // The arrangement of widgets on a page; the interface pages of the main pane follow the frame.
        assert.equal(await driver.find(".test-main-content .layout_root").getCssValue("direction"), "ltr");
        assert.equal(await driver.find(".test-main-content").getCssValue("direction"), dir);
        // A widget's own frame (its title bar and menu) is part of the interface.
        assert.equal(await driver.find(".test-main-content .viewsection_title").getCssValue("direction"), dir);
      });
    });
  }
});
