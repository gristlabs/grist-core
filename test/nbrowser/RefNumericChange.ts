import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('RefNumericChange', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  afterEach(() => gu.checkForErrors());

  it('should allow converting a ref column to numeric and undoing it', async function() {
    // We had a bug with Ref -> Numeric conversion when starting with a Ref column that showed a
    // numeric display col.
    const session = await gu.session().teamSite.user('user1').login();
    const docId = (await session.tempNewDoc(cleanup, 'RefNumericChange1', {load: false}));
    const api = session.createHomeApi();
    await api.applyUserActions(docId, [
      ['AddTable', 'TestTable', [{id: 'Num', type: 'Numeric'}, {id: 'Ref', type: 'Ref:TestTable'}]],
      ['BulkAddRecord', 'TestTable', [null, null, null, null], {Num: ['5', '10', '15'], Ref: [3, 2, 0, '17.0']}],
    ]);

    await session.loadDoc(`/doc/${docId}/p/2`);

    // Change TestTable.Ref column (of type Ref:TestTable) to use TestTable.Num as "SHOW COLUMN".
    await gu.getCell({section: 'TestTable', rowNum: 1, col: 'Ref'}).click();
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();
    await driver.find('.test-fbuilder-ref-col-select').click();
    await driver.findContent('.test-select-row', /Num/).click();
    await gu.waitForServer();

    assert.equal(await driver.find('.test-fbuilder-type-select').getText(), "Reference");
    assert.deepEqual(await gu.getVisibleGridCells({section: 'TestTable', rowNums: [1, 2, 3, 4], col: 'Ref'}),
      ['15', '10', '', '17.0']);

    // Change type of column Ref to Numeric.
    await gu.getCell({section: 'TestTable', rowNum: 1, col: 'Ref'}).click();
    await gu.setType('Numeric');
    await driver.findContent('.type_transform_prompt button', /Apply/).click();
    await gu.waitForServer();

    await gu.checkForErrors();
    assert.equal(await driver.find('.test-fbuilder-type-select').getText(), "Numeric");
    assert.deepEqual(await gu.getVisibleGridCells({section: 'TestTable', rowNums: [1, 2, 3, 4], col: 'Ref'}),
      ['15', '10', '0', '17']);

    // Revert.
    await gu.undo();
    assert.equal(await driver.find('.test-fbuilder-type-select').getText(), "Reference");
    assert.deepEqual(await gu.getVisibleGridCells({section: 'TestTable', rowNums: [1, 2, 3, 4], col: 'Ref'}),
      ['15', '10', '', '17.0']);
  });
});
