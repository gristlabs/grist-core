import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

/**
 * Two separate things decide how a cell's text is drawn. The order of its characters follows
 * its own content, so that Arabic reads right-to-left and English left-to-right in any sheet.
 * The side the text is pushed to follows the sheet and the column's alignment, so that a column
 * keeps one edge whatever languages it holds. As in GridDirection, the tests put `dir` on the
 * pane directly, the way a sheet's orientation (or an ancestor) would.
 */
describe("CellDirection", function() {
  this.timeout("60s");
  const cleanup = setupTestSuite();
  let docId: string;
  let session: gu.Session;

  type Dir = "ltr" | "rtl";
  const ARABIC = "علي";   // An Arabic name, three letters.

  async function setDirection(dir: Dir | null) {
    await driver.executeScript((d: Dir | null) => {
      document.querySelectorAll(".gridview_data_pane").forEach((pane) => {
        if (d) { pane.setAttribute("dir", d); } else { pane.removeAttribute("dir"); }
      });
    }, dir);
  }

  // The side of its cell on which the text of a cell is drawn.
  async function textSide(col: string, rowNum: number): Promise<"left" | "right" | "neither"> {
    return await driver.executeScript((cell: HTMLElement) => {
      const clip = cell.querySelector(".field_clip")!;
      const range = document.createRange();
      range.selectNodeContents(clip);
      const text = range.getBoundingClientRect();
      const box = clip.getBoundingClientRect();
      const fromLeft = text.left - box.left, fromRight = box.right - text.right;
      return fromLeft < 8 && fromRight > 8 ? "left" : fromRight < 8 && fromLeft > 8 ? "right" : "neither";
    }, await gu.getCell(col, rowNum));
  }

  // Whether the word is drawn to the left of the rest of the text of its cell.
  async function wordIsLeftmost(col: string, rowNum: number, word: string): Promise<boolean> {
    return await driver.executeScript((cell: HTMLElement, w: string) => {
      const walker = document.createTreeWalker(cell.querySelector(".field_clip")!, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode()!;
      const at = node.textContent!.indexOf(w);
      const rectOf = (from: number, to: number) => {
        const range = document.createRange();
        range.setStart(node, from);
        range.setEnd(node, to);
        return range.getBoundingClientRect();
      };
      const rest = at === 0 ? rectOf(w.length + 1, node.textContent!.length) : rectOf(0, at - 1);
      return rectOf(at, at + w.length).right <= rest.left + 1;
    }, await gu.getCell(col, rowNum), word);
  }

  async function alignmentButtons(): Promise<boolean[]> {
    return await driver.findAll(".test-alignment-select .test-select-button",
      el => el.matches("[class*=-selected]"));
  }

  async function savedAlignment(colId: string): Promise<string | undefined> {
    const cols = await session.createHomeApi().getDocAPI(docId).getRows("_grist_Tables_column");
    return JSON.parse(String(cols.widgetOptions[cols.colId.indexOf(colId)] || "{}")).alignment;
  }

  before(async function() {
    session = await gu.session().login();
    docId = await session.tempNewDoc(cleanup, "CellDirection");
    await gu.sendActions([
      ["ModifyColumn", "Table1", "B", { type: "Numeric" }],
      ["AddVisibleColumn", "Table1", "D", { type: "Date" }],
      ["AddRecord", "Table1", null, { A: ARABIC, B: 1250, C: `${ARABIC} Lee`, D: 1795046400 }],
      ["AddRecord", "Table1", null, { A: "Sarah", B: 980, C: `Lee ${ARABIC}`, D: 1795132800 }],
    ]);
  });

  afterEach(async function() {
    await setDirection(null);
  });

  for (const dir of ["ltr", "rtl"] as const) {
    const start = dir === "rtl" ? "right" : "left";
    const end = dir === "rtl" ? "left" : "right";

    describe(`in a ${dir} sheet`, function() {
      beforeEach(async function() {
        await setDirection(dir);
      });

      it("orders the characters of each cell by the cell's own content", async function() {
        // A cell that begins in Arabic reads right-to-left: what follows is to its left.
        assert.isTrue(await wordIsLeftmost("C", 1, "Lee"));
        // A cell that begins in English reads left-to-right: the English is at the left.
        assert.isTrue(await wordIsLeftmost("C", 2, "Lee"));
      });

      it("keeps one edge for a column of mixed languages, where the sheet starts", async function() {
        assert.equal(await textSide("A", 1), start);
        assert.equal(await textSide("A", 2), start);
        assert.equal(await textSide("C", 1), start);
        assert.equal(await textSide("C", 2), start);
        // Dates too, which are drawn by a widget of their own.
        assert.equal(await textSide("D", 1), start);
      });

      it("puts numbers where the sheet ends", async function() {
        assert.equal(await textSide("B", 1), end);
        assert.equal(await textSide("B", 2), end);
      });

      it("edits a cell on the side its text was on", async function() {
        await gu.getCell("A", 1).click();
        await gu.sendKeys("Sam");
        const editor = await driver.findWait(".celleditor_text_editor", 1000);
        assert.equal(await editor.getCssValue("text-align"), start);
        assert.equal(await editor.getCssValue("unicode-bidi"), "plaintext");
        await gu.sendKeys(Key.ESCAPE);
      });

      it("names the side a column is inserted on as it is seen", async function() {
        const items = (await (await gu.openColumnMenu("B")).findAll("li", el => el.getText()))
          .filter(text => text.includes("Insert column")).map(text => text.split("\n")[0]);
        // Inserting before comes first; that is at the left in one direction, the right in the other.
        assert.deepEqual(items, [`Insert column to the ${start}`, `Insert column to the ${end}`]);
        // The menu of a cell names them the same way.
        await gu.sendKeys(Key.ESCAPE);
        await gu.rightClick(gu.getCell("B", 1));
        const cellItems = (await (await gu.findOpenMenu()).findAll("li", el => el.getText()))
          .filter(text => text.includes("Insert column")).map(text => text.split("\n")[0]);
        assert.deepEqual(cellItems, items);
        await gu.sendKeys(Key.ESCAPE);
        await gu.openColumnMenu("B");
        await (await gu.findOpenMenu()).findContent("li", /Insert column to the left/).click();
        await gu.waitForServer();
        await gu.sendKeys(Key.ENTER);   // Accepts the new column's name.
        await gu.waitForServer();
        const names = await gu.getColumnNames();
        // The new column is at the left of B on screen: before it in a ltr sheet, after it in a rtl one.
        assert.equal(names.indexOf("B") - names.findIndex(name => !["A", "B", "C", "D"].includes(name)),
          dir === "rtl" ? -1 : 1);
        await gu.undo();
      });
    });
  }

  describe("a column's alignment", function() {
    before(async function() {
      await gu.openColumnPanel("A");
    });

    it("turns with the sheet", async function() {
      // Left, as columns are given it when any of their options is saved.
      assert.deepEqual(await alignmentButtons(), [true, false, false]);
      await (await driver.findAll(".test-alignment-select .test-select-button"))[2].click();
      await gu.waitForServer();
      assert.equal(await savedAlignment("A"), "right");
      assert.equal(await textSide("A", 1), "right");
      await setDirection("rtl");
      assert.equal(await textSide("A", 1), "left");
      assert.equal(await textSide("A", 2), "left");
    });

    it("is shown and chosen by the side that is seen", async function() {
      await setDirection("rtl");
      // What was saved as "right" is at the left of a right-to-left sheet.
      await gu.waitToPass(async () => assert.deepEqual(await alignmentButtons(), [true, false, false]));
      // Choosing the right-hand button puts the text at the right, where this sheet starts.
      await (await driver.findAll(".test-alignment-select .test-select-button"))[2].click();
      await gu.waitForServer();
      assert.equal(await textSide("A", 1), "right");
      assert.equal(await savedAlignment("A"), "left");
      assert.deepEqual(await alignmentButtons(), [false, false, true]);
      // The same column in a left-to-right sheet: at the left, and shown so.
      await setDirection("ltr");
      assert.equal(await textSide("A", 1), "left");
      await gu.waitToPass(async () => assert.deepEqual(await alignmentButtons(), [true, false, false]));
    });
  });
});
