import * as gu from "test/nbrowser/gristUtils";
import { server } from "test/nbrowser/testServer";
import { setupTestSuite } from "test/nbrowser/testUtils";

import * as child_process from "child_process";
import * as util from "util";

import axios from "axios";
import * as fse from "fs-extra";
import { assert, driver, Key, stackWrapFunc } from "mocha-webdriver";

const execFile = util.promisify(child_process.execFile);

describe("GranularAccess", function() {
  this.timeout(40000);
  const cleanup = setupTestSuite();

  it("restores formula data column after rejection", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempNewDoc(cleanup, "FailTest", { load: false });

    // Set ACL rules.
    // User can't change column B to 2.
    // Add also a formula field that is triggered by the change of B. This makes this formula
    // to be evaluated when actions is rejected (send and then undone). But the data engine wasn't saving
    // the result of this in the database. It doesn't matter for deterministic formulas, but it does for
    // non-deterministic ones (like random or NOW()).
    await api.applyUserActions(doc, [
      ["RemoveColumn", "Table1", "C"],
      // Here we have our non-deterministic formula.
      ["ModifyColumn", "Table1", "B", { isFormula: false, type: "Text" }],
      ["ModifyColumn", "Table1", "A", { formula: "UUID() + $B", isFormula: true }],
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "B" }],
      ["AddRecord", "_grist_ACLRules", null, {
        // User can't change column B to 2
        resource: -1, aclFormula: 'newRec.B == "2"', permissionsText: "-U",
      }],
    ]);
    await mainSession.loadDoc(`/doc/${doc}`);

    // First trigger column A.
    await gu.getCell("B", 1).click();
    await gu.enterCell("1");
    const initialA = await gu.getCell("A", 1).getText();

    // Now try to change column B to 2.
    await gu.getCell("B", 1).click();
    await gu.enterCell("2");

    // Cell A has changed - as this is nondeterministic formula it should be different.
    const revertedB = await gu.getCell("B", 1).getText();
    const revertedA = await gu.getCell("A", 1).getText();
    // Cell B should still be 1.
    assert.equal(revertedB, "1");

    // Now read the true value of A column from data-engine, by adding a formula to C column.
    // We hope that it is the same as in the A column.
    await gu.sendActions([
      ["AddVisibleColumn", "Table1", "C", { formula: "$A", isFormula: true }],
    ]);
    const columnC = await gu.getCell("C", 1).getText();
    const aAfterAddingC = await gu.getCell("A", 1).getText();
    // Those two values should be the same.
    assert.equal(aAfterAddingC, columnC, "Data from engine is different");

    // Sanity check, that adding a new column doesn't trigger a formula reevaluation (it shouldn't, but for
    // time functions it can happen).
    assert.equal(aAfterAddingC, revertedA, "Column A has changed after adding column C");

    // A value should be different from the one before we tried to change B. Action was rejected
    // but the value is reevaluated.
    assert.notEqual(initialA, revertedA, "Value in column A was not updated after rejection");

    // And database should contain the same value as revertedA.
    const result = await execFile("sqlite3", [
      `${server.testDocDir}/${doc}.grist`,
      `SELECT A from Table1`,
    ]);
    assert.isNotEmpty(revertedA);
    assert.equal(result.stdout.trim(), revertedA, "Database has wrong value in column A");
  });

  it("can make a table be private to owners", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Make a Private table and mark it as owner-only (using temporary representation).
    // Make a Public table without any particular access control.
    await api.applyUserActions(doc.id, [
      ["AddTable", "Private", [{ id: "A" }]],
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Private", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "none",
      }],
      ["AddTable", "Public", [{ id: "A" }]],
    ]);

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    // Owner can access both Private and Public tables.
    await assert.isFulfilled(api.getDocAPI(doc.id).getRows("Private"));
    await assert.isFulfilled(api.getDocAPI(doc.id).getRows("Public"));

    // Owner sees all tables listed.
    await mainSession.loadDoc(`/doc/${doc.id}`);
    assert.deepEqual(await gu.getPageNames(), ["Table1", "Private", "Public"]);

    // Get URL for Private table page and save for later.
    await gu.getPageItem("Private").click();
    const privatePageUrl = await driver.getCurrentUrl();
    assert.match(await gu.getActiveSectionTitle(), /Private/i);

    // Other users can access document.
    const otherSession = await gu.session().teamSite.user("user3").login();
    const otherApi = otherSession.createHomeApi();
    await otherSession.loadDoc(`/doc/${doc.id}`);

    // They can access the Public table but not the Private table.
    await assert.isFulfilled(otherApi.getDocAPI(doc.id).getRows("Public"));
    await assert.isRejected(otherApi.getDocAPI(doc.id).getRows("Private"));

    // They can not work on copy
    await driver.find(".test-tb-share").click();
    await driver.findWait(".test-work-on-copy", 500).click();
    await driver.findContentWait(".test-notifier-toast-message", /Insufficient access/, 2000);
    await gu.wipeToasts();

    // They can not duplicate document
    await driver.find(".test-tb-share").click();
    await driver.findWait(".test-save-copy", 500).click();
    await driver.findWait(".test-modal-dialog", 1000);
    await driver.find(".test-copy-dest-org .test-select-open").click();
    await gu.findOpenMenuItem("li", "Personal").click();
    await gu.waitForServer();
    await driver.wait(async () => (await driver.find(".test-modal-confirm").getAttribute("disabled") === null));
    await driver.find(".test-modal-confirm").click();
    await driver.findContentWait(".test-notifier-toast-message", /Insufficient access/, 2000);
    await gu.wipeToasts();

    // Only the Public table is listed.
    await otherSession.login();
    await otherSession.loadDoc(`/doc/${doc.id}`);
    assert.deepEqual(await gu.getPageNames(), ["Table1", "Public"]);

    // Check that there are no tree items for hidden pages (we used to show "-").
    assert.lengthOf(await driver.findAll(".test-treeview-label"), 2);

    // Visiting the Private page anyway does not result in populated sections.
    await driver.get(privatePageUrl);
    await assert.isRejected(driver.findWait(".test-viewsection-title", 1000));
  });

  it("can make a table be private using a wildcard", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Make all user tables private using a wild card.
    await api.applyUserActions(doc.id, [
      ["AddTable", "Private", [{ id: "A" }]],
      ["AddRecord", "_grist_ACLResources", null, { tableId: "*", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        // TODO We should do better than guessing that ACLResource above is added with rowId of 2.
        resource: 2, aclFormula: "user.Access != OWNER", permissionsText: "none",
      }],
    ]);

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    // Owner can access everything.
    await assert.isFulfilled(api.getDocAPI(doc.id).getRows("Private"));

    // Owner sees all tables listed.
    await mainSession.loadDoc(`/doc/${doc.id}`);
    assert.deepEqual(await gu.getPageNames(), ["Table1", "Private"]);

    // Get URL for Private table page and save for later.
    await gu.getPageItem("Private").click();
    const privatePageUrl = await driver.getCurrentUrl();
    assert.match(await gu.getActiveSectionTitle(), /Private/i);

    // Other users can access document.
    const otherSession = await gu.session().teamSite.user("user3").login();
    const otherApi = otherSession.createHomeApi();
    await otherSession.loadDoc(`/doc/${doc.id}`, { wait: false });

    // They can not access the Private table.
    await assert.isRejected(otherApi.getDocAPI(doc.id).getRows("Private"));

    // No tables listed.
    // Can't do a regular wait-to-load, since it checks for sections. So just wait a bit.
    // Might sometimes succeed accidentally, but should fail from time to time.
    // TODO: add a special "data blocked" section?
    await driver.sleep(2000);
    assert.deepEqual(await gu.getPageNames(), []);

    // Check that there are no tree items for hidden pages (we used to show "-").
    assert.lengthOf(await driver.findAll(".test-treeview-label"), 0);

    // Visiting the Private page anyway does not result in populated sections.
    await driver.get(privatePageUrl);
    await assert.isRejected(driver.findWait(".test-viewsection-title", 1000));
  });

  it("can hide some rows with a simple rule", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Make a table, and limit non-owner access to some rows.
    await api.applyUserActions(doc.id, [
      ["AddTable", "Data1", [{ id: "A" },
        { id: "B" },
        { id: "Public", isFormula: true, formula: '$B == "clear"' }]],
      ["AddRecord", "Data1", null, { A: "near", B: "clear" }],
      ["AddRecord", "Data1", null, { A: "far", B: "notclear" }],
      ["AddRecord", "Data1", null, { A: "in a motor car", B: "clear" }],
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Data1", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER and not rec.Public", permissionsText: "none",
      }],
      ["AddTable", "Data2", [{ id: "A" }, { id: "B" }]],
      ["AddRecord", "Data2", null, { A: 1, B: 2 }],
    ]);

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    // Other users can access document.
    const otherSession = await gu.session().teamSite.user("user3").login();
    await otherSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Data1/).click();
    await gu.waitForServer();

    // Should see two of the three lines.
    assert.deepEqual(await gu.getVisibleGridCells("A", [1, 2, 3]),
      ["near", "in a motor car", ""]);

    // Have owner modify a line that is currently hidden.
    await api.getDocAPI(doc.id).updateRows("Data1", { id: [2], B: ["clear"] });

    // See the line appear.
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells("A", [1, 2, 3]),
        ["near", "far", "in a motor car"]);
    });

    // Have owner modify a line that is currently shown.
    await api.getDocAPI(doc.id).updateRows("Data1", { id: [1], B: ["not clear"] });
    // And add some new data.
    await api.getDocAPI(doc.id).addRows("Data1", { A: ["chitty"], B: ["clear"] });

    // See the changes take effect.
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells("A", [1, 2, 3]),
        ["far", "in a motor car", "chitty"]);
    });
  });

  it("can hide some rows with a table-based rule", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Make a table, and limit access by email
    await api.applyUserActions(doc.id, [

      ["AddTable", "Jobs", [{ id: "Code" }, { id: "State" }]],
      ["AddRecord", "Jobs", null, { Code: "NNX", State: "MA" }],
      ["AddRecord", "Jobs", null, { Code: "ZN2", State: "MA" }],
      ["AddRecord", "Jobs", null, { Code: "NNX", State: "NY" }],
      ["AddRecord", "Jobs", null, { Code: "ZN3", State: "NY" }],
      ["AddRecord", "Jobs", null, { Code: "YYY", State: "NJ" }],

      ["AddTable", "Assignments", [{ id: "Name" }, { id: "State" }]],
      ["AddRecord", "Assignments", null, { Name: mainSession.user("user2").name, State: "NJ" }],
      ["AddRecord", "Assignments", null, { Name: mainSession.user("user3").name, State: "MA" }],

      ["AddRecord", "_grist_ACLResources", -1, { tableId: "*", colIds: "*" }],
      ["AddRecord", "_grist_ACLResources", -2, { tableId: "Jobs", colIds: "*" }],
      ["AddRecord", "_grist_ACLResources", -3, { tableId: "Assignments", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, userAttributes: JSON.stringify({
          name: "Assignment",
          tableId: "Assignments",
          charId: "Name",
          lookupColId: "Name",
        }),
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -2, aclFormula: "user.Access != OWNER and user.Assignment.State != rec.State",
        permissionsText: "none",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -3, aclFormula: "user.Access != OWNER", permissionsText: "none",
      }],
    ]);

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    // Other users can access document.
    const otherSession = await gu.session().teamSite.user("user2").login();
    await otherSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Jobs/).click();
    await gu.waitForServer();

    // Should see two of the three lines.
    assert.deepEqual(await gu.getVisibleGridCells("Code", [1, 2]),
      ["YYY", ""]);

    // Have owner modify a line that is currently hidden.
    await api.getDocAPI(doc.id).updateRows("Jobs", { id: [2], State: ["NJ"] });

    // See the line appear.
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells("Code", [1, 2, 3]),
        ["ZN2", "YYY", ""]);
    });

    // Have owner modify a line that is currently shown.
    await api.getDocAPI(doc.id).updateRows("Jobs", { id: [5], State: ["MA"] });
    // And add some new data.
    await api.getDocAPI(doc.id).addRows("Jobs", { Code: ["NEW"], State: ["NJ"] });

    // See the changes take effect.
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells("Code", [1, 2, 3]),
        ["ZN2", "NEW", ""]);
    });

    // Make sure editor cannot see assignments.
    assert.equal(await gu.getPageItem(/Assignments/).isPresent(), false);

    // Make sure owner can see assignments.
    await mainSession.login();
    await mainSession.loadDoc(`/doc/${doc.id}`);
    assert.equal(await gu.getPageItem(/Assignments/).isPresent(), true);
  });

  it("can hide some columns", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Make a table, and limit access to columns for non-owners
    await api.applyUserActions(doc.id, [

      ["AddTable", "Jobs", [{ id: "Code" }, { id: "State" }]],
      ["AddRecord", "Jobs", null, { Code: "NNX", State: "MA" }],
      ["AddRecord", "Jobs", null, { Code: "ZN2", State: "MA" }],
      ["AddRecord", "Jobs", null, { Code: "NNX", State: "NY" }],
      ["AddRecord", "Jobs", null, { Code: "ZN3", State: "NY" }],
      ["AddRecord", "Jobs", null, { Code: "YYY", State: "NJ" }],

      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Jobs", colIds: "State" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "none",
      }],
    ]);

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    // Other users can access document.
    const otherSession = await gu.session().teamSite.user("user3").login();
    await otherSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Jobs/).click();
    await gu.waitForServer();

    // Other users see only one column.
    assert.deepEqual(await gu.getColumnNames(), ["Code"]);

    // Make sure owner can see everything.
    await mainSession.login();
    await mainSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Jobs/).click();
    await gu.waitForServer();
    assert.deepEqual(await gu.getColumnNames(), ["Code", "State"]);
  });

  it("can expose some columns", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Make a table, and grant access to specific columns for non-owners
    await api.applyUserActions(doc.id, [

      ["AddTable", "Jobs", [{ id: "Code" }, { id: "State" }]],
      ["AddRecord", "Jobs", null, { Code: "NNX", State: "MA" }],
      ["AddRecord", "Jobs", null, { Code: "ZN2", State: "MA" }],
      ["AddRecord", "Jobs", null, { Code: "NNX", State: "NY" }],
      ["AddRecord", "Jobs", null, { Code: "ZN3", State: "NY" }],
      ["AddRecord", "Jobs", null, { Code: "YYY", State: "NJ" }],

      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Jobs", colIds: "*" }],
      ["AddRecord", "_grist_ACLResources", -2, { tableId: "Jobs", colIds: "Code" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -2, aclFormula: "", permissionsText: "all",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "none",
      }],
    ]);

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    // Other users can access document.
    const otherSession = await gu.session().teamSite.user("user3").login();
    await otherSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Jobs/).click();
    await gu.waitForServer();

    // Other users see only one column.
    assert.deepEqual(await gu.getColumnNames(), ["Code"]);

    // Make sure owner can see everything.
    await mainSession.login();
    await mainSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Jobs/).click();
    await gu.waitForServer();
    assert.deepEqual(await gu.getColumnNames(), ["Code", "State"]);
  });

  it("cannot fork doc with partial access", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Make a table, and limit access to a column.
    await api.applyUserActions(doc.id, [

      ["AddTable", "Jobs", [{ id: "Code" }, { id: "State" }]],
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Jobs", colIds: "State" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "", permissionsText: "none",
      }],
    ]);

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    // Other users can access document, but not fork it.
    const otherSession = await gu.session().teamSite.user("user3").login();
    await otherSession.loadDoc(`/doc/${doc.id}/m/fork`);
    await gu.getPageItem(/Jobs/).click();
    await gu.getCell({ rowNum: 1, col: 0 }).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.ENTER);
    await gu.enterCell("123");
    await gu.waitForServer();
    await driver.findContentWait(".test-notifier-toast-message", /Insufficient access/, 2000);

    // Make sure owner can access document, and fork.
    await mainSession.login();
    await mainSession.loadDoc(`/doc/${doc.id}/m/fork`);
    await gu.getPageItem(/Jobs/).click();
    await gu.getCell({ rowNum: 1, col: 0 }).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.ENTER);
    await gu.enterCell("123");
    await gu.waitForServer();
    await driver.findContentWait(".test-notifier-toast-message", /You are now.*your own copy/, 2000);
  });

  it("can test ACLs as another user", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Make a table, and limit access to a column.
    await api.applyUserActions(doc.id, [

      ["AddTable", "Jobs", [{ id: "Code" }, { id: "State" }]],
      ["AddRecord", "Jobs", 1, { Code: "123", State: "NY" }],
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Jobs", colIds: "State" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "none",
      }],
    ]);

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    const otherSession = await gu.session().user("user2").login();
    const email = otherSession.email;
    const name = otherSession.name;
    const userId = await otherSession.getUserId();

    // Make sure owner can access document, and State column.
    await mainSession.login();
    await mainSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Jobs/).click();
    assert.sameDeepMembers(await gu.getColumnNames(), ["Code", "State"]);
    assert.equal(await driver.find(".test-view-as-banner").isPresent(), false);
    const csvHrefOrig = await getCsvHref("JOBS");

    // Check owner can pose as another user, by email.
    await mainSession.loadDoc(`/doc/${doc.id}?aclAsUser_=${encodeURIComponent(email)}`);
    await gu.getPageItem(/Jobs/).click();
    assert.sameDeepMembers(await gu.getColumnNames(), ["Code"]);

    // Use this scenario to also check that widget download respects the view-as param.
    const csvHrefViewAs = await getCsvHref("JOBS");
    const mainSessionHeaders = { Authorization: `Bearer ${mainSession.getApiKey()}` };
    // The original CSV has two columns; the view-as one has just one.
    assert.equal((await axios.get(csvHrefOrig, { responseType: "text", headers: mainSessionHeaders })).data,
      "Code,State\n123,NY\n");
    assert.equal((await axios.get(csvHrefViewAs, { responseType: "text", headers: mainSessionHeaders })).data,
      "Code\n123\n");

    // Revert view-as.
    assert.equal(await driver.find(".test-view-as-banner").isPresent(), true);
    assert.include(await driver.find(".test-view-as-banner .test-select-open").getText(), name);
    await driver.find(".test-view-as-banner .test-revert").click();
    await gu.waitForDocToLoad();
    assert.sameDeepMembers(await gu.getColumnNames(), ["Code", "State"]);
    assert.equal(await driver.find(".test-view-as-banner").isPresent(), false);

    // Check owner can pose as another user, by user id.
    await mainSession.loadDoc(`/doc/${doc.id}?aclAsUserId_=${userId}`);
    await gu.getPageItem(/Jobs/).click();
    assert.sameDeepMembers(await gu.getColumnNames(), ["Code"]);
    assert.equal(await driver.find(".test-view-as-banner").isPresent(), true);
    assert.include(await driver.find(".test-view-as-banner .test-select-open").getText(), name);
    await driver.find(".test-view-as-banner .test-revert").click();
    await gu.waitForDocToLoad();
    assert.sameDeepMembers(await gu.getColumnNames(), ["Code", "State"]);
    assert.equal(await driver.find(".test-view-as-banner").isPresent(), false);

    // Check editor can't pose as owner.
    await otherSession.teamSite.login();
    await otherSession.teamSite.loadDoc(
      `/doc/${doc.id}?aclAsUser_=${encodeURIComponent(mainSession.email)}`, { wait: false });
    assert.equal(await driver.findWait(".test-dm-org", 2000).isDisplayed(), true);
    assert.match(await driver.findWait(".test-modal-dialog", 5000).getText(), /only an owner/i);
  });

  it("can use ACL users when they exist", async function() {
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });
    const doc2 = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Share the document with editor@example.com, this will create a user
    // in the database. It also used to cause an issue with the View as feature.
    await api.updateDocPermissions(doc2.id, { users: { "editor1@example.com": "editors" } });

    // View as editor@example.com.
    await mainSession.loadDoc(`/doc/${doc.id}?aclAsUser_=${encodeURIComponent("editor1@example.com")}`);

    // Make sure we see all the pages. If the user is read from the database, we won't see them
    // as he doesn't have permission to see this document.
    assert.deepEqual(await gu.getPageNames(), ["Table1"]);
  });

  it('can transition gracefully from "view as" user to regular user', async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: true });
    assert.equal(await gu.getCell("A", 1).getText(), "hello");

    // Make a private column in Table1.
    await api.applyUserActions(doc.id, [
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "A" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "none",
      }],
    ]);

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    // Make sure alternate user has been created.
    await gu.session().user("user3").login();
    await mainSession.login();

    // Open doc, viewing as someone else.
    const otherEmail = gu.session().user("user3").email;
    await mainSession.loadDoc(`/doc/${doc.id}?aclAsUser_=${encodeURIComponent(otherEmail)}`);
    assert.deepEqual(await gu.getColumnNames(), ["B", "C", "D", "E"]);

    // Now open as default user.
    await mainSession.loadDoc(`/doc/${doc.id}`);
    assert.deepEqual(await gu.getColumnNames(), ["A", "B", "C", "D", "E"]);
    // Previously, there was a bug where cached information would leave this column blank.
    assert.equal(await gu.getCell("A", 1).getText(), "hello");

    // Grant editor special access to copy/download/fork document.
    await api.applyUserActions(doc.id, [
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "*SPECIAL", colIds: "FullCopies" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: 'user.Access == "editors"', permissionsText: "+R",
      }],
    ]);

    // Open doc as an editor, viewing it as an owner
    await gu.session().user("user3").login();
    await mainSession.loadDoc(`/doc/${doc.id}/m/fork`);
    await driver.find(".test-tools-access-rules").click();
    await driver.findContentWait("button", /View as/, 3000).click();
    await gu.findOpenMenuItem(".test-acl-user-item", "owner@example.com").click();
    await gu.waitToPass(async () => {
      (await driver.getCurrentUrl())?.match(/aclAsUser/);
    });
    await gu.waitForDocToLoad();
    assert.deepEqual(await gu.getColumnNames(), ["A", "B", "C", "D", "E"]);

    // Open doc as an editor, viewing it as a viewer
    await mainSession.loadDoc(`/doc/${doc.id}/m/fork`);
    await driver.find(".test-tools-access-rules").click();
    await driver.findContentWait("button", /View as/, 3000).click();
    await gu.findOpenMenuItem(".test-acl-user-item", "viewer@example.com").click();
    await gu.waitToPass(async () => {
      (await driver.getCurrentUrl())?.match(/aclAsUser/);
    });
    await gu.waitForDocToLoad();
    assert.deepEqual(await gu.getColumnNames(), ["B", "C", "D", "E"]);
  });

  it('forbids edits when "view as" user is a viewer and access rules are permissive', async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: true });
    assert.equal(await gu.getCell("A", 1).getText(), "hello");

    // Let anyone edit Table1.
    await api.applyUserActions(doc.id, [
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "True", permissionsText: "all",
      }],
    ]);

    // Share the document with everyone as a viewer.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "viewers" } });

    // Open doc, viewing as someone else.
    const otherEmail = gu.session().user("user3").email;
    await mainSession.loadDoc(`/doc/${doc.id}?aclAsUser_=${otherEmail}`);

    // Viewers shouldn't be allowed to edit.
    await gu.getCell("A", 1).click();
    await gu.enterCell("testing");
    await gu.waitForServer();
    assert.equal(await gu.getCell("A", 1).getText(), "hello");

    await driver.findContentWait(".test-notifier-toast-wrapper",
      /Only owners or editors can modify documents/, 2000);
    await gu.wipeToasts();

    // Now open as default user and make sure we can edit.
    await mainSession.loadDoc(`/doc/${doc.id}`);
    await gu.getCell("A", 1).click();
    await gu.enterCell("testing2");
    await gu.waitForServer();
    assert.equal(await gu.getCell("A", 1).getText(), "testing2");
  });

  it("can restrict access via a link parameter", async function() {
    // Create a document owned by default user.
    // Place in personal org, to check SELF_HYPERLINKs in this situation.
    const mainSession = await gu.session().personalSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Make a table, and limit access by a UUID_=... parameter in link.
    await api.applyUserActions(doc.id, [

      ["AddTable", "Jobs", [{ id: "Code" }, { id: "State" }, { id: "Color" }]],
      ["AddRecord", "Jobs", null, { Code: "NNX", State: "MA", Color: "Red" }],
      ["AddRecord", "Jobs", null, { Code: "ZN2", State: "MA", Color: "Red-green" }],
      ["AddRecord", "Jobs", null, { Code: "NNX", State: "NY", Color: "Blue" }],
      ["AddRecord", "Jobs", null, { Code: "ZN3", State: "NY", Color: "Green" }],
      ["AddRecord", "Jobs", null, { Code: "YYY", State: "NJ", Color: "Black" }],

      ["AddTable", "Assignments", [
        { id: "Name" },
        { id: "State" },
        { id: "UUID", isFormula: false, formula: "UUID()" },
        // Make links using SELF_HYPERLINK.  Add a dummy link parameter with funky characters
        // just to make sure they aren't disruptive.
        { id: "Link", isFormula: true,
          formula: 'SELF_HYPERLINK(label="jobs", LinkKey_UUID=$UUID, LinkKey_noise="!! \'\\"{")' }]],
      ["AddRecord", "Assignments", null, { Name: mainSession.user("user2").name, State: "NJ" }],
      ["AddRecord", "Assignments", null, { Name: mainSession.user("user3").name, State: "MA" }],
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "*", colIds: "*" }],
      ["AddRecord", "_grist_ACLResources", -2, { tableId: "Jobs", colIds: "*" }],
      ["AddRecord", "_grist_ACLResources", -3, { tableId: "Assignments", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, userAttributes: JSON.stringify({
          name: "Assignment",
          tableId: "Assignments",
          charId: "LinkKey.UUID",
          lookupColId: "UUID",
        }),
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -2, aclFormula: "user.Access != OWNER and user.Assignment.State != rec.State",
        permissionsText: "none",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        // check that VIEWER constant works
        resource: -3, aclFormula: "user.Access == VIEWER", permissionsText: "none",
      }],
    ]);

    // Share the document with everyone as a viewer.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "viewers" } });

    // Now become the anonymous user.
    const anon = await gu.session().personalSite.anon.login();

    // Open document as a viewer who sees NJ Jobs.
    const assignments = await api.getDocAPI(doc.id).getRows("Assignments");
    const [uuidNJ, uuidMA] = assignments.UUID as string[];
    const [linkNJ, linkMA] = assignments.Link as string[];
    assert.lengthOf(uuidNJ, 36);
    assert.match(linkNJ, new RegExp(`jobs http:.*UUID_=${uuidNJ}`));
    await driver.get(linkNJ.split(" ")[1]);
    await gu.waitForDocToLoad();
    await gu.getPageItem(/Jobs/).click();
    await gu.waitForServer();

    // Check NJ viewer sees what we expect.
    assert.deepEqual(await gu.getColumnNames(), ["Code", "State", "Color"]);
    assert.deepEqual(await gu.getVisibleGridCells("Code", [1, 2]),
      ["YYY", ""]);
    assert.deepEqual(await gu.getVisibleGridCells("Color", [1, 2]),
      ["Black", ""]);

    // Open document as a viewer who sees MA Jobs.
    // Check that the domain of SELF_HYPERLINK looks sane, and
    // urlId is used.
    const { urlId } = await api.getDoc(doc.id);
    assert.match(linkMA, new RegExp(`jobs http:.*/docs/${urlId}/.*UUID_=${uuidMA}`));
    await driver.get(linkMA.split(" ")[1]);
    await gu.waitForDocToLoad();
    await gu.getPageItem(/Jobs/).click();
    await gu.waitForServer();

    // Check MA viewer sees what we expect.
    assert.deepEqual(await gu.getVisibleGridCells("Code", [1, 2, 3]),
      ["NNX", "ZN2", ""]);
    assert.deepEqual(await gu.getVisibleGridCells("Color", [1, 2, 3]),
      ["Red", "Red-green", ""]);

    // Open document without a UUID.
    await anon.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Jobs/).click();
    await gu.waitForServer();

    // Check we see nothing.
    assert.deepEqual(await gu.getVisibleGridCells("Code", [1]),
      [""]);

    // Check that we do not see Assignments table.
    assert.deepEqual(await gu.getPageNames(), ["Table1", "Jobs"]);
  });

  it("can recover from completely broken rules", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Share the document with everyone as a viewer.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "viewers" } });

    // Try to add a broken rule. We shouldn't be able to.
    await assert.isRejected(api.applyUserActions(doc.id, [
      ["AddRecord", "_grist_ACLResources", null, { tableId: "*", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: 2, aclFormula: "UnknownVariable",
        permissionsText: "none",
      }],
    ]), /Unknown variable 'UnknownVariable'/);

    // Check that the rule did NOT get applied, and that we still have access.
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("_grist_ACLResources")).id, [1]);
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("_grist_ACLRules")).id, [1]);
    await assert.isFulfilled(api.getDocAPI(doc.id).getRows("Table1"));

    // If we do get a bad rule in, the document should fail to load except in recovery mode.
    // To get a corrupted document, sneak in some bad rules using SQL.
    await api.applyUserActions(doc.id, [
      ["AddRecord", "_grist_ACLResources", null, { tableId: "*", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: 2, aclFormula: "False",
        permissionsText: "none",
      }],
    ]);
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("_grist_ACLResources")).id, [1, 2]);
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("_grist_ACLRules")).id, [1, 2]);
    await execFile("sqlite3", [`${server.testDocDir}/${doc.id}.grist`,
      `UPDATE _grist_ACLRules SET aclFormula='UnknownVariable', ` +
      `aclFormulaParsed='["Name", "UnknownVariable"]' WHERE id=2`]);
    await api.getDocAPI(doc.id).forceReload();

    // Check document is failing to load now.
    await assert.isRejected(api.getDocAPI(doc.id).getRows("Table1"));
    await mainSession.loadDoc(`/doc/${doc.id}`, { wait: false });
    assert.match(await driver.findWait(".test-modal-dialog", 5000).getText(),
      /Error accessing document.*You can try.*recovery mode.*UnknownVariable/s);

    // Enter recovery mode.
    await driver.find(".test-modal-recovery-mode").click();
    await gu.waitToPass(async () => {
      assert.equal(await driver.find(".test-recovery-mode-tag").isPresent(), true);
    }, 10000);

    // Leave recovery mode.
    await driver.find(".test-recovery-mode-tag a").click();
    await gu.waitToPass(async () => {
      assert.match(await driver.findWait(".test-modal-dialog", 5000).getText(),
        /Error accessing document.*You can try.*recovery mode.*UnknownVariable/s);
    }, 10000);

    // Enter recovery mode again.
    await driver.find(".test-modal-recovery-mode").click();
    await gu.waitToPass(async () => {
      assert.equal(await driver.find(".test-recovery-mode-tag").isPresent(), true);
    }, 10000);
    assert.deepEqual(await gu.getVisibleGridCells("A", [1, 2]), ["hello", ""]);

    // Try to access as viewer now.
    const anon = await gu.session().teamSite.anon.login();
    await anon.loadDoc(`/doc/${doc.id}`, { wait: false });
    // No tables listed.
    // Can't do a regular wait-to-load, since it checks for sections. So just wait a bit.
    await driver.sleep(2000);
    assert.deepEqual(await gu.getPageNames(), []);
  });

  it("can see which access rules could have helped access", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Make a table, and add full, table, and column level restrictions.
    await api.applyUserActions(doc.id, [

      ["AddTable", "TableN", [{ id: "A" }, { id: "B" }]],
      ["AddRecord", "TableN", null, { A: "A", B: "B" }],

      ["AddRecord", "_grist_ACLResources", -1, { tableId: "*", colIds: "*" }],
      ["AddRecord", "_grist_ACLResources", -2, { tableId: "TableN", colIds: "*" }],
      ["AddRecord", "_grist_ACLResources", -3, { tableId: "TableN", colIds: "A" }],
      ["AddRecord", "_grist_ACLResources", -4, { tableId: "TableN", colIds: "B" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access == EDITOR", permissionsText: "all", memo: "rule1",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -2, aclFormula: "user.Access == EDITOR", permissionsText: "all", memo: "rule2",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -2, aclFormula: "user.Access != EDITOR", permissionsText: "-C", memo: "rule2b",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -3, aclFormula: "user.Access != EDITOR", permissionsText: "-U", memo: "rule3",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -4, aclFormula: "user.Access != EDITOR", permissionsText: "-U", memo: "rule4",
      }],
    ]);

    // Note that we'll be trying changes as OWNER, who is denied access by the rules above.
    await mainSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/TableN/).click();
    await gu.waitForServer();

    const checkMemos = stackWrapFunc(async function checkMemos(
      { rowNum, col, value, save, blockedBy}: {
        rowNum: number,
        col: number,
        value: string,
        save: "enter" | "click",
        blockedBy: "table" | "column"
      },
    ) {
      const cell = gu.getCell({ rowNum, col });
      assert.equal(await cell.getText(), value);
      assert.isFalse(await driver.find(".test-notifier-toast-wrapper").isPresent());
      await cell.click();
      await gu.waitAppFocus();
      await gu.sendKeys("XYZ");
      if (save === "enter") {
        await gu.sendKeys(Key.ENTER);
      } else {
        await gu.getCell({ rowNum, col: col + 1 }).click();
      }
      await gu.waitForServer();
      const message = await driver.findWait(".test-notifier-toast-wrapper", 2000).getText();

      // The last character in each regexp is the "x" to close the toast.
      const expectedRegex = (blockedBy === "column") ?
        /^Blocked by column update access rules\nrule3\nrule2\nrule1\n.$/ :
        /^Blocked by table create access rules\nrule2\nrule2b\nrule1\n.$/;

      assert.match(message, expectedRegex);
      await gu.wipeToasts();
    });

    // Try saving both with Enter and with clicking away, since toasts were not always
    // consistently shown in both cases in the past.
    // Also try saving in an existing row and in a new row, since saving an existing row uses
    // opportunistic error handling, and errors are reported via a different code path.
    await checkMemos({ rowNum: 1, col: 0, value: "A", save: "enter", blockedBy: "column" });
    await checkMemos({ rowNum: 1, col: 0, value: "A", save: "click", blockedBy: "column" });
    await checkMemos({ rowNum: 2, col: 0, value: "", save: "enter", blockedBy: "table" });
    await checkMemos({ rowNum: 2, col: 0, value: "", save: "click", blockedBy: "table" });
  });

  it("honors schema flag for sections", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login({ showTips: false });
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Forbid all but owner from making schema changes.
    await api.applyUserActions(doc.id, [
      ["AddTable", "Table1", [{ id: "A" }, { id: "B" }]],
      ["AddRecord", "Table1", null, { A: "A", B: "B" }],
      ["AddTable", "Table2", [{ id: "A" }, { id: "B" }]],
      ["AddTable", "Table3", [{ id: "A" }, { id: "B" }]],
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "*", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "-S",
      }],
    ]);

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    // Owner can add a section.
    await mainSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Table1/).click();
    await gu.waitForServer();
    await gu.addNewSection(/Table/, /Table2/);
    assert.deepEqual(await gu.getSectionTitles(), ["TABLE1", "TABLE2"]);

    // Editor can't add a section.
    const otherSession = await gu.session().teamSite.user("user2").addLogin();
    await otherSession.loadDoc(`/doc/${doc.id}`);
    await gu.disableTips(gu.translateUser("user2").email);
    await gu.getPageItem(/Table1/).click();
    await gu.waitForServer();
    // TODO: Can remove dismissTips after a fix has landed for user prefs not loading correctly.
    await gu.addNewSection(/Table/, /Table1/, { dismissTips: true });
    await gu.waitForServer();
    await driver.findContentWait(".test-notifier-toast-wrapper",
      /Blocked by table structure access rules/, 2000);
    await gu.wipeToasts();
    assert.deepEqual(await gu.getSectionTitles(), ["TABLE1", "TABLE2"]);

    // Editor can't remove a section.
    await gu.openSectionMenu("viewLayout", "TABLE2");
    await driver.findWait(".test-section-delete", 2000).click();
    await gu.waitForServer();
    await driver.findContentWait(".test-notifier-toast-wrapper",
      /Blocked by table structure access rules/, 2000);
    await gu.wipeToasts();
    assert.deepEqual(await gu.getSectionTitles(), ["TABLE1", "TABLE2"]);

    // Owner can remove a section.
    await mainSession.login();
    await mainSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Table1/).click();
    await gu.waitForServer();
    await gu.openSectionMenu("viewLayout", "TABLE2");
    await driver.findWait(".test-section-delete", 2000).click();
    await gu.waitForServer();
    assert.deepEqual(await gu.getSectionTitles(), ["TABLE1"]);
  });

  it("updates view visibility without reload", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Initially, only owner can view Table2.
    await api.applyUserActions(doc.id, [

      ["AddTable", "Table2", [{ id: "A" }, { id: "B" }]],
      ["AddTable", "Table3", [{ id: "A" }, { id: "B" }]],

      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table2", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "none",
      }],
    ]);

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    // Open a tab for editor.
    await mainSession.loadDoc(`/doc/${doc.id}`);
    await driver.executeScript("window.open('about:blank', '_blank')");
    const [ownerTab, editorTab] = await driver.getAllWindowHandles();

    // Check Table2 is not listed for editor.
    await driver.switchTo().window(editorTab);
    const otherSession = await gu.session().teamSite.user("user2").addLogin();
    await otherSession.loadDoc(`/doc/${doc.id}`);
    assert.deepEqual(await gu.getPageNames(), ["Table1", "Table3"]);

    // Switch page called "Table2" to in fact show "Table3".
    await driver.switchTo().window(ownerTab);
    await gu.getPageItem("Table2").click();
    await gu.getSection("Table2").click();
    await gu.toggleSidePanel("right", "open");
    await driver.findContent(".test-right-panel button", /Change widget/).click();
    await gu.selectWidget(/Table/, /Table3/);
    await gu.waitForServer();

    // Now editor should see that page.
    await driver.switchTo().window(editorTab);
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getPageNames(), ["Table1", "Table2", "Table3"]);
    });

    // Switch page back to show original content.
    await driver.switchTo().window(ownerTab);
    await gu.getPageItem("Table2").click();
    await gu.getSection("Table3").click();
    await gu.toggleSidePanel("right", "open");
    await driver.findContent(".test-right-panel button", /Change widget/).click();
    await gu.selectWidget(/Table/, /Table2/);
    await gu.waitForServer();

    // Now editor won't see it anymore.
    await driver.switchTo().window(editorTab);
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getPageNames(), ["Table1", "Table3"]);
    });

    await driver.switchTo().window(editorTab);
    await driver.close();
    await driver.switchTo().window(ownerTab);
  });

  it("can share a forkable template with access rules with viewers", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    await api.applyUserActions(doc.id, [

      ["AddTable", "Table2", [{ id: "A" }, { id: "B" }]],
      ["AddTable", "Table3", [{ id: "A" }, { id: "B" }]],

      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table2", colIds: "*" }],
      ["AddRecord", "_grist_ACLResources", -2, { tableId: "*SPECIAL", colIds: "FullCopies" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: 'user.Access != "owners"', permissionsText: "none",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -2, aclFormula: 'user.Access == "viewers"', permissionsText: "+R",
      }],
    ]);

    // Share the document with everyone as a viewer.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "viewers" } });

    // Check anon cannot edit doc.
    const anon = await mainSession.anon.addLogin();
    await anon.loadDoc(`/doc/${doc.id}?aclUI=1`);
    await gu.getCell({ rowNum: 1, col: 0 }).click();
    await gu.enterCell("Testing1");
    await gu.waitForServer();
    assert.notEqual(await gu.getCell({ rowNum: 1, col: 0 }).getText(), "Testing1");

    // Check anon can create a fork.
    await anon.loadDoc(`/doc/${doc.id}/m/fork?aclUI=1`);
    await gu.getCell({ rowNum: 1, col: 0 }).click();
    await gu.sendKeys("Testing2", Key.ENTER);
    await gu.waitForServer(10000);
    assert.equal(await gu.getCell({ rowNum: 1, col: 0 }).getText(), "Testing2");
    const forkUrl = await driver.getCurrentUrl();
    assert.match(forkUrl, /~/);

    // Check viewer can't edit schema.
    await assert.isRejected(anon.createHomeApi().applyUserActions(doc.id, [
      ["AddEmptyTable", null],
    ]), /No write access/);
    await anon.loadDoc(`/doc/${doc.id}?aclUI=1`, { wait: false });
    await gu.acceptAlert({ ignore: true });
    await gu.waitForDocToLoad();
    assert.match(
      await driver.executeAsyncScript(
        (done: any) =>
          (window as any).gristDocPageModel.gristDoc.get()
            .docComm.applyUserActions([["AddEmptyTable", null]])
            .then(done).catch((e: any) => done(String(e)))),
      /No write access/);
    await gu.wipeToasts();
    await driver.findWait(".test-dp-add-new", 2000).click();
    assert(await driver.findWait(".test-dp-empty-table", 2000).matches(".disabled"));
  });

  it("can handle changes of many rows", async function() {
    // Use World fixtures, which has more rows than can be passed directly to SQLite
    // as parameters.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "World.grist", { load: false });

    // Add a dummy ACL rule that depends on rows, to trigger a fetch of rows during
    // access control calculations. (At time of writing, almost anything is sufficient
    // unfortunately, but this should get optimized).
    // Add a formula column that we can conveniently update later to affect all rows.
    await api.applyUserActions(doc.id, [
      ["AddVisibleColumn", "City", "Len", { isFormula: true, formula: "len($Name)" }],
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "City", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: 'user.Access != OWNER and rec.Name == "N/A"', permissionsText: "-CRUD",
      }],
    ]);

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    // Check length formula is working.
    const otherSession = await gu.session().teamSite.user("user2").addLogin();
    await otherSession.loadDoc(`/doc/${doc.id}`);
    await gu.getCell({ rowNum: 1, col: "Len" }).click();
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCell({ rowNum: 1, col: "Len" }).getText(), "28");
    });

    // Check length formula can be updated without trouble (previously, this would tickle
    // a problem with maximum number of SQLite parameters).
    await gu.enterFormula("len($Name) + 1");
    await gu.waitForServer();
    assert.equal(await gu.getCell({ rowNum: 1, col: "Len" }).getText(), "29");
  });

  it("can hide some rows and columns", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.addLogin();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Make a table, and limit access by email
    await api.applyUserActions(doc.id, [

      ["AddTable", "Jobs", [{ id: "Code" }, { id: "State" }, { id: "Color" },
        { id: "Len", isFormula: true, formula: 'len($Code or "")' }]],
      ["AddRecord", "Jobs", null, { Code: "NNX", State: "MA", Color: "Red" }],
      ["AddRecord", "Jobs", null, { Code: "ZN2", State: "MA", Color: "Red-green" }],
      ["AddRecord", "Jobs", null, { Code: "NNX", State: "NY", Color: "Blue" }],
      ["AddRecord", "Jobs", null, { Code: "ZN3", State: "NY", Color: "Green" }],
      ["AddRecord", "Jobs", null, { Code: "YYY", State: "NJ", Color: "Black" }],

      ["AddTable", "Assignments", [{ id: "Name" }, { id: "State" }]],
      ["AddRecord", "Assignments", null, { Name: mainSession.user("user2").name, State: "NJ" }],
      ["AddRecord", "Assignments", null, { Name: mainSession.user("user3").name, State: "MA" }],

      ["AddRecord", "_grist_ACLResources", -1, { tableId: "*", colIds: "*" }],
      ["AddRecord", "_grist_ACLResources", -2, { tableId: "Jobs", colIds: "*" }],
      ["AddRecord", "_grist_ACLResources", -3, { tableId: "Assignments", colIds: "*" }],
      ["AddRecord", "_grist_ACLResources", -4, { tableId: "Jobs", colIds: "State" }],
      ["AddRecord", "_grist_ACLResources", -5, { tableId: "Jobs", colIds: "Color" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, userAttributes: JSON.stringify({
          name: "Assignment",
          tableId: "Assignments",
          charId: "Name",
          lookupColId: "Name",
        }),
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -2, aclFormula: "user.Access != OWNER and user.Assignment.State != rec.State",
        permissionsText: "none",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -3, aclFormula: "user.Access != OWNER", permissionsText: "none",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -4, aclFormula: "user.Access != OWNER", permissionsText: "none",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -5, aclFormula: 'user.Access != OWNER and not "Red" in rec.Color', permissionsText: "none",
      }],
    ]);

    await mainSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Jobs/).click();

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    // Open two tabs alongside the owner.
    await driver.executeScript("window.open('about:blank', '_blank')");
    await driver.executeScript("window.open('about:blank', '_blank')");
    const [ownerTab, editorTab, editorTab2] = await driver.getAllWindowHandles();

    // Open document as an editor who sees NJ Jobs in one of those tabs.
    await driver.switchTo().window(editorTab);
    const otherSession = await gu.session().teamSite.user("user2").addLogin();
    await otherSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Jobs/).click();
    await gu.waitForServer();

    // Open document as an editor who sees MA Jobs in another of those tabs.
    await driver.switchTo().window(editorTab2);
    const otherSession2 = await gu.session().teamSite.user("user3").addLogin();
    await otherSession2.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Jobs/).click();
    await gu.waitForServer();

    // Check NJ editor sees what we expect.
    // Second row is the add row so cells are empty
    await driver.switchTo().window(editorTab);
    assert.deepEqual(await gu.getColumnNames(), ["Code", "Color", "Len"]);
    assert.deepEqual(await gu.getVisibleGridCells("Code", [1, 2]),
      ["YYY", ""]);
    assert.deepEqual(await gu.getVisibleGridCells("Color", [1, 2]),
      ["CENSORED", ""]);
    let censoredCell = gu.getCell({ col: "Color", rowNum: 1 });
    assert.equal(await censoredCell.find(".invalid.field-error-C" /* C = censored */).getText(), "CENSORED");

    // Check MA editor sees what we expect.
    await driver.switchTo().window(editorTab2);
    assert.deepEqual(await gu.getColumnNames(), ["Code", "Color", "Len"]);
    assert.deepEqual(await gu.getVisibleGridCells("Code", [1, 2, 3]),
      ["NNX", "ZN2", ""]);
    assert.deepEqual(await gu.getVisibleGridCells("Color", [1, 2, 3]),
      ["Red", "Red-green", ""]);
    await driver.switchTo().window(editorTab);

    // Have owner modify a line to make it visible to NJ editor.
    await driver.switchTo().window(ownerTab);
    assert.equal(await gu.getCell({ rowNum: 2, col: 1 }).getText(), "MA");
    await gu.getCell({ rowNum: 2, col: 1 }).click();
    await gu.waitAppFocus();
    await gu.enterCell("NJ");
    await gu.waitForServer();
    assert.equal(await gu.getCell({ rowNum: 2, col: 1 }).getText(), "NJ");

    // See the line appear for NJ editor.
    await driver.switchTo().window(editorTab);
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells("Code", [1, 2, 3]),
        ["ZN2", "YYY", ""]);
      assert.deepEqual(await gu.getVisibleGridCells("Color", [1, 2, 3]),
        ["Red-green", "CENSORED", ""]);
    });
    censoredCell = gu.getCell({ col: "Color", rowNum: 2 });
    assert.equal(await censoredCell.find(".invalid.field-error-C" /* C = censored */).getText(), "CENSORED");

    // See the line disappear for NJ editor.
    await driver.switchTo().window(editorTab2);
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells("Code", [1, 2]),
        ["NNX", ""]);
      assert.deepEqual(await gu.getVisibleGridCells("Color", [1, 2]),
        ["Red", ""]);
    });

    // Have owner modify a line that is currently shown for NJ.
    await driver.switchTo().window(ownerTab);
    assert.equal(await gu.getCell({ rowNum: 5, col: 1 }).getText(), "NJ");
    await gu.getCell({ rowNum: 5, col: 1 }).click();
    await gu.waitAppFocus();
    await gu.enterCell("MA");
    assert.equal(await gu.getCell({ rowNum: 5, col: 1 }).getText(), "MA");
    // And add some new data.
    await gu.getCell({ rowNum: 6, col: 0 }).click();
    await gu.enterCell("NEW");
    await gu.getCell({ rowNum: 6, col: 1 }).click();
    await gu.enterCell("NJ");
    await gu.getCell({ rowNum: 6, col: 2 }).click();
    await gu.enterCell("Green");
    assert.equal(await gu.getCell({ rowNum: 6, col: 0 }).getText(), "NEW");
    assert.equal(await gu.getCell({ rowNum: 6, col: 1 }).getText(), "NJ");
    assert.equal(await gu.getCell({ rowNum: 6, col: 2 }).getText(), "Green");
    await gu.waitForServer();
    // And delete a row.
    await gu.removeRow(2);

    // See the changes take effect.
    await driver.switchTo().window(editorTab);
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells("Code", [1, 2]),
        ["NEW", ""]);
      assert.deepEqual(await gu.getVisibleGridCells("Color", [1, 2]),
        ["CENSORED", ""]);
    });
    censoredCell = gu.getCell({ col: "Color", rowNum: 1 });
    assert.equal(await censoredCell.find(".invalid.field-error-C" /* C = censored */).getText(), "CENSORED");

    // The editor should be able to modify the material accessible to them.
    assert.equal(await gu.getCell({ rowNum: 1, col: 0 }).getText(), "NEW");
    await gu.waitAppFocus();
    await gu.getCell({ rowNum: 1, col: 0 }).click();
    await gu.enterCell("NUEVA");
    assert.equal(await gu.getCell({ rowNum: 1, col: 0 }).getText(), "NUEVA");

    // Check owner sees changes.
    await driver.switchTo().window(ownerTab);
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCell({ rowNum: 5, col: 0 }).getText(), "NUEVA");
    });

    // Censored cell will not be editable because of the specific rule we set up.
    await driver.switchTo().window(editorTab);
    assert.lengthOf(await gu.getToasts(), 0);
    censoredCell = gu.getCell({ col: "Color", rowNum: 1 });
    assert.equal(await censoredCell.find(".invalid.field-error-C" /* C = censored */).getText(), "CENSORED");
    await gu.getCell({ rowNum: 1, col: 1 }).click();
    await gu.waitAppFocus();
    await gu.enterCell("Red");
    assert.equal(await gu.getCell({ rowNum: 1, col: 1 }).getText(), "CENSORED");
    assert.lengthOf(await gu.getToasts(), 0);

    // Check write did not happen (technically would need to wait some time to
    // be absolutely sure).
    await driver.switchTo().window(ownerTab);
    assert.equal(await gu.getCell({ rowNum: 5, col: 2 }).getText(), "Green");
    // and make another row available to NJ.
    assert.equal(await gu.getCell({ rowNum: 1, col: 0 }).getText(), "NNX");
    assert.equal(await gu.getCell({ rowNum: 1, col: 2 }).getText(), "Red");
    await gu.getCell({ rowNum: 1, col: 1 }).click();
    await gu.waitAppFocus();
    await gu.enterCell("NJ");
    assert.equal(await gu.getCell({ rowNum: 1, col: 1 }).getText(), "NJ");

    // Uncensored cell will be editable because of the specific rule we set up.
    await driver.switchTo().window(editorTab);
    assert.lengthOf(await gu.getToasts(), 0);
    assert.equal(await gu.getCell({ rowNum: 1, col: 1 }).getText(), "Red");
    await gu.getCell({ rowNum: 1, col: 1 }).click();
    await gu.waitAppFocus();
    await gu.enterCell("Red2");
    await gu.waitForServer();
    // editor is in a readonly mode - so no warnings should be produced.
    assert.lengthOf(await gu.getToasts(), 0);

    // Check write did happen.
    await driver.switchTo().window(ownerTab);
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCell({ rowNum: 1, col: 2 }).getText(), "Red2");
    });

    // Have owner change assignment for first editor from NJ to NY
    await driver.switchTo().window(ownerTab);
    await gu.getPageItem(/Assignments/).click();
    assert.equal(await gu.getCell({ rowNum: 1, col: 1 }).getText(), "NJ");
    await gu.getCell({ rowNum: 1, col: 1 }).click();
    await gu.waitAppFocus();
    await gu.enterCell("NY");
    assert.equal(await gu.getCell({ rowNum: 1, col: 1 }).getText(), "NY");

    // Check that assignment change takes effect.
    await driver.switchTo().window(editorTab);
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells("Code", [1, 2, 3]),
        ["NNX", "ZN3", ""]);
    });

    // Place cursor off first row, then make a change to assignment for other
    // user, and make sure our cursor doesn't change (no reload triggered).
    await gu.getCell({ rowNum: 2, col: 1 }).click();

    // Have owner change assignment for second editor from MA to NJ
    await driver.switchTo().window(ownerTab);
    await gu.getPageItem(/Assignments/).click();
    assert.equal(await gu.getCell({ rowNum: 2, col: 1 }).getText(), "MA");
    await gu.getCell({ rowNum: 2, col: 1 }).click();
    await gu.waitAppFocus();
    await gu.enterCell("NJ");
    assert.equal(await gu.getCell({ rowNum: 2, col: 1 }).getText(), "NJ");

    // Check that assignment change takes effect for second editor.
    await driver.switchTo().window(editorTab2);
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getVisibleGridCells("Code", [1, 2, 3]),
        ["NNX", "NUEVA", ""]);
    });

    // Check that cursor didn't change for first user.
    await driver.switchTo().window(editorTab);
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 2, col: 1 });

    await driver.switchTo().window(editorTab2);
    await driver.close();
    await driver.switchTo().window(editorTab);
    await driver.close();
    await driver.switchTo().window(ownerTab);
  });

  it("can distinguish between logged in users and different anonymous users", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.addLogin();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Make a table, and set up rules so that users can add rows and edit rows they added,
    // and see their own rows plus rows marked by an owner moderator.
    await api.applyUserActions(doc.id, [

      ["AddTable", "Ideas", [{ id: "Idea" }, { id: "Category" }, { id: "Author" }, { id: "ShowAll" }]],
      ["AddRecord", "Ideas", null, { Idea: "Blank" }],

      ["AddRecord", "_grist_ACLResources", -1, { tableId: "*", colIds: "*" }],
      ["AddRecord", "_grist_ACLResources", -2, { tableId: "Ideas", colIds: "*" }],
      ["AddRecord", "_grist_ACLResources", -3, { tableId: "Ideas", colIds: "Author,ShowAll" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER",
        permissionsText: "-S",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -2,
        aclFormula: "user.Access == OWNER",
        permissionsText: "all",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -2,
        aclFormula: "rec.ShowAll or rec.Author == user.SessionID",
        permissionsText: "+R",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -2, aclFormula: "rec.Author != user.SessionID", permissionsText: "none",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -3, aclFormula: "user.Access != OWNER", permissionsText: "none",
      }],
    ]);

    await mainSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Ideas/).click();

    // Set up trigger formula to populate Author column with SessionID.
    await gu.getCell({ col: "Author", rowNum: 1 }).click();
    // Open column configuration.
    await gu.toggleSidePanel("right", "open");
    await driver.find(".test-right-tab-field").click();
    // Enter formula.
    await driver.find(".test-field-set-trigger").click();
    await gu.waitAppFocus(false);
    await gu.sendKeys("user.SessionID", Key.ENTER);
    await gu.waitForServer();

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    // Open two tabs alongside the owner.
    await driver.executeScript("window.open('about:blank', '_blank')");
    await driver.executeScript("window.open('about:blank', '_blank')");
    const [ownerTab, editorTab, editorTab2] = await driver.getAllWindowHandles();

    // Open document as a (logged in) editor and make sure we can add rows and edit them.
    await driver.switchTo().window(editorTab);
    const otherSession = await gu.session().teamSite.user("user2").addLogin();
    await otherSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Ideas/).click();
    await gu.waitForServer();
    await addRecord("Idea");
    await gu.enterCell("Cool");
    let rowNum = await addRecord("Idea");
    await gu.enterCell("Cool2");
    await gu.getCell({ col: "Category", rowNum }).click();
    await gu.enterCell("Cat2");
    await gu.getCell({ col: "Idea", rowNum }).click();
    await gu.enterCell("Cool2b");
    assert.equal(await gu.getCell({ col: "Category", rowNum }).getText(), "Cat2");
    assert.equal(await gu.getCell({ col: "Idea", rowNum }).getText(), "Cool2b");

    // Open document as a different editor, this one anonymous.
    await driver.switchTo().window(editorTab2);
    const otherSession2 = await gu.session().teamSite.anon.addLogin();
    await otherSession2.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Ideas/).click();
    await gu.waitForServer();
    rowNum = await addRecord("Idea");
    assert.equal(rowNum, 1);  // not seeing anyone else's records yet
    await gu.enterCell("Beans");
    await addRecord("Idea");
    await gu.enterCell("Beans2");

    // Check owner moderator sees all.
    await driver.switchTo().window(ownerTab);
    await gu.waitToPass(async () => {
      assert.equal(await gu.getGridRowCount(), 6);
    });
    // Check author starts with u for users, and a for an anonymous user.
    assert.deepEqual(
      (await gu.getVisibleGridCells("Author", [2, 3, 4, 5])).map(a => a[0]),
      ["u", "u", "a", "a"]);
    // Mark these added rows to show to all.
    for (rowNum = 2; rowNum <= 5; rowNum++) {
      await gu.getCell({ rowNum, col: "ShowAll" }).click();
      await gu.enterCell("1");
    }
    await gu.waitForServer();

    // See other lines appear for an editor.
    await driver.switchTo().window(editorTab);
    await gu.waitToPass(async () => {
      assert.equal(await gu.getGridRowCount(), 5);
    });
    // Check that editor can change one of their own rows.
    assert.equal(await gu.getCell({ col: "Idea", rowNum: 1 }).getText(), "Cool");
    await gu.getCell({ col: "Idea", rowNum: 1 }).click();
    await gu.enterCell("Coolb");
    assert.equal(await gu.getCell({ col: "Idea", rowNum: 1 }).getText(), "Coolb");
    assert.lengthOf(await gu.getToasts(), 0);

    // Check editor can't change a row for which they are not author.
    assert.equal(await gu.getCell({ col: "Idea", rowNum: 3 }).getText(), "Beans");
    await gu.getCell({ col: "Idea", rowNum: 3 }).click();
    await gu.enterCell("Beansb");
    assert.equal(await gu.getCell({ col: "Idea", rowNum: 3 }).getText(), "Beans");
    await driver.findContentWait(".test-notifier-toast-wrapper",
      /Blocked by row update access rules/, 2000);
    await gu.wipeToasts();

    // Now see anon's perspective.
    await driver.switchTo().window(editorTab2);
    await gu.waitToPass(async () => {
      assert.equal(await gu.getGridRowCount(), 5);
    });

    // Check that anon can change one of their own rows.
    assert.equal(await gu.getCell({ col: "Idea", rowNum: 3 }).getText(), "Beans");
    await gu.getCell({ col: "Idea", rowNum: 3 }).click();
    await gu.enterCell("Beansb");
    assert.equal(await gu.getCell({ col: "Idea", rowNum: 3 }).getText(), "Beansb");
    assert.lengthOf(await gu.getToasts(), 0);

    // Check anon can't change a row for which they are not author.
    assert.equal(await gu.getCell({ col: "Idea", rowNum: 1 }).getText(), "Coolb");
    await gu.getCell({ col: "Idea", rowNum: 1 }).click();
    await gu.enterCell("Coolbb");
    assert.equal(await gu.getCell({ col: "Idea", rowNum: 1 }).getText(), "Coolb");
    await driver.findContentWait(".test-notifier-toast-wrapper",
      /Blocked by row update access rules/, 2000);
    await gu.wipeToasts();

    // Close the extra tabs and wipe cookies.
    await driver.switchTo().window(editorTab2);
    await driver.close();
    await driver.switchTo().window(editorTab);
    await driver.close();
    await driver.switchTo().window(ownerTab);
    await driver.manage().deleteAllCookies();

    // Start a new anonymous session.
    const anotherAnon = await gu.session().teamSite.anon.login();
    await anotherAnon.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Ideas/).click();
    await gu.waitForServer();
    assert.equal(await gu.getGridRowCount(), 5);

    // Can't change logged-in editor's rows.
    assert.equal(await gu.getCell({ col: "Idea", rowNum: 1 }).getText(), "Coolb");
    await gu.getCell({ col: "Idea", rowNum: 1 }).click();
    await gu.enterCell("Coolbb");
    assert.equal(await gu.getCell({ col: "Idea", rowNum: 1 }).getText(), "Coolb");
    await driver.findContentWait(".test-notifier-toast-wrapper",
      /Blocked by row update access rules/, 2000);
    await gu.wipeToasts();

    // Can't change other anonymous user's rows.
    assert.equal(await gu.getCell({ col: "Idea", rowNum: 3 }).getText(), "Beansb");
    await gu.getCell({ col: "Idea", rowNum: 3 }).click();
    await gu.enterCell("Beansbb");
    assert.equal(await gu.getCell({ col: "Idea", rowNum: 3 }).getText(), "Beansb");
    await driver.findContentWait(".test-notifier-toast-wrapper",
      /Blocked by row update access rules/, 2000);
    await gu.wipeToasts();

    // Can add and edit a row of their own.
    rowNum = await addRecord("Idea");
    await gu.enterCell("Goose");
    await gu.getCell({ col: "Idea", rowNum }).click();
    await gu.enterCell("Gooseb");
    assert.equal(await gu.getCell({ col: "Idea", rowNum }).getText(), "Gooseb");
  });

  it("uses name in database for user.Name", async function() {
    const mainSession = await gu.session().teamSite.addLogin();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist");

    // Make a trigger formula in column A to record user.Name when record changed.
    await gu.getCell({ col: "A", rowNum: 1 }).click();
    await gu.toggleSidePanel("right", "open");
    await driver.find(".test-right-tab-field").click();
    await driver.find(".test-field-set-trigger").click();
    await gu.waitAppFocus(false);
    await gu.sendKeys("user.Name", Key.ENTER);
    await gu.waitForServer();
    await driver.find(".test-field-formula-apply-on-changes").click();
    await driver.find(".test-field-triggers-select").click();
    await driver.findContentWait(".test-field-triggers-dropdown label", "Any field", 100).click();
    await driver.find(".test-trigger-deps-apply").click();
    await gu.waitForServer();

    const user = await api.getUserProfile();
    const originalName = user.name;
    try {
      // Change name by api, reload doc, change a cell and make sure user.Name
      // matches what we set.
      for (const name of ["x", "y"]) {
        await api.updateUserName(name);
        await mainSession.loadDoc(`/doc/${doc.id}`);
        await gu.getCell({ col: "B", rowNum: 1 }).click();
        await gu.enterCell("change by " + name);
        await gu.waitForServer();
        assert.equal(await gu.getCell({ col: "A", rowNum: 1 }).getText(), name);
      }
    } finally {
      await api.updateUserName(originalName);
    }
  });

  it("controls read access to attachment content", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Make a table, and limit non-owner access to some rows.
    await api.applyUserActions(doc.id, [
      ["AddTable", "Data1", [{ id: "A" },
        { id: "B" },
        { id: "Pics", type: "Attachments" },
        { id: "Public", isFormula: true, formula: '$B == "clear"' }]],
      ["AddRecord", "Data1", null, { A: "near", B: "clear" }],
      ["AddRecord", "Data1", null, { A: "far", B: "notclear" }],
      ["AddRecord", "Data1", null, { A: "in a motor car", B: "clear" }],
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Data1", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER and not rec.Public", permissionsText: "none",
      }],
    ]);

    await mainSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Data1/).click();
    await gu.waitForServer();
    await gu.getCell("Pics", 1).click();
    await driver.sendKeys(Key.ENTER);
    await gu.fileDialogUpload("uploads/sample.pdf,uploads/file1.mov", () => driver.find(".test-pw-add").click());
    await driver.findContentWait(".test-pw-counter", /of 2/, 3000);
    await driver.find(".test-modal-dialog .test-pw-close").click();
    await gu.waitForServer();

    await gu.getCell("Pics", 2).click();
    await driver.sendKeys(Key.ENTER);
    await gu.fileDialogUpload("uploads/grist.png", () => driver.find(".test-pw-add").click());
    await driver.findContentWait(".test-pw-counter", /of 1/, 3000);
    await driver.find(".test-modal-dialog .test-pw-close").click();
    await gu.waitForServer();

    await gu.getCell("Pics", 3).click();
    await driver.sendKeys(Key.ENTER);
    await gu.fileDialogUpload("uploads/gplaypattern.png", () => driver.find(".test-pw-add").click());
    await driver.findContentWait(".test-pw-counter", /of 1/, 3000);
    await driver.find(".test-modal-dialog .test-pw-close").click();
    await gu.waitForServer();

    // Share the document with everyone as an editor.
    await api.updateDocPermissions(doc.id, { users: { "everyone@getgrist.com": "editors" } });

    // Other users can access document.
    const otherSession = await gu.session().teamSite.user("user3").login();
    await otherSession.loadDoc(`/doc/${doc.id}`);
    await gu.getPageItem(/Data1/).click();
    await gu.waitForServer();

    // Should see two of the three lines.
    assert.deepEqual(await gu.getVisibleGridCells("A", [1, 2, 3]),
      ["near", "in a motor car", ""]);

    // Check that the visible attachments are in fact showing correctly.
    await gu.getCell("Pics", 2).click();
    const attachments = await readAttachments();
    const url = attachments[0].src!;
    const extras = "rowId=3&colId=Pics&tableId=Data1&attId=4&";
    assert.include(url, extras);
    assert.include(attachments[0].title, "gplaypattern.png");

    // check denial for perturbations
    await checkAttachment(url.replace("tableId=Data1", "tableId=Table1"), 404);
    await checkAttachment(url.replace("colId=Pics", "colId=A"), 404);
    await checkAttachment(url.replace("attId=4", "attId=1"), 404);
    await checkAttachment(url.replace("rowId=3", "rowId=2"), 404);

    // check success for real deal
    await checkAttachment(url, "uploads/gplaypattern.png");
    await checkAttachment(url.replace(extras, "attId=4&"), "uploads/gplaypattern.png");

    // check editor url looks sane too
    await driver.sendKeys(Key.ENTER);
    const editorUrl = await driver.findWait(".test-pw-download", 5000).getAttribute("href");
    await checkAttachment(editorUrl, "uploads/gplaypattern.png");
    await driver.sendKeys(Key.ESCAPE);
  });

  describe("shares", function() {
    // A very minimal test of web client support, in place just
    // to force avoidance of approaches where it would be hard to add
    // later, and as a convenience for testing form-sharing without forms.
    it("can use with a web client", async function() {
      // Make a doc with a single share.
      const mainSession = await gu.session().teamSite.addLogin();
      const api = mainSession.createHomeApi();
      const doc = await mainSession.tempDoc(cleanup, "Hello.grist");
      await api.applyUserActions(doc.id, [
        ["AddRecord", "_grist_Shares", null, {
          linkId: "shares-web-client",
          options: '{"publish": true}',
        }],
        ["AddTable", "Table2", [{ id: "A" }]],
      ]);

      // Share a section.
      await api.applyUserActions(doc.id, [
        ["UpdateRecord", "_grist_Views_section", 1,
          { shareOptions: '{"publish": true, "form": true}' }],
        ["UpdateRecord", "_grist_Pages", 1, { shareRef: 1 }],
      ]);

      // Construct URL and load share.
      const db = await server.getDatabase();
      const shares = await db.connection.query("select * from shares where link_id = 'shares-web-client'");
      const key = shares[0].key;
      await mainSession.loadDoc(`/s/${key}`);

      // Check we see single expected page.
      assert.deepEqual(await gu.getPageNames(), ["Table1"]);

      // Share another page, check that it shows up.
      await api.applyUserActions(doc.id, [
        ["UpdateRecord", "_grist_Views_section", 4,
          { shareOptions: '{"publish": true, "form": true}' }],
        ["UpdateRecord", "_grist_Pages", 2, { shareRef: 1 }],
      ]);
      await gu.waitToPass(async () => {
        assert.deepEqual(await gu.getPageNames(), ["Table1", "Table2"]);
      });

      // Unshare page, check that it goes away.
      await api.applyUserActions(doc.id, [
        ["UpdateRecord", "_grist_Views_section", 4,
          { shareOptions: '{"publish": false, "form": true}' }],
      ]);
      await gu.waitToPass(async () => {
        assert.deepEqual(await gu.getPageNames(), ["Table1"]);
      });
    });
  });
});

