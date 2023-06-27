/**
 * This test suite is partially duplicated as `test/nbrowser/Summaries.ts`.
 */

import { assert } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('Summaries.ntest', function() {
  const cleanup = test.setupTestSuite(this);

  gu.bigScreen();

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "CC_Summaries.grist", true);
    await gu.toggleSidePanel('left', 'open');
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it('should contain two summary tables', async function() {
    // Switch to Summaries view.
    await gu.actions.selectTabView('Summaries');
    await gu.getVisibleGridCells(0, [1]);

    // Check a few numbers from 'By Category' section.
    assert.deepEqual(await gu.getGridValues({section: 'By Category', rowNums: [2, 10], cols: [0, 2]}),
      [ 'Business Services-Mailing & Shipping',      '341.84',
        'Merchandise & Supplies-Internet Purchase',  '1023.47' ]);

    // Check a few numbers from 'Credit/Debit By Category' section.
    assert.deepEqual(await gu.getGridValues({section: 'Credit/Debit By Category', rowNums: [3, 9],
                                             cols: [1, 3]}),
      [ 'Fees & Adjustments-Fees & Adjustments', '-472.03',
        'Business Services-Office Supplies',     '526.45' ]);
    assert.deepEqual(await gu.getGridValues({section: 'Credit/Debit By Category', rowNums: [3, 9],
                                             cols: [0], mapper: e => e.find('.widget_checkmark').getCssValue('display') }),
                     [ 'block',
                       'none' ]);
  });


  it('should allow updating summary group-by columns', async function() {
    // Open side-pane.
    await gu.openSidePane('view');
    await $('.test-config-data').click();
    await gu.actions.viewSection('By Category').selectSection();

    // Check some values in the data.
    assert.deepEqual(await gu.getGridValues({rowNums: [2, 12], cols: [0, 1, 2]}),
      [ 'Business Services-Mailing & Shipping', '6', '341.84',
        'Merchandise & Supplies-Pharmacies',    '4', '42.19' ]);

    // Verify that multiselect only shows "Category".
    assert.deepEqual(await $('.test-pwc-groupedBy-col').array().text(), ["Category"]);

    // Add another field, "Date".
    await $('.test-pwc-editDataSelection').click();
    await $(`.test-wselect-column:contains(Date)`).click();

    // Cancel, and verify contents of multiselect.
    await gu.sendKeys($.ESCAPE);
    assert.deepEqual(await $('.test-pwc-groupedBy-col').array().text(), ["Category"]);

    // Add another field, "Date", again.
    await $('.test-pwc-editDataSelection').click();
    await $(`.test-wselect-column:contains(Date)`).click();

    // Save, and verify contents of multiselect.
    await $('.test-wselect-addBtn').click();
    await gu.waitForServer();

    // Verify contents of multiselect.
    assert.deepEqual(await $('.test-pwc-groupedBy-col').array().text(), ["Date", "Category"]);

    // Wait for data to load, and verify the data.
    assert.deepEqual(await gu.getGridValues({rowNums: [2, 12], cols: [0, 1, 2, 3]}),
      [ '2015-02-12', '',                                     '1', '-4462.48',
        '2015-02-13', 'Business Services-Mailing & Shipping', '1', '147.00' ]);

    // Remove both "Date" and "Category", and save.
    await $('.test-pwc-editDataSelection').click();
    await $('.test-wselect-column[class*=-selected]:contains(Date)').click();
    await $('.test-wselect-column[class*=-selected]:contains(Category)').click();
    await $('.test-wselect-addBtn').click();
    await gu.waitForServer();

    // Verify contents of multiselect.
    assert.deepEqual(await $('.test-pwc-groupedBy-col').array().text(), []);

    // Wait for data to load, and verify the data (a single line of totals).
    assert.deepEqual(await gu.getGridValues({rowNums: [1], cols: [0, 1]}),
      ['208', '3540.60']);

    // Undo, and verify contents of multiselect.
    await gu.undo();
    assert.deepEqual(await $('.test-pwc-groupedBy-col').array().text(), ["Date", "Category"]);

    // Undo, and verify contents of multiselect.
    await gu.undo();
    assert.deepEqual(await $('.test-pwc-groupedBy-col').array().text(), ["Category"]);

    // Verify that contents is what we started with.
    assert.deepEqual(await gu.getGridValues({rowNums: [2, 12], cols: [0, 1, 2]}),
      [ 'Business Services-Mailing & Shipping', '6', '341.84',
        'Merchandise & Supplies-Pharmacies',    '4', '42.19' ]);
  });

  // This test has been migrated to `test/nbrowser/Summaries.ts`
  it('should allow detaching a summary table', async function() {
    // Detach a summary section, make sure it shows correct data, and has live formulas, but
    // doesn't auto-add rows. Then undo and make sure we go back to a summary table.

    await gu.actions.viewSection('By Category').selectSection();
    assert.deepEqual(await gu.actions.getTabs().array().text(), ['Summaries', 'Sheet1']);

    await $('.test-detach-button').click()
    await gu.waitForServer();
    await assert.equal(await $(".test-pwc-groupedBy").isDisplayed(), false);

    // Verify that the title of the section has changed.
    assert.equal(await $('.active_section .test-viewsection-title').parent().text(),
      'By Category');
    assert.deepEqual(await gu.actions.getTabs().array().text(), ['Summaries', 'Sheet1', 'Table1']);

    // Verify that contents of the section.
    assert.deepEqual(await gu.getGridValues({rowNums: [2, 12], cols: [0, 1, 2]}),
      [ 'Business Services-Mailing & Shipping', '6', '341.84',
        'Merchandise & Supplies-Pharmacies',    '4', '42.19' ]);

    // See what the last row number is.
    await gu.sendKeys([$.MOD, $.DOWN]);
    assert.equal(await $('.active_section .gridview_data_row_num').last().text(), '19');

    // Change a category in Transactions; it should affect formulas in existing rows of the
    // detached table, but should not produce new rows.
    await gu.clickCell({rowNum: 9, col: 2, section: 'Transactions'});
    await gu.sendKeys('Hello', $.ENTER);
    await gu.waitForServer();

    // Check that number of rows is unchanged, but that formulas got updated in the affected row.
    await gu.actions.viewSection('By Category').selectSection();
    assert.equal(await $('.active_section .gridview_data_row_num').last().text(), '19');
    await gu.sendKeys([$.MOD, $.UP]);
    assert.deepEqual(await gu.getGridValues({rowNums: [2, 12], cols: [0, 1, 2]}),
      [ 'Business Services-Mailing & Shipping', '5', '194.84',
        'Merchandise & Supplies-Pharmacies',    '4', '42.19' ]);

    // Undo everything. Make sure we have our summary table back.
    await gu.undo(3);
    assert.equal(await $('.active_section .test-viewsection-title').parent().text(),
      'By Category');
    assert.deepEqual(await $('.test-pwc-groupedBy-col').array().text(), ["Category"]);
    assert.deepEqual(await gu.actions.getTabs().array().text(), ['Summaries', 'Sheet1']);
  });


  it('should allow adding summaries by date', async function() {
    // Add Summary table by Date column.
    await gu.actions.viewSection('By Category').selectSection();
    await gu.actions.addNewSummarySection('Sheet1', ['Date', 'Category'], 'Table', 'By Date/Category');

    // Check a couple of values.
    await gu.actions.viewSection('By Date/Category').selectSection();
    await gu.sendKeys([$.MOD, $.DOWN]);  // Go to the end.
    assert.deepEqual(await gu.getGridValues({section: 'By Date/Category', rowNums:[151], cols:[0, 1, 3]}),
      [ '2015-12-04', 'Travel-Lodging', '3021.54' ]);
  });


  it('should update summary values when values change', async function() {
    // Change a value in Transactions, and check that numbers changed.
    await gu.actions.viewSection('Transactions').selectSection();
    await gu.getCell(1, 9).click();
    await gu.waitAppFocus();
    await gu.sendKeys('947.00', $.ENTER);     // Change 147.00 -> 947.00
    assert.equal(await gu.getCell(1, 9).text(), '947.00');
    await gu.sendKeys([$.MOD, $.DOWN], $.UP); // Go to the last row (but not the "add row").
    await gu.sendKeys('677.40', $.ENTER);     // Change 177.40 -> 677.40
    await gu.waitForServer();

    // Check changes in the two affected sections.
    assert.deepEqual(await gu.getGridValues({section: 'By Category', rowNums: [2, 10], cols: [0, 2]}),
      [ 'Business Services-Mailing & Shipping',      '1141.84',       // <--- this changes
        'Merchandise & Supplies-Internet Purchase',  '1023.47' ]);
    assert.deepEqual(await gu.getGridValues({section: 'By Date/Category', rowNums:[151], cols:[0, 1, 3]}),
      [ '2015-12-04', 'Travel-Lodging', '3521.54' ]);

    // Undo both changes, and check that summarized values got restored.
    await $(".test-undo").click();
    await $(".test-undo").click();
    await gu.waitForServer();

    assert.deepEqual(await gu.getGridValues({section: 'By Category', rowNums: [2, 10], cols: [0, 2]}),
      [ 'Business Services-Mailing & Shipping',      '341.84',
        'Merchandise & Supplies-Internet Purchase',  '1023.47' ]);
    assert.deepEqual(await gu.getGridValues({section: 'By Date/Category', rowNums:[151], cols:[0, 1, 3]}),
      [ '2015-12-04', 'Travel-Lodging', '3021.54' ]);
  });


  it('should update summary values when key columns change', async function() {
    // Change a category in Transactions, and check that numbers changed.
    await gu.actions.viewSection('Transactions').selectSection();
    await gu.sendKeys([$.MOD, $.DOWN]);  // Go to the end.
    await gu.getCell(2, 208).click();
    await gu.waitAppFocus();
    await gu.sendKeys('Merchandise & Supplies-Internet Purchase', $.ENTER);
    assert.equal(await gu.getCell(2, 208).text(), 'Merchandise & Supplies-Internet Purchase');
    await gu.waitForServer();

    // Check that numbers changed in two affected summary tables.
    assert.deepEqual(await gu.getGridValues({section: 'By Category', rowNums: [2, 10], cols: [0, 2]}),
      [ 'Business Services-Mailing & Shipping',      '341.84',
        'Merchandise & Supplies-Internet Purchase',  '1200.87' ]);              // Up by 177.40
    assert.deepEqual(await gu.getGridValues({section: 'By Date/Category',
                                       rowNums:[151, 152], cols:[0, 1, 3]}),
      [ '2015-12-04', 'Travel-Lodging',                          '2844.14',    // Down by 177.40
        '2015-12-04', 'Merchandise & Supplies-Internet Purchase', '177.40' ]);  // New row

    // Undo and check that summarized values got restored.
    await $(".test-undo").click();
    await gu.waitForServer();

    assert.deepEqual(await gu.getGridValues({section: 'By Category', rowNums: [2, 10], cols: [0, 2]}),
      [ 'Business Services-Mailing & Shipping',      '341.84',
        'Merchandise & Supplies-Internet Purchase',  '1023.47' ]);
    assert.deepEqual(await gu.getGridValues({section: 'By Date/Category', rowNums:[151], cols:[0, 1, 3]}),
      [ '2015-12-04', 'Travel-Lodging', '3021.54' ]);

    // Check that the newly-added row is gone.
    await gu.actions.viewSection('By Date/Category').selectSection();
    await assert.equal(await gu.getGridLastRowText(), '151');
  });


  it('should update summary values when records get added', async function() {
    // Add a record.
    await gu.actions.viewSection('Transactions').selectSection();
    await gu.addRecord(['2016-01-01', '100', 'Business Services-Office Supplies']);
    await gu.waitForServer();
    assert.equal(await gu.getGridLastRowText(), '210');
    assert.deepEqual(await gu.getGridValues({cols: [0, 1, 2], rowNums: [209]}),
     ['2016-01-01', '100.00', 'Business Services-Office Supplies']);

    // Check that numbers have changed.
    assert.deepEqual(await gu.getGridValues({section: 'Credit/Debit By Category', rowNums: [2, 3, 9],
      cols: [1, 3]}),
      [ 'Business Services-Office Supplies',    '-4.56',      // <-- no change
        'Fees & Adjustments-Fees & Adjustments', '-472.03',
        'Business Services-Office Supplies',     '626.45' ]);  // <-- does change
    assert.deepEqual(await gu.getGridValues({section: 'Credit/Debit By Category', rowNums: [2, 3, 9],
                                             cols: [0], mapper: e => e.find('.widget_checkmark').getCssValue('display')}),
                     [ 'block',
                       'block',
                       'none']);  // <-- does change

    // Go to last data record.
    await gu.sendKeys([$.MOD, $.UP]);
    await gu.sendKeys([$.MOD, $.DOWN]);
    await gu.sendKeys([$.UP]);

    // Delete the new record, and check that values are the same as before.
    await gu.sendKeys([$.MOD, $.DELETE]);

    await gu.confirm(true, true); // confirm and remember.
    await gu.waitForServer();

    assert.deepEqual(await gu.getGridValues({section: 'Credit/Debit By Category', rowNums: [2, 3, 9],
      cols: [1, 3]}),
      [ 'Business Services-Office Supplies',    '-4.56',
        'Fees & Adjustments-Fees & Adjustments', '-472.03',
        'Business Services-Office Supplies',     '526.45' ]);
    assert.deepEqual(await gu.getGridValues({section: 'Credit/Debit By Category', rowNums: [2, 3, 9],
                                             cols: [0], mapper: e => e.find('.widget_checkmark').getCssValue('display')}),
      [ 'block',
        'block',
        'none' ]);
  });
});
