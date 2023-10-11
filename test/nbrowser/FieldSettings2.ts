import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('FieldSettings2', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  afterEach(() => gu.checkForErrors());

  it('should allow separate field settings for a new field', async function() {
    const session = await gu.session().teamSite.user('user1').login();
    const docId = (await session.tempNewDoc(cleanup, 'FieldSettings2A', {load: false}));
    const api = session.createHomeApi();
    await api.applyUserActions(docId, [
      ['AddTable', 'TestTable', [{id: 'Num', type: 'Numeric'}]],
      ['BulkAddRecord', 'TestTable', [null, null, null], {Num: ['5', '10', '15']}],
    ]);

    await session.loadDoc(`/doc/${docId}/p/2`);

    // Add a second widget of the same table to the page.
    await gu.openAddWidgetToPage();
    await gu.selectWidget(/Table/, /TestTable/);
    await gu.renameSection('TESTTABLE', 'T1');
    await gu.renameSection('TESTTABLE', 'T2');

    // Change Num field to "Separate"
    await gu.getCell({section: 'T1', rowNum: 1, col: 'Num'}).click();
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();
    await fieldSettingsUseSeparate();

    // Now change background color of this column.
    await gu.openCellColorPicker();
    await gu.setFillColor('blue');
    await driver.find('.test-colors-save').click();
    await gu.waitForServer();

    // Check that only one of the two views changed.
    const cell1 = await gu.getCell({section: 'T1', rowNum: 1, col: 'Num'});
    const cell2 = await gu.getCell({section: 'T2', rowNum: 1, col: 'Num'});
    await gu.assertFillColor(cell1, 'blue');
    await gu.assertFillColor(cell2, 'transparent');

    // Saving as common updates the other view.
    await fieldSettingsSaveAsCommon();
    await gu.assertFillColor(cell1, 'blue');
    await gu.assertFillColor(cell2, 'blue');

    // Undo; then reverting reverts the saved change.
    await gu.undo();
    await gu.assertFillColor(cell1, 'blue');
    await gu.assertFillColor(cell2, 'transparent');
    await fieldSettingsRevertToCommon();
    await gu.assertFillColor(cell1, 'transparent');
    await gu.assertFillColor(cell2, 'transparent');
  });
});

const getFieldSettingsButton = () => driver.find('.fieldbuilder_settings_button');
const switchFieldSettings = async (fromLabel: string, option: string, toLabel: string) => {
  assert.include(await getFieldSettingsButton().getText(), fromLabel);
  await getFieldSettingsButton().click();
  await driver.findContent('.grist-floating-menu li', option).click();
  await gu.waitForServer();
  assert.include(await getFieldSettingsButton().getText(), toLabel);
};
const fieldSettingsUseSeparate = () => switchFieldSettings('Common', 'Use separate', 'Separate');
const fieldSettingsSaveAsCommon = () => switchFieldSettings('Separate', 'Save as common', 'Common');
const fieldSettingsRevertToCommon = () => switchFieldSettings('Separate', 'Revert to common', 'Common');