// Add a record at end of table, and select the specified column. Return the
// row number.
async function addRecord(col: string): Promise<number> {
  const newRowNum = await gu.getGridRowCount();
  if (newRowNum !== 1) {
    await gu.getCell({ col, rowNum: newRowNum - 1 }).click();
  }
  await gu.sendKeys(Key.chord(await gu.modKey(), Key.ENTER));
  await gu.waitForServer();
  await gu.getCell({ col, rowNum: newRowNum }).click();
  return newRowNum;
}

// Check that an attachment url loads as expected, or gives expected error.
async function checkAttachment(url: string, fname: string | number) {
  const resp = await axios.get(url, {
    responseType: "arraybuffer",
    validateStatus: () => true,
  });
  if (typeof fname === "string") {
    const refData = await fse.readFile("test/fixtures/" + fname);
    assert.deepEqual(resp.status, 200);
    assert.deepEqual(resp.data, refData);
  } else {
    assert.deepEqual(resp.status, fname);
  }
}

// Get a list of attachments in a cell - their titles, and (when possible)
// a url to download them. The url is available for images only.
async function readAttachments() {
  const result: { title: string, src?: string }[] = [];
  const cell = await gu.getActiveCell();
  const thumbnails = await cell.findAll(".test-pw-thumbnail");
  for (const thumbnail of thumbnails) {
    const title = await thumbnail.getAttribute("title");
    const img = await thumbnail.find("img");
    if (await img.isPresent()) {
      const src = await img.getAttribute("src");
      result.push({ title, src });
    } else {
      result.push({ title });
    }
  }
  return result;
}

async function getCsvHref(sectionTitle: string) {
  await gu.openSectionMenu("viewLayout", "JOBS");
  const href = await driver.findContentWait(".test-download-section", /Download as CSV/, 1000)
    .getAttribute("href");
  await driver.sendKeys(Key.ESCAPE);
  return href;
}
