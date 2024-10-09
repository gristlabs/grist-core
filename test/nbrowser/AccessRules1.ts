/**
 * Test of the UI for Granular Access Control, part 1.
 */
import { assert, driver, Key, stackWrapFunc } from 'mocha-webdriver';
import { enterRulePart, findDefaultRuleSet, findRuleSet,
         findTable, triggerAutoComplete } from 'test/nbrowser/aclTestUtils';
import * as gu from 'test/nbrowser/gristUtils';
import { server } from 'test/nbrowser/testServer';
import { setupTestSuite } from 'test/nbrowser/testUtils';

describe('AccessRules1', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let docId: string;

  before(async function() {
    // Import a test document we've set up for this.
    const mainSession = await gu.session().teamSite.user('user1').login();
    docId = (await mainSession.tempDoc(cleanup, 'ACL-Test.grist', {load: false})).id;

    // Share it with a few users.
    const api = mainSession.createHomeApi();
    await api.updateDocPermissions(docId, { users: {
      [gu.translateUser("user2").email]: 'owners',
      [gu.translateUser("user3").email]: 'editors',
    } });
    return docId;
  });

  afterEach(() => gu.checkForErrors());

  const getTableNamesToAddWidget = stackWrapFunc(async function(): Promise<string[]> {
    await gu.openAddWidgetToPage();
    const options = await driver.findAll('.test-wselect-table', e => e.getText());
    // Close add widget popup
    await driver.sendKeys(Key.ESCAPE);

    assert.equal(options[0], "New Table");
    return options.slice(1);
  });

  const checkFullView = stackWrapFunc(async function(user: gu.TestUser) {
    const session = await gu.session().teamSite.user(user).login();
    await session.loadDoc(`/doc/${docId}`);

    // Check that we can see and add widgets for FinancialsTable.
    assert.deepEqual(await gu.getPageNames(), ['ClientsTable', 'FinancialsTable']);
    assert.deepEqual(await getTableNamesToAddWidget(), ['ClientsTable', 'FinancialsTable']);
    await gu.openPage('FinancialsTable');
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells({cols: ['Year', 'Income', 'Expenses'], rowNums: [1, 2, 3]}), [
      '2010', '$123.40', '$540,000.00',
      '2011', '$1,234.50', '$640,000.00',
      '2022', '$1,234,567.00', '$0.55',
    ]);

    // Check that we can see RumorsColumn of ClientsTable.
    await gu.openPage('ClientsTable');
    await gu.waitForServer();
    assert.equal(await driver.findContent('.column_name', /RumorsColumn/).isPresent(), true);
    assert.deepEqual(await gu.getVisibleGridCells({cols: ['RumorsColumn'], rowNums: [1, 3, 9, 13]}), [
      'Secrets', '', 'Dark rumors', 'Buzz'
    ]);

    // Check that we can all rows of ClientsTable
    assert.deepEqual(await gu.getVisibleGridCells({cols: ['First Name', 'Shared'], rowNums: [1, 3, 9, 13]}), [
      'Deina', 'false',
      'Terrence', 'true',
      'Rachele', 'true',
      'Erny', 'false',
    ]);
  });

  const checkLimitedView = stackWrapFunc(async function(user: gu.TestUser) {
    const session = await gu.session().teamSite.user(user).login();
    await session.loadDoc(`/doc/${docId}`);

    assert.deepEqual(await gu.getPageNames(), ['ClientsTable']);
    assert.deepEqual(await getTableNamesToAddWidget(), ['ClientsTable']);
    await gu.openPage('ClientsTable');
    await gu.waitForServer();
    assert.equal(await driver.findContent('.column_name', /RumorsColumn/).isPresent(), false);
  });

  const checkLimitedUpdateMemo = stackWrapFunc(async function(user: gu.TestUser, memo: string = '') {
    const session = await gu.session().teamSite.user(user).login();
    await session.loadDoc(`/doc/${docId}`);
    await gu.openPage('ClientsTable');
    await gu.waitForServer();
    await gu.getCell(0, 1).click();
    await gu.sendKeys('Will it work?', Key.ENTER);
    await gu.waitForServer();
    if (memo === '') {
      assert.isFalse(await driver.find('.test-notifier-toast-memo').isPresent());
    } else {
      await driver.findContent('.test-notifier-toast-memo', memo);
    }
  });

  it('should support rules for tables and columns', async function() {
    this.timeout(40000);
    // Check that users 1 and 3 can see everything initially.
    await checkFullView('user1');
    await checkFullView('user3');

    // Load Access Rules UI.
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);    // Wait for initialization fetch to complete.

    // Make FinancialsTable private to user1.
    await driver.findContentWait('button', /Add Table Rules/, 2000).click();
    await driver.findContentWait('.grist-floating-menu li', /FinancialsTable/, 3000).click();
    let ruleSet = findDefaultRuleSet(/FinancialsTable/);
    await enterRulePart(ruleSet, 1, null, 'Deny All');
    await ruleSet.find('.test-rule-part .test-rule-add').click();
    await enterRulePart(ruleSet, 1, `user.Email == '${gu.translateUser('user1').email}'`, 'Allow All');

    // Make RumorsColumn of ClientsTable private to user1.
    await driver.findContentWait('button', /Add Table Rules/, 2000).click();
    await driver.findContent('.grist-floating-menu li', /ClientsTable/).click();
    await findTable(/ClientsTable/).find('.test-rule-table-menu-btn').click();
    await driver.findContent('.grist-floating-menu li', /Add Column Rule/).click();
    ruleSet = findRuleSet(/ClientsTable/, 1);

    await ruleSet.find('.test-rule-resource .test-select-open').click();
    assert.deepEqual(
      await driver.findAll('.test-select-menu li', el => el.getText()),
      [
        'Agent_Email',
        'Email',
        'First_Name',
        'Last_Name',
        'Phone',
        'RumorsColumn',
        'Shared',
      ]
    );
    await driver.findContent('.test-select-menu li', 'RumorsColumn').click();
    await enterRulePart(ruleSet, 1, null, 'Deny All');
    await ruleSet.find('.test-rule-part .test-rule-add').click();
    await enterRulePart(ruleSet, 1, `user.Email == '${gu.translateUser('user1').email}'`, 'Allow All');

    // Make rows of ClientsTable only visible to the team if assigned to them, or marked as shared.
    ruleSet = findDefaultRuleSet(/ClientsTable/);
    await ruleSet.find('.test-rule-part .test-rule-add').click();
    await ruleSet.find('.test-rule-part .test-rule-add').click();
    await ruleSet.find('.test-rule-part .test-rule-add').click();
    await enterRulePart(ruleSet, 1, `user.Email == '${gu.translateUser('user1').email}'`, 'Allow All');
    await enterRulePart(ruleSet, 2, `rec.Shared`, {R: 'allow'});
    await enterRulePart(ruleSet, 3, `user.Email == rec.Agent_Email`, {R: 'allow'});
    await enterRulePart(ruleSet, 4, null, 'Deny All');

    await driver.find('.test-rules-save').click();
    await gu.waitForServer();

    // Check that user1 can see FinancialsTable, RumorsColumn, and all rows of ClientsTable.
    await checkFullView('user1');

    // Check that user2 cannot see FinancialsTable or RumorsColumn.
    await checkLimitedView('user2');

    // Check that user2 only sees certain rows of ClientsTable.
    assert.deepEqual(await gu.getVisibleGridCells(
      {cols: ['First Name', 'Agent Email', 'Shared'], rowNums: [1, 3, 6, 7, 8, 9, 10]}
    ), [
      // Everyone assigned to charon is visible.
      'Deina', 'gristoid+charon@gmail.com', 'false',
      'Terrence', 'gristoid+charon@gmail.com', 'true',
      'Wyndham', 'gristoid+charon@gmail.com', 'false',
      // And everyone with Shared = true is visible.
      'Rachele', 'gristoid+chimpy@gmail.com', 'true',
      'Elianore', 'gristoid+kiwi@gmail.com', 'true',
      'Ellsworth', 'gristoid+kiwi@gmail.com', 'true',
      '', '', ''
    ]);

    // Check that user3 cannot see FinancialsTable or RumorsColumn.
    await checkLimitedView('user3');

    // Check that user3 only sees certain rows of ClientsTable.
    assert.deepEqual(await gu.getVisibleGridCells(
      {cols: ['First Name', 'Agent Email', 'Shared'], rowNums: [1, 2, 3, 4, 9, 11, 12]}
    ), [
      // And everyone with Shared = true is visible.
      'Siobhan', 'gristoid+charon@gmail.com', 'true',
      'Terrence', 'gristoid+charon@gmail.com', 'true',
      'Rachele', 'gristoid+chimpy@gmail.com', 'true',
      // Everyone assigned to kiwi is visible.
      'Kettie', 'gristoid+kiwi@gmail.com', 'false',
      'Neely', 'gristoid+kiwi@gmail.com', 'false',
      'Ellsworth', 'gristoid+kiwi@gmail.com', 'true',
      '', '', '',
    ]);
  });

  it('should support rules with rec.id in formula', async function() {
    // This tests behavior that broke after a bug was introduced.
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);
    const ruleSet = findDefaultRuleSet(/FinancialsTable/);
    await enterRulePart(ruleSet, 1, `rec.id == 1`, 'Allow All');
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
    await gu.openPage('FinancialsTable');
    await gu.waitForServer();
    assert.deepEqual(
      await gu.getVisibleGridCells({cols: ['Expenses', 'Income', 'Year'], rowNums: [1, 2]}),
      [
        '$540,000.00', '$123.40', '2010',
        '',            '',        ''
      ]
    );
    await gu.undo();
  });

  it('should support adding memos', async function() {
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);    // Wait for initialization fetch to complete.

    // Change the catch-all rule on ClientsTable to read-only permission, and give it a memo.
    const ruleSet = findDefaultRuleSet(/ClientsTable/);
    await enterRulePart(ruleSet, 4, null, 'Read Only', 'Sorry, this table is read-only.');
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();

    // Check that user2 sees the memo when trying to update ClientsTable.
    await checkLimitedUpdateMemo('user2', 'Sorry, this table is read-only');
  });

  it('should support removing memos', async function() {
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);    // Wait for initialization fetch to complete.

    // Delete the memo for the ClientsTable catch-all rule.
    await gu.session().teamSite.user('user1').login();
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);
    const ruleSet = findDefaultRuleSet(/ClientsTable/);
    await ruleSet.find('.test-rule-part-and-memo:nth-child(4) .test-rule-memo-remove').click();
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();

    // Check that user2 no longer sees the memo.
    await checkLimitedUpdateMemo('user2');
  });

  it('should not produce unnecessary user actions when changing rules', async function() {
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);    // Wait for initialization fetch to complete.

    // Revert a rule that was modified in an earlier test.
    let ruleSet = findDefaultRuleSet(/ClientsTable/);
    await enterRulePart(ruleSet, 4, null, 'Deny All');
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
    assert.equal(await driver.find('.test-rules-save').isDisplayed(), false);

    // Add/remove a rule; unchanged AccessRules should still show as Saved.
    ruleSet = findDefaultRuleSet(/ClientsTable/);
    await ruleSet.find('.test-rule-part:nth-child(1) .test-rule-add').click();
    await ruleSet.find('.test-rule-part:nth-child(1) .test-rule-remove').click();
    assert.equal(await driver.find('.test-rules-save').isDisplayed(), false);

    // Add a rule part, remove another rule part, and save.
    ruleSet = findDefaultRuleSet(/ClientsTable/);
    await ruleSet.find('.test-rule-part:nth-child(1) .test-rule-add').click();
    // Add a rule giving user2 (charon) access.
    await enterRulePart(ruleSet, 1, `user.Email == '${gu.translateUser('user2').email}'`, {R: 'allow'});
    // Remove the rule giving everyone access to Shared rows.
    await ruleSet.find('.test-rule-part-and-memo:nth-child(3) .test-rule-remove').click();

    // Check that the Save button is enabled, and save.
    assert.equal(await driver.find('.test-rules-save').isDisplayed(), true);
    await gu.userActionsCollect();
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();

    await gu.userActionsVerify([
      ["BulkRemoveRecord", "_grist_ACLRules", [6]],
      ["BulkAddRecord", "_grist_ACLRules", [-1], {
        aclFormula: ["user.Email == 'gristoid+charon@gmail.com'"],
        permissionsText: ["+R"],
        resource: [5],
        rulePos: [4.5],
        memo: [""],
      }],
    ]);
    assert.equal(await driver.find('.test-rules-save').isDisplayed(), false);

    // Check that the rule has an effect: user3 has limited access, and cannot see Shared rows except their own.
    await checkLimitedView('user3');
    assert.deepEqual(await gu.getVisibleGridCells(
      {cols: ['First Name', 'Agent Email', 'Shared'], rowNums: [1, 6, 8, 9]}
    ), [
      'Kettie', 'gristoid+kiwi@gmail.com', 'false',
      'Neely', 'gristoid+kiwi@gmail.com', 'false',
      'Ellsworth', 'gristoid+kiwi@gmail.com', 'true',
      '', '', '',
    ]);
  });

  it('should report errors when typed-in rule is invalid', async function() {
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);
    const ruleSet = findDefaultRuleSet(/ClientsTable/);
    await ruleSet.find('.test-rule-part:nth-child(1) .test-rule-add').click();
    await enterRulePart(ruleSet, 1, `user.Access === 'owners'`, {R: 'allow'});
    await gu.waitForServer();

    // Check that an error is shown, and save button is disabled.
    assert.match(await ruleSet.find('.test-rule-part:nth-child(1) .test-rule-error').getText(),
      /^SyntaxError/);
    assert.equal(await driver.find('.test-rules-save').isDisplayed(), false);
    assert.equal(await driver.find('.test-rules-non-save').isDisplayed(), true);
    assert.equal(await driver.find('.test-rules-non-save').getText(), 'Invalid');

    // Check that invalid names are also detected.
    await enterRulePart(ruleSet, 1, `fuser.Access == 'owners'`, {R: 'allow'});
    await gu.waitForServer();
    assert.match(await ruleSet.find('.test-rule-part:nth-child(1) .test-rule-error').getText(),
      /Unknown variable 'fuser'/);
    assert.equal(await driver.find('.test-rules-save').isDisplayed(), false);
    assert.equal(await driver.find('.test-rules-non-save').isDisplayed(), true);
    assert.equal(await driver.find('.test-rules-non-save').getText(), 'Invalid');

    // Check that invalid colIds are detected.
    await enterRulePart(ruleSet, 1, `rec.Shared == True or rec.Sharedd == True`, {R: 'allow'});
    await gu.waitForServer();
    assert.match(await ruleSet.find('.test-rule-part:nth-child(1) .test-rule-error').getText(),
      /Invalid columns: Sharedd/);
    assert.equal(await driver.find('.test-rules-save').isDisplayed(), false);
    assert.equal(await driver.find('.test-rules-non-save').isDisplayed(), true);
    assert.equal(await driver.find('.test-rules-non-save').getText(), 'Invalid');

    // Check that saving is also disabled while checking rules.
    await server.pauseUntil(async () => {
      await enterRulePart(ruleSet, 1, `user.Access == 'owners'`, {R: 'allow'});
      assert.equal(await ruleSet.find('.test-rule-part:nth-child(1) .test-rule-error').isPresent(), false);
      assert.equal(await driver.find('.test-rules-save').isDisplayed(), false);
      assert.equal(await driver.find('.test-rules-non-save').isDisplayed(), true);
      assert.equal(await driver.find('.test-rules-non-save').getText(), 'Checking…');
    });

    // Once rules are checked to be valid, the Save button is shown.
    await gu.waitForServer();
    assert.equal(await ruleSet.find('.test-rule-part:nth-child(1) .test-rule-error').isPresent(), false);
    assert.equal(await driver.find('.test-rules-save').isDisplayed(), true);
    assert.equal(await driver.find('.test-rules-non-save').isDisplayed(), false);

    // Revert the changes in this test case.
    await driver.find('.test-rules-revert').click();
    await gu.waitForServer();
  });

  it('should allow read control for columns with rec in formula', async function() {
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);

    // Add a column rule that uses rec but doesn't set read permission.
    await findTable(/FinancialsTable/).find('.test-rule-table-menu-btn').click();
    await driver.findContent('.grist-floating-menu li', /Add Column Rule/).click();
    let ruleSet = findRuleSet(/FinancialsTable/, 1);
    await ruleSet.find('.test-rule-resource .test-select-open').click();
    assert.deepEqual(
      await driver.findAll('.test-select-menu li', el => el.getText()),
      ['Expenses', 'Income', 'Year']
    );
    await driver.findContent('.test-select-menu li', 'Year').click();
    await enterRulePart(ruleSet, 1, 'rec.Year == "yore"', {U: 'deny'});
    await gu.waitForServer();
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();

    // Attempting to set read bit should no longer result in a notification.
    await driver.findWait('.test-rule-set', 2000);
    ruleSet = findRuleSet(/FinancialsTable/, 1);
    await assert.isFulfilled(enterRulePart(ruleSet, 1, null, {R: 'deny'}));
    await gu.checkForErrors();

    // Remove rule.
    await ruleSet.find('.test-rule-part:nth-child(1) .test-rule-remove').click();
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
  });

  it('should report possible order-dependencies', async function() {
    // Make a rule for FinancialsTable.Year and FinancialsTable.Income that denies something.
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}/p/acl`, {wait: false});
    await driver.findWait('.test-rule-set', 2000);
    await findTable(/FinancialsTable/).find('.test-rule-table-menu-btn').click();
    await driver.findContent('.grist-floating-menu li', /Add Column Rule/).click();
    let ruleSet = findRuleSet(/FinancialsTable/, 1);
    await ruleSet.find('.test-rule-resource .test-select-open').click();
    assert.deepEqual(
      await driver.findAll('.test-select-menu li', el => el.getText()),
      ['Expenses', 'Income', 'Year']
    );
    await driver.findContent('.test-select-menu li', 'Year').click();
    await ruleSet.find('.test-rule-resource .test-select-open').click();
    await driver.findContent('.test-select-menu li', 'Income').click();
    await enterRulePart(ruleSet, 1, 'user.Email == "noone1"', {R: 'deny'});

    // Make a rule for FinancialsTable.Year and FinancialsTable.Expenses that allows something.
    await findTable(/FinancialsTable/).find('.test-rule-table-menu-btn').click();
    await driver.findContent('.grist-floating-menu li', /Add Column Rule/).click();
    ruleSet = findRuleSet(/FinancialsTable/, 2);
    await ruleSet.find('.test-rule-resource .test-select-open').click();
    assert.deepEqual(
      await driver.findAll('.test-select-menu li', el => el.getText()),
      ['Expenses', 'Income', 'Year']
    );
    await driver.findContent('.test-select-menu li', 'Year').click();
    await ruleSet.find('.test-rule-resource .test-select-open').click();
    await driver.findContent('.test-select-menu li', 'Expenses').click();
    await enterRulePart(ruleSet, 1, 'user.Email == "noone2"', {R: 'allow'});

    // Check that trying to save throws an error.
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
    await driver.findContent('.test-notifier-toast-wrapper',
                             /Column Year appears .* table FinancialsTable .* might be order-dependent/);
    await gu.wipeToasts();

    // Tweak one rule to be compatible (no order dependency) with the other, and recheck.
    await enterRulePart(ruleSet, 1, 'user.Email == "noone2"', {R: 'deny'});
    await gu.waitForServer();
    assert.lengthOf(await gu.getToasts(), 0);
  });

  it("'Add Widget to Page' should be disabled", async() => {
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}/p/acl`, {wait: false});
    await driver.findWait('.test-rule-set', 2000);
    await driver.find('.test-dp-add-new').doClick();
    assert.includeMembers(await driver.findAll('.test-dp-add-new-menu > li.disabled', (imp) => imp.getText()), [
      "Add Widget to Page",
    ]);
    await driver.sendKeys(Key.ESCAPE);
    await gu.waitAppFocus();
  });

  it('should support dollar syntax in the editor', async function() {
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}/p/acl`, {wait: false});
    // Wait for ACL page to load.
    await driver.findWait('.test-rule-set', 2000);
    // Add rules for FinancialsTable.
    const ruleSet = findRuleSet(/FinancialsTable/, 1);
    // Use new syntax to hide Year 2010.

    // First make sure we have autocomplete working.
    await triggerAutoComplete(ruleSet, 1, '$');
    await gu.waitToPass(async () => {
      const completions = await driver.findAll('.ace_autocomplete .ace_line', el => el.getText());
      assert.deepEqual(completions, [
        '$\nExpenses\n ',
        '$\nid\n ',
        '$\nIncome\n ',
        '$\nYear\n ',
      ]);
    });
    await driver.sendKeys(Key.ESCAPE);

    // Next test that column is understood.
    await enterRulePart(ruleSet, 1, '1 == 1 and (rec.Year != "2" and $Year2 == "2010")', {R: 'deny'});
    await gu.waitForServer();
    assert.match(await ruleSet.find('.test-rule-part:nth-child(1) .test-rule-error').getText(),
      /Invalid columns: Year2/);
    assert.equal(await driver.find('.test-rules-save').isDisplayed(), false);
    assert.equal(await driver.find('.test-rules-non-save').isDisplayed(), true);
    assert.equal(await driver.find('.test-rules-non-save').getText(), 'Invalid');

    // Now apply the rule.
    await enterRulePart(ruleSet, 1, '($Year == "2010" or rec.Year == "2011")', {R: 'deny'});
    await gu.waitForServer();
    // Remove second rule that hides table for everyone.
    await ruleSet.find('.test-rule-part-and-memo:nth-child(2) .test-rule-remove').click();

    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
    // Test that this rule works.
    await gu.openPage("FinancialsTable");
    assert.deepEqual(await gu.getVisibleGridCells(
      {cols: ['Year'], rowNums: [1, 2]}
    ), [
      '2022',
      '',
    ]);
  });
});
