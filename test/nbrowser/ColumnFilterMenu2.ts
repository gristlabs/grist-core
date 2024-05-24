import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from "test/nbrowser/testUtils";
import { assert, driver } from 'mocha-webdriver';


function getItems() {
  return driver.findAll('.test-filter-menu-list label', async (e) => ({
    checked: await e.find('input').isSelected(),
    label: await e.getText(),
    count: await e.findClosest('div').find('.test-filter-menu-count').getText()
  }));
}

describe('ColumnFilterMenu2', function() {

  this.timeout(20000);
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
      ['AddRecord', 'Test', null, {Bool: true, Choice: 'foo', ChoiceList: ['L', 'foo']}],
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
  });

});
