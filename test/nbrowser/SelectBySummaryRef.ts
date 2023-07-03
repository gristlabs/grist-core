import {addToRepl, assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';

describe('SelectBySummaryRef', function() {
  this.timeout(20000);
  setupTestSuite();
  addToRepl('gu2', gu);

  before(async function(){
  await server.simulateLogin("Chimpy", "chimpy@getgrist.com", 'nasa');
    const doc = await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon',
      'SelectBySummaryRef.grist', false);
    await driver.get(`${server.getHost()}/o/nasa/doc/${doc.id}`);
    await gu.waitForDocToLoad();
  });

  it('should give correct options when linking with a summary table with ref/reflist columns', async () => {
    /*
    The doc has 3 tables on one page with these columns:
    1. Source:
      - 'Other ref' is a reflist to 'Other'
    2. Summary (a summary table of Source):
      - 'Other ref' is the groupby column, so now it's a *ref* to 'Other', hence the column name in Source
      - 'Source ref' is a ref to Source
      - 'Source reflist' is a reflist to Source
      - 'group' is the usual group column in summary tables (a reflist to Source) which is hidden from the options.
    3. Other:
      - 'Text' which won't be mentioned again since it's not a reference or anything.
      - 'Source ref' is a ref to Source
     */

    const sourceOptions = [
      'Other',
      'Other • Source ref',
      'Summary',
      'Summary • Other ref',
      'Summary • Source ref',
      'Summary • Source reflist',
    ];
    const summaryOptions = [
      'Source → Source ref',
      'Source → Source reflist',
      'Source • Other ref',
      'Other',
      'Other • Source ref → Source ref',
      'Other • Source ref → Source reflist',
    ];
    const otherOptions = [
      'Source',
      'Source • Other ref',
      'Summary • Other ref',
      'Summary → Source ref',
      'Summary • Source ref',
      'Summary • Source reflist',
    ];
    await checkRightPanelSelectByOptions('Source', sourceOptions);
    await checkRightPanelSelectByOptions('Other', otherOptions);
    await checkRightPanelSelectByOptions('Summary', summaryOptions);

    // Detach the summary table
    await driver.find('.test-detach-button').click();
    await gu.waitForServer();

    // Each widget now has an option to select by the `group` reflist column of Summary
    // in place of selecting by 'summaryness'.
    const sourceOptionsWithGroup = [...sourceOptions, 'Summary • group'];
    assert.deepEqual(sourceOptionsWithGroup.splice(2, 1), ['Summary']);

    const otherOptionsWithGroup = [...otherOptions, 'Summary • group'];
    assert.deepEqual(otherOptionsWithGroup.splice(3, 1), ['Summary → Source ref']);

    // The summary table has also gained new options to select by the group column.
    // There were no corresponding 'summaryness' options before because a summary table can't select by its source table
    // (based purely on summaryness), only the other way around.
    // Same for selecting by a reference to the source table.
    // Such options are theoretically possible but are disabled because they're a bit weird,
    // usually filter linking to a single row when cursor linking would make more sense and still not be very useful.
    const summaryOptionsWithGroup = [...summaryOptions, 'Other • Source ref → group'];
    summaryOptionsWithGroup.splice(2, 0, 'Source → group');

    await checkRightPanelSelectByOptions('Source', sourceOptionsWithGroup);
    await checkRightPanelSelectByOptions('Other', otherOptionsWithGroup);
    await checkRightPanelSelectByOptions('Summary', summaryOptionsWithGroup);

    // Undo detaching the summary table
    await gu.undo();
  });

  it('should give correct options when adding a new summary table', async () => {
    // Go to the second page in the document, which only has a widget for the 'Other' table
    await gu.getPageItem("Other").click();

    await gu.openAddWidgetToPage();

    // Sanity check for the select by options of the plain table
    await gu.selectWidget('Table', 'Other', {dontAdd: true});
    await checkAddWidgetSelectByOptions([
      'Other',
      'Other • Source ref',
    ]);

    // Select by options for summary tables of Other only exist when grouping by Source ref
    await gu.selectWidget('Table', 'Other', {dontAdd: true, summarize: []});
    await checkAddWidgetSelectByOptions(null);
    await gu.selectWidget('Table', 'Other', {dontAdd: true, summarize: ['Text']});
    await checkAddWidgetSelectByOptions(null);
    await gu.selectWidget('Table', 'Other', {dontAdd: true, summarize: ['Source ref']});
    // Note that in this case we are inferring options for a table that doesn't exist anywhere yet
    await checkAddWidgetSelectByOptions([
      'Other • Source ref',
    ]);

    // Actually add the summary table in the last case above, selected by the only option
    await gu.selectWidget('Table', 'Other',
      {selectBy: 'Other • Source ref', summarize: ['Source ref']});

    // Check that the link is actually there in the right panel and that the options are the same as when adding.
    await checkCurrentSelectBy('Other • Source ref');
    await checkRightPanelSelectByOptions('OTHER [by Source ref]', [
      'Other • Source ref',
    ]);

    // Undo adding the summary table
    await gu.undo();
  });

  it('should give correct options when adding an existing summary table', async () => {
    // Go to the second page in the document, which only has a widget for the 'Other' table
    await gu.getPageItem("Other").click();

    await gu.openAddWidgetToPage();

    // Sanity check for the select by options of the plain table
    await gu.selectWidget('Table', 'Source', {dontAdd: true});
    await checkAddWidgetSelectByOptions([
      'Other',
      'Other • Source ref',
    ]);

    // No select by options for summary table without groupby columns
    await gu.selectWidget('Table', 'Source', {dontAdd: true, summarize: []});
    await checkAddWidgetSelectByOptions(null);

    // This summary table already exists on the first page.
    // '→ Source ref' and '→ Source reflist' refer to formula columns in the summary table that
    // don't exist by default.
    await gu.selectWidget('Table', 'Source', {dontAdd: true, summarize: ['Other ref']});
    await checkAddWidgetSelectByOptions([
      'Other',
      'Other • Source ref → Source ref',
      'Other • Source ref → Source reflist',
    ]);

    // Actually add the summary table in the last case above, selected by the second option
    await gu.selectWidget('Table', 'Source',
      {selectBy: 'Other • Source ref → Source ref', summarize: ['Other ref']});

    // Check that the link is actually there in the right panel and that the options are the same as when adding.
    await checkCurrentSelectBy('Other • Source ref → Source ref');
    await checkRightPanelSelectByOptions('SOURCE [by Other ref]', [
      'Other',
      'Other • Source ref → Source ref',
      'Other • Source ref → Source reflist',
    ]);
  });

});


// Check that the 'Select by' menu in the right panel for the section has the expected options
async function checkRightPanelSelectByOptions(section: string, expected: string[]) {
  await gu.openSelectByForSection(section);

  const actual = await driver.findAll('.test-select-menu .test-select-row', (e) => e.getText());
  assert.deepEqual(actual, ['Select Widget', ...expected]);
  await gu.sendKeys(Key.ESCAPE);
}

async function checkAddWidgetSelectByOptions(expected: string[]|null) {
  const actual = await driver.findAll('.test-wselect-selectby option', (e) => e.getText());
  assert.deepEqual(actual, expected === null ? [] : ['', 'Select Widget', ...expected]);
}

async function checkCurrentSelectBy(expected: string) {
  const actual = await driver.find('.test-right-select-by').getText();
  assert.equal(actual, expected);
}
