import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

describe("RowNumbers", function() {
  this.timeout("60s");
  const cleanup = setupTestSuite();

  async function gutterTexts(): Promise<string[]> {
    return await driver.findAll(".active_section .gridview_data_row_num", e => e.getText());
  }

  async function gutterWidth(): Promise<number> {
    return (await driver.find(".active_section .gridview_data_row_num").getRect()).width;
  }

  // The panel control is a "Show" checkbox plus a link naming the shown mode ("row numbers" or
  // "row IDs") that opens a menu to switch.
  async function setRowNumbers(label: "Numbers" | "Row IDs" | "Hidden") {
    await gu.openWidgetPanel();
    if (label === "Hidden") {
      if (await driver.find(".test-row-numbers-show").matches(":checked")) {
        await driver.find(".test-row-numbers-show").click();
      }
    } else {
      await driver.find(".test-row-numbers-mode").click();
      await (await gu.findOpenMenu(1000)).findContent("li", label).click();
    }
    await gu.waitForServer();
  }

  before(async function() {
    const session = await gu.session().login();
    await session.tempNewDoc(cleanup, "RowNumbers");
    await gu.sendActions([
      ["AddRecord", "Table1", null, { A: "apples" }],
      ["AddRecord", "Table1", null, { A: "bananas" }],
      ["AddRecord", "Table1", null, { A: "cherries" }],
    ]);
  });

  it("shows row numbers by default", async function() {
    assert.deepEqual(await gutterTexts(), ["1", "2", "3", "4"]);
    assert.isFalse(await driver.find(".active_section .test-corner-label").isPresent());
  });

  it("shows bracketed row IDs in Row IDs mode, blank for the add-row", async function() {
    await setRowNumbers("Row IDs");
    assert.deepEqual(await gutterTexts(), ["[1]", "[2]", "[3]", ""]);
    // The corner labels the gutter in this mode.
    assert.equal(await driver.find(".active_section .test-corner-label").getText(), "ID");
  });

  it("keeps row IDs attached to their rows", async function() {
    await gu.sendActions([["RemoveRecord", "Table1", 2]]);
    assert.deepEqual(await gutterTexts(), ["[1]", "[3]", ""]);
    await gu.sendActions([["AddRecord", "Table1", null, { A: "dates" }]]);
    assert.deepEqual(await gutterTexts(), ["[1]", "[3]", "[4]", ""]);

    // Sort descending: numbers would renumber, but row IDs travel with their rows.
    await gu.openColumnMenu("A", "sort-dsc");
    assert.deepEqual(await gutterTexts(), ["[4]", "[3]", "[1]", ""]);
  });

  it("keeps row selection and row menu working in Row IDs mode", async function() {
    const firstGutter = driver.find(".active_section .gridview_data_row_num");
    await firstGutter.click();
    assert.include(await firstGutter.getAttribute("class"), "selected");
    await firstGutter.mouseMove();
    await firstGutter.find(".test-row-menu-trigger").click();
    assert.isTrue(await gu.findOpenMenu(1000).isDisplayed());
    await driver.sendKeys(Key.ESCAPE);
  });

  it("collapses the gutter in Hidden mode", async function() {
    await setRowNumbers("Hidden");
    assert.equal(await gutterWidth(), 0);
    assert.equal(
      (await driver.find(".active_section .gridview_data_corner_overlay").getRect()).width, 0);
    assert.isFalse(await driver.find(".active_section .test-corner-label").isPresent());

    // The record's left border is dropped too, so the grid's left edge shows a single border.
    assert.equal(
      await driver.find(".active_section .gridview_row .record").getCssValue("border-left-width"), "0px");

    // Row operations remain available via the cell context menu.
    const cell = driver.find(".active_section .gridview_row .record .field");
    await driver.withActions(a => a.contextClick(cell));
    const menu = await gu.findOpenMenu(1000);
    assert.isTrue(await menu.findContent("li", /Delete row/).isPresent());
    await driver.sendKeys(Key.ESCAPE);
  });

  it("keeps frozen columns flush with the left edge when hidden", async function() {
    // Clear the whole-row selection left by an earlier test: with the last column selected,
    // the column menu switches to its multi-column variant, which offers no freeze item.
    await driver.find(".active_section .gridview_row .record .field").click();
    await gu.openColumnMenu("A", "Freeze this column");
    await gu.waitForServer();
    const paneX = (await driver.find(".active_section .gridview_data_pane").getRect()).x;
    const frozenX = (await driver.find(".active_section .record .field.frozen").getRect()).x;
    assert.isAtMost(frozenX - paneX, 2);  // 1px record border; no 52px gutter offset
  });

  it("persists the mode across reload", async function() {
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();
    assert.equal(await gutterWidth(), 0);
  });

  it("restores the previous mode on undo", async function() {
    await setRowNumbers("Numbers");
    assert.equal(await gutterWidth(), 52);
    assert.equal(await driver.find(".active_section .gridview_data_row_num").getText(), "1");
    assert.equal(
      await driver.find(".active_section .gridview_row .record").getCssValue("border-left-width"), "1px");
    await gu.undo();
    assert.equal(await gutterWidth(), 0);
  });

  it("switches modes via the corner menu, even while hidden", async function() {
    // The gutter is currently hidden; the corner toggle sits over the first column header's
    // left edge, and is revealed by hovering it.
    const trigger = driver.find(".active_section .gridview_data_corner_overlay .test-corner-menu-trigger");
    await driver.find(".active_section .gridview_row .record .field").mouseMove();
    assert.equal(await trigger.getCssValue("opacity"), "0");
    await trigger.mouseMove();
    assert.equal(await trigger.getCssValue("opacity"), "1");
    await trigger.click();

    // The menu marks the active mode with a check.
    let menu = await gu.findOpenMenu(1000);
    assert.equal(await menu.find(".test-row-numbers-selected").findClosest("li").getText(), "Hidden");
    await menu.findContent("li", "Numbers").click();
    await gu.waitForServer();
    assert.equal(await gutterWidth(), 52);
    assert.deepEqual(await gutterTexts(), ["1", "2", "3", "4"]);

    // The check follows the active mode.
    await trigger.mouseMove();
    await trigger.click();
    menu = await gu.findOpenMenu(1000);
    assert.equal(await menu.find(".test-row-numbers-selected").findClosest("li").getText(), "Numbers");
    await driver.sendKeys(Key.ESCAPE);
  });

  it("opens the corner menu on right-click", async function() {
    await gu.rightClick(driver.find(".active_section .gridview_data_corner_overlay"));
    const menu = await gu.findOpenMenu(1000);
    assert.equal(await menu.find(".test-row-numbers-selected").findClosest("li").getText(), "Numbers");

    // The "Row IDs" item explains itself with an info tooltip.
    await menu.findContent("li", "Row IDs").find(".test-info-tooltip").mouseMove();
    const popup = await driver.findWait(".test-info-tooltip-popup", 1000);
    assert.match(await popup.getText(), /Row IDs are stable and unique numeric identifiers/);
    assert.match(await popup.find("a").getAttribute("href"), /col-refs\/#understanding-reference-columns/);
    await driver.sendKeys(Key.ESCAPE);
  });

  it("restores the last shown mode when re-checking Show", async function() {
    await setRowNumbers("Row IDs");
    await driver.find(".test-row-numbers-show").click();
    await gu.waitForServer();
    assert.equal(await gutterWidth(), 0);
    // The mode link still names the remembered mode while hidden.
    assert.equal(await driver.find(".test-row-numbers-mode").getText(), "row IDs");

    await driver.find(".test-row-numbers-show").click();
    await gu.waitForServer();
    assert.deepEqual(await gutterTexts(), ["[1]", "[3]", "[4]", ""]);
  });
});
