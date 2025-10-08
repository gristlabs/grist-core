import {assert, driver, stackWrapFunc} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { server, setupTestSuite } from 'test/nbrowser/testUtils';

describe('ExportSection', function () {
  this.timeout(20000);
  setupTestSuite();

  afterEach(() => gu.checkForErrors());

  // trims and makes sure that lines ends with \n
  function trim(text: string) {
    return text.replace(/[\r\n]/g, "\n").trim();
  }

  // filters column by excluding values
  const unfilter = stackWrapFunc(async (col: string, values: string[]) => {
    await driver.findWait('.test-filter-config-add-filter-btn', 1000).click();
    await driver.findContentWait('.grist-floating-menu .test-sd-searchable-list-item', gu.exactMatch(col), 200).click();
    await driver.findWait('.test-filter-menu-list', 1000);
    for (const v of values) {
      await driver.findContent('.test-filter-menu-list .test-filter-menu-value', gu.exactMatch(v)).click();
    }
    await driver.find('.test-filter-menu-apply-btn').click();
    await gu.waitForServer();
  });

  before(async function () {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", 'nasa');
    await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon', "SortFilterIconTest.grist");
  });

  it('should export unsaved filtered data', async function () {
    // open filters section
    await gu.toggleSidePanel('right', 'open');
    await driver.findWait('.test-right-tab-pagewidget', 1000).click();
    await driver.findWait('.test-config-sortAndFilter', 1000).click();

    // filter out records to leave only 2 rows
    await unfilter("Name", ["Grapefruit", "Grapes"]);
    await unfilter("Count", ["3", "5"]);

    // download csv and compare
    const csv = await gu.downloadSectionCsv("TABLE1");
    const expected = `
Name,Count,Date
Apples,1,2019-07-17
Bananas,2,2019-07-18`;

    assert.equal(trim(csv), trim(expected));

    // save filters - for next test
    await driver.findContent('.test-sort-filter-config-save-btns button', /Save/).click();
    await gu.waitForServer();
  });

  it('should export saved filtered data', async function () {
    // we will reuse results from previous test here

    // refresh the browser to reload everything
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();

    // open filter panel and leave only one record - but don't save the filter
    await gu.toggleSidePanel('right', 'open');
    await driver.findWait('.test-right-tab-pagewidget', 1000).click();
    await driver.findWait('.test-config-sortAndFilter', 1000).click();
    await unfilter("Date", ["2019-07-18"]);

    // download section and compare
    const csv = await gu.downloadSectionCsv("TABLE1");
    const expected = `
Name,Count,Date
Apples,1,2019-07-17`;
    assert.equal(trim(csv), trim(expected));
  });

  it('should respect filters on hidden columns', async function () {
    // Refresh the browser to reload everything.
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();

    // Open menu for 'Count' column and hide the column.
    await gu.openColumnMenu('Count', 'Hide column');
    await gu.waitForServer();

    // Download section and check that 'Count' column isn't included, but filter is in effect.
    const csv = await gu.downloadSectionCsv("TABLE1");
    const expected = `
Name,Date
Apples,2019-07-17
Bananas,2019-07-18`;
    assert.equal(trim(csv), trim(expected));
  });
});
