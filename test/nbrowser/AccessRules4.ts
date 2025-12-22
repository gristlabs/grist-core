/**
 * Test of the UI for Granular Access Control, part 3.
 */
import { ITestingHooks } from 'app/server/lib/ITestingHooks';
import { assert, driver, Key } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {assertChanged, assertSaved, startEditingAccessRules} from 'test/nbrowser/aclTestUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';

import { assert, driver, Key } from "mocha-webdriver";

describe("AccessRules4", function() {
  this.timeout(process.env.DEBUG ? "20m" : "20s");
  const cleanup = setupTestSuite();
  let testingHooks: ITestingHooks;

  afterEach(() => gu.checkForErrors());

  before(async () => {
    testingHooks = await server.getTestingHooks();
  });

  it("allows editor to toggle a column", async function() {
    const ownerSession = await gu.session().teamSite.user("user1").login();
    const docId = await ownerSession.tempNewDoc(cleanup, undefined, { load: false });

    // Create editor for this document.
    const api = ownerSession.createHomeApi();
    await api.updateDocPermissions(docId, { users: {
      [gu.translateUser("user2").email]: "editors",
    } });

    await api.applyUserActions(docId, [
      // Now create a structure.
      ["RemoveTable", "Table1"],
      ["AddTable", "Table1", [
        { id: "Toggle", type: "Bool" },
        { id: "Another", type: "Text" },
        { id: "User_Access", type: "Text", formula: "user.Email", isFormula: false },
      ]],
      // Now add access rules for Table2
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "*" }],
      // Owner can do anything
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access == OWNER", permissionsText: "all",
      }],
      // User with an his email address in the User_Access column can do anything
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Email == rec.User_Access", permissionsText: "all",
      }],
      // Otherwise no access
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "", permissionsText: "none",
      }],
    ]);
    await ownerSession.loadDoc(`/doc/${docId}`);

    // Make sure we can edit this as an owner.
    await gu.sendCommand("insertRecordAfter");

    assert.isEmpty(await gu.getCell("Another", 1).getText());
    assert.equal(await gu.getCell("User_Access", 1).getText(), gu.translateUser("user1").email);
    assert.isFalse(await gu.getCell("Toggle", 1).find(".widget_checkmark").isDisplayed());

    await gu.getCell("Another", 1).click();
    await gu.enterCell("owner");
    await gu.getCell("Toggle", 1).mouseMove();
    await gu.getCell("Toggle", 1).find(".widget_checkbox").click();
    await gu.waitForServer();

    assert.equal(await gu.getCell("Another", 1).getText(), "owner");
    assert.equal(await gu.getCell("User_Access", 1).getText(), gu.translateUser("user1").email);
    assert.isTrue(await gu.getCell("Toggle", 1).find(".widget_checkmark").isDisplayed());

    // Now login as user2.
    const userSession = await gu.session().teamSite.user("user2").login();
    await userSession.loadDoc(`/doc/${docId}`);

    // Make sure we can edit this as an user2
    await gu.sendCommand("insertRecordAfter");

    assert.isEmpty(await gu.getCell("Another", 1).getText());
    assert.equal(await gu.getCell("User_Access", 1).getText(), gu.translateUser("user2").email);
    assert.isFalse(await gu.getCell("Toggle", 1).find(".widget_checkmark").isDisplayed());

    await gu.getCell("Another", 1).click();
    await gu.enterCell("user2");
    await gu.getCell("Toggle", 1).mouseMove();
    await gu.getCell("Toggle", 1).find(".widget_checkbox").click();
    await gu.waitForServer();

    assert.equal(await gu.getCell("Another", 1).getText(), "user2");
    assert.equal(await gu.getCell("User_Access", 1).getText(), gu.translateUser("user2").email);
    assert.isTrue(await gu.getCell("Toggle", 1).find(".widget_checkmark").isDisplayed());
  });

  it("pretends that example user does not exist", async function() {
    const session = await gu.session().personalSite.user("user1").login();
    await session.tempNewDoc(cleanup);

    // Create a user with that email address.
    const email = "john@example.com";
    const db = await server.getDatabase();
    const john = await db.getUserByLogin(email);

    // Add user table with this user.
    await gu.sendActions([
      ["AddTable", "Users", [
        { id: "Email", type: "Text" },
      ]],
      ["AddRecord", "Users", -1, { Email: email }],
    ]);

    await gu.openPage("Users");
    assert.deepEqual(await gu.getSectionTitles(), ["USERS"]);

    // Add this table as an attribute.
    await startEditingAccessRules();
    await driver.findContentWait('button', /Add user attributes/, 2000).click();
    const userAttrRule = await driver.findWait('.test-rule-userattr', 200);
    await userAttrRule.find('.test-rule-userattr-name').click();
    await driver.sendKeys('Custom', Key.ENTER);
    await userAttrRule.find('.test-rule-userattr-attr').click();
    await driver.sendKeys('Email', Key.ENTER);
    await userAttrRule.find('.test-rule-userattr-table').click();
    await gu.findOpenMenuItem('li', 'Users').click();
    await userAttrRule.find('.test-rule-userattr-col').click();
    await gu.findOpenMenu();
    await driver.sendKeys('Email', Key.ENTER);
    await assertChanged();
    await driver.find('.test-rules-save').click();
    await gu.checkForErrors();
    await gu.waitForServer();
    await assertSaved();
    await gu.openPage('Users');

    // Login as john
    await testingHooks.flushAuthorizerCache();
    await gu.reloadDoc();
    await viewAs("john (Editor)");

    // Now we should see a table, even though John has no access to the document.
    assert.deepEqual(await gu.getSectionTitles(), ["USERS"]);

    // Remove this user.
    await db.deleteUser({ userId: john.id }, john.id);
  });

  it("unknown access defaults to public", async function() {
    const session = await gu.session().personalSite.user("user1").login();
    await session.tempNewDoc(cleanup);

    // Make this document public.
    await driver.find(".test-tb-share").click();
    await driver.findContentWait(".test-tb-share-option", /Manage users/, 100).doClick();
    await driver.findWait(".test-um-public-access", 3000).click();
    await driver.findContentWait(".test-um-public-option", "On", 100).click();
    await gu.saveAcls();
    await testingHooks.flushAuthorizerCache();
    await gu.reloadDoc();

    // Now view as as Unknown User.
    await viewAs("Unknown User");

    // And make sure we can see the document.
    await gu.openPage("Table1");

    // There should be a proper role in the banner.
    assert.equal(
      await driver.find(".test-view-as-banner .test-select-open").getText(),
      "Unknown User(Viewer)",
    );

    await driver.find(".test-view-as-banner .test-revert").click();
    await gu.waitForDocToLoad();

    // Now make the public editor.
    await driver.find(".test-tb-share").click();
    await driver.findContentWait(".test-tb-share-option", /Manage users/, 100).doClick();
    await driver.findWait(".test-um-public-member .test-um-member-role", 100).click();
    await driver.findContentWait(".test-um-role-option", /Editor/, 100).click();
    await gu.saveAcls();
    await gu.openPage("Table1");
    await testingHooks.flushAuthorizerCache();
    await gu.reloadDoc();

    // Now view as as Unknown User.
    await viewAs("Unknown User");

    assert.equal(
      await driver.find(".test-view-as-banner .test-select-open").getText(),
      "Unknown User(Editor)",
    );

    // And try to add a new record.
    await gu.openPage("Table1");
    await gu.sendActions([["AddRecord", "Table1", -1, { A: "New record" }]]);
    assert.equal(await gu.getCell("A", 1).getText(), "New record");
  });
});

async function viewAs(user: string) {
  await gu.openAccessRulesDropdown();
  // Menu is loaded asynchronously, and we often get a stale element reference error.
  await gu.waitToPass(() => driver.findContentWait(".grist-floating-menu a", user, 100).click());
  await gu.waitForDocToLoad();
  await driver.findWait(".test-view-as-banner", 1000);
}
