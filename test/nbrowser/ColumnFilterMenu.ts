import { UserAPI } from 'app/common/UserAPI';
import { addToRepl, assert, driver, Key } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';

const limitShown = 500;

// Sum all of the counts directly on the browser using `driver.executeScript(...)`. There could me
// over 500 of them and using the classic driver.findAll(...) approach makes it too slow and causes
// the test to crash (timeout).
function getCount() {
  return driver.executeScript(`
  return Array.from(document.querySelectorAll('.test-filter-menu-count'), e => e.innerText)
    .map(s => s.split(',').join(''))
    .map(Number)
    .reduce((acc, v) => acc + v, 0);
`);
}

// find a filter value by name
function findByName(regex: RegExp | string) {
  return driver.findContent('.test-filter-menu-list label', regex);
}

describe('ColumnFilterMenu', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  addToRepl('findByName', findByName);
  let doc: any;
  let api: UserAPI;

  it('should handle empty lists consistently', async function() {
    // A formula returning an empty RecordSet in a RefList columns results in storing [] instead of null.
    // This previously caused a bug where the empty list was 'flattened' and the cell not appearing in filters at all.
    const session = await gu.session().teamSite.login();
    const api = session.createHomeApi();
    const docId = await session.tempNewDoc(cleanup, 'FilterEmptyLists', {load: false});

    await api.applyUserActions(docId, [
      ['AddTable', 'Table2', [
        {
          id: 'A', type: 'RefList:Table2', isFormula: true,
          // This means that the first cell will contain [] while the second will contain null.
          // The test asserts that both end up being treated the same.
          formula: 'if $id == 1: return table.lookupRecords(B="foobar")'
        },
        {id: 'B'},
      ]],
      ['BulkAddRecord', 'Table2', [null, null], {B: [1, 2]}],
    ]);

    await session.loadDoc(`/doc/${docId}/p/2`);

    await gu.rightClick(gu.getCell({rowNum: 1, col: 'A'}));
    await driver.findContent('.grist-floating-menu li', 'Filter by this value').click();

    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['A', 'B'], rowNums: [1, 2, 3]}),
      [
        '', '1',
        '', '2',
        '', ''
      ]
    );

    await gu.openColumnMenu('A', 'Filter');

    assert.deepEqual(
      await driver.findAll('.test-filter-menu-list .test-filter-menu-count', (e) => e.getText()),
      ['2'],
    );
  });

  it('should show only first 500', async function() {
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, 'World.grist');

    // check row count is > 4000
    const total = await gu.getGridRowCount() - 1;
    assert.equal(total, 4079);

    // scroll back to top
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.UP));

    // open filter menu for first column
    await gu.openColumnMenu('Name', 'Filter');

    // check ther are 500 entry shown
    assert.lengthOf(await driver.findAll('.test-filter-menu-list label'), limitShown);

    // check `Other` summary is present
    assert.deepEqual(
      await driver.findAll('.test-filter-menu-summary', (e) => e.find('label').getText()),
      ['Other Values (3,501)', 'Future Values']
    );

    // check counts add up
    assert.equal(await getCount(), total);

    // type 'A' to search
    await gu.sendKeys('A');

    // check summary has `Other matching` and Other Non-matching`
    assert.deepEqual(
      await driver.findAll('.test-filter-menu-summary', (e) => e.find('label').getText()),
      ['Other Matching (2,493)', 'Other Non-Matching (1,008)']
    );

    // check count adds up
    assert.equal(await getCount(), total);

    // clear search input
    await gu.sendKeys(Key.BACK_SPACE);

    // Click All Except / Other Matching / Other NOn-Matching
    await driver.findContent('.test-filter-menu-bulk-action', /None/).click();

    // click Aba and Abadan
    await driver.findContent('.test-filter-menu-list label', /Aba/).click();
    await driver.findContent('.test-filter-menu-list label', /Abadan/).click();

    // Apply filter
    await driver.find('.test-filter-menu-apply-btn').click();

    // check grid contains aba and abadan
    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['Name'], rowNums: [1, 2, 3]}),
      [
        'Aba',
        'Abadan',
        ''
      ]
    );

  });

  it('should uncheck \'Other Values\' checkbox when user clicks \'None\'', async () => {
    // open the Name filter
    await gu.openColumnMenu('Name', 'Filter');

    // click None
    await driver.findContent('.test-filter-menu-bulk-action', /None/).click();

    // check Other values was propertly unchecked
    assert.equal(
      await driver.findContent('.test-filter-menu-summary', /Other Values/).find('input').matches(':checked'),
      false
    );

    assert.equal(
      await driver.findContent('.test-filter-menu-summary', /Future Values/).find('input').matches(':checked'),
      false
    );
  });

  it('should take other filters into account', async () => {

    const session = await gu.session().teamSite.login();
    doc = await session.tempDoc(cleanup, 'SortFilterIconTest.grist');
    api = session.createHomeApi();

    // check table content
    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['Name', 'Count'], rowNums: [1, 2, 3, 4, 5, 6]}),
      [ 'Apples', '1',
        'Oranges', '3',
        'Bananas', '2',
        'Grapes', '-1',
        'Grapefruit', 'n/a',
        'Clementines', '5'
      ]);

    // add Name Filter
    await gu.openColumnMenu('Name', 'Filter');

    // Click Oranges
    await findByName('Oranges').click();

    // Click Apply
    await driver.find('.test-filter-menu-apply-btn').click();

    // add Count filters
    await driver.find('.test-add-filter-btn').click();
    await driver.findContent('.grist-floating-menu li', /Count/).click();

    // Check that there's only 5 values left ('3' is missing)
    assert.deepEqual(await driver.findAll('.test-filter-menu-list label', (e) => e.getText()),
                     ['n/a', '-1', '1', '2', '5']);

    // Check `Others` shows unique count
    assert.equal(await driver.find('.test-filter-menu-summary').getText(),
                 'Others (1)');

    // Check `Others` is checked
    assert.equal(await driver.find('.test-filter-menu-summary').find('input').matches(':checked'), true);

    // Click `Other`
    await driver.find('.test-filter-menu-summary').find('input').click();

    // Click '1'
    await findByName(/^1/).click();

    // Click Apply
    await driver.find('.test-filter-menu-apply-btn').click();

    // Open the Name menu filter
    await driver.findContent('.test-filter-field', /Name/).click();

    // Check there's only 4 values left
    assert.deepEqual(await driver.findAll('.test-filter-menu-list label', (e) => e.getText()),
                     ['Bananas', 'Clementines', 'Grapefruit', 'Grapes']);

    // check `Others` shows 2 unique values
    assert.equal(await driver.find('.test-filter-menu-summary').getText(),
                 'Others (2)');

    // check `Others` is in indeterminate state
    assert.equal(await driver.find('.test-filter-menu-summary').find('input').matches(':checked'), false);
    assert.equal(await driver.find('.test-filter-menu-summary').find('input').matches(':indeterminate'), true);

    // Click `Others`
    await driver.find('.test-filter-menu-summary').find('input').click();

    // check `Others` is checked
    assert.equal(await driver.find('.test-filter-menu-summary').find('input').matches(':checked'), true);
    assert.equal(await driver.find('.test-filter-menu-summary').find('input').matches(':indeterminate'), false);

    // Click `Others`
    await driver.find('.test-filter-menu-summary').find('input').click();

    // check `Others` is checked
    assert.equal(await driver.find('.test-filter-menu-summary').find('input').matches(':checked'), false);
    assert.equal(await driver.find('.test-filter-menu-summary').find('input').matches(':indeterminate'), false);

    // Click Apply
    await driver.find('.test-filter-menu-apply-btn').click();

    // open Count filter menu
    await driver.findContent('.test-filter-field', /Count/).click();

    // Click all and click Apply
    await driver.findContent('.test-filter-menu-bulk-action', /All/).click();
    await driver.find('.test-filter-menu-apply-btn').click();

    // open Name filter menu
    await driver.findContent('.test-filter-field', /Name/).click();

    // Check Apples and Oranges are unchecked
    assert.deepEqual(await driver.findAll('.test-filter-menu-list label', (e) => e.getText()),
                     ['Apples', 'Bananas', 'Clementines', 'Grapefruit', 'Grapes', 'Oranges']);
    assert.equal(await findByName('Apples').find('input').matches(':checked'), false);
    assert.equal(await findByName('Oranges').find('input').matches(':checked'), false);

    // click Apply
    await driver.find('.test-filter-menu-apply-btn').click();

    // Open count Filter menu
    await driver.findContent('.test-filter-field', /Count/).click();

    // Check there's only 4 values left
    assert.deepEqual(await driver.findAll('.test-filter-menu-list label', (e) => e.getText()),
                     ['n/a', '-1', '2', '5']);

    // Click Others
    await driver.find('.test-filter-menu-summary').click();

    // click Apply
    await driver.find('.test-filter-menu-apply-btn').click();

    // Open Name filter menu
    await driver.findContent('.test-filter-field', /Name/).click();

    // Check Others is unchecked
    assert.equal(await driver.find('.test-filter-menu-summary').find('input').matches(':checked'), false);
    assert.equal(await driver.find('.test-filter-menu-summary').find('input').matches(':indeterminate'), false);

    // Click Others
    await driver.find('.test-filter-menu-summary').find('input').click();
    await driver.find('.test-filter-menu-apply-btn').click();

    // Open count filter
    await driver.findContent('.test-filter-field', /Count/).click();

    // Click All and click apply
    await driver.findContent('.test-filter-menu-bulk-action', /All/).click();
    await driver.find('.test-filter-menu-apply-btn').click();

    // open Name filter menu
    await driver.findContent('.test-filter-field', /Name/).click();

    // Check both apples and orages are not checked
    assert.equal(await findByName('Apples').find('input').matches(':checked'), false);
    assert.equal(await findByName('Oranges').find('input').matches(':checked'), false);

    // Revert to all
    await driver.findContent('.test-filter-menu-bulk-action', /All/).click();
    await driver.find('.test-filter-menu-apply-btn').click();

    // Open Count filter menu and click All
    await driver.findContent('.test-filter-field', /Count/).click();
    await driver.findContent('.test-filter-menu-bulk-action', /All/).click();
    await driver.find('.test-filter-menu-apply-btn').click();
  });

  it('should show count of unique values next to summaries', async () => {

    // add another Apples
    await driver.find('.record-add .field').click();
    await driver.sendKeys('Apples', Key.ENTER);
    await gu.waitForServer();
    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['Name', 'Count'], rowNums: [1, 2, 3, 4, 5, 6, 7]}),
      [ 'Apples', '1',
        'Oranges', '3',
        'Bananas', '2',
        'Grapes', '-1',
        'Grapefruit', 'n/a',
        'Clementines', '5',
        'Apples', '0'
      ]);

    // open the Count filter
    await driver.findContent('.test-filter-field', /Count/).click();

    // uncheck 0 and 1
    await findByName(/^0/).click();
    await findByName(/^1/).click();

    // Click Apply
    await driver.find('.test-filter-menu-apply-btn').click();

    // open the Name filter
    await driver.findContent('.test-filter-field', /Name/).click();

    // check Apples is missing
    assert.deepEqual(await driver.findAll('.test-filter-menu-list label', (e) => e.getText()),
                     ['Bananas', 'Clementines', 'Grapefruit', 'Grapes', 'Oranges']);

    // check count is (1)
    assert.deepEqual(
      await driver.findAll('.test-filter-menu-summary', (e) => e.find('label').getText()),
      ['Others (1)']
    );

    // close filter
    await driver.sendKeys(Key.ESCAPE);
  });

  it('should show a working range filter for numeric columns', async function() {

    // open the Count filter
    await driver.findContent('.test-filter-field', /Count/).click();

    // set min to '2'
    await gu.setRangeFilterBound('min', '2');
    await driver.find('.test-filter-menu-apply-btn').click();

    // check values
    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['Name', 'Count'], rowNums: [1, 2, 3, 4]}),
      [ 'Oranges', '3',
        'Bananas', '2',
        'Clementines', '5',
        '', ''
      ]
    );

    // reopen the filter
    await driver.findContent('.test-filter-field', /Count/).click();

    // set max to '4'
    await gu.setRangeFilterBound('max', '4');
    await driver.find('.test-filter-menu-apply-btn').click();

    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['Name', 'Count'], rowNums: [1, 2, 3, 4]}),
      [ 'Oranges', '3',
        'Bananas', '2',
        '', '',
        undefined, undefined
      ]
    );

    // remove both min and max
    await driver.findContent('.test-filter-field', /Count/).click();
    await gu.setRangeFilterBound('min', null);
    await gu.setRangeFilterBound('max', null);
    await driver.find('.test-filter-menu-apply-btn').click();

    // check all values are there
    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['Name', 'Count'], rowNums: [1, 2, 3, 4, 5, 6, 7]}),
      [ 'Apples', '1',
        'Oranges', '3',
        'Bananas', '2',
        'Grapes', '-1',
        'Grapefruit', 'n/a',
        'Clementines', '5',
        'Apples', '0'
      ]);

  });

  it('should remove new filters when Cancel is clicked in a new filter', async function() {
    // Create a new Date filter.
    await gu.openColumnMenu('Date', 'Filter');
    assert.deepEqual(
      [
        {checked: true, value: 'n/a', count: 1},
        {checked: true, value: '', count: 2},
        {checked: true, value: '2019-07-15', count: 1},
        {checked: true, value: '2019-07-16', count: 1},
        {checked: true, value: '2019-07-17', count: 1},
        {checked: true, value: '2019-07-18', count: 1}
      ],
      await gu.getFilterMenuState()
    );

    // Check that the Date filter is pinned.
    assert.deepEqual(
      [
        {name: 'Name', hasUnsavedChanges: true},
        {name: 'Count', hasUnsavedChanges: true},
        {name: 'Date', hasUnsavedChanges: true},
      ],
      await gu.getPinnedFilters()
    );

    // Set a min filter of '2019-07-16'.
    await gu.setRangeFilterBound('min', '2019-07-16');

    // Click Cancel, and check that the filter is no longer applied to the table data.
    await gu.waitToPass(async () => {
      await driver.find('.test-filter-menu-cancel-btn').click();
      assert.isFalse(await driver.find('.test-filter-menu-wrapper').isPresent());
    });
    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['Name', 'Count'], rowNums: [1, 2, 3, 4, 5, 6, 7]}),
      [ 'Apples', '1',
        'Oranges', '3',
        'Bananas', '2',
        'Grapes', '-1',
        'Grapefruit', 'n/a',
        'Clementines', '5',
        'Apples', '0'
      ]
    );

    // Check that the Date filter was removed.
    await gu.openSectionMenu('sortAndFilter');
    assert.isFalse(await driver.findContent('.test-filter-config-filter', /Date/).isPresent());
    await gu.sendKeys(Key.ESCAPE);
    assert.deepEqual(
      [
        {name: 'Name', hasUnsavedChanges: true},
        {name: 'Count', hasUnsavedChanges: true},
      ],
      await gu.getPinnedFilters()
    );
  });

  it('should revert to open state when Cancel is clicked in an existing filter', async function() {
    // Open the Count filter.
    await driver.findContent('.test-filter-field', /Count/).click();

    // Filter out 1 and 2.
    await driver.findContent('.test-filter-menu-list label', /1/).click();
    await driver.findContent('.test-filter-menu-list label', /2/).click();

    // Unpin the filter.
    await driver.find('.test-filter-menu-pin-btn').click();

    // Click Cancel, and check that the filter is no longer applied to the table data.
    await driver.find('.test-filter-menu-cancel-btn').click();
    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['Name', 'Count'], rowNums: [1, 2, 3, 4, 5, 6, 7]}),
      [ 'Apples', '1',
        'Oranges', '3',
        'Bananas', '2',
        'Grapes', '-1',
        'Grapefruit', 'n/a',
        'Clementines', '5',
        'Apples', '0'
      ]
    );

    // Check that Count is still pinned to the filter bar.
    assert.deepEqual(
      [
        {name: 'Name', hasUnsavedChanges: true},
        {name: 'Count', hasUnsavedChanges: true},
      ],
      await gu.getPinnedFilters()
    );

    // Check the filter menu state of Count.
    await driver.findContent('.test-filter-field', /Count/).click();
    assert.deepEqual(
      [
        {checked: true, value: 'n/a', count: 1},
        {checked: true, value: '-1', count: 1},
        {checked: true, value: '0', count: 1},
        {checked: true, value: '1', count: 1},
        {checked: true, value: '2', count: 1},
        {checked: true, value: '3', count: 1},
        {checked: true, value: '5', count: 1},
      ],
      await gu.getFilterMenuState()
    );

    await gu.sendKeys(Key.ESCAPE);
  });

  async function testDateLikeColumn(colId: 'Date'|'DateTime') {

    const timeChunk = colId === 'DateTime' ? ' 12:00am' : '';
    const colRegex = new RegExp(colId + '\\b');

    // add Date Filter
    await driver.find('.test-add-filter-btn').click();
    await driver.findContent('.grist-floating-menu li', colRegex).click();

    // set min to '2019-07-16'
    await gu.setRangeFilterBound('min', '2019-07-16');
    await driver.find('.test-filter-menu-apply-btn').click();
    await gu.waitAppFocus(true);

    // check values
    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['Name', colId], rowNums: [1, 2, 3, 4]}),
      [ 'Apples', '2019-07-17' + timeChunk,
        'Oranges', '2019-07-16' + timeChunk,
        'Bananas', '2019-07-18' + timeChunk,
        '', ''
      ]
    );

    // reopen the filter
    await driver.findContent('.test-filter-field', colRegex).click();

    // set max to '2019-07-17'
    await gu.setRangeFilterBound('max', '2019-07-17');
    await driver.find('.test-filter-menu-apply-btn').click();
    await gu.waitAppFocus(true);

    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['Name', colId], rowNums: [1, 2, 3, 4]}),
      [ 'Apples', '2019-07-17' + timeChunk,
        'Oranges', '2019-07-16' + timeChunk,
        '', '',
        undefined, undefined
      ]
    );

    // remove both min and max
    await driver.findContent('.test-filter-field', colRegex).click();
    await gu.setRangeFilterBound('min', null);
    await gu.setRangeFilterBound('max', null);
    await driver.find('.test-filter-menu-apply-btn').click();
    await gu.waitAppFocus(true);

    // check all values are there
    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['Name', colId], rowNums: [1, 2, 3, 4, 5, 6, 7]}),
      [ 'Apples',      '2019-07-17' + timeChunk,
        'Oranges',     '2019-07-16' + timeChunk,
        'Bananas',     '2019-07-18' + timeChunk,
        'Grapes',      '',
        'Grapefruit',  '2019-07-15' + timeChunk,
        'Clementines', 'n/a',
        'Apples', '',
      ]);
  }


  it('should show a working range filter for Date column', async function() {
    await testDateLikeColumn('Date');
  });

  it('should show a working range filter for DateTime column', async function() {

    // adds a DateTime column
    await api.applyUserActions(doc.id, [
      ['AddVisibleColumn', 'Table1', 'DateTime', {
        type: "DateTime:UTC", widgetOptions: '{"dateFormat": "YYYY-MM-DD", "timeFormat": "h:mma"}'
      }],
      ['BulkUpdateRecord', 'Table1', [1, 2, 3, 4, 5, 6], {
        DateTime: [
          // TODO: fix timezone
          "2019-07-17T00:00Z",
          "2019-07-16T00:00Z",
          "2019-07-18T00:00Z",
          "",
          "2019-07-15T00:00Z",
          "n/a",
        ]
      }],
    ]);

    await testDateLikeColumn('DateTime');
  });

  it('should have working date range filter also when column is hidden', async function() {

    // hide Date column
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-pagewidget').click();
    await gu.moveToHidden('Date');

    // add Date filter
    await driver.findContent('.test-filter-field', 'Date').click();

    // start typing date in min bounds and send TAB
    await driver.find('.test-filter-menu-min').click();
    await gu.sendKeys('2019-07-14', Key.TAB);

    // check min is set to a valid date
    assert.equal(await driver.find('.test-filter-menu-min input').value(), '2019-07-14');
  });

});
