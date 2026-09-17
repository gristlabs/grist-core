/**
 * Test of the UI for the SchemaEdit permission in Granular Access Control.
 */
import { TableRecordValue } from "app/common/DocActions";
import { UserAPI } from "app/common/UserAPI";
import { assertChanged, enterRulePart,
  findDefaultRuleSet, findTable, getRules, saveRules, startEditingAccessRules } from "test/nbrowser/aclTestUtils";
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import pick from "lodash/pick";
import { assert, driver, Key } from "mocha-webdriver";

describe("AccessRulesSchemaEdit", function() {
  this.timeout(40000);
  const cleanup = setupTestSuite();
  let docId: string;
  let mainSession: gu.Session;
  let api: UserAPI;
  let editorApi: UserAPI;

  before(async function() {
    const editorSession = await gu.session().teamSite.user("user2").login();
    editorApi = editorSession.createHomeApi();

    // Import a test document we've set up for this.
    mainSession = await gu.session().teamSite.user("user1").login();
    docId = await mainSession.tempNewDoc(cleanup, "ACL-SchemaEdit", { load: false });

    // Share it with a few users.
    api = mainSession.createHomeApi();
    await api.updateDocPermissions(docId, { users: {
      [gu.translateUser("user2").email]: "editors",
    } });
    return docId;
  });

  afterEach(() => gu.checkForErrors());

  it("should allow disabling non-owner schemaEdit via checkbox", async function() {
    const mainDocApi = api.getDocAPI(docId);

    // Open Access Rules page.
    await loadAccessRulesPage(mainSession, docId);

    // With the introduction flow, once access rules are shown, the schemaEdit checkbox is
    // unchecked (editors disallowed, which is the recommended state).
    assert.equal(await getSchemaEditCheckbox().isSelected(), false);

    // No warning, we should be in a good state.
    assert.equal(await driver.find(".test-rule-schema-edit-warning").isPresent(), false);

    // Check that default rules don't show the schemaEdit bit.
    assert.deepEqual((await getRules(findTable("*")))[0],
      { res: "All", formula: "user.Access in [EDITOR, OWNER]", perm: "+R+U+C+D" });

    // Check that an editor CAN make structure changes: behavior is unchanged FOR NOW because we
    // haven't saved yet.
    await assert.isFulfilled(editorApi.applyUserActions(docId, [["RenameTable", "Table1", "Renamed1"]]));

    // Save the rules as recommended.
    await saveRules();

    // Check that an editor CANNOT make structure changes (default behavior changed by enabling // rules).
    await assert.isRejected(editorApi.applyUserActions(docId, [["RenameTable", "Renamed1", "Table1"]]),
      /Blocked by table structure access rules/);

    // Check that after reload, the box is still unchecked and still no warning.
    await reloadAccessRulesPage();
    assert.equal(await getSchemaEditCheckbox().isSelected(), false);
    assert.equal(await driver.find(".test-rule-schema-edit-warning").isPresent(), false);
    assert.equal(await getSchemaEditRuleSet().isPresent(), false);

    // Check what the rules are on the default resource.
    const rules = await mainDocApi.getRecords("_grist_ACLRules");
    const defaultResourceRef = (await getDefaultResourceRec(api, docId))!.id;
    assert.deepEqual(rules.map(r => pick(r.fields, "resource", "aclFormula", "permissionsText")),
      [{ resource: defaultResourceRef, aclFormula: "user.Access != OWNER", permissionsText: "-S" }]);

    // Check the box.
    await getSchemaEditCheckbox().click();
    assert.equal(await getSchemaEditCheckbox().isSelected(), true);

    // Check that a warning is present.
    assert.equal(await driver.find(".test-rule-schema-edit-warning").isDisplayed(), true);
    await assertChanged();

    // Save the changes. We happen to end up back on the intro page, since access rules now look
    // like they've never been enabled. (This isn't a very intentional behavior but acceptable.)
    await saveRules();

    // Now an editor CAN make structure changes.
    await assert.isFulfilled(editorApi.applyUserActions(docId, [["RenameTable", "Renamed1", "Table1"]]));

    // Check there are no rules left.
    assert.lengthOf(await mainDocApi.getRecords("_grist_ACLRules"), 0);
  });

  it("should allow dismissing the warning", async function() {
    const mainDocApi = api.getDocAPI(docId);
    await loadAccessRulesPage(mainSession, docId);

    // Check we are in the expected default state: checkbox is UNchecked and no warning.
    assert.equal(await getSchemaEditCheckbox().isSelected(), false);
    assert.equal(await driver.find(".test-rule-schema-edit-warning").isPresent(), false);

    // Enable editors to make structure changes.
    await getSchemaEditCheckbox().click();
    assert.equal(await driver.findWait(".test-rule-schema-edit-warning", 200).isDisplayed(), true);

    // We show a "Dismiss" link on the warning. This isn't really needed for the new flow,
    // but is still appropriate for those who created access rules previously.
    assert.equal(await driver.findContent(".test-rule-schema-edit-warning a", /Dismiss/).isPresent(), true);

    // Click "Dismiss", and save.
    await driver.findContent(".test-rule-schema-edit-warning a", /Dismiss/).click();
    await assertChanged();
    await saveRules();

    // Check that an editor can make structure changes.
    await assert.isFulfilled(editorApi.applyUserActions(docId, [["RenameTable", "Table1", "Renamed2"]]));

    // Check that after reload, the box is checked and warning is gone.
    await reloadAccessRulesPage();
    assert.equal(await getSchemaEditCheckbox().isSelected(), true);
    assert.equal(await driver.find(".test-rule-schema-edit-warning").isPresent(), false);
    assert.equal(await getSchemaEditRuleSet().isPresent(), false);

    // Check what the rules are on the default resource.
    const rules = await mainDocApi.getRecords("_grist_ACLRules");
    const defaultResourceRef = (await getDefaultResourceRec(api, docId))!.id;
    assert.deepEqual(rules.map(r => pick(r.fields, "resource", "aclFormula", "permissionsText")),
      [{ resource: defaultResourceRef, aclFormula: "user.Access == EDITOR", permissionsText: "+S" }]);

    // Revert the rule change; wait for page to reload.
    await gu.undo();

    // We should be back to seeing an intro to enable access rules. Check that now. (Note that
    // reverting to the intro screen is fine here, but a different behavior would be fine too.)
    assert.equal(await driver.findWait(".test-enable-access-rules", 500).isPresent(), true);

    // Check that there are no more access rules on the document.
    assert.lengthOf(await mainDocApi.getRecords("_grist_ACLRules"), 0);

    // Let's revert also the table rename, to keep test cases independent.
    await assert.isFulfilled(editorApi.applyUserActions(docId, [["RenameTable", "Renamed2", "Table1"]]));
  });

  it("should say when editors have owner-like data access", async function() {
    const mainDocApi = api.getDocAPI(docId);

    // Set up a table rule that limits Editors, leaving Editors able to edit structure.
    await api.applyUserActions(docId, [
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null,
        { resource: -1, aclFormula: "user.Access == EDITOR", permissionsText: "-R" }],
    ]);

    // The sharing dialog says Editors have Owner-like data access.
    await mainSession.loadDoc(`/doc/${docId}`);
    assert.equal(await hasOwnerLikeDataNote("doc"), true);

    // It says so from the home page too, where it relies on what the doc worker cached.
    await gu.waitToPass(async () => {
      await mainSession.loadDocMenu("/");
      assert.equal(await hasOwnerLikeDataNote("home"), true);
    }, 5000);

    // Only Owners are told, since it hints that the rules hold something back.
    assert.equal((await api.getDocAccess(docId)).editorsBypassRules, true);
    assert.notProperty(await editorApi.getDocAccess(docId), "editorsBypassRules");

    // The Access Rules page warns too.
    await loadAccessRulesPage(mainSession, docId);
    assert.equal(await getSchemaEditCheckbox().isSelected(), true);
    assert.equal(await driver.find(".test-rule-schema-edit-warning").getText(),
      "This option should be off unless you trust Editors as you would Owners on this document. Dismiss.");

    // Turn off structure editing for Editors, and save.
    await getSchemaEditCheckbox().click();
    await saveRules();
    assert.equal(await driver.find(".test-rule-schema-edit-warning").isPresent(), false);

    // The sharing dialog no longer says it, in the document or from the home page.
    await mainSession.loadDoc(`/doc/${docId}`);
    assert.equal(await hasOwnerLikeDataNote("doc"), false);
    await gu.waitToPass(async () => {
      await mainSession.loadDocMenu("/");
      assert.equal(await hasOwnerLikeDataNote("home"), false);
    }, 5000);

    // Remove the rules, to keep test cases independent.
    const rules = await mainDocApi.getRecords("_grist_ACLRules");
    await api.applyUserActions(docId, [["BulkRemoveRecord", "_grist_ACLRules", rules.map(r => r.id)]]);
  });

  it("should handle existing rules that mix schemaEdit and other permissions", async function() {
    const editorEmailAddr = gu.translateUser("user2").email;
    const customAclFormula = `user.Email == "${editorEmailAddr}"`;

    // Use the API to add a mixed rule, with both a 'schemaEdit' and a 'delete' permission.
    const defaultResourceRef = (await getDefaultResourceRec(api, docId))!.id;
    await api.applyUserActions(docId, [
      ["AddRecord", "_grist_ACLRules", null, {
        resource: defaultResourceRef,
        aclFormula: customAclFormula,
        permissionsText: "-DS",
        memo: "Memo MIXED",
      }],
    ]);

    // Load the Access Rules page.
    await loadAccessRulesPage(mainSession, docId);

    // The new rule should be visible in both the default section, and in SchemaEdit section
    // (which should be expanded).
    assert.deepEqual((await getRules(findTable("*")))[0],
      { formula: customAclFormula, perm: "-D", memo: "Memo MIXED", res: "All" });

    assert.equal(await getSchemaEditRuleSet().isDisplayed(), true);
    assert.deepEqual((await getRules(driver.find(".test-rule-special-SchemaEdit")))[0],
      { formula: customAclFormula, perm: "-S", memo: "Memo MIXED" });

    // Check that the checkbox is disabled (since non-standard state).
    assert.equal(await getSchemaEditCheckbox().getAttribute("disabled"), "true");

    // Check that the rule works.
    let error = await editorApi.applyUserActions(docId, [["RenameTable", "Table1", "Renamed3"]])
      .then(() => null).catch(err => err);
    assert.match(error?.message, /Blocked by table structure access rules/);
    assert.deepInclude(error?.details, { memos: [{ kind: "reason", text: "Memo MIXED" }] });

    // Change the memos on both copies of the rule.
    await enterRulePart(findDefaultRuleSet("*"), 1, null, {}, "Memo DDD");
    await enterRulePart(getSchemaEditRuleSet(), 1, null, {}, "Memo SSS");

    // Save.
    await saveRules();

    // The rules should look as before, only the memo is different.
    assert.deepEqual((await getRules(findTable("*")))[0],
      { formula: customAclFormula, perm: "-D", memo: "Memo DDD", res: "All" });
    assert.deepEqual((await getRules(driver.find(".test-rule-special-SchemaEdit")))[0],
      { formula: customAclFormula, perm: "-S", memo: "Memo SSS" });

    // Check that the changed rule works.
    error = await editorApi.applyUserActions(docId, [["RenameTable", "Table1", "Renamed3"]])
      .then(() => null).catch(err => err);
    assert.match(error?.message, /Blocked by table structure access rules/);
    assert.deepInclude(error?.details, { memos: [{ kind: "reason", text: "Memo SSS" }] });

    // Check what the rules are on the default resource.
    const mainDocApi = api.getDocAPI(docId);
    const rules = await mainDocApi.getRecords("_grist_ACLRules");
    assert.sameDeepMembers(rules.map(r => pick(r.fields, "resource", "aclFormula", "permissionsText")), [
      { resource: defaultResourceRef, aclFormula: customAclFormula, permissionsText: "-S" },
      { resource: defaultResourceRef, aclFormula: customAclFormula, permissionsText: "-D" },
    ]);
  });
});

