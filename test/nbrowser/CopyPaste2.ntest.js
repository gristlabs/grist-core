/* global window */

import { assert, driver } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

// Helper that returns the cell text prefixed by "+" if the cell is selected, "-" if not.
async function selText(cell) {
  const isSelected = await cell.hasClass('selected');
  const text = await cell.getAttribute('textContent');
  return (isSelected ? "+" : "-") + text;
}

describe('CopyPaste2.ntest', function() {
  const cleanup = test.setupTestSuite(this);
  const clipboard = gu.getLockableClipboard();

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "CopyPaste2.grist", true);
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it('should highlight correct cells after paste', async function() {
    // After paste, the right cells should be highlighted (there was a bug with it when cursor was
    // not in the top-left corner of the destination selection).

    // Select a 3x2 rectangle, and check that the data and selection is as we expect.
    await gu.clickCell({rowNum: 3, col: 0});
    await gu.sendKeys([$.SHIFT, $.RIGHT], [$.SHIFT, $.DOWN, $.DOWN]);
    assert.deepEqual(await gu.getGridValues({rowNums: [3, 4, 5, 6, 7], cols: [0, 1, 2], mapper: selText}), [
      '+A3', '+B3', '-C3',  // rowNum 3
      '+A4', '+B4', '-C4',  // rowNum 4
      '+A5', '+B5', '-C5',  // rowNum 5
      '-A6', '-B6', '-C6',  // rowNum 6
      '-A7', '-B7', '-C7',  // rowNum 7
    ]);
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();

      // For destination, select rows 5-6, but with cursor in the bottom-right corner of them.
      await gu.clickCell({rowNum: 6, col: 1});
      await gu.sendKeys([$.SHIFT, $.LEFT], [$.SHIFT, $.UP]);
      await cb.paste();
    });
    await gu.waitForServer();

    // The result should have 3 rows selected starting from row 5, col 0.
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 6, col: 1});
    assert.deepEqual(await gu.getGridValues({rowNums: [3, 4, 5, 6, 7], cols: [0, 1, 2], mapper: selText}), [
      '-A3', '-B3', '-C3',  // rowNum 3
      '-A4', '-B4', '-C4',  // rowNum 4
      '+A3', '+B3', '-C5',  // rowNum 5
      '+A4', '+B4', '-C6',  // rowNum 6
      '+A5', '+B5', '-C7',  // rowNum 7
    ]);

    await gu.undo();    // Go back to initial state.
  });

  it('should allow paste into sorted grids', async function() {
    // Sort by column A.
    await gu.clickCell({rowNum: 1, col: 0});
    await gu.openColumnMenu('A');
    await $('.grist-floating-menu .test-sort-asc').click();
    await gu.clickCell({rowNum: 1, col: 0});

    // Check the initial state. Refer to this when trying to understand the results of each step.
    assert.deepEqual(await gu.getGridValues({rowNums: [3, 4, 5, 6, 7], cols: [0, 1, 2], mapper: selText}), [
      '-A3', '-B3', '-C3',  // rowNum 3
      '-A4', '-B4', '-C4',  // rowNum 4
      '-A5', '-B5', '-C5',  // rowNum 5
      '-A6', '-B6', '-C6',  // rowNum 6
      '-A7', '-B7', '-C7',  // rowNum 7
    ]);

    // First test pasting columns B,C: order of rows is not affected.
    await gu.clickCell({rowNum: 3, col: 1});
    await gu.sendKeys([$.SHIFT, $.RIGHT], [$.SHIFT, $.DOWN, $.DOWN]);
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await gu.clickCell({rowNum: 5, col: 1});
      await cb.paste();
    });
    await gu.waitForServer();

    // Check values, and also that the selection is in the paste destination.
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 5, col: 1});
    assert.deepEqual(await gu.getGridValues({rowNums: [3, 4, 5, 6, 7], cols: [0, 1, 2], mapper: selText}), [
      '-A3', '-B3', '-C3',  // rowNum 3
      '-A4', '-B4', '-C4',  // rowNum 4
      '-A5', '+B3', '+C3',  // rowNum 5
      '-A6', '+B4', '+C4',  // rowNum 6
      '-A7', '+B5', '+C5',  // rowNum 7
    ]);

    await gu.undo();    // Go back to initial state.

    // Now test pasting columns A,B. First a single row: it jumps but cursor should stay in it.
    await gu.clickCell({rowNum: 7, col: 0});
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await gu.clickCell({rowNum: 3, col: 0});
      await cb.paste();
    });
    await gu.waitForServer();

    // Check values, and also that the selection is in the paste destination.
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 6, col: 0});
    assert.deepEqual(await gu.getGridValues({rowNums: [3, 4, 5, 6, 7], cols: [0, 1, 2], mapper: selText}), [
      '-A4', '-B4', '-C4',  // rowNum 3
      '-A5', '-B5', '-C5',  // rowNum 4
      '-A6', '-B6', '-C6',  // rowNum 5
      '-A7', '-B3', '-C3',  // rowNum 6
      '-A7', '-B7', '-C7',  // rowNum 7
    ]);

    await gu.undo();    // Go back to initial state.

    // Now multiple rows / columns, including adding records.
    await gu.clickCell({rowNum: 3, col: 0});
    await gu.sendKeys([$.SHIFT, $.RIGHT], [$.SHIFT, $.DOWN, $.DOWN]);
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await gu.clickCell({rowNum: 6, col: 0});
      await cb.paste();
    });
    await gu.waitForServer();

    // Cursor should be in the row which used to be row 6 (has C5 in it); selection is lost
    // because rows are no longer contiguous (and better behavior is not yet implemented).
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 4, col: 0});
    assert.deepEqual(await gu.getGridValues({rowNums: [3, 4, 5, 6, 7, 8], cols: [0, 1, 2], mapper: selText}), [
      '-A3', '-B3', '-C3',  // rowNum 3
      '-A3', '-B3', '-C6',  // rowNum 4
      '-A4', '-B4', '-C4',  // rowNum 5
      '-A4', '-B4', '-C7',  // rowNum 6
      '-A5', '-B5', '-C5',  // rowNum 7
      '-A5', '-B5', '-',    // rowNum 8
    ]);

    await gu.undo();    // Go back to initial state.

    // Now B/C column into A/B column, with a row shift. This happens to keep destination rows
    // together, so we check that the selection is maintained.
    await gu.clickCell({rowNum: 3, col: 1});
    await gu.sendKeys([$.SHIFT, $.RIGHT], [$.SHIFT, $.DOWN]);
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await gu.clickCell({rowNum: 5, col: 0});
      await cb.paste();
    });
    await gu.waitForServer();

    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 6, col: 0});
    assert.deepEqual(await gu.getGridValues({rowNums: [3, 4, 5, 6, 7], cols: [0, 1, 2], mapper: selText}), [
      '-A3', '-B3', '-C3',  // rowNum 3
      '-A4', '-B4', '-C4',  // rowNum 4
      '-A7', '-B7', '-C7',  // rowNum 5
      '+B3', '+C3', '-C5',  // rowNum 6
      '+B4', '+C4', '-C6',  // rowNum 7
    ]);

    await gu.undo();    // Go back to initial state.

    // Undo the sorting.
    $('.test-section-menu-small-btn-revert').click();
  });

  it.skip('should copy formatted values to clipboard', async function() {
    // Formatted values should be copied to the clipboard as the user sees them (particularly for
    // Dates and Reference columns).
    //
    // FIXME: this test currently fails in headless environments, seemingly due to changes to
    // clipboard behavior in recent versions of chromedriver.

    // Select a 3x2 rectangle, and check that the data and selection is as we expect.
    await gu.clickCell({rowNum: 3, col: 2});
    await gu.sendKeys([$.SHIFT, $.RIGHT, $.RIGHT, $.RIGHT, $.RIGHT, $.RIGHT], [$.SHIFT, $.DOWN, $.DOWN]);
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4, 5, 6, 7], cols: [2, 3, 4, 5, 6, 7], mapper: selText}), [
      '-C1', '-17.504',   '-02/29/16', '-2016-02-29 9:30am', '-April 13, 1743',    '-Jefferson',
      '-C2', '--3.222',   '-03/31/16', '-2016-03-31 9:30am', '-March 16, 1751',    '-Madison',
      '+C3', '+-4.018',   '+04/30/16', '+2016-04-30 9:30am', '+October 30, 1735',  '+Adams',
      '+C4', '+1829.324', '+05/31/16', '+2016-05-31 9:30am', '+February 22, 1732', '+Washington',
      '+C5', '+9402.556', '+06/30/16', '+2016-06-30 9:30am', '+',                   '+',
      '-C6', '-12.000',   '-07/31/16', '-2016-07-31 9:30am', '-February 22, 1732', '-Washington',
      '-C7', '-0.001',    '-08/31/16', '-2016-08-31 9:30am', '-April 13, 1743',    '-Jefferson',
    ]);

    // Paste data as the text into the open editor of top-left cell, and save.
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await gu.clickCell({rowNum: 1, col: 0});
      await gu.sendKeys($.ENTER, $.SELECT_ALL);
      await cb.paste();
    });
    await gu.sendKeys($.ENTER);
    await gu.waitForServer();

    // Note how all values are formatted in the same way as above.
    assert.deepEqual(await gu.getCell({rowNum: 1, col: 0}).getAttribute('textContent'),
      'C3\t-4.018\t04/30/16\t2016-04-30 9:30am\tOctober 30, 1735\tAdams\n' +
      'C4\t1829.324\t05/31/16\t2016-05-31 9:30am\tFebruary 22, 1732\tWashington\n' +
      'C5\t9402.556\t06/30/16\t2016-06-30 9:30am\t\t');
    await gu.undo();    // Go back to initial state.
  });

  it.skip('should copy properly in the presence of special characters', async function() {
    // If we copy multiple cells (generating text/html to clipboard) and the cells contain special
    // html characters (such as angle brackets), those should be escaped.
    //
    // FIXME: this test currently fails in headless environments, seemingly due to changes to
    // clipboard behavior in recent versions of chromedriver.

    await gu.clickCell({rowNum: 1, col: 1});
    await gu.sendKeys($.ENTER, $.SELECT_ALL, "<tag> for", [$.SHIFT, $.ENTER], "you & me;", $.ENTER);
    await gu.waitForServer();

    // Add a listener that will save the prepared clipboard data, so that we can examine it.
    await driver.executeScript(function() {
      window.gristCopyHandler = ev => {
        window.copiedClipboardData = {};
        for (let t of ev.clipboardData.types) {
          window.copiedClipboardData[t] = ev.clipboardData.getData(t);
        }
      };
      window.addEventListener('copy', window.gristCopyHandler);
    });

    try {
      // Now copy a multi-cell selection including this cell.
      await gu.clickCell({rowNum: 1, col: 0});
      await gu.sendKeys([$.SHIFT, $.RIGHT], [$.SHIFT, $.DOWN]);
      assert.deepEqual(await gu.getGridValues({rowNums: [1, 2], cols: [0, 1, 2], mapper: selText}), [
        '+A1', '+<tag> for\nyou & me;', '-C1',
        '+A2', '+B2',                   '-C2',
      ]);

      await clipboard.lockAndPerform(async (cb) => {
        await cb.copy();

        // Firefox and Chrome actually produce slightly different html, so we just check the part that
        // matters: that angle brackets and ampersand got escaped.
        assert.include(await driver.executeScript(() => window.copiedClipboardData['text/html']),
                      '<td>A1</td><td>&lt;tag&gt; for\nyou &amp; me;</td>');

        // Check the contents of text that got copied to the clipboard
        assert.equal(await driver.executeScript(() => window.copiedClipboardData['text/plain']),
                    'A1\t"<tag> for\nyou & me;"\n' +
                    'A2\tB2'
                    );

        // We can check that we also accept such text correctly by pasting as text inside a cell, and
        // then copy-pasting from there.
        await gu.clickCell({rowNum: 3, col: 0});
        await gu.sendKeys($.ENTER, $.SELECT_ALL);
        await cb.paste();
      });
      await gu.sendKeys($.ENTER);
      await gu.waitForServer();

      await gu.clickCell({rowNum: 3, col: 0});
      await gu.sendKeys($.ENTER, $.SELECT_ALL);
      await clipboard.lockAndPerform(async (cb) => {
        await cb.copy();
        await gu.sendKeys($.ESCAPE);
        await gu.clickCell({rowNum: 4, col: 0});
        await cb.paste();
      });

      await gu.waitForServer();
      assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4, 5], cols: [0, 1, 2], mapper: selText}), [
        '-A1', '-<tag> for\nyou & me;', '-C1',
        '-A2', '-B2',                   '-C2',
        '-A1\t"<tag> for\nyou & me;"\nA2\tB2', '-B3', '-C3',
        '+A1', '+<tag> for\nyou & me;', '-C4',
        '+A2', '+B2',                   '-C5',
      ]);

      await gu.undo(3);    // Go back to initial state.
    } finally {
      await driver.executeScript(function() {
        window.removeEventListener('copy', window.gristCopyHandler);
      });
    }
  });

  it('should paste correctly when values contain commas', async function() {
    // When pasting, split only on tabs, not on commas. (We used to split on both, or guess what
    // to split on, which resulted in unexpected and unpleasant surprises when a legitimate value
    // contained a comma.)

    // Create a value with commas.
    await gu.clickCell({rowNum: 1, col: 0});
    await gu.sendKeys($.ENTER, $.SELECT_ALL, "this,is,a,test", $.ENTER);
    await gu.waitForServer();

    // Copy a single value, and paste to another cell.
    await gu.clickCell({rowNum: 1, col: 0});
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await gu.clickCell({rowNum: 2, col: 0});
      await cb.paste();
    });
    await gu.waitForServer();
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2], cols: [0, 1, 2], mapper: selText}), [
      '-this,is,a,test', '-B1', '-C1',
      '-this,is,a,test', '-B2', '-C2',
    ]);

    // Now copy multiple values, and paste to other cells.
    await gu.sendKeys([$.SHIFT, $.UP], [$.SHIFT, $.RIGHT]);
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await gu.clickCell({rowNum: 1, col: 1});
      await cb.paste();
    });
    await gu.waitForServer();

    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2], cols: [0, 1, 2], mapper: selText}), [
      '-this,is,a,test', '+this,is,a,test', '+B1',
      '-this,is,a,test', '+this,is,a,test', '+B2',
    ]);

    await gu.undo(3);    // Go back to initial state.
  });
});
