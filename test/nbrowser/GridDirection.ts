import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

/**
 * The grid takes its direction from the DOM: it must lay out and behave correctly whichever
 * `dir` its pane inherits. There is no setting for it yet, so the tests put the attribute on
 * the pane directly, the way an ancestor (or a future setting) would.
 */
describe("GridDirection", function() {
  this.timeout("60s");
  const cleanup = setupTestSuite();

  type Dir = "ltr" | "rtl";

  async function setDirection(dir: Dir | null) {
    await driver.executeScript((d: Dir | null) => {
      document.querySelectorAll(".gridview_data_pane").forEach((pane) => {
        if (d) { pane.setAttribute("dir", d); } else { pane.removeAttribute("dir"); }
      });
    }, dir);
  }

  // Distance from the pane's inline-start edge to the element's inline-start edge.
  async function inlineStart(selector: string, dir: Dir): Promise<number> {
    const pane = await driver.find(".active_section .gridview_data_pane").getRect();
    const el = await driver.find(`.active_section ${selector}`).getRect();
    return dir === "rtl" ? (pane.x + pane.width) - (el.x + el.width) : el.x - pane.x;
  }

  async function headerInlineStart(col: string, dir: Dir): Promise<number> {
    const pane = await driver.find(".active_section .gridview_data_pane").getRect();
    const el = await gu.getColumnHeader(col).getRect();
    return dir === "rtl" ? (pane.x + pane.width) - (el.x + el.width) : el.x - pane.x;
  }

  before(async function() {
    const session = await gu.session().login();
    await session.tempNewDoc(cleanup, "GridDirection");
    await gu.sendActions([
      ["AddRecord", "Table1", null, { A: "apples", B: "avocados", C: "apricots" }],
      ["AddRecord", "Table1", null, { A: "bananas", B: "blueberries", C: "blackberries" }],
    ]);
  });

  afterEach(async function() {
    await setDirection(null);
  });

  for (const dir of ["ltr", "rtl"] as const) {
    // The key that moves the cursor toward the inline end of the grid, as seen on screen.
    const towardEnd = dir === "rtl" ? Key.ARROW_LEFT : Key.ARROW_RIGHT;
    const towardStart = dir === "rtl" ? Key.ARROW_RIGHT : Key.ARROW_LEFT;

    describe(`in a ${dir} grid`, function() {
      beforeEach(async function() {
        await setDirection(dir);
        await gu.getCell({ col: "A", rowNum: 1 }).click();
      });

      it("pins row numbers to the start edge and lays columns out from there", async function() {
        assert.closeTo(await inlineStart(".gridview_data_row_num", dir), 0, 2);
        const [a, b, c] = [
          await headerInlineStart("A", dir),
          await headerInlineStart("B", dir),
          await headerInlineStart("C", dir),
        ];
        assert.isAbove(a, 0);
        assert.isAbove(b, a);
        assert.isAbove(c, b);
      });

      it("moves the cursor in the direction of the arrow on screen", async function() {
        assert.deepEqual(await gu.getCursorPosition(), { rowNum: 1, col: 0 });
        await gu.sendKeys(towardEnd);
        assert.deepEqual(await gu.getCursorPosition(), { rowNum: 1, col: 1 });
        await gu.sendKeys(towardEnd);
        assert.deepEqual(await gu.getCursorPosition(), { rowNum: 1, col: 2 });
        await gu.sendKeys(towardStart);
        assert.deepEqual(await gu.getCursorPosition(), { rowNum: 1, col: 1 });
      });

      it("extends the selection in the direction of the arrow on screen", async function() {
        await gu.sendKeys(Key.chord(Key.SHIFT, towardEnd));
        const selected = await driver.findAll(".active_section .gridview_row .field.selected", e => e.getText());
        assert.deepEqual(selected, ["apples", "avocados"]);
        await gu.sendKeys(Key.ESCAPE);
      });

      it("opens the cell editor over its cell, in the cell's direction", async function() {
        const cell = await gu.getCell({ col: "B", rowNum: 1 }).getRect();
        await gu.getCell({ col: "B", rowNum: 1 }).click();
        await gu.sendKeys(Key.ENTER);
        const editor = await driver.findWait(".cell_editor", 1000);
        const rect = await editor.getRect();
        if (dir === "rtl") {
          assert.closeTo(rect.x + rect.width, cell.x + cell.width, 2);
        } else {
          assert.closeTo(rect.x, cell.x, 2);
        }
        assert.equal(await editor.getCssValue("direction"), dir);
        await gu.sendKeys(Key.ESCAPE);
      });

      it("resizes a column by dragging its end edge", async function() {
        const before = await gu.getColumnWidth("A");
        // The handle sits on the column's end edge; dragging it away from the column widens it.
        await gu.resizeColumn("A", dir === "rtl" ? -40 : 40);
        assert.closeTo(await gu.getColumnWidth("A"), before + 40, 2);
        await gu.undo();
        assert.closeTo(await gu.getColumnWidth("A"), before, 2);
      });

      it("moves a column to where it is dropped", async function() {
        await gu.moveColumn("A", "C");
        assert.deepEqual(await gu.getColumnNames(), ["B", "C", "A"]);
        await gu.undo();
        assert.deepEqual(await gu.getColumnNames(), ["A", "B", "C"]);
      });
    });
  }

  it("follows a direction set on an ancestor, and reverts when it is removed", async function() {
    await driver.executeScript(() => document.documentElement.setAttribute("dir", "rtl"));
    try {
      assert.closeTo(await inlineStart(".gridview_data_row_num", "rtl"), 0, 2);
    } finally {
      await driver.executeScript(() => document.documentElement.removeAttribute("dir"));
    }
    assert.closeTo(await inlineStart(".gridview_data_row_num", "ltr"), 0, 2);
  });
});
