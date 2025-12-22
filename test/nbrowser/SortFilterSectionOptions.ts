import { assert, driver, Key, until } from "mocha-webdriver";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";

describe("SortFilterSectionOptions", function() {
  this.timeout(60000);
  setupTestSuite();

  async function assertFilterBarPinnedFilters(expected: gu.PinnedFilter[]) {
    const actual = await gu.getPinnedFilters();
    assert.deepEqual(actual, expected);
  }

  async function assertSectionMenuPinnedFilters(expected: gu.PinnedFilter[]) {
    await driver.findWait(".test-section-menu-heading-sort", 100);
    const allFilters = await driver.findAll(".grist-floating-menu .test-filter-config-filter", async (el) => {
      const column = await el.find(".test-filter-config-column");
      const pinButton = await el.find(".test-filter-config-pin-filter");
      const pinButtonClass = await pinButton.getAttribute("class");
      const filterIcon = await el.find(".test-filter-config-filter-icon");
      const filterIconClass = await filterIcon.getAttribute("class");
      return {
        name: await column.getText(),
        isPinned: /\b\w+-pinned\b/.test(pinButtonClass),
        hasUnsavedChanges: /\b\w+-accent\b/.test(filterIconClass),
      };
    });
    const pinnedFilters = allFilters.filter(({ isPinned }) => isPinned);
    const actual = pinnedFilters.map(({ name, hasUnsavedChanges }) => ({ name, hasUnsavedChanges }));
    assert.deepEqual(actual, expected);
  }

  async function assertPinnedFilters(expected: gu.PinnedFilter[]) {
    await assertFilterBarPinnedFilters(expected);
    await assertSectionMenuPinnedFilters(expected);
  }

  before(async function() {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");
    await gu.importFixturesDoc("chimpy", "nasa", "Horizon", "SortFilterIconTest.grist", "newui");
    await driver.findContentWait(".field_clip", /Apples/, 6000);
  });

  it("should display the unsaved icon on filter changes", async () => {
    assert.deepEqual(await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5, 6]),
      ["Apples", "Oranges", "Bananas", "Grapes", "Grapefruit", "Clementines"]);
    await assertFilterBarPinnedFilters([]);

    // Verify that filter icon is present and has no -any class
    assert.isTrue(await driver.find(".test-section-menu-filter-icon").isPresent());
    assert.isFalse(await driver.find(".test-section-menu-filter-icon").matches("[class*=-any]"));

    // Open the filter menu and uncheck an item
    let menu = await gu.openColumnMenu("Name", "Filter");
    await menu.findContent("label", /Apples/).find("input:checked").click();
    await driver.find(".test-filter-menu-apply-btn").click();

    // Verify that the view got filtered
    assert.deepEqual(await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5]),
      ["Oranges", "Bananas", "Grapes", "Grapefruit", "Clementines"]);
    await assertFilterBarPinnedFilters([{ name: "Name", hasUnsavedChanges: true }]);

    // Section header should now display the filter icon in the unsaved state
    assert.isTrue(await driver.find(".test-section-menu-wrapper[class*=-unsaved] .test-section-menu-filter-icon")
      .isPresent());

    // check filter icon is displayed with -any class
    assert.isTrue(await driver.find(".test-section-menu-filter-icon").matches("[class*=-any]"));

    // Open the filter menu and check the previously unchecked item
    menu = await gu.openColumnMenu("Name", "Filter");
    await menu.findContent("label", /Apples/).find("input:not(checked)").click();
    await driver.find(".test-filter-menu-apply-btn").click();

    // Verify that rows are no longer filtered
    assert.deepEqual(await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5, 6]),
      ["Apples", "Oranges", "Bananas", "Grapes", "Grapefruit", "Clementines"]);

    // Remove the filter
    await gu.openSectionMenu("sortAndFilter");
    await driver.findContent(".test-filter-config-filter", /Name/)
      .find(".test-filter-config-remove-filter").click();

    // Verify that section header no longer class that match -any
    assert.isFalse(await driver.find(".test-section-menu-filter-icon").matches("[class*=-any]"));
    assert.isFalse(await driver.find(".test-section-menu-wrapper[class*=-unsaved] .test-section-menu-filter-icon")
      .isPresent());
    await assertPinnedFilters([]);

    await gu.sendKeys(Key.ESCAPE);
  });

  it("should display dropdown menu when there is a filter present", async () => {
    let menu = await gu.openSectionMenu("sortAndFilter");
    // Verify that sort and filter are in default state
    assert.deepEqual(await menu.findAll(".test-sort-config-row"), []);
    assert.deepEqual(await menu.findAll(".test-filter-config-filter"), []);
    await assertSectionMenuPinnedFilters([]);

    // Close menu
    await driver.sendKeys(Key.ESCAPE);

    // Activate a filter
    await (await gu.openColumnMenu("Name", "Filter")).findContent("label", /Apples/).click();

    // Open the section menu by clicking "All filters"
    await driver.find(".test-filter-menu-all-filters-btn").click();

    // Verify that section menu displays the filtered column
    menu = await driver.findWait(".grist-floating-menu", 100);
    assert.deepEqual(
      await menu.findAll(".test-filter-config-filter", el => el.getText()),
      ["Name"],
    );
    await assertPinnedFilters([{ name: "Name", hasUnsavedChanges: true }]);

    const btnSave = await driver.find(".test-section-menu-btn-save");
    const btnRevert = await driver.find(".test-section-menu-btn-revert");
    assert.equal(await btnSave.getText(), "Save");
    assert.equal(await btnRevert.getText(), "Revert");

    // Remove the filter
    await driver
      .findContent(".test-filter-config-filter", /Name/)
      .find(".test-filter-config-remove-filter")
      .click();

    // Verify that the filter options are back to default
    await driver.wait(until.stalenessOf(btnSave));
    await driver.wait(until.stalenessOf(btnRevert));
    await assertPinnedFilters([]);

    await driver.sendKeys(Key.ESCAPE);
  });

  it("should allow saving of filters", async () => {
    // Verify that filter icon has not class matching -any and and nothing is filtered
    assert.isFalse(await driver.find(".test-section-menu-filter-icon").matches("[class*=-any]"));
    assert.deepEqual(await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5, 6]),
      ["Apples", "Oranges", "Bananas", "Grapes", "Grapefruit", "Clementines"]);

    // Apply a filter
    await (await gu.openColumnMenu("Name", "Filter")).findContent("label", /Apples/).click();
    await driver.find(".test-filter-menu-apply-btn").click();

    // Verify that unsaved filter icon is display and has class matching -any
    await driver.findWait(".test-section-menu-wrapper[class*=-unsaved] .test-section-menu-filter-icon", 100);
    assert.isTrue(await driver.find(".test-section-menu-filter-icon").matches("[class*=-any]"));

    // Click save to view
    await gu.openSectionMenu("sortAndFilter");
    await driver.find(".test-section-menu-btn-save").click();
    await gu.waitForServer();

    // Verify that the wrapper has no -unsaved class
    assert.isFalse(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"));
    assert.deepEqual(await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5]),
      ["Oranges", "Bananas", "Grapes", "Grapefruit", "Clementines"]);
    await assertFilterBarPinnedFilters([{ name: "Name", hasUnsavedChanges: false }]);

    // Reload page
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();

    // Verify that rows are still filtered and icon is present
    assert.isFalse(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"));
    assert.deepEqual(await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5]),
      ["Oranges", "Bananas", "Grapes", "Grapefruit", "Clementines"]);
    await assertFilterBarPinnedFilters([{ name: "Name", hasUnsavedChanges: false }]);

    // Remove the filter
    await gu.openSectionMenu("sortAndFilter");
    await assertSectionMenuPinnedFilters([{ name: "Name", hasUnsavedChanges: false }]);
    await driver
      .findContent(".test-filter-config-filter", /Name/)
      .find(".test-filter-config-remove-filter")
      .click();

    // Verify that unsaved icon is displayed
    assert.isTrue(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"));
    assert.deepEqual(await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5, 6]),
      ["Apples", "Oranges", "Bananas", "Grapes", "Grapefruit", "Clementines"]);
    await assertPinnedFilters([]);

    // Click to save again
    await driver.find(".test-section-menu-btn-save").click();
    await gu.waitForServer();

    // Verify that icon has not class matching -any
    assert.isFalse(await driver.find(".test-section-menu-filter-icon").matches("[class*=-any]"));
    await assertFilterBarPinnedFilters([]);

    // Reload page
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();

    // Verify that rows are not filtered and icon has not class matchin -any
    assert.isFalse(await driver.find(".test-section-menu-filter-icon").matches("[class*=-any]"));
    assert.deepEqual(await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5, 6]),
      ["Apples", "Oranges", "Bananas", "Grapes", "Grapefruit", "Clementines"]);
    await assertFilterBarPinnedFilters([]);
  });

  it("should allow changing direction and removing sort from menu", async () => {
    // Verify that sort/filter icon has not class matching -any
    assert.isFalse(await driver.find(".test-section-menu-filter-icon").matches("[class*=-any]"));
    assert.deepEqual(await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5, 6]),
      ["Apples", "Oranges", "Bananas", "Grapes", "Grapefruit", "Clementines"]);

    // Add a sort
    await (await gu.openColumnMenu("Name")).findContent("li", "Sort").findContent("div", "A-Z").click();

    // Verify that unsaved icon is displayed
    assert.isTrue(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"));
    // Verify that the column has been sorted
    assert.deepEqual(await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5, 6]),
      ["Apples", "Bananas", "Clementines", "Grapefruit", "Grapes", "Oranges"]);
    // Verify that proper sort is listed in menu and highlighted
    await gu.openSectionMenu("sortAndFilter");
    let sortColumn = await driver.findContent(".test-sort-config-column", "Name");
    let sortIcon = await sortColumn.find(".test-sort-config-order");
    assert.isTrue((await sortIcon.getAttribute("class")).split(" ").some(c => c.endsWith("-asc")),
      "should include -asc class");

    // Change sort direction in menu
    await sortColumn.click();

    // Verify that the icon changed
    sortColumn = await driver.findContent(".test-sort-config-column", "Name");
    sortIcon = await sortColumn.find(".test-sort-config-order");
    assert.isTrue((await sortIcon.getAttribute("class")).split(" ").some(c => c.endsWith("-desc")),
      "should include -desc class");

    // Verify that the column direction has been changed
    assert.deepEqual(await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5, 6]),
      ["Oranges", "Grapes", "Grapefruit", "Clementines", "Bananas", "Apples"]);

    // Save to view
    await driver.find(".test-section-menu-btn-save").click();

    await gu.waitForServer();

    // re-open the sort&filter menu
    await gu.openSectionMenu("sortAndFilter");

    // Verify that saved icon is displayed
    assert.isFalse(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"));

    // Verify that sort column direction was saved
    sortColumn = await driver.findContent(".test-sort-config-column", "Name");
    sortIcon = await sortColumn.find(".test-sort-config-order");
    assert.isTrue((await sortIcon.getAttribute("class")).split(" ").some(c => c.endsWith("-desc")),
      "should include a -desc class");

    // Reload
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();

    // Verify that wrapper has not -unsaved class
    assert.isFalse(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"));

    // Verify that sort is listed in menu
    await gu.openSectionMenu("sortAndFilter");
    sortColumn = await driver.findContent(".test-sort-config-column", "Name");
    sortIcon = await sortColumn.find(".test-sort-config-order");
    assert.isTrue((await sortIcon.getAttribute("class")).split(" ").some(c => c.endsWith("-desc")),
      "should include a -desc class");

    // Verify that column is properly sorted
    assert.deepEqual(await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5, 6]),
      ["Oranges", "Grapes", "Grapefruit", "Clementines", "Bananas", "Apples"]);

    // Change the sort direction
    await sortIcon.click();

    // Verify that unsaved icon is displayed
    assert.isTrue(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"));
    // Verify that sort icon direction is changed
    sortColumn = await driver.findContent(".test-sort-config-column", "Name");
    sortIcon = await sortColumn.find(".test-sort-config-order");
    assert.isTrue((await sortIcon.getAttribute("class")).split(" ").some(c => c.endsWith("-asc")),
      "should include a -asc class");

    // Change the sort direction again
    await sortIcon.click();

    // Verify that wrapper has not class -unsaved
    assert.isFalse(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"));
    // Verify that sort icon direction is changed
    sortColumn = await driver.findContent(".test-sort-config-column", "Name");
    sortIcon = await sortColumn.find(".test-sort-config-order");
    assert.isTrue((await sortIcon.getAttribute("class")).split(" ").some(c => c.endsWith("-desc")),
      "should include a -desc class");

    // Click remove sort
    await driver.findContent(".test-sort-config-row", "Name")
      .find(".test-sort-config-remove").click();

    // Verify that sort column is gone
    await driver.wait(until.stalenessOf(sortIcon));
    assert.isEmpty(await driver.findAll(".test-sort-config-row"));
    // Verify that column is not sorted
    assert.deepEqual(await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5, 6]),
      ["Apples", "Oranges", "Bananas", "Grapes", "Grapefruit", "Clementines"]);
    // Verify that unsaved icon is displayed
    assert.isTrue(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"));
    // Click save to view
    await driver.find(".test-section-menu-btn-save").click();
    await gu.waitForServer();
    // re-open the view section menu
    await gu.openSectionMenu("sortAndFilter");
    // Verify that no sort column is listed in menu
    assert.isEmpty(await driver.findAll(".test-sort-config-row"));
    // Verify that sort/filter icon has not class matching -any
    assert.isFalse(await driver.find(".test-section-menu-filter-icon").matches("[class*=-any]"));

    // Close the menu
    await driver.find(".active_section .test-section-menu-wrapper").click();
  });

  it("should reflect filter state after hiding/unhiding a column", async function() {
    // Hide a column and undo to unhide it.
    await gu.openColumnMenu("Name", "Hide");
    await gu.waitForServer();
    await gu.undo();

    // The section-filter button should not be highlighted.
    assert.equal(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"), false);

    // Filter this column and apply.
    await gu.openColumnMenu("Name", "Filter");
    await driver.findContent(".test-filter-menu-wrapper .test-filter-menu-value", /Apples/).click();
    await driver.find(".test-filter-menu-apply-btn").click();

    // The section-filter button should highlight, and menu should show the filtered column.
    assert.equal(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"), true);
    const menu = await gu.openSectionMenu("sortAndFilter");
    assert.deepEqual(await menu.findAll(".test-filter-config-filter", f => f.getText()), ["Name"]);

    // Revert the filters, the button should un-highlight again.
    await menu.find(".test-section-menu-btn-revert").click();
    await driver.sendKeys(Key.ESCAPE);
    assert.equal(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"), false);
  });

  it("should not change filter state when a filtered column is hidden", async function() {
    // Filter a column and apply.
    await gu.openColumnMenu("Name", "Filter");
    await driver.findContent(".test-filter-menu-wrapper .test-filter-menu-value", /Apples/).click();
    await driver.find(".test-filter-menu-apply-btn").click();

    // Check that the section-filter button is highlighted.
    assert.equal(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"), true);

    // Hide the filtered column.
    await gu.openColumnMenu("Name", "Hide");
    await gu.waitForServer();

    // Check that the section-filter button is still highlighted.
    assert.equal(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"), true);

    // Open the section-filter menu and check that it still shows the previously applied filter.
    let menu = await gu.openSectionMenu("sortAndFilter");
    assert.equal(await menu.find(".test-filter-config-filter").getText(), "Name");

    // Close the menu.
    await driver.sendKeys(Key.ESCAPE);

    // Undo to unhide the column.
    await gu.undo();

    // Check that the section-filter button and menu still indicate the filter is applied.
    assert.equal(await driver.find(".test-section-menu-wrapper").matches("[class*=-unsaved]"), true);
    menu = await gu.openSectionMenu("sortAndFilter");
    assert.equal(await menu.find(".test-filter-config-filter").getText(), "Name");

    // Close the menu.
    await driver.sendKeys(Key.ESCAPE);
  });

  it("should be able to undo saved changes correctly", async function() {
    // add new page to start with no filter and no sort
    await gu.addNewPage(/Table/, /Table1/);

    // Verify that column is not filtered, not sorted
    assert.deepEqual(
      await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5, 6]),
      ["Apples", "Oranges", "Bananas", "Grapes", "Grapefruit", "Clementines"],
    );
    await assertFilterBarPinnedFilters([]);

    // Activate a filter
    await (await gu.openColumnMenu("Name", "Filter")).findContent("label", /Apples/).click();
    await driver.find(".test-filter-menu-apply-btn").click();

    // Add a sort
    await (await gu.openColumnMenu("Name")).findContent("li", "Sort").findContent("div", "A-Z").click();

    // save changes
    await gu.openSectionMenu("sortAndFilter");
    await driver.find(".test-section-menu-btn-save").click();
    await gu.waitForServer();

    // Verify that column is filtered and sorted
    assert.deepEqual(
      await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5]),
      ["Bananas", "Clementines", "Grapefruit", "Grapes", "Oranges"],
    );
    await assertFilterBarPinnedFilters([{ name: "Name", hasUnsavedChanges: false }]);

    // undo
    await gu.undo();

    // check there is no filter, no sort and no pinned filters
    assert.deepEqual(
      await gu.getVisibleGridCells("Name", [1, 2, 3, 4, 5, 6]),
      ["Apples", "Oranges", "Bananas", "Grapes", "Grapefruit", "Clementines"],
    );
    await assertFilterBarPinnedFilters([]);
  });

  it("should not break when changing filter from the section menu", async () => {
    // open Name column menu
    let menu = await gu.openColumnMenu("Name", "Filter");

    // add filter
    await menu.findContent("label", /Apples/).find("input:checked").click();

    // open section menu
    menu = await gu.openSectionMenu("sortAndFilter");

    // open the Name filter by clicking on it
    await menu.findContent(".test-filter-config-column", /Name/).click();

    // uncheck Bananas
    const menu2 = await driver.find(".test-filter-menu-wrapper");
    await menu2.findContent(".test-filter-menu-value", /Bananas/).click();
    await menu2.find(".test-filter-menu-apply-btn").click();

    // check the grid is filtered correclty
    assert.deepEqual(
      await gu.getVisibleGridCells("Name", [1, 2, 3, 4]),
      ["Oranges", "Grapes", "Grapefruit", "Clementines"],
    );

    // check there is no error
    await gu.checkForErrors();

    // click revert
    await driver.find(".test-section-menu-small-btn-revert").click();

    // check menu is closed
    await gu.waitToPass(async () => assert.isFalse(await driver.find(".grist-floating-menu").isPresent()));
  });

  it("should allow to add filter", async () => {
    // check that there are no pinned filters
    await assertFilterBarPinnedFilters([]);

    // open the section menu
    const menu = await gu.openSectionMenu("sortAndFilter");

    // check filter list is empty
    assert.deepEqual(
      await driver.findAll(".test-section-menu-filter-col", e => e.getText()),
      []);

    // click the add filter button
    await driver.find(".test-filter-config-add-filter-btn").click();

    // check all columns are listed
    assert.deepEqual(
      await driver.findAll(".test-sd-searchable-list-item", e => e.getText()),
      ["Name", "Count", "Date"],
    );

    // click Name
    await driver.findContent(".grist-floating-menu li", /Name/).click();

    // check the filter menu is shown
    assert.isTrue(
      await driver.find(".test-filter-menu-wrapper").isPresent(),
    );

    // check a filter was added and pinned
    await assertPinnedFilters([{ name: "Name", hasUnsavedChanges: true }]);

    // click Apple
    await driver.findContent(".test-filter-menu-list .test-filter-menu-value", /Apples/).click();

    // click Apply
    await driver.find(".test-filter-menu-apply-btn").click();

    // check filter list and pinned filters
    assert.deepEqual(
      await driver.findAll(".test-filter-config-filter", e => e.getText()),
      ["Name"]);
    await assertPinnedFilters([{ name: "Name", hasUnsavedChanges: true }]);

    // check data is correctly filtered
    assert.deepEqual(
      await gu.getVisibleGridCells({ cols: ["Name"], rowNums: [1, 2] }),
      ["Oranges", "Bananas"],
    );

    // remove filter
    await driver.findContent(".test-filter-config-filter", /Name/)
      .find(".test-filter-config-remove-filter").click();

    // closes menu
    await menu.sendKeys(Key.ESCAPE);
  });

  it("should close sort&filter menu when clicking Save/Revert", async () => {
    // open the sort&filter dropdown
    const menu = await gu.openSectionMenu("sortAndFilter");

    // add Name/Apples filter
    await driver.find(".test-filter-config-add-filter-btn").click();
    await driver.findContent(".grist-floating-menu li", /Name/).click();
    await driver.findContentWait(".test-filter-menu-list .test-filter-menu-value", /Apples/, 100).click();

    // click apply
    await driver.find(".test-filter-menu-apply-btn").click();

    // click the Save button
    await driver.find(".test-section-menu-btn-save").click();
    await gu.waitForServer();

    // check the menu is gone
    assert.equal(await menu.isPresent(), false);

    // undo
    await gu.undo();
  });

  it("should allow pinning filters", async () => {
    // check that there are no pinned filters
    await assertFilterBarPinnedFilters([]);

    // open the section menu
    const menu = await gu.openSectionMenu("sortAndFilter");

    // add a filter and check that it's pinned by default
    await driver.find(".test-filter-config-add-filter-btn").click();
    await driver.findContent(".grist-floating-menu li", /Name/).click();
    await driver.findContent(".test-filter-menu-list .test-filter-menu-value", /Apples/).click();
    await driver.find(".test-filter-menu-apply-btn").click();
    await assertPinnedFilters([{ name: "Name", hasUnsavedChanges: true }]);

    // unpin the filter and check that it worked
    await driver.findContent(".test-filter-config-filter", /Name/)
      .find(".test-filter-config-pin-filter").click();
    await assertPinnedFilters([]);

    // pin the filter and check that it worked
    await driver.findContent(".test-filter-config-filter", /Name/)
      .find(".test-filter-config-pin-filter").click();
    await assertPinnedFilters([{ name: "Name", hasUnsavedChanges: true }]);

    // remove the filter and close the menu
    await driver.findContent(".test-filter-config-filter", /Name/)
      .find(".test-filter-config-remove-filter").click();
    await menu.sendKeys(Key.ESCAPE);
  });
});
