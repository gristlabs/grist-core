import { assert, driver } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('Dates.ntest', function() {
  const cleanup = test.setupTestSuite(this);
  let doc;
  before(async function() {
    await gu.supportOldTimeyTestCode();
    doc = await gu.useFixtureDoc(cleanup, "Hello.grist", true);
    await gu.toggleSidePanel("left", "close");
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it('should allow correct datetime reformatting', async function() {
    await gu.openSidePane('field');

    var cell = await gu.getCellRC(0, 0);

    // Move to the first column
    await cell.click();
    await gu.sendKeys('2008-01-10 9:20pm', $.ENTER);

    // Change type to 'DateTime'
    await gu.setType('DateTime');
    await $('.test-tz-autocomplete').wait().click();
    await gu.sendKeys($.DELETE, 'UTC', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), '2008-01-10 9:20pm');
    await $('.test-type-transform-apply').wait().click();
    await gu.waitForServer();

    // Change timezone to 'America/Los_Angeles' and check that the date is correct
    await $('.test-tz-autocomplete').wait().click();
    await gu.sendKeys('Los An', $.ENTER);
    await gu.waitForServer();
    assert.equal(await $('.test-tz-autocomplete input').val(), 'America/Los_Angeles');
    assert.equal(await cell.text(), '2008-01-10 1:20pm');

    // Change format and check that date is reformatted
    await gu.dateFormat('MMMM Do, YYYY');
    await gu.timeFormat('HH:mm:ss z');
    assert.equal(await gu.getCellRC(0, 0).text(), 'January 10th, 2008 13:20:00 PST');

    // Change to custom format and check that the date is reformatted
    await gu.dateFormat('Custom');

    await $('$Widget_dateCustomFormat .kf_text').click();
    await gu.sendKeys($.SELECT_ALL, 'dddd', $.ENTER);
    await gu.timeFormat("Custom");
    await $('$Widget_timeCustomFormat .kf_text').click();
    await gu.sendKeys($.SELECT_ALL, 'Hmm', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), 'Thursday 1320');
  });

  it('should include a functioning datetime editor', async function() {
    var cell = await gu.getCellRC(0, 0);

    // DateTime editor should open, separate date and time, and replace incomplete format
    // with YYYY-MM-DD
    await cell.click();
    await gu.sendKeys($.ENTER);
    assert.equal(await $('.celleditor_text_editor').first().val(), '2008-01-10');

    // Date should be changable by clicking the calendar dates
    await $('.celleditor_text_editor').first().sendKeys($.DOWN);   // Opens date picker even if window has no focus.
    await $('.datepicker .day:contains(19)').wait().click();
    await gu.sendKeys($.ENTER);
    assert.equal(await cell.text(), 'Saturday 1320');

    // Date editor should convert Moment formats to datepicker safe formats
    // Date editor should allow tabbing between date and time entry boxes
    await gu.dateFormat('MMMM Do, YYYY');
    await gu.timeFormat('h:mma');
    await cell.click();
    await gu.sendKeys($.ENTER);
    assert.deepEqual(await $('.celleditor_text_editor').array().val(),
      ['January 19th, 2008', '1:20pm']);
    await gu.sendKeys($.SELECT_ALL, 'February 20th, 2009', $.TAB, '8:15am', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), 'February 20th, 2009 8:15am');

    // DateTime editor should close and save value when the user clicks away
    await cell.click();
    await gu.sendKeys($.ENTER, $.SELECT_ALL, $.DELETE);
    await gu.getCellRC(0, 3).click(); // click away
    await gu.waitForServer();
    // Since only the date value was removed, the cell should give AltText of the time value
    assert.equal(await cell.text(), '8:15am');
    assert.hasClass(await cell.find('.field_clip'), 'invalid');

    // DateTime editor should close and revert value when the user presses escape
    await cell.click();
    await gu.sendKeys($.ENTER, 'April 2, 1993', $.ESCAPE);
    assert.equal(await cell.text(), '8:15am');
  });

  it('should allow correct date reformatting', async function() {
    var cell = await gu.getCellRC(0, 1);

    // Move to the first column
    await cell.click();
    await gu.sendKeys('2016-01-08', $.ENTER);

    // Change type to 'Date'
    await gu.setType('Date');
    await $('.test-type-transform-apply').wait().click();
    await gu.waitForServer(); // Make sure type is set

    // Check that the date is correct
    await $('$Widget_dateFormat').wait();
    assert.equal(await cell.text(), '2016-01-08');

    // Change format and check that date is reformatted
    await gu.dateFormat('MMMM Do, YYYY');
    await gu.waitForServer();
    assert.equal(await cell.text(), 'January 8th, 2016');

    // Try another format
    await gu.dateFormat('DD MMM YYYY');
    await gu.waitForServer();
    assert.equal(await cell.text(), '08 Jan 2016');

    // Change to custom format and check that the date is reformatted
    await gu.dateFormat('Custom');
    await $('$Widget_dateCustomFormat .kf_text').click();
    await gu.sendKeys($.SELECT_ALL, 'dddd', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), 'Friday');
  });

  it('should include a functioning date editor', async function() {
    var cell = await gu.getCellRC(0, 1);

    // Date editor should open and replace incomplete format with YYYY-MM-DD
    await cell.click();
    await gu.sendKeys($.ENTER);
    assert.equal(await $('.celleditor_text_editor').val(), '2016-01-08');

    // Date should be changable by clicking the calendar dates
    await $('.celleditor_text_editor').sendKeys($.DOWN);   // Opens date picker even if window has no focus.
    await $('.datepicker .day:contains(19)').wait().click();
    await gu.sendKeys($.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), 'Tuesday');

    // Date editor should convert Moment formats to datepicker safe formats
    // Date editor should save the date on enter press
    await gu.dateFormat('MMMM Do, YYYY');
    await cell.click();
    await gu.sendKeys($.ENTER);
    assert.equal(await $('.celleditor_text_editor').val(), 'January 19th, 2016');
    await gu.sendKeys($.SELECT_ALL, 'February 20th, 2016', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), 'February 20th, 2016');

    // Date editor should close and save value when the user clicks away
    await cell.click();
    await gu.sendKeys($.ENTER, $.SELECT_ALL, $.DELETE);
    await gu.getCellRC(0, 3).click(); // click away
    await gu.waitForServer();
    assert.equal(await cell.text(), '');

    // Date editor should close and revert value when the user presses escape
    await cell.click();
    await gu.sendKeys($.ENTER, 'April 2, 1993', $.ESCAPE);
    assert.equal(await cell.text(), '');
  });

  it('should reload values correctly after reopen', async function() {
    await gu.getCellRC(0, 0).click();
    await gu.sendKeys('February 20th, 2009', $.TAB, '8:15am', $.ENTER);
    await gu.getCellRC(0, 1).click();
    await gu.sendKeys('January 19th, 1968', $.ENTER);
    await gu.getCellRC(1, 1).click();
    await gu.sendKeys($.DELETE);
    await gu.waitForServer();
    await gu.getCellRC(0, 2).click();
    await gu.waitAppFocus(true);
    await gu.sendKeys('=');
    await $('.test-editor-tooltip-convert').click();
    await gu.sendKeys('$A', $.ENTER);
    await gu.waitForServer();
    await gu.waitAppFocus(true);
    await gu.getCellRC(0, 3).click();
    await gu.sendKeys('=');
    await gu.waitAppFocus(false);
    await gu.sendKeys('$B', $.ENTER);
    await gu.waitForServer();

    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2], cols: ['A', 'B', 'C', 'D']}), [
      'February 20th, 2009 8:15am',
      'January 19th, 1968',
      '2009-02-20 08:15:00-08:00',
      '1968-01-19',
      '', '', '', ''
    ]);

    // We don't have a quick way to shutdown a document and reopen from scratch. So instead, we'll
    // make a copy of the document, and open that to test that values got saved correctly.
    // TODO: it would be good to add a way to reload document from scratch, perhaps by reloading
    // with a special URL fragment.
    await gu.copyDoc(doc.id, true);

    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2], cols: ['A', 'B', 'C', 'D']}), [
      'February 20th, 2009 8:15am',
      'January 19th, 1968',
      '2009-02-20 08:15:00-08:00',
      '1968-01-19',
      '', '', '', ''
    ]);
  });

  it('should support shortcuts to insert date/time', async function() {
    await gu.openSidePane('field');
    // Check the types of the first two columns.
    await gu.clickCellRC(0, 0);
    await gu.assertType('DateTime');
    await gu.clickCellRC(0, 1);
    await gu.assertType('Date');
    // Insert a few more columns: empty, Text, Numeric.
    await addColumn();
    await addColumn();
    await addColumn();
    await gu.clickCellRC(0, 3);
    await gu.setType('Numeric');
    await gu.clickCellRC(0, 4);
    await gu.setType('Text');

    // Override Date.now() and timezone in the current browser page to return a consistent value,
    // used e.g. for the default for the year and month.
    await driver.executeScript(
      "Date.now = () => 1477548296087; " +      // This value is 2016-10-27 02:04:56.087 EST
      "exposeModulesForTests().then(() => { " +
        "window.exposedModules.moment.tz.setDefault('America/New_York');" +
      "});"
    );

    async function fillWithShortcuts() {
      await gu.toggleSidePanel('right', 'close');

      // Type the Date-only shortcut into each cell in the second row.
      await gu.clickCellRC(1, 0);
      for (var i = 0; i < 6; i++) {
        await gu.sendKeys([$.MOD, ';'], $.TAB);
      }

      // Type the Date-Time shortcut into each cell in the third row.
      await gu.clickCellRC(2, 0);
      for (i = 0; i < 6; i++) {
        await gu.sendKeys([$.MOD, $.SHIFT, ';'], $.TAB);
      }
    }

    // Change document timezone to US/Hawaii (3 hours behind LA, which is TZ of the first column).
    // We check that shortcuts for Text/Any columns use the document timezone.
    await setGlobalTimezone('US/Hawaii');
    await fillWithShortcuts();
    // Compare the values. NOTE: this assumes EST timezone for the browser's local time.
    assert.deepEqual(await gu.getGridValues({rowNums: [2, 3], cols: [0, 1, 2, 3, 4]}), [
      // Note that column A has Los_Angeles timezone set, so time differs from Hawaii.
      // Note that Date column gets the date in Hawaii, not local or UTC (both 2016-10-27).
      // The originally empty column had its type guessed as Date when the current date was first entered,
      // hence "2016-10-26" appears in both rows.
      "October 26th, 2016 11:04pm", "October 26th, 2016", "2016-10-26", "0", "2016-10-26",
      "October 26th, 2016 11:04pm", "October 26th, 2016", "2016-10-26", "0", "2016-10-26 20:04:56",
    ]);

    // Undo the 8 cells we actually filled in, and check that the empty column reverted to Any
    await gu.undo(8);
    await gu.clickCellRC(1, 2);
    await gu.assertType('Any');

    // Change document timezone back to America/New_York.
    await setGlobalTimezone('America/New_York');
    await fillWithShortcuts();
    // Compare the values. NOTE: this assumes EST timezone for the browser's local time.
    assert.deepEqual(await gu.getGridValues({rowNums: [2, 3], cols: [0, 1, 2, 3, 4]}), [
      // Note that column A has Los_Angeles timezone set, so date differs by one from New_York.
      "October 26th, 2016 11:04pm", "October 27th, 2016", "2016-10-27", "0", "2016-10-27",
      "October 26th, 2016 11:04pm", "October 27th, 2016", "2016-10-27", "0", "2016-10-27 02:04:56",
    ]);
  });

  it('should allow navigating the datepicker with the keyboard', async function() {
    // Change the date using the datepicker.
    let cell = await gu.getCellRC(0, 1);
    await cell.scrollIntoView({inline: "end"}).click();
    await gu.sendKeys($.ENTER);
    await gu.waitAppFocus(false);
    await gu.sendKeys($.UP, $.UP, $.LEFT, $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), 'January 11th, 1968');

    // Do the same in the datetime editor.
    cell = await gu.getCellRC(1, 0);
    await cell.click();
    await gu.sendKeys($.ENTER);
    await gu.waitAppFocus(false);
    await gu.sendKeys($.UP, $.RIGHT, $.RIGHT, $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), 'October 28th, 2016 11:04pm');

    // Start navigating the datepicker, then start typing to return to using the cell editor.
    cell = await gu.getCellRC(1, 1);
    await cell.click();
    // The first backspace should return to cell edit mode, then the following keys should
    // change the year to 2009.
    await gu.sendKeys($.ENTER);
    await gu.waitAppFocus(false);
    await gu.sendKeys($.DOWN, $.RIGHT, $.BACK_SPACE, '9', $.LEFT, $.BACK_SPACE, '0', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), 'October 27th, 2009');
  });

  // NOTE: This addresses a bug where typical date entry formats were not recognized.
  // See https://phab.getgrist.com/T308
  it('should allow using common formats to enter the date', async function() {
    let cell = await gu.getCellRC(2, 1);
    await cell.click();
    await gu.sendKeys('April 2 1993', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), 'April 2nd, 1993');

    cell = await gu.getCellRC(1, 0);
    await cell.click();
    await gu.sendKeys('December', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), `December 1st, 2016 11:04pm`);

    cell = await gu.getCellRC(0, 1);
    await cell.click();
    await gu.sendKeys('7-Sep', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), `September 7th, 2016`);

    await cell.click();
    await gu.sendKeys('6/8', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), `June 8th, 2016`);

    // The selected format should take precedence over the default format when
    // parsing the date. Entering the same thing as before (6/8) will yield a different
    // result after changing the format.
    await gu.openSidePane('field');
    cell = await gu.getCellRC(1, 1);
    await cell.click();
    await gu.dateFormat('DD-MM-YYYY');
    await cell.click();
    await gu.sendKeys('6/8', $.ENTER);
    await gu.waitForServer();
    await gu.dateFormat('MMMM Do, YYYY');
    assert.equal(await cell.text(), `August 6th, 2016`);

    cell = await gu.getCellRC(2, 1);
    await cell.click();
    await gu.sendKeys('1937', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), `January 1st, 1937`);
  });

  it('should not attempt to parse non-dates', async function() {
    // Should allow AltText
    let cell = await gu.getCellRC(2, 1);
    await cell.click();
    await gu.sendKeys('Applesauce', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), 'Applesauce');
    await assert.hasClass(cell.find('.field_clip'), 'invalid');
    // Should allow AltText even of numbers that cannot be parsed as dates.
    // Manually entered numbers should not be read as timestamps.
    cell = await gu.getCellRC(1, 0);
    await cell.click();
    await gu.sendKeys('100000', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), '100000 11:04pm');
    await assert.hasClass(cell.find('.field_clip'), 'invalid');
    // Should give AltText if just the time is entered but not the date.
    cell = await gu.getCellRC(1, 0);
    await cell.click();
    await gu.sendKeys($.ENTER, $.TAB, '3', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), '100000 11:04pm 3');
    await assert.hasClass(cell.find('.field_clip'), 'invalid');
  });

  it("should allow working with naive date object", async function() {
    await gu.clickCellRC(0, 1);
    await gu.sendKeys([$.ALT, '=']);
    await gu.waitForServer();
    await gu.waitAppFocus(false);
    await gu.sendKeys("Diff", $.ENTER);
    await gu.waitForServer();
    await gu.sendKeys('=');
    await gu.waitAppFocus(false);
    await gu.sendKeys('($A-DTIME($B)).total_seconds()', $.ENTER);
    await gu.waitForServer();
    await gu.waitAppFocus();
    assert.deepEqual(await gu.getCellRC(0, 2).text(), '-230211900');

    // change global timezone should recompute formula
    await setGlobalTimezone('Paris');
    assert.deepEqual(await gu.getCellRC(0, 2).text(), '-230190300');
  });

  // NOTE: This tests a specific bug where AltText values in a column that has been coverted
  // to a date column do not respond to updates until refresh. This bug was exposed via the
  // error dom in FieldBuilder not being re-evaluated after a column transform.
  it('should allow deleting AltText values in a newly changed Date column', async function() {
    // Change the type to text and enter a text value.
    await gu.clickCellRC(0, 1);
    await gu.setType('Text');
    await gu.applyTypeConversion();
    await gu.clickCellRC(2, 1);
    await gu.sendKeys('banana', $.ENTER);
    await gu.waitForServer();
    assert.equal(await gu.getCellRC(2, 1).text(), 'banana');

    // Change back to Date and try to remove the text.
    await gu.setType('Date');
    await $('.test-type-transform-apply').wait().click();
    await gu.waitForServer();
    assert.equal(await gu.getCellRC(2, 1).text(), 'banana');
    await gu.clickCellRC(2, 1);
    await gu.sendKeys($.BACK_SPACE);
    await gu.waitForServer();
    assert.equal(await gu.getCellRC(2, 1).text(), '');
    await gu.undo();
  });

  it("should report informative error when AltText is used for date", async function() {
    // Enter a formula column that uses a date.
    await gu.clickCellRC(0, 1);
    await gu.sendKeys([$.ALT, '=']);
    await gu.waitForServer();
    await gu.sendKeys("Month", $.ENTER);
    await gu.waitForServer();
    await gu.sendKeys("=$B.month", $.ENTER);
    await gu.waitForServer();

    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: ['B', 'Month']}), [
      "June 8th, 2016",     "6",
      "August 6th, 2016",   "8",
      "banana",             "#Invalid Date: banana",
      "",                   "#AttributeError",
    ]);
  });

  it('should default timezone to document\'s timezone', async function() {
    // add a DateTime column
    await addDateTimeColumn();
    await gu.timeFormat('HH:mm:ss');
    // BUG: it is required to click somewhere after setting the type of a column for the shortcut to
    // work
    // TODO: removes gu.getCellRC(1, 3).click() below when its fixed
    await gu.getCellRC(1, 3).click();
    // get the current date
    await gu.sendKeys([$.MOD, $.SHIFT, ';']);
    await gu.waitForServer();
    const date1 = await gu.getCellRC(1, 3).text();
    // check default timezone
    assert.equal(await $('.test-tz-autocomplete input').val(), 'Europe/Paris');
    // set global document timezone to 'Europe/Paris'
    await setGlobalTimezone('America/Los_Angeles');
    // add another DateTime column
    await addDateTimeColumn();
    await gu.timeFormat('HH:mm:ss');
    // todo: same as for gu.getCellRC(1, 3).click();
    await gu.getCellRC(1, 4).click();
    // get the current date
    await gu.sendKeys([$.MOD, $.SHIFT, ';']);
    await gu.waitForServer();
    const date2 = await gu.getCellRC(1, 4).text();
    // check default timezone
    assert.equal(await $('.test-tz-autocomplete input').val(), 'America/Los_Angeles');
    // check that the delta between date1 and date2 is coherent with the delta between
    // 'Europe/Paris' and 'America/Los_Angeles' timezones.
    const delta = (new Date(date1) - new Date(date2)) / 1000 / 60 / 60;
    assert.isAbove(delta, 6);
    assert.isBelow(delta, 12);
  });
});

async function addDateTimeColumn() {
  await addColumn();
  return gu.setType('DateTime');
}

async function addColumn() {
  await gu.sendKeys([$.ALT, '=']);
  await gu.waitForServer();
  return gu.sendKeys($.ESCAPE);
}

async function setGlobalTimezone(name) {
  await $('.test-user-icon').click();   // open the user menu
  await $('.test-dm-doc-settings').click();
  await $('.test-tz-autocomplete').click();
  await $(`.test-acselect-dropdown li:contains(${name})`).click();
  await gu.waitForServer();
  await driver.navigate().back();
}
