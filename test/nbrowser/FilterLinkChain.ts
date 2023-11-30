import {assert} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('FilterLinkChain', function () {
  this.timeout(10000);
  const cleanup = setupTestSuite();

  before(async function () {
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, 'FilterLinkChain.grist');
  });

  it('should work with chains of filter links', async function () {
    async function checkCells(sectionName: string, cols: string[], expected: string[]) {
      assert.deepEqual(
        await gu.getVisibleGridCells({section: sectionName, cols, rowNums: [1, 2]}),
        expected
      );

      // Sanity-check the selectors in checkSectionEmpty() below.
      const section = gu.getSection(sectionName);
      assert.isEmpty(await section.findAll('.disable_viewpane'));
      assert.isNotEmpty(await section.findAll('.gridview_row .gridview_data_row_num'));
      assert.isNotEmpty(await section.findAll('.gridview_row .record'));
      assert.isNotEmpty(await section.findAll('.gridview_row .field'));
    }

    async function checkTopCells(expected: string[]) {
      await checkCells('TOP', ['Top'], expected);
    }

    async function checkMiddleCells(expected: string[]) {
      await checkCells('MIDDLE', ['Top', 'Middle'], expected);
    }

    async function checkBottomCells(expected: string[]) {
      await checkCells('BOTTOM', ['Top', 'Middle', 'Bottom'], expected);
    }

    async function checkSectionEmpty(sectionName: string, text: string) {
      const section = gu.getSection(sectionName);
      assert.equal(await section.find('.disable_viewpane').getText(), text);
      assert.isEmpty(await section.findAll('.gridview_row .gridview_data_row_num'));
      assert.isEmpty(await section.findAll('.gridview_row .record'));
      assert.isEmpty(await section.findAll('.gridview_row .field'));
    }

    async function checkBottomEmpty() {
      await checkSectionEmpty('BOTTOM', 'No row selected in MIDDLE');
    }

    async function checkMiddleEmpty() {
      await checkSectionEmpty('MIDDLE', 'No row selected in TOP');
    }

    // The initially visible data.
    // The bottom section is selected by the middle section,
    // which is selected by the top section.
    await checkTopCells([
      'A',  // selected initially
      'B',
    ]);
    // Filtered to 'A'
    await checkMiddleCells([
      'A', 'A1',  // selected initially
      'A', 'A2',
    ]);
    // Filtered to 'A1'
    await checkBottomCells([
      'A', 'A1', '1',
      'A', 'A1', '2',
    ]);

    // Select 'A2'
    await gu.getCell({section: 'MIDDLE', col: 'Middle', rowNum: 2}).click();
    await checkBottomCells([
      'A', 'A2', '3',
      'A', 'A2', '4',
    ]);

    // Select the 'new' row
    await gu.getCell({section: 'MIDDLE', col: 'Middle', rowNum: 3}).click();
    await checkSectionEmpty('BOTTOM', 'No row selected in MIDDLE');

    // Select 'B'
    await gu.getCell({section: 'TOP', col: 'Top', rowNum: 2}).click();
    await checkMiddleCells([
      'B', 'B1',  // selected initially
      'B', 'B2',
    ]);
    // Filtered to 'B1'
    await checkBottomCells([
      'B', 'B1', '5',
      'B', 'B1', '6',
    ]);

    // Select 'B2'
    await gu.getCell({section: 'MIDDLE', col: 'Middle', rowNum: 2}).click();
    await checkBottomCells([
      'B', 'B2', '7',
      'B', 'B2', '8',
    ]);

    // Select the 'new' row, making the bottom empty
    await gu.getCell({section: 'MIDDLE', col: 'Middle', rowNum: 3}).click();
    await checkBottomEmpty();

    // Select the 'new' in the top section, which makes middle empty, which means bottom stays empty.
    await gu.getCell({section: 'TOP', col: 'Top', rowNum: 3}).click();
    await checkMiddleEmpty();
    await checkBottomEmpty();

    // Double-check: make all sections show some data again,
    // and then make both the middle and bottom empty in one click instead of one at a time.
    await gu.getCell({section: 'TOP', col: 'Top', rowNum: 2}).click();
    await checkMiddleCells([
      'B', 'B1',  // selected initially
      'B', 'B2',
    ]);
    await checkBottomCells([
      'B', 'B1', '5',
      'B', 'B1', '6',
    ]);

    await gu.getCell({section: 'TOP', col: 'Top', rowNum: 3}).click();
    await checkMiddleEmpty();
    await checkBottomEmpty();
  });
});
