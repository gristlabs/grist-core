import { getColValues } from 'app/common/DocActions';
import { UserAPI } from 'app/common/UserAPI';
import { assert, driver } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { server, setupTestSuite } from 'test/nbrowser/testUtils';

/**
 * This is test for a bug that was on the Right Panel. [Select by] dropdown wasn't updated
 * properly when summary tables (or linking in general) were updated.
 */

describe("SelectByRightPanel", function() {
  this.timeout(20000);
  setupTestSuite();
  let docId: string;
  let api: UserAPI;

  before(async () => {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");
    docId = await gu.createNewDoc('chimpy', 'nasa', 'Horizon', 'Test22.grist');
    api = gu.createHomeApi('Chimpy', 'nasa');
    await driver.get(`${server.getHost()}/o/nasa/doc/${docId}`);
    await gu.waitForDocToLoad();
    await api.applyUserActions(docId, [
      ['UpdateRecord', '_grist_Tables_column', 2, { label: 'Company' }],
      ['UpdateRecord', '_grist_Tables_column', 3, { label: 'Category' }],
      ['UpdateRecord', '_grist_Tables_column', 4, { label: 'Month' }],
      ['AddVisibleColumn', 'Table1', 'Date', {}],
      ['AddVisibleColumn', 'Table1', 'Value', {}],
    ]);
    // Add some dummy data.
    await api.applyUserActions(docId, [
      ['BulkAddRecord', 'Table1', new Array(7).fill(null), getColValues([
        { Company: 'Mic', Category: 'Sales', Month: 1, Date: 1, Value: 100 },
        { Company: 'Mic', Category: 'Sales', Month: 1, Date: 2, Value: 100 },
        { Company: 'Mic', Category: 'Cloud', Month: 1, Date: 3, Value: 300 },
        { Company: 'Gog', Category: 'Sales', Month: 4, Date: 4, Value: 100 },
        { Company: 'Gog', Category: 'Adv',   Month: 4, Date: 4, Value: 100 },
        { Company: 'Gog', Category: 'Adv',   Month: 3, Date: 5, Value: 100 },
        { Company: 'Tes', Category: 'Sales', Month: 2, Date: 6, Value: 100 },
      ])],
    ]);
  });

  it("selects by right panel for", async () => {
    // Add first summary table by Company
    await gu.addNewSection('Table', 'Table1', { summarize: ['Company'] });
    // Add second one by Category, we will update selection later using data selection on right panel
    await gu.addNewSection('Table', 'Table1', { summarize: ['Category'] });
    // Add Company to this table, select by should be filled with the new option.
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-pagewidget').click();
    await driver.find('.test-config-data').click();
    await driver.find('.test-pwc-editDataSelection').click();
    await driver.findContent('.test-wselect-column', /Company/).doClick();
    await driver.find('.test-wselect-addBtn').click();
    await gu.waitForServer();
    // Test that we have new option.
    await driver.find('.test-right-select-by').click();
    await driver.findContentWait('.test-select-menu li', "TABLE1 [by Company]", 200).click();
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells('Company', [1, 2]), ['Mic', 'Mic']);
    assert.deepEqual(await gu.getVisibleGridCells('Category', [1, 2]), ['Sales', 'Cloud']);
  });
});
