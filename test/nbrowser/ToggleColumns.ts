import * as gu from "test/nbrowser/gristUtils";
import { Session } from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("ToggleColumns", function() {
  this.timeout(20000);

  const cleanup = setupTestSuite({ team: true });

  let session: Session;
  let docId: string;

  before(async function() {
    session = await gu.session().teamSite.login();
    docId = await session.tempNewDoc(cleanup, "ToggleColumns", { load: false });

    // Set up a table Src, and table Items which links to Src and has a boolean column.
    const api = session.createHomeApi();
    await api.applyUserActions(docId, [
      ["AddTable", "Src", [{ id: "A", type: "Text" }]],
      ["BulkAddRecord", "Src", [null, null, null], { A: ["a", "b", "c"] }],
      ["AddTable", "Items", [
        { id: "A", type: "Ref:Src" },
        { id: "Chk", type: "Bool" },
        // An extra text column reflects the boolean for simpler checking of the values.
        { id: "Chk2", isFormula: true, formula: "$Chk" },
      ]],
      ["BulkAddRecord", "Items", [null, null, null], { A: [1, 1, 3] }],
    ]);

    await session.loadDoc(`/doc/${docId}`);

    // Set up a page with linked widgets.
    await gu.addNewPage("Table", "Src");
    await gu.addNewSection("Table", "Items", { selectBy: /Src/i });
  });

  it("should show a visible style for unchecked checkboxes", async function() {
    await gu.getCell({ section: "Src", col: "A", rowNum: 1 }).click();
    const cell = gu.getCell({ section: "Items", col: "Chk", rowNum: 1 });
    const checkbox = cell.find(".widget_checkbox");
    assert.equal(await gu.isChecked(cell), false);
    assert.equal(await checkbox.matches(".widget_checkbox-unchecked"), true);
    assert.equal(await checkbox.getCssValue("border-top-width"), "1px");
    const uncheckedRect = await checkbox.getRect();

    // Checking the box removes the unchecked style, without changing the checkbox size.
    await cell.click();
    await gu.waitForServer();
    assert.equal(await gu.isChecked(cell), true);
    assert.equal(await checkbox.matches(".widget_checkbox-unchecked"), false);
    assert.equal(await checkbox.getCssValue("border-top-width"), "0px");
    const checkedRect = await checkbox.getRect();
    assert.deepEqual([checkedRect.width, checkedRect.height], [uncheckedRect.width, uncheckedRect.height]);

    // Unchecking it again restores the style. The border is hidden while the cell has the cursor,
    // which already outlines the checkbox.
    await gu.undo();
    assert.equal(await gu.isChecked(cell), false);
    assert.equal(await checkbox.matches(".widget_checkbox-unchecked"), true);
    assert.equal(await checkbox.getCssValue("border-top-width"), "0px");

    // The border comes back once the cursor moves away.
    await gu.getCell({ section: "Src", col: "A", rowNum: 1 }).click();
    assert.equal(await checkbox.getCssValue("border-top-width"), "1px");
  });

  it("should use theme colors for unchecked checkboxes", async function() {
    const getBorderColor = () => gu.getCell({ section: "Items", col: "Chk", rowNum: 1 })
      .find(".widget_checkbox").getCssValue("border-top-color");

    await gu.getCell({ section: "Src", col: "A", rowNum: 1 }).click();
    assert.equal(await getBorderColor(), "rgba(146, 146, 153, 1)");

    await gu.setGristTheme({ themeName: "GristDark", syncWithOS: false });
    await driver.navigate().back();
    await gu.waitForDocToLoad();
    await gu.getCell({ section: "Src", col: "A", rowNum: 1 }).click();
    assert.equal(await getBorderColor(), "rgba(164, 164, 177, 1)");

    // Restore the default preferences (light theme, synced with OS) for other suites.
    await gu.setGristTheme({ themeName: "GristLight", syncWithOS: false });
    await gu.setGristTheme({ themeName: "GristLight", syncWithOS: true, skipOpenSettingsPage: true });
    await driver.navigate().back();
    await gu.waitForDocToLoad();
    await gu.getCell({ section: "Src", col: "A", rowNum: 1 }).click();
    assert.equal(await getBorderColor(), "rgba(146, 146, 153, 1)");
  });

  it("should fill in values determined by linking when checkbox is clicked", async function() {
    // Test the behavior with a checkbox.
    await verifyToggleBehavior();
  });

  it("should fill in values determined by linking when switch widget is clicked", async function() {
    // Now switch the widget to the "Switch" widget, and test again.
    await gu.toggleSidePanel("right", "open");
    await driver.find(".test-right-tab-field").click();
    await gu.setFieldWidgetType("Switch");
    await verifyToggleBehavior();
  });

  async function verifyToggleBehavior() {
    // Selecting a cell in Src should show only linked values in Items.
    await gu.getCell({ section: "Src", col: "A", rowNum: 1 }).click();
    await gu.waitForViewLoads();
    assert.deepEqual(await gu.getVisibleGridCells({ section: "Items", cols: ["A", "Chk2"], rowNums: [1, 2, 3] }), [
      "Src[1]", "false",
      "Src[1]", "false",
      "", "",
    ]);
    // Click on the cell in the "Add Row" of Items. Because the checkbox is centered in the cell,
    // the click should toggle it.
    await gu.getCell({ section: "Items", col: "Chk", rowNum: 3 }).click();
    await gu.waitForServer();

    // Check that there is a new row, properly linked.
    assert.deepEqual(await gu.getVisibleGridCells({ section: "Items", cols: ["A", "Chk2"], rowNums: [1, 2, 3, 4] }), [
      "Src[1]", "false",
      "Src[1]", "false",
      "Src[1]", "true",
      "", "",
    ]);

    // Try another row of table Src. It should have its own Items (initially none).
    await gu.getCell({ section: "Src", col: "A", rowNum: 2 }).click();
    await gu.waitForViewLoads();
    assert.deepEqual(await gu.getVisibleGridCells({ section: "Items", cols: ["A", "Chk2"], rowNums: [1] }),
      ["", ""]);

    // Click checkbox in "Add Row" of Items again.
    await gu.getCell({ section: "Items", col: "Chk", rowNum: 1 }).click();
    await gu.waitForServer();

    // Check that we see the new row, with the value determined by linking (column 'A') set correctly.
    assert.deepEqual(await gu.getVisibleGridCells({ section: "Items", cols: ["A", "Chk2"], rowNums: [1, 2] }), [
      "Src[2]", "true",
      "", "",
    ]);

    await gu.undo(2);
  }
});
