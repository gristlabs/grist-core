/**
 * Test for pasting into a linked GridView.
 *
 * In particular, when multiple rows are selected in GridView, on switching to a different linked
 * record, the selection should be cleared, or else paste will misbehave.
 */
import {assert, Key, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('CopyPasteLinked', function() {
  this.timeout(30000);
  const cleanup = setupTestSuite();
  const clipboard = gu.getLockableClipboard();

  it('should clear internal selection when link record changes', async function() {
    const mainSession = await gu.session().login();
    await mainSession.tempDoc(cleanup, 'Landlord.grist');
    await gu.getPageItem(/Current Signers/).click();
    await gu.waitForServer();

    let cell: WebElement;

    // Select a cell.
    cell = await gu.getCell({section: 'Tenants', col: 'Tenant', rowNum: 1});
    await cell.click();
    assert.equal(await cell.getText(), 'John Malik');

    await clipboard.lockAndPerform(async (cb) => {
      // Copy the cell's value to the clipboard.
      await cb.copy();

      // Now select multiple cells.
      await gu.sendKeys(Key.chord(Key.SHIFT, Key.DOWN), Key.chord(Key.SHIFT, Key.DOWN));

      // Check that 3 cells are indeed selected.
      assert.deepEqual(await gu.getVisibleGridCells({col: 'Tenant', rowNums: [1, 2, 3, 4],
        mapper: (el) => el.matches('.selected')}),
        [true, true, true, false]);

      // Switch to a different Apartments row that drives the filtering in the Tenants section.
      await gu.getCell({section: 'Apartments', col: 0, rowNum: 2}).click();
      cell = await gu.getCell({section: 'Tenants', col: 'Tenant', rowNum: 1});
      await cell.click();
      assert.equal(await cell.getText(), 'Fred Brown');

      // Paste the copied value. It doesn't work reliably in a test, so try until it works. (The
      // reasons seems to be that 'body' has focus briefly, rather than Clipboard component.)
      await gu.waitAppFocus();
      await cb.paste();
    });
    await gu.waitForServer();

    // Check that only one value was copied, and that there are not multiple cells selected.
    assert.deepEqual(await gu.getVisibleGridCells({col: 'Tenant', rowNums: [1, 2, 3, 4]}),
      ['John Malik', 'Fred Brown', 'Susan Sharp', 'Owen Sharp']);
    assert.deepEqual(await gu.getVisibleGridCells({col: 'Tenant', rowNums: [1, 2, 3, 4],
      mapper: (el) => el.matches('.selected')}),
      [false, false, false, false]);

    await gu.checkForErrors();
    await gu.undo();
  });
});
