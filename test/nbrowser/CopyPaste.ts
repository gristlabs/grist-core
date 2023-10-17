/**
 * Test for copy-pasting Grist data.
 *
 * TODO Most of the testing for copy-pasting lives in test/nbrowser/CopyPaste.ntest.js.
 * This file just has some more recent additions to these test.
 */
import {arrayRepeat} from 'app/common/gutil';
import * as _ from 'lodash';
import {assert, driver, Key, WebElement} from 'mocha-webdriver';
import * as path from 'path';
import {serveStatic} from 'test/nbrowser/customUtil';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('CopyPaste', function() {
  this.timeout(90000);
  const cleanup = setupTestSuite();
  const clipboard = gu.getLockableClipboard();
  afterEach(() => gu.checkForErrors());
  gu.bigScreen();

  after(async function() {
    await driver.executeScript(removeDummyTextArea);
  });

  it('should allow pasting merged cells', async function() {
    // Test that we can paste uneven data, i.e. containing merged cells.

    // Serve a static file with a page containing a table with some merged cells.
    const serving = await serveStatic(path.join(gu.fixturesRoot, "sites/paste"));
    await driver.get(`${serving.url}/paste.html`);

    // Select everything in our little page.
    await driver.executeScript(`
      let range = document.createRange();
      range.selectNodeContents(document.querySelector('table'));
      let sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    `);

    await clipboard.lockAndPerform(async (cb) => {
      try {
        await cb.copy();
      } finally {
        await serving?.shutdown();
      }

      const session = await gu.session().login();
      await session.tempNewDoc(cleanup, 'CopyPaste');

      await gu.getCell({col: 'A', rowNum: 1}).click();
      await gu.waitAppFocus();
      await cb.paste();
    });
    await gu.waitForServer();

    await gu.checkForErrors();
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3, 4], cols: ['A', 'B']}), [
      'a', 'b',
      'c', '',
      'd', 'e',
      'f', '',
    ]);
  });

  it('should parse pasted numbers', async function() {
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, 'PasteParsing.grist');
    await driver.executeScript(createDummyTextArea);

    await copyAndCheck(clipboard, [
      '$1',        '1',
      '(2)',       '-2',
      '3e4',       '30000',
      '5,678.901', '5678.901',
      '23%',       '0.23',
      '45 678',    '45678',

      // . is a decimal separator in this locale (USA) so this can't be parsed
      '1.234.567', '1.234.567 INVALID',

      // Doesn't match the default currency of the document, whereas $ above does
      '€89',       '€89 INVALID',
    ], true);

    // Open the side panel for the numeric column.
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();

    // Switch to currency mode, and check the result.
    await driver.findContent('.test-numeric-mode .test-select-button', /\$/).click();

    // Same data, just formatted differently
    await checkGridCells([
      '$1',        '$1.00',
      '(2)',       '-$2.00',
      '3e4',       '$30,000.00',
      '5,678.901', '$5,678.90',
      '23%',       '$0.23',
      '45 678',    '$45,678.00',
      '1.234.567', '1.234.567 INVALID',
      '€89',       '€89 INVALID',
    ]);

    // Check that currency is set to 'Default currency' by default (where the default is local currency).
    assert.equal(await driver.find('.test-currency-autocomplete input').value(), 'Default currency (USD)');

    // Change column setting for currency to Euros
    await driver.findWait('.test-currency-autocomplete', 500).click();
    await driver.sendKeys("eur", Key.ENTER);
    await gu.waitForServer();

    // Same data, just formatted differently
    await checkGridCells([
      '$1',        '€1.00',
      '(2)',       '-€2.00',
      '3e4',       '€30,000.00',
      '5,678.901', '€5,678.90',
      '23%',       '€0.23',
      '45 678',    '€45,678.00',
      '1.234.567', '1.234.567 INVALID',
      '€89',       '€89 INVALID',
    ]);

    // Copy the numbers column into itself.
    // Values which were already parsed remain parsed since it copies the underlying numbers.
    await clipboard.lockAndPerform(async (cb) => {
      await copy(cb, 'Parsed');
    });
    await checkGridCells([
      '$1',        '€1.00',
      '(2)',       '-€2.00',
      '3e4',       '€30,000.00',
      '5,678.901', '€5,678.90',
      '23%',       '€0.23',
      '45 678',    '€45,678.00',
      '1.234.567', '1.234.567 INVALID',

      // This was invalid before, so it was copied as text.
      // This time it parsed successfully because the currency matches.
      '€89',       '€89.00',
    ]);

    await copyAndCheck(clipboard, [
      // Now we're copying from the text column so everything is parsed again.
      // $ can no longer be parsed now the currency is euros.
      '$1',        '$1 INVALID',

      '(2)',       '-€2.00',
      '3e4',       '€30,000.00',
      '5,678.901', '€5,678.90',
      '23%',       '€0.23',
      '45 678',    '€45,678.00',
      '1.234.567', '1.234.567 INVALID',
      '€89',       '€89.00',
    ], true);

    // Change the document locale
    await gu.openDocumentSettings();
    await driver.findWait('.test-locale-autocomplete', 500).click();
    await driver.sendKeys("Germany", Key.ENTER);
    await gu.waitForServer();
    await driver.navigate().back();

    // Same data, just formatted differently
    // Currency sign has moved to the end
    // Decimal separator is now ','
    // Digit group separator is now '.'
    await checkGridCells([
      '$1',        '$1 INVALID',
      '(2)',       '-2,00 €',
      '3e4',       '30.000,00 €',
      '5,678.901', '5.678,90 €',
      '23%',       '0,23 €',
      '45 678',    '45.678,00 €',
      '1.234.567', '1.234.567 INVALID',
      '€89',       '89,00 €',
    ]);

    // Copy the numbers column into itself.
    // Values which were already parsed don't change since it copies the underlying numbers.
    await clipboard.lockAndPerform(async (cb) => {
      await copy(cb, 'Parsed');
    });
    await checkGridCells([
      '$1',        '$1 INVALID',
      '(2)',       '-2,00 €',
      '3e4',       '30.000,00 €',
      '5,678.901', '5.678,90 €',
      '23%',       '0,23 €',
      '45 678',    '45.678,00 €',

      // This can be parsed for the first time now that '.'
      // is seen as a digit group separator
      '1.234.567', '1.234.567,00 €',

      '€89',       '89,00 €',
    ]);

    await copyAndCheck(clipboard, [
      '$1',        '$1 INVALID',
      '(2)',       '-2,00 €',
      '3e4',       '30.000,00 €',

      // Now we're copying from the text column so everything is parsed again.
      // The result in this case is not good:
      // '.' was simply removed because we don't check where it is
      // ',' is the decimal separator
      // So this is parsed as 5.678901
      // which rounds to 5.68 to two decimal places for the currency format
      '5,678.901', '5,68 €',

      '23%',       '0,23 €',
      '45 678',    '45.678,00 €',
      '1.234.567', '1.234.567,00 €',
      '€89',       '89,00 €',
    ], true);
  });

  it('should parse pasted dates', async function() {
    await gu.getPageItem("Dates").click();

    await copyAndCheck(clipboard, [
      '01-02-03',   '01-02-2003',
      '01 02 2003', '01-02-2003',
      '1/02/03',    '01-02-2003',
      '01/2/03',    '01-02-2003',
      '1/2/03',     '01-02-2003',
      '1/2/3',      '1/2/3 INVALID',
      '20/10/03',   '20-10-2003',
      '10/20/03',   '10/20/03 INVALID',
    ]);

    await gu.getCell({col: 'Parsed', rowNum: 1}).click();
    assert.equal(await gu.getDateFormat(), "DD-MM-YYYY");
    await gu.setDateFormat("MM-DD-YYYY");

    // Same data, just formatted differently
    await checkGridCells([
      '01-02-03',   '02-01-2003',
      '01 02 2003', '02-01-2003',
      '1/02/03',    '02-01-2003',
      '01/2/03',    '02-01-2003',
      '1/2/03',     '02-01-2003',
      '1/2/3',      '1/2/3 INVALID',
      '20/10/03',   '10-20-2003',
      '10/20/03',   '10/20/03 INVALID',
    ]);

    // Copy the parsed column into itself.
    // Values which were already parsed don't change since it copies the underlying values.
    await clipboard.lockAndPerform(async (cb) => {
      await copy(cb, 'Parsed');
    });

    await checkGridCells([
      '01-02-03',   '02-01-2003',
      '01 02 2003', '02-01-2003',
      '1/02/03',    '02-01-2003',
      '01/2/03',    '02-01-2003',
      '1/2/03',     '02-01-2003',
      '1/2/3',      '1/2/3 INVALID',
      '20/10/03',   '10-20-2003',
      '10/20/03',   '10-20-2003',  // can be parsed now
    ]);

    // Copy from the text column again, things get re-parsed
    await copyAndCheck(clipboard, [
      '01-02-03',   '01-02-2003',
      '01 02 2003', '01-02-2003',
      '1/02/03',    '01-02-2003',
      '01/2/03',    '01-02-2003',
      '1/2/03',     '01-02-2003',
      '1/2/3',      '1/2/3 INVALID',
      '20/10/03',   '20/10/03 INVALID',  // newly invalid
      '10/20/03',   '10-20-2003',
    ]);
  });

  // Note that these tests which reference other tables
  // assume that the previous tests have run.
  it('should parse pasted references', async function() {
    await gu.getPageItem("References").click();
    await gu.getCell({col: 'Parsed', rowNum: 1}).click();
    assert.equal(await gu.getRefTable(), "Dates");
    assert.equal(await gu.getRefShowColumn(), "Text");

    // Initially the References.Parsed column is displaying Dates.Text
    // No date parsing happens, we just see which strings exist in that column
    await copyAndCheck(clipboard, [
      '20/10/03', '20/10/03',
      '10/20/03', '10/20/03',
      '1/2/3',    '1/2/3',
      'foo',      'foo INVALID',
      '3',        '3 INVALID',
      '-2',       '-2 INVALID',
      '$1',       '$1 INVALID',
      '€89',      '€89 INVALID',
    ], true);

    await gu.setRefShowColumn("Parsed");

    // // Same data, just formatted differently
    await checkGridCells([
      // In the Parsed column, only the second value was parsed as an actual date
      // The others look invalid in the Dates table, but here they're valid references
      '20/10/03', '20/10/03',
      '10/20/03', '10-20-2003',
      '1/2/3',    '1/2/3',

      'foo',      'foo INVALID',
      '3',        '3 INVALID',
      '-2',       '-2 INVALID',
      '$1',       '$1 INVALID',
      '€89',      '€89 INVALID',
    ]);

    await copyAndCheck(clipboard, [
      '20/10/03', '20/10/03',
      '10/20/03', '10-20-2003',
      '1/2/3',    '1/2/3',
      'foo',      'foo INVALID',
      '3',        `3 INVALID`,
      '-2',       `-2 INVALID`,
      '$1',       `$1 INVALID`,
      '€89',      '€89 INVALID',
    ]);

    await gu.setRefShowColumn("Row ID");

    // Same data, just formatted differently
    await checkGridCells([
      '20/10/03', 'Dates[5]',
      '10/20/03', 'Dates[6]',
      '1/2/3',    'Dates[4]',
      'foo',      'foo INVALID',
      '3',        `3 INVALID`,
      '-2',       `-2 INVALID`,
      '$1',       `$1 INVALID`,
      '€89',      '€89 INVALID',
    ]);

    await copyAndCheck(clipboard, [
      '20/10/03', '20/10/03 INVALID',
      '10/20/03', '10/20/03 INVALID',
      '1/2/3',    '1/2/3 INVALID',
      'foo',      'foo INVALID',
      '3',        'Dates[3]',  // 3 is the only valid Row ID
      '-2',       '-2 INVALID',
      '$1',       '$1 INVALID',
      '€89',      '€89 INVALID',
    ]);

    await gu.setRefTable("Numbers");

    // These checks run with References.Parsed as both a Reference and Reference List column.
    async function checkRefsToNumbers() {
      await gu.setRefShowColumn("Row ID");

      await copyAndCheck(clipboard, [
        '20/10/03', '20/10/03 INVALID',
        '10/20/03', '10/20/03 INVALID',
        '1/2/3',    '1/2/3 INVALID',
        'foo',      'foo INVALID',
        '3',        'Numbers[3]',
        '-2',       '-2 INVALID',
        '$1',       '$1 INVALID',
        '€89',      '€89 INVALID',
      ], true);

      await gu.setRefShowColumn("Text");

      await copyAndCheck(clipboard, [
        '20/10/03', '20/10/03 INVALID',
        '10/20/03', '10/20/03 INVALID',
        '1/2/3',    '1/2/3 INVALID',
        'foo',      'foo INVALID',
        '3',        '3 INVALID',
        '-2',       '-2 INVALID',
        // These are the only strings that appear in Numbers.Text verbatim
        '$1',       '$1',
        '€89',      '€89',
      ]);

      await gu.setRefShowColumn("Parsed");

      // Same data, just formatted differently
      await checkGridCells([
        '20/10/03', '20/10/03 INVALID',
        '10/20/03', '10/20/03 INVALID',
        '1/2/3',    '1/2/3 INVALID',
        'foo',      'foo INVALID',
        '3',        '3 INVALID',
        '-2',       '-2 INVALID',
        '$1',       '$1',
        '€89',      '89,00 €',
      ]);

      await copyAndCheck(clipboard, [
        '20/10/03', '20/10/03 INVALID',
        '10/20/03', '10/20/03 INVALID',
        '1/2/3',    '1/2/3 INVALID',
        'foo',      'foo INVALID',
        '3',        '3 INVALID',  // parsed, but not a valid reference
        '-2',       '-2,00 €',
        '$1',       '$1',  // invalid in Numbers.parsed, but a valid reference
        '€89',      '89,00 €',
      ]);
    }

    await checkRefsToNumbers();

    // Copy the Parsed column into the same column in a forked document.
    // Because it's a different document, it uses the display values instead of the raw values (row IDs)
    // to avoid referencing the wrong rows.
    await clipboard.lockAndPerform(async (cb) => {
      await copy(cb, 'Parsed');
      await driver.get(await driver.getCurrentUrl() + "/m/fork");
      await gu.waitForDocToLoad();
      await driver.executeScript(createDummyTextArea);
      await gu.setRefShowColumn("Text");
      await paste(cb);
    });
    await checkGridCells([
      '20/10/03', '20/10/03 INVALID',
      '10/20/03', '10/20/03 INVALID',
      '1/2/3',    '1/2/3 INVALID',
      'foo',      'foo INVALID',
      '3',        '3 INVALID',
      '-2',       '-2,00 € INVALID',
      '$1',       '$1',
      '€89',      '89,00 € INVALID',
    ]);

    // Test the main copies with the Numbers table data not loaded in the browser
    // so the lookups get done in the data engine.
    await checkRefsToNumbers();

    // Now test that pasting the same values into a Reference List column
    // produces the same result (reflists containing a single reference)
    await gu.setType(/Reference List/, {apply: true});

    // Clear the Parsed column. Make sure we don't edit the column header.
    await gu.getCell({col: "Parsed", rowNum: 1}).click();
    await gu.getColumnHeader({col: "Parsed"}).click();
    await gu.sendKeys(Key.BACK_SPACE);
    await gu.waitForServer();

    await checkRefsToNumbers();
  });

  it('should parse pasted reference lists containing multiple values', async function() {
    async function checkMultiRefs() {
      await gu.setRefShowColumn("Row ID");

      await copyAndCheck(clipboard, [
        '"(2)",$1',     '"(2)",$1 INVALID',
        '$1,(2),22',    '$1,(2),22 INVALID',
        '["$1",-2]',    '["$1",-2] INVALID',
        '1,-2',         '1,-2 INVALID',
        '3,5',          'Numbers[3]\nNumbers[5]',  // only valid row IDs
        '-2,30000',     '-2,30000 INVALID',
        '7,0',          '7,0 INVALID',  // 0 is not a valid row ID
        '',             '',
      ]);

      await gu.setRefShowColumn("Text");

      await copyAndCheck(clipboard, [
        '"(2)",$1',     '(2)\n$1',  // only verbatim text
        '$1,(2),22',    '$1,(2),22 INVALID',  // 22 is invalid so whole thing fails
        '["$1",-2]',    '["$1",-2] INVALID',  // -2 is invalid because this is text, not parsed
        '1,-2',         '1,-2 INVALID',
        '3,5',          '3,5 INVALID',
        '-2,30000',     '-2,30000 INVALID',
        '7,0',          '7,0 INVALID',
        '',             '',
      ]);

      await gu.setRefShowColumn("Parsed");

      await copyAndCheck(clipboard, [
        '"(2)",$1',     '-2,00 €\n$1',
        '$1,(2),22',    '$1,(2),22 INVALID',
        '["$1",-2]',    '$1\n-2,00 €',
        '1,-2',         '1,-2 INVALID',
        '3,5',          '3,5 INVALID',
        '-2,30000',     '-2,00 €\n30.000,00 €',
        '7,0',          '7,0 INVALID',
        '',             '',
      ], true);
    }

    await gu.getPageItem("Multi-References").click();
    await gu.waitForServer();
    await gu.getCell({col: 'Parsed', rowNum: 1}).click();

    await checkMultiRefs();

    // Load the Numbers table data in the browser and check again
    await gu.getPageItem("Numbers").click();
    await gu.getPageItem("Multi-References").click();
    await gu.waitForServer();
    await checkMultiRefs();
  });

  it('should parse pasted choice lists', async function() {
    await gu.getPageItem("ChoiceLists").click();
    await gu.waitForServer();

    await copyAndCheck(clipboard, [
      '',                            '',
      'a',                           'a',

      // On the left, \n in text affects parsing and separates choices
      // On the right, \n is how choices are separated in .getText()
      // So the newlines on the two sides match, but also "e,f" -> "e\nf"
      'a b\nc d\ne,f',               'a b\nc d\ne\nf',

      // CSVs
      'a,b  ',                       'a\nb',
      '  "a  ", b,"a,b  "  ',        'a\nb\na,b',

      // JSON. Empty strings and null are removed
      ' ["a","b","a,b", null] ',     'a\nb\na,b',

      // Nested JSON is formatted as JSON or CSV depending on nesting level
      '["a","b",["a,b"], [["a,b"]], [["a", "b"], "c", "d"], "", "  "]',
      'a\nb\n"a,b"\n[["a,b"]]\n[["a", "b"], "c", "d"]',

      '[]',                          '',
    ], true);
  });

  it('should parse pasted datetimes', async function() {
    await gu.getPageItem("DateTimes").click();
    await gu.waitForServer();

    await copyAndCheck(clipboard, [
      '2021-11-12 22:57:17+03:00', '12-11-2021 21:57 SAST',  // note the 1-hour difference
      '2021-11-12 22:57:17+02:00', '12-11-2021 22:57 SAST',
      '12-11-2021 22:57:17 SAST',  '12-11-2021 22:57 SAST',
      '12-11-2021 22:57:17',       '12-11-2021 22:57 SAST',
      '12-11-2021 22:57:17 UTC',   '13-11-2021 00:57 SAST',  // note the 2-hour difference
      '12-11-2021 22:57:17 Z',     '13-11-2021 00:57 SAST',  // note the 2-hour difference
      // EST doesn't match the current timezone so it's rejected
      '12-11-2021 22:57:17 EST',   '12-11-2021 22:57:17 EST INVALID',
      // Date without time is allowed
      '12-11-2021',                '12-11-2021 00:00 SAST',
    ]);
  });
});


