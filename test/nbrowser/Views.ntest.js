import { assert } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('Views.ntest', function() {
  test.setupTestSuite(this);

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.actions.createNewDoc();
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it('should allow adding and removing viewsections', async function() {
    // Create two new viewsections
    await gu.actions.addNewSection('Table1', 'Table');
    var recordSection = $('.test-gristdoc .view_leaf').eq(0);
    var gridSection = $('.test-gristdoc .view_leaf').eq(1);

    // Check that the newest viewsection has focus
    await assert.hasClass(gridSection, 'active_section');

    await gu.actions.addNewSection('Table1', 'Card');
    var cardSection = $('.test-gristdoc .view_leaf').eq(2);
    assert.lengthOf(await $('.test-gristdoc .view_leaf').array(), 3);

    // Check that the newest viewsection has focus
    await assert.hasClass(cardSection, 'active_section');

    // Click the second viewsection and check that it has focus
    await gridSection.click();
    await assert.hasClass(gridSection, 'active_section');

    // Check that viewsection titles are correct and editable
    var recordTitle = recordSection.find('.test-viewsection-title');
    assert.equal(await recordTitle.text(), 'TABLE1');
    await recordTitle.click();
    await gu.renameActiveSection('foo');
    assert.equal(await recordTitle.text(), 'foo');

    // Delete the first viewsection and check that it`s gone
    await gu.actions.viewSection('foo').selectMenuOption('viewLayout', 'Delete widget');
    await gu.waitForServer();

    assert.lengthOf(await $('.test-gristdoc .view_leaf').array(), 2);
  });

  it('should allow creating a view section for a new table', async function() {
    assert.lengthOf(await $('.test-gristdoc .view_leaf').array(), 2);
    await gu.actions.addNewSection('New', 'Card List');
    var newTitle = $('.test-gristdoc .test-viewsection-title').eq(2).wait();
    assert.equal(await newTitle.text(), 'TABLE2 Card List');
  });

  it('should not create two views when creating a new view for a new table', async function() {
    // This is probably test for a bug. Currently adding new tables to an existing view
    // doesn't produce new views.
    assert.deepEqual(await $(`.test-docpage-label`).array().text(), ['Table1']);
    await gu.actions.addNewView('New', 'Table');
    assert.deepEqual(await $(`.test-docpage-label`).array().text(), ['Table1', 'Table3']);
  });

  it('should switch to a valid default view when the active view is deleted', async function() {
    // This confirms a bug fix where the default view should change when the current
    // default view is deleted
    await gu.actions.selectTabView('Table1');
    assert.equal(await gu.actions.getActiveTab().text(), 'Table1');
    assert.deepEqual(await $(`.test-docpage-label`).array().text(), ['Table1', 'Table3']);
    await gu.actions.tableView('Table1').selectOption('Remove');
    await $(".test-option-page").click();
    await $(".test-modal-confirm").click();
    await gu.waitForServer();
    assert.equal(await gu.actions.getActiveTab().text(), 'Table3');
    assert.deepEqual(await $(`.test-docpage-label`).array().text(), ['Table3']);
  });

  it('should allow adding and removing summary view sections', async function() {
    await gu.removeTable("Table1");
    await gu.actions.addNewTable();
    assert.equal(await gu.actions.getActiveTab().text(), 'Table1');

    await gu.enterGridValues(0, 0, [
      ['a', 'a', 'b'],
      ['c', 'd', 'd'],
      ['1', '2', '3']
    ]);

    await gu.actions.addNewSummarySection('Table1', ['A'], 'Table', 'Section Foo');
    assert.deepEqual(await gu.getGridValues({
      section: 'Section Foo',
      rowNums: [1, 2],
      cols: [0, 1, 2]
    }), ['a', '2', '3', 'b', '1', '3']);

    await gu.actions.viewSection('Section Foo').selectMenuOption('viewLayout', 'Delete widget');
    await gu.waitForServer();

    await gu.actions.addNewSummarySection('Table1', ['B'], 'Table', 'Section Foo');
    assert.deepEqual(await gu.getGridValues({
      section: 'Section Foo',
      rowNums: [1, 2],
      cols: [0, 1, 2]
    }), ['c', '1', '1', 'd', '2', '5']);
  });

  it('should switch to a valid default section when the active section is deleted', async function() {
    // This confirms a bug fix where the section should change when the active section is
    // deleted, either directly or via the section's table being deleted.
    // Reference: https://phab.getgrist.com/T327
    await gu.actions.addNewSection('New', 'Table');
    await gu.waitForServer();
    await gu.actions.viewSection('TABLE4').selectSection();
    // Delete the section
    await gu.actions.viewSection('TABLE4').selectMenuOption('viewLayout', 'Delete widget');
    await gu.waitForServer();
    // Assert that the default section (Table1 record) is now active.
    assert.equal(await $('.active_section > .viewsection_title').text(), 'TABLE1');
    // Assert that focus is returned to the deleted section on undo.
    await gu.undo();
    assert.equal(await $('.active_section > .viewsection_title').text(), 'TABLE4');
    // Add a sorted column to the new table. The reported bug shows a symptom of the problem is
    // errors thrown when a sorted column exists in the deleted table.
    await gu.clickCellRC(0, 0);
    await gu.sendKeys('b', $.ENTER);
    await gu.waitForServer();
    await gu.sendKeys('a', $.ENTER);
    await gu.waitForServer();
    await gu.sendKeys('c', $.ENTER);
    await gu.waitForServer();
    await gu.openColumnMenu('A');
    await $(`.grist-floating-menu .test-sort-asc`).click();
    // Delete the table.
    await gu.sendActions([['RemoveTable', 'Table4']]);
    await gu.actions.selectTabView('Table1');
    // Assert that the default section (Table1 record) is now active.
    assert.equal(await $('.active_section > .viewsection_title').text(), 'TABLE1');
    // Again, assert that focus is returned to the deleted section on undo.
    await gu.undo();
    assert.equal(await $('.active_section > .viewsection_title').text(), 'TABLE4');
  });
});
