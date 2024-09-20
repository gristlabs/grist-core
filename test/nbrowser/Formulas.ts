import {assert, driver, Key, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

async function checkHasLinkStyle(elem: WebElement, yesNo: boolean) {
  assert.equal(await elem.getCssValue('text-decoration-line'), yesNo ? 'underline' : 'none');
}


describe('Formulas', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  let session: gu.Session;
  let docId: string;

  after(async function() {
    // In case of an error, close any open autocomplete and cell editor, to ensure we don't
    // interfere with subsequent tests by unsaved value triggering an alert on unload.
    await driver.sendKeys(Key.ESCAPE);
    await driver.sendKeys(Key.ESCAPE);
  });

  before(async function() {
    session = await gu.session().login();
    docId = (await session.tempDoc(cleanup, 'Favorite_Films.grist')).id;
  });

  it('should highlight column in full edit mode', async function() {
    await gu.addColumn('A');
    await gu.addColumn('B');
    await gu.addColumn('C');
    // Make sure we are not in edit mode, finding column C is enough.
    await gu.getColumnHeader({ col : 'C'});
    await driver.sendKeys('=');
    await gu.waitAppFocus(false);
    if (await driver.find('.test-editor-tooltip-convert').isPresent()) {
      await driver.find('.test-editor-tooltip-convert').click();
    }
    await driver.sendKeys(" ");
    // Make sure we are now in edit mode.
    await gu.getColumnHeader({ col : '$C'});
    // Move mouse over other column, and make sure it is highlighted
    const hoverOver = async (col: string) =>
      await driver.withActions((actions) => (
        actions
          .move({origin: gu.getCell(col, 1)})
          .move({origin: gu.getCell(col, 2)})
      ));
    const tooltipId = '.test-column-formula-tooltip';
    // Helper to test if hover is on right column.
    const isHoverOn = async (col: string) => {
      // Make sure we have only 1 tooltip.
      assert.equal(1, (await driver.findAll(tooltipId)).length);
      // Make sure column has hover class.
      assert.isTrue(await gu.getColumnHeader({ col }).matches(".hover-column"));
      // Make sure first row has hover class.
      assert.isTrue(await gu.getCell(col, 1).matches(".hover-column"));
      // Make sure tooltip shows correct text.
      assert.equal(`Click to insert ${col}`, await driver.find(tooltipId).getText());
    };
    // Helper to test that no column is in hover state.
    const noHoverAtAll = async () => {
      // No tooltip is present.
      assert.equal(0, (await driver.findAll(tooltipId)).length);
      // Make sure no column has hover class.
      assert.equal(0, (await driver.findAll(".hover-column")).length);
    };
    // Helper to test that column is not in hover state
    const noHoverOn = async (col: string) => {
      // Header doesn't have hover class
      assert.isFalse(await gu.getColumnHeader({ col }).matches(".hover-column"));
      // Fields don't have hover class
      assert.isFalse(await gu.getCell(col, 1).matches(".hover-column"));
      // If there is a tooltip, it doesn't have text with this column
      if ((await driver.findAll(tooltipId)).length) {
        assert.notEqual(`Click to insert ${col}`, await driver.find(tooltipId).getText());
      }
    };
    await hoverOver('$A');
    await isHoverOn('$A');
    await noHoverOn('$B');
    // Make sure tooltip is closed and opened on another column.
    await hoverOver('$B');
    await isHoverOn('$B');
    await noHoverOn('$A');

    // Make sure it is closed when leaving rows from the corners:
    // - First moving on the row number
    await hoverOver('$A');
    await isHoverOn('$A');
    await driver.withActions((actions) => actions.move({origin: driver.find('.gridview_data_row_num')}));
    await noHoverAtAll();
    // - Moving over add button
    await hoverOver('$A');
    await isHoverOn('$A');
    await driver.withActions((actions) => actions.move({origin: driver.find('.mod-add-column')}));
    await noHoverAtAll();
    // - Moving below last row
    await hoverOver('$A');
    await isHoverOn('$A');
    await driver.withActions((actions) =>
      actions
        .move({origin: gu.getCell('$A', 7)})
        .move({origin: gu.getCell('$A', 7), y : 22 + 1})
    );
    await noHoverAtAll();
    // - Moving right after last column
    await hoverOver('$A');
    await isHoverOn('$A');
    // First move to the last cell,
    await driver.withActions((actions) =>
      actions
        .move({origin: gu.getCell("$C", 7)}) // move add row on last column
    );
    await isHoverOn('$C');
    await noHoverOn('$A');
    // and then a little bit to the right (100px is width of the field)
    await driver.withActions((actions) =>
      actions
        .move({origin: gu.getCell("$C", 7), x : 100 + 1})
    );
    await noHoverAtAll();

    // - Moving mouse on top of the grid.
    await hoverOver('$A');
    await isHoverOn('$A');
    // move on the A header,
    await driver.withActions((actions) => actions.move({origin: gu.getColumnHeader({ col : '$A' })}));
    // still hover should be on A column,
    await isHoverOn('$A');
    // and now jump out of the grid (22 is height of the row)
    await driver.withActions((actions) => actions.move({origin: gu.getColumnHeader({ col : '$A' }), y : -22 - 3}));
    await noHoverAtAll();
    // undo adding 3 columns
    await driver.sendKeys(Key.ESCAPE);
    await gu.undo(3);
    await gu.checkForErrors();
  });

  it('should evaluate formulas requiring lazy-evaluation', async function() {
    await gu.renameColumn({col: 'Budget (millions)'}, 'Budget');

    await gu.addColumn('A');
    await gu.enterFormula('IFERROR($Invalid if $Budget > 50 else $Budget, "X")');
    assert.deepEqual(await gu.getVisibleGridCells('A', [1, 2, 3]), ['30', 'X', '10']);

    await gu.addColumn('B');
    // This formula triggers an error for one cell, AltText for another.
    await gu.enterFormula('($Budget - 30) / ($Budget - 10) or "hello"');
    await gu.setType(/Numeric/);
    assert.deepEqual(await gu.getVisibleGridCells('B', [1, 2, 3]), ['hello', '0.5555555556', '#DIV/0!']);

    // ISERROR considers exceptions and AltText values.
    await gu.addColumn('C');
    await gu.enterFormula('ISERROR($B)');
    assert.deepEqual(await gu.getVisibleGridCells('C', [1, 2, 3]), ['true', 'false', 'true']);

    // ISERR considers exceptions but not AltText values.
    await gu.addColumn('D');
    await gu.enterFormula('(ISERR($B)');
    assert.deepEqual(await gu.getVisibleGridCells('D', [1, 2, 3]), ['false', 'false', 'true']);
  });

  it('should support formulas returning unmarshallable or weird values', async function() {
    // Formulas can return strange values, and Grist should do a reasonable job displaying them.
    // In particular, this verifies a fix to a bug where some values could cause an error that
    // looked like a crash of the data engine.
    await gu.getCell({rowNum: 1, col: 'A'}).click();

    // Our goal is to test output of formulas, so skip the slow and flaky typing in of a long
    // multi-line formula, use API to set it instead.
    const api = session.createHomeApi();
    await api.applyUserActions(docId, [['ModifyColumn', 'Films', 'A', {
      isFormula: true,
      formula: `\
import enum
class Int(int):
  pass
class Float(float):
  pass
class Text(str):
  pass
class MyEnum(enum.IntEnum):
  ONE = 1
class FussyFloat(float):
  def __float__(self):
    raise TypeError("Cannot cast FussyFloat to float")

if $id > 1:
  return None
return [
  -17, 0.0, 12345678901234567890, 1e-20, True,
  Int(5), MyEnum.ONE, Float(3.3), Text('Hello'),
  datetime.date(2024, 9, 2), datetime.datetime(2024, 9, 2, 3, 8, 21),
  FussyFloat(17.0), [Float(6), '', MyEnum.ONE]
]
`
    }]]);

    // Wait for the row we expect to become empty, to ensure the formula got processed.
    await gu.waitToPass(async () => assert.equal(await gu.getCell({rowNum: 2, col: 'A'}).getText(), ""));
    // Check the result of the formula: normal return, values correspond to what we asked.
    const expected = `\
[-17, 0, 12345678901234567890, 1e-20, true, \
5, 1, 3.3, "Hello", \
2024-09-02, 2024-09-02T03:08:21.000Z, \
17.0, [6, "", 1]]`;
    assert.deepEqual(await gu.getVisibleGridCells('A', [1, 2, 3]), [expected, '', '']);
  });

  it('should strip out leading equal-sign users might think is needed', async function() {
    await gu.getCell({rowNum: 1, col: 'A'}).click();
    await gu.enterFormula('$Budget*10');
    assert.deepEqual(await gu.getVisibleGridCells('A', [1, 2, 3]), ['300', '550', '100']);
    await gu.enterFormula('= $Budget*100');
    assert.deepEqual(await gu.getVisibleGridCells('A', [1, 2, 3]), ['3000', '5500', '1000']);

    await gu.sendKeys(Key.ENTER);
    assert.equal(await gu.getFormulaText(), ' $Budget*100');
    await gu.sendKeys(Key.ESCAPE);
    await gu.undo(2);
  });

  it('should not fail when formulas have valid indent or leading whitespace', async function() {
    await gu.getCell({rowNum: 1, col: 'A'}).click();

    await gu.enterFormula("  $Budget * 10");
    assert.deepEqual(await gu.getVisibleGridCells('A', [1, 2, 3]), ['300', '550', '100']);

    await driver.sendKeys('=');
    await gu.waitAppFocus(false);
    // A single long string often works, but sometimes fails, so break up into multiple.
    await gu.sendKeysSlowly(`  if $Budget > 50:${Key.chord(Key.SHIFT, Key.ENTER)}`);
    await driver.sleep(50);
    // The next line should get auto-indented.
    await gu.sendKeysSlowly(`return 'Big'${Key.chord(Key.SHIFT, Key.ENTER)}`);
    await driver.sleep(50);
    // In the next line, we want to remove one level of indent.
    await gu.sendKeysSlowly(`${Key.BACK_SPACE}return 'Small'`);
    await gu.sendKeys(Key.ENTER);
    await gu.waitForServer();

    await gu.sendKeys(Key.ENTER);
    assert.equal(await gu.getFormulaText(), "  if $Budget > 50:\n    return 'Big'\n  return 'Small'");
    await gu.sendKeys(Key.ESCAPE);

    assert.deepEqual(await gu.getVisibleGridCells('A', [1, 2, 3]), ['Small', 'Big', 'Small']);

    await gu.undo(2);
  });

  it('should support autocompletion from lowercase values', async function() {
    await gu.toggleSidePanel('right', 'close');
    await gu.getCell({rowNum: 1, col: 'A'}).click();
    await driver.sendKeys('=');
    await gu.waitAppFocus(false);

    // Type in "me", and expect uppercase completions like "MEDIAN".
    await driver.sendKeys('me');
    await gu.waitToPass(async () =>
      assert.includeMembers(await driver.findAll('.ace_autocomplete .ace_line', el => el.getText()), [
        "ME\nDIAN\n(value, *more_values)\n ",
        "me\nmoryview(\n ",
      ])
    );

    // Using a completion of a function with signature should only insert an appropriate snippet.
    await driver.sendKeys(Key.DOWN);
    await driver.sendKeys(Key.ENTER);
    await driver.findContentWait('.ace_content', /^MEDIAN\($/, 1000);
    await driver.sendKeys(Key.ESCAPE);
    await gu.waitAppFocus(true);

    // Check that this works also for table names ("fri" finds "Friends")
    await driver.sendKeys('=');
    await gu.waitAppFocus(false);
    await driver.sendKeys('fri');
    await gu.waitToPass(async () => {
      const completions = await driver.findAll('.ace_autocomplete .ace_line', el => el.getText());
      assert.isTrue(completions[0].startsWith("Fri\nends"));
      assert.isTrue(completions[1].startsWith("Fri\nends.\nlookupOne\n(colName=<value>, ...)"));
      assert.isTrue(completions[2].startsWith("Fri\nends.\nlookupRecords\n(colName=<value>, ...)"));
      assert.isTrue(completions[3].startsWith("Fri\nends.lookupRecords(Favorite_Film=$id)"));
    });
    await driver.sendKeys(Key.DOWN, Key.ENTER);

    // Check that completing a table's method suggests lookup methods with signatures.
    await driver.sendKeys('.');
    await gu.waitToPass(async () => {
      const completions = await driver.findAll('.ace_autocomplete .ace_line', el => el.getText());
      assert.isTrue(completions[0].startsWith("Friends.\nall"));
      assert.isTrue(completions[1].startsWith("Friends.\nlookupOne\n(colName=<value>, ...)"));
      assert.isTrue(completions[2].startsWith("Friends.\nlookupRecords\n(colName=<value>, ...)"));
      assert.isTrue(completions[3].startsWith("Friends.\nlookupRecords(Favorite_Film=$id)"));
      assert.isTrue(completions[4].startsWith("Friends.\nRecord"));
      assert.isTrue(completions[5].startsWith("Friends.\nRecordSet"));
    });

    // Check that selecting a table method inserts an appropriate snippet.
    await driver.sendKeys(Key.DOWN, Key.DOWN, Key.ENTER);
    await driver.findContentWait('.ace_content', /^Friends\.lookupOne\($/, 1000);
    await driver.sendKeys(Key.ESCAPE, Key.ESCAPE);
    await gu.waitAppFocus(true);

    // Check that some built-in values are recognized in lowercase.
    async function testBuiltin(typedText: string, expectedCompletion: string) {
      await driver.sendKeys('=');
      await gu.waitAppFocus(false);
      await driver.sendKeys(typedText);
      await gu.waitToPass(async () =>
        assert.include(await driver.findAll('.ace_autocomplete .ace_line', el => el.getText()), expectedCompletion));
      await driver.sendKeys(Key.ESCAPE, Key.ESCAPE);
      await gu.waitAppFocus(true);
    }
    await testBuiltin('tr', 'Tr\nue\n ');
    await testBuiltin('fa', 'Fa\nlse\n ');
    await testBuiltin('no', 'No\nne\n ');
  });

  it('should link some suggested functions to their documentation', async function() {
    await gu.getCell({rowNum: 1, col: 'A'}).click();
    await driver.sendKeys('=');
    await gu.waitAppFocus(false);
    await driver.sendKeys('me');

    await gu.waitToPass(async () => {
      const completions = await driver.findAll('.ace_autocomplete .ace_line');
      assert.include(await completions[0].getText(), 'ME\nDIAN\n(value, *more_values)\n ');
      assert.include(await completions[1].getText(), 'me\nmoryview(\n ');

      // Check that the link is rendered with an underline.
      await checkHasLinkStyle(completions[0].findContent('span', /ME/), true);
      await checkHasLinkStyle(completions[0].findContent('span', /DIAN/), true);
      await checkHasLinkStyle(completions[0].findContent('span', /value/), false);
    });

    // Click the link part: it should open a new tab to a documentation URL.
    await driver.findContent('.ace_autocomplete .ace_line span', /DIAN/).click();
    // Switch to the new tab, and wait for the page to load.
    let handles = await driver.getAllWindowHandles();
    await driver.switchTo().window(handles[1]);
    await gu.waitForUrl('support.getgrist.com');
    assert.equal(await driver.getCurrentUrl(), 'https://support.getgrist.com/functions/#median');
    await driver.close();
    await driver.switchTo().window(handles[0]);

    // Click now a part of the completion that's not the link. It should insert the suggestion.
    await driver.findContent('.ace_autocomplete .ace_line span', /value/).click();
    await driver.findContentWait('.ace_content', /^MEDIAN\($/, 1000);
    await driver.sendKeys(Key.ESCAPE);
    await gu.waitAppFocus(true);

    // Check that this works also for table names ("fri" finds "Friends")
    await driver.sendKeys('=');
    await gu.waitAppFocus(false);
    await driver.sendKeys('Friends.');
    // Formula autocompletions in Ace editor are flaky (particularly when on a busy machine where
    // setTimeout of 0 may take longer than expected). If the completion didn't work the first
    // time, re-type the last character to trigger it again. This seems reliable.
    if (!await driver.findContentWait('.ace_autocomplete .ace_line', 'Friends.\nRecord\n ', 500).catch(() => false)) {
      await driver.sendKeys(Key.BACK_SPACE, '.');
    }

    await gu.waitToPass(async () => {
      const completions = await driver.findAll('.ace_autocomplete .ace_line');
      assert.include(await completions[0].getText(), 'Friends.\nall\n ');
      assert.include(await completions[1].getText(), 'Friends.\nlookupOne\n(colName=<value>, ...)\n');
      assert.include(await completions[2].getText(), 'Friends.\nlookupRecords\n(colName=<value>, ...)\n');
      assert.include(await completions[3].getText(), 'Friends.\nlookupRecords(Favorite_Film=$id)\n ');
      assert.include(await completions[4].getText(), 'Friends.\nRecord\n ');
      assert.include(await completions[5].getText(), 'Friends.\nRecordSet\n ');

      await checkHasLinkStyle(completions[1].findContent('span', /Friends/), false);
      await checkHasLinkStyle(completions[1].findContent('span', /lookupOne/), true);
      await checkHasLinkStyle(completions[1].findContent('span', '('), false);
      await checkHasLinkStyle(completions[2].findContent('span', /Friends/), false);
      await checkHasLinkStyle(completions[2].findContent('span', /lookupRecords/), true);
    }, 4000);

    // Again, click the link part.
    await driver.findContent('.ace_autocomplete .ace_line span', /lookupRecords/).click();
    handles = await driver.getAllWindowHandles();
    await driver.switchTo().window(handles[1]);
    await gu.waitForUrl('support.getgrist.com');
    assert.equal(await driver.getCurrentUrl(), 'https://support.getgrist.com/functions/#lookuprecords');
    await driver.close();
    await driver.switchTo().window(handles[0]);

    // Now click the non-link part.
    await driver.findContent('.ace_autocomplete .ace_line', /lookupRecords/).findContent('span', /Friends/).click();
    await driver.findContentWait('.ace_content', /^Friends\.lookupRecords\($/, 1000);
    await driver.sendKeys(Key.ESCAPE, Key.ESCAPE);
    await gu.waitAppFocus(true);
  });
});
