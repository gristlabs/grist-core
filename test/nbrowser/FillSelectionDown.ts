import {assert, driver, Key, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

function shiftClick(el: WebElement) {
  return driver.withActions((actions) => actions.keyDown(Key.SHIFT).click(el).keyUp(Key.SHIFT));
}

describe('FillSelectionDown', function () {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  it('should fill down selection that includes formulas', async function() {
    const session = await gu.session().personalSite.login();
    const api = session.createHomeApi();
    const docId = await session.tempNewDoc(cleanup, 'FillSelectionDown', {load: false});

    await api.applyUserActions(docId, [
      ['AddTable', 'Table2', [
        {id: 'A', type: 'Text', isFormula: false},
        {id: 'B', type: 'Text', isFormula: true, formula: '$A.upper()'},
        {id: 'C', type: 'Numeric', isFormula: false},
        {id: 'D', type: 'Numeric', isFormula: false},
      ]],
      ['BulkAddRecord', 'Table2', [null, null, null], {
        A: ['foo', 'bar', 'baz'],
        C: [10, 20, 30],
        D: [100, 200, 300],
      }]
    ]);
    await session.loadDoc(`/doc/${docId}/p/2`);

    // Initial data.
    assert.deepEqual(await gu.getVisibleGridCells({cols: ['A', 'B', 'C', 'D'], rowNums: [1, 2, 3, 4]}), [
      'foo', 'FOO', '10', '100',
      'bar', 'BAR', '20', '200',
      'baz', 'BAZ', '30', '300',
      '', '', '', ''
    ]);

    const revert = await gu.begin();
    try {
      await gu.getCell({rowNum: 1, col: 'A'}).click();
      await shiftClick(gu.getCell({rowNum: 2, col: 'C'}));
      await gu.sendKeys(Key.chord(await gu.modKey(), 'd'));
      await gu.waitForServer();

      // Filled in 2 rows.
      assert.deepEqual(await gu.getVisibleGridCells({cols: ['A', 'B', 'C', 'D'], rowNums: [1, 2, 3, 4]}), [
        'foo', 'FOO', '10', '100',
        'foo', 'FOO', '10', '200',
        'baz', 'BAZ', '30', '300',
        '', '', '', ''
      ]);
      await gu.checkForErrors();
    } finally {
      await revert();
    }
  });

  it('should fill down selection that includes the add-new row', async function() {
    const revert = await gu.begin();
    try {
      // Now try to fill in throw and including the "new" row, and check that it works and ignores
      // the "new" row silently.
      await gu.getCell({rowNum: 1, col: 'A'}).click();
      await shiftClick(gu.getCell({rowNum: 4, col: 'C'}));
      await gu.sendKeys(Key.chord(await gu.modKey(), 'd'));
      await gu.waitForServer();

      // Filled in 3 rows.
      assert.deepEqual(await gu.getVisibleGridCells({cols: ['A', 'B', 'C', 'D'], rowNums: [1, 2, 3, 4]}), [
        'foo', 'FOO', '10', '100',
        'foo', 'FOO', '10', '200',
        'foo', 'FOO', '10', '300',
        '', '', '', ''
      ]);

      await gu.checkForErrors();
    } finally {
      await revert();
    }
  });

  it('should avoid sending no-op actions', async function() {
    const revert = await gu.begin();
    await gu.userActionsCollect(true);
    try {
      // Try to fill in a single row, which is a no-op.
      await gu.getCell({rowNum: 1, col: 'A'}).click();
      await shiftClick(gu.getCell({rowNum: 1, col: 'C'}));
      await gu.sendKeys(Key.chord(await gu.modKey(), 'd'));
      await gu.userActionsVerify([]);

      // Try to fill in a single row + the add-new row, which is still a no-op.
      await gu.getCell({rowNum: 3, col: 'A'}).click();
      await shiftClick(gu.getCell({rowNum: 4, col: 'C'}));
      await gu.sendKeys(Key.chord(await gu.modKey(), 'd'));
      await gu.userActionsVerify([]);

      // Try to fill in a single formula column, which is still a no-op.
      await gu.getCell({rowNum: 1, col: 'B'}).click();
      await shiftClick(gu.getCell({rowNum: 3, col: 'B'}));
      await gu.sendKeys(Key.chord(await gu.modKey(), 'd'));
      await gu.userActionsVerify([]);

      await gu.checkForErrors();

      // Check that the ending data is unchanged.
      assert.deepEqual(await gu.getVisibleGridCells({cols: ['A', 'B', 'C', 'D'], rowNums: [1, 2, 3, 4]}), [
        'foo', 'FOO', '10', '100',
        'bar', 'BAR', '20', '200',
        'baz', 'BAZ', '30', '300',
        '', '', '', ''
      ]);
    } finally {
      await gu.userActionsCollect(false);
      await revert();
    }
  });
});
