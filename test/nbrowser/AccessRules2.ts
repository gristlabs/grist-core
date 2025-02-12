/**
 * Test of the UI for Granular Access Control, part 2.
 */
import escapeRegExp from 'lodash/escapeRegExp';
import { assert, driver, Key, stackWrapFunc, WebElement } from 'mocha-webdriver';
import { enterRulePart, findDefaultRuleSet, findRuleSet, findTable,
         getRuleText } from 'test/nbrowser/aclTestUtils';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';

const isChecked = stackWrapFunc(async function(el: WebElement): Promise<boolean> {
  return await el.getAttribute('checked') !== null;
});

const isDisabled = stackWrapFunc(async function(el: WebElement): Promise<boolean> {
  return await el.getAttribute('disabled') !== null;
});

describe("AccessRules2", function() {
  this.timeout(40000);
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

  let viewAsUrl: string;

  it('should list users with access to the document, plus examples', async function() {
    // Open AccessRules page, and click Users button.
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findContentWait('button', /View As/, 3000).click();

    const [email1, email2, email3] = ['user1', 'user2', 'user3'].map(u => gu.translateUser(u as any).email);
    // All users the doc is shared with should be listed, with correct Access.
    assert.equal(await driver.findContent('.test-acl-user-item', email1).isPresent(), false);
    assert.equal(await driver.findContent('.test-acl-user-item', email2)
      .find('.test-acl-user-access').getText(), '(Owner)');
    assert.equal(await driver.findContent('.test-acl-user-item', email3)
                 .find('.test-acl-user-access').getText(), '(Editor)');

    // Check examples are present.
    assert.deepEqual(
      (await driver.findAll('.test-acl-user-item span', e => e.getText()))
      .filter(txt => txt.includes('@example')),
      ['owner@example.com', 'editor1@example.com', 'editor2@example.com', 'viewer@example.com', 'unknown@example.com']);

    // Add a user attribute table.
    await mainSession.createHomeApi().applyUserActions(docId, [
      ['AddTable', 'Zones', [{id: 'Email'}, {id: 'City'}]],
      ['AddRecord', 'Zones', null, {Email: email1, City: 'Seattle'}],
      ['AddRecord', 'Zones', null, {Email: email2, City: 'Boston'}],
      ['AddRecord', 'Zones', null, {Email: 'fast@speed.com', City: 'Cambridge'}],
      ['AddRecord', 'Zones', null, {Email: 'slow@speed.com', City: 'Springfield'}],
    ]);
    const records = await mainSession.createHomeApi().applyUserActions(docId, [
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, userAttributes: JSON.stringify({
          name: 'Zone',
          tableId: 'Zones',
          charId: 'Email',
          lookupColId: 'Email',
        }),
      }],
    ]);

    // Refresh list.
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findContentWait('button', /View As/, 3000).click();

    // Check users from attribute table are present.
    assert.deepEqual(
      (await driver.findAll('.test-acl-user-item span', e => e.getText()))
      .filter(txt => txt.includes('@speed')),
      ['fast@speed.com', 'slow@speed.com']);

    // 'View As' is present, except for current user.
    assert.equal(await driver.findContent('.test-acl-user-item', email1)
      .isPresent(), false);
    assert.equal(await driver.findContent('.test-acl-user-item', email2)
      .isPresent(), true);

    // Click "View As", and wait for doc to reload.
    await driver.findContent('.test-acl-user-item', email3).click();
    await gu.waitForUrl(/aclAsUser/);
    await gu.waitForDocToLoad();
    // Make sure we are not on ACL page.
    viewAsUrl = await driver.getCurrentUrl();
    assert.notMatch(viewAsUrl, /\/p\/acl/);

    // Check for a tag in the doc header.
    assert.equal(await driver.findWait('.test-view-as-banner', 2000).isPresent(), true);
    assert.match(await driver.find('.test-view-as-banner .test-select-open').getText(),
                 new RegExp(gu.translateUser('user3').name, 'i'));
    assert.equal(await driver.find('.test-info-tooltip.test-view-as-help-tooltip').isDisplayed(), true);

    // check the aclAsUser parameter on the url persists after navigating to another page
    await gu.getPageItem('FinancialsTable').click();
    await gu.waitForDocToLoad();
    assert.equal(await gu.getActiveSectionTitle(), 'FINANCIALSTABLE');
    assert.match(await driver.getCurrentUrl(), /aclAsUser/);

    // Revert.
    await driver.find('.test-view-as-banner .test-revert').click();
    await gu.waitForDocToLoad();

    // Delete user attribute table.
    await mainSession.createHomeApi().applyUserActions(docId, [
      ['RemoveRecord', '_grist_ACLRules', records.retValues[1]],
      ['RemoveRecord', '_grist_ACLResources', records.retValues[0]],
      ['RemoveTable', 'Zones'],
    ]);
  });

  it('should allow returning from view-as mode via View As banner', async function() {
    // Check that we can revert view-as and visit Access Rules page with the button next to the
    // page item.
    await driver.get(viewAsUrl);
    await gu.waitForUrl(/aclAsUser/);
    await gu.waitForDocToLoad();

    await driver.find('.test-view-as-banner .test-revert').click();
    await gu.waitForDocToLoad();
    assert.equal(await driver.find('.test-view-as-banner').isPresent(), false);
  });

  it('should allow switching users in view-as mode', async function() {

    // open doc in view-as mode
    await driver.get(viewAsUrl);
    await gu.waitForUrl(/aclAsUser/);
    await gu.waitForDocToLoad();

    // check name
    assert.match(await driver.find('.test-view-as-banner .test-select-open').getText(),
                 new RegExp(gu.translateUser('user3').name, 'i'));

    // select other user
    await driver.find('.test-view-as-banner .test-select-open').click();
    await driver.findContent('.test-acl-user-item', gu.translateUser('user1').name).click();

    // check name changed
    await gu.waitForDocToLoad();

    // check name updated correctly
    assert.match(await driver.find('.test-view-as-banner .test-select-open').getText(), /Chimpy/);
  });

  it('should make all tables/columns available to editor of ACL rules', async function() {
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);

    // Add table rules for ClientsTable.
    await driver.findContentWait('button', /Add Table Rules/, 2000).click();
    const options = await driver.findAll('.grist-floating-menu li', e => e.getText());
    assert.deepEqual(options, ["ClientsTable", "ClientsTable [by Shared]", "FinancialsTable"]);
    await driver.findContent('.grist-floating-menu li', /ClientsTable/).click();

    // Add rules hiding First_Name, Last_Name columns.
    await findTable(/ClientsTable/).find('.test-rule-table-menu-btn').click();
    await driver.findContent('.grist-floating-menu li', /Add Column Rule/).click();
    let ruleSet = findRuleSet(/ClientsTable/, 1);
    await ruleSet.find('.test-rule-resource .test-select-open').click();
    await driver.findContent('.test-select-menu li', 'First_Name').click();
    await ruleSet.find('.test-rule-resource .test-select-open').click();
    await driver.findContent('.test-select-menu li', 'Last_Name').click();
    await enterRulePart(ruleSet, 1, null, {R: 'deny'});

    // Add table rule entirely hiding FinancialsTable.
    await driver.findContentWait('button', /Add Table Rules/, 2000).click();
    await driver.findContent('.grist-floating-menu li', /FinancialsTable/).click();
    ruleSet = findDefaultRuleSet(/FinancialsTable/);
    await enterRulePart(ruleSet, 1, null, {R: 'deny'});

    // Save and reload.
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
    await driver.navigate().refresh();
    await driver.findWait('.test-rule-set', 5000);

    // Now this user isn't aware of the inaccessible columns and table, but ACL rules should
    // still list them.

    // Remove Last_Name column from being blocked. Check that it's now available in dropdown.
    await driver.findWait('.test-rule-set', 2000);
    ruleSet = findRuleSet(/ClientsTable/, 1);
    await ruleSet.find('.test-rule-resource').click();
    await ruleSet.findContent('.test-acl-column', 'Last_Name').find('.test-acl-col-remove').click();
    await ruleSet.find('.test-rule-resource .test-select-open').click();
    assert.equal(await driver.findContent('.test-select-menu li', 'Last_Name').isPresent(), true);
    await driver.sendKeys(Key.ESCAPE);    // Close menu.
    await driver.sendKeys(Key.ESCAPE);    // Close editing of columns.

    // Remove FinancialsTable from being blocked. Check that it's now available in dropdown.
    ruleSet = findRuleSet(/FinancialsTable/, 1);
    await ruleSet.find('.test-rule-part-and-memo:nth-child(1) .test-rule-remove').click();
    await driver.findContentWait('button', /Add Table Rules/, 2000).click();
    assert.equal(await driver.findContent('.grist-floating-menu li', /FinancialsTable/).isPresent(), true);
    assert.equal(await driver.findContent('.grist-floating-menu li', /FinancialsTable/).matches('.disabled'), false);
    await driver.sendKeys(Key.ESCAPE);

    // Save
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();

    // Remove First_Name column from being blocked, and add back Last_Name column.
    ruleSet = findRuleSet(/ClientsTable/, 1);
    await ruleSet.find('.test-rule-resource').click();
    await ruleSet.findContent('.test-acl-column', 'First_Name').find('.test-acl-col-remove').click();
    await ruleSet.find('.test-rule-resource .test-select-open').click();
    await driver.findContent('.test-select-menu li', 'Last_Name').click();

    // Add back FinancialsTable to be blocked.
    assert.equal(await findRuleSet(/FinancialsTable/, 1).isPresent(), false);
    await driver.findContentWait('button', /Add Table Rules/, 2000).click();
    await driver.findContent('.grist-floating-menu li', /FinancialsTable/).click();
    ruleSet = findDefaultRuleSet(/FinancialsTable/);
    await enterRulePart(ruleSet, 1, null, {R: 'deny'});

    // Save and reload.
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
    await driver.navigate().refresh();
    await driver.findWait('.test-rule-set', 5000);

    // Verify the results.
    ruleSet = findRuleSet(/ClientsTable/, 1);
    assert.deepEqual(await ruleSet.findAll('.test-acl-column', el => el.getText()), ['Last_Name']);
    assert.equal(await findDefaultRuleSet(/FinancialsTable/).isPresent(), true);

    // Remove the installed "Deny" rules to restore the initial state.
    await findRuleSet(/ClientsTable/, 1).find('.test-rule-remove').click();
    await findRuleSet(/FinancialsTable/, 1).find('.test-rule-remove').click();
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
  });

  it('should support user-attribute rules', async function() {
    // Add a table to user for a user-attribute rule. User the API for test simplicity.
    const mainSession = await gu.session().teamSite.user('user1').login();
    const api = mainSession.createHomeApi();
    await api.applyUserActions(docId, [
      ['AddTable', 'Access', [{id: 'Email'}, {id: 'SharedOnly', type: 'Bool'}]],
      ['AddRecord', 'Access', null, {Email: gu.translateUser('user1').email, SharedOnly: true}],
      ['AddRecord', 'Access', null, {Email: gu.translateUser('user2').email, SharedOnly: true}],
      ['AddRecord', 'Access', null, {Email: gu.translateUser('user3').email, SharedOnly: true}],
    ]);

    // Now use the UI to add a user-attribute rule.
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await gu.waitForServer();
    await driver.findContentWait('button', /Add User Attributes/, 2000).click();
    const userAttrRule = await driver.find('.test-rule-userattr');
    await userAttrRule.find('.test-rule-userattr-name').click();
    await driver.sendKeys("MyAccess", Key.ENTER);

    // Type 'Email' into the attribute ace editor, which has 'user.' prefilled.
    await userAttrRule.find('.test-rule-userattr-attr').click();
    await driver.sendKeys("Email", Key.ENTER);

    // Check that Table field offers a dropdown.
    await userAttrRule.find('.test-rule-userattr-table').click();
    assert.deepEqual(await driver.findAll('.test-select-menu li', el => el.getText()),
      ['Access', 'ClientsTable', 'ClientsTable [by Shared]', 'FinancialsTable']);

    // Select a table and check that the Column field offers a dropdown.
    await driver.findContent('.test-select-menu li', 'ClientsTable').click();
    await userAttrRule.find('.test-rule-userattr-col').click();
    assert.includeMembers(await driver.findAll('.test-select-menu li', el => el.getText()),
      ['Agent_Email', 'Email', 'First_Name']);

    // Select a different table, and check that the Column field dropdown gets updated.
    await userAttrRule.find('.test-rule-userattr-table').click();
    await driver.sendKeys("Access", Key.ENTER);
    await userAttrRule.find('.test-rule-userattr-col').click();
    assert.deepEqual(await driver.findAll('.test-select-menu li', el => el.getText()),
      ['Email', 'SharedOnly', 'id']);
    await driver.sendKeys("Email", Key.ENTER);

    // Remove ClientTable rules, and add a new one using the new UserAttribute.
    if (await findTable(/ClientsTable/).isPresent()) {
      await findTable(/ClientsTable/).find('.test-rule-table-menu-btn').click();
      await driver.findContent('.grist-floating-menu li', /Delete Table Rules/).click();
    }
    await driver.findContentWait('button', /Add Table Rules/, 2000).click();
    await driver.findContent('.grist-floating-menu li', /ClientsTable/).click();
    const ruleSet = findDefaultRuleSet(/ClientsTable/);
    await ruleSet.find('.test-rule-part .test-rule-add').click();
    // newRec term in the following does nothing, it is just there to test renaming later.
    await enterRulePart(ruleSet, 1, `not user.MyAccess.SharedOnly or rec.Shared or newRec.Shared`,
                        {R: 'allow'});
    await enterRulePart(ruleSet, 2, null, 'Deny All');
    await driver.find('.test-rules-save').click();
    await gu.waitToPass(async () => {
      await gu.openPage('ClientsTable');
      assert.equal(await gu.getGridRowCount(), 6);
    });

    // Now toggle the value in the Access table.
    await gu.getPageItem('Access').click();
    await gu.getCell({col: 'SharedOnly', rowNum: 1}).find('.widget_checkbox').click();
    await gu.waitToPass(async () => {
      await gu.openPage('ClientsTable');
      assert.equal(await gu.getGridRowCount(), 20);
    });
  });

  it('should allow adding an "Everyone Else" rule if one does not exist', async function() {
    // Load the page with rules.
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);

    // ClientsTable rules, based on previous tests, includes an "Everyone Else" setting.
    assert.isTrue(await findTable(/ClientsTable/).isPresent());
    let ruleSet = findDefaultRuleSet(/ClientsTable/);
    assert.lengthOf(await ruleSet.findAll('.test-rule-part'), 2);
    assert.lengthOf(await ruleSet.findAll('.test-rule-add'), 2);
    assert.equal(
      await ruleSet.find('.test-rule-part-and-memo:nth-child(2) .test-rule-acl-formula').getText(),
      "Everyone Else"
    );
    assert.equal(await ruleSet.find('.test-rule-extra-add').isPresent(), false);

    // Delete it, and check that a plus button appears.
    await ruleSet.find('.test-rule-part-and-memo:nth-child(2) .test-rule-remove').click();
    assert.lengthOf(await ruleSet.findAll('.test-rule-part'), 1);
    assert.lengthOf(await ruleSet.findAll('.test-rule-add'), 2);
    assert.equal(await ruleSet.find('.test-rule-extra-add').isPresent(), true);

    // Click "+" button, check that a rule appears.
    await ruleSet.find('.test-rule-extra-add .test-rule-add').click();
    assert.lengthOf(await ruleSet.findAll('.test-rule-part'), 2);
    assert.lengthOf(await ruleSet.findAll('.test-rule-add'), 2);
    assert.equal(
      await ruleSet.find('.test-rule-part-and-memo:nth-child(2) .test-rule-acl-formula').getText(),
      "Everyone Else"
    );
    assert.equal(await ruleSet.find('.test-rule-extra-add').isPresent(), false);

    // Enter a condition into the new default rule.
    await enterRulePart(ruleSet, 2, `True`, 'Deny All');

    // A new "+" button should appear.
    assert.lengthOf(await ruleSet.findAll('.test-rule-part'), 2);
    assert.lengthOf(await ruleSet.findAll('.test-rule-add'), 3);
    assert.equal(
      await ruleSet.find('.test-rule-part-and-memo:nth-child(2) .test-rule-acl-formula').getText(),
      "True"
    );
    assert.equal(await ruleSet.find('.test-rule-extra-add').isPresent(), true);

    // Save
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
    await driver.findWait('.test-rule-set', 2000);

    // Check that the final "+" still appears.
    ruleSet = findDefaultRuleSet(/ClientsTable/);
    assert.lengthOf(await ruleSet.findAll('.test-rule-part'), 2);
    assert.lengthOf(await ruleSet.findAll('.test-rule-add'), 3);
    assert.equal(
      await ruleSet.find('.test-rule-part-and-memo:nth-child(2) .test-rule-acl-formula').getText(),
      "True"
    );
    assert.equal(await ruleSet.find('.test-rule-extra-add').isPresent(), true);

    await gu.undo();
    await driver.findWait('.test-rule-set', 2000);

    ruleSet = findDefaultRuleSet(/ClientsTable/);
    assert.lengthOf(await ruleSet.findAll('.test-rule-part'), 2);
    assert.lengthOf(await ruleSet.findAll('.test-rule-add'), 2);
    assert.equal(
      await ruleSet.find('.test-rule-part-and-memo:nth-child(2) .test-rule-acl-formula').getText(),
      "Everyone Else"
    );
    assert.equal(await ruleSet.find('.test-rule-extra-add').isPresent(), false);
  });

  it('should support renames and refresh rules when they get updated', async function() {
    // Prepare to use the API.
    const mainSession = await gu.session().teamSite.user('user1').login();
    const api = mainSession.createHomeApi();

    // Load the page with rules.
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);

    // After the previous test case, we have these rules:
    // - UserAttribute rule "MyAccess" that looks up user.Email in ClientsTable.Email.
    // - On ClientsTable, rule allowing read when "not user.MyAccess.SharedOnly or rec.Shared ...".
    // - On ClientsTable, default rule to Deny All.

    // Check that it's what we see.
    assert.deepEqual(await driver.findAll('.test-rule-userattr-attr', getRuleText),
        ['user.Email']);
    assert.deepEqual(await driver.findAll('.test-rule-userattr .test-select-open', el => el.getText()),
      ['Access', 'Email']);
    assert.match(await driver.find('.test-rule-table-header').getText(), / ClientsTable$/);
    assert.lengthOf(await driver.findAll('.test-rule-set'), 2);
    assert.deepEqual(await driver.find('.test-rule-set').findAll('.test-rule-acl-formula', getRuleText),
      ["not user.MyAccess.SharedOnly or rec.Shared or newRec.Shared", "Everyone Else"]);

    // Rename some tables (raw view sections) and columns.
    await api.applyUserActions(docId, [
      ['UpdateRecord', '_grist_Views_section', 3, {title: 'CLIENT LIST'}],
      ['UpdateRecord', '_grist_Views_section', 10, {title: 'ACCESS2'}],
      ['RenameColumn', 'CLIENT_LIST', 'Shared', 'PUBLIC'],
      ['RenameColumn', 'ACCESS2', 'Email', 'EMAIL_ADDR'],
      ['RenameColumn', 'ACCESS2', 'SharedOnly', 'ONLY_SHARED'],
    ]);
    await gu.waitForServer();

    // Rules should auto-update.
    assert.deepEqual(await driver.findAll('.test-rule-userattr .test-select-open', el => el.getText()),
      ['ACCESS2', 'EMAIL_ADDR']);
    assert.match(await driver.find('.test-rule-table-header').getText(), / CLIENT LIST/);
    assert.lengthOf(await driver.findAll('.test-rule-set'), 2);
    assert.deepEqual(await driver.find('.test-rule-set').findAll('.test-rule-acl-formula', getRuleText),
      ["not user.MyAccess.ONLY_SHARED or rec.PUBLIC or newRec.PUBLIC", "Everyone Else"]);

    // Table options should update
    await driver.findContentWait('button', /Add Table Rules/, 2000).click();
    const options = await driver.findAll('.grist-floating-menu li', e => e.getText());
    assert.deepEqual(options, ["ACCESS2", "CLIENT LIST", "CLIENT LIST [by Shared]", "FinancialsTable"]);
    await driver.sendKeys(Key.ESCAPE);    // Close menu.

    // Make an unsaved change to the rules, e.g. add a new one.
    const ruleSet = findDefaultRuleSet(/CLIENT LIST/);
    await ruleSet.find('.test-rule-part .test-rule-add').click();
    await enterRulePart(ruleSet, 1, `True`, {R: 'allow'});

    // Partially undo the renames.
    await api.applyUserActions(docId, [
      ['UpdateRecord', '_grist_Views_section', 3, {title: 'ClientsTable'}],
      ['RenameColumn', 'ClientsTable', 'PUBLIC', 'Shared'],
    ]);
    await gu.waitForServer();

    // Rules should NOT auto-update, but show a message instead.
    assert.match(await driver.find('.test-rule-table-header').getText(), / CLIENT LIST/);
    assert.match(await driver.find('.test-access-rules-error').getText(), /Access rules have changed/);

    // Click "Reset" to update them.
    await driver.find('.test-rules-revert').click();
    await gu.waitForServer();

    // Finish undoing the renames.  Fiddling with a user attribute table currently forces
    // a reload.
    await api.applyUserActions(docId, [
      ['UpdateRecord', '_grist_Views_section', 10, {title: 'Access'}],
      ['RenameColumn', 'Access', 'EMAIL_ADDR', 'Email'],
      ['RenameColumn', 'Access', 'ONLY_SHARED', 'SharedOnly'],
    ]);
    await gu.waitForServer();

    // Check results; it should be what we started with.
    await gu.waitToPass(async () =>
      assert.deepEqual(await driver.findAll('.test-rule-userattr .test-select-open', el => el.getText()),
        ['Access', 'Email']));
    assert.match(await driver.find('.test-rule-table-header').getText(), / ClientsTable$/);
    assert.lengthOf(await driver.findAll('.test-rule-set'), 2);
    assert.deepEqual(await driver.find('.test-rule-set').findAll('.test-rule-acl-formula', getRuleText),
      ["not user.MyAccess.SharedOnly or rec.Shared or newRec.Shared", "Everyone Else"]);
  });

  it('should support special rules', async function() {
    // Prepare to use the API.
    const mainSession = await gu.session().teamSite.user('user1').login();

    // Load the page with rules.
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);

    // Check that the special checkboxes are unchecked, and advanced UI is hidden.
    assert.deepEqual(await driver.findAll('.test-rule-special-checkbox', isChecked), [false, true, false, false]);
    assert.deepEqual(await driver.findAll('.test-rule-special', el => el.find('.test-rule-set').isPresent()),
      [false, false, false, false]);

    // Mark the 'Allow everyone to view Access Rules' checkbox and save.
    await gu.scrollIntoView(driver.find('.test-rule-special-AccessRules .test-rule-special-checkbox')).click();
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();

    // Verify that it's checked after saving.
    assert.deepEqual(await driver.findAll('.test-rule-special-checkbox', isChecked), [false, true, true, false]);

    // Expand advanced UI and delete the added rule there.
    await gu.scrollIntoView(driver.find('.test-rule-special-AccessRules .test-rule-special-expand')).click();
    await driver.find('.test-rule-special-AccessRules .test-rule-part-and-memo:nth-child(1) .test-rule-remove').click();

    // The checkbox should now be unchecked.
    assert.deepEqual(await driver.findAll('.test-rule-special-checkbox', isChecked), [false, true, false, false]);

    // Add a new non-standard rule
    const ruleSet = await driver.find('.test-rule-special-AccessRules .test-rule-set');
    await ruleSet.find('.test-rule-part .test-rule-add').click();
    await enterRulePart(ruleSet, 1, 'user.Access == EDITOR', {R: 'allow'});

    // The checkbox should now be disabled.
    assert.deepEqual(await driver.findAll('.test-rule-special-checkbox', isChecked), [false, true, false, false]);
    assert.deepEqual(await driver.findAll('.test-rule-special-checkbox', isDisabled), [false, false, true, false]);

    // Mark the checkbox for the other rule.
    await gu.scrollIntoView(driver.find('.test-rule-special-FullCopies .test-rule-special-checkbox')).click();

    // Save and reload the page.
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
    await driver.navigate().refresh();
    await driver.findWait('.test-rule-set', 5000);

    // Verify the state of the checkboxes.
    assert.deepEqual(await driver.findAll('.test-rule-special-checkbox', isChecked), [false, true, false, true]);
    assert.deepEqual(await driver.findAll('.test-rule-special-checkbox', isDisabled), [false, false, true, false]);

    // Check that the advanced UI is shown for only the non-standard rule.
    assert.deepEqual(await driver.findAll('.test-rule-special', el => el.find('.test-rule-set').isPresent()),
      [false, false, true, false]);
  });

  it('should allow opening rules when they refer to a deleted table', async function() {
    // After deleting a table, an invalid rule will remain. This test is NOT saying that this is
    // the desired behavior; it only checks that in the presence of such an invalid rule, we can
    // still open the Access Rules page.

    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);
    assert.match(await driver.find('.test-rule-table-header').getText(), / ClientsTable$/);

    // TODO: Something seems wrong about being able to remove a table to which one has no
    // update-record or delete-record access. On the other hand, in this situation, an undo of the
    // delete does get blocked.
    await gu.removePage('ClientsTable', {withData: true});
    await gu.waitForServer();
    await gu.checkForErrors();
    await driver.navigate().refresh();
    await driver.findWait('.test-rule-set', 5000);
    assert.match(await driver.find('.test-rule-table-header').getText(), / #Invalid \(ClientsTable\)$/);

    // Remove access rule
    await driver.findContent('.test-rule-table-header', / #Invalid \(ClientsTable\)$/)
      .find('.test-rule-table-menu-btn').click();
    await driver.findContent('.grist-floating-menu li', /Delete/).click();
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
    assert.isTrue(await driver.find('.test-rules-non-save').isPresent());
  });

  it('should offer fixes for rules referring to deleted tables/columns', async function() {
    // Create some temporary tables.
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}`);
    await gu.addNewTable('TmpTable1');
    await gu.addNewTable('TmpTable2');

    // Add a user attribute referencing a column we will soon delete.
    const api = mainSession.createHomeApi();
    await api.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, userAttributes: JSON.stringify({
          name: 'Zig',
          tableId: 'TmpTable2',
          charId: 'Email',
          lookupColId: 'B',
        }),
      }],
    ]);

    // Open access control rules.
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);

    // Add a rule for TmpTable1.
    await driver.findContentWait('button', /Add Table Rules/, 2000).click();
    await driver.findContentWait('.grist-floating-menu li', /TmpTable1/, 3000).click();
    let ruleSet = findDefaultRuleSet(/TmpTable1/);
    await enterRulePart(ruleSet, 1, null, 'Allow All');

    // Add a rule for columns of TmpTable2.
    await driver.findContentWait('button', /Add Table Rules/, 2000).click();
    await driver.findContentWait('.grist-floating-menu li', /TmpTable2/, 3000).click();
    ruleSet = findDefaultRuleSet(/TmpTable2/);
    await enterRulePart(ruleSet, 1, null, 'Allow All');
    await findTable(/TmpTable2/).find('.test-rule-table-menu-btn').click();
    await driver.findContent('.grist-floating-menu li', /Add Column Rule/).click();
    ruleSet = findRuleSet(/TmpTable2/, 1);
    await ruleSet.find('.test-rule-resource .test-select-open').click();
    await driver.findContent('.test-select-menu li', 'A').click();
    await ruleSet.find('.test-rule-resource .test-select-open').click();
    await driver.findContent('.test-select-menu li', 'B').click();
    await ruleSet.find('.test-rule-resource .test-select-open').click();
    await driver.findContent('.test-select-menu li', 'C').click();
    await enterRulePart(ruleSet, 1, 'True', {R: 'allow'});

    // Save the rules.
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();

    // Now remove TmpTable1 and some columns of TmpTable2.
    await gu.removePage('TmpTable1', {withData: true});
    await api.applyUserActions(docId, [
      ['RemoveColumn', 'TmpTable2', 'B'],
      ['RemoveColumn', 'TmpTable2', 'C'],
    ]);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 5000);
    await driver.navigate().refresh();

    // Check the list of rules looks plausible.
    await driver.findWait('.test-rule-set', 5000);
    assert.deepEqual(await driver.findAll('.test-rule-table-header', el => el.getText()),
                     ['Rules for table #Invalid (TmpTable1)',
                      'Rules for table TmpTable2',
                      'Default Rules', 'Special Rules']);

    // Press the buttons we expect to be offered for clean-up.
    await driver.findContentWait('button', /Remove TmpTable1 rules/, 5000).click();
    await driver.findContentWait('button', /Remove column B from TmpTable2 rules/, 5000).click();
    await driver.findContentWait('button', /Remove column C from TmpTable2 rules/, 5000).click();
    await driver.findContentWait('button', /Remove Zig user attribute/, 5000).click();
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();

    // Check the list of rules looks cleaner.
    assert.deepEqual(await driver.findAll('.test-rule-table-header', el => el.getText()),
                     ['Rules for table TmpTable2', 'Default Rules', 'Special Rules']);

    // Check only the remaining column is mentioned.
    assert.deepEqual(await driver.findAll('.test-acl-column', el => el.getText()),
                     ['A']);

    // Remove TmpTable2.
    await gu.removePage('TmpTable2', {withData: true});
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 5000);
    await driver.navigate().refresh();

    // Press the clean-up button we are offered, then check that "reset" works,
    // then press and save.
    await driver.findWait('.test-rule-set', 5000);
    await driver.findContentWait('button', /Remove TmpTable2 rules/, 5000).click();
    await driver.find('.test-rules-revert').click();
    await gu.waitForServer();
    await driver.findContentWait('button', /Remove TmpTable2 rules/, 5000).click();
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();

    // Check the list of rules looks cleaner.
    assert.deepEqual(await driver.findAll('.test-rule-table-header', el => el.getText()),
                     ['Default Rules', 'Special Rules']);
  });

  it.skip('should prevent combination of Public Edit access with granular ACLs', async function() {
    // Share doc with everyone as viewer.
    const mainSession = await gu.session().teamSite.user('user1').login();
    const doc = await mainSession.tempDoc(cleanup, 'ACL-Test.grist', {load: false});
    const api = mainSession.createHomeApi();
    await api.updateDocPermissions(doc.id, { users: { 'everyone@getgrist.com': 'viewers' } });

    // Open rules. There should be no warning message.
    await mainSession.loadDoc(`/doc/${doc.id}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);
    assert.equal(await driver.find('.test-access-rules-error').getText(), '');

    // Add a rule, and save.
    await driver.find('.test-rule-special-AccessRules .test-rule-special-checkbox').click();
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();

    // Check that it worked.
    assert.isTrue(await isChecked(await driver.find('.test-rule-special-AccessRules .test-rule-special-checkbox')));
    assert.equal(await driver.find('.test-rules-save').isDisplayed(), false);
    assert.equal(await driver.find('.test-rules-non-save').getText(), 'Saved');

    // Try to change public access to editor. It should downgrade to viewer with a warning toast.
    await driver.find('.test-tb-share').click();
    await driver.findContent('.test-tb-share-option', /Manage Users/).doClick();
    await driver.findWait('.test-um-public-access', 3000).click();
    assert.match(await driver.find('.test-um-public-member .test-um-member-role').getText(), /Viewer/);
    await driver.find('.test-um-public-member .test-um-member-role').click();
    await driver.findContent('.test-um-role-option', /Editor/).click();
    await gu.saveAcls();
    await gu.waitForServer();

    const toast = driver.findWait('.test-notifier-toast-wrapper', 500);
    assert.match(await toast.getText(), /incompatible.*Reduced to "Viewer"/i);
    await toast.find('.test-notifier-toast-close').click();   // Close the toast.

    // Remove the rule we added, and save.
    await driver.find('.test-rule-special-AccessRules .test-rule-special-checkbox').click();
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
    assert.isFalse(await isChecked(await driver.find('.test-rule-special-AccessRules .test-rule-special-checkbox')));

    // Now change public access to editor. There should be no warning notifications.
    await driver.find('.test-tb-share').click();
    await driver.findContent('.test-tb-share-option', /Manage Users/).doClick();
    await driver.findWait('.test-um-public-access', 3000).click();
    assert.match(await driver.find('.test-um-public-member .test-um-member-role').getText(), /Viewer/);
    await driver.find('.test-um-public-member .test-um-member-role').click();
    await driver.findContent('.test-um-role-option', /Editor/).click();
    await gu.saveAcls();
    await gu.waitForServer();
    assert.lengthOf(await gu.getToasts(), 0);

    // Open rules. There should be a warning message.
    await driver.find('.test-tools-access-rules').click();
    assert.match(await driver.find('.test-access-rules-error').getText(),
      /Public "Editor".*incompatible.*remove it or reduce to "Viewer"/i);

    // Try to add a rule. We should not be able to save.
    await driver.find('.test-rule-special-AccessRules .test-rule-special-checkbox').click();
    assert.equal(await driver.find('.test-rules-save').isDisplayed(), false);
    assert.equal(await driver.find('.test-rules-non-save').getText(), 'Invalid');
  });

  it("Should update save button every 1 second when editing a formula", async function() {
    // Prepare to use the API.
    const mainSession = await gu.session().teamSite.user('user1').login();

    // Load the page with rules.
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);

    // check the save button is in 'saved' state
    assert.equal(await driver.find('.test-rules-non-save').getText(), 'Saved');

    // add new rule
    const ruleSet = findDefaultRuleSet('*');
    await ruleSet.find('.test-rule-add').click();

    // check the save button is still in 'saved' state
    // (nothing useful to save yet)
    assert.equal(await driver.find('.test-rules-non-save').getText(), 'Saved');

    // start typing invalid formula
    const part = ruleSet.find(`.test-rule-part`);
    await part.findWait('.test-rule-acl-formula .ace_editor', 500);
    await part.find('.test-rule-acl-formula').doClick();
    await driver.findWait('.test-rule-acl-formula .ace_focus', 500);
    await gu.sendKeys('fdsa');

    // check save button is still in 'saved' state
    // (UI hasn't caught up with user yet)
    assert.equal(await driver.find('.test-rules-non-save').getText(), 'Saved');

    // wait 1 second
    await driver.sleep(1000);

    // check the save button is now enabled
    assert.equal(await driver.find('.test-rules-non-save').getText(), 'Invalid');

    // click reset
    await driver.find('.test-rules-revert').click();
  });

  it("should have a working dots menu", async function() {
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}/p/3`);
    let url = '';

    // check page is correct
    url = await driver.getCurrentUrl();
    assert.isTrue(url.includes('p/3'));
    assert.equal(await gu.getCurrentPageName(), "Access");

    await gu.openAccessRulesDropdown();

    const [name1, name2, name3] = ['user1', 'user2', 'user3'].map(u => gu.translateUser(u as any).name)
      .map(name => new RegExp(escapeRegExp(name), 'i'));

    // All users the doc is shared with should be listed, with correct Access.
    assert.equal(await driver.findContent('.grist-floating-menu a', name1).isPresent(), false);
    assert.include(await driver.findContent('.grist-floating-menu a', name2).getText(), '(Owner)');
    assert.include(await driver.findContent('.grist-floating-menu a', name3).getText(), '(Editor)');

    await driver.findContent('.grist-floating-menu a', name3).click();
    await gu.waitForUrl(/aclAsUser/);
    await gu.waitForDocToLoad();

    // Check for a tag in the doc header.
    assert.equal(await driver.findWait('.test-view-as-banner', 2000).isPresent(), true);

    // check doc is still on same page
    url = await driver.getCurrentUrl();
    assert.isTrue(url.includes('p/3'));
    assert.equal(await gu.getCurrentPageName(), "Access");

    // Revert.
    await driver.find('.test-view-as-banner .test-revert').click();
    await gu.waitForDocToLoad();
  });

  it('should keep dots menu in sync', async function() {
    const checkAccess = async (role: string) => {
      await gu.openAccessRulesDropdown();
      await gu.waitToPass(async () => {
        assert.include(await driver.findContent('.grist-floating-menu a', /kiwi/i).getText(), role);
      });
      await driver.sendKeys(Key.ESCAPE);
    };

    // open doc
    const mainSession = await gu.session().teamSite.user('user1').login();
    await mainSession.loadDoc(`/doc/${docId}`);

    // check kiwi matches (Editor)
    await checkAccess('(Editor)');

    // update kiwi access to viewers
    const api = mainSession.createHomeApi();
    await api.updateDocPermissions(docId, { users: { [gu.translateUser('user3').email]: 'viewers' } });

    // check kiwi matches (Viewer)
    await checkAccess('(Viewer)');
  });

  it('should hide dots menu for users without ACL access', async function() {
    // Login as user3 and open doc
    const mainSession = gu.session().teamSite.user('user1');
    await mainSession.teamSite.user('user3').login();
    await mainSession.loadDoc(`/doc/${docId}`);

    // Check absence of dots menu
    await driver.find('.test-tools-access-rules').mouseMove();
    await gu.waitToPass(async () => {
      assert.equal(await driver.find('.test-tools-access-rules-trigger').isPresent(), true);
    });
    assert.equal(await driver.find('.test-tools-access-rules-trigger').isDisplayed(), false);
  });

});