function getSchemaEditCheckbox() {
  return driver.find(".test-rule-special-SchemaEdit input[type=checkbox]");
}
function getSchemaEditRuleSet() {
  return driver.find(".test-rule-special-SchemaEdit .test-rule-set");
}
async function loadAccessRulesPage(session: gu.Session, docId: string) {
  await session.loadRelPath(`/doc/${docId}/p/acl`);
  await startEditingAccessRules();
}
async function reloadAccessRulesPage() {
  await driver.navigate().refresh();
  await driver.findWait(".test-rule-set", 5000);
}
// Opens the sharing dialog, from the open document or from the home page, then opens the role
// menu for the Editor and checks for the note under Editor.
async function hasOwnerLikeDataNote(from: "doc" | "home"): Promise<boolean> {
  if (from === "doc") {
    await gu.editDocAcls();
  } else {
    await gu.openDocDropdown("ACL-SchemaEdit");
    await driver.find(".test-dm-doc-access").click();
  }
  await driver.findContentWait(".test-um-member", gu.translateUser("user2").email, 2000)
    .find(".test-um-member-role").click();
  await driver.findContentWait(".test-um-role-option", /Editor/, 500);
  const result = await driver.find(".test-um-editor-owner-like-data-access").isPresent();
  if (result) {
    // Clicking the note's icon leaves the menu open, rather than picking Editor.
    await driver.find(".test-um-editor-owner-like-data-access .test-info-tooltip").click();
    assert.equal(await driver.find(".test-um-role-option").isDisplayed(), true);
  }
  await driver.sendKeys(Key.ESCAPE);
  await driver.find(".test-um-cancel").click();
  await gu.waitToPass(async () => assert.equal(await driver.find(".test-um-members").isPresent(), false));
  return result;
}
async function getDefaultResourceRec(api: UserAPI, docId: string): Promise<TableRecordValue | undefined> {
  const records = await api.getDocAPI(docId).getRecords("_grist_ACLResources", { filters: { tableId: ["*"] } });
  return records[0];
}
