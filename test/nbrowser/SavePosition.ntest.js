import { assert } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('SavePosition.ntest', function() {
  const cleanup = test.setupTestSuite(this);
  const clipboard = gu.getLockableClipboard();

  before(async function() {
    this.timeout(Math.max(this.timeout(), 20000)); // Long-running test, unfortunately
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "World.grist", true);
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it('should maintain cursor and scroll positions when switching between views', async function() {
    var recordSection = await gu.actions.viewSection('City');
    var cardSection = await gu.actions.viewSection('City Card List');
    var cardScrollPane = $('.detailview_scroll_pane');

    // Set up scroll linking between the two sections.
    await gu.openSidePane('view');
    await $('.test-config-data').click();

    // Connect CITY -> CITY Card List
    await gu.actions.viewSection('CITY Card List').selectSection();
    await $('.test-right-select-by').click();
    await $('.test-select-row:contains(CITY)').click();
    await gu.waitForServer();
    await gu.closeSidePane();

    await recordSection.selectSection();

    // Click on the District cell with row number 8.
    await gu.clickCellRC(7, 2);
    // Scroll to the Population cell with row number 22.
    await gu.getCellRC(21, 3).scrollIntoView();

    // Switch to card section, make a cursor selection and scroll selection.
    await cardSection.selectSection();

    var desiredCard = await cardScrollPane.findOldTimey('.g_record_detail .detail_row_num:contains(3150)').parent().elem();
    var desiredField = await desiredCard.findOldTimey('.g_record_detail_label:contains(Country)').parent().parent();
    await desiredField.click();
    await cardScrollPane.findOldTimey('.g_record_detail .detail_row_num:contains(3142)').scrollIntoView();

    // Switch tabs back and forth.
    await gu.actions.selectTabView('Country');
    await gu.actions.selectTabView('City');

    // Assert that the cursor position in the card section is the same.
    desiredCard = await cardScrollPane.findOldTimey('.g_record_detail .detail_row_num:contains(3150)').parent().elem();
    desiredField = await desiredCard.findOldTimey('.g_record_detail_label:contains(Country)').parent().parent();
    await assert.hasClass(desiredField.find('.selected_cursor'), 'active_cursor');

    // Assert that the element that was scrolled into view is still displayed.
    await assert.isDisplayed(cardScrollPane.findOldTimey('.g_record_detail .detail_row_num:contains(3142)'));

    await recordSection.selectSection();

    // Assert that the scroll position in the grid section is unchanged.
    await assert.isDisplayed(gu.getCellRC(21, 3));

    // Assert that the cursor position in the grid section is the same.
    await gu.scrollActiveViewTop();
    await gu.getCellRC(0, 0).wait(assert.isDisplayed);
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 8, col: 2 });
  });

  it('should maintain cursor with linked sections', async function() {
    // Switch to view 'Country' (which has several linked sections).
    await gu.actions.selectTabView('Country');

    // Select a position to the cursor in each section.
    await gu.getCell({col: 1, rowNum: 9, section: 'Country'}).click();
    await gu.getCell({col: 0, rowNum: 6, section: 'City'}).click();
    await gu.getCell({col: 2, rowNum: 2, section: 'CountryLanguage'}).click();
    await gu.getDetailCell({col: 'IndepYear', rowNum: 1, section: 'Country Card List'}).click();

    // Switch tabs back and forth.
    await gu.actions.selectTabView('City');
    await gu.actions.selectTabView('Country');

    // Verify the cursor positions.
    assert.deepEqual(await gu.getCursorPosition('Country'),
      {rowNum: 9, col: 1});
    assert.deepEqual(await gu.getCursorPosition('City'),
      {rowNum: 6, col: 0});
    assert.deepEqual(await gu.getCursorPosition('CountryLanguage'),
      {rowNum: 2, col: 2});
    assert.deepEqual(await gu.getCursorPosition('Country Card List'),
      {rowNum: 1, col: 'IndepYear'});
  });

  it('should paste into saved position', async function() {
    await gu.getCell({col: 1, rowNum: 9, section: 'Country'}).click();
    await gu.actions.selectTabView('City');
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await gu.actions.selectTabView('Country');
      await cb.paste();
    });
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells(1, [8, 9, 10]),
      ['United Arab Emirates', 'Pará', 'Armenia']);
  });
});
