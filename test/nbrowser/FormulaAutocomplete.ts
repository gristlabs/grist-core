import {arrayRepeat} from 'app/common/gutil';
import {UserAPI} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';
import {withoutSandboxing} from 'test/server/testUtils';

describe('FormulaAutocomplete', function() {
  withoutSandboxing();

  this.timeout(20000);
  const cleanup = setupTestSuite();

  afterEach(async function() {
    // In case of an error, close any open autocomplete and cell editor, to ensure we don't
    // interfere with subsequent tests by unsaved value triggering an alert on unload.
    await driver.sendKeys(Key.ESCAPE, Key.ESCAPE);
  });

  let docId: string;
  let api: UserAPI;

  before(async function() {
    const mainSession = await gu.session().teamSite.login();
    const doc = await mainSession.tempDoc(cleanup, 'Favorite_Films.grist');
    api = mainSession.createHomeApi();
    docId = doc.id;
  });

  async function getCompletionLines() {
    const lines = await driver.findAll('.ace_autocomplete .ace_line', el => el.getText());
    return lines.map(line => line.replace(/\n/g, '').trim());
  }

  async function check(keys: string, expectedCompletions: string[]) {
    // Send the keys separately. (Sending them together seems to cause the
    // autocomplete to not show up from time to time.)
    await gu.sendKeys(40, keys);
    await gu.waitForServer(); // Wait for the server to respond to the autocomplete request.
    await gu.waitToPass(async () => {
      assert.deepEqual(await getCompletionLines(), expectedCompletions);
    });
  }

  it('should show full variable names', async function() {
    // Test for a bug.
    // For very long example values, the variable name was squashed to a single `$` sign.
    await gu.addNewTable('LongNames');
    await gu.sendActions([
      ['RemoveColumn', 'LongNames', 'A'],
      ['RemoveColumn', 'LongNames', 'B'],
      ['RemoveColumn', 'LongNames', 'C'],
      ['AddVisibleColumn', 'LongNames', 'Very long name for the first column', {
        type: 'RefList:LongNames',
        isFormula: true, formula: 'LongNames.lookupRecords(Long_column=1, Long_column_2=2)',
      }],
      ['AddVisibleColumn', 'LongNames', 'Long_column', {}],
      ['AddVisibleColumn', 'LongNames', 'Long_column_2', {}],
      ['AddVisibleColumn', 'LongNames', 'C', {
        isFormula: true, formula: '1',
      }],
      ['AddRecord', 'LongNames', null, {}],
    ]);
    await gu.getCell({rowNum: 1, col: 'C'}).click();
    await driver.sendKeys('=');
    await gu.waitAppFocus(false);
    await driver.sendKeys(`$V`);

    // Make sure that `ace_` element has some width.
    await gu.waitToPass(async () => {
      // Need to repeat it as this might be stale, as ACE editor is doing some async work.
      assert.isAbove(
        await driver.findContent('.ace_', /ery_long_name/).getRect().then(s => s.width),
        40,
      );
    }, 100);
    await gu.sendKeys(Key.ESCAPE);
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitAppFocus(true);
    await gu.sendActions([['RemoveTable', 'LongNames']]);
  });

  it('shows example values with proper padding', async function() {

    await api.applyUserActions(docId, [
      ['AddTable', 'LongColumns', [
        {id: 'aaa', type: 'Ref:LongColumns'},
        {id: 'bbbbbb', type: 'Numeric'},
        {id: 'ccccccccc', type: 'Numeric'},
        {id: 'dddddddddddd', type: 'Numeric'},
        {id: 'formula', isFormula: true},
      ]],
      ['AddRecord', 'LongColumns', null, {aaa: 1, bbbbbb: 2, ccccccccc: 3, dddddddddddd: 4}],
    ],
    );
    await gu.waitForServer();
    await gu.getPageItem('LongColumns').click();
    await gu.getCell('formula', 1).click();
    await startFormulaAutocomplete("$");

    // First three checks are very similar
    await check('', [
      '$aaa                 LongColumns[1]',
      '$bbbbbb              2.0',
      '$ccccccccc           3.0',
      '$dddddddddddd        4.0',
      '$formula             None',
      '$id                  1',
    ]);
    await check('aaa.aaa.', [
      '$aaa.aaa.aaa                 LongColumns[1]',
      '$aaa.aaa.bbbbbb              2.0',
      '$aaa.aaa.ccccccccc           3.0',
      '$aaa.aaa.dddddddddddd        4.0',
      '$aaa.aaa.formula             None',
      '$aaa.aaa.id                  1',
    ]);
    await check('aaa.aaa.aaa.aaa.', [
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa                 LongColumns[1]',
      '$aaa.aaa.aaa.aaa.aaa.aaa.bbbbbb              2.0',
      '$aaa.aaa.aaa.aaa.aaa.aaa.ccccccccc           3.0',
      '$aaa.aaa.aaa.aaa.aaa.aaa.dddddddddddd        4.0',
      '$aaa.aaa.aaa.aaa.aaa.aaa.formula             None',
      '$aaa.aaa.aaa.aaa.aaa.aaa.id                  1',
    ]);

    await check('aaa.', [
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa                LongColumns[1]',
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.bbbbbb             2.0',
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.ccccccccc          3.0',
      // Here we hit the limit `MAX_ABSOLUTE_SHARED_PADDING = 40`,
      // because this suggestion is 41 characters long.
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.dddddddddddd        4.0',
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.formula            None',
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.id                 1',
    ]);

    await check('aaa.', [
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa            LongColumns[1]',
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.bbbbbb         2.0',
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.ccccccccc        3.0',
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.dddddddddddd        4.0',
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.formula        None',
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.id             1',
    ]);

    // No more shared padding
    await check('aaa.aaa.', [
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa        LongColumns[1]',
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.bbbbbb        2.0',
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.ccccccccc        3.0',
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.dddddddddddd        4.0',
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.formula        None',
      '$aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.aaa.id        1',
    ]);

    await gu.sendKeys(Key.ESCAPE, Key.ESCAPE);

    await gu.addColumn('very_long_column_name');
    await gu.addColumn('very_very_long_column_name');
    await startFormulaAutocomplete("$");
    // Now there's more shared padding than the first case,
    // but it reaches the limit imposed by `MAX_RELATIVE_SHARED_PADDING = 15`.
    // The actual shared padding here is 15+3=18 because `$id` has 3 characters.
    // `$very_long_column_name` has 22 characters, hence its alignment is off by 22-18=4 spaces.
    await check('', [
      '$aaa                      LongColumns[1]',
      '$bbbbbb                   2.0',
      '$ccccccccc                3.0',
      '$dddddddddddd             4.0',
      '$formula                  None',
      '$id                       1',
      '$very_long_column_name        None',
      '$very_very_long_column_name        None',
    ]);
  });

  it('shows autocomplete suggestions after a parenthesis', async function() {
    await startFormulaAutocomplete("UPPER(");
    // What we are checking here isn't the particular list, but the fact that it's the same list
    // as aboce, when the text isn't preceded by "UPPER(".
    await check('$', [
      '$aaa                      LongColumns[1]',
      '$bbbbbb                   2.0',
      '$ccccccccc                3.0',
      '$dddddddddddd             4.0',
      '$formula                  None',
      '$id                       1',
      '$very_long_column_name        None',
      '$very_very_long_column_name        None',
    ]);
  });

  it('refreshes autocomplete after typing a period when one colId is a prefix of another', async function() {
    await gu.getPageItem('Films').click();

    // Add a new column 'T' of type Text
    await gu.addColumn('T');
    await gu.getCell({rowNum: 1, col: 'T'}).click();
    await driver.sendKeys('abc');
    await driver.sendKeys(Key.ENTER);

    // Write a new formula starting with `$Title.` and check that the autocomplete options are correct
    await gu.addColumn('A');
    await gu.getCell({rowNum: 1, col: 'A'}).click();
    await startFormulaAutocomplete('$Title.');
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.isAtLeast(completions.length, 5);
      assert.isTrue(completions.every(c => !c || c.startsWith("$Title.")));
    });

    // Now delete 'itle.' and add '.' again so that the formula starts with `$T.`
    // Previously this would continue showing the autocomplete options for `$Title.`
    // because the characters in `$T.` are contained in those options.
    // Now the options are refreshed after typing '.'
    await driver.sendKeys(Key.BACK_SPACE, Key.BACK_SPACE, Key.BACK_SPACE, Key.BACK_SPACE, Key.BACK_SPACE);
    await driver.sendKeys('.');
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.isAtLeast(completions.length, 5);
      assert.isTrue(completions.every(c => !c || c.startsWith("$T.")));
    });
    await driver.sendKeys(Key.ESCAPE, Key.ESCAPE);
    await driver.find('.test-notifier-toast-close').click();
  });

  it('handles references and visible columns correctly', async function() {
    // Make 'A' a Reference column to use in a new formula in 'B'
    await gu.setType(/Reference/);
    await gu.addColumn('B');
    await gu.getCell({rowNum: 1, col: 'B'}).click();
    await startFormulaAutocomplete('$A');
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.lengthOf(completions, 3);
      // Initially 'A' has no visible column, so these are the only options
      assert.isTrue(completions[0].startsWith("$A"));
      assert.isTrue(completions[1].startsWith("$Release_Date"));
      assert.isTrue(completions[2].startsWith("$T"));
    });
    await driver.sendKeys('.');
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.lengthOf(completions, 7);
      assert.isTrue(completions[0].startsWith("$A.A"));
      assert.isTrue(completions[1].startsWith("$A.B"));
      assert.isTrue(completions[2].startsWith("$A.Budget_millions"));
      assert.isTrue(completions[3].startsWith("$A.id"));
      assert.isTrue(completions[4].startsWith("$A.Release_Date"));
      assert.isTrue(completions[5].startsWith("$A.T"));
      assert.isTrue(completions[6].startsWith("$A.Title"));
    });
    await driver.sendKeys(Key.ENTER);  // don't ESCAPE because then an 'undo discard' toast gets in the way
    // Now give 'A' a visible column and check how the options change
    await gu.getCell({rowNum: 1, col: 'A'}).click();
    await gu.setRefShowColumn('Title');
    await gu.getCell({rowNum: 1, col: 'B'}).click();
    await startFormulaAutocomplete('$A');
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.lengthOf(completions, 4);
      // The important new option is `$A.Title` so that users understand that this is different from just `$A`.
      assert.isTrue(completions[0].startsWith("$A"));
      assert.isTrue(completions[1].startsWith("$A.Title"));
      assert.isTrue(completions[2].startsWith("$Release_Date"));
      assert.isTrue(completions[3].startsWith("$T"));
    });

    await driver.sendKeys('.');  // formula is now `$A.`
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.isAtLeast(completions.length, 8);
      assert.isTrue(completions[0].startsWith("$A.A"));
      assert.isTrue(completions[1].startsWith("$A.A.Title"));
      assert.isTrue(completions[2].startsWith("$A.B"));
      assert.isTrue(completions[3].startsWith("$A.Budget_millions"));
      assert.isTrue(completions[4].startsWith("$A.id"));
      assert.isTrue(completions[5].startsWith("$A.Release_Date"));
      assert.isTrue(completions[6].startsWith("$A.T"));
      assert.isTrue(completions[7].startsWith("$A.Title"));
    });

    await driver.sendKeys('A.');  // formula is now `$A.A.`
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.isAtLeast(completions.length, 8);
      assert.isTrue(completions[0].startsWith("$A.A.A"));
      assert.isTrue(completions[1].startsWith("$A.A.A.Title"));
      assert.isTrue(completions[2].startsWith("$A.A.B"));
      assert.isTrue(completions[3].startsWith("$A.A.Budget_millions"));
      assert.isTrue(completions[4].startsWith("$A.A.id"));
      assert.isTrue(completions[5].startsWith("$A.A.Release_Date"));
      assert.isTrue(completions[6].startsWith("$A.A.T"));
      assert.isTrue(completions[7].startsWith("$A.A.Title"));
    });

    await driver.sendKeys('T.');  // formula is now `$A.A.T.`
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.isAtLeast(completions.length, 2);
      assert.isTrue(completions.every(c => !c || c.startsWith("$A.A.T.")));
    });
    await driver.sendKeys(Key.ENTER);
  });

  it('handles lookup methods correctly', async function() {
    await startFormulaAutocomplete('Films');
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      // Sometimes FIXED(number, decimals=2, no_commas=False) is present, sometimes
      // not? TODO: figure out why.
      assert.isAtLeast(completions.length, 4);
      assert.equal(completions[0], 'Films');
      // Typing in only the table ID (or even just part of it) immediately gives a few lookup options
      assert.isTrue(completions[1].startsWith("Films.lookupOne(colName=<value>, ...)"));
      assert.isTrue(completions[2].startsWith("Films.lookupRecords(A=$id)"));
      assert.isTrue(completions[3].startsWith("Films.lookupRecords(colName=<value>, ...)"));
    });

    // Having a '.' after `Films` means that all attributes are now shown
    await driver.sendKeys('.');
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.lengthOf(completions, 6);
      assert.isTrue(completions[0].startsWith("Films.all"));
      assert.isTrue(completions[1].startsWith("Films.lookupOne(colName=<value>, ...)"));
      assert.isTrue(completions[2].startsWith("Films.lookupRecords(A=$id)"));
      assert.isTrue(completions[3].startsWith("Films.lookupRecords(colName=<value>, ...)"));
      assert.isTrue(completions[4].startsWith("Films.Record"));
      assert.isTrue(completions[5].startsWith("Films.RecordSet"));
    });

    // Type in the full method name but leave out the `(`. This just narrows down the existing options.
    await driver.sendKeys('lookupRecords');
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.lengthOf(completions, 2);
      assert.isTrue(completions[0].startsWith("Films.lookupRecords(A=$id)"));
      assert.isTrue(completions[1].startsWith("Films.lookupRecords(colName=<value>, ...)"));
    });

    // Adding a `(` now shows arguments for the method, as well as more exotic reference lookups like `(A=$A)`
    await driver.sendKeys('(');
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.isTrue(completions[0].startsWith("Films.lookupRecords(A="));
      assert.isTrue(completions[1].startsWith("Films.lookupRecords(A=$A)"));
      assert.isTrue(completions[2].startsWith("Films.lookupRecords(A=$id)"));
      assert.isTrue(completions[3].startsWith("Films.lookupRecords(B="));
      assert.isTrue(completions[4].startsWith("Films.lookupRecords(Budget_millions="));
    });

    // Repeat a similar test,
    // but the `(` should be inserted by selecting an autocomplete option and pressing ENTER
    await gu.sendKeys(40, ') + Films');
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.isTrue(completions[1].startsWith("Films.lookupOne(colName=<value>, ...)"));
    });
    await gu.sendKeys(40, Key.DOWN, Key.DOWN, Key.ENTER);
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.isTrue(completions[0].startsWith("Films.lookupOne(A="));
      assert.isTrue(completions[1].startsWith("Films.lookupOne(A=$A)"));
      assert.isTrue(completions[2].startsWith("Films.lookupOne(A=$id)"));
      assert.isTrue(completions[3].startsWith("Films.lookupOne(B="));
      assert.isTrue(completions[4].startsWith("Films.lookupOne(Budget_millions="));
    });

    // Same as the previous test, but with TAB instead of ENTER
    await gu.sendKeys(40, ') + Friends');
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.isTrue(completions[1].startsWith("Friends.lookupOne(colName=<value>, ...)"));
    });
    await gu.sendKeys(40, Key.DOWN, Key.DOWN, Key.TAB);
    await gu.waitToPass(async () => {
      const completions = await getCompletionLines();
      assert.isTrue(completions[0].startsWith("Friends.lookupOne(Age="));
      assert.isTrue(completions[1].startsWith("Friends.lookupOne(Favorite_Film="));
      assert.isTrue(completions[2].startsWith("Friends.lookupOne(Favorite_Film=$A)"));
      assert.isTrue(completions[3].startsWith("Friends.lookupOne(Favorite_Film=$id)"));
      assert.isTrue(completions[4].startsWith("Friends.lookupOne(id="));
      assert.isTrue(completions[5].startsWith("Friends.lookupOne(Name="));
    });
  });

  it('appends a "(" when completing function or method calls', async function() {
    await startFormulaAutocomplete('SUM');
    await waitForAutocomplete();
    await gu.sendKeys(40, Key.DOWN, Key.ENTER);
    assert.equal(await driver.findWait('.ace_editor', 1000).getText(), 'SUM(');

    await gu.sendKeys(40,
      '1, 2)',
      ...arrayRepeat(6, Key.ARROW_LEFT),
      ...arrayRepeat(3, Key.BACK_SPACE),
      'AVERAGE',
    );
    await waitForAutocomplete();
    await gu.sendKeys(40, Key.DOWN, Key.DOWN, Key.ENTER);
    assert.equal(await driver.findWait('.ace_editor', 1000).getText(), 'AVERAGE(1, 2)');

    await gu.sendKeys(40, Key.END, ' Films.lookupOne');
    await waitForAutocomplete();
    await gu.sendKeys(40, Key.DOWN, Key.ENTER);
    assert.equal(
      await driver.findWait('.ace_editor', 1000).getText(),
      'AVERAGE(1, 2) Films.lookupOne(',
    );

    await gu.sendKeys(40,
      'A="foo")',
      ...arrayRepeat(9, Key.ARROW_LEFT),
      ...arrayRepeat(3, Key.BACK_SPACE),
      'Records',
    );
    await waitForAutocomplete();
    await driver.sendKeys(Key.DOWN, Key.DOWN, Key.ENTER);
    assert.equal(
      await driver.findWait('.ace_editor', 1000).getText(),
      'AVERAGE(1, 2) Films.lookupRecords(A="foo")',
    );
  });
});


async function startFormulaAutocomplete(formula: string) {
  await gu.waitAppFocus();
  await driver.sendKeys("=");
  await gu.waitAppFocus(false);
  // Send the keys separately. (Sending them together seems to cause the
  // autocomplete to not show up from time to time.)
  await gu.sendKeys(40, formula);
}

async function waitForAutocomplete() {
  await driver.findWait('.ace_autocomplete .ace_line', 1000);
}
