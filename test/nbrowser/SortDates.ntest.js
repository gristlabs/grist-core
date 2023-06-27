import { assert } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

// Helper that returns the cell text prefixed by "!" if the cell is invalid.
async function valText(cell) {
  const isInvalid = await cell.find('.field_clip').hasClass("invalid");
  const text = await cell.getText();
  return (isInvalid ? "!" : "") + text;
}

async function clickColumnMenuSort(colName, itemText) {
  // Scroll into view doesn't work on Grid because the first column
  // will always be hidden behind row number element. So we will always
  // move to the first column before opening menu, as scrolling right
  // does work (there are no absolute positioned elements there).
  await gu.sendKeys($.HOME);
  await gu.openColumnMenu(colName);
  const dir = (itemText === 'Sort ascending') ? 'asc' : 'dsc';
  return $(`.grist-floating-menu .test-sort-${dir}`).click();
}

describe('SortDates.ntest', function() {
  const cleanup = test.setupTestSuite(this);
  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "SortDates.grist", true);
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it("should display calculated DateTimes as valid", async function() {
    // Check that Dates and DateTimes returned from 'Any' formulas are displayed
    // as valid (rather than pink error values).
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4, 5, 6, 7], cols: [0, 1, 2, 3], mapper: valText}), [
      '2017-04-11', '2017-04-11 9:30am',  '2017-04-12',         '2017-04-12 09:30:00-04:00',
      '2017-07-13', '2017-07-13 4:00am',  '2017-07-14',         '2017-07-14 04:00:00-04:00',
      '!invalid1',  '!invalid2',          '!#TypeError',        '!#TypeError',
      '2017-05-01', '2017-05-01 7:00am',  '2017-05-02',         '2017-05-02 07:00:00-04:00',
      '2017-04-21', '2017-04-21 12:00pm', '2017-04-22',         '2017-04-22 12:00:00-04:00',
      '',           '',                   '',                   '',
      '2017-03-16', '2017-03-16 4:00pm',  '2017-03-17',         '2017-03-17 16:00:00-04:00',
    ]);
  });

  it('should sort correctly by Date or DateTime', async function() {
    // Check that we sort by the Date and DateTime column works as expected, even
    // when blanks or AltText is present.
    await gu.openSidePane('view');
    await gu.toggleSidePanel('left', 'close');
    await $('.test-config-sortAndFilter').click();

    // Sort by a special column first to rearrange. It's specially chosen to trigger some
    // previously incorrect comparisons that may cause wrong order. (The actual bug only existed
    // at the time of writing in the test case for Any formula columns returning Dates/DateTimes.)
    await clickColumnMenuSort('Order', 'Sort ascending');
    let orderRow = await $(".test-sort-config-row:contains(Order)").wait().elem();
    await assert.isPresent(orderRow);
    await assert.isPresent(orderRow.find(".test-sort-config-sort-order-asc"));
    await gu.getColumnHeader('Date').scrollIntoView({inline: "end"});
    await clickColumnMenuSort('Date', 'Sort ascending');
    const dateRow = await $(".test-sort-config-row:contains(Date)").wait().elem();
    await assert.isPresent(dateRow);
    await assert.isPresent(dateRow.find(".test-sort-config-sort-order-asc"));

    // Check that the data is now sorted.
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4, 5, 6, 7], cols: [0, 1, 2, 3], mapper: valText}), [
      '2017-03-16', '2017-03-16 4:00pm',  '2017-03-17',         '2017-03-17 16:00:00-04:00',
      '2017-04-11', '2017-04-11 9:30am',  '2017-04-12',         '2017-04-12 09:30:00-04:00',
      '2017-04-21', '2017-04-21 12:00pm', '2017-04-22',         '2017-04-22 12:00:00-04:00',
      '2017-05-01', '2017-05-01 7:00am',  '2017-05-02',         '2017-05-02 07:00:00-04:00',
      '2017-07-13', '2017-07-13 4:00am',  '2017-07-14',         '2017-07-14 04:00:00-04:00',
      '',           '',                   '',                   '',
      '!invalid1',  '!invalid2',          '!#TypeError',        '!#TypeError',
    ]);

    await clickColumnMenuSort('Order', 'Sort ascending');
    orderRow = await $(".test-sort-config-row:contains(Order)").wait().elem();
    await assert.isPresent(orderRow);
    await assert.isPresent(orderRow.find(".test-sort-config-sort-order-asc"));
    await clickColumnMenuSort('DTime', 'Sort descending');
    const dtimeRow = await $(".test-sort-config-row:contains(DTime)").wait().elem();
    await assert.isPresent(dtimeRow);
    await assert.isPresent(dtimeRow.find(".test-sort-config-sort-order-desc"));

    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4, 5, 6, 7], cols: [0, 1, 2, 3], mapper: valText}), [
      '!invalid1',  '!invalid2',          '!#TypeError',        '!#TypeError',
      '',           '',                   '',                   '',
      '2017-07-13', '2017-07-13 4:00am',  '2017-07-14',         '2017-07-14 04:00:00-04:00',
      '2017-05-01', '2017-05-01 7:00am',  '2017-05-02',         '2017-05-02 07:00:00-04:00',
      '2017-04-21', '2017-04-21 12:00pm', '2017-04-22',         '2017-04-22 12:00:00-04:00',
      '2017-04-11', '2017-04-11 9:30am',  '2017-04-12',         '2017-04-12 09:30:00-04:00',
      '2017-03-16', '2017-03-16 4:00pm',  '2017-03-17',         '2017-03-17 16:00:00-04:00',
    ]);
  });

  it('should sort correctly by Any returning Date or DateTime', async function() {
    // Formulas of type 'Any' returning a Date or DateTime involve comparison of complex values
    // (arrays) when sorting. Check that it works even in the presence of error values.

    await clickColumnMenuSort('Order', 'Sort ascending');
    let orderRow = await $(".test-sort-config-row:contains(Order)").wait().elem();
    await assert.isPresent(orderRow);
    await assert.isPresent(orderRow.find(".test-sort-config-sort-order-asc"));
    await clickColumnMenuSort('CalcDate', 'Sort ascending');
    let calcDateRow = await $(".test-sort-config-row:contains(CalcDate)").wait().elem();
    await assert.isPresent(calcDateRow);
    await assert.isPresent(calcDateRow.find(".test-sort-config-sort-order-asc"));

    // Check that the data is now sorted.
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4, 5, 6, 7], cols: [0, 1, 2, 3], mapper: valText}), [
      '',           '',                   '',                   '',
      '2017-03-16', '2017-03-16 4:00pm',  '2017-03-17',         '2017-03-17 16:00:00-04:00',
      '2017-04-11', '2017-04-11 9:30am',  '2017-04-12',         '2017-04-12 09:30:00-04:00',
      '2017-04-21', '2017-04-21 12:00pm', '2017-04-22',         '2017-04-22 12:00:00-04:00',
      '2017-05-01', '2017-05-01 7:00am',  '2017-05-02',         '2017-05-02 07:00:00-04:00',
      '2017-07-13', '2017-07-13 4:00am',  '2017-07-14',         '2017-07-14 04:00:00-04:00',
      '!invalid1',  '!invalid2',          '!#TypeError',        '!#TypeError',
    ]);

    await clickColumnMenuSort('Order', 'Sort ascending');
    orderRow = await $(".test-sort-config-row:contains(Order)").wait().elem();
    await assert.isPresent(orderRow);
    await assert.isPresent(orderRow.find(".test-sort-config-sort-order-asc"));
    await clickColumnMenuSort('CalcDTime', 'Sort descending');
    calcDateRow = await $(".test-sort-config-row:contains(CalcDTime)").wait().elem();
    await assert.isPresent(calcDateRow);
    await assert.isPresent(calcDateRow.find(".test-sort-config-sort-order-desc"));

    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4, 5, 6, 7], cols: [0, 1, 2, 3], mapper: valText}), [
      '!invalid1',  '!invalid2',          '!#TypeError',        '!#TypeError',
      '2017-07-13', '2017-07-13 4:00am',  '2017-07-14',         '2017-07-14 04:00:00-04:00',
      '2017-05-01', '2017-05-01 7:00am',  '2017-05-02',         '2017-05-02 07:00:00-04:00',
      '2017-04-21', '2017-04-21 12:00pm', '2017-04-22',         '2017-04-22 12:00:00-04:00',
      '2017-04-11', '2017-04-11 9:30am',  '2017-04-12',         '2017-04-12 09:30:00-04:00',
      '2017-03-16', '2017-03-16 4:00pm',  '2017-03-17',         '2017-03-17 16:00:00-04:00',
      '',           '',                   '',                   '',
    ]);
  });
});
