import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('RefTransforms', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  afterEach(() => gu.checkForErrors());

  it('should work when transformed column serves as a display column for another reference', async function() {
    // Make a special doc for testing this.
    const session = await gu.session().teamSite.user('user1').login();
    const docId = (await session.tempNewDoc(cleanup, 'RefTransforms1', {load: false}));
    const api = session.createHomeApi();
    await api.applyUserActions(docId, [
      // Table1 contains foo,bar, to be transformed (using UI) into a Reference or ReferenceList
      // pointing to Table2.
      ['AddTable', 'Table1', [{id: 'A', type: 'Text'}]],
      ['BulkAddRecord', 'Table1', [null, null], {
        A: ['foo', 'bar']
      }],
      // Table2 contains bar,foo (for Table1 to point to when it gets converted), and also a
      // Reference back to Table1. This will be set to SHOW Table1.A. When Table1.A itself
      // becomes a ReferenceList, we've had a bug manifesting as "unmarshallable object".
      ['AddTable', 'Table2', [{id: 'A', type: 'Text'}, {id: 'B', type: 'Ref:Table1'}]],
      ['BulkAddRecord', 'Table2', [null, null], {
        A: ['bar', 'foo'],
        B: [1, 2],
      }],
    ]);

    await session.loadDoc(`/doc/${docId}`);
    await gu.addNewSection(/Table/, /Table2/);

    // Change Table2.B column (of type Ref:Table1) to use Table1.A as "SHOW COLUMN".
    await gu.getCell({section: 'Table2', rowNum: 1, col: 'B'}).click();
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();
    await driver.find('.test-fbuilder-ref-col-select').click();
    await driver.findContent('.test-select-row', /A/).click();
    await gu.waitForServer();

    // Change type of Table1 to be Ref:Table2.
    await gu.getCell({section: 'Table1', rowNum: 1, col: 'A'}).click();
    await gu.setType(/Reference$/);
    await driver.findContent('.type_transform_prompt button', /Apply/).click();
    await gu.waitForServer();

    await gu.checkForErrors();
    assert.equal(await driver.find('.test-fbuilder-type-select').getText(), "Reference");
    assert.deepEqual(await gu.getVisibleGridCells({section: 'Table1', rowNums: [1, 2], col: 'A'}),
      ['foo', 'bar']);

    // Revert.
    await gu.undo();
    assert.equal(await driver.find('.test-fbuilder-type-select').getText(), "Text");
    assert.deepEqual(await gu.getVisibleGridCells({section: 'Table1', rowNums: [1, 2], col: 'A'}),
      ['foo', 'bar']);

    // Now change type of Table1 to be RefList:Table2.
    await gu.getCell({section: 'Table1', rowNum: 1, col: 'A'}).click();
    await gu.setType(/Reference List/);
    await driver.find('.test-fbuilder-ref-table-select').click();
    await driver.findContent('.test-select-row', /Table2/).click();
    await gu.waitForServer();
    await driver.find('.test-fbuilder-ref-col-select').click();
    await driver.findContent('.test-select-row', /A/).click();
    await gu.waitForServer();
    await driver.findContent('.type_transform_prompt button', /Apply/).click();
    await gu.waitForServer();

    await gu.checkForErrors();
    assert.equal(await driver.find('.test-fbuilder-type-select').getText(), "Reference List");
    assert.deepEqual(await gu.getVisibleGridCells({section: 'Table1', rowNums: [1, 2], col: 'A'}),
      ['foo', 'bar']);

    // Revert.
    await gu.undo();
    assert.equal(await driver.find('.test-fbuilder-type-select').getText(), "Text");
    assert.deepEqual(await gu.getVisibleGridCells({section: 'Table1', rowNums: [1, 2], col: 'A'}),
      ['foo', 'bar']);
  });

  it('should allow changing the table of a ref list', async function() {
    // An old bug made it impossible to change the value of "DATA FROM TABLE" for a reference list.
    await gu.getCell({section: 'Table1', rowNum: 1, col: 'B'}).click();
    await gu.setType(/Reference List/);
    await driver.find('.test-fbuilder-ref-col-select').click();
    await driver.findContent('.test-select-row', /A/).click();
    await gu.waitForServer();

    // Add some references to values in the same table.
    await gu.sendKeys(Key.ENTER, 'foo', Key.ENTER, 'bar', Key.ENTER, Key.ENTER);
    await gu.waitForServer();

    // Now change the table to Table2. (This previously failed and left the table unchanged.)
    await driver.find('.test-fbuilder-ref-table-select').click();
    await driver.findContent('.test-select-row', /Table2/).click();
    await gu.waitForServer();
    assert.equal(await driver.find('.test-fbuilder-ref-table-select').getText(), 'Table2');
    await driver.find('.test-fbuilder-ref-col-select').click();
    await driver.findContent('.test-select-row', /A/).click();
    await gu.waitForServer();

    // Finish transforming and make sure it completed successfully.
    await driver.findContent('.type_transform_prompt button', /Apply/).click();
    await gu.waitForServer();
    await gu.checkForErrors();
    assert.deepEqual(await gu.getVisibleGridCells({section: 'Table1', rowNums: [1, 2], col: 'B'}),
      ['foo\nbar', '']);

    // Make sure new references are added to Table2.
    await gu.sendKeys('baz', Key.ARROW_UP, Key.ENTER, Key.ENTER);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells({section: 'Table2', rowNums: [1, 2, 3], col: 'A'}),
      ['bar', 'foo', 'baz']);
  });
});
