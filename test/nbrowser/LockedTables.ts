/**
 * Pins the client's handling of the per-table `_grist_Tables.locked` flag: affordances that would
 * write to the table go away, while view-layer ones (hide column, sort, filter, comment) stay. The
 * flag is flipped behind the browser's back, so these also pin that the UI reacts to it live,
 * without a page reload.
 */
import { UserAPI } from "app/common/UserAPI";
import { ITestingHooks } from "app/server/lib/ITestingHooks";
// Aliased: the local itemStates() helper already takes a `labels` argument.
import { labels as questionLabels, question } from "test/nbrowser/formTools";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key, WebElement } from "mocha-webdriver";

describe("LockedTables", function() {
  this.timeout(40000);
  const cleanup = setupTestSuite();
  let api: UserAPI;
  let docId: string;
  let filmsRef: number;
  let testingHooks: ITestingHooks;

  before(async function() {
    const session = await gu.session().login();
    docId = (await session.tempDoc(cleanup, "Favorite_Films.grist")).id;
    api = session.createHomeApi();
    filmsRef = await tableRef("Films");
    testingHooks = await server.getTestingHooks();
    await gu.openPage("Films");
    // Give the grid the focus, so cursor-dependent helpers and menus act on it.
    await gu.getCell({ rowNum: 1, col: "Title" }).click();
    await gu.waitAppFocus();
  });

  afterEach(() => gu.checkForErrors());

  // The engine only lets the system change the flag, so this goes through a testing hook rather
  // than the API, which would be refused.
  async function setLocked(locked: boolean, ref = filmsRef) {
    await testingHooks.applySystemUserActions(docId,
      [["UpdateRecord", "_grist_Tables", ref, { locked }]]);
  }

  /** The flag is keyed on the table's row id, which only the metadata exposes. */
  async function tableRef(tableId: string) {
    const tables = await api.getTable(docId, "_grist_Tables");
    return tables.id[(tables.tableId as string[]).indexOf(tableId)];
  }

  const tableIds = async () =>
    (await api.getTable(docId, "_grist_Tables")).tableId as string[];

  /**
   * The grid's trailing "add row" and the header's "+" cell are the only affordances for adding
   * records and columns.
   */
  async function waitForAddAffordances(present: boolean) {
    await gu.waitToPass(async () => {
      assert.equal(await driver.find(".active_section .record-add").isPresent(), present, "add row");
      assert.equal(await driver.find(".active_section .mod-add-column").isPresent(), present, "add column");
    }, 3000);
  }

  function getListItemDisabledStates(menu: WebElement, labels: RegExp[]) {
    return Promise.all(labels.map(label => menu.findContent("li", label).matches('[aria-disabled="true"]')));
  }

  /** Escape closes the menu, but not instantly; the next click needs it gone. */
  async function closeMenu() {
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForMenuToClose(2000);
  }

  /**
   * Opens the reference editor of a cell in row 1 on text that matches no record, and reports
   * whether the autocomplete offers to add that record.
   */
  async function offersAddNew(col: string) {
    const unmatched = "No Such Film";
    await gu.getCell({ rowNum: 1, col }).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.ENTER);
    await gu.waitForCellEditor();
    await gu.sendKeys(await gu.selectAllKey(), unmatched);
    await gu.autocomplete.wait(unmatched);
    const offered = await driver.find(".test-autocomplete .test-ref-editor-new-item").isPresent();
    // Escape discards the typed text, so the cell keeps whatever it held.
    await gu.autocomplete.close();
    await gu.waitAppFocus();
    return offered;
  }

  /**
   * A real right click can't reach a locked form's questions: the overlay that covers the editor
   * takes the event instead.
   */
  async function rightClickThroughOverlay(el: WebElement) {
    // Selecting a question smooth-scrolls it into view, which drags the menu that the same click
    // opens along with it for a few hundred milliseconds, so a hover landing mid-scroll is undone by
    // the menu sliding out from under the pointer. Scrolling first makes that scroll a no-op.
    await gu.scrollIntoView(el);
    await driver.executeScript(
      "arguments[0].dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true}))",
      el);
  }

  it("greys cells and opens the editor read-only once the table is flagged", async function() {
    // Baseline, so the assertions after the flag flips can't pass vacuously.
    assert.isFalse(await gu.getCell({ rowNum: 1, col: "Title" }).matches(".readonly"));
    await waitForAddAffordances(true);

    await setLocked(true);

    // The flag arrives as a doc action; the cell greys out without a reload.
    await gu.waitToPass(async () => {
      assert.isTrue(await gu.getCell({ rowNum: 1, col: "Title" }).matches(".readonly"));
      // Column index 1 is Budget (millions), a numeric column with its own widget.
      assert.isTrue(await gu.getCell({ rowNum: 2, col: 1 }).matches(".readonly"));
    }, 3000);

    // The editor still opens, but a read-only one.
    await gu.getCell({ rowNum: 1, col: "Title" }).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.ENTER);
    assert.isTrue(await driver.findWait(".default_editor.readonly_editor", 1000).isPresent());
    await gu.sendKeys(Key.ESCAPE);

    await waitForAddAffordances(false);
  });

  it("ignores the keyboard shortcuts for inserting a column and for filling down", async function() {
    const columns = await gu.getColumnNames();
    const titles = await gu.getVisibleGridCells("Title", [1, 2]);
    await gu.getCell({ rowNum: 1, col: "Title" }).click();
    await gu.waitAppFocus();

    await gu.sendKeys(Key.chord(Key.ALT, "="));
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.ALT, "="));
    assert.deepEqual(await gu.getColumnNames(), columns);

    // Fill-down over two selected rows would otherwise overwrite the second one.
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.DOWN));
    await gu.sendKeys(Key.chord(await gu.modKey(), "d"));
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells("Title", [1, 2]), titles);
  });

  it("disables write items in the column menu, keeping view items enabled", async function() {
    const menu = await gu.openColumnMenu("Title");
    // Hiding, sorting and filtering only write to the view metadata, which the engine allows.
    assert.deepEqual(await getListItemDisabledStates(menu, [
      /Rename column/, /Delete column/, /Reset column/,
      /Insert column to the left/, /Insert column to the right/,
      /Hide column/, /Filter Data/,
    ]), [true, true, true, true, true, false, false]);
    assert.isFalse(await menu.find(".test-more-sort-options").matches('[aria-disabled="true"]'));
    await closeMenu();
  });

  it("disables row and cell context menu items that write to the table", async function() {
    const rowMenu = await gu.openRowMenu(1);
    assert.deepEqual(await getListItemDisabledStates(rowMenu, [
      /Insert row above/, /Insert row below/, /Duplicate row/, /Use as table headers/, /Delete/,
    ]), [true, true, true, true, true]);
    await closeMenu();

    // Click first, so the selection is this one cell and the labels are singular.
    const cell = await gu.getCell({ rowNum: 1, col: "Title" });
    await cell.click();
    await gu.rightClick(cell);
    const cellMenu = await gu.findOpenMenu();
    // Commenting and filtering don't write to the table, so they stay available.
    assert.deepEqual(await getListItemDisabledStates(cellMenu, [
      /Insert column to the left/, /Insert column to the right/, /Cut/, /Paste/, /Delete row/,
      /Comment/, /Filter by this value/,
    ]), [true, true, true, true, true, false, false]);
    await closeMenu();
  });

  it("restores editing when the flag is cleared, without a reload", async function() {
    const lock = () => driver.find(".active_section .test-widget-title-lock");
    assert.isTrue(await lock().isPresent());
    await lock().mouseMove();
    await gu.waitToPass(async () => assert.equal(
      await driver.find(".test-tooltip").getText(),
      "This table is managed by Grist and cannot be modified",
    ), 1000);

    await setLocked(false);

    await gu.waitToPass(async () => {
      assert.isFalse(await gu.getCell({ rowNum: 1, col: "Title" }).matches(".readonly"));
      assert.isFalse(await lock().isPresent());
    }, 3000);
    await waitForAddAffordances(true);

    // A real edit goes through again.
    await gu.getCell({ rowNum: 1, col: "Title" }).click();
    await gu.waitAppFocus();
    await gu.enterCell("Toy Story 2");
    assert.deepEqual(await gu.getVisibleGridCells("Title", [1, 2]), ["Toy Story 2", "Forrest Gump"]);

    const menu = await gu.openColumnMenu("Title");
    assert.deepEqual(await getListItemDisabledStates(menu, [
      /Rename column/, /Insert column to the left/,
    ]), [false, false]);
    await closeMenu();
  });

  it("disables renaming and removing the table on the Raw Data page", async function() {
    // Resolved lazily: the title re-renders when the flag flips.
    const renamePencil = () => driver.findContent(".test-raw-data-table-id", /^Films$/)
      .findClosest(".test-raw-data-table").find(".test-raw-data-widget-title");
    const lock = () => driver.findContent(".test-raw-data-table-id", /^Films$/)
      .findClosest(".test-raw-data-table").find(".test-raw-data-lock");

    await driver.find(".test-tools-raw").click();
    await driver.findWait(".test-raw-data-list", 2000);
    await gu.waitForServer();
    // The flag is off from the previous test, so the inline rename affordance is offered.
    assert.isTrue(await renamePencil().isPresent());
    assert.isFalse(await lock().isPresent());

    await setLocked(true);
    await gu.waitToPass(async () => {
      assert.isFalse(await renamePencil().isPresent());
      assert.isTrue(await lock().isPresent());
    }, 3000);

    await driver.find(".test-raw-data-table-menu-Films").click();
    const menu = await gu.findOpenMenu();
    // Duplicating only reads the locked table and adds a fresh unlocked one, so the engine allows
    // it and the menu keeps offering it.
    assert.deepEqual(await getListItemDisabledStates(menu,
      [/Rename table/, /Remove table/, /Duplicate table/]), [true, true, false]);
    await closeMenu();

    // The right panel saves a raw section's title as a table rename, which the engine blocks.
    await driver.findContent(".test-raw-data-table-title", /^Films$/).click();
    await gu.waitForServer();
    await gu.openWidgetPanel();
    assert.equal(await driver.find(".test-right-widget-title").getAttribute("disabled"), "true");
    await gu.closeRawTable();
  });

  it("covers the form editor and blocks publishing", async function() {
    // The previous test left us on the Raw Data page, which has no widget of its own.
    await gu.openPage("Films");

    // Still locked from the previous test.
    const createForm = () => driver.findContent(".grist-floating-menu li", /Create a form/);
    await gu.openSectionMenu("viewLayout");
    assert.isFalse(await createForm().isDisplayed());
    await closeMenu();

    await setLocked(false);
    await waitForAddAffordances(true);
    await gu.openSectionMenu("viewLayout");
    assert.isTrue(await createForm().isDisplayed());
    await closeMenu();

    // The form widget has to be built while the table still accepts records.
    await gu.addNewSection("Form", "Films", { dismissTips: true });
    const overlay = () => driver.find(".test-forms-no-new-records-overlay");
    const publish = () => driver.find(".test-forms-publish");
    assert.isFalse(await overlay().isPresent());
    assert.isNull(await publish().getAttribute("disabled"));

    await setLocked(true);
    await gu.waitToPass(async () => {
      assert.isTrue(await overlay().isPresent());
      assert.equal(await publish().getAttribute("disabled"), "true");
    }, 3000);

    await publish().mouseMove();
    await gu.waitToPass(async () => assert.equal(
      await driver.find(".test-tooltip").getText(),
      "This table does not accept new records.",
    ), 1000);

    const questions = await questionLabels();
    await rightClickThroughOverlay(await question("Title"));
    const insertAbove = (await gu.findOpenMenu()).findContent("li", /Insert question above/);
    await insertAbove.mouseMove();
    await driver.findContentWait(".grist-floating-menu li", /^Text$/, 2000);
    const submenu = (await driver.findAll(".grist-floating-menu")).slice(-1)[0];
    // Building blocks only touch the form layout, which the engine allows.
    assert.deepEqual(await getListItemDisabledStates(submenu, [
      /^Text$/, /^Numeric$/, /^Choice$/, /^Date$/, /^Header$/, /^Paragraph$/, /^Separator$/,
    ]), [true, true, true, true, false, false, false]);
    // The submenu's own row would otherwise insert a Text question directly.
    await insertAbove.click();
    await gu.waitForServer();
    assert.deepEqual(await questionLabels(), questions);
    // One Escape per open menu.
    await closeMenu();
    await closeMenu();

    await setLocked(false);
    await gu.waitToPass(async () => {
      assert.isFalse(await overlay().isPresent());
      assert.isNull(await publish().getAttribute("disabled"));
    }, 3000);
  });

  it("refuses a locked table for a form widget in the page picker", async function() {
    await setLocked(true);
    await driver.findWait(".test-dp-add-new", 2000).doClick();
    await driver.findWait(".test-dp-add-new-page", 2000).doClick();
    await driver.findWait(".test-wselect-container", 2000);
    await gu.dismissBehavioralPrompts();

    const type = (label: string) => driver.findContent(".test-wselect-type", gu.exactMatch(label));
    const table = (label: string) =>
      driver.findContent(".test-wselect-table-label", gu.exactMatch(label));
    const addBtn = () => driver.find(".test-wselect-addBtn");
    const selectedType = () => driver.find(".test-wselect-type[class*=-selected]").getText();

    await type("Form").click();
    assert.match(await table("Films").getAttribute("class"), /-disabled/);
    await table("Films").click();
    assert.isFalse(await table("Films").matches("[class*=-selected]"));
    assert.equal(await addBtn().getAttribute("disabled"), "true");

    // Keyboard activation is guarded separately, and the disabled entry also drops out of the
    // arrow-key traversal, so Enter can never land on it.
    const focused = () => driver.switchTo().activeElement().getText();
    for (let i = 0; i < 8 && await focused() !== "Form"; i++) {
      await gu.sendKeys(Key.ARROW_DOWN);
    }
    await gu.sendKeys(Key.ENTER);
    const reachable = new Set<string>();
    for (let i = 0; i < 4; i++) {
      reachable.add(await focused());
      await gu.sendKeys(Key.ARROW_DOWN);
    }
    assert.notInclude([...reachable], "Films");
    assert.includeMembers([...reachable], ["Friends", "Performances"]);

    await table("Performances").click();
    assert.isNull(await addBtn().getAttribute("disabled"));

    await type("Table").click();
    await table("Films").click();
    assert.isTrue(await table("Films").matches("[class*=-selected]"));
    assert.isNull(await addBtn().getAttribute("disabled"));
    assert.match(await type("Form").getAttribute("class"), /-disabled/);
    await type("Form").click();
    assert.equal(await selectedType(), "Table");
    // Summarizing stays on offer: the summary table is a new one, and it is not locked.
    const pivot = driver.findContent(".test-wselect-table", /Films/).find(".test-wselect-pivot");
    assert.notMatch(await pivot.getAttribute("class"), /-disabled/);

    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForNotPresent(".test-wselect-container", 2000);
  });

  it("omits a locked table from the import destinations", async function() {
    await setLocked(true);
    await gu.importFileDialog("./uploads/UploadedData1.csv");
    await driver.findWait(".test-importer-preview", 5000);

    const destinations = () => driver.findAll(".test-importer-target", el => el.getText());
    await gu.waitToPass(async () =>
      assert.deepEqual(await destinations(), ["New Table", "Friends", "Performances"]), 3000);

    await setLocked(false);
    await gu.waitToPass(async () =>
      assert.deepEqual(await destinations(), ["New Table", "Films", "Friends", "Performances"]),
    3000);

    await driver.find(".test-modal-cancel").click();
    await gu.waitForServer();
    await gu.waitForNotPresent(".test-importer-dialog", 2000);
  });

  it("drops the add-new row from editors referencing a locked table", async function() {
    await gu.openPage("Friends");
    // The reference list belongs to unlocked Friends, so adding it is allowed either way, but the
    // show column has to be picked while Films still accepts the write.
    await api.applyUserActions(docId,
      [["AddVisibleColumn", "Friends", "Watched", { type: "RefList:Films" }]]);
    await gu.getCell({ rowNum: 1, col: "Watched" }).click();
    await gu.openColumnPanel();
    await gu.setRefShowColumn("Title");

    assert.isTrue(await offersAddNew("Favorite Film"));
    assert.isTrue(await offersAddNew("Watched"));

    await setLocked(true);

    // The editor reads the flag when it opens, so each retry opens a fresh one.
    await gu.waitToPass(async () => assert.isFalse(await offersAddNew("Favorite Film")), 3000);
    assert.isFalse(await offersAddNew("Watched"));

    await setLocked(false);
    await gu.waitToPass(async () => assert.isTrue(await offersAddNew("Favorite Film")), 3000);
    await api.applyUserActions(docId, [["RemoveColumn", "Friends", "Watched"]]);
    // Each Escape above raised an "Undo discard" toast; left up, they swallow clicks in later tests.
    await gu.wipeToasts();
  });

  it("keeps a locked table when its last widget or its page goes", async function() {
    await gu.addNewPage("Table", "New Table", { tableName: "Vault", dismissTips: true });
    // "Delete widget" is disabled on a page's only widget, so the page needs a second one.
    await gu.addNewSection("Table", "New Table", { tableName: "Spare", dismissTips: true });

    // Baseline: this is the table's only widget, so unlocked the deletion asks about its data.
    await gu.deleteWidget("VAULT");
    await driver.findWait(".test-removePopup", 1000);
    await driver.find(".test-modal-cancel").click();
    await gu.waitForNotPresent(".test-removePopup", 1000);

    await setLocked(true, await tableRef("Vault"));
    await gu.waitToPass(async () =>
      assert.isTrue(await driver.find(".test-widget-title-lock").isPresent()), 3000);
    await gu.deleteWidget("VAULT");
    assert.isFalse(await driver.find(".test-removePopup").isPresent());
    assert.deepEqual(await gu.getSectionTitles(), ["SPARE"]);
    assert.include(await tableIds(), "Vault");

    // Removing the page offers to delete the data of the tables it leaves invisible - the locked
    // one is not among them, even though the page is its last.
    await gu.addNewSection("Table", "Vault", { dismissTips: true });
    await gu.removePage("Vault", { expectPrompt: true, tables: ["Spare"] });
    assert.includeMembers(await tableIds(), ["Vault", "Spare"]);
  });

  it("keeps widget-level panel affordances while dropping table-level ones", async function() {
    await gu.openPage("Films");
    // The Films page also holds the form widget from the earlier test; the grid is the only one
    // whose title offers a rename popup. The cell click is what keeps the selection down to one
    // column - a whole-row one would open the multi-column menu, which has no sort items.
    await driver.find(".grid_view_data .gridview_data_row_num").click();
    await gu.getCell({ rowNum: 1, col: "Title" }).click();
    await gu.waitAppFocus();
    await setLocked(true);
    await driver.findWait(".active_section .test-widget-title-lock", 3000);

    await driver.find(".active_section .test-viewsection-title .test-widget-title-text").click();
    await driver.findWait(".test-widget-title-popup", 1000);
    assert.equal(await driver.find(".test-widget-title-table-name-input").getAttribute("disabled"),
      "true");
    // Only a raw section's title saves as a table rename, so this one stays editable.
    assert.isNull(await driver.find(".test-widget-title-section-name-input")
      .getAttribute("disabled"));
    await closeMenu();

    await gu.renameActiveSection("Locked films");
    assert.match(await gu.getActiveSectionTitle(), /locked films/i);
    await gu.renameActiveSection("");

    // "Update data" rewrites manualSort, so it goes while the sort itself stays on offer.
    await gu.openColumnMenu("Title", "sort-asc");
    await gu.openWidgetPanel("sortAndFilter");
    assert.deepEqual(await driver.findAll(".test-sort-config-column", el => el.getText()),
      ["Title"]);
    assert.isFalse(await driver.find(".test-sort-config-update").isDisplayed());

    await setLocked(false);
    await gu.waitForDisplay(".test-sort-config-update", 3000);

    await driver.find(".active_section .test-section-menu-small-btn-revert").click();
    await gu.waitForServer();
  });

  it("blocks adding and removing conditional style rules, keeping the styles editable", async function() {
    // Each rule is a hidden formula column, so the rule itself has to be built while Films still
    // accepts one.
    await gu.openWidgetPanel("widget");
    await gu.addInitialStyleRule();
    await gu.openStyleRuleFormula(0);
    await gu.sendKeys("True", Key.ENTER);
    await gu.waitForServer();

    const addStyle = () => driver.find(".test-widget-style-add-conditional-style");
    const addAnother = () => driver.find(".test-widget-style-add-another-rule");
    const removeRule = () => driver.find(".test-widget-style-remove-rule-0");
    const ruleFormula = () =>
      driver.find(".test-widget-style-conditional-rule-0 .formula_field_sidepane");
    assert.isNull(await addAnother().getAttribute("disabled"));
    assert.isTrue(await removeRule().isDisplayed());

    await setLocked(true);
    await gu.waitToPass(async () => {
      assert.equal(await addAnother().getAttribute("disabled"), "true");
      // This one is hidden while any rule exists, so only its attribute is observable.
      assert.equal(await addStyle().getAttribute("disabled"), "true");
      assert.isFalse(await removeRule().isDisplayed());
    }, 3000);

    // The formula is unreachable two ways over: pointer events are off, and the focus handler
    // blurs instead of opening the editor. A click would be intercepted, so focus it directly.
    assert.match(await ruleFormula().getAttribute("class"), /-disabled/);
    await driver.executeScript("arguments[0].focus()", await ruleFormula());
    assert.isFalse(await driver.find(".test-formula-editor").isPresent());

    // The styles are widgetOptions on the section, which the engine allows on a locked table.
    await gu.openCellColorPicker(0);
    await gu.setFillColor("#FF0000");
    await gu.applyStyle();
    // A row rule paints the record, not the cell.
    await gu.assertFillColor(
      await gu.getCell({ rowNum: 1, col: "Title" }).findClosest(".record"), "#FF0000");

    await setLocked(false);
    await gu.waitToPass(async () => {
      assert.isNull(await addAnother().getAttribute("disabled"));
      assert.isTrue(await removeRule().isDisplayed());
    }, 3000);
    await gu.removeStyleRuleAt(0);
  });

  it("blocks the card layout and reference additions that would add a column", async function() {
    await gu.addNewSection("Card", "Friends", { dismissTips: true });
    // Hiding a column is what tells the layout-only additions apart from the ones that add a
    // column to the table; it has to happen before the lock to keep the setup honest.
    await gu.openWidgetPanel("widget");
    await gu.moveToHidden("Age");

    // Likewise the displayed reference column, so that there is an entry whose remove icon can go.
    await gu.getDetailCell({ col: "Favorite Film", rowNum: 1 }).click();
    await gu.openColumnPanel();
    await driver.find(".test-ref-select-add").click();
    await driver.findContentWait(".test-ref-select-menu li", /Title/, 1000).click();
    await gu.waitForServer();
    // The icon is hover-only even unhidden, so hover before every look.
    const removeIconShown = async () => {
      await driver.find(".test-ref-select-item").mouseMove();
      return driver.find(".test-ref-select-remove").isDisplayed();
    };
    assert.isTrue(await removeIconShown());

    const friendsRef = await tableRef("Friends");
    await setLocked(true, friendsRef);
    // The reference config keys on the card's own table, not the one it points at - Films is
    // unlocked here.
    await gu.waitToPass(async () => {
      assert.match(await driver.find(".test-ref-select-add").getAttribute("class"), /-disabled/);
      assert.isFalse(await removeIconShown());
    }, 3000);

    await gu.openWidgetPanel("widget");
    await driver.find(".test-vconfigtab-detail-edit-layout").click();
    const controls = await driver.findWait(".active_section .test-edit-layout-controls", 1000);
    const addField = await controls.findContent("button", /Add field/);
    await addField.click();
    const addMenu = await driver.findWait(".test-edit-layout-add-menu", 1000);
    // Showing a hidden column only moves it into the layout, so it stays on offer.
    assert.deepEqual(await getListItemDisabledStates(addMenu, [/Create new field/, /Show field Age/]),
      [true, false]);
    // Escape here would cancel the layout editor too, so close the menu with its own button.
    await addField.click();
    await controls.findContent("button", /Cancel/).click();
    await gu.waitForServer();

    await setLocked(false, friendsRef);
    await gu.getDetailCell({ col: "Favorite Film", rowNum: 1 }).click();
    await gu.openColumnPanel();
    await gu.waitToPass(async () => assert.isTrue(await removeIconShown()), 3000);
    await driver.find(".test-ref-select-remove").click();
    await gu.waitForServer();

    await gu.deleteWidget("FRIENDS Card");
  });

  it("blocks the two-way reference toggle when either side is locked", async function() {
    await gu.openPage("Friends");
    await gu.openColumnPanel("Favorite Film");

    const addTwoWay = () => driver.find(".test-add-reverse-columm");
    const removeTwoWay = () => driver.find(".test-remove-reverse-column");
    assert.isNull(await addTwoWay().getAttribute("disabled"));

    const friendsRef = await tableRef("Friends");
    // The reverse column is added to both tables at once, so either lock has to stop it.
    for (const ref of [filmsRef, friendsRef]) {
      await setLocked(true, ref);
      await gu.waitToPass(async () =>
        assert.equal(await addTwoWay().getAttribute("disabled"), "true"), 3000);
      await addTwoWay().click();
      await gu.waitForServer();
      assert.isFalse(await driver.find(".test-reverse-column-label").isPresent());
      await setLocked(false, ref);
    }

    await gu.waitToPass(async () =>
      assert.isNull(await addTwoWay().getAttribute("disabled")), 3000);
    await addTwoWay().click();
    await gu.waitForServer();
    assert.isTrue(await driver.findWait(".test-reverse-column-label", 2000).isDisplayed());

    await setLocked(true);
    await gu.waitToPass(async () => assert.isFalse(await removeTwoWay().isDisplayed()), 3000);

    await setLocked(false);
    await gu.waitForDisplay(".test-remove-reverse-column", 3000);
    await removeTwoWay().click();
    await driver.findWait(".test-modal-confirm", 1000).click();
    await gu.waitForServer();
  });

  it("offers no new columns in the calendar setup, and refuses events", async function() {
    await gu.openPage("Films");
    await setLocked(true);
    await gu.addNewSection(/Calendar/, /Films/, { dismissTips: true });
    await driver.findWait(".test-calendar-setup-start", 2000);

    const slotRows = async (slot: string) => {
      await driver.find(`.test-calendar-setup-${slot} .test-select-open`).click();
      await driver.findWait(".test-select-menu", 1000);
      return driver.findAll(".test-select-menu .test-select-row", el => el.getText());
    };
    // The next slot's select swallows the click if the previous menu is still on its way out.
    const pickRow = async (label: string) => {
      await driver.findContentWait(".test-select-menu .test-select-row", gu.exactMatch(label), 1000)
        .click();
      await gu.waitForNotPresent(".test-select-menu", 2000);
    };

    // With no column to create, the required Start slot starts unset rather than on "create new".
    assert.equal(await driver.find(".test-calendar-setup-start .test-select-open").getText(),
      "Select a column");
    assert.equal(await driver.find(".test-calendar-setup-title .test-select-open").getText(),
      "None");
    assert.deepEqual(await slotRows("start"), ["Release Date"]);
    await pickRow("Release Date");
    assert.deepEqual(await slotRows("title"), ["None", "Title"]);
    await pickRow("Title");

    await driver.find(".test-modal-confirm").click();
    await gu.waitForServer();
    await driver.findWait(".test-calendar-widget", 4000);

    // Dragging a range on the grid is the calendar's create path (see the CalendarView suite);
    // locked, it writes nothing.
    const rowCount = async () => (await api.getTable(docId, "Films")).id.length;
    const before = await rowCount();
    const grid = await driver.find(".test-calendar-widget");
    await driver.withActions(a => a
      .move({ origin: grid, x: 0, y: -20 })
      .press()
      .move({ origin: grid, x: 0, y: 20 })
      .pause(120)
      .release());
    await gu.waitForServer();
    assert.equal(await rowCount(), before);
    assert.isFalse(await driver.find(".test-record-card-popup-overlay").isPresent());

    await setLocked(false);
    await gu.deleteWidget("FILMS Calendar");
  });

  it("drops the upload icon from attachment cells", async function() {
    // Films has no attachments column of its own, and one can only be added unlocked.
    await setLocked(false);
    await api.applyUserActions(docId,
      [["AddVisibleColumn", "Films", "Poster", { type: "Attachments" }]]);
    await driver.find(".grid_view_data .gridview_data_row_num").click();
    const icon = () => gu.getCell({ rowNum: 1, col: "Poster" }).find(".test-attachment-icon");
    await gu.getCell({ rowNum: 1, col: "Poster" }).click();
    assert.isTrue(await icon().isPresent());

    await setLocked(true);
    await gu.waitToPass(async () => assert.isFalse(await icon().isPresent()), 3000);

    await setLocked(false);
    await gu.waitToPass(async () => assert.isTrue(await icon().isPresent()), 3000);
    await api.applyUserActions(docId, [["RemoveColumn", "Films", "Poster"]]);
  });

  it("hides the spinner arrows and inerts the toggle checkbox", async function() {
    // Both widgets write the cell from the cell itself rather than through an editor, so neither is
    // covered by the read-only editor the earlier tests pin.
    await api.applyUserActions(docId, [
      ["AddVisibleColumn", "Films", "Rating",
        { type: "Numeric", widgetOptions: JSON.stringify({ widget: "Spinner" }) }],
      ["AddVisibleColumn", "Films", "Seen",
        { type: "Bool", widgetOptions: JSON.stringify({ widget: "CheckBox" }) }],
    ]);
    const arrows = () => gu.getCell({ rowNum: 1, col: "Rating" }).find(".kf_spinner");
    const checkbox = () => gu.getCell({ rowNum: 1, col: "Seen" }).find(".widget_checkbox");
    const seen = async () => (await api.getTable(docId, "Films")).Seen[0];

    // Both columns land at the far right of a grid that is already wider than the window, and a
    // click on a half-scrolled cell lands wherever the grid re-renders it; moving the cursor there
    // is what scrolls the column fully into view.
    await gu.getCell({ rowNum: 1, col: "Rating" }).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.ARROW_RIGHT);

    // Baseline: the click writes, which is what has to stop once the flag is on.
    assert.isTrue(await arrows().isDisplayed());
    assert.isFalse(await checkbox().matches(".disabled"));
    await checkbox().click();
    await gu.waitForServer();
    assert.isTrue(await seen());
    assert.equal(await checkbox().getCssValue("cursor"), "pointer");

    await setLocked(true);
    await gu.waitToPass(async () => {
      assert.isFalse(await arrows().isDisplayed());
      assert.isTrue(await checkbox().matches(".disabled"));
    }, 3000);
    // The affordance rules are the only thing that tells the cell apart from a live one; the
    // checkbox keeps its pointer events so that the click below is a real one.
    assert.notEqual(await checkbox().getCssValue("cursor"), "pointer");

    await checkbox().click();
    await gu.waitForServer();
    assert.isTrue(await seen());

    await setLocked(false);
    await gu.waitToPass(async () => {
      assert.isTrue(await arrows().isDisplayed());
      assert.isFalse(await checkbox().matches(".disabled"));
    }, 3000);
    await api.applyUserActions(docId,
      [["RemoveColumn", "Films", "Rating"], ["RemoveColumn", "Films", "Seen"]]);
  });

  it("opens a formula read-only in the cell and in the creator panel", async function() {
    await api.applyUserActions(docId, [
      ["AddVisibleColumn", "Films", "Caps", { isFormula: true, formula: "$Title.upper()" }],
    ]);
    await setLocked(true);
    await gu.waitToPass(async () =>
      assert.isTrue(await gu.getCell({ rowNum: 1, col: "Caps" }).matches(".readonly")), 3000);

    // The formula editor is its own editor class, so the read-only flavour the default editor gets
    // has to be pinned separately.
    await gu.getCell({ rowNum: 1, col: "Caps" }).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.ENTER);
    const editor = await driver.findWait(".formula_editor_wrapper.readonly_editor", 1000);
    // The lock badge is a ::before on the editor, and the Ace pane inside paints at z-index 10, so
    // anything lower leaves the badge covered.
    assert.equal(await driver.executeScript(
      "return getComputedStyle(arguments[0], '::before').zIndex", editor), "11");
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForNotPresent(".formula_editor_wrapper", 2000);

    await gu.openColumnPanel();
    const panelFormula = () => driver.find(".test-right-panel .formula_field_sidepane");
    assert.match(await panelFormula().getAttribute("class"), /-disabled/);
    assert.equal(await panelFormula().getCssValue("pointer-events"), "none");
    assert.equal(await panelFormula().getCssValue("opacity"), "0.4");
    // The editor it would open is hardcoded read-only: false, and the dropped pointer events only
    // stop a pointer - so focus it directly, the way assistive tech would.
    await driver.executeScript("arguments[0].focus()", await panelFormula());
    assert.isFalse(await driver.find(".test-formula-editor").isPresent());

    await setLocked(false);
    await gu.waitToPass(async () =>
      assert.notMatch(await panelFormula().getAttribute("class"), /-disabled/), 3000);
    await api.applyUserActions(docId, [["RemoveColumn", "Films", "Caps"]]);
  });

  it("keys the reference show-column on its own table, and follows a two-way pair", async function() {
    await gu.openPage("Friends");
    // A column of this test's own, rather than the fixture's Favorite Film, so that the pair built
    // below is not the one an earlier test may have left behind.
    await api.applyUserActions(docId,
      [["AddVisibleColumn", "Friends", "Pick", { type: "Ref:Films" }]]);
    await gu.openColumnPanel("Pick");

    const addTwoWay = () => driver.find(".test-add-reverse-columm");
    const showColumn = () => driver.find(".test-fbuilder-ref-col-select .test-select-open");
    const typeSelect = () => driver.find(".test-fbuilder-type-select .test-select-open");
    const refTable = () => driver.find(".test-fbuilder-ref-table-select .test-select-open");
    const friendsRef = await tableRef("Friends");

    // Changing the show column rewrites a hidden display helper column of Friends, so the lock that
    // matters is the one on Friends rather than on the Films it points at.
    assert.isFalse(await showColumn().matches(".disabled"));
    await setLocked(true, friendsRef);
    await gu.waitToPass(async () => assert.isTrue(await showColumn().matches(".disabled")), 3000);
    await setLocked(false, friendsRef);
    await gu.waitToPass(async () => {
      assert.isFalse(await showColumn().matches(".disabled"));
      assert.isNull(await addTwoWay().getAttribute("disabled"));
    }, 3000);

    await addTwoWay().click();
    await gu.waitForServer();
    await driver.findWait(".test-reverse-column-label", 2000);

    // The other half of the pair lives in Films, and every write to either half writes both, so a
    // lock on Films reaches into this column of unlocked Friends.
    await setLocked(true);
    await gu.waitToPass(async () => {
      assert.isTrue(await gu.getCell({ rowNum: 1, col: "Pick" }).matches(".readonly"));
      assert.isTrue(await typeSelect().matches(".disabled"));
      assert.isTrue(await refTable().matches(".disabled"));
    }, 3000);
    // The show column is the deliberate exception: it writes only to Friends, which is unlocked.
    assert.isFalse(await showColumn().matches(".disabled"));

    await setLocked(false);
    await gu.waitToPass(async () => assert.isFalse(
      await gu.getCell({ rowNum: 1, col: "Pick" }).matches(".readonly")), 3000);
    await driver.find(".test-remove-reverse-column").click();
    await driver.findWait(".test-modal-confirm", 1000).click();
    await gu.waitForServer();
    await api.applyUserActions(docId, [["RemoveColumn", "Friends", "Pick"]]);
  });
});
