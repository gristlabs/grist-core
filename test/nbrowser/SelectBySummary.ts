import * as _ from 'lodash';
import {addToRepl, assert, driver} from 'mocha-webdriver';
import {enterRulePart, findDefaultRuleSet} from 'test/nbrowser/aclTestUtils';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';

describe('SelectBySummary', function() {
  this.timeout(50000);
  setupTestSuite();
  addToRepl('gu2', gu);
  gu.bigScreen();

  before(async function() {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", 'nasa');
    const doc = await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon',
      'SelectBySummary.grist', false);
    await driver.get(`${server.getHost()}/o/nasa/doc/${doc.id}`);
    await gu.waitForDocToLoad();
  });

  it('should filter a source table selected by a summary table', async function() {
    await checkSelectingRecords(
      ['onetwo'],
      [
        '1', '16',
        '2', '20',
      ],
      [
        [
          '1', 'a', '1',
          '1', 'b', '3',
          '1', 'a\nb', '5',
          '1', '', '7',
        ],
        [
          '2', 'a', '2',
          '2', 'b', '4',
          '2', 'a\nb', '6',
          '2', '', '8',
        ],
      ],
    );

    await checkSelectingRecords(
      ['choices'],
      [
        'a', '14',
        'b', '18',
        '', '15',
      ],
      [
        [
          '1', 'a', '1',
          '2', 'a', '2',
          '1', 'a\nb', '5',
          '2', 'a\nb', '6',
        ],
        [
          '1', 'b', '3',
          '2', 'b', '4',
          '1', 'a\nb', '5',
          '2', 'a\nb', '6',
        ],
        [
          '1', '', '7',
          '2', '', '8',
        ],
      ],
    );


    await checkSelectingRecords(
      ['onetwo', 'choices'],
      [
        '1', 'a', '6',
        '2', 'a', '8',
        '1', 'b', '8',
        '2', 'b', '10',
        '1', '', '7',
        '2', '', '8',
      ],
      [
        [
          '1', 'a', '1',
          '1', 'a\nb', '5',
        ],
        [
          '2', 'a', '2',
          '2', 'a\nb', '6',
        ],
        [
          '1', 'b', '3',
          '1', 'a\nb', '5',
        ],
        [
          '2', 'b', '4',
          '2', 'a\nb', '6',
        ],
        [
          '1', '', '7',
        ],
        [
          '2', '', '8',
        ],
      ],
    );

  });

  it('should create new rows in the source table (link target) with correct default values',
    gu.revertChanges(async function() {
      // Select the record with ['2', 'a'] in the summary table
      // so those values will be used as defaults in the source table
      await gu.getCell({section: 'TABLE1 [by onetwo, choices]', col: 'rownum', rowNum: 2}).click();

      // Create a new record with rownum=99
      await gu.getCell({section: 'TABLE1', col: 'rownum', rowNum: 3}).click();
      await gu.enterCell('99');

      assert.deepEqual(
        await gu.getVisibleGridCells({
          section: 'TABLE1',
          cols: ['onetwo', 'choices', 'rownum'],
          rowNums: [3],
        }),
        ['2', 'a', '99'],
      );
    })
  );

  it('should filter a summary table selected by a less detailed summary table', async function() {
    // Delete the Table1 widget so that we can hide the table in ACL without hiding the whole page.
    const menu = await gu.openSectionMenu('viewLayout', 'TABLE1');
    await menu.findContent('.test-cmd-name', 'Delete widget').click();
    await gu.waitForServer();

    // Open the ACL UI
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);    // Wait for initialization fetch to complete.

    // Deny all access to Table1.
    await driver.findContentWait('button', /Add Table Rules/, 2000).click();
    await driver.findContentWait('.grist-floating-menu li', /Table1/, 3000).click();
    const ruleSet = findDefaultRuleSet(/Table1/);
    await enterRulePart(ruleSet, 1, null, 'Deny All');
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();

    // Go back to the main page.
    await gu.getPageItem('Table1').click();

    // Now check filter linking, but with the detailed summary 'TABLE1 [by onetwo, choices]' as the target,
    // selecting by the two less detailed summaries.
    // There was a bug previously that this would not work while the summary source table (Table1) was hidden.
    await checkSelectingRecords(
      ['onetwo'],
      [
        '1', '16',
        '2', '20',
      ],
      [
        [
          '1', 'a', '6',
          '1', 'b', '8',
          '1', '', '7',
        ],
        [
          '2', 'a', '8',
          '2', 'b', '10',
          '2', '', '8',
        ],
      ],
      // This argument was not used in the previous test, as TABLE1 is the default.
      'TABLE1 [by onetwo, choices]',
    );

    await checkSelectingRecords(
      ['choices'],
      [
        'a', '14',
        'b', '18',
        '', '15',
      ],
      [
        [
          '1', 'a', '6',
          '2', 'a', '8',
        ],
        [
          '1', 'b', '8',
          '2', 'b', '10',
        ],
        [
          '1', '', '7',
          '2', '', '8',
        ],
      ],
      'TABLE1 [by onetwo, choices]',
    );
  });

});

