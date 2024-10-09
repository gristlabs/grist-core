/**
 * Test of the UI for the SchemaEdit permission in Granular Access Control.
 */
import { UserAPI } from 'app/common/UserAPI';
import { TableRecordValue } from 'app/common/DocActions';
import { assert, driver } from 'mocha-webdriver';
import { assertChanged, assertSaved, enterRulePart,
         findDefaultRuleSet, findTable, getRules } from 'test/nbrowser/aclTestUtils';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';
import pick = require('lodash/pick');

describe("AccessRulesSchemaEdit", function() {
  this.timeout(40000);
  const cleanup = setupTestSuite();
  let docId: string;
  let mainSession: gu.Session;
  let api: UserAPI;
  let editorApi: UserAPI;

  before(async function() {
    const editorSession = await gu.session().teamSite.user('user2').login();
    editorApi = editorSession.createHomeApi();

    // Import a test document we've set up for this.
    mainSession = await gu.session().teamSite.user('user1').login();
    docId = await mainSession.tempNewDoc(cleanup, 'ACL-SchemaEdit', {load: false});

    // Share it with a few users.
    api = mainSession.createHomeApi();
    await api.updateDocPermissions(docId, { users: {
      [gu.translateUser("user2").email]: 'editors',
    } });
    return docId;
  });

  afterEach(() => gu.checkForErrors());

  it('should allow disabling non-owner schemaEdit via checkbox', async function() {
    const mainDocApi = api.getDocAPI(docId);

    // Open Access Rules page.
    await loadAccessRulesPage(mainSession, docId);

    // Check the schemaEdit checkbox is checked (editors allowed)
    assert.equal(await getSchemaEditCheckbox().isSelected(), true);

    // Check that a warning is present.
    assert.equal(await driver.find('.test-rule-schema-edit-warning').isDisplayed(), true);

    // Check that default rules don't show the schemaEdit bit.
    assert.deepEqual((await getRules(findTable('*')))[0],
      {res: 'All', formula: 'user.Access in [EDITOR, OWNER]', perm: '+R+U+C+D'});

    // Check that an editor CAN make structure changes (default behavior is unchanged).
    await assert.isFulfilled(editorApi.applyUserActions(docId, [["RenameTable", 'Table1', 'Renamed1']]));

    // Uncheck the box.
    await getSchemaEditCheckbox().click();
    assert.equal(await getSchemaEditCheckbox().isSelected(), false);

    // Check the warning is now absent.
    assert.equal(await driver.find('.test-rule-schema-edit-warning').isPresent(), false);
    await assertChanged();

    // Save the changes.
    await saveRules();

    // Check that it works: an editor cannot make structure changes.
    await assert.isRejected(editorApi.applyUserActions(docId, [["RenameTable", 'Renamed1', 'Table1']]),
      /Blocked by table structure access rules/);

    // Check that after reload, the box is unchecked and the warning is gone.
    await reloadAccessRulesPage();
    assert.equal(await getSchemaEditCheckbox().isSelected(), false);
    assert.equal(await driver.find('.test-rule-schema-edit-warning').isPresent(), false);
    assert.equal(await getSchemaEditRuleSet().isPresent(), false);

    // Check what the rules are on the default resource.
    const rules = await mainDocApi.getRecords('_grist_ACLRules');
    const defaultResourceRef = (await getDefaultResourceRec(api, docId))!.id;
    assert.deepEqual(rules.map(r => pick(r.fields, "resource", "aclFormula", "permissionsText")),
      [{resource: defaultResourceRef, aclFormula: 'user.Access != OWNER', permissionsText: '-S'}]);

    // Revert by checking the box again.
    await getSchemaEditCheckbox().click();
    assert.equal(await getSchemaEditCheckbox().isSelected(), true);

    // Check the warning is now present.
    assert.equal(await driver.find('.test-rule-schema-edit-warning').isDisplayed(), true);

    // Save the changes.
    await saveRules();

    // Check that it works: an editor can make structure changes again.
    await assert.isFulfilled(editorApi.applyUserActions(docId, [["RenameTable", 'Renamed1', 'Table1']]));

    // Check there are no rules left.
    assert.lengthOf(await mainDocApi.getRecords('_grist_ACLRules'), 0);
  });

  it('should allow dismissing the warning', async function() {
    const mainDocApi = api.getDocAPI(docId);
    await loadAccessRulesPage(mainSession, docId);

    // Check we are in the expected default state: checkbox is checked and a warning is present.
    assert.equal(await getSchemaEditCheckbox().isSelected(), true);
    assert.equal(await driver.find('.test-rule-schema-edit-warning').isPresent(), true);

    // Click "Dismiss", and save.
    await driver.findContent('.test-rule-schema-edit-warning a', /Dismiss/).click();
    await assertChanged();
    await saveRules();

    // Check that an editor can still make structure changes.
    await assert.isFulfilled(editorApi.applyUserActions(docId, [["RenameTable", 'Table1', 'Renamed2']]));

    // Check that after reload, the box is checked and warning is gone.
    await reloadAccessRulesPage();
    assert.equal(await getSchemaEditCheckbox().isSelected(), true);
    assert.equal(await driver.find('.test-rule-schema-edit-warning').isPresent(), false);
    assert.equal(await getSchemaEditRuleSet().isPresent(), false);

    // Check what the rules are on the default resource.
    const rules = await mainDocApi.getRecords('_grist_ACLRules');
    const defaultResourceRef = (await getDefaultResourceRec(api, docId))!.id;
    assert.deepEqual(rules.map(r => pick(r.fields, "resource", "aclFormula", "permissionsText")),
      [{resource: defaultResourceRef, aclFormula: 'user.Access == EDITOR', permissionsText: '+S'}]);

    // Revert the rule change; wait for page to reload.
    await gu.undo();
    await driver.findWait('.test-rule-set', 2000);

    assert.equal(await getSchemaEditCheckbox().isSelected(), true);
    assert.equal(await driver.find('.test-rule-schema-edit-warning').isPresent(), true);
    assert.lengthOf(await mainDocApi.getRecords('_grist_ACLRules'), 0);

    // Let's revert also the table rename, to keep test cases independent.
    await assert.isFulfilled(editorApi.applyUserActions(docId, [["RenameTable", 'Renamed2', 'Table1']]));
  });

  it('should handle existing rules that mix schemaEdit and other permissions', async function() {
    const editorEmailAddr = gu.translateUser("user2").email;
    const customAclFormula = `user.Email == "${editorEmailAddr}"`;

    // Use the API to add a mixed rule, with both a 'schemaEdit' and a 'delete' permission.
    const defaultResourceRef = (await getDefaultResourceRec(api, docId))!.id;
    await api.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLRules', null, {
        resource: defaultResourceRef,
        aclFormula: customAclFormula,
        permissionsText: '-DS',
        memo: 'Memo MIXED',
      }],
    ]);

    // Load the Access Rules page.
    await loadAccessRulesPage(mainSession, docId);

    // The new rule should be visible in both the default section, and in SchemaEdit section
    // (which should be expanded).
    assert.deepEqual((await getRules(findTable('*')))[0],
      {formula: customAclFormula, perm: '-D', memo: 'Memo MIXED', res: 'All'});

    assert.equal(await getSchemaEditRuleSet().isDisplayed(), true);
    assert.deepEqual((await getRules(driver.find('.test-rule-special-SchemaEdit')))[0],
      {formula: customAclFormula, perm: '-S', memo: 'Memo MIXED'});

    // Check that the checkbox is disabled (since non-standard state).
    assert.equal(await getSchemaEditCheckbox().getAttribute('disabled'), 'true');

    // Check that the rule works.
    let error = await editorApi.applyUserActions(docId, [["RenameTable", 'Table1', 'Renamed3']])
      .then(() => null).catch(err => err);
    assert.match(error?.message, /Blocked by table structure access rules/);
    assert.deepInclude(error?.details, {memos: ['Memo MIXED']});

    // Change the memos on both copies of the rule.
    await enterRulePart(findDefaultRuleSet('*'), 1, null, {}, 'Memo DDD');
    await enterRulePart(getSchemaEditRuleSet(), 1, null, {}, 'Memo SSS');

    // Save.
    await saveRules();

    // The rules should look as before, only the memo is different.
    assert.deepEqual((await getRules(findTable('*')))[0],
      {formula: customAclFormula, perm: '-D', memo: 'Memo DDD', res: 'All'});
    assert.deepEqual((await getRules(driver.find('.test-rule-special-SchemaEdit')))[0],
      {formula: customAclFormula, perm: '-S', memo: 'Memo SSS'});

    // Check that the changed rule works.
    error = await editorApi.applyUserActions(docId, [["RenameTable", 'Table1', 'Renamed3']])
      .then(() => null).catch(err => err);
    assert.match(error?.message, /Blocked by table structure access rules/);
    assert.deepInclude(error?.details, {memos: ['Memo SSS']});

    // Check what the rules are on the default resource.
    const mainDocApi = api.getDocAPI(docId);
    const rules = await mainDocApi.getRecords('_grist_ACLRules');
    assert.sameDeepMembers(rules.map(r => pick(r.fields, "resource", "aclFormula", "permissionsText")), [
      {resource: defaultResourceRef, aclFormula: customAclFormula, permissionsText: '-S'},
      {resource: defaultResourceRef, aclFormula: customAclFormula, permissionsText: '-D'}
    ]);
  });
});

function getSchemaEditCheckbox() {
  return driver.find('.test-rule-special-SchemaEdit input[type=checkbox]');
}
function getSchemaEditRuleSet() {
  return driver.find('.test-rule-special-SchemaEdit .test-rule-set');
}
function getSaveButton() {
  return driver.find('.test-rules-save');
}
async function saveRules() {
  await getSaveButton().click();
  await gu.waitForServer();
  await assertSaved();
}
async function loadAccessRulesPage(session: gu.Session, docId: string) {
  await session.loadRelPath(`/doc/${docId}/p/acl`);
  await driver.findWait('.test-rule-set', 5000);
}
async function reloadAccessRulesPage() {
  await driver.navigate().refresh();
  await driver.findWait('.test-rule-set', 5000);
}
async function getDefaultResourceRec(api: UserAPI, docId: string): Promise<TableRecordValue|undefined> {
  const records = await api.getDocAPI(docId).getRecords('_grist_ACLResources', {filters: {tableId: ['*']}});
  return records[0];
}
