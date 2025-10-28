import { assert, driver, Key } from 'mocha-webdriver';

import * as gu from 'test/nbrowser/gristUtils';
import { server, setupTestSuite } from "test/nbrowser/testUtils";

describe('SortPositions', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  before(async function() {
    await server.simulateLogin('Chimpy', 'chimpy@getgrist.com', 'nasa');
    await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon', 'CC_Statement.grist');
  });

  afterEach(() => gu.checkForErrors());

  async function dragRows(rowNumFirst: number, rowNumSecond: number, rowNumTo: number) {
    const rowHeaderFirst = await driver.findContent('.gridview_data_row_num', new RegExp(`^${rowNumFirst}$`));
    const rowHeaderSecond = await driver.findContent('.gridview_data_row_num', new RegExp(`^${rowNumSecond}$`));
    const rowHeaderTo = await driver.findContent('.gridview_data_row_num', new RegExp(`^${rowNumTo}$`));
    await driver.sendKeys(Key.ESCAPE);    // Ensure there is no row selection to begin with.
    await driver.withActions((actions) => actions
      .move({origin: rowHeaderFirst}).press()
      .move({origin: rowHeaderSecond}).release()
      .move({origin: rowHeaderFirst}).press()
      .move({origin: rowHeaderTo}).release()
    );
    await gu.waitForServer();
  }

  it('should allow rearranging rows in regular unsorted tables', async function() {
    // First check that we CAN rearrange rows in a regular table.
    // Check the contents of the first 5 rows
    assert.deepEqual(await gu.getVisibleGridCells({
      section: 'Sheet1 record', cols: [0, 1, 2], rowNums: [1, 2, 3, 4, 5]
    }), [
      '2015-01-12', 'Howard Washington', '-1745.53',
      '2015-01-17', 'Howard Washington', '382.06',
      '2015-01-20', 'Nyssa O\'Neil', '4011',
      '2015-01-21', 'Howard Washington', '77.3',
      '2015-01-31', 'Howard Washington', '-19.02',
    ]);

    // Drag row 2 to below row 4 by pressing mouse on the header of row 2, and dragging to row 4.
    await dragRows(2, 2, 4);

    // Check the updated contents of first 5 rows.
    assert.deepEqual(await gu.getVisibleGridCells({cols: [0, 1, 2], rowNums: [1, 2, 3, 4, 5]}), [
      '2015-01-12', 'Howard Washington', '-1745.53',
      '2015-01-20', 'Nyssa O\'Neil', '4011',
      '2015-01-21', 'Howard Washington', '77.3',
      '2015-01-17', 'Howard Washington', '382.06',
      '2015-01-31', 'Howard Washington', '-19.02',
    ]);
    // Check that the row that got moved (now row 4) is now selected.
    assert.deepEqual(await driver.findAll('.active_section .gridview_data_row_num.selected',
      el => el.getText()), ["4"]);

    // Now move rows 4-5 to just before row 2.
    await dragRows(4, 5, 2);

    assert.deepEqual(await gu.getVisibleGridCells({cols: [0, 1, 2], rowNums: [1, 2, 3, 4, 5]}), [
      '2015-01-12', 'Howard Washington', '-1745.53',
      '2015-01-17', 'Howard Washington', '382.06',
      '2015-01-31', 'Howard Washington', '-19.02',
      '2015-01-20', 'Nyssa O\'Neil', '4011',
      '2015-01-21', 'Howard Washington', '77.3',
    ]);
    assert.deepEqual(await driver.findAll('.active_section .gridview_data_row_num.selected',
      el => el.getText()), ["2", "3"]);
  });

  it('should allow updating sort positions in regular sorted tables', async function() {
    // TODO column options look weird if a multi-column range is initially selected.
    await gu.getCell({col: 'Date', rowNum: 1}).click();

    // Sort by date, and check that Update Data button is shown.
    await gu.openColumnMenu('Date', 'sort-asc');
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-pagewidget').click();
    await driver.find('.test-config-sortAndFilter').click();

    assert.deepEqual(await driver.findAll(".test-sort-config-column", el => el.getText()),
      ['Date']);
    assert.equal(await driver.find(".test-sort-config-update").isDisplayed(), true);

    // Click Update Data, and check position of first 5 rows.
    await gu.updateRowsBySort();

    // We are back to having no sort columns, but data is ordered by date.
    assert.deepEqual(await driver.findAll(".test-sort-config-column", el => el.getText()), []);
    assert.deepEqual(await gu.getVisibleGridCells({cols: [0, 1, 2], rowNums: [1, 2, 3, 4, 5]}), [
      '2015-01-12', 'Howard Washington', '-1745.53',
      '2015-01-17', 'Howard Washington', '382.06',
      '2015-01-20', 'Nyssa O\'Neil', '4011',
      '2015-01-21', 'Howard Washington', '77.3',
      '2015-01-31', 'Howard Washington', '-19.02',
    ]);
  });

  it('should not allow rearranging rows in unsorted summary tables', async function() {
    // Add a summary table.
    await gu.addNewSection(/Table/, /Sheet1/, {summarize: [/Card_Member/]});

    // Check the first few cells.
    assert.deepEqual(await gu.getVisibleGridCells({cols: [0, 1], rowNums: [1, 2, 3]}
    ), [
      'Howard Washington', '58',
      'Nyssa O\'Neil', '14',
      'Callum Wilson', '12',
    ]);

    // Summary tables don't include a manualSort column and don't support rearranging rows.
    // Try to drag row 2 to row 3, but it should only select the rows.
    const section = await gu.getSection('SHEET1 (RAW) [by Card_Member]');
    const row2Header = await section.findContent('.gridview_data_row_num', /^2$/);
    const row3Header = await section.findContent('.gridview_data_row_num', /^3$/);
    await row2Header.click();
    await driver.withActions((actions) => actions
      .move({origin: row2Header}).press()
      .move({origin: row3Header}).release()
    );
    await gu.waitForServer();

    // There should be no errors.
    await gu.checkForErrors();

    // The rows haven't changed.
    assert.deepEqual(await gu.getVisibleGridCells({cols: [0, 1], rowNums: [1, 2, 3]}), [
      'Howard Washington', '58',
      'Nyssa O\'Neil', '14',
      'Callum Wilson', '12',
    ]);
  });

  it('should not allow updating sort positions in sorted summary tables', async function() {
    // Summary tables don't include a manualSort column and should not show "Update Data" button.

    // Sort by a column.
    await gu.getCell({col: 'Card_Member', rowNum: 1}).click();
    await gu.openColumnMenu('Card_Member', 'sort-asc');
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-pagewidget').click();
    await driver.find('.test-config-sortAndFilter').click();

    // Check that "Update Data" button is not shown.
    assert.deepEqual(await driver.findAll(".test-sort-config-column", el => el.getText()),
      ['Card_Member']);
    assert.equal(await driver.find(".test-sort-config-update").isDisplayed(), false);
  });

  describe('Dragging', function() {
    let mainSession: gu.Session;
    let docId: string;

    before(async function() {
      mainSession = await gu.session().teamSite.user('user1').login();
      docId = await mainSession.tempNewDoc(cleanup, 'SortPositions.grist', {load: false});
      const api = mainSession.createHomeApi();
      await api.applyUserActions(docId, [
        ['BulkAddRecord', 'Table1', [1, 2, 3, 4], {'A': ['a', 'b', 'c', 'd']}],
      ]);
    });

    it('should keep working when manualSort values get too close to each other', async function() {
      // After much rearranging, manualSort values can get so very close to each other. The data
      // engine then spreads them out automatically. This test checks that the frontend lets it
      // happen (a bug was causing it to send incorrect values in this situation).

      // Create a situation with close manualSort values: first two are so close that the average
      // of A and B is equal to A (because of imprecision of floats).
      await mainSession.createHomeApi().applyUserActions(docId, [
        ['ApplyDocActions', [
          ['BulkUpdateRecord', 'Table1', [1, 2], {manualSort: [0.006602524127749098, 0.006602524127749099]}],
        ]]
      ]);
      await mainSession.loadDoc(`/doc/${docId}`);

      // Check that the initial data is as we set it up.
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0], rowNums: [1, 2, 3, 4]}),
        ['a', 'b', 'c', 'd']);

      // Drag row 3 ('c') to between 1 ('a') and 2 ('b').
      await dragRows(3, 3, 2);

      // Check that it worked.
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0], rowNums: [1, 2, 3, 4]}),
        ['a', 'c', 'b', 'd']);

      // Check that the repositioned row is the one selected
      assert.deepEqual(await driver.findAll('.active_section .gridview_data_row_num.selected',
        el => el.getText()), ["2"]);
    });

    it('should keep rearranged rows next to its neighbor even in the presence of filters', async function() {
      // When data is filtered, dragging a row should place it immediately before its following
      // neighbor; it should stick there even when the filter is removed.

      // Set regular old manualSort values.
      await mainSession.createHomeApi().applyUserActions(docId, [
        ['ApplyDocActions', [
          ['BulkUpdateRecord', 'Table1', [1, 2, 3, 4], {manualSort: [1, 2, 3, 4]}],
        ]]
      ]);
      await mainSession.loadDoc(`/doc/${docId}`);

      await gu.openColumnMenu('A', 'Filter');
      assert.deepEqual(await driver.findAll('.test-filter-menu-list .test-filter-menu-value', e => e.getText()),
        ['a', 'b', 'c', 'd']);
      await driver.findContent('.test-filter-menu-list .test-filter-menu-value', /a/).click();
      await driver.findContent('.test-filter-menu-list .test-filter-menu-value', /b/).click();
      await driver.find('.test-filter-menu-apply-btn').click();

      // Check that the data is filtered
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0], rowNums: [1, 2, 3]}), ['c', 'd', '']);

      // Drag 'd' to before 'c'
      await dragRows(2, 2, 1);

      assert.deepEqual(await gu.getVisibleGridCells({cols: [0], rowNums: [1, 2, 3]}), ['d', 'c', '']);

      // Reset the filters.
      await driver.find('.test-section-menu-small-btn-revert').click();

      // Check that 'd' is still immediately before 'c'.
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0], rowNums: [1, 2, 3, 4]}), ['a', 'b', 'd', 'c']);
    });
  });

  describe('OrderBug', function() {
    it('should update sort correctly after some noncontiguous updates', async function() {
      // Tests the fix of a bug that could prevent the rows in a sorted view from re-sorting
      // correctly.
      const mainSession = await gu.session().teamSite.user('user1').login();
      const docId = await mainSession.tempNewDoc(cleanup, 'SortPositions_Bug.grist', {load: false});
      const api = mainSession.createHomeApi();
      await api.applyUserActions(docId, [
        ['BulkAddRecord', 'Table1', [1, 2, 3], {'A': [10, 30, 20]}]
      ]);

      await mainSession.loadDoc(`/doc/${docId}`);

      // Sort by column A: it now show rowIds 1, 3, 2.
      await gu.openColumnMenu('A', 'sort-asc');
      assert.deepEqual(await gu.getVisibleGridCells({cols: ['A'], rowNums: [1, 2, 3]}), ['10', '20', '30']);

      // Update rows 1 and 2 (first and last) in a way that keeps the newly-first row (2) in the
      // right place relative to its neighbor.
      await api.applyUserActions(docId, [
        ['BulkUpdateRecord', 'Table1', [1, 2], {'A': [25, 24]}]
      ]);

      await gu.waitToPass(async () =>
        assert.deepEqual(await gu.getVisibleGridCells({cols: ['A'], rowNums: [1, 2, 3]}), ['20', '24', '25']));
    });
  });
});
