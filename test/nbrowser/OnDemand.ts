import { IClipboard } from "test/nbrowser/gristUtils";
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

// TODO: Assert that non-basic actions work on an onDemand table.
describe("OnDemand", function() {
  this.timeout("1m");
  const clipboard = gu.getLockableClipboard();
  const cleanup = setupTestSuite();
  let session: gu.Session;

  before(async function() {
    session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, "World.grist");
  });

  afterEach(async function() {
    await gu.checkForErrors();
  });

  it("should support marking table as on-demand", async function() {
    // Check a couple specific ones, including a reference column.
    await gu.waitToPass(async () =>
      assert.deepEqual(await gu.getVisibleGridCells({ cols: ["Name", "Country"], rowNums: [4, 10] }), [
        "Aachen", "Germany",
        "Abbotsford", "Canada",
      ]));

    // Check that we see a lot of cities.
    await gu.waitToPass(async () => assert.equal(await gu.getGridRowCount(), 4080));

    // Open view config side pane.
    await gu.openWidgetPanel("data");

    // Make sure "Advanced options" is hidden.
    assert.equal(await driver.find("[data-test-id=ViewConfig_advanced]").isPresent(), false);

    // Clear local storage - we don't want to restore latest position
    await driver.executeScript("window.localStorage.clear();");

    // Make this table on demand using the api.
    await makeOnDemand("City");

    // Check that the reference column shows countries
    assert.deepEqual(await gu.getVisibleGridCells({ cols: ["Name", "Country"], rowNums: [4, 10] }), [
      "Aachen", "Germany",
      "Abbotsford", "Canada",
    ]);
    // Check that we still see all cities.
    assert.equal(await gu.getGridRowCount(), 4080);

    // Switch to another view; check that we see other data, including cities.
    await gu.openPage("Country");

    await gu.getCell({ section: "Country", rowNum: 2, col: "Name" }).click();
    await gu.selectSectionByTitle("CountryLanguage");
    assert.equal(await gu.getGridRowCount(), 6);
    await gu.selectSectionByTitle("City");
    assert.equal(await gu.getGridRowCount(), 5);
    // Linked onDemand table has correct data, but (unfortunately) an unsupported formula column.
    assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 3], rowNums: [1, 2, 3, 4] }), [
      "Kabul",          "#Formula not supported",
      "Qandahar",       "#Formula not supported",
      "Herat",          "#Formula not supported",
      "Mazar-e-Sharif", "#Formula not supported"]);

    // Check that we can get details of the error.
    await gu.getCell({ section: "City", rowNum: 1, col: 3 }).click();
    await gu.waitAppFocus(true);
    await gu.sendKeys(Key.ENTER);
    await gu.waitAppFocus(false);
    await gu.waitForServer();
    await gu.waitToPass(async () => {
      assert.match(await driver.find(".test-formula-error-msg").getText(),
        /Formula not supported.*on-demand.*unmark/si);
    });
    await gu.sendKeys(Key.ESCAPE);    // Close the formula editor.
    await gu.waitAppFocus(true);

    // Unmark the table as "on-demand".
    await gu.openWidgetPanel("data");
    await driver.findWait("[data-test-id=ViewConfig_advanced]", 2000).click();
    await driver.findWait("[data-test-id=ViewConfig_onDemandBtn]", 2000).click();
    await driver.findContentWait(".test-modal-dialog button", /Unmark/, 2000).click();

    // Wait for the page to reload, i.e. "confirm" dialog to close, and then check wait for title
    // to be present again.
    await gu.waitForServer(4000);   // This could take longer, since it waits for doc to re-open
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();

    // See that there are now countries and cities loaded in that view.
    await gu.getCell({ section: "Country", rowNum: 2, col: "Name" }).click();
    await gu.selectSectionByTitle("CountryLanguage");
    assert.equal(await gu.getGridRowCount(), 6);
    await gu.selectSectionByTitle("City");
    assert.equal(await gu.getGridRowCount(), 5);
    // Now that the table is regular, both data and formulas are correct.
    await gu.waitToPass(async () =>
      assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 3], rowNums: [1, 2, 3, 4] }), [
        "Kabul",          "1780",
        "Qandahar",       "238",
        "Herat",          "187",
        "Mazar-e-Sharif", "128"]), 1000);
  });

  it("should allow add, update, remove and undo in an on-demand table", async function() {
    // Create a new table.
    await gu.addNewTable("New");

    // Convert the new table to on-demand.
    await makeOnDemand("New");

    // Add a record to column A of the new table. This also tests a bug with adding records to
    // a previously empty formula column of an on-demand table.
    await gu.enterCell(["hello"]);
    assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1] }), [
      "hello", "", ""]);

    // Add/update a few more records in the table.
    await gu.enterGridValues(1, 0, [["the", "quick"]]);
    await gu.enterGridValues(0, 1, [["brown", "fox", "jumped"]]);
    await gu.enterGridValues(3, 0, [["over"]]);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3, 4] }), [
      "hello", "brown",  "",
      "the",   "fox",    "",
      "quick", "jumped", "",
      "over",  "",       ""]);

    // Undo an add action.
    await gu.undo();
    assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3] }), [
      "hello", "brown",  "",
      "the",   "fox",    "",
      "quick", "jumped", ""]);

    // Add multiple records to the table.
    await gu.selectGridArea([2, 0], [3, 1]);
    await clipboard.lockAndPerform(async (cb: IClipboard) => {
      await cb.copy();
      await gu.getCell(1, 4).click();
      await cb.paste();
    });
    await gu.waitForServer();
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3, 4, 5] }), [
        "hello", "brown",  "",
        "the",   "fox",    "",
        "quick", "jumped", "",
        "",      "the",    "fox",
        "",      "quick",  "jumped"]);
    }, 1000);

    // Undo bulk add action.
    await gu.undo();
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3, 4, 5] }), [
        "hello", "brown",  "",
        "the",   "fox",    "",
        "quick", "jumped", "",
        "",      "",       "",
        undefined, undefined, undefined]);
    }, 1000);

    // Update individual records in the table.
    await gu.getCell(1, 2).click();
    await gu.enterCell(["dog"]);
    await gu.waitForServer();
    await gu.getCell(0, 3).click();
    await gu.enterCell(["lazy"]);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3] }), [
      "hello", "brown",  "",
      "the",   "dog",    "",
      "lazy",  "jumped", ""]);

    // Undo individual update actions.
    await gu.undo(2);
    assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3] }), [
      "hello", "brown",  "",
      "the",   "fox",    "",
      "quick", "jumped", ""]);

    // Update multiple records in the table.
    await gu.waitAppFocus(true);
    await gu.selectGridArea([1, 0], [3, 0]);
    await clipboard.lockAndPerform(async (cb: IClipboard) => {
      await cb.copy();
      await gu.getCell(1, 2).click();
      await cb.paste();
    });
    await gu.waitForServer();
    // FIXME: Despite the waitToPass, there is some flakiness here. Needs help.
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3, 4] }), [
        "hello", "brown", "",
        "the",   "hello", "",
        "quick", "the",   "",
        "",      "quick", ""]);
    }, 1000);

    // Undo bulk update action.
    await gu.undo();
    assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3] }), [
      "hello", "brown",  "",
      "the",   "fox",    "",
      "quick", "jumped", ""]);

    // Remove a row from the table.
    await gu.getCell(0, 2).click();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.waitForServer();
    await gu.confirm(true, true);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3] }), [
      "hello", "brown",  "",
      "quick", "jumped", "",
      "",      "",       ""]);

    // Undo single remove action.
    await gu.undo();
    assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3] }), [
      "hello", "brown",  "",
      "the",   "fox",    "",
      "quick", "jumped", ""]);

    // Remove multiple rows from the table.
    await gu.selectGridArea([1, 0], [2, 0]);
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2] }), [
      "quick", "jumped", "",
      "",    "",    ""]);

    // Undo bulk remove action.
    await gu.undo();
    assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3] }), [
      "hello", "brown",  "",
      "the",   "fox",    "",
      "quick", "jumped", ""]);
  });

  it("should always add records at the end", async function() {
    // Add rows in a bunch of different locations and assert their positions.
    await gu.getCell(0, 4).click();
    await gu.enterCell(["1"]);
    await gu.enterCell(["2"]);
    assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3, 4, 5] }), [
      "hello", "brown",  "",
      "the",   "fox",    "",
      "quick", "jumped", "",
      "1",     "",       "",
      "2",     "",       ""]);

    // Perform removal actions and assert that the rows are re-added to the correct places on undo.
    await gu.deleteRow(4);

    await gu.waitForServer(4);

    await gu.undo();
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3, 4] }), [
        "hello", "brown",  "",
        "the",   "fox",    "",
        "quick", "jumped", "",
        "2",     "",       ""]);
    }, 2000);

    await gu.undo();
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3, 4, 5] }), [
        "hello", "brown",  "",
        "the",   "fox",    "",
        "quick", "jumped", "",
        "1",     "",       "",
        "2",     "",       ""]);
    }, 1000);

    // Redo all removals and assert that the table is as before the test.
    await gu.redo(2);
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2], rowNums: [1, 2, 3] }), [
        "hello", "brown",  "",
        "the",   "fox",    "",
        "quick", "jumped", ""]);
    }, 1000);
  });

  it("should allow adding functional columns", async function() {
    // Add a column.
    await gu.getCell(2, 1).click();
    await gu.waitAppFocus(true);
    await gu.sendKeys(Key.chord(Key.ALT, "="));
    await gu.waitForServer();
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitAppFocus(true);
    // Add values to the new columns and make sure no errors arise.
    await gu.getCell(3, 1).click();
    await gu.enterCell(["abcd"]);
    await gu.waitForServer();
    await gu.waitAppFocus(true);
    await gu.enterCell(["defg"]);
    await gu.waitAppFocus(true);
    assert.deepEqual(await gu.getVisibleGridCells({ cols: [0, 1, 2, 3], rowNums: [1, 2, 3] }), [
      "hello", "brown",  "", "abcd",
      "the",   "fox",    "", "defg",
      "quick", "jumped", "", ""]);
    await gu.checkForErrors();
  });

  async function makeOnDemand(tableId: string) {
    const api = session.createHomeApi().getDocAPI(await gu.getDocId());
    const [table] = await api.getRecords("_grist_Tables", {
      filters: { tableId: [tableId] },
    });
    await gu.sendActions([
      ["UpdateRecord", "_grist_Tables", table.id, { onDemand: true }],
    ]);
    await api.forceReload();
    await gu.reloadDoc();
  }
});
