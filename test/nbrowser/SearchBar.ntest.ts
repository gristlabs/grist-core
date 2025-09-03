import { assert, driver } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';
import bluebird from 'bluebird';

function currentSectionDesc() {
  return $('.active_section .test-viewsection-title').text();
}

// Wrapping in bluebird allows an exception stack to report the line in the calling function too.
const checkMatch = bluebird.method(
  async function(sectionName: string, rowNum: number, col: number|string, value: string) {
    await $.wait(1000, async () => assert.deepEqual(await gu.getCursorPosition(), {rowNum, col}));
    assert.equal(await currentSectionDesc(), sectionName);
    assert.equal(await gu.getActiveCell().text(), value);
  });

describe('SearchBar.ntest', function() {
  const cleanup = test.setupTestSuite(this);

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "World.grist", true);
  });

  it('should support basic search', async function() {
    await $.wait(1000, async () => {
      assert.deepEqual(await gu.getCursorPosition(), {col: 0, rowNum: 1});
    });

    await $('.test-tb-search-icon').click();
    await driver.sleep(500);
    await $('.test-tb-search-option-all-pages').click();
    await $('.test-tb-search-input > input').click().sendKeys('que');
    assert.equal(await $('.test-tb-search-input > input').val(), "que");

    await $.wait(1000, async () => assert.include(await gu.getActiveCell().text(), "que"));
    await checkMatch('CITY', 103, 0, 'Albuquerque');

    // Hitting Enter scans forward.
    await gu.sendKeys($.ENTER);
    await checkMatch('CITY', 382, 1, 'Mozambique');

    // Typing more characters searches incrementally.
    await gu.sendKeys('tz');    // The search term is now "quetz".
    await checkMatch('CITY', 2922, 0, 'Quetzaltenango');

    await gu.sendKeys($.ENTER);
    await checkMatch('CITY', 2922, 2, 'Quetzaltenango');

    // Shortcut to search forward
    await gu.sendKeys([$.MOD, 'g']);
    await checkMatch('CITY Card List', 3911, 'Name', 'Quetzaltenango');

    // Shortcut to search backward
    await gu.sendKeys([$.MOD, $.SHIFT, 'g']);
    await checkMatch('CITY', 2922, 2, 'Quetzaltenango');
  });

  it('should release focus on escape, and select on focus', async function() {
    // Our starting position.
    await checkMatch('CITY', 2922, 2, 'Quetzaltenango');

    // Hit Escape while focused in search; it should lose focus.
    const searchBox = $('.test-tb-search-input > input');

    assert.equal(await searchBox.elem().hasFocus(), true);
    assert.equal(await searchBox.val(), "quetz");
    await gu.sendKeys($.ESCAPE);
    await gu.waitToPass(async () => {
      assert.equal(await searchBox.isDisplayed(), false);
    });
    assert.equal(await searchBox.elem().hasFocus(), false);
    assert.equal(await gu.getActiveCell().text(), "Quetzaltenango");

    // Typing should open a regular cell editor now.
    assert.equal(await $(".test-widget-text-editor").isPresent(), false);
    await gu.sendKeys("q");
    await gu.waitAppFocus(false);
    assert.equal(await $(".test-widget-text-editor").isPresent(), true);
    assert.equal(await $(".test-widget-text-editor textarea").val(), "q");

    // Escape should close cell editor without saving.
    await gu.sendKeys($.ESCAPE);
    await checkMatch('CITY', 2922, 2, 'Quetzaltenango');

    // Cmd-F should open the search box with old search term still available.
    await gu.sendKeys([$.MOD, 'f']);
    assert.equal(await searchBox.val(), "quetz");

    // Hitting Enter should resume search.
    await gu.sendKeys($.ENTER);
    await checkMatch('CITY Card List', 3911, 'Name', 'Quetzaltenango');

    // Search term should be selected, so new typing should override it. Type "iquel"
    await gu.sendKeys("iquel");
    await checkMatch('COUNTRY', 196, 1, 'Saint Pierre and Miquelon');
  });

  it('should search across tabs', async function() {
    // Go through a bunch more matches
    await gu.sendKeys($.ENTER);
    await checkMatch('COUNTRY', 196, 10, 'Saint-Pierre-et-Miquelon');

    await gu.sendKeys($.ENTER);
    await checkMatch('COUNTRY Card List', 1, 'Name', 'Saint Pierre and Miquelon');

    await gu.sendKeys($.ENTER);
    await checkMatch('COUNTRY Card List', 1, 'LocalName', 'Saint-Pierre-et-Miquelon');

    await gu.sendKeys($.ENTER);
    await checkMatch('COUNTRYLANGUAGE', 352, 1, 'Cakchiquel');

    // Now go back one to see that we switch back across a tab.
    await gu.sendKeys([$.MOD, $.SHIFT, 'g']);
    await checkMatch('COUNTRY Card List', 1, 'LocalName', 'Saint-Pierre-et-Miquelon');

    // And forward again.
    await gu.sendKeys($.ENTER);
    await checkMatch('COUNTRYLANGUAGE', 352, 1, 'Cakchiquel');

    await gu.sendKeys($.ENTER);
    await checkMatch('CITY', 3072, 1, 'Saint Pierre and Miquelon');

    // Until we finally come to where we started.
    await gu.sendKeys($.ENTER);
    await checkMatch('COUNTRY', 196, 1, 'Saint Pierre and Miquelon');

    // And we can continue cycling.
    await gu.sendKeys($.ENTER);
    await checkMatch('COUNTRY', 196, 10, 'Saint-Pierre-et-Miquelon');
  });

  it('should hide next/previous buttons if no match', async function() {
    // Check that next/previous buttons are enabled.
    await gu.waitToPass(async () => {
      assert.equal(await $('.test-tb-search-next').isPresent(), true);
    });
    assert.equal(await $('.test-tb-search-prev').isPresent(), true);

    // Check that next/previous buttons work.
    await $('.test-tb-search-prev').click();   // previous
    await checkMatch('COUNTRY', 196, 1, 'Saint Pierre and Miquelon');
    await $('.test-tb-search-next').click();   // previous
    await checkMatch('COUNTRY', 196, 10, 'Saint-Pierre-et-Miquelon');

    // Type 'x', to make nonexistent value in the search box.
    await gu.sendKeys([$.MOD, 'f'], $.RIGHT);
    await gu.sendKeys("x");

    // wait for buttons to be hidden
    await gu.waitToPass(async () => {
      assert.equal(await $('.test-tb-search-next').isPresent(), false);
    });
    assert.equal(await $('.test-tb-search-prev').isPresent(), false);
    assert.equal(await $(".test-tb-search-input > input").val(), "iquelx");

    // Check position is unchanged, and buttons don't work.
    await checkMatch('COUNTRY', 196, 10, 'Saint-Pierre-et-Miquelon');
    await gu.sendKeys([$.MOD, $.SHIFT, 'g']);  // previous
    await checkMatch('COUNTRY', 196, 10, 'Saint-Pierre-et-Miquelon');

    // check "no results" is shown
    assert.match(await $(".test-tb-search-input").text(), /No results/);

    // Make an existent value again, wait for buttons to become shown.
    await gu.sendKeys([$.MOD, 'f'], $.RIGHT);
    await gu.sendKeys($.BACK_SPACE);
    await gu.waitToPass(async () => {
      assert.equal(await $('.test-tb-search-next').isPresent(), true);
    });
    assert.equal(await $('.test-tb-search-prev').isPresent(), true);
    assert.equal(await $(".test-tb-search-input > input").val(), "iquel");

    // Check position is unchanged but buttons do work.
    await checkMatch('COUNTRY', 196, 10, 'Saint-Pierre-et-Miquelon');
    await $('.test-tb-search-prev').click();   // previous
    await checkMatch('COUNTRY', 196, 1, 'Saint Pierre and Miquelon');
  });
});
