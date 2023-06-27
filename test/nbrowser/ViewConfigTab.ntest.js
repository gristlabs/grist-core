import { assert } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('ViewConfigTab.ntest', function() {
  test.setupTestSuite(this);

  before(async function() {
    await gu.supportOldTimeyTestCode();

    await gu.actions.createNewDoc();
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it('should set up a new Untitled document with one table', async function() {
    // Add another table to the document: click dropdown, select "New Table".
    assert.deepEqual(await $(`.test-docpage-label`).array().text(), ['Table1']);
    await gu.actions.addNewTable();
    assert.deepEqual(await $(`.test-docpage-label`).array().text(), ['Table1', 'Table2']);
  });

  it("should allow opening and closing view config pane", async function() {
    var viewNameInput = $('.test-right-widget-title');

    // Open the tab, and check it becomes visible.
    await gu.openSidePane('view');
    await assert.isDisplayed(viewNameInput.wait(assert.isDisplayed), true);

    // Close the tab again.
    await gu.toggleSidePanel('right', 'toggle');
    await assert.isPresent(viewNameInput, false);
  });

  it('should keep view config pane open across views, with correct view name', async function() {
    await gu.openSidePane('view');

    var viewNameInput = $('.test-right-widget-title');
    await assert.isDisplayed(viewNameInput.wait(assert.isDisplayed), true);
    assert.equal(await viewNameInput.val(), 'TABLE2');

    // Switch to another view, and make sure the view config side pane is still visible.
    await gu.actions.selectTabView('Table1');
    await assert.isDisplayed(viewNameInput);
    assert.equal(await viewNameInput.val(), 'TABLE1');

    // Switch to a third view.
    await gu.actions.selectTabView('Table2');
    await assert.isDisplayed(viewNameInput);
    assert.equal(await viewNameInput.val(), 'TABLE2');
  });

  it('should allow renaming the view from view config pane', async function() {
    await gu.actions.selectTabView('Table2');

    // Select the view name text box, select the text and replace with "Hello".
    var viewNameInput = $('.test-right-widget-title');
    await gu.renameTable('Table2', 'Hello');  // I think renaming happens differently now?

    // Make sure there is now a view in Table named "Hello"
    let tabs = await $(`.test-docpage-label`).array().text();
    assert.deepEqual(tabs, [ 'Table1', 'Hello' ]);

    // Switch to another view, and back to Hello, and see that the view name textbox is correct.
    await gu.actions.selectTabView('Table1');
    assert.equal(await viewNameInput.val(), 'TABLE1');
    await gu.actions.selectTabView('Hello');
    assert.equal(await viewNameInput.val(), 'HELLO');
  });
});
