"use strict";
import { assert, driver } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

const colHeaderScrollOpts = {block: "start", inline: "end"};

describe('ColumnOps.ntest', function() {
  gu.bigScreen();
  const cleanup = test.setupTestSuite(this);

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "World.grist", true);
    await gu.toggleSidePanel('left', 'close');
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it("should allow adding and deleting columns", async function() {
    await gu.clickColumnMenuItem('Name', 'Insert column to the right');
    await $('.test-new-columns-menu-add-new').click();
    await gu.waitForServer();
    // Newly created columns labels become editable automatically.  The next line checks that the
    // label is editable and then closes the editor.
    await gu.userActionsCollect(true);
    await gu.getOpenEditingLabel(await gu.getColumnHeader('A')).wait().sendKeys($.ENTER);
    // Verify that no UserActions were actually sent.
    await gu.waitForServer();
    await gu.userActionsVerify([]);
    await gu.userActionsCollect(false);
    await gu.waitAppFocus(true);
    await assert.isPresent(gu.getColumnHeader('A'), true);
    await assert.isPresent(gu.getOpenEditingLabel(gu.getColumnHeader('A')), false);

    await gu.clickColumnMenuItem('A', 'Delete column');
    await gu.waitForServer();
    await assert.isPresent(gu.getColumnHeader('A'), false);
  });

  it("should allow adding columns with new column menu", async function() {
    await assert.isPresent(gu.getColumnHeader('A'), false);
    await $('.mod-add-column').scrollIntoView(true);
    await $('.mod-add-column').click();
    await gu.actions.selectFloatingOption('Add column');
    await gu.userActionsCollect(true);
    await gu.waitToPass(() => gu.getColumnHeader('A'));
    await gu.getOpenEditingLabel(await gu.getColumnHeader('A')).wait().sendKeys($.ENTER);
    await gu.waitForServer();
    await gu.userActionsVerify([["AddRecord", "_grist_Views_section_field", null,
      {"colRef":43, "parentId":4, "parentPos":null}]]);
    await gu.userActionsCollect(false);
    await gu.waitAppFocus(true);
    await assert.isPresent(gu.getColumnHeader('A'), true);
    await assert.isPresent(gu.getOpenEditingLabel(gu.getColumnHeader('A')), false);
    assert.deepEqual(await gu.getGridLabels('City'),
       ["Name", "Country", "District", "Population", "A"]);
  });

  it("should allow hiding columns", async function() {
    await assert.isPresent(gu.getColumnHeader('Name'), true);
    await gu.getColumnHeader('Name').scrollIntoView(colHeaderScrollOpts);
    await gu.clickColumnMenuItem('Name', 'Hide column');
    await gu.waitForServer();
    await assert.isPresent(gu.getColumnHeader('Name'), false);

    await $(".test-undo").click();
    await gu.waitForServer();
    await assert.isPresent(gu.getColumnHeader('Name'), true);
  });

  it("[+] button should allow showing hidden columns", async function() {
    // Hide a column first
    await assert.isPresent(gu.getColumnHeader('Name'), true);
    await gu.getColumnHeader('Name').scrollIntoView(colHeaderScrollOpts);
    await gu.clickColumnMenuItem('Name', 'Hide column');
    await gu.waitForServer();
    await assert.isPresent(gu.getColumnHeader('Name'), false);

    // Then show it using the Add column menu
    await $('.mod-add-column').scrollIntoView(true);
    await $(".mod-add-column").click();
    await showColumn('Name');
    await gu.waitForServer();
    await assert.isPresent(gu.getColumnHeader('Name'), true);
  });

  it("[+] button show Add column directly if no hidden columns", async function() {
    await $('.mod-add-column').scrollIntoView(true);
    await $(".mod-add-column").click();
    await showColumn("Pop");
    await gu.waitForServer();
    await assert.isPresent(gu.getColumnHeader("Pop. '000"), true);

    await assert.isPresent(gu.getColumnHeader('B'), false);
    await $('.mod-add-column').scrollIntoView(true);
    await $(".mod-add-column").click();
    await $('.test-new-columns-menu-add-new').click();
    await gu.waitToPass(() => gu.getColumnHeader('B'));
    await gu.getOpenEditingLabel(await gu.getColumnHeader('B')).wait().sendKeys($.ENTER);
    await gu.waitForServer();
    await gu.waitAppFocus(true);
    await assert.isPresent(gu.getColumnHeader('B'), true);
  });

  it("should allow renaming columns", async function() {
    await gu.getColumnHeader('Name').scrollIntoView(colHeaderScrollOpts);
    await gu.clickColumnMenuItem('Name', 'Rename column');
    await gu.getOpenEditingLabel(await gu.getColumnHeader('Name')).sendKeys('Renamed', $.ENTER);
    await gu.waitForServer();
    await assert.isPresent(gu.getColumnHeader('Renamed'), true);
    assert.deepEqual(await gu.getGridValues({
      cols: ['Renamed'],
      rowNums: [3, 4, 5],
    }), ['A Coruña (La Coruña)', 'Aachen', 'Aalborg']);

    // Verify that undo/redo works with renaming
    await gu.undo();
    await assert.isPresent(gu.getColumnHeader('Name'), true);
    assert.deepEqual(await gu.getGridValues({
      cols: ['Name'],
      rowNums: [3, 4, 5],
    }), ['A Coruña (La Coruña)', 'Aachen', 'Aalborg']);
    await gu.redo();
    await assert.isPresent(gu.getColumnHeader('Renamed'), true);
    assert.deepEqual(await gu.getGridValues({
      cols: ['Renamed'],
      rowNums: [3, 4, 5],
    }), ['A Coruña (La Coruña)', 'Aachen', 'Aalborg']);

    // Refresh the page and check that the rename sticks.
    await driver.navigate().refresh();
    assert.equal(await $('.active_section .test-viewsection-title').wait().text(), 'CITY');
    await gu.waitForServer(5000);
    await gu.clickCellRC(1, 4);
    await assert.isPresent(gu.getColumnHeader('Renamed'), true);

    // Check that it is renamed in the sidepane
    await gu.openSidePane('field');
    assert.equal(await $(".test-field-label").val(), "Renamed");

    // Check that both the label and the Id are changed when label and Id are linked
    let deriveIdCheckbox = $(".test-field-derive-id");
    assert.isTrue(await deriveIdCheckbox.is('[class*=-selected]'));
    await deriveIdCheckbox.click();
    await gu.waitForServer();
    assert.isFalse(await deriveIdCheckbox.is('[class*=-selected]'));
    assert(await $(".test-field-col-id").val(), "Renamed");

    // Check that just the label is changed when label and Id are unlinked
    await gu.getColumnHeader('Renamed').scrollIntoView(colHeaderScrollOpts);
    await gu.clickColumnMenuItem('Renamed', 'Rename column');
    await gu.getOpenEditingLabel(await gu.getColumnHeader('Renamed')).wait().sendKeys('foo', $.ENTER);
    await gu.waitForServer();
    await assert.isPresent(gu.getColumnHeader('foo'), true);
    await assert.isPresent(gu.getOpenEditingLabel(gu.getColumnHeader('foo')), false);
    assert.equal(await $(".test-field-label").val(), "foo");
    assert(await $(".test-field-col-id").val(), "Renamed");

    // Saving an identical column label should still close the input.
    await gu.getColumnHeader('foo').scrollIntoView(colHeaderScrollOpts);
    await gu.clickColumnMenuItem('foo', 'Rename column');
    await gu.userActionsCollect(true);
    await gu.getOpenEditingLabel(await gu.getColumnHeader('foo')).wait().sendKeys('foo', $.ENTER);
    await gu.waitForServer();
    await gu.userActionsVerify([]);
    await gu.userActionsCollect(false);
    await assert.isPresent(gu.getOpenEditingLabel(gu.getColumnHeader('foo')), false);
    await gu.waitAppFocus(true);

    // Bug T384: Should save the column name after cancelling a rename earlier.
    await gu.getColumnHeader('A').scrollIntoView(colHeaderScrollOpts);
    await gu.clickColumnMenuItem('A', 'Rename column');
    await gu.getOpenEditingLabel(await gu.getColumnHeader('A')).wait().sendKeys('C', $.ESCAPE);
    await gu.waitForServer();
    await assert.isPresent(gu.getColumnHeader('A'), true);
    await gu.clickColumnMenuItem('A', 'Rename column');
    await gu.getOpenEditingLabel(await gu.getColumnHeader('A')).sendKeys('C', $.TAB);
    await gu.waitForServer();
    await assert.isPresent(gu.getColumnHeader('C'), true);
  });

  it("should allow renaming columns with a click", async function() {
    // Go to a non-target column first
    await gu.getColumnHeader('Population').scrollIntoView(colHeaderScrollOpts);
    await gu.getColumnHeader('Population').click();
    // Now select the column of interest
    await gu.getColumnHeader('foo').scrollIntoView(colHeaderScrollOpts);
    await gu.getColumnHeader('foo').click();
    // And click one more time to rename
    await gu.getColumnHeader('foo').click();
    await gu.getOpenEditingLabel(await gu.getColumnHeader('foo')).sendKeys('foot', $.ENTER);
    await gu.waitForServer();
    await assert.isPresent(gu.getColumnHeader('foo'), false);
    await assert.isPresent(gu.getColumnHeader('foot'), true);
    // Click to rename back again
    await gu.getColumnHeader('foot').click();
    await gu.getOpenEditingLabel(await gu.getColumnHeader('foot')).sendKeys('foo', $.ENTER);
    await gu.waitForServer();
    await assert.isPresent(gu.getColumnHeader('foo'), true);
    await assert.isPresent(gu.getColumnHeader('foot'), false);
  });

  it("should allow deleting multiple columns", async function() {
    await gu.actions.selectTabView('Country');

    // delete shortcut should delete all selected columns
    await gu.selectGridArea([1, 0], [1, 1]);
    await gu.sendKeys([$.ALT, '-']);
    await gu.waitForServer();
    assert.deepEqual(await gu.getGridLabels('Country'),
       ["Continent", "Region", "SurfaceArea", "IndepYear", "Population", "LifeExpectancy",
        "GNP", "GNPOld", "LocalName", "GovernmentForm", "HeadOfState", "Capital", "Code2"]);
    // Undo to restore changes
    await gu.undo(1, 5000);

    // delete menu item should delete all selected columns
    await gu.selectGridArea([1, 2], [1, 8]);
    await gu.clickColumnMenuItem('SurfaceArea', 'Delete', true);
    await gu.waitForServer();
    assert.deepEqual(await gu.getGridLabels('Country'),
       ["Code", "Name", "GNPOld", "LocalName", "GovernmentForm", "HeadOfState", "Capital", "Code2"]);
    // Undo to restore changes
    await gu.undo(1, 5000);

    // the delete shortcut should delete all columns in a cell selection as well
    await gu.clickCellRC(2, 5);
    await gu.sendKeys([$.SHIFT, $.RIGHT, $.RIGHT]);
    await gu.sendKeys([$.ALT, '-']);
    await gu.waitForServer();
    assert.deepEqual(await gu.getGridLabels('Country'),
       ["Code", "Name", "Continent", "Region", "SurfaceArea", "GNP", "GNPOld", "LocalName",
        "GovernmentForm", "HeadOfState", "Capital", "Code2"]);
    // Undo to restore changes
    await gu.undo(1, 5000);

    // Nudge first few columns back into view if they've drifted out of it.
    await gu.toggleSidePanel('right', 'close');
    await gu.sendKeys($.LEFT, $.LEFT, $.LEFT);

    // opening a column menu outside the selection should move the selection
    await gu.clickCellRC(2, 2);
    await gu.sendKeys([$.SHIFT, $.RIGHT]);
    await gu.clickColumnMenuItem('IndepYear', 'Delete', true);
    await gu.waitForServer();
    assert.deepEqual(await gu.getGridLabels('Country'),
       ["Code", "Name", "Continent", "Region", "SurfaceArea", "Population",
        "LifeExpectancy", "GNP", "GNPOld", "LocalName", "GovernmentForm", "HeadOfState",
        "Capital", "Code2"]);
    // Undo to restore changes
    await gu.undo();
  });

  it("should allow hiding multiple columns", async function() {
    await gu.actions.selectTabView('Country');
    await gu.openSidePane('view');

    // hide menu item should hide all selected columns
    await gu.selectGridArea([1, 2], [1, 8]);
    await gu.clickColumnMenuItem('SurfaceArea', 'Hide 7 columns', true);
    await gu.waitForServer();
    assert.deepEqual(await gu.getGridLabels('Country'),
       ["Code", "Name", "GNPOld", "LocalName", "GovernmentForm", "HeadOfState", "Capital", "Code2"]);
    assert.deepEqual(await $('.test-vfc-visible-fields .kf_draggable_content').array().text(),
      ["Code", "Name", "GNPOld", "LocalName", "GovernmentForm", "HeadOfState", "Capital", "Code2"]);
    assert.deepEqual(await $('.test-vfc-hidden-fields .kf_draggable_content').array().text(),
      ["Name", "Continent", "Region", "SurfaceArea", "IndepYear", "Population",
      "LifeExpectancy", "GNP", "Self"]);
    // Undo to restore changes
    await gu.undo(1, 5000);

    assert.deepEqual(await gu.getGridLabels('Country'),
       ["Code", "Name", "Continent", "Region", "SurfaceArea", "IndepYear", "Population",
        "LifeExpectancy", "GNP", "GNPOld", "LocalName", "GovernmentForm", "HeadOfState",
        "Capital", "Code2"]);

  });
});

function showColumn(name) {
  return $(`.test-new-columns-menu-hidden-column-inlined:contains(${name})`).click();
}