/**
 * Makes `targetSection` select by the existing summary table grouped by groubyColumns.
 * Asserts that the summary table has the data summaryData under groubyColumns and rownum.
 * Asserts that clicking each row in the summary table filters the target section
 * to the corresponding subarray of `targetData`.
 */
async function checkSelectingRecords(
  groubyColumns: string[],
  summaryData: string[],
  targetData: string[][],
  targetSection: string = 'TABLE1',
) {
  const summarySection = `TABLE1 [by ${groubyColumns.join(', ')}]`;

  await gu.openSelectByForSection(targetSection);
  await driver.findContent('.test-select-row', summarySection).click();
  await gu.waitForServer();

  assert.deepEqual(
    await gu.getVisibleGridCells({
      section: summarySection,
      cols: [...groubyColumns, 'rownum'],
      rowNums: _.range(1, targetData.length + 1)
    }),
    summaryData,
  );

  async function checkTargetGroup(targetGroupIndex: number) {
    const targetGroup = targetData[targetGroupIndex];
    const countCell = await gu.getCell({section: summarySection, col: 'count', rowNum: targetGroupIndex + 1});
    const numTargetRows = targetGroup.length / 3;
    await countCell.click();
    assert.deepEqual(
      await gu.getVisibleGridCells({
        section: targetSection,
        cols: ['onetwo', 'choices', 'rownum'],
        rowNums: _.range(1, numTargetRows + 1),
      }),
      targetGroup
    );
    if (targetSection === 'TABLE1') {
      assert.equal(await countCell.getText(), numTargetRows.toString());
      const csvCells = await gu.downloadSectionCsvGridCells(targetSection);
      // visible cells text uses newlines to separate list items, CSV export uses commas
      const expectedCsvCells = targetGroup.map(s => s.replace("\n", ", "));
      assert.deepEqual(csvCells, expectedCsvCells);
    }
  }

  for (let i = 0; i < targetData.length; i++) {
    await checkTargetGroup(i);
  }

  if (targetSection === 'TABLE1') {
    // Check recursiveMoveToCursorPos
    for (let rowNum = 1; rowNum <= 8; rowNum++) {
      // Click an anchor link
      const anchorCell = gu.getCell({section: "Anchors", rowNum, col: 1});
      await anchorCell.find('.test-tb-link').click();

      // Check that navigation to the link target worked
      assert.equal(await gu.getActiveSectionTitle(), "TABLE1");
      assert.equal(await gu.getActiveCell().getText(), String(rowNum));

      // Check that the link target is still filtered correctly by the link source,
      // which should imply that the link source cursor is in the right place
      await gu.selectSectionByTitle(summarySection);
      const summaryRowNum = await gu.getSelectedRowNum();
      await checkTargetGroup(summaryRowNum - 1);
    }
  }
}
