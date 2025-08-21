import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from "test/nbrowser/testUtils";
import { assert, driver, Key } from 'mocha-webdriver';


function getItems() {
  return driver.findAll('.test-filter-menu-list label', async (e) => ({
    checked: await e.find('input').isSelected(),
    label: await e.find('.test-filter-menu-value').getText(),
    count: await e.find('.test-filter-menu-count').getText()
  }));
}

describe('ColumnFilterMenu2', function() {

  this.timeout('30s');
  const cleanup = setupTestSuite();
  let mainSession: gu.Session;
  let docId: string;
  let api: any;

  before(async function() {
    mainSession = await gu.session().teamSite.user('user1').login();
    docId = await mainSession.tempNewDoc(cleanup, 'ColumnFilterMenu2.grist', {load: false});
    api = mainSession.createHomeApi();
    // Prepare a table with some interestingly-formatted columns, and some data.
    await api.applyUserActions(docId, [
      ['AddTable', 'Test', []],
      ['AddVisibleColumn', 'Test', 'Bool', {
        type: 'Bool', widgetOptions: JSON.stringify({widget:"TextBox"})
      }],
      ['AddVisibleColumn', 'Test', 'Choice', {
        type: 'Choice', widgetOptions: JSON.stringify({choices: ['foo', 'bar']})
      }],
      ['AddVisibleColumn', 'Test', 'ChoiceList', {
        type: 'ChoiceList', widgetOptions: JSON.stringify({choices: ['foo', 'bar']})
      }],
      ['AddVisibleColumn', 'Test', 'Marked', {
        type: 'Text', widgetOptions: JSON.stringify({widget: 'Markdown'})
      }],

      ['AddVisibleColumn', 'Test', 'Nr', {type: 'Int'}],

      ['AddRecord', 'Test', null, {
        Bool: true, Choice: 'foo', ChoiceList: ['L', 'foo'],
        Marked: '[Some link](http://example.com)'
      }],
    ]);
    return docId;
  });

  afterEach(() => gu.checkForErrors());

  it('should show all options for Bool columns', async () => {
    await mainSession.loadDoc(`/doc/${docId}/p/2`);

    await gu.openColumnMenu('Bool', 'Filter');
    assert.deepEqual(await getItems(), [
      {checked: true, label: 'false', count: '0'},
      {checked: true, label: 'true', count: '1'},
    ]);

    // click false
    await driver.findContent('.test-filter-menu-list label', 'false').click();
    assert.deepEqual(await getItems(), [
      {checked: false, label: 'false', count: '0'},
      {checked: true, label: 'true', count: '1'},
    ]);

    // add new record with Bool=false
    const {retValues} = await api.applyUserActions(docId, [
      ['AddRecord', 'Test', null, {Bool: false}],
    ]);

    // check record is not shown on screen
    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['Bool', 'Choice', 'ChoiceList'], rowNums: [1, 2]}),
      ['true', 'foo', 'foo',
       '', '', ''
      ] as any
    );

    // remove added record
    await api.applyUserActions(docId, [
      ['RemoveRecord', 'Test', retValues[0]]
    ]);
  });

  it('should show all options for Choice/ChoiceList columns', async () => {
    await gu.openColumnMenu('Choice', 'Filter');
    assert.deepEqual(await getItems(), [
      {checked: true, label: 'bar', count: '0'},
      {checked: true, label: 'foo', count: '1'},
    ]);

    // click bar
    await driver.findContent('.test-filter-menu-list label', 'bar').click();
    assert.deepEqual(await getItems(), [
      {checked: false, label: 'bar', count: '0'},
      {checked: true, label: 'foo', count: '1'},
    ]);

    // add new record with Choice=bar
    const {retValues} = await api.applyUserActions(docId, [
      ['AddRecord', 'Test', null, {Choice: 'bar'}],
    ]);

    // check record is not shown on screen
    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['Bool', 'Choice', 'ChoiceList'], rowNums: [1, 2]}),
      ['true', 'foo', 'foo',
       '', '', ''
      ] as any
    );

    // remove added record
    await api.applyUserActions(docId, [
      ['RemoveRecord', 'Test', retValues[0]]
    ]);

    // check ChoiceList filter offeres all options
    await gu.openColumnMenu('ChoiceList', 'Filter');
    assert.deepEqual(await getItems(), [
      {checked: true, label: 'bar', count: '0'},
      {checked: true, label: 'foo', count: '1'},
    ]);
    await gu.sendKeys(Key.ESCAPE);
    await driver.find('.test-section-menu-small-btn-revert').click();
  });


  it('should strip markdown content for Text columns', async () => {
    /** Gets labels rendered in the filter menu */
    const labels = async () => {
      await gu.openColumnMenu('Marked', 'Filter');
      const list = (await getItems()).map(item => item.label);
      await gu.sendKeys(Key.ESCAPE);
      return list;
    };
    /** Replaced all rows */
    const replace = (vals: [number, string, string][]) => gu.sendActions([
      ['ReplaceTableData', 'Test', [], {}],
      ['BulkAddRecord', 'Test', vals.map(() => null), {
        Nr: vals.map(([nr]) => nr),
        Marked: vals.map(([, marked]) => marked)
      }]
    ]);

    // Whole test case.
    const test = async (data: [number, string, string][]) => {
      // First replace table with new data.
      await replace(data);

      // Then make sure that filter shows plain text labels.
      assert.deepEqual(
        await labels(),
        data.map(([, , expected]) => expected).sort(), // Filter menu sorts labels.
      );
      // Now filter by each label and check that it works.

      for(const [nr, , strippedMarkdown] of data) {
        // Open the filter menu.
        const f = await gu.openColumnFilter('Marked');

        // Type the stripped markdown in the search box.
        await f.search(strippedMarkdown);

        // Make sure we only see the typed text, there is only one value that matches it.
        assert.deepEqual(await f.labels(), [strippedMarkdown]);

        // Filter out everything else.
        await f.allShown();

        // Close the filter.
        await f.close();

        // Check only the Nr column, as the markdown is converted to html and it is hard to
        // look for.
        assert.deepEqual(
          await gu.getVisibleGridCells('Nr', [1]), [String(nr)],
          `Failed to filter by ${strippedMarkdown}`
        );

        assert.equal(await gu.getGridRowCount(), 1 + 1 /* add row */);

        await gu.sendKeys(Key.ESCAPE);
      }
      await driver.find('.test-section-menu-small-btn-revert').click();
    };

    await test([
      // Nr , Markdown with a link, Same markdown but without a link,
      // Note: Nr is needed as we check if the row was filtered correctly, but in the grid it is converted
      // to html, so its harder to find. With Nr column we can just check if the row is there.
      [1, '[link](http://example.com) at start', 'link at start'],
      [2, 'link at the [end](http://example.com)', 'link at the end'],
      [3, 'link in the [middle](http://example.com) of text', 'link in the middle of text'],
      [4, '**bold** text with [link](http://example.com)', '**bold** text with link'],
      [5, '[**label** in bold](http://example.com) with text', '**label** in bold with text'],
    ]);
  });

});
