import {addToRepl, assert, driver, Key, stackWrapFunc} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';


async function getActiveCellPos() {
  return [
    await driver.find('.gridview_data_row_num.selected').getText(),
    await driver.find('.column_name.selected').getText(),
  ];
}

// Move mouse and wait to make sure tooltip is gone.
const clearTooltip = stackWrapFunc(async (params?: {x?: number, y?: number}) => {
  await driver.mouseMoveBy(params);
  await gu.waitToPass(async () => {
    assert.equal(await driver.find('.test-tooltip').isPresent(), false);
  });
});

describe('Search', function() {
  this.timeout('25s');
  setupTestSuite();
  addToRepl('gu.searchIsOpened', gu.searchIsOpened);
  gu.bigScreen('big');

  it('should support basic search', async function() {
    // Log in and open the doc 'World'.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", 'nasa');
    await gu.importFixturesDoc('chimpy', 'nasa', 'Horizon', 'World.grist');

    // Check the initial cursor position.
    assert.deepEqual(await gu.getCursorPosition(), {col: 0, rowNum: 1});

    // Open the search input and enter a search term.
    await gu.search('que');

    // Check that Albequerque is found.
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 103, col: 0});
    assert.include(await gu.getActiveCell().getText(), 'Albuquerque');

    // Search forward.
    await gu.searchNext();
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 382, col: 1});
    assert.include(await gu.getActiveCell().getText(), 'Mozambique');

    // Typing more characters searches incrementally.
    await driver.sendKeys('tz');    // The search term is now "quetz".
    // Sleep for search debounce time
    await driver.sleep(120);

    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 2922, col: 0});
    assert.include(await gu.getActiveCell().getText(), 'Quetzaltenango');

    // Search forward by clicking
    await gu.searchNext();
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 2922, col: 2});
    assert.include(await gu.getActiveCell().getText(), 'Quetzaltenango');

    // Search backward by clicking
    await gu.searchPrev();
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 2922, col: 0});
    assert.include(await gu.getActiveCell().getText(), 'Quetzaltenango');

    // Search forward with keyboard
    await driver.sendKeys(Key.ENTER);
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 2922, col: 2});

    // Search backward with keyboard. Need to focus on the search text input.
    await driver.find('.test-tb-search-input > input').sendKeys(Key.chord(Key.SHIFT, Key.ENTER));
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 2922, col: 0});
  });

  it('should support `Mod+f`, `Mod+g`, `Mod+Shift+G` shortcuts', async () => {

    // send ESC to close the search
    await gu.closeSearch();

    // check that the search bar is closed
    await gu.searchIsClosed();

    // send Mode+UP to move to the first row
    await driver.find('body').sendKeys(Key.chord(await gu.modKey(), Key.UP));

    // set cursor on the first cell
    await gu.getCell({col: 0, rowNum: 1}).click();

    // Send Mod+f
    await driver.find('body').sendKeys(Key.chord(await gu.modKey(), 'f'));
    await driver.sleep(500);

    // check that search bar is opened
    await gu.searchIsOpened();

    // type `que`
    await gu.selectAll();
    await driver.sendKeys('que');
    await driver.sleep(120);

    // check that Albuquerque is selected
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 103, col: 0});
    assert.include(await gu.getActiveCell().getText(), 'Albuquerque');

    // type Mod+g to search forward
    const searchInputInput = await driver.find('.test-tb-search-input input');
    await searchInputInput.sendKeys(Key.chord(await gu.modKey(), 'g'));
    await driver.sleep(120);

    // check that Mozambique is found
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 382, col: 1});
    assert.include(await gu.getActiveCell().getText(), 'Mozambique');

    // send Mod + shift + G to search backward
    await searchInputInput.sendKeys(Key.chord(await gu.modKey(), Key.SHIFT, 'g'));
    await driver.sleep(120);

    // check that Albuquerque is found
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 103, col: 0});
    assert.include(await gu.getActiveCell().getText(), 'Albuquerque');
  });

  it('should support option to search only current page', async () => {
    // select all
    await gu.selectAll();

    // enter 'Aruba'
    await driver.sendKeys('Aruba');

    // check 'Aruba' is selected
    await gu.waitToPass(async () => (
      assert.include(await gu.getActiveCell().getText(), 'Aruba')
    ), 200);

    // check page is 'City' and section is 'CITY'
    assert.equal(await gu.getCurrentPageName(), 'City');
    assert.equal(await gu.getActiveSectionTitle(), 'CITY');

    // check that search bar is opened
    await gu.searchIsOpened();

    // check search all pages option is unchecked
    assert.equal(await driver.find('.test-tb-search-option-all-pages input').matches(':checked'), false);

    // click next
    await gu.searchNext();

    // check page is 'City' and section is 'CITY'
    assert.equal(await gu.getCurrentPageName(), 'City');
    assert.equal(await gu.getActiveSectionTitle(), 'CITY');

    // check active cell is
    assert.deepEqual(await getActiveCellPos(), ['2614', 'Country']);

    // click next again and check cursor did not move
    assert.equal(await gu.getCurrentPageName(), 'City');
    assert.equal(await gu.getActiveSectionTitle(), 'CITY');
    assert.deepEqual(await getActiveCellPos(), ['2614', 'Country']);

    await clearTooltip({y: 100});

    // click option 'search all pages'
    await driver.find('.test-tb-search-option-all-pages').click();

    // check search all pages option is checked
    assert.equal(await driver.find('.test-tb-search-option-all-pages input').matches(':checked'), true);

    // make sure tooltip is gone
    await clearTooltip({y: 100});

    // click next
    await gu.searchNext();

    // check page is 'Country' and section is 'COUNTRY'
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCurrentPageName(), 'Country');
      assert.equal(await gu.getActiveSectionTitle(), 'COUNTRY');
      assert.deepEqual(await getActiveCellPos(), ['1', 'Name']);
    }, 1000);
  });

  it('should allow to find other hits when user turns the multipage option ON', async () => {
    // switch to page CountryLanguage
    await gu.getPageItem(/CountryLanguage/).click();
    await gu.waitForDocToLoad();

    // open the search input
    await gu.waitToPass(async () => {
      await gu.searchIsClosed();
      await driver.find('.test-tb-search-icon').doClick();
      await gu.waitToPass(gu.searchIsOpened, 500);
    }, 1500);

    // click the multipage option and check it is unchecked
    await gu.waitToPass(async () => {
      await driver.find('.test-tb-search-option-all-pages').click();
      assert.equal(await driver.find('.test-tb-search-option-all-pages input').matches(':checked'), false);
    });

    // type in Aruba
    await gu.selectAll();
    await driver.sendKeys('Aruba');

    // check matches 'No results'
    await gu.hasNoResult();

    // click the multipage option
    await driver.find('.test-tb-search-option-all-pages').click();

    // check 'No results' is gone
    await gu.hasSomeResult();

    // click next btn
    await gu.searchNext();

    // check finds hits on next page
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCurrentPageName(), 'City');
      assert.equal(await gu.getActiveSectionTitle(), 'CITY');
      assert.deepEqual(await getActiveCellPos(), ['2614', 'Country']);
    }, 100);
  });

  it('should allow to find other hits when user switch pages', async () => {

    // clear tooltip
    await clearTooltip({y: 100});

    // uncheck the multipage option
    await gu.toggleSearchAll();

    // check it is unchecked
    assert.equal(await driver.find('.test-tb-search-option-all-pages input').matches(':checked'), false);

    // switch to page country language
    await gu.getPageItem(/CountryLanguage/).click();
    await gu.waitForDocToLoad();
    await gu.waitToPass(gu.searchIsClosed);
    await driver.sleep(100);

    // open search bar
    await gu.waitToPass(async () => {
      await gu.searchIsClosed();
      await driver.find('.test-tb-search-icon').doClick();
      await gu.waitToPass(gu.searchIsOpened, 500);
    }, 1500);

    // type in aruba
    await gu.selectAll();
    await driver.sendKeys('Aruba');

    // check there are no results
    await gu.hasNoResult();

    // switch to page City
    await gu.getPageItem(/City/).click();
    await gu.waitForDocToLoad();

    // open search bar
    await gu.waitToPass(async () => {
      await gu.searchIsClosed();
      await driver.find('.test-tb-search-icon').doClick();
      await gu.waitToPass(gu.searchIsOpened, 500);
    }, 1500);

    // click next
    await gu.waitToPass(() => driver.find('.test-tb-search-next').click());

    // check it found match
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCurrentPageName(), 'City');
      assert.equal(await gu.getActiveSectionTitle(), 'CITY');
      assert.deepEqual(await getActiveCellPos(), ['2614', 'Country']);
    }, 100);
  });
});
