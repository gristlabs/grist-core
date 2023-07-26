import {assert, driver, Key, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

interface CellPosition {
  /** 0-based column index. */
  col: number;
  /** 0-based row index. */
  row: number;
}

interface SelectionSummary {
  dimensions: string;
  count: number | null;
  sum: string | null;
}

describe('SelectionSummary', function () {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  gu.bigScreen();

  before(async function() {
    const session = await gu.session().personalSite.login();
    await session.tempDoc(cleanup, 'SelectionSummary.grist');
  });

  async function assertSelectionSummary(summary: SelectionSummary | null) {
    if (!summary) {
      assert.isFalse(await driver.find('.test-selection-summary-dimensions').isPresent());
      assert.isFalse(await driver.find('.test-selection-summary-count').isPresent());
      assert.isFalse(await driver.find('.test-selection-summary-sum').isPresent());
      return;
    }

    const {dimensions, count, sum} = summary;
    await gu.waitToPass(async () => assert.equal(
      await driver.find('.test-selection-summary-dimensions').getText(),
      dimensions
    ), 500);
    if (count === null) {
      assert.isFalse(await driver.find('.test-selection-summary-count').isPresent());
    } else {
      await gu.waitToPass(async () => assert.equal(
        await driver.find('.test-selection-summary-count').getText(),
        `COUNT ${count}`
      ), 500);
    }
    if (sum === null) {
      assert.isFalse(await driver.find('.test-selection-summary-sum').isPresent());
    } else {
      await gu.waitToPass(async () => assert.equal(
        await driver.find('.test-selection-summary-sum').getText(),
        `SUM ${sum}`
      ), 500);
    }
  }

  function shiftClick(el: WebElement) {
    return driver.withActions((actions) => actions.keyDown(Key.SHIFT).click(el).keyUp(Key.SHIFT));
  }

  async function selectAndAssert(start: CellPosition, end: CellPosition, summary: SelectionSummary | null) {
    const {col: startCol, row: startRow} = start;
    await gu.getCell(startCol, startRow + 1).click();
    const {col: endCol, row: endRow} = end;
    await shiftClick(await gu.getCell(endCol, endRow + 1));
    await assertSelectionSummary(summary);
  }

  it('does not display anything if only a single cell is selected', async function () {
    for (const [col, row] of [[0, 1], [2, 3]]) {
      await gu.getCell(col, row).click();
      await assertSelectionSummary(null);
    }
  });

  it('displays sum if the selection contains numbers', async function () {
    await selectAndAssert({col: 0, row: 0}, {col: 0, row: 6}, {
      dimensions: '7⨯1',
      count: null,
      sum: '$135,692,590',
    });
    await selectAndAssert({col: 0, row: 3}, {col: 0, row: 6}, {
      dimensions: '4⨯1',
      count: null,
      sum: '$135,679,011',
    });

    await selectAndAssert({col: 4, row: 0}, {col: 4, row: 6}, {
      dimensions: '7⨯1',
      count: null,
      sum: '135692590',
    });
    await selectAndAssert({col: 0, row: 0}, {col: 4, row: 6}, {
      dimensions: '7⨯5',
      count: null,
      sum: '$271,385,168.02',
    });
  });

  it('uses formatter of the first (leftmost) numeric column', async function () {
    // Column 0 is U.S. currency, while column 1 is just a plain decimal number.
    await selectAndAssert({col: 0, row: 0}, {col: 1, row: 6}, {
      dimensions: '7⨯2',
      count: null,
      sum: '$135,692,578.02',
    });
    await selectAndAssert({col: 1, row: 0}, {col: 1, row: 6}, {
      dimensions: '7⨯1',
      count: null,
      sum: '-11.98',
    });
    // The entire selection (spanning 6 columns) uses the formatter of column 0.
    await selectAndAssert({col: 0, row: 0}, {col: 5, row: 6}, {
      dimensions: '7⨯6',
      count: null,
      sum: '$271,385,156.04',
    });
  });

  it("displays count if the selection doesn't contain numbers", async function () {
    await selectAndAssert({col: 2, row: 0}, {col: 2, row: 6}, {
      dimensions: '7⨯1',
      count: 5,
      sum: null,
    });
    await selectAndAssert({col: 2, row: 3}, {col: 2, row: 6}, {
      dimensions: '4⨯1',
      count: 2,
      sum: null,
    });

    // Scroll horizontally to the end of the table.
    await gu.sendKeys(Key.END);

    await selectAndAssert({col: 7, row: 0}, {col: 10, row: 4}, {
      dimensions: '5⨯4',
      count: 7,
      sum: null,
    });
    await selectAndAssert({col: 10, row: 0}, {col: 12, row: 6}, {
      dimensions: '7⨯3',
      count: 5,
      sum: null,
    });
  });

  it('does not count false values', async function () {
    // False values in boolean columns should not be included in count
    await selectAndAssert({col: 2, row: 0}, {col: 3, row: 5}, {
      dimensions: '6⨯2',
      count: 9,
      sum: null,
    });
  });

  it('uses the show column of reference columns for computations', async function () {
    // Column 6 is a Reference column pointing to column 0.
    await gu.sendKeys(Key.HOME);
    await selectAndAssert({col: 6, row: 0}, {col: 6, row: 6}, {
      dimensions: '7⨯1',
      count: null,
      sum: '-$123,456',
    });

    // Column 7 is a Reference List column pointing to column 0. At this time, it
    // only displays counts (but flattening sums also seems like intuitive behavior).
    await gu.sendKeys(Key.END);
    await selectAndAssert({col: 7, row: 0}, {col: 7, row: 6}, {
      dimensions: '7⨯1',
      count: 2,
      sum: null,
    });
  });

  it('updates whenever the selection changes', async function () {
    // Scroll horizontally to the beginning of the table.
    await gu.sendKeys(Key.HOME);

    // Select a region of the table.
    await selectAndAssert({col: 0, row: 2}, {col: 0, row: 6}, {
      dimensions: '5⨯1',
      count: null,
      sum: '$135,691,356',
    });

    // Without de-selecting, use keyboard shortcuts to grow the selection to the right.
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.ARROW_RIGHT));

    // Check that the selection summary was updated.
    await assertSelectionSummary({
      dimensions: '5⨯2',
      count: null,
      sum: '$135,691,368.5',
    });
  });

  it('displays correct sum when all rows/columns are selected', async function () {
    await driver.find(".gridview_data_corner_overlay").click();
    await assertSelectionSummary({
      dimensions: '7⨯14',
      count: null,
      sum: '$271,261,700.04',
    });
  });

  describe('on narrow screens', function() {
    gu.narrowScreen();

    it('is not visible', async function() {
      await assertSelectionSummary(null);
      await selectAndAssert({col: 0, row: 0}, {col: 0, row: 6}, null);
    });
  });
 });
