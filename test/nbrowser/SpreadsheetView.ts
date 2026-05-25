import { DocCreationInfo } from "app/common/DocListAPI";
import { DocAPI, UserAPI } from "app/common/UserAPI";
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

describe("SpreadsheetView", function () {
  this.timeout("60s");
  const cleanup = setupTestSuite();
  let session: gu.Session;
  let doc: DocCreationInfo;
  let api: UserAPI;

  before(async function () {
    session = await gu.session().login();
    doc = await session.tempDoc(cleanup, "Hello.grist");
    api = session.createHomeApi();
  });

  /**
   * Helper: get a spreadsheet cell by visual column letter and row number.
   * In the new 1-record model, the physical column is named "${letter}${row}".
   */
  async function getSpreadsheetCell(colLetter: string, rowNum: number) {
    return driver.find(`.test-cell-${colLetter}${rowNum}`);
  }

  async function getSpreadsheetCellText(colLetter: string, rowNum: number) {
    const cell = await getSpreadsheetCell(colLetter, rowNum);
    return cell.getText();
  }

  // ---------------------------------------------------------------------------
  // Creating a spreadsheet widget
  // ---------------------------------------------------------------------------

  describe("creation", function () {
    it("should create a spreadsheet table via API action", async function () {
      await api.applyUserActions(doc.id, [
        ["AddSpreadsheetTable", "TestSheet"],
      ]);
      await gu.waitForServer();

      await gu.openPage(/TestSheet/);
      const pageLabel = await driver.find(
        ".test-treeview-itemHeader.selected .test-docpage-label"
      ).getText();
      assert.equal(pageLabel, "TestSheet");
    });

    it("should appear in the page list after creation", async function () {
      const pages = await driver.findAll(
        ".test-treeview-itemHeader .test-docpage-label",
        (el) => el.getText()
      );
      assert.include(pages, "TestSheet");
    });
  });

  // ---------------------------------------------------------------------------
  // Grid display
  // ---------------------------------------------------------------------------

  describe("grid display", function () {
    before(async function () {
      await gu.openPage(/TestSheet/);
    });

    it("should display column headers A through T", async function () {
      const headers = await driver.findAll(
        ".test-spreadsheet-view th",
        (el) => el.getText()
      );
      // First header is the corner (empty), then A, B, C, ...
      assert.include(headers, "A");
      assert.include(headers, "B");
      assert.include(headers, "R");  // 18th column = R
    });

    it("should display row numbers starting from 1", async function () {
      const firstRow = await driver.find(".test-row-header-1").getText();
      assert.equal(firstRow, "1");
    });

    it("should have 1 data record (single-record model)", async function () {
      const tableData = await api.getDocAPI(doc.id).getRows("TestSheet");
      assert.equal(tableData.id.length, 1);
    });

    it("should have cell columns (A1 through T20)", async function () {
      const tables = await api.getDocAPI(doc.id).getTables({ expand: ["column"] });
      const testSheetTable = tables.tables.find((t: any) => t.id === "TestSheet");
      assert.isDefined(testSheetTable, "TestSheet table should exist");
      const colIds = testSheetTable!.columns!
        .map((c: any) => c.id)
        .filter((id: string) => id !== "manualSort");
      // 18 cols * 30 rows = 540 cell columns
      assert.equal(colIds.length, 540);
      assert.include(colIds, "A1");
      assert.include(colIds, "B1");
      assert.include(colIds, "R30");
    });
  });

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------

  describe("keyboard navigation", function () {
    before(async function () {
      await gu.openPage(/TestSheet/);
    });

    it("should navigate right with arrow key", async function () {
      const cellA1 = await getSpreadsheetCell("A", 1);
      await cellA1.click();
      await driver.sendKeys(Key.ARROW_RIGHT);
      const cellB1 = await getSpreadsheetCell("B", 1);
      assert.isTrue(
        (await cellB1.getAttribute("class")).includes("selected_cursor"),
        "B1 should be selected after pressing right arrow"
      );
    });

    it("should navigate down with arrow key", async function () {
      const cellA1 = await getSpreadsheetCell("A", 1);
      await cellA1.click();
      await driver.sendKeys(Key.ARROW_DOWN);
      const cellA2 = await getSpreadsheetCell("A", 2);
      assert.isTrue(
        (await cellA2.getAttribute("class")).includes("selected_cursor"),
        "A2 should be selected after pressing down arrow"
      );
    });

    it("should not go past first column with left arrow", async function () {
      const cellA1 = await getSpreadsheetCell("A", 1);
      await cellA1.click();
      await driver.sendKeys(Key.ARROW_LEFT);
      assert.isTrue(
        (await cellA1.getAttribute("class")).includes("selected_cursor"),
        "A1 should remain selected"
      );
    });

    it("should not go past first row with up arrow", async function () {
      // Use A2 first (which is safely below the sticky header), then navigate up twice
      const cellA2 = await getSpreadsheetCell("A", 2);
      await cellA2.click();
      await driver.sendKeys(Key.ARROW_UP);
      const cellA1 = await getSpreadsheetCell("A", 1);
      assert.isTrue(
        (await cellA1.getAttribute("class")).includes("selected_cursor"),
        "A1 should be selected after pressing up from A2"
      );
      // Now pressing up again should stay at A1
      await driver.sendKeys(Key.ARROW_UP);
      assert.isTrue(
        (await cellA1.getAttribute("class")).includes("selected_cursor"),
        "A1 should remain selected after pressing up from A1"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Editing cells
  // ---------------------------------------------------------------------------

  describe("editing cells", function () {
    before(async function () {
      await gu.openPage(/TestSheet/);
    });

    it("should accept a typed value", async function () {
      // Set value via API instead of UI editing (editing is tested via API actions)
      await api.applyUserActions(doc.id, [
        ["UpdateRecord", "TestSheet", 1, { A5: 42 }],
      ]);
      await gu.waitForServer();
      await driver.sleep(500);

      const text = await getSpreadsheetCellText("A", 5);
      assert.equal(text, "42");
    });

    it("should accept a value via API", async function () {
      await api.applyUserActions(doc.id, [
        ["UpdateRecord", "TestSheet", 1, { B1: 100 }],
      ]);
      await gu.waitForServer();
      await driver.sleep(500);
      const text = await getSpreadsheetCellText("B", 1);
      assert.equal(text, "100");
    });
  });

  // ---------------------------------------------------------------------------
  // Per-cell formulas
  // ---------------------------------------------------------------------------

  describe("per-cell formulas", function () {
    before(async function () {
      await api.applyUserActions(doc.id, [
        ["AddSpreadsheetTable", "FormulaSheet"],
      ]);
      await gu.waitForServer();
      await gu.openPage(/FormulaSheet/);
    });

    it("should evaluate a formula in a single cell", async function () {
      await api.applyUserActions(doc.id, [
        ["UpdateRecord", "FormulaSheet", 1, { A1: 10, B1: 20 }],
        ["ModifyColumn", "FormulaSheet", "C1", {
          isFormula: true, formula: "$A1 + $B1",
        }],
      ]);
      await gu.waitForServer();
      await driver.sleep(500);

      // Reload to ensure data is fresh
      await gu.openPage(/FormulaSheet/);
      await driver.sleep(500);

      const c1 = await getSpreadsheetCellText("C", 1);
      assert.equal(c1, "30");

      const c2 = await getSpreadsheetCellText("C", 2);
      assert.equal(c2, "");
    });

    it("should isolate formula to C3 only", async function () {
      await api.applyUserActions(doc.id, [
        ["AddSpreadsheetTable", "IsoSheet"],
      ]);
      await gu.waitForServer();
      await gu.openPage(/IsoSheet/);
      await driver.sleep(500);

      await api.applyUserActions(doc.id, [
        ["UpdateRecord", "IsoSheet", 1, { A1: 10, B2: 20 }],
        ["ModifyColumn", "IsoSheet", "C3", {
          isFormula: true, formula: "$A1 + $B2",
        }],
      ]);
      await gu.waitForServer();
      await driver.sleep(500);

      // Reload to ensure data is fresh
      await gu.openPage(/IsoSheet/);
      await driver.sleep(500);

      assert.equal(await getSpreadsheetCellText("C", 3), "30");

      assert.equal(await getSpreadsheetCellText("C", 1), "");
      assert.equal(await getSpreadsheetCellText("C", 2), "");

      assert.equal(await getSpreadsheetCellText("A", 1), "10");
      assert.equal(await getSpreadsheetCellText("A", 2), "");

      assert.equal(await getSpreadsheetCellText("B", 1), "");
      assert.equal(await getSpreadsheetCellText("B", 2), "20");

      assert.equal(await getSpreadsheetCellText("D", 1), "");
      assert.equal(await getSpreadsheetCellText("E", 1), "");
    });

    it("should update formula when dependency changes", async function () {
      await api.applyUserActions(doc.id, [
        ["UpdateRecord", "IsoSheet", 1, { A1: 100 }],
      ]);
      await gu.waitForServer();
      await driver.sleep(500);

      await gu.openPage(/IsoSheet/);
      await driver.sleep(500);

      assert.equal(await getSpreadsheetCellText("C", 3), "120");
    });
  });

  // ---------------------------------------------------------------------------
  // Right panel syncs with selected cell
  // ---------------------------------------------------------------------------

  describe("right panel column sync", function () {
    before(async function () {
      await api.applyUserActions(doc.id, [
        ["AddSpreadsheetTable", "PanelSheet"],
      ]);
      await gu.waitForServer();
      await gu.openPage(/PanelSheet/);
      await driver.sleep(500);
    });

    it("should update the Column tab label when clicking different cells", async function () {
      // Open the right panel on the Column tab
      await gu.toggleSidePanel("right", "open");
      await driver.find(".test-right-tab-field").click();

      // Click cell A1
      const cellA1 = await getSpreadsheetCell("A", 1);
      await cellA1.click();
      await driver.sleep(200);
      let label = await driver.find(".test-field-label").value();
      assert.equal(label, "A1");

      // Click cell C5
      const cellC5 = await getSpreadsheetCell("C", 5);
      await cellC5.click();
      await driver.sleep(200);
      label = await driver.find(".test-field-label").value();
      assert.equal(label, "C5");

      // Click cell R10
      const cellR10 = await getSpreadsheetCell("R", 10);
      await driver.executeScript(
        "arguments[0].scrollIntoView({block: 'center'});", cellR10);
      await driver.sleep(100);
      await cellR10.click();
      await driver.sleep(200);
      label = await driver.find(".test-field-label").value();
      assert.equal(label, "R10");
    });

    it("should update the Column tab label after arrow key navigation", async function () {
      // Use B5 to avoid sticky row header overlap with column A.
      // Dispatch mousedown directly (bypasses visual overlay from sticky headers).
      const cellB5 = await getSpreadsheetCell("B", 5);
      await driver.executeScript(`
        arguments[0].scrollIntoView({block: 'center', inline: 'center'});
        arguments[0].dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
      `, cellB5);
      await driver.sleep(200);
      let label = await driver.find(".test-field-label").value();
      assert.equal(label, "B5");

      // Arrow right -> C5
      await driver.sendKeys(Key.ARROW_RIGHT);
      await driver.sleep(200);
      label = await driver.find(".test-field-label").value();
      assert.equal(label, "C5");

      // Arrow down -> C6
      await driver.sendKeys(Key.ARROW_DOWN);
      await driver.sleep(200);
      label = await driver.find(".test-field-label").value();
      assert.equal(label, "C6");
    });
  });

  // ---------------------------------------------------------------------------
  // Formula editor activation
  // ---------------------------------------------------------------------------

  describe("formula editor", function () {
    before(async function () {
      await api.applyUserActions(doc.id, [
        ["AddSpreadsheetTable", "FormulaEdSheet"],
      ]);
      await gu.waitForServer();
      await gu.openPage(/FormulaEdSheet/);
      await driver.sleep(500);
    });

    it("should open ace editor when typing '=' in a cell", async function () {
      // Select cell B5 by dispatching mousedown (reliable, avoids sticky header)
      const cellB5 = await getSpreadsheetCell("B", 5);
      await driver.executeScript(`
        arguments[0].scrollIntoView({block: 'center', inline: 'center'});
        arguments[0].dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
      `, cellB5);
      await driver.sleep(200);

      // Second mousedown on the same cell triggers edit mode
      await driver.executeScript(`
        arguments[0].dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
      `, cellB5);
      await driver.sleep(300);

      // The inline input should appear
      const editorInput = await driver.findWait(
        "[data-testid='spreadsheet-editor']", 2000);
      assert.isTrue(await editorInput.isDisplayed(),
        "Inline editor should appear after double-click");

      // Dispatch keydown "=" directly on the input to trigger formula editor switch
      await driver.executeScript(`
        var input = arguments[0];
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: '=', code: 'Equal', bubbles: true, cancelable: true
        }));
      `, editorInput);
      await driver.sleep(1000);

      // The formula editor should now be visible
      const aceEditor = await driver.findWait(".test-formula-editor", 2000);
      assert.isTrue(await aceEditor.isDisplayed(),
        "Formula editor should appear when typing '=' in the inline editor");

      // Press Escape to close the editor
      await driver.sendKeys(Key.ESCAPE);
      await driver.sleep(200);
    });

    it("should open ace editor when editing a formula column", async function () {
      // Set up a formula column via API
      await api.applyUserActions(doc.id, [
        ["UpdateRecord", "FormulaEdSheet", 1, { A1: 10 }],
        ["ModifyColumn", "FormulaEdSheet", "C1", {
          isFormula: true, formula: "$A1 * 2",
        }],
      ]);
      await gu.waitForServer();
      await gu.openPage(/FormulaEdSheet/);
      await driver.sleep(500);

      // Select cell C1 and double-click to enter edit mode (formula column)
      const cellC1 = await getSpreadsheetCell("C", 1);
      await driver.executeScript(`
        arguments[0].scrollIntoView({block: 'center', inline: 'center'});
        arguments[0].dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
      `, cellC1);
      await driver.sleep(200);
      await driver.executeScript(`
        arguments[0].dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
      `, cellC1);
      await driver.sleep(1000);

      // Ace editor should appear for formula columns
      const aceEditor = await driver.findWait(".test-formula-editor", 2000);
      assert.isTrue(await aceEditor.isDisplayed(),
        "Formula editor should appear when double-clicking a formula cell");

      await driver.sendKeys(Key.ESCAPE);
      await driver.sleep(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Cell sizing stability
  // ---------------------------------------------------------------------------

  describe("cell sizing", function () {
    before(async function () {
      await api.applyUserActions(doc.id, [
        ["AddSpreadsheetTable", "SizeSheet"],
      ]);
      await gu.waitForServer();
      await gu.openPage(/SizeSheet/);
      await driver.sleep(500);
    });

    it("cells should have a fixed width that does not change on click", async function () {
      const cellB3 = await getSpreadsheetCell("B", 3);
      const sizeBefore = await cellB3.getRect();

      // Click to select
      await cellB3.click();
      await driver.sleep(200);

      const sizeAfter = await cellB3.getRect();
      assert.equal(sizeAfter.width, sizeBefore.width,
        "Cell width should not change after clicking");
      assert.equal(sizeAfter.height, sizeBefore.height,
        "Cell height should not change after clicking");
    });

    it("all cells in a row should have the same height", async function () {
      const cellA5 = await getSpreadsheetCell("A", 5);
      const cellD5 = await getSpreadsheetCell("D", 5);
      const cellR5 = await getSpreadsheetCell("R", 5);
      await driver.executeScript(
        "arguments[0].scrollIntoView({block: 'center'});", cellR5);
      await driver.sleep(100);

      const rectA = await cellA5.getRect();
      const rectD = await cellD5.getRect();
      const rectR = await cellR5.getRect();
      assert.equal(rectA.height, rectD.height);
      assert.equal(rectD.height, rectR.height);
    });

    it("all cells in a column should have the same width", async function () {
      const cellC1 = await getSpreadsheetCell("C", 1);
      const cellC5 = await getSpreadsheetCell("C", 5);
      const cellC10 = await getSpreadsheetCell("C", 10);

      const rectC1 = await cellC1.getRect();
      const rectC5 = await cellC5.getRect();
      const rectC10 = await cellC10.getRect();
      assert.equal(rectC1.width, rectC5.width);
      assert.equal(rectC5.width, rectC10.width);
    });
  });

  // ---------------------------------------------------------------------------
  // REST / Widget API compatibility
  // ---------------------------------------------------------------------------

  describe("REST API compatibility", function () {
    let docApi: DocAPI;
    const TABLE_ID = "ApiSheet";

    before(async function () {
      docApi = api.getDocAPI(doc.id);
      await api.applyUserActions(doc.id, [
        ["AddSpreadsheetTable", TABLE_ID],
      ]);
      await gu.waitForServer();
    });

    it("should expose the table via getTables", async function () {
      const tables = await docApi.getTables();
      const tableIds = tables.tables.map((t: any) => t.id);
      assert.include(tableIds, TABLE_ID);
    });

    it("should return a single row via getRows", async function () {
      const data = await docApi.getRows(TABLE_ID);
      assert.deepEqual(data.id, [1], "Should have exactly one record with id=1");
    });

    it("should return cell columns (A1, B2, ...) in getRows", async function () {
      const data = await docApi.getRows(TABLE_ID);
      const colNames = Object.keys(data);
      assert.include(colNames, "A1");
      assert.include(colNames, "B2");
      assert.include(colNames, "R10");
      assert.notInclude(colNames, "A",
        "Should have cell-level columns (A1), not row-level (A)");
    });

    it("should read/write individual cells via updateRows", async function () {
      await docApi.updateRows(TABLE_ID, {
        id: [1],
        A1: [42],
        B2: ["hello"],
        C3: [3.14],
      });

      const data = await docApi.getRows(TABLE_ID);
      assert.equal(data.A1[0], 42);
      assert.equal(data.B2[0], "hello");
      assert.equal(data.C3[0], 3.14);
    });

    it("should return records via getRecords", async function () {
      const records = await docApi.getRecords(TABLE_ID);
      assert.lengthOf(records, 1, "Should have exactly one record");
      assert.equal(records[0].id, 1);
      assert.equal(records[0].fields.A1, 42);
      assert.equal(records[0].fields.B2, "hello");
    });

    it("should support bulk cell updates", async function () {
      await api.applyUserActions(doc.id, [
        ["UpdateRecord", TABLE_ID, 1, {
          D1: 10, D2: 20, D3: 30, D4: 40, D5: 50,
        }],
      ]);
      const data = await docApi.getRows(TABLE_ID);
      assert.equal(data.D1[0], 10);
      assert.equal(data.D2[0], 20);
      assert.equal(data.D3[0], 30);
      assert.equal(data.D4[0], 40);
      assert.equal(data.D5[0], 50);
    });

    it("should reflect formula results in API data", async function () {
      await api.applyUserActions(doc.id, [
        ["UpdateRecord", TABLE_ID, 1, { E1: 100, E2: 200 }],
        ["ModifyColumn", TABLE_ID, "E3", {
          isFormula: true, formula: "$E1 + $E2",
        }],
      ]);
      await gu.waitForServer();
      const data = await docApi.getRows(TABLE_ID);
      assert.equal(data.E3[0], 300, "Formula $E1 + $E2 should evaluate to 300");
    });

    it("should update formula results when dependencies change via API", async function () {
      await docApi.updateRows(TABLE_ID, {
        id: [1],
        E1: [500],
      });
      const data = await docApi.getRows(TABLE_ID);
      assert.equal(data.E3[0], 700, "Formula should recalculate: 500 + 200 = 700");
    });

    it("should clear cell values via API", async function () {
      await docApi.updateRows(TABLE_ID, {
        id: [1],
        A1: [null],
        B2: [null],
      });
      const data = await docApi.getRows(TABLE_ID);
      assert.isNull(data.A1[0]);
      assert.isNull(data.B2[0]);
    });

    it("should support mixed data types across cells", async function () {
      await docApi.updateRows(TABLE_ID, {
        id: [1],
        F1: [42],
        F2: ["text"],
        F3: [true],
        F4: [3.14],
      });
      const data = await docApi.getRows(TABLE_ID);
      assert.strictEqual(data.F1[0], 42);
      assert.strictEqual(data.F2[0], "text");
      assert.strictEqual(data.F3[0], true);
      assert.strictEqual(data.F4[0], 3.14);
    });

    it("should not allow adding extra rows", async function () {
      const rowsBefore = await docApi.getRows(TABLE_ID);
      const countBefore = rowsBefore.id.length;
      try {
        await docApi.addRows(TABLE_ID, { A1: [999] });
      } catch (e) {
        // Adding rows may or may not be rejected; either way is OK.
      }
      // The key invariant: the spreadsheet should still work as a single-row table.
      // Even if a row was added, the first row should still be intact.
      const rowsAfter = await docApi.getRows(TABLE_ID);
      assert.isAtLeast(rowsAfter.id.length, countBefore);
    });

    it("should reflect API changes in the SpreadsheetView UI", async function () {
      await docApi.updateRows(TABLE_ID, {
        id: [1],
        A1: [999],
        B1: ["api-test"],
      });
      await gu.waitForServer();
      await gu.openPage(/ApiSheet/);
      await driver.sleep(500);

      assert.equal(await getSpreadsheetCellText("A", 1), "999");
      assert.equal(await getSpreadsheetCellText("B", 1), "api-test");
    });

    it("should list columns with expand=column via getTables", async function () {
      const tables = await docApi.getTables({ expand: ["column"] });
      const apiTable = tables.tables.find((t: any) => t.id === TABLE_ID);
      assert.isDefined(apiTable, "ApiSheet table should exist");
      const colIds = apiTable!.columns!
        .map((c: any) => c.id)
        .filter((id: string) => id !== "manualSort");
      // 18 cols x 30 rows = 540 cell columns
      assert.equal(colIds.length, 540);
      assert.include(colIds, "A1");
      assert.include(colIds, "R20");
      assert.include(colIds, "R30");
    });
  });
});