// mapper for getVisibleGridCells to get both text and whether the cell is invalid (pink).
// Invalid cells mean text that was not parsed to the column type.
async function mapper(el: WebElement) {
  let text = await el.getText();
  if (await el.find(".field_clip").matches(".invalid")) {
    text += " INVALID";
  }
  return text;
}

// Checks that the full grid is equal to the given argument
// The first column never changes, it's only included for readability of the test
async function checkGridCells(expected: string[]) {
  const actual = await gu.getVisibleGridCells({rowNums: _.range(1, 9), cols: ['Text', 'Parsed'], mapper});
  assert.deepEqual(actual, expected);
}

// Paste whatever's in the clipboard into the Parsed column
async function paste(cb: gu.IClipboard) {
  // Click the first cell rather than the column header so that it doesn't try renaming the column
  await gu.getCell({col: 'Parsed', rowNum: 1}).click();
  await cb.paste();
  await gu.waitForServer();
  await gu.checkForErrors();
}

// Copy the contents of fromCol into the Parsed column
async function copy(cb: gu.IClipboard, fromCol: 'Text' | 'Parsed') {
  await gu.getColumnHeader({col: fromCol}).click();
  await cb.copy();
  await paste(cb);
}

async function copyAndCheck(
  clipboard: gu.ILockableClipboard,
  expected: string[],
  extraChecks: boolean = false
) {
  await clipboard.lockAndPerform(async (cb) => {
    // Copy Text cells into the Parsed column
    await copy(cb, 'Text');
    await checkGridCells(expected);

    // Tests some extra features of parsing that don't really depend on the column
    // type and so don't need to be checked with every call to copyAndCheck
    if (extraChecks) {
      // With the text cells still in the clipboard, convert the clipboard from
      // rich data (cells) to plain text and confirm that it gets parsed the same way.
      // The cells are still selected, clear them all.
      await gu.sendKeys(Key.BACK_SPACE);
      await gu.waitForServer();
      assert.deepEqual(
        await gu.getVisibleGridCells({rowNums: _.range(1, 9), cols: ['Parsed']}),
        arrayRepeat(8, ''),
      );

      // Paste the text cells to the dummy textarea.
      await driver.find('#dummyText').click();
      await gu.waitAppFocus(false);
      await cb.paste();
    }
  });

  if (extraChecks) {
    await gu.sendKeys(await gu.selectAllKey());
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await gu.sendKeys(Key.BACK_SPACE);

      // Paste the now plain text and confirm that the resulting data is still the same.
      await gu.getCell({col: 'Text', rowNum: 1}).click();
      await gu.waitAppFocus();
      await paste(cb);
    });
    await checkGridCells(expected);

    // Check that copying from the Parsed column back into itself doesn't change anything.
    await clipboard.lockAndPerform(async (cb) => {
      await copy(cb, 'Parsed');
    });
    await checkGridCells(expected);
  }
}

function createDummyTextArea() {
  const textarea = document.createElement('textarea');
  textarea.style.position = "absolute";
  textarea.style.top = "0";
  textarea.style.height = "2rem";
  textarea.style.width = "16rem";
  textarea.id = 'dummyText';
  window.document.body.appendChild(textarea);
}

function removeDummyTextArea() {
  const textarea = document.getElementById('dummyText');
  if (textarea) {
    window.document.body.removeChild(textarea);
  }
}
