import * as _ from 'lodash';
import {addToRepl, assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';

describe('SelectByRefList', function() {
  this.timeout(90000);
  setupTestSuite();
  addToRepl('gu2', gu);
  gu.bigScreen();

  async function setup() {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", 'nasa');
    const doc = await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon',
      'SelectByRefList.grist', false);
    await driver.get(`${server.getHost()}/o/nasa/doc/${doc.id}`);
    await gu.waitForDocToLoad();
  }

  it('should filter a table selected by ref and reflist columns', async function() {
    await setup();

    /*
     The fixture document contains the following tables:
     - LINKTARGET is the table we 'select by' another table, filtering it.
        It has 3 columns: rownum, ref, and reflist
     - REFTARGET is the target of almost all ref/reflist columns in the doc,
        especially ref and reflist in LINKTARGET.
        It has 3 rows and 1 column, the values are just a, b, and c.
     - INDIRECTREF has matching rows referencing the rows in REFTARGET.
     - REFLISTS has 2 reflist columns:
        - reflist points to REFTARGET, similar to LINKTARGET
        - LinkTarget_reflist points to LINKTARGET

     checkSelectingRecords selects each of the 3 records in a table, one at a time,
     and checks that LINKTARGET is filtered to the corresponding subarray.

     First we test selecting by the ref column of LINKTARGET (2nd column).
     Selecting by REFTARGET or INDIRECTREF should give the same result.
     Because the values of REFTARGET are [a,b,c], selecting those rows
     gives the rows in LINKTARGET with `a` and then `b` in the 2nd column in the first two subarrays.
     LINKTARGET doesn't have any references to the last row of REFTARGET (c)
     so the last group is empty.
     All these groups include the new record row at the end.
    */

    let sourceData = [
      [
        '1', 'a', 'a',
        '2', 'a', 'b',
        '', '', '',
      ],
      [
        '3', 'b', 'a\nb',
        '4', 'b', '',
        '', '', '',
      ],
      [
        '', '', '',
      ],
    ];
    // The last row selected has value `c`, so that's the default value for the ref column
    let newRow = ['99', 'c', ''];
    await checkSelectingRecords('INDIRECTREF • A → ref', sourceData, newRow);
    await checkSelectingRecords('REFTARGET → ref', sourceData, newRow);

    // Now selecting based on the reflist column (3rd column)
    // gives groups where that column *contains* `a`, then contains `b`, then
    // nothing because again LINKTARGET doesn't have references to `c`
    sourceData = [
      [
        '1', 'a', 'a',
        '3', 'b', 'a\nb',
        '', '', '',
      ],
      [
        '2', 'a', 'b',
        '3', 'b', 'a\nb',
        '', '', '',
      ],
      [
        '', '', '',
      ],
    ];
    // The last row selected has value `c`, so that's the default value for the reflist column
    newRow = ['99', '', 'c'];
    await checkSelectingRecords('INDIRECTREF • A → reflist', sourceData, newRow);
    await checkSelectingRecords('REFTARGET → reflist', sourceData, newRow);

    // This case is quite simple and direct: LINKTARGET should show the rows listed
    // in the REFLISTS.LinkTarget_reflist column. The values there are [1], [2], and [3, 4],
    // which you can see in the first column below.
    sourceData = [
      [
        '1', 'a', 'a',
        '', '', '',
      ],
      [
        '2', 'a', 'b',
        '', '', '',
      ],
      [
        '3', 'b', 'a\nb',
        '4', 'b', '',
        '', '', '',
      ],
    ];
    // LINKTARGET is being filtered by the `id` column
    // There's no column to set a default value for.
    // TODO should we be appending the new row ID to the reflist in the source table?
    newRow = ['99', '', ''];
    await checkSelectingRecords('REFLISTS • LinkTarget_reflist', sourceData, newRow);

    // Similar to the above but indirect. We connect LINKTARGET.ref and REFLISTS.reflist,
    // which both point to REFTARGET. This gives rows where LINKTARGET.ref is contained in REFLISTS.reflist
    // (in contrast to LINKTARGET.row_id contained in REFLISTS.LinkTarget_reflist).
    // The values of REFLISTS.reflist are [a], [b], and [a, b],
    // so the values in the second column must be in there.
    sourceData = [
      [
        '1', 'a', 'a',
        '2', 'a', 'b',
        '', '', '',
      ],
      [
        '3', 'b', 'a\nb',
        '4', 'b', '',
        '', '', '',
      ],
      [
        '1', 'a', 'a',
        '2', 'a', 'b',
        '3', 'b', 'a\nb',
        '4', 'b', '',
        '', '', '',
      ],
    ];
    // The last row selected has value [a,b] in REFLISTS.reflist
    // LINKTARGET.ref can only take one reference, so it defaults to the first
    newRow = ['99', 'a', ''];
    await checkSelectingRecords('REFLISTS • reflist → ref', sourceData, newRow);

    // Taking it one step further, connect LINKTARGET.reflist and REFLISTS.reflist.
    // Gives rows where the two reflists *intersect*.
    // The values of REFLISTS.reflist are [a], [b], and [a, b],
    // so the values in the third column must be in there.
    sourceData = [
      [
        '1', 'a', 'a',
        '3', 'b', 'a\nb',
        '', '', '',
      ],
      [
        '2', 'a', 'b',
        '3', 'b', 'a\nb',
        '', '', '',
      ],
      [
        '1', 'a', 'a',
        '2', 'a', 'b',
        '3', 'b', 'a\nb',
        '', '', '',
      ],
    ];
    // The last row selected has value [a,b] in REFLISTS.reflist
    // LINKTARGET.reflist gets that as a default value
    newRow = ['99', '', 'a\nb'];
    await checkSelectingRecords('REFLISTS • reflist → reflist', sourceData, newRow);
  });
});

