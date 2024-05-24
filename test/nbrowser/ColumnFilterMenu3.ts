import { assert, driver, Key } from "mocha-webdriver";
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from "test/nbrowser/testUtils";

void(driver);
void(Key);

async function getValues() {
  return driver.findAll('.test-filter-menu-list label', e => e.getText());
}

describe('ColumnFilterMenu3', function() {
  this.timeout(30000);
  const cleanup = setupTestSuite();
  let mainSession: gu.Session;
  let docId: string;
  before(async () => {
    mainSession = await gu.session().teamSite.user('user1').login();
    docId = await mainSession.tempNewDoc(cleanup, 'Search3.grist', {load: false});
    const api = mainSession.createHomeApi();
    // Prepare a table with some interestingly-formatted columns, and some data.
    const {retValues} = await api.applyUserActions(docId, [
      ['AddTable', 'Test', []],
      ['AddVisibleColumn', 'Test', 'Date', {type: 'Date', widgetOptions: '{"dateFormat":"DD-MM-YYYY"}'}],
      ['AddVisibleColumn', 'Test', 'Numeric', {type: 'Numeric'}],
      ['AddVisibleColumn', 'Test', 'Int', {type: 'Int'}],
      ['AddVisibleColumn', 'Test', 'Ref', {type: 'Ref:Test'}],
      ['AddVisibleColumn', 'Test', 'RefList', {type: 'RefList:Test'}],
    ]);
    await api.applyUserActions(docId, [
      ['UpdateRecord', '_grist_Tables_column', retValues[4].colRef, {visibleCol: retValues[1].colRef}],
      ['UpdateRecord', '_grist_Tables_column', retValues[5].colRef, {visibleCol: retValues[1].colRef}],
      ['SetDisplayFormula', 'Test', null, retValues[4].colRef, '$Ref.Date'],
      ['SetDisplayFormula', 'Test', null, retValues[5].colRef, '$RefList.Date'],
      ['AddRecord', 'Test', null, {Date: '22-12-2011', Numeric: 2,  Int: 2,  Ref: 1,
                                   RefList: ['L', 1, 2]}],
      ['AddRecord', 'Test', null, {Date: '20-12-2021', Numeric: 22, Int: 22, Ref: 2,
                                   RefList: ['L', 1]}],
      ['AddRecord', 'Test', null, {Date: '20-12-2011', Numeric: 3,  Int: 3,  Ref: 3,
                                   RefList: ['L', 1, 2, 3]}],
    ]);
    await mainSession.loadDoc(`/doc/${docId}/p/2`);
  });

  afterEach(async () => {
    // close menu if one was opened
    if (await driver.find('.grist-floating-menu').isPresent()) {
      await driver.sendKeys(Key.ESCAPE);
    }
    if (await driver.find('.test-filter-menu-wrapper').isPresent()) {
      await driver.sendKeys(Key.ESCAPE);
    }
  });

  it('should correctly focus between inputs in Numeric columns', async () => {
    // A bug was introduced where the search input could no longer be focused if either range
    // input had focus.
    await gu.openColumnMenu('Numeric', 'Filter');

    const assertSearchCanBeFocused = async () => {
      await driver.find('.test-filter-menu-search-input').click();
      assert.equal(
        await driver.switchTo().activeElement().getId(),
        await driver.find('.test-filter-menu-search-input').getId()
      );
    };

    await driver.find('.test-filter-menu-min').click();
    await assertSearchCanBeFocused();
    await driver.find('.test-filter-menu-max').click();
    await assertSearchCanBeFocused();
  });

  it('should have correct order for Numeric column', async () => {
    await gu.openColumnMenu('Numeric', 'Filter');
    assert.deepEqual(await getValues(), ['2', '3', '22']);
  });

  it('should have correct order for Integer column', async () => {
    await gu.openColumnMenu('Int', 'Filter');
    assert.deepEqual(await getValues(), ['2', '3', '22']);
    await driver.find('.test-filter-menu-apply-btn');
  });

  it('should have correct order for Date column', async () => {
    await gu.openColumnMenu('Date', 'Filter');
    assert.deepEqual(await getValues(), ['20-12-2011', '22-12-2011', '20-12-2021']);
  });

  describe('Ref', function() {

    it('should have correct order for Numeric column', async () => {
      await gu.toggleSidePanel('right', 'open');
      await gu.openColumnMenu('Ref', 'Options');
      await gu.setRefShowColumn('Numeric');
      await gu.openColumnMenu('Ref', 'Filter');
      assert.deepEqual(await getValues(), ['2', '3', '22']);
    });
    it('should have correct order for Integer column', async () => {
      await gu.setRefShowColumn('Int');
      await gu.openColumnMenu('Ref', 'Filter');
      assert.deepEqual(await getValues(), ['2', '3', '22']);
    });
    it('should have correct order for Date column', async () => {
      await gu.setRefShowColumn('Date');
      await gu.openColumnMenu('Ref', 'Filter');
      assert.deepEqual(await getValues(), ['20-12-2011', '22-12-2011', '20-12-2021']);
    });
  });

  describe('RefList', function() {
    it('should have correct order for Numeric column', async () => {
      await gu.openColumnMenu('RefList', 'Options');
      await gu.setRefShowColumn('Numeric');
      await gu.openColumnMenu('RefList', 'Filter');
      assert.deepEqual(await getValues(), ['2', '3', '22']);
    });
    it('should have correct order for Integer column', async () => {
      await gu.setRefShowColumn('Int');
      await gu.openColumnMenu('RefList', 'Filter');
      assert.deepEqual(await getValues(), ['2', '3', '22']);
    });
    it('should have correct order for Date column', async () => {
      await gu.setRefShowColumn('Date');
      await gu.openColumnMenu('RefList', 'Filter');
      assert.deepEqual(await getValues(), ['20-12-2011', '22-12-2011', '20-12-2021']);
    });
  });

  describe('id mismatch', function() {
    // This test intent to replicate a bug that happened with filters. For the bug to happen we need
    // to have a view field row id (here view field of col B) that matches the row id of another
    // column (here col A). When this happen, and when col A is hidden, and when users open the
    // column menu for B, the filter apply mistakingly to column A values as well, which could
    // intail unexpected result depending on the values of A.

    let docId2: string;
    before(async () => {
      docId2 = await mainSession.tempNewDoc(cleanup, 'ColumnFilterMenu3IdMismatch.grist', {load: false});
      const api = mainSession.createHomeApi();
      await api.applyUserActions(docId2, [
        ['BulkAddRecord', 'Table1', [null, null, null], {A: [1, 3, 3], B: [1, 1, 3]}],
        ['RemoveRecord', "_grist_Views_section_field", 1], // Hide 'A' column
      ]);
    });
    it('filters should work correctly', async function() {
      await mainSession.loadDoc(`/doc/${docId2}/p/1`);

      // filter B by {max: 2}
      await gu.openColumnMenu('B', 'Filter');
      await gu.setRangeFilterBound('max', '2');
      await driver.find('.test-filter-menu-apply-btn').click();

      // check filter does not behaves in-correctly (here mostly to show what the problem looked
      // like)
      assert.notDeepEqual(
        await gu.getVisibleGridCells({cols: ['B'], rowNums: [1, 2, 3]}),
        [ '1', '', undefined]
      );

      // check filter does behave correctly
      assert.deepEqual(
        await gu.getVisibleGridCells({cols: ['B'], rowNums: [1, 2, 3]}),
        [ '1', '1', '']
      );
    });
  });

  describe('empty choice columns', function() {
    // Previously, a bug would cause an error to be thrown when filtering an empty
    // choice or choice list column. This suite replicates that scenario.

    async function assertEmptyRowCount(count: number) {
      assert.deepEqual(
        await driver.findAll('.test-filter-menu-list label', (e) => e.getText()),
        ['']
      );
      assert.deepEqual(
        await driver.findAll('.test-filter-menu-list .test-filter-menu-count', (e) => e.getText()),
        [count.toString()],
      );
    }

    async function assertEmptyColumnIsFilterable(
      columnType: 'Choice' | 'Choice List' | 'Reference List'
    ) {
      const columnLabel = `Empty ${columnType}`;
      await gu.addColumn(columnLabel);
      await gu.setType(new RegExp(`${columnType}$`));
      await gu.openColumnMenu(columnLabel, 'Filter');
      await assertEmptyRowCount(2);
      await gu.sendKeys(Key.ESCAPE);
    }

    afterEach(() => gu.checkForErrors());

    it('should not throw an error when filtering empty choice columns', async function() {
      await assertEmptyColumnIsFilterable('Choice');
    });

    it('should not throw an error when filtering empty choice list columns', async function() {
      await assertEmptyColumnIsFilterable('Choice List');
    });

    it('should not throw an error when filtering empty reference list columns', async function() {
      // Note: this wasn't impacted by the aforementioned bug; this test is only included for
      // completeness.
      await assertEmptyColumnIsFilterable('Reference List');
    });
  });
});
