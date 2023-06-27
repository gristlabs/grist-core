import { assert } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('SortEditSave.ntest', function() {
  const cleanup = test.setupTestSuite(this);

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "Hello.grist", true);
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it('should not jump to next row when an updated field jumps in a sorted section', async function() {
    // Enter numbers and sort by them
    await gu.enterGridValues(0, 1, [['1', '2', '3', '4']]);
    await gu.clickCellRC(0, 1);
    await gu.setType('Numeric');
    await $('.test-type-transform-apply').click();
    await gu.openColumnMenu('B');
    await $('.grist-floating-menu .test-sort-asc').click();

    // Edit one of the numbers so that it doesn't get re-sorted. Assert that the cursor
    // moves down one cell
    await gu.clickCellRC(1, 1);
    await gu.sendKeys("2.5", $.ENTER);
    await gu.waitForServer();
    assert.equal(await $('.field_clip.has_cursor').text(), "3");

    // Edit one of the numbers so that it gets re-sorted. Assert that the cursor stays
    // on the cell
    await gu.clickCellRC(1, 1);
    await gu.sendKeys("3.5", $.ENTER);
    await gu.waitForServer();
    assert.equal(await $('.field_clip.has_cursor').text(), "3.5");
  });

  it('should not jump to next row when a formula update causes the field to jump', async function() {
    // Enter a formula in the next column, and sort by the column
    await gu.clickCellRC(0, 2);
    await gu.sendKeys("=");
    await $('.test-editor-tooltip-convert').click();      // Convert to a formula
    await gu.sendKeys("$B", $.ENTER);
    await gu.openColumnMenu('C');
    await $('.grist-floating-menu .test-sort-asc').click();

    // Edit the formula so that the row stays in the same place. Assert that the cursor
    // does NOT move down (since editing a column-wide formula, not doing data entry).
    await gu.clickCellRC(0, 2);
    await gu.sendKeys($.ENTER, [$.MOD, 'a'], "$B+5", $.ENTER);
    await gu.waitForServer();
    assert.equal(await $('.field_clip.has_cursor').text(), "6");

    // Edit the formula so that the row moves. Assert that the cursor says on the cell
    // in this case too.
    await gu.clickCellRC(0, 2);
    await gu.sendKeys($.ENTER, [$.MOD, 'a'], "10-$B", $.ENTER);
    await gu.waitForServer();
    assert.equal(await $('.field_clip.has_cursor').text(), "9");
  });
});
