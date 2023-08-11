import {assert, driver, Key, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

interface CellSelection {
  /** 0-based column index. */
  colStart: number;

  /** 0-based column index. */
  colEnd: number;

  /** 0-based row index. */
  rowStart: number;

  /** 0-based row index. */
  rowEnd: number;
}

interface SelectionRange {
  /** 0-based index. */
  start: number;

  /** 0-based index. */
  end: number;
}

describe('ShiftSelection', function () {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  gu.bigScreen();

  before(async function() {
    const session = await gu.session().personalSite.login();
    await session.tempDoc(cleanup, 'ShiftSelection.grist');
  });

  async function getSelectionRange(parent: WebElement, selector: string): Promise<SelectionRange|undefined> {
    let start, end;

    let selectionActive = false;
    const elements = await parent.findAll(selector);
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const isSelected = await element.matches('.selected');

      if (isSelected && !selectionActive) {
        start = i;
        selectionActive = true;
        continue;
      }

      if (!isSelected && selectionActive) {
        end = i - 1;
        break;
      }
    }

    if (start === undefined) {
      return undefined;
    }

    if (end === undefined) {
      end = elements.length - 1;
    }

    return {
      start: start,
      end: end,
    };
  }

  async function getSelectedCells(): Promise<CellSelection|undefined> {
    const activeSection = await driver.find('.active_section');

    const colSelection = await getSelectionRange(activeSection, '.column_names .column_name');
    if (!colSelection) {
      return undefined;
    }

    const rowSelection = await getSelectionRange(activeSection, '.gridview_row .gridview_data_row_num');
    if (!rowSelection) {
      // Edge case if only a cell in the "new" row is selected
      // Not relevant for our tests
      return undefined;
    }

    return {
      colStart: colSelection.start,
      colEnd: colSelection.end,
      rowStart: rowSelection.start,
      rowEnd: rowSelection.end,
    };
  }

  async function assertCellSelection(expected: CellSelection|undefined) {
    const currentSelection = await getSelectedCells();
    assert.deepEqual(currentSelection, expected);
  }


  it('Shift+Up extends the selection up', async function () {
    await gu.getCell(1, 2).click();
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.UP));
    await assertCellSelection({colStart: 1, colEnd: 1, rowStart: 0, rowEnd: 1});
  });

  it('Shift+Down extends the selection down', async function () {
    await gu.getCell(1, 2).click();
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.DOWN));
    await assertCellSelection({colStart: 1, colEnd: 1, rowStart: 1, rowEnd: 2});
  });

  it('Shift+Left extends the selection left', async function () {
    await gu.getCell(1, 2).click();
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.LEFT));
    await assertCellSelection({colStart: 0, colEnd: 1, rowStart: 1, rowEnd: 1});
  });

  it('Shift+Right extends the selection right', async function () {
    await gu.getCell(1, 2).click();
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.RIGHT));
    await assertCellSelection({colStart: 1, colEnd: 2, rowStart: 1, rowEnd: 1});
  });

  it('Shift+Right + Shift+Left leads to the initial selection', async function () {
    await gu.getCell(1, 2).click();
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.RIGHT));
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.LEFT));
    await assertCellSelection({colStart: 1, colEnd: 1, rowStart: 1, rowEnd: 1});
  });

  it('Shift+Up + Shift+Down leads to the initial selection', async function () {
    await gu.getCell(1, 2).click();
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.UP));
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.DOWN));
    await assertCellSelection({colStart: 1, colEnd: 1, rowStart: 1, rowEnd: 1});
  });

  it('Ctrl+Shift+Up extends the selection blockwise up', async function () {
    await gu.getCell(5, 7).click();

    const ctrlKey = await gu.modKey();

    await gu.sendKeys(Key.chord(ctrlKey, Key.SHIFT, Key.UP));
    await assertCellSelection({colStart: 5, colEnd: 5, rowStart: 4, rowEnd: 6});

    await gu.sendKeys(Key.chord(ctrlKey, Key.SHIFT, Key.UP));
    await assertCellSelection({colStart: 5, colEnd: 5, rowStart: 2, rowEnd: 6});

    await gu.sendKeys(Key.chord(ctrlKey, Key.SHIFT, Key.UP));
    await assertCellSelection({colStart: 5, colEnd: 5, rowStart: 0, rowEnd: 6});
  });

  it('Ctrl+Shift+Down extends the selection blockwise down', async function () {
    await gu.getCell(5, 5).click();

    const ctrlKey = await gu.modKey();

    await gu.sendKeys(Key.chord(ctrlKey, Key.SHIFT, Key.DOWN));
    await assertCellSelection({colStart: 5, colEnd: 5, rowStart: 4, rowEnd: 6});

    await gu.sendKeys(Key.chord(ctrlKey, Key.SHIFT, Key.DOWN));
    await assertCellSelection({colStart: 5, colEnd: 5, rowStart: 4, rowEnd: 8});

    await gu.sendKeys(Key.chord(ctrlKey, Key.SHIFT, Key.DOWN));
    await assertCellSelection({colStart: 5, colEnd: 5, rowStart: 4, rowEnd: 10});
  });

  it('Ctrl+Shift+Left extends the selection blockwise left', async function () {
    await gu.getCell(6, 5).click();

    const ctrlKey = await gu.modKey();

    await gu.sendKeys(Key.chord(ctrlKey, Key.SHIFT, Key.LEFT));
    await assertCellSelection({colStart: 4, colEnd: 6, rowStart: 4, rowEnd: 4});

    await gu.sendKeys(Key.chord(ctrlKey, Key.SHIFT, Key.LEFT));
    await assertCellSelection({colStart: 2, colEnd: 6, rowStart: 4, rowEnd: 4});

    await gu.sendKeys(Key.chord(ctrlKey, Key.SHIFT, Key.LEFT));
    await assertCellSelection({colStart: 0, colEnd: 6, rowStart: 4, rowEnd: 4});
  });

  it('Ctrl+Shift+Right extends the selection blockwise right', async function () {
    await gu.getCell(4, 5).click();

    const ctrlKey = await gu.modKey();

    await gu.sendKeys(Key.chord(ctrlKey, Key.SHIFT, Key.RIGHT));
    await assertCellSelection({colStart: 4, colEnd: 6, rowStart: 4, rowEnd: 4});

    await gu.sendKeys(Key.chord(ctrlKey, Key.SHIFT, Key.RIGHT));
    await assertCellSelection({colStart: 4, colEnd: 8, rowStart: 4, rowEnd: 4});

    await gu.sendKeys(Key.chord(ctrlKey, Key.SHIFT, Key.RIGHT));
    await assertCellSelection({colStart: 4, colEnd: 10, rowStart: 4, rowEnd: 4});
  });

  it('Ctrl+Shift+* extends the selection until all the next cells are empty', async function () {
    await gu.getCell(3, 7).click();

    const ctrlKey = await gu.modKey();

    await gu.sendKeys(Key.chord(Key.SHIFT, Key.RIGHT));
    await gu.sendKeys(Key.chord(ctrlKey, Key.SHIFT, Key.UP));
    await assertCellSelection({colStart: 3, colEnd: 4, rowStart: 2, rowEnd: 6});

    await gu.getCell(4, 7).click();
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.LEFT));
    await gu.sendKeys(Key.chord(ctrlKey, Key.SHIFT, Key.UP));
    await assertCellSelection({colStart: 3, colEnd: 4, rowStart: 4, rowEnd: 6});
  });
 });
