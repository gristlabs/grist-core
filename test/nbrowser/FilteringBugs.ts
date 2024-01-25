import {assert, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('FilteringBugs', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let session: gu.Session;

  afterEach(() => gu.checkForErrors());

  before(async function() {
    session = await gu.session().login();
  });

  it('should not filter records edited from another view', async function() {
    await session.tempDoc(cleanup, 'ExemptFromFilterBug.grist');

    // Change column A of the first record from foo to bar; bar should still be
    // visible, even though it's excluded by a filter.
    await gu.getCell({section: 'TABLE2 Filtered', rowNum: 1, col: 'A'}).click();
    await gu.sendKeys(Key.ENTER, Key.ARROW_DOWN, Key.ENTER);
    await gu.waitForServer();
    assert.deepEqual(
      await gu.getVisibleGridCells({section: 'TABLE2 Filtered', col: 'A', rowNums: [1, 2, 3]}),
      ['bar', 'foo', '']
    );

    // With the same record selected, change column C in the linked card section.
    await gu.getCell({section: 'TABLE2 Filtered', rowNum: 1, col: 'A'}).click();
    await gu.getCardCell('C', 'TABLE2 Card').click();
    await gu.sendKeys('2', Key.ENTER);
    await gu.waitForServer();

    // Check that the record is still visible in the first section. Previously, a
    // regression caused it to be filtered out.
    assert.deepEqual(
      await gu.getVisibleGridCells({section: 'TABLE2 Filtered', col: 'A', rowNums: [1, 2, 3]}),
      ['bar', 'foo', '']
    );
  });
});
