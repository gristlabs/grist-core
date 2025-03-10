/**
 * Test handling of attributes in condition formulas (e.g. "user.Email.upper()"), including
 * autocomplete suggestions and errors.
 */
import { enterRulePart, findDefaultRuleSet, removeRules, triggerAutoComplete } from 'test/nbrowser/aclTestUtils';
import { UserAPI } from 'app/common/UserAPI';
import { assert, driver, Key, WebElement } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';

describe("AccessRulesAttrs", function() {
  this.timeout('20s');
  const cleanup = setupTestSuite();
  let mainSession: gu.Session;
  let docId: string;
  let api: UserAPI;

  afterEach(() => gu.checkForErrors());

  before(async function() {
    mainSession = await gu.session().teamSite.user('user1').login();
    docId = await mainSession.tempNewDoc(cleanup, 'AccessRulesAttr', {load: false});
    api = mainSession.createHomeApi();
    await api.applyUserActions(docId, [
      ['RemoveTable', 'Table1'],
      ['AddTable', 'TableFoo', [
        {id: 'SomeText', type: 'Text'},
        {id: 'SomeDate', type: 'Date'},
      ]],
      ['BulkAddRecord', 'TableFoo', [null, null, null], {SomeText: ['foo', 'FoO', 'Bar']}],
    ]);
  });

  it('supports upper/lower on text columns', async function() {
    await mainSession.loadDoc(`/doc/${docId}/p/acl`, {wait: false});
    await driver.findWait('.test-rule-set', 2000);    // Wait for initialization fetch to complete.

    // Check API results before any rules are added.
    assert.deepEqual(await api.getDocAPI(docId).getRecords('TableFoo'), [
      {id: 1, fields: {SomeText: 'foo', SomeDate: null}},
      {id: 2, fields: {SomeText: 'FoO', SomeDate: null}},
      {id: 3, fields: {SomeText: 'Bar', SomeDate: null}},
    ]);

    // Add rules for TableFoo.
    await driver.findContentWait('button', /Add Table Rules/, 2000).click();
    await gu.findOpenMenuItem('li', /TableFoo/, 3000).click();
    let ruleSet = findDefaultRuleSet(/TableFoo/);

    // Add a rule that only allows reading row with "foo" in it (all lowercase).
    await enterRulePart(ruleSet, 1, '$SomeText == "foo"', 'Allow All');
    await ruleSet.find('.test-rule-extra-add .test-rule-add').click();
    await enterRulePart(ruleSet, 2, null, 'Deny All');
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();

    // Check API results with the new rule.
    assert.deepEqual(await api.getDocAPI(docId).getRecords('TableFoo'), [
      {id: 1, fields: {SomeText: 'foo', SomeDate: null}},
    ]);

    // Now try a rule that lowercases the text value.
    ruleSet = findDefaultRuleSet(/TableFoo/);
    await enterRulePart(ruleSet, 1, '$SomeText.lower() == "foo"', 'Allow All');
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
    assert.deepEqual(await api.getDocAPI(docId).getRecords('TableFoo'), [
      {id: 1, fields: {SomeText: 'foo', SomeDate: null}},
      {id: 2, fields: {SomeText: 'FoO', SomeDate: null}},
    ]);

    // Try uppercase, with no matches.
    ruleSet = findDefaultRuleSet(/TableFoo/);
    await enterRulePart(ruleSet, 1, '$SomeText.upper() == "foo"', 'Allow All');
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
    assert.deepEqual(await api.getDocAPI(docId).getRecords('TableFoo'), []);
  });

  it('should show autocomplete suggestions for text values', async function() {
    await mainSession.loadDoc(`/doc/${docId}/p/acl`, {wait: false});
    await driver.findWait('.test-rule-set', 2000);    // Wait for initialization fetch to complete.
    const ruleSet = findDefaultRuleSet(/TableFoo/);
    await triggerAutoComplete(ruleSet, 1, '$SomeText.');
    await checkCompletions(['$SomeText.lower()', '$SomeText.upper()']);
    await driver.sendKeys(Key.ESCAPE);

    // Works too if we start with rec.
    await triggerAutoComplete(ruleSet, 1, 'rec.SomeText.upp');
    await checkCompletions(['rec.SomeText.upper()']);
    await driver.sendKeys(Key.ESCAPE);

    // No autocomplete for Date columns.
    await triggerAutoComplete(ruleSet, 1, '$SomeDate.');
    await checkNoCompletions();
    await driver.sendKeys(Key.ESCAPE);

    // Yes autocomplete for user.Email
    await triggerAutoComplete(ruleSet, 1, '$SomeDate == user.Email.');
    await checkCompletions(['user.Email.lower()', 'user.Email.upper()']);
    await driver.sendKeys(Key.ESCAPE);

    // No autocomplete for user.Access (it has type Choice, not Text, string methods not useful).
    await triggerAutoComplete(ruleSet, 1, 'user.Access.');
    await checkNoCompletions();
    await driver.sendKeys(Key.ESCAPE);
  });

  it('should show errors for invalid attributes', async function() {
    await mainSession.loadDoc(`/doc/${docId}/p/acl`, {wait: false});
    await driver.findWait('.test-rule-set', 2000);    // Wait for initialization fetch to complete.
    const ruleSet = findDefaultRuleSet(/TableFoo/);

    // Invalid
    await enterRulePart(ruleSet, 1, '$SomeText.lowercase() == user.Email.uper()', 'Allow All');
    await checkError(ruleSet, 1, /Not a function: 'rec.SomeText.lowercase'/);

    await enterRulePart(ruleSet, 1, '$SomeText.lower() == user.Email.uper()', 'Allow All');
    await checkError(ruleSet, 1, /Not a function: 'user.Email.uper'/);

    await enterRulePart(ruleSet, 1, '$SomeDate.lower() == user.Email.uper()', 'Allow All');
    await checkError(ruleSet, 1, /Not a function: 'rec.SomeDate.lower'/);

    // Valid
    await enterRulePart(ruleSet, 1, '$SomeText.lower() == user.Email.upper()', 'Allow All');
    await checkError(ruleSet, 1, null);
  });

  it('should show toast on actions when rule does not apply', async function() {
    // Add another Text column. We'll change it to non-Text later, to see what happens to a
    // predicate that uses a text method.
    await api.applyUserActions(docId, [
      ['AddVisibleColumn', 'TableFoo', 'OtherText', {type: 'Text', isFormula: true, formula: '$SomeText or $id'}],
    ]);

    await mainSession.loadDoc(`/doc/${docId}/p/acl`, {wait: false});
    await driver.findWait('.test-rule-set', 2000);    // Wait for initialization fetch to complete.
    let ruleSet = findDefaultRuleSet(/TableFoo/);
    if (await ruleSet.isPresent()) {
      await removeRules(ruleSet);
      await driver.find('.test-rules-save').click();
      await gu.waitForServer();
    }

    // While this column is Text, we can use "lower()" method, and everything works.
    await driver.findContentWait('button', /Add Table Rules/, 2000).click();
    await gu.findOpenMenuItem('li', /TableFoo/, 3000).click();
    ruleSet = findDefaultRuleSet(/TableFoo/);
    // This rule won't match anything, which is fine, we are only interested in its validity.
    await enterRulePart(ruleSet, 1, 'newRec.OtherText.lower() == "blah"', {U: 'deny', C: 'deny'});
    await ruleSet.find('.test-rule-extra-add .test-rule-add').click();
    await enterRulePart(ruleSet, 2, null, 'Allow All');
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();

    // The table looks normal (no rules restricting access).
    await mainSession.loadDoc(`/doc/${docId}`);
    assert.deepEqual(await gu.getVisibleGridCells({cols: ['SomeText', 'OtherText'], rowNums: [2]}), ['FoO', 'FoO']);
    // We can edit data (rule restricting edits is valid because type is Text, and doesn't match).
    await gu.getCell({rowNum: 2, col: 'SomeText'}).click();
    await gu.enterCell(Key.DELETE);
    assert.deepEqual(await gu.getVisibleGridCells({cols: ['SomeText', 'OtherText'], rowNums: [2]}), ['', '2']);
    await gu.checkForErrors();
    await gu.undo();

    // Now change the type of the column used in the rule.
    await api.applyUserActions(docId, [['ModifyColumn', 'TableFoo', 'OtherText', {type: 'Any'}]]);

    // The rule preventing edits will still work for text values, but should show error for
    // non-text values.
    await gu.getCell({rowNum: 2, col: 'SomeText'}).click();
    await gu.enterCell('ciao');
    assert.deepEqual(await gu.getVisibleGridCells({cols: ['SomeText', 'OtherText'], rowNums: [2]}), ['ciao', 'ciao']);
    await gu.checkForErrors();
    await gu.enterCell(Key.DELETE);
    assert.deepEqual(await gu.getVisibleGridCells({cols: ['SomeText', 'OtherText'], rowNums: [2]}), ['ciao', 'ciao']);
    assert.match((await gu.getToasts())[0], /Rule.*has an error: Not a function: 'newRec.OtherText.lower'/);
    await gu.undo();
    assert.deepEqual(await gu.getVisibleGridCells({cols: ['SomeText', 'OtherText'], rowNums: [2]}), ['FoO', 'FoO']);
  });
});

async function checkCompletions(expected: string[]) {
  await gu.waitToPass(async () => {
    const completions = await driver.findAll('.ace_autocomplete .ace_line', el => el.getText());
    const removeWhitespace = (text: string) => text.replace(/\s+/g, '');
    assert.deepEqual(completions.map(removeWhitespace), expected);
  });
}

async function checkNoCompletions(msec = 250) {
  // Check there are no completions, and they don't appear within a small time.
  const elem = driver.find('.ace_autocomplete');
  assert.equal(await elem.isPresent() && await elem.isDisplayed(), false);
  await driver.sleep(msec);
  assert.equal(await elem.isPresent() && await elem.isDisplayed(), false);
}

async function checkError(ruleSet: WebElement, partNum: number, errorRegExp: RegExp|null) {
  await gu.waitForServer();
  const elem = ruleSet.find(`.test-rule-part:nth-child(${partNum}) .test-rule-error`);
  if (errorRegExp) {
    assert.match(await elem.getText(), errorRegExp);
  } else {
    assert.equal(await elem.isPresent(), false);
  }
}