/**
 * Makes LINKTARGET select by selectBy.
 * Asserts that clicking each row in the driving table filters LINKTARGET
 * to the corresponding subarray of sourceData.
 * Then creates a new row in LINKTARGET and asserts that it has values equal to newRow.
 * The values will depend on the link and the last row selected in the driving table.
 */
async function checkSelectingRecords(selectBy: string, sourceData: string[][], newRow: string[]) {
  await gu.openSelectByForSection('LINKTARGET');
  await driver.findContent('.test-select-row', new RegExp(selectBy + '$')).click();
  await gu.waitForServer();

  const selectByTable = selectBy.split(' ')[0];
  const cell = await gu.getCell({section: selectByTable, col: 0, rowNum: 3});
  if (selectByTable === 'REFLISTS') {
    await gu.clickReferenceListCell(cell);
  } else {
    await cell.click();
  }

  let numSourceRows = 0;

  async function checkSourceGroup(sourceRowIndex: number) {
    const sourceGroup = sourceData[sourceRowIndex];
    numSourceRows = sourceGroup.length / 3;
    assert.deepEqual(
      await gu.getVisibleGridCells({
        section: 'LINKTARGET',
        cols: ['rownum', 'ref', 'reflist'],
        rowNums: _.range(1, numSourceRows + 1),
      }),
      sourceGroup
    );
    const csvCells = await gu.downloadSectionCsvGridCells('LINKTARGET');
    const expectedCsvCells = sourceGroup.slice(0, -3)  // remove 'add new' row of empty strings
      // visible cells text uses newlines to separate list items,
      // CSV export uses commas
      .map(s => s.replace("\n", ", "));
    assert.deepEqual(csvCells, expectedCsvCells);
  }

  for (let i = 0; i < sourceData.length; i++) {
    const cell = await gu.getCell({section: selectByTable, col: 0, rowNum: i + 1});
    if (selectByTable === 'REFLISTS') {
      await gu.clickReferenceListCell(cell);
    } else {
      await cell.click();
    }
    await checkSourceGroup(i);
  }

  // Create a new record with rownum=99
  await gu.getCell({section: 'LINKTARGET', col: 'rownum', rowNum: numSourceRows}).click();
  await gu.enterCell('99');

  assert.deepEqual(
    await gu.getVisibleGridCells({
      section: 'LINKTARGET',
      cols: ['rownum', 'ref', 'reflist'],
      rowNums: [numSourceRows],
    }),
    newRow,
  );

  await gu.undo();

  // Check recursiveMoveToCursorPos
  // TODO row number 4 is not tested because sometimes there are no matching source records
  //   to move the cursor to and we don't have a solution for that case yet
  for (let rowNum = 1; rowNum <= 3; rowNum++) {
    // Click an anchor link
    const anchorCell = gu.getCell({section: "Anchors", rowNum, col: 1});
    await driver.withActions(a => a.click(anchorCell.find('.test-tb-link')));

    // Check that navigation to the link target worked
    assert.equal(await gu.getActiveSectionTitle(), "LINKTARGET");
    assert.equal(await gu.getActiveCell().getText(), String(rowNum));

    // Check that the link target is still filtered correctly by the link source,
    // which should imply that the link source cursor is in the right place
    await gu.selectSectionByTitle(selectByTable);
    const srcRowNum = await gu.getSelectedRowNum();
    await checkSourceGroup(srcRowNum - 1);
  }
}
