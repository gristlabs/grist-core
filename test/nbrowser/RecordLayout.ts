import { assert, driver, Key, until, WebElement } from "mocha-webdriver";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";

describe("RecordLayout", function() {
  this.timeout(30000);
  const cleanup = setupTestSuite();

  afterEach(() => gu.checkForErrors());

  it("should disallow hiding columns from the creator panel", async () => {
    const session = await gu.session().login();
    await session.tempNewDoc(cleanup);
    // Open creator panel.
    await gu.toggleSidePanel("right", "open");
    // Change the widget to Card view.
    await driver.findContent("button", "Change widget").click();
    await gu.selectWidget("Card");
    // Edit card layout.
    await driver.find(".test-vconfigtab-detail-edit-layout").click();
    assert.equal(await hasField("A"), true);
    assert.equal(await hasField("B"), true);
    assert.equal(await hasField("C"), true);
    // Checking hiding columns from the creator panel is disabled.
    const row = await driver.findContent(".test-vfc-visible-fields .kf_draggable_content", "A");
    await row.mouseMove();
    assert.isNotNull(await row.find(".test-vfc-hide").getAttribute("disabled"));
  });

  it("should allow deleting cells", async function() {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");
    await gu.importFixturesDoc("chimpy", "nasa", "Horizon", "World.grist", "newui");

    // Select the right section and check that we have Cards with expected fields.
    await gu.getDetailCell({ col: "District", rowNum: 1, section: "CITY Card List" }).click();
    assert.equal(await hasField("District"), true);
    assert.equal(await hasField("Population"), true);
    assert.equal(await hasField("Country"), true);

    // Open ViewConfigTab, and click to edit layout.
    await gu.toggleSidePanel("right", "open");
    await driver.find(".test-right-tab-pagewidget").click();
    await driver.find(".test-config-widget").click();

    await driver.sleep(100);
    const thirdRow = () => driver.find(".active_section .g_record_detail:nth-child(2)");
    const thirdRowLocOriginal = await thirdRow().rect();

    // Start editing layout.
    let editLayoutMenu = await editLayoutAndGetMenu();

    // Find and delete 'District' field.
    await deleteBox(gu.getDetailCell({ col: "District", rowNum: 1 }));

    // Check that 'District' field is now present in Add Field dropdown.
    await driver.sleep(100); // Sleep needed to avoid test flakiness.
    const addFieldBtn = await editLayoutMenu.findContent("button", "Add field");
    await addFieldBtn.click();
    await driver.findWait(".test-edit-layout-add-menu", 500);
    assert.equal(await driver.findContent(".test-edit-layout-add-menu li", /District/).isDisplayed(), true);
    assert.equal(await driver.findContent(".test-edit-layout-add-menu li", /Population/).isPresent(), false);
    await addFieldBtn.click();

    // Find and delete 'Population' field.
    await deleteBox(gu.getDetailCell({ col: "Population", rowNum: 1 }));
    await driver.sleep(100); // Sleep needed to avoid test flakiness.

    // Check that 'Population' field is now present in Add Field dropdown.
    await addFieldBtn.click();
    await driver.findWait(".test-edit-layout-add-menu", 500);
    assert.equal(await driver.findContent(".test-edit-layout-add-menu li", /District/).isDisplayed(), true);
    assert.equal(await driver.findContent(".test-edit-layout-add-menu li", /Population/).isDisplayed(), true);
    await addFieldBtn.click();

    // Cancel and make sure deleted fields are still there, and row positions correct.
    await editLayoutMenu.findContent("button", /Cancel/).click();
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleDetailCells("District", [1, 2, 3]),
      ["Maharashtra", "Seoul", "São Paulo"]);
    assert.deepEqual(await gu.getVisibleDetailCells("Population", [1, 2, 3]),
      ["10500000", "9981619", "9968485"]);
    assert.equal((await thirdRow().rect()).top, thirdRowLocOriginal.top);

    // Do the whole thing again, and save.
    editLayoutMenu = await editLayoutAndGetMenu();

    await deleteBox(gu.getDetailCell({ col: "District", rowNum: 1 }));
    await driver.sleep(100); // Sleep needed to avoid test flakiness.

    await deleteBox(gu.getDetailCell({ col: "Population", rowNum: 1 }));
    await driver.sleep(100); // Sleep needed to avoid test flakiness.

    await editLayoutMenu.findContent("button", /Save/).click();
    await gu.waitForServer(5000);

    // Wait for re-rendered records to appear.
    await driver.wait(async () => (await driver.findAll(".active_section .g_record_detail")).length > 3);

    // Make sure the deleted fields are gone, and row positions got adjusted.
    assert.equal(await hasField("District"), false);
    assert.equal(await hasField("Population"), false);
    assert.equal(await hasField("Country"), true);
    assert.isBelow((await thirdRow().rect()).top, thirdRowLocOriginal.top);
  });

  it("should allow inserting fields", async function() {
    // We assume we are where the previous test case left off: CITY Card List, 2 fields removed.
    const thirdRow = () => driver.find(".active_section .g_record_detail:nth-child(2)");
    const thirdRowLocOriginal = await thirdRow().rect();

    // Start editing layout.
    const editLayoutMenu = await editLayoutAndGetMenu();

    // Remove "Pop. '000" field.
    await deleteBox(await gu.getDetailCell("Pop. '000", 1));

    // Re-add "Pop. '000" field to the bottom.
    await editLayoutMenu.findContent("button", "Add field").click();
    await driver.findContentWait(".test-edit-layout-add-menu li", /Pop. '000/, 500).click();
    await driver.wait(() => gu.getDetailCell("Pop. '000", 1).isPresent(), 2000);

    // Add 'District' field, and drag to be a new column on the left. This changes the layout
    // root, which is an important case to test (there used to be a bug in this case).
    await editLayoutMenu.findContent("button", "Add field").click();
    await driver.findContentWait(".test-edit-layout-add-menu li", /District/, 500).click();
    await driver.wait(() => gu.getDetailCell("District", 1).isPresent(), 2000);
    assert.deepEqual(await getFields(), ["Name", "Country", "Pop. '000", "District"]);
    await dragInsertLayoutBox(gu.getDetailCell("District", 1), gu.getDetailCell("Name", 1), "left", 2);
    await driver.wait(() => gu.getDetailCell("District", 1).isPresent(), 2000);
    assert.deepEqual(await getFields(), ["District", "Name", "Country", "Pop. '000"]);

    // Add a new field below the District field.
    await editLayoutMenu.findContent("button", "Add field").click();
    await driver.findContentWait(".test-edit-layout-add-menu li", /Create new field/, 500).click();
    await driver.wait(() => gu.getDetailCell("New_Field", 1).isPresent(), 2000);
    assert.deepEqual(await getFields(), ["District", "Name", "Country", "Pop. '000", "New_Field"]);
    await dragInsertLayoutBox(gu.getDetailCell("New_Field", 1), gu.getDetailCell("District", 1), "bottom", -18);
    await driver.wait(() => gu.getDetailCell("New_Field", 1).isPresent(), 2000);
    assert.deepEqual(await getFields(), ["District", "New_Field", "Name", "Country", "Pop. '000"]);

    // Delete the newly-added District field.
    await deleteBox(gu.getDetailCell("District", 1));

    // Save the edited layout.
    await editLayoutMenu.findContent("button", /Save/).click();
    await gu.waitForServer(5000);

    await driver.sleep(2000);

    // Wait for re-rendered records to appear.
    await driver.wait(async () => (await driver.findAll(".active_section .g_record_detail")).length > 3);

    // Check that "Pop. '000" is included, "District" is still not included, and a new column "A"
    // is present.
    assert.equal(await hasField("District"), false);
    assert.equal(await hasField("Population"), false);
    assert.equal(await hasField("Pop. '000"), true);
    assert.equal(await hasField("A"), true);

    // Check that "Pop. '000" got re-added the way it was (with 0 decimal places, i.e. no changes
    // to widget options).
    assert.deepEqual(await gu.getVisibleDetailCells("Pop. '000", [1, 2, 3]), ["10500", "9982", "9968"]);

    // Check that the new column is included. The values are blank, but if the column were
    // missing, we'd get NoSuchElementErrors.
    assert.deepEqual(await gu.getVisibleDetailCells("A", [1, 2, 3]), ["", "", ""]);

    // Check that rows have gotten resized.
    assert.isAbove((await thirdRow().rect()).top, thirdRowLocOriginal.top);
  });

  it("should allow changes to be undone in one step", async function() {
    // Undo and check that everything is as before editing.
    const thirdRow = () => driver.find(".active_section .g_record_detail:nth-child(2)");
    const thirdRowLocOriginal = await thirdRow().rect();
    await gu.undo();
    await driver.wait(async () => !await hasField("A"));

    assert.equal(await hasField("District"), false);
    assert.equal(await hasField("Population"), false);
    assert.equal(await hasField("Pop. '000"), true);
    assert.equal(await hasField("A"), false);

    assert.isBelow((await thirdRow().rect()).top, thirdRowLocOriginal.top);

    // Redo and check that everything is as after editing.
    await gu.redo(1, 4000);
    await driver.wait(() => hasField("A"));

    assert.equal(await hasField("District"), false);
    assert.equal(await hasField("Population"), false);
    assert.equal(await hasField("Pop. '000"), true);
    assert.equal(await hasField("A"), true);
    assert.deepEqual(await gu.getVisibleDetailCells("Pop. '000", [1, 2, 3]), ["10500", "9982", "9968"]);
    assert.deepEqual(await gu.getVisibleDetailCells("A", [1, 2, 3]), ["", "", ""]);
    assert.equal((await thirdRow().rect()).top, thirdRowLocOriginal.top);
  });

  it("should allow inserting multiple fields", async function() {
    // Start editing layout.
    const editLayoutMenu = await editLayoutAndGetMenu();

    // Add a new field below the District field.
    await editLayoutMenu.findContent("button", "Add field").click();
    await driver.findContentWait(".test-edit-layout-add-menu li", /Create new field/, 500).click();
    await editLayoutMenu.findContent("button", "Add field").click();
    await driver.findContentWait(".test-edit-layout-add-menu li", /Create new field/, 500).click();
    await driver.wait(() => gu.getDetailCell("New_Field", 1).isPresent(), 2000);
    assert.deepEqual(await getFields(), ["A", "Name", "Country", "Pop. '000", "New_Field", "New_Field"]);

    // Save the edited layout.
    await editLayoutMenu.findContent("button", /Save/).click();
    await gu.waitForServer(5000);

    // Wait for re-rendered records to appear.
    await driver.wait(async () => (await driver.findAll(".active_section .g_record_detail")).length > 3);

    // Check that 2 new columns (B and C) are present (A already existed from an earlier test case)
    assert.equal(await hasField("A"), true);
    assert.equal(await hasField("B"), true);
    assert.equal(await hasField("C"), true);

    // Undo the additions, and check that the undo worked.
    await gu.undo();
    await driver.wait(async () => !await hasField("B"));
    assert.equal(await hasField("A"), true);
    assert.equal(await hasField("B"), false);
    assert.equal(await hasField("C"), false);
  });

  it("should allow rearranging fields", async function() {
    const editLayoutMenu = await editLayoutAndGetMenu();

    // Drag new a field to the left of the "Pop. '000" field, into the same row.
    await dragInsertLayoutBox(gu.getDetailCell("A", 1), await gu.getDetailCell("Pop. '000", 1), "left", 18);
    await editLayoutMenu.findContent("button", /Save/).click();
    await gu.waitForServer(5000);

    // Wait for re-rendered records to appear.
    await driver.wait(async () => (await driver.findAll(".active_section .g_record_detail")).length > 3);

    function hasCursor(cell: WebElement) { return cell.find(".selected_cursor").isDisplayed(); }

    // Ensure that the tab order in a different cell reflects the new order of fields.
    await gu.getDetailCell("Name", 2).click();
    assert.equal(await hasCursor(gu.getDetailCell("Name", 2)), true);
    await driver.sendKeys(Key.RIGHT);
    assert.equal(await hasCursor(gu.getDetailCell("Country", 2)), true);
    await driver.sendKeys(Key.RIGHT);
    assert.equal(await hasCursor(gu.getDetailCell("A", 2)), true);
    await driver.sendKeys(Key.RIGHT);
    assert.equal(await hasCursor(gu.getDetailCell("Pop. '000", 2)), true);
  });

  it("editing layout should not mess with fields cursor", async function() {
    // Select Mumbai in the Card List view
    await gu.getDetailCell("Name", 1, "CITY Card List").click();

    // start editing layout and cancel
    const editLayoutMenu = await editLayoutAndGetMenu();
    await editLayoutMenu.findContent("button", "Cancel").click();

    // check Mumbai is still selected
    assert.equal(await gu.getActiveCell().getText(), "Mumbai (Bombay)");

    // open editor for Mumbai name
    await driver.sendKeys(Key.ENTER);
    try {
      // check that the editor position is correct
      const editorRect = await driver.find(".cell_editor").getRect();
      const cellRect = await gu.getActiveCell().getRect();
      assert.equal(editorRect.x, cellRect.x);
      assert.equal(editorRect.y, cellRect.y);
      assert.equal(editorRect.height, cellRect.height);
      assert.isAtLeast(editorRect.width, cellRect.width);
    }
    finally {
      // on error make sure editor is closed
      await driver.sendKeys(Key.ESCAPE);
    }
  });

  // Helper to delete a layout box using the on-hover "x" circle.
  async function deleteBox(cell: WebElement) {
    await cell.mouseMove();
    const containingBox = await cell.findClosest(".layout_box");
    const deleteIcon = cell.findClosest(".g_record_layout_leaf").find(".g_record_delete_field");
    await driver.wait(() => deleteIcon.isDisplayed(), 1000);
    await deleteIcon.click();
    await driver.wait(until.stalenessOf(containingBox), 2000);
  }

  // Helper that drags `elem` to the layout box containing `destElem`, specifically to its `edge`
  // ("top", "right", "bottom" or "left") plus the `edgeOffset` (in pixels).
  async function dragInsertLayoutBox(
    elem: WebElement, destElem: WebElement, edge: "top" | "right" | "bottom" | "left", edgeOffset: number,
  ) {
    const box = await destElem.findClosest(".layout_box");
    await driver.wait(async () => await elem.isDisplayed() && await box.isDisplayed(), 1000);
    const size = await box.rect();
    const boxX = (edge === "left" ? edgeOffset : (edge === "right" ? size.width + edgeOffset : size.width / 2));
    const boxY = (edge === "top" ? edgeOffset : (edge === "bottom" ? size.height + edgeOffset : size.height / 2));
    // To move the mouse to boxX, boxY in box coordinates, we actually move it relative to body,
    // using coordinates relative to body center. This is a workaround for a bug with webdriver
    // (at least in some environments): it fiddles with coordinates, which then get ignored if
    // they end up fractional. This problem happens less if we use rounding relative to body.
    const body = await driver.find("body");
    const bodyRect = await body.rect();
    const bodyCenterX = bodyRect.left + bodyRect.width / 2;
    const bodyCenterY = bodyRect.top + bodyRect.height / 2;
    const offset = {
      x: Math.round(size.left + boxX - bodyCenterX),
      y: Math.round(size.top + boxY - bodyCenterY),
    };
    await elem.mouseMove();
    await driver.mouseDown();
    await body.mouseMove(offset);
    await driver.mouseUp();
    await driver.sleep(1000);
    await driver.wait(async () =>
      (await destElem.findClosest(".layout_root").getAttribute("data-useredit")) === "stop", 5000);
  }

  async function editLayoutAndGetMenu() {
    // Assuming an expanded side-pane, start editing the layout, wait for the layout editor, and
    // return the menu containing layout editor controls.
    await driver.find(".test-vconfigtab-detail-edit-layout").click();
    return driver.findWait(".active_section .test-edit-layout-controls", 1000);
  }

  // Whether any Card in the active section has a field by the given name.
  function hasField(field: string) {
    return driver.findContent(".active_section .g_record_detail_inner .g_record_detail_label",
      gu.exactMatch(field)).isPresent();
  }

  // List of field labels for the first record in active section (while editing, it's the record
  // being edited).
  function getFields() {
    return driver.find(".active_section .g_record_detail").findAll(".g_record_detail_label", el => el.getText());
  }
});
