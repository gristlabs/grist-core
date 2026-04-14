import { getReferencedTableId } from "app/common/gristTypes";
import { UserAPI } from "app/common/UserAPI";
import { GristObjCode } from "app/plugin/GristData";
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

describe("ProposedChangesPage", function() {
  this.timeout(60000);
  const cleanup = setupTestSuite();

  // Currently this page exists only on a document where accepting
  // proposals is turned on.
  it("can be enabled for a document", async function() {
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, "Hello.grist");
    await driver.find(".test-tools-settings").click();

    // Check the accepting proposals checkbox is visible.
    assert.match(
      await driver.findWait("#admin-panel-item-description-acceptProposals", 2000).getText(),
      /Allow others to suggest changes/);
    // But it shouldn't be checked yet.
    assert.equal(
      await driver.find("input.test-settings-accept-proposals").getAttribute("checked"),
      null,
    );
    // Now check it.
    await driver.find("input.test-settings-accept-proposals").click();
    // A new page should appear in the toolbox.
    await driver.findWait(".test-tools-proposals", 2000);
    // The flag should be checked now.
    assert.equal(
      await driver.find("input.test-settings-accept-proposals").getAttribute("checked"),
      "true",
    );
  });

  it("can make and apply a simple proposed change", async function() {
    // Load a test document.
    const session = await gu.session().teamSite.login();
    const doc = await session.tempDoc(cleanup, "Hello.grist");

    // Turn on feature.
    const api = session.createHomeApi();
    await api.updateDoc(doc.id, {
      options: {
        proposedChanges: {
          acceptProposals: true,
        },
      },
    });

    // Put something known in the first cell.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("test1");

    // Work on a copy.
    await driver.find(".test-tb-share").click();
    await driver.findWait(".test-work-on-copy", 2000).click();
    await gu.waitForServer();
    await gu.waitForDocToLoad();

    // Change the content of the first cell.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("test2");

    // Go to the propose-changes page.
    await assertProposalsCount(1);
    await driver.find(".test-tools-proposals").click();

    // Make sure the expected change is shown.
    await driver.findContentWait(".test-main-content", /Suggest changes/, 2000);
    await driver.findWait(".test-actionlog-tabular-diffs .field_clip", 2000);
    assert.deepEqual(await getColumns("TABLE1"), ["A", "E"]);
    assert.deepEqual(await getRowValues("TABLE1", 0), ["test1test2", "TEST1TEST2"]);
    assert.deepEqual(await getChangeType("TABLE1", 0), "→");

    // Check that expanding context works (at least, that it does something).
    await expand("TABLE1");
    await driver.findWait(".test-actionlog-tabular-diffs .field_clip", 2000);
    assert.deepEqual(await getColumns("TABLE1"), ["id", "A", "B", "C", "D", "E"]);
    assert.deepEqual(await getRowValues("TABLE1", 0), ["1", "test1test2", "", "", "", "TEST1TEST2"]);
    assert.deepEqual(await getChangeType("TABLE1", 0), "→");

    await collapse("TABLE1");
    await driver.findWait(".test-actionlog-tabular-diffs .field_clip", 2000);
    assert.deepEqual(await getColumns("TABLE1"), ["A", "E"]);
    assert.deepEqual(await getRowValues("TABLE1", 0), ["test1test2", "TEST1TEST2"]);
    assert.deepEqual(await getChangeType("TABLE1", 0), "→");

    // Check a "Suggest" button is present, and click it.
    assert.match(await driver.find(".test-proposals-propose").getText(), /Suggest/);
    await driver.find(".test-proposals-propose").click();

    // Once proposed, there should be a status line, and the "Suggest"
    // button should be absent.
    await driver.findContentWait(".test-proposals-status", /Suggestion/, 2000);
    assert.equal(await driver.find(".test-proposals-propose").isPresent(), false);

    // Try retracting the proposal. The status should become "retracted"
    // and the proposal button should be back to its original state.
    await driver.findWait(".test-proposals-retract", 2000).click();
    await driver.findContentWait(".test-proposals-status", /Retracted/, 2000);
    assert.match(await driver.find(".test-proposals-propose").getText(), /Suggest/);
    await driver.find(".test-proposals-propose").click();
    await driver.findContentWait(".test-proposals-status", /Suggest/, 2000);

    // Click on the "original document" to see how things are there now.
    await driver.findContentWait("span", /original document/, 2000).click();

    // The wording on the changes page is slightly different now (Proposed
    // Changes versus Propose Changes)
    assert.match(
      await driver.findContentWait(".test-proposals-header", /#1/, 2000).getText(),
      /Suggestion/,
    );

    // There should be exactly one proposal.
    assert.lengthOf(await driver.findAll(".test-proposals-header"), 1);

    // The proposal should basically be to change something to "test2".
    // Click on that part.
    await gu.dbClick(driver.findContent(".diff-remote", /test2/));

    // It should bring us to a cell that is currently at "test1".
    await driver.findContentWait(".test-widget-title-text", /TABLE1/, 2000);
    assert.equal(await gu.getCell({ rowNum: 1, col: 0 }).getText(), "test1");

    // Go back to the changes page, and click "Accept".
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggestions");
    await driver.find(".test-tools-proposals").click();
    await driver.findWait(".test-proposals-apply", 2000).click();
    await gu.waitForServer();

    // Now go back and see the cell is now filled with "test2".
    await gu.dbClick(driver.findContent(".diff-remote", /test2/));
    await driver.findContentWait(".test-widget-title-text", /TABLE1/, 2000);
    assert.equal(await gu.getCell({ rowNum: 1, col: 0 }).getText(), "test2");
  });

  it("can make and apply multiple proposed changes", async function() {
    const { doc, api } = await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Make a change.
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Bird");

    await proposeChange();

    // Work on another copy and propose a different change.
    await workOnCopy(url);
    await gu.getCell("B", 2).click();
    await gu.waitAppFocus();
    await gu.enterCell("Mammal");
    await proposeChange();

    // Work on another copy and propose a different change.
    await workOnCopy(url);
    await gu.getCell("B", 3).click();
    await gu.waitAppFocus();
    await gu.enterCell("SpaceDuck");
    await proposeChange();

    // Click on the "original document" to see how things are there now.
    await driver.findContentWait("span", /original document/, 2000).click();

    // There should be exactly three proposals, newest first.
    await driver.findWait(".test-proposals-header", 2000);
    assert.lengthOf(await driver.findAll(".test-proposals-header"), 3);
    await driver.findWait(".diff-remote", 2000);
    assert.deepEqual(
      await driver.findAll(".diff-remote", e => e.getText()),
      ["SpaceDuck", "Mammal", "Bird"],
    );

    // Apply the second one and check that it has an effect.
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("Life")).B,
      ["Fish", "Primate"]);
    await driver.find(".test-proposals-patch:nth-child(2)")
      .find(".test-proposals-apply").click();
    await gu.waitForServer();
    assert.match(
      await driver.findContent(".test-proposals-header", /#2/).getText(),
      /Accepted/,
    );
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("Life")).B,
      ["Fish", "Mammal"]);

    // Now the third one.
    await driver.find(".test-proposals-patch:nth-child(3)")
      .find(".test-proposals-apply").click();
    await gu.waitForServer();
    assert.match(
      await driver.findContent(".test-proposals-header", /#1/).getText(),
      /Accepted/,
    );
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("Life")).B,
      ["Bird", "Mammal"]);

    // Now the first one.
    await driver.find(".test-proposals-patch:nth-child(1)")
      .find(".test-proposals-apply").click();
    await gu.waitForServer();
    assert.match(
      await driver.findContent(".test-proposals-header", /#3/).getText(),
      /Accepted/,
    );
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("Life")).B,
      ["Bird", "Mammal", "SpaceDuck"]);
  });

  it("can apply a proposed change after a trunk change", async function() {
    const { api, doc } = await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Make a change.
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Bird");

    await proposeChange();

    // Click on the "original document".
    await driver.findContentWait("span", /original document/, 2000).click();

    // There should be exactly one proposal.
    await driver.findWait(".test-proposals-header", 2000);
    assert.lengthOf(await driver.findAll(".test-proposals-header"), 1);

    // Make sure the expected change is shown.
    await driver.findWait(".test-actionlog-tabular-diffs .field_clip", 2000);
    assert.deepEqual(await getColumns("LIFE"), ["B"]);
    assert.deepEqual(await getRowValues("LIFE", 0), ["FishBird"]);
    assert.deepEqual(await getChangeType("LIFE", 0), "→");

    // Change column and table name.
    await api.applyUserActions(doc.id, [
      ["RenameColumn", "Life", "B", "BB"],
    ]);
    await api.applyUserActions(doc.id, [
      ["RenameTable", "Life", "Vie"],
    ]);
    await driver.sleep(500);
    // Check that expanding context works (at least, that it does something).
    await expand("LIFE");
    await driver.findWait(".test-actionlog-tabular-diffs .field_clip", 2000);
    assert.deepEqual(await getColumns("VIE"), ["id", "A", "BB"]);
    assert.deepEqual(await getRowValues("VIE", 0), ["1", "10", "FishBird"]);
    assert.deepEqual(await getChangeType("VIE", 0), "→");

    // Apply and check that it has an effect.
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("Vie")).BB,
      ["Fish", "Primate"]);
    await driver.find(".test-proposals-patch")
      .find(".test-proposals-apply").click();
    await gu.waitForServer();
    assert.match(
      await driver.findContent(".test-proposals-header", /#1/).getText(),
      /Accepted/,
    );
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("Vie")).BB,
      ["Bird", "Primate"]);
  });

  it("can show a count of changes to add to suggestion", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);
    const forkUrl = await driver.getCurrentUrl();

    // Make a change.
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Bird");

    await assertProposalsCount(1);

    // Make another change.
    await gu.getCell("A", 2).click();
    await gu.waitAppFocus();
    await gu.enterCell("15");

    await assertProposalsCount(2);

    await gu.undo();
    await assertProposalsCount(1);

    await gu.redo();
    await assertProposalsCount(2);

    await gu.refreshDismiss({ ignore: true });
    await assertProposalsCount(2);

    assert.notInclude(await driver.find(".test-undo").getAttribute("class"), "-disable");

    await proposeChange();
    await assertProposalsCount(0);

    assert.include(await driver.find(".test-undo").getAttribute("class"), "-disable");

    await gu.openPage("Life");
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("13");
    await assertProposalsCount(1);
    assert.notInclude(await driver.find(".test-undo").getAttribute("class"), "-disable");
    await proposeChange();
    await assertProposalsCount(0);
    assert.include(await driver.find(".test-undo").getAttribute("class"), "-disable");

    await driver.findContentWait("span", /original document/, 2000).click();
    await driver.findWait(".test-proposals-header", 2000);
    await gu.openPage("Life");
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("1");

    await driver.get(forkUrl);
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("99");
    await assertProposalsCount(1);
    await proposeChange();
    await assertProposalsCount(0);
    await gu.openPage("Life");
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("999");
    await assertProposalsCount(1);
    await proposeChange();
    await assertProposalsCount(0);

    await returnToTrunk(url);
  });

  it("shows correct action count when viewer auto-forks by typing", async function() {
    const { api } = await makeLifeDoc();

    // Duplicate the document via the "Save Copy" button, so that
    // it has a non-trivial baseAction.
    await driver.find(".test-tb-share").click();
    await driver.findWait(".test-save-copy", 2000).click();
    await gu.completeCopy({ destName: "LifeCopy" });

    // Get the copy's doc ID.
    const copyId = (await gu.getCurrentUrlId())!;

    // Add some extra actions to create action history. This is
    // important because the bug is clearest when the document has
    // significant history that would be miscounted if baseAction
    // isn't updated after forking.
    for (let i = 0; i < 5; i++) {
      await api.applyUserActions(copyId, [
        ["AddRecord", "Life", null, { A: 100 + i, B: "Spam" }],
      ]);
    }

    // Turn on feature.
    await api.updateDoc(copyId, {
      options: {
        proposedChanges: {
          acceptProposals: true,
        },
      },
    });

    // Share the copy with user3 as viewer.
    const user3Email = gu.session().user("user3").email;
    await api.updateDocPermissions(copyId, { users: { [user3Email]: "viewers" } });

    // Login as user3 (a viewer) and load the copy.
    const user3Session = await gu.session().teamSite.user("user3").login();
    await user3Session.loadDoc(`/doc/${copyId}`);
    await gu.openPage("Life");

    // Dismiss any popups.
    await gu.dismissBehavioralPrompts();

    // Type into a cell. Since user3 is a viewer and proposals are
    // enabled, this triggers an auto-fork.
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Bird");
    await gu.waitForServer();

    // Wait for the fork to be created (URL changes to include ~).
    await driver.wait(async () => (await driver.getCurrentUrl()).includes("~"), 5000);

    // The action count should show exactly 1 change. Without the fix,
    // the count would be wrong because baseAction from the copy (not
    // the fork) would be used.
    await assertProposalsCount(1);

    // Make a second change and verify count updates.
    await gu.getCell("A", 2).click();
    await gu.waitAppFocus();
    await gu.enterCell("99");

    await assertProposalsCount(2);

    // Undo and verify count goes back down.
    await gu.undo();
    await assertProposalsCount(1);
  });

  it("shows all rows in suggestion mode, not skip rows with ellipses", async function() {
    const { doc, api } = await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    // Add enough rows so that a "compare to original" view would
    // start skipping some.
    for (let i = 0; i <= 10; i++) {
      await api.applyUserActions(doc.id, [
        ["AddRecord", "Life", null, { A: i * 10, B: `Species${i}` }],
      ]);
    }

    // Count the rows via the API before entering suggestion mode.
    const rows = await api.getDocAPI(doc.id).getRows("Life");
    const expectedRowCount = rows.id.length;
    assert.isAtLeast(expectedRowCount, 10);

    // Work on a copy (enters suggestion mode with comparison active).
    await workOnCopy(url);

    // Every row should be visible, no "..." skip rows, no blank rows.
    const rowNums = Array.from({ length: expectedRowCount }, (_, i) => i + 1);
    const visibleB = await gu.getVisibleGridCells("B", rowNums);
    assert.notInclude(visibleB, "...");
    assert.deepEqual(visibleB, rows.B);

    await returnToTrunk(url);
  });

  it("can make and apply a proposed change affecting two tables", async function() {
    const { api, doc } = await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    // Add a second table.
    // Create and delete a table around it for that "aged document" feel
    // (there was a bug where an offset in table row ids caused a problem).
    await gu.sendActions([
      ["AddTable", "OldPlants", [{ id: "Name", type: "Text" }, { id: "Type", type: "Text" }]],
      ["AddTable", "Plants", [{ id: "Name", type: "Text" }, { id: "Type", type: "Text" }]],
      ["RemoveTable", "OldPlants"],
      ["AddRecord", "Plants", 1, { Name: "Oak", Type: "Tree" }],
      ["AddRecord", "Plants", 2, { Name: "Rose", Type: "Flower" }],
    ]);

    await workOnCopy(url);

    // Make a change to the Life table.
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Bird");

    // Make a change to the Plants table.
    await gu.openPage("Plants");
    await gu.getCell("Type", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Deciduous Tree");

    await assertProposalsCount(2);

    await proposeChange();

    // Click on the "original document" to see the proposal.
    await driver.findContentWait("span", /original document/, 2000).click();

    // There should be exactly one proposal with changes to both tables.
    await driver.findWait(".test-proposals-header", 2000);
    assert.lengthOf(await driver.findAll(".test-proposals-header"), 1);

    // Verify changes are shown for both tables
    await driver.findWait(".test-actionlog-tabular-diffs .field_clip", 2000);

    // Check Life table changes
    assert.deepEqual(await getColumns("LIFE"), ["B"]);
    assert.deepEqual(await getRowValues("LIFE", 0), ["FishBird"]);
    assert.deepEqual(await getChangeType("LIFE", 0), "→");

    // Check Plants table changes
    assert.deepEqual(await getColumns("PLANTS"), ["Type"]);
    assert.deepEqual(await getRowValues("PLANTS", 0), ["Deciduous Tree"]);
    assert.deepEqual(await getChangeType("PLANTS", 0), "→");

    // Apply the proposal
    await driver.find(".test-proposals-apply").click();
    await gu.waitForServer();

    // Verify both changes were applied
    assert.match(
      await driver.findContent(".test-proposals-header", /#1/).getText(),
      /Accepted/,
    );
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("Life")).B,
      ["Bird", "Primate"]);
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("Plants")).Type,
      ["Deciduous Tree", "Flower"]);
  });

  it("can make and apply a proposed change to a Reference column", async function() {
    const { api, doc } = await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    // Add a table to refer to
    await api.applyUserActions(doc.id, [
      ["AddTable", "Habitat", [{ id: "Name", type: "Text" }]],
      ["AddRecord", "Habitat", 1, { Name: "Ocean" }],
      ["AddRecord", "Habitat", 2, { Name: "Forest" }],
      ["AddRecord", "Habitat", 3, { Name: "Desert" }],
    ]);

    // Add a Reference column to Life table
    await api.applyUserActions(doc.id, [
      ["AddVisibleColumn", "Life", "Habitat", { type: "Ref:Habitat" }],
      ["UpdateRecord", "Life", 1, { Habitat: 1 }], // Fish -> Ocean
      ["UpdateRecord", "Life", 2, { Habitat: 2 }], // Primate -> Forest
    ]);

    // Show what we want
    await setReferenceDisplayColumn(api, doc.id, "Life", "Habitat", "Name");

    await workOnCopy(url);

    // There's occasionally some race condition, maybe references not
    // loading fast enough?, if we don't look at them in client. So we
    // just briefly visit the Habitat page.
    await gu.openPage("Habitat");
    await gu.openPage("Life");

    // Change the reference for Fish from Ocean to Desert
    await gu.getCell("Habitat", 1).click();

    await gu.waitAppFocus();
    await gu.enterCell("Desert");

    await assertProposalsCount(1);

    await proposeChange();

    // Click on the "original document" to see the proposal.
    await driver.findContentWait("span", /original document/, 2000).click();

    // There should be exactly one proposal.
    await driver.findWait(".test-proposals-header", 2000);
    assert.lengthOf(await driver.findAll(".test-proposals-header"), 1);

    // Verify the reference change is shown
    await driver.findWait(".test-actionlog-tabular-diffs .field_clip", 2000);
    assert.deepEqual(await getColumns("LIFE"), ["Habitat"]);
    assert.deepEqual(await getRowValues("LIFE", 0), ["OceanDesert"]);
    assert.deepEqual(await getChangeType("LIFE", 0), "→");

    // Apply the proposal
    await driver.find(".test-proposals-apply").click();
    await gu.waitForServer();

    // Verify the change was applied (reference should now point to Desert, which has id 3)
    assert.match(
      await driver.findContent(".test-proposals-header", /#1/).getText(),
      /Accepted/,
    );
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("Life")).Habitat,
      [3, 2]); // Desert (id 3), Forest (id 2)

    await returnToTrunk(url);
  });

  it("can make and apply a proposed change to a Reference List column", async function() {
    const { api, doc } = await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await api.applyUserActions(doc.id, [
      ["AddTable", "Habitat", [{ id: "Name", type: "Text" }]],
      ["AddRecord", "Habitat", 1, { Name: "Ocean" }],
      ["AddRecord", "Habitat", 2, { Name: "Forest" }],
      ["AddRecord", "Habitat", 3, { Name: "Desert" }],
      ["AddRecord", "Habitat", 4, { Name: "Arctic" }],
    ]);

    // Add a Reference List column to Life table
    await api.applyUserActions(doc.id, [
      ["AddVisibleColumn", "Life", "Habitats", { type: "RefList:Habitat" }],
      ["UpdateRecord", "Life", 1, { Habitats: ["L", 1, 2] }], // Fish -> Ocean, Forest
      ["UpdateRecord", "Life", 2, { Habitats: ["L", 2] }], // Primate -> Forest
    ]);

    // Show what we want
    await setReferenceDisplayColumn(api, doc.id, "Life", "Habitats", "Name");

    await workOnCopy(url);

    await gu.openPage("Habitat");
    await gu.openPage("Life");

    // Change the reference list for Fish: remove Forest, add Desert and Arctic
    await gu.getCell("Habitats", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Ocean", Key.ENTER, "Desert", Key.ENTER, "Arctic", Key.ENTER, Key.ENTER);
    await gu.waitForServer();

    await assertProposalsCount(1);

    await proposeChange();

    // Click on the "original document" to see the proposal.
    await driver.findContentWait("span", /original document/, 2000).click();

    // There should be exactly one proposal.
    await driver.findWait(".test-proposals-header", 2000);
    assert.lengthOf(await driver.findAll(".test-proposals-header"), 1);

    // Verify the reference list change is shown
    await driver.findWait(".test-actionlog-tabular-diffs .field_clip", 2000);
    assert.deepEqual(await getColumns("LIFE"), ["Habitats"]);
    assert.deepEqual(await getRowValues("LIFE", 0), ["Ocean, ForestDesert, Arctic"]);
    assert.deepEqual(await getChangeType("LIFE", 0), "→");

    // Apply the proposal
    await driver.find(".test-proposals-apply").click();
    await gu.waitForServer();

    // Verify the change was applied (reference list should now be [Ocean, Desert, Arctic] = [1, 3, 4])
    assert.match(
      await driver.findContent(".test-proposals-header", /#1/).getText(),
      /Accepted/,
    );
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("Life")).Habitats,
      [["L" as GristObjCode, 1, 3, 4], ["L" as GristObjCode, 2]]); // [Ocean, Desert, Arctic], [Forest]

    await returnToTrunk(url);
  });

  it("can make and apply a proposed change that creates a new Reference", async function() {
    const { api, doc } = await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    // Add a table to refer to
    await api.applyUserActions(doc.id, [
      ["AddTable", "Habitat", [{ id: "Name", type: "Text" }]],
      ["AddRecord", "Habitat", 1, { Name: "Ocean" }],
      ["AddRecord", "Habitat", 2, { Name: "Forest" }],
    ]);

    // Add a Reference column to Life table
    await api.applyUserActions(doc.id, [
      ["AddVisibleColumn", "Life", "Habitat", { type: "Ref:Habitat" }],
      ["UpdateRecord", "Life", 1, { Habitat: 1 }], // Fish -> Ocean
      ["UpdateRecord", "Life", 2, { Habitat: 2 }], // Primate -> Forest
    ]);

    // Show what we want
    await setReferenceDisplayColumn(api, doc.id, "Life", "Habitat", "Name");

    await workOnCopy(url);

    await gu.openPage("Habitat");
    await gu.openPage("Life");

    // Create a new reference by typing a new value and clicking "add new"
    await gu.getCell("Habitat", 1).click();
    await gu.waitAppFocus();
    await driver.sendKeys("Mountain");

    // Click the "add new" item. The new value should be saved.
    await driver.find(".test-ref-editor-new-item").click();
    await gu.waitForServer();

    await assertProposalsCount(2);

    await proposeChange();

    // Click on the "original document" to see the proposal.
    await driver.findContentWait("span", /original document/, 2000).click();

    // There should be exactly one proposal.
    await driver.findWait(".test-proposals-header", 2000);
    assert.lengthOf(await driver.findAll(".test-proposals-header"), 1);

    // Verify the reference change is shown (Ocean -> Mountain)
    await driver.findWait(".test-actionlog-tabular-diffs .field_clip", 2000);
    assert.deepEqual(await getColumns("LIFE"), ["Habitat"]);
    assert.deepEqual(await getRowValues("LIFE", 0), ["OceanMountain"]);
    assert.deepEqual(await getChangeType("LIFE", 0), "→");

    // Apply the proposal
    await driver.find(".test-proposals-apply").click();
    await gu.waitForServer();

    // Verify the change was applied
    assert.match(
      await driver.findContent(".test-proposals-header", /#1/).getText(),
      /Accepted/,
    );

    // The new reference should have been created in the Habitat table
    const habitats = await api.getDocAPI(doc.id).getRows("Habitat");
    assert.deepEqual(habitats.Name, ["Ocean", "Forest", "Mountain"]);

    // Fish should now reference Mountain (id 3)
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("Life")).Habitat,
      [3, 2]); // Mountain (id 3), Forest (id 2)

    await returnToTrunk(url);
  });

  it("can make and apply a proposed change that creates new Reference List items", async function() {
    const { api, doc } = await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await api.applyUserActions(doc.id, [
      ["AddTable", "Habitat", [{ id: "Name", type: "Text" }]],
      ["AddRecord", "Habitat", 1, { Name: "Ocean" }],
      ["AddRecord", "Habitat", 2, { Name: "Forest" }],
    ]);

    // Add a Reference List column to Life table
    await api.applyUserActions(doc.id, [
      ["AddVisibleColumn", "Life", "Habitats", { type: "RefList:Habitat" }],
      ["UpdateRecord", "Life", 1, { Habitats: ["L", 1] }], // Fish -> Ocean
      ["UpdateRecord", "Life", 2, { Habitats: ["L", 2] }], // Primate -> Forest
    ]);

    // Show what we want
    await setReferenceDisplayColumn(api, doc.id, "Life", "Habitats", "Name");

    await workOnCopy(url);

    await gu.openPage("Habitat");
    await gu.openPage("Life");

    // Add new references to the list by typing new values
    await gu.getCell("Habitats", 1).click();
    await gu.waitAppFocus();

    // Add existing reference
    await gu.enterCell("Ocean");

    // Add a new reference by typing and clicking "add new"
    await driver.sendKeys("Desert");
    await driver.find(".test-ref-editor-new-item").click();
    await gu.waitForServer();

    // Add another new reference
    await driver.sendKeys("Tundra");
    await driver.find(".test-ref-editor-new-item").click();
    await gu.waitForServer();

    // Close the editor
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();

    await assertProposalsCount(2);

    await proposeChange();

    // Click on the "original document" to see the proposal.
    await driver.findContentWait("span", /original document/, 2000).click();

    // There should be exactly one proposal.
    await driver.findWait(".test-proposals-header", 2000);
    assert.lengthOf(await driver.findAll(".test-proposals-header"), 1);

    // Verify the reference list change is shown
    await driver.findWait(".test-actionlog-tabular-diffs .field_clip", 2000);
    assert.deepEqual(await getColumns("LIFE"), ["Habitats"]);
    assert.deepEqual(await getRowValues("LIFE", 0), ["Ocean, Desert, Tundra"]);
    assert.deepEqual(await getChangeType("LIFE", 0), "→");

    // Apply the proposal
    await driver.find(".test-proposals-apply").click();
    await gu.waitForServer();

    // Verify the change was applied
    assert.match(
      await driver.findContent(".test-proposals-header", /#1/).getText(),
      /Accepted/,
    );

    // The new references should have been created in the Habitat table
    const habitats = await api.getDocAPI(doc.id).getRows("Habitat");
    assert.deepEqual(habitats.Name, ["Ocean", "Forest", "Desert", "Tundra"]);

    // Fish should now reference Ocean, Desert, and Tundra
    assert.deepEqual((await api.getDocAPI(doc.id).getRows("Life")).Habitats,
      [["L" as GristObjCode, 1, 3, 4], ["L" as GristObjCode, 2]]); // [Ocean, Desert, Tundra], [Forest]

    await returnToTrunk(url);
  });

  it("can make changes on a doc with conditional formatting", async function() {
    const { doc, api } = await makeLifeDoc();
    // const url = await driver.getCurrentUrl();
    await addConditionalFormatting(api, doc.id, "Life", "B", "'s' in $B", {
      fillColor: "#f00",
    });
    await gu.waitForServer();

    // Check if the cell has the expected content background color
    let cell = await gu.getCell("B", 1);
    assert.equal(await cell.getText(), "Fish");
    assert.equal(await cell.getCssValue("background-color"), "rgba(255, 0, 0, 1)");

    // Work on a copy.
    await driver.find(".test-tb-share").click();
    await driver.findWait(".test-work-on-copy", 2000).click();
    await gu.waitForServer();
    await gu.waitForDocToLoad();

    // Change the content of the first cell.
    await gu.openPage("Life");
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Fizh");

    // Go to the propose-changes page.
    await driver.find(".test-tools-proposals").click();

    // Make sure the expected change is shown.
    await driver.findContentWait(".test-main-content", /Suggest changes/, 2000);
    await driver.findWait(".test-actionlog-tabular-diffs .field_clip", 2000);
    assert.deepEqual(await getColumns("LIFE"), ["B"]);
    assert.deepEqual(await getRowValues("LIFE", 0), ["FishFizh"]);
    assert.deepEqual(await getChangeType("LIFE", 0), "→");

    await driver.find(".test-proposals-propose").click();
    // Click on the "original document" to see how things are there now.
    await driver.findContentWait(".test-proposals-status", /Suggestion/, 2000);
    await driver.findContentWait("span", /original document/, 2000).click();

    await driver.findWait(".test-proposals-apply", 2000).click();
    await gu.waitForServer();

    await gu.dbClick(driver.findContent(".diff-remote", /Fizh/));
    await driver.findContentWait(".test-widget-title-text", /LIFE/, 2000);
    cell = await gu.getCell("B", 1);
    assert.equal(await cell.getText(), "Fizh");
    assert.notEqual(await cell.getCssValue("background-color"), "rgba(255, 0, 0, 1)");
  });

  it("highlights edited cells in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Verify comparison is active with details.
    const comparison = await gu.getComparison();
    assert.isNotNull(comparison);
    assert.property(comparison!, "details");

    // Verify the diff-emphasize-local class is present on the content pane.
    const hasEmphasis = await driver.executeScript<boolean>(
      () => !!document.querySelector(".diff-emphasize-local"),
    );
    assert.isTrue(hasEmphasis);

    // Edit cell B row 1 from "Fish" to "Cat".
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Cat");

    // Verify the cell shows diff highlighting.
    let cell = await gu.getCell("B", 1);
    assert.equal(await cell.find(".diff-parent").getText(), "Fish");
    assert.equal(await cell.find(".diff-local").getText(), "Cat");

    // Undo and verify highlighting is gone.
    await gu.undo();
    cell = await gu.getCell("B", 1);
    assert.equal(await cell.find(".diff-parent").isPresent(), false);
    assert.equal(await cell.find(".diff-local").isPresent(), false);

    // Redo and verify highlighting returns.
    await gu.redo();
    cell = await gu.getCell("B", 1);
    assert.equal(await cell.find(".diff-parent").getText(), "Fish");
    assert.equal(await cell.find(".diff-local").getText(), "Cat");

    await returnToTrunk(url);
  });

  it("uses correct diff classes on fork suggestions tab", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Edit cell B row 1 from "Fish" to "Cat".
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Cat");

    // Go to the fork's suggestions tab.
    await driver.find(".test-tools-proposals").click();
    await driver.findContentWait(".test-main-content", /Suggest changes/, 2000);
    const clip = await driver.findWait(".test-actionlog-tabular-diffs .field_clip", 2000);

    // On the fork's suggestions tab, the fork's new value should use
    // diff-local (not diff-remote), so that diff-emphasize-local renders
    // it with the correct (green) color.
    assert.equal(await clip.find(".diff-local").getText(), "Cat");
    assert.equal(await clip.find(".diff-parent").getText(), "Fish");
    assert.equal(await clip.find(".diff-remote").isPresent(), false);

    await returnToTrunk(url);
  });

  it("highlights cells after reload in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Edit cell B row 1.
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Cat");

    // Verify highlighting before reload.
    let cell = await gu.getCell("B", 1);
    assert.equal(await cell.find(".diff-local").getText(), "Cat");

    // Reload the page.
    await gu.refreshDismiss({ ignore: true });

    // Verify the previously edited cell still shows diff highlighting.
    cell = await gu.getCell("B", 1);
    assert.equal(await cell.find(".diff-parent").getText(), "Fish");
    assert.equal(await cell.find(".diff-local").getText(), "Cat");

    await returnToTrunk(url);
  });

  it("highlights added rows in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Navigate to the last row and add a new record.
    await gu.getCell("B", 3).click();
    await gu.waitAppFocus();
    await gu.enterCell("Whale");

    // Verify the new row has diff-local-add class.
    const cell = await gu.getCell("B", 3);
    const record = await cell.findClosest(".record");
    assert.include(await record.getAttribute("class"), "diff-local-add");

    // Verify the cell has diff-local content.
    assert.equal(await cell.find(".diff-local").getText(), "Whale");

    await returnToTrunk(url);
  });

  it("highlights deleted rows in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Delete the first row.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Verify the deleted row appears with diff-local-remove styling.
    const removedRecord = await driver.findWait(".record.diff-local-remove", 2000);
    assert.isTrue(await removedRecord.isDisplayed());
    // Verify old cell value is present in the removed row.
    const cellText = await removedRecord.find(".field_clip").getText();
    assert.equal(cellText, "10");

    // Undo and verify the diff-local-remove row is gone.
    await gu.undo();
    const removedAfterUndo = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedAfterUndo, 0);
    // Verify the original row is restored.
    const cell = await gu.getCell("A", 1);
    assert.equal(await cell.getText(), "10");

    // Redo and verify diff-local-remove returns.
    await gu.redo();
    await driver.findWait(".record.diff-local-remove", 2000);
    const removedAfterRedo = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedAfterRedo, 1);

    await returnToTrunk(url);
  });

  it("shows deleted row after reload in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Delete the first row (A=10, B="Fish").
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Verify both columns show original values in the removed row.
    let removedRecord = await driver.findWait(".record.diff-local-remove", 5000);
    let cells = await removedRecord.findAll(".field_clip");
    assert.equal(await cells[0].getText(), "10");
    assert.equal(await cells[1].getText(), "Fish");

    // Reload the page.
    await gu.refreshDismiss({ ignore: true });

    // Verify the deleted row still shows after reload.
    removedRecord = await driver.findWait(".record.diff-local-remove", 5000);
    cells = await removedRecord.findAll(".field_clip");
    assert.equal(await cells[0].getText(), "10");
    assert.equal(await cells[1].getText(), "Fish");

    await returnToTrunk(url);
  });

  it("shows edits and deletions together in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Edit the second row.
    await gu.getCell("B", 2).click();
    await gu.waitAppFocus();
    await gu.enterCell("Ape");

    // Delete the first row.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Verify the deleted row shows with diff-local-remove.
    await driver.findWait(".record.diff-local-remove", 5000);
    const removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 1);

    // Verify the edited row still shows its diff highlighting.
    // After deleting row 1, the synthetic deleted row stays at position 1,
    // so the edited row (originally row 2) moves to position 2.
    const editedCell = await gu.getCell("B", 2);
    assert.equal(await editedCell.find(".diff-parent").getText(), "Primate");
    assert.equal(await editedCell.find(".diff-local").getText(), "Ape");

    await returnToTrunk(url);
  });

  it("cancels out add and delete of same row in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Add a new row by typing in the "new" row.
    await gu.getCell("B", 3).click();
    await gu.waitAppFocus();
    await gu.enterCell("Whale");

    // Verify the new row appears as diff-local-add.
    let addedRecords = await driver.findAll(".record.diff-local-add");
    assert.lengthOf(addedRecords, 1);

    // Now delete the row we just added.
    await gu.getCell("A", 3).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // The add and delete should cancel out — no diff rows at all.
    addedRecords = await driver.findAll(".record.diff-local-add");
    const removedRecords = await driver.findAll(".record.diff-local-remove");

    assert.lengthOf(addedRecords, 0);
    assert.lengthOf(removedRecords, 0);

    await returnToTrunk(url);
  });

  it("does not delete a deleted row again in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Delete the first row.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Verify the deleted row appears.
    await driver.findWait(".record.diff-local-remove", 2000);

    // Clear any pre-existing errors.
    const errorsBefore = await gu.getAppErrors();

    // Click on the deleted (synthetic) row and try to delete it again.
    const removedRecord = await driver.findWait(".record.diff-local-remove", 2000);
    await removedRecord.find(".field_clip").click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Verify no errors were produced.
    const errorsAfter = await gu.getAppErrors();
    const newErrors = errorsAfter.slice(errorsBefore.length);
    assert.deepEqual(newErrors, [], "deleting a deleted row should not produce errors");

    // The deleted row should still be there, unchanged — exactly one removed row.
    const removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 1);

    // Verify the grid has exactly the expected rows: 1 removed, 1 real, 1 "new".
    const allRecords = await driver.findAll(".gridview_row .record");
    assert.lengthOf(allRecords, 3);

    // The real row (A=20) is at position 2 (after the synthetic removed row).
    const cell = await gu.getCell("A", 2);
    assert.equal(await cell.getText(), "20");

    // Verify we can still edit the remaining real row without errors.
    await gu.getCell("B", 2).click();
    await gu.waitAppFocus();
    await gu.enterCell("Gorilla");
    const editedCell = await gu.getCell("B", 2);
    assert.equal(await editedCell.find(".diff-local").getText(), "Gorilla");

    await returnToTrunk(url);
  });

  it("does not allow editing a deleted row in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Delete the first row.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Verify the deleted row appears.
    await driver.findWait(".record.diff-local-remove", 2000);

    // Click on the deleted (synthetic) row and try to type into it.
    // The editor guard in activateEditorAtCursor blocks editing synthetic
    // (negative ID) rows, so this should be a no-op: no action sent, no error.
    const removedRecord = await driver.findWait(".record.diff-local-remove", 2000);
    await removedRecord.find(".field_clip").click();
    await gu.sendKeys("999", Key.ENTER);
    await gu.waitForServer();

    // No errors should have been produced.
    await gu.checkForErrors();

    // The deleted row should still show the original value, not "999".
    const removedAfter = await driver.findWait(".record.diff-local-remove", 2000);
    const cellText = await removedAfter.find(".field_clip").getText();
    assert.equal(cellText, "10");

    await returnToTrunk(url);
  });

  it("handles deleting last record and inserting new one in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Delete the first row.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // After deleting row 1, the grid shows: [synthetic-removed, real-row-2, new].
    // The real row 2 is now at visual position 2, so click there.
    await gu.getCell("A", 2).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Both rows should show as removed.
    let removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 2);

    // Now insert a new row. The grid shows: [synthetic-1, synthetic-2, new].
    // The "new" row is at visual position 3.
    await gu.getCell("B", 3).click();
    await gu.waitAppFocus();
    await gu.enterCell("Elephant");

    // When Grist recycles a row ID, the deleted row and the new row coexist:
    // the deleted row keeps its synthetic ID (struck-through), and the new row
    // shows as added (green). Both removed rows should still be visible.
    removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 2);

    // The new row should show as added.
    const addedRecords = await driver.findAll(".record.diff-local-add");
    assert.lengthOf(addedRecords, 1);

    await returnToTrunk(url);
  });

  it("survives reload with both additions and removals in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Edit a cell.
    await gu.getCell("B", 2).click();
    await gu.waitAppFocus();
    await gu.enterCell("Ape");

    // Delete the first row.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Add a new row.
    await gu.getCell("B", 3).click();
    await gu.waitAppFocus();
    await gu.enterCell("Whale");

    // Verify state before reload.
    let removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 1);
    let addedRecords = await driver.findAll(".record.diff-local-add");
    assert.lengthOf(addedRecords, 1);

    // Reload.
    await gu.refreshDismiss({ ignore: true });

    // Verify the same state after reload.
    removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 1);
    addedRecords = await driver.findAll(".record.diff-local-add");
    assert.lengthOf(addedRecords, 1);

    // Verify edited cell still shows diff.
    const editedCell = await gu.getCell("B", 2);
    assert.equal(await editedCell.find(".diff-parent").getText(), "Primate");
    assert.equal(await editedCell.find(".diff-local").getText(), "Ape");

    await returnToTrunk(url);
  });

  it("shows no spurious diffs after undo/redo cycles in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Edit a cell, then undo. No diff should remain.
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Cat");
    await gu.undo();

    // After undo, no diff highlighting should be visible.
    let diffParents = await driver.findAll(".diff-parent");
    let diffLocals = await driver.findAll(".diff-local");
    assert.lengthOf(diffParents, 0, "no diff-parent after undo");
    assert.lengthOf(diffLocals, 0, "no diff-local after undo");

    // Redo and verify the diff returns cleanly.
    await gu.redo();
    const cell = await gu.getCell("B", 1);
    assert.equal(await cell.find(".diff-parent").getText(), "Fish");
    assert.equal(await cell.find(".diff-local").getText(), "Cat");

    // Undo again and verify clean state.
    await gu.undo();
    diffParents = await driver.findAll(".diff-parent");
    diffLocals = await driver.findAll(".diff-local");
    assert.lengthOf(diffParents, 0, "no diff-parent after second undo");
    assert.lengthOf(diffLocals, 0, "no diff-local after second undo");

    // Also verify raw cell values — no phantom text.
    assert.equal(await gu.getCell("A", 1).getText(), "10");
    assert.equal(await gu.getCell("B", 1).getText(), "Fish");
    assert.equal(await gu.getCell("A", 2).getText(), "20");
    assert.equal(await gu.getCell("B", 2).getText(), "Primate");

    await returnToTrunk(url);
  });

  it("shows no spurious diffs after delete undo/redo cycles in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Delete row 1, then undo.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Verify removed row is visible.
    let removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 1);

    // Undo the delete.
    await gu.undo();

    // No removed rows, no diff highlighting.
    removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 0);
    let diffParents = await driver.findAll(".diff-parent");
    let diffLocals = await driver.findAll(".diff-local");
    assert.lengthOf(diffParents, 0, "no diff-parent after undo delete");
    assert.lengthOf(diffLocals, 0, "no diff-local after undo delete");

    // Redo the delete.
    await gu.redo();
    removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 1);

    // Undo again — should be completely clean.
    await gu.undo();
    removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 0);
    diffParents = await driver.findAll(".diff-parent");
    diffLocals = await driver.findAll(".diff-local");
    assert.lengthOf(diffParents, 0, "no diff-parent after second undo delete");
    assert.lengthOf(diffLocals, 0, "no diff-local after second undo delete");

    await returnToTrunk(url);
  });

  it("shows no spurious diffs after edit-delete-undo cycles in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Edit B row 1, then delete row 1, then undo both.
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Cat");

    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Verify deleted row.
    let removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 1);

    // Undo delete, then undo edit.
    await gu.undo();
    await gu.undo();

    // Everything should be clean — no diffs anywhere.
    let diffParents = await driver.findAll(".diff-parent");
    let diffLocals = await driver.findAll(".diff-local");
    removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(diffParents, 0, "no diff-parent spans");
    assert.lengthOf(diffLocals, 0, "no diff-local spans");
    assert.lengthOf(removedRecords, 0, "no removed rows");

    // Verify raw cell values are original.
    assert.equal(await gu.getCell("A", 1).getText(), "10");
    assert.equal(await gu.getCell("B", 1).getText(), "Fish");
    assert.equal(await gu.getCell("A", 2).getText(), "20");
    assert.equal(await gu.getCell("B", 2).getText(), "Primate");

    // Redo both (edit then delete) and undo both again.
    await gu.redo();
    await gu.redo();
    removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 1);

    await gu.undo();
    await gu.undo();

    // Still clean.
    diffParents = await driver.findAll(".diff-parent");
    diffLocals = await driver.findAll(".diff-local");
    removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(diffParents, 0, "no diff-parent after redo+undo cycle");
    assert.lengthOf(diffLocals, 0, "no diff-local after redo+undo cycle");
    assert.lengthOf(removedRecords, 0, "no removed rows after redo+undo cycle");

    await returnToTrunk(url);
  });

  it("preserves edit diff after undo of delete in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Edit B row 1, then delete row 1.
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Cat");

    // Verify the edit diff is visible.
    let cell = await gu.getCell("B", 1);
    assert.equal(await cell.find(".diff-parent").getText(), "Fish");
    assert.equal(await cell.find(".diff-local").getText(), "Cat");

    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Row is deleted — shows as removed.
    let removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 1);

    // Undo the delete ONLY (not the edit).
    await gu.undo();

    // The row should be back, and the edit diff should be preserved.
    removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 0, "no removed rows after undo delete");

    cell = await gu.getCell("B", 1);
    assert.equal(await cell.find(".diff-parent").getText(), "Fish");
    assert.equal(await cell.find(".diff-local").getText(), "Cat");

    // Column A should have no diff (it was never edited).
    const cellA = await gu.getCell("A", 1);
    assert.equal(await cellA.getText(), "10");
    const aDiffParents = await cellA.findAll(".diff-parent");
    assert.lengthOf(aDiffParents, 0, "A should have no diff");

    await returnToTrunk(url);
  });

  it("preserves deleted rows after delete-all add-one undo in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Delete both rows.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    await gu.getCell("A", 2).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Both should show as removed.
    let removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 2);

    // Add a new row (gets recycled ID).
    await gu.getCell("B", 3).click();
    await gu.waitAppFocus();
    await gu.enterCell("Whale");

    // Undo the add.
    await gu.undo();

    // Both deleted rows should still show with their original values.
    removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 2);

    // Verify deleted rows have content (not blank).
    for (let i = 0; i < removedRecords.length; i++) {
      const cells = await removedRecords[i].findAll(".field_clip");
      const texts = await Promise.all(cells.map((c: any) => c.getText()));
      const hasContent = texts.some(t => t !== "" && t !== "0");
      assert.isTrue(hasContent, `removed row ${i} should have content, got ${JSON.stringify(texts)}`);
    }

    await gu.checkForErrors();

    await returnToTrunk(url);
  });

  it("shows all rows after delete-all and add-one then reload in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Delete both rows.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    await gu.getCell("A", 2).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Both should show as removed.
    let removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 2);

    // Add a new row.
    await gu.getCell("B", 3).click();
    await gu.waitAppFocus();
    await gu.enterCell("Delta");

    // Verify state before reload: 2 removed + 1 added.
    removedRecords = await driver.findAll(".record.diff-local-remove");
    const addedRecords = await driver.findAll(".record.diff-local-add");
    assert.lengthOf(removedRecords, 2, "2 removed rows before reload");
    assert.lengthOf(addedRecords, 1, "1 added row before reload");

    // Reload.
    await gu.refreshDismiss({ ignore: true });

    // After reload, should still have same diff rows, all populated.
    removedRecords = await driver.findAll(".record.diff-local-remove");
    for (let i = 0; i < removedRecords.length; i++) {
      const cells = await removedRecords[i].findAll(".field_clip");
      const texts = await Promise.all(cells.map((c: any) => c.getText()));
      // Every removed row should show trunk values (not blank).
      const hasContent = texts.some(t => t !== "" && t !== "0");
      assert.isTrue(hasContent, `removed row ${i} should have content, got ${JSON.stringify(texts)}`);
    }

    const addedAfterReload = await driver.findAll(".record.diff-local-add");
    assert.isAtLeast(removedRecords.length + addedAfterReload.length, 3,
      "should have at least 3 diff rows after reload");

    await gu.checkForErrors();

    await returnToTrunk(url);
  });

  it("does not crash on copy-paste within a new row in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Add a new row by typing in the "new" row.
    await gu.getCell("B", 3).click();
    await gu.waitAppFocus();
    await gu.enterCell("Whale");

    // Copy the value from the new row's B cell.
    await gu.getCell("B", 3).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), "c"));

    // Paste into the new row's A cell.
    await gu.getCell("A", 3).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), "v"));
    await gu.waitForServer();

    // Should not produce errors.
    await gu.checkForErrors();

    // Also test: copy from an edited cell in an existing row (which has
    // CellVersions in _updates) and paste into another cell.
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Cat");

    // Copy the edited cell (B1 now shows Fish→Cat diff, has CellVersions).
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), "c"));

    // Paste into A1.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), "v"));
    await gu.waitForServer();

    await gu.checkForErrors();

    await returnToTrunk(url);
  });

  it("does not crash on fill-down into a deleted row in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Delete the first row.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Verify the deleted row appears at position 1.
    await driver.findWait(".record.diff-local-remove", 2000);

    // Select a range spanning the deleted row (position 1) and the real row (position 2).
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.DOWN));

    // Attempt fill-down (Mod+D). The selection includes a synthetic row ID.
    await gu.sendKeys(Key.chord(await gu.modKey(), "d"));
    await gu.waitForServer();

    // Should not produce errors.
    await gu.checkForErrors();

    // The deleted row should still be intact.
    const removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 1);

    await returnToTrunk(url);
  });

  it("does not crash on paste into a deleted row in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Copy a value from the real row.
    await gu.getCell("B", 2).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), "c"));

    // Delete the first row.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Click on the deleted row and try to paste into it.
    const removedRecord = await driver.findWait(".record.diff-local-remove", 2000);
    await removedRecord.find(".field_clip").click();
    await gu.sendKeys(Key.chord(await gu.modKey(), "v"));
    await gu.waitForServer();

    // Should not produce errors.
    await gu.checkForErrors();

    // The deleted row should still show original value.
    const removedAfter = await driver.findWait(".record.diff-local-remove", 2000);
    const cellText = await removedAfter.find(".field_clip").getText();
    assert.equal(cellText, "10");

    await returnToTrunk(url);
  });

  it("handles multi-row delete in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Select both rows by clicking row 1 then shift-clicking row 2.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.DOWN));

    // Delete both rows at once.
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Both rows should show as removed.
    const removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 2);

    // No errors.
    await gu.checkForErrors();

    // Undo — both should reappear cleanly.
    await gu.undo();
    const removedAfter = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedAfter, 0);
    const diffParents = await driver.findAll(".diff-parent");
    assert.lengthOf(diffParents, 0, "no spurious diffs after undo of multi-row delete");

    await returnToTrunk(url);
  });

  it("handles context menu delete on a deleted row in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Delete the first row via keyboard.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Verify the deleted row appears.
    await driver.findWait(".record.diff-local-remove", 2000);

    // Now try to delete via context menu on the removed row.
    // The removed row is at visual position 1 in row numbers.
    // Right-click on it and select Delete.
    try {
      await gu.openRowMenu(1);
      const deleteItem = await gu.findOpenMenuItem("li", /Delete/);
      await deleteItem.click();
      await gu.confirm();
      await gu.waitForServer();
    } catch (e) {
      // Context menu might not open on a synthetic row — that's acceptable.
    }

    // No errors should have been produced.
    await gu.checkForErrors();

    // The deleted row should still be there.
    const removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 1);

    await returnToTrunk(url);
  });

  it("shows deleted rows in card view in suggestion mode", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Delete the first row in grid view.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm();
    await gu.waitForServer();

    // Verify deleted row in grid view.
    await driver.findWait(".record.diff-local-remove", 2000);

    // Switch to card view.
    await gu.changeWidget("Card List");

    // No errors from rendering cards with a deleted row.
    await gu.checkForErrors();

    // Switch back to grid view — the deleted row should still be there.
    await gu.changeWidget("Table");
    await gu.waitForServer();
    const removedRecords = await driver.findAll(".record.diff-local-remove");
    assert.lengthOf(removedRecords, 1);

    await gu.checkForErrors();

    await returnToTrunk(url);
  });

  it("keeps wrapped row height in suggestion mode after editing the cell", async function() {
    await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    // Helper to measure B cell.
    const getHeight = async () => (await gu.getCell("B", 1).getRect()).height;

    // Remember the normal height of the row.
    const normalHeight = await getHeight();

    // Add some text and wrap it.
    const lorem =
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do " +
      "eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim";
    await gu.sendActions([
      ["UpdateRecord", "Life", 1, { B: lorem }],
    ]);
    await gu.getCell("B", 1).click();
    await gu.openColumnPanel();
    await driver.findWait(".test-tb-wrap-text", 500).click();
    await gu.waitForServer();

    // Make sure the row is now taller.
    const wrappedHeight = await getHeight();
    assert.isAbove(wrappedHeight, normalHeight);

    // Now on suggestions change it to some shorter text, and make sure it stays wrapped.
    await workOnCopy(url);
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("Foo");

    // Now the row should be at least as tall as before.
    await gu.waitToPass(async () => {
      assert.isAtLeast((await gu.getCell("B", 1).getRect()).height, wrappedHeight);
    }, 2000);

    await returnToTrunk(url);
  });

  async function makeLifeDoc() {
    // Load a test document.
    const session = await gu.session().teamSite.login();
    const doc = await session.tempDoc(cleanup, "Hello.grist");

    // Turn on feature.
    const api = session.createHomeApi();
    await api.updateDoc(doc.id, {
      options: {
        proposedChanges: {
          acceptProposals: true,
        },
      },
    });

    await api.applyUserActions(doc.id, [
      ["AddTable", "Life", [
        { id: "A", type: "Int" },
        { id: "B", type: "Text" },
      ]],
      ["AddRecord", "Life", 1, { A: 10, B: "Fish" }],
      ["AddRecord", "Life", 2, { A: 20, B: "Primate" }],
    ]);

    await gu.openPage("Life");
    return { session, doc, api };
  }

  // Work on a copy.
  async function workOnCopy(url: string) {
    await driver.get(url);
    if (await gu.isAlertShown()) { await gu.acceptAlert(); }
    await gu.waitForDocToLoad();
    await driver.findWait(".test-tb-share", 2000).click();
    await driver.findWait(".test-work-on-copy", 2000).click();
    await gu.waitForServer();
    await gu.openPage("Life");
  }

  async function returnToTrunk(url: string) {
    await driver.get(url);
    if (await gu.isAlertShown()) { await gu.acceptAlert(); }
    await gu.waitForDocToLoad();
  }

  // Propose a change.
  async function proposeChange() {
    assert.match(await driver.find(".test-tools-proposals").getText(),
      /Suggest changes/);
    await driver.find(".test-tools-proposals").click();
    await driver.findWait(".test-proposals-propose", 2000).click();
    await gu.waitForServer();
  }
});

async function getProposalsCount(): Promise<string> {
  return driver.find(".test-tools-proposals-count").getAttribute("value");
}

async function hasChangesDot(): Promise<boolean> {
  return driver.find(".test-tools-proposals-dot").isPresent();
}

async function assertProposalsCount(expected: number | "...") {
  assert.equal(await getProposalsCount(), String(expected));
  assert.equal(await hasChangesDot(), expected !== 0);
}

async function getColumns(section: string): Promise<string[]> {
  const title = await driver.findContentWait(".test-viewsection-title", section, 2000);
  const parent = await title.findClosest(".viewsection_content");
  return await parent.findAll(".test-column-title-text", e => e.getText());
}

async function getRowValues(section: string, rowIndex: number): Promise<string[]> {
  const title = await driver.findContentWait(".test-viewsection-title", section, 2000);
  const parent = await title.findClosest(".viewsection_content");
  await parent.findWait(".record", 2000);
  const row = (await parent.findAll(".gridview_row .record"))[rowIndex];
  return await row.findAll(".field_clip", e => e.getText());
}

async function getChangeType(section: string, rowIndex: number): Promise<string> {
  const title = await driver.findContentWait(".test-viewsection-title", section, 2000);
  const parent = await title.findClosest(".viewsection_content");
  await parent.findWait(".gridview_data_row_num", 2000);
  const row = (await parent.findAll(".gridview_data_row_num"))[rowIndex];
  return await row.getText();
}

async function expand(section: string) {
  const title = await driver.findContentWait(".test-viewsection-title", section, 2000);
  const parent = await title.findClosest(".viewsection_content");
  const button = await parent.find(".test-proposals-expand");
  await button.click();
}

async function collapse(section: string) {
  const title = await driver.findContentWait(".test-viewsection-title", section, 2000);
  const parent = await title.findClosest(".viewsection_content");
  const button = await parent.find(".test-proposals-collapse");
  await button.click();
}

/**
 * Based on Dmitry's comment at:
 *   https://github.com/gristlabs/grist-core/issues/970#issuecomment-2102933747
 */
async function setReferenceDisplayColumn(
  api: UserAPI, docId: string, tableId: string, refColId: string, showColId: string,
) {
  const docApi = api.getDocAPI(docId);

  // Get column metadata to find the numeric IDs and string IDs
  const columns = await docApi.getRecords("_grist_Tables_column");
  const tables = await docApi.getRecords("_grist_Tables");

  const table = tables.find(t => t.fields.tableId === tableId);
  if (!table) {
    throw new Error(`Table ${tableId} not found`);
  }

  const refColumn = columns.find(c =>
    c.fields.parentId === table.id && c.fields.colId === refColId,
  );

  if (!refColumn) {
    throw new Error(`Column ${refColId} not found`);
  }

  const targetTableId = getReferencedTableId(refColumn.fields.type as string);
  if (!targetTableId) {
    throw new Error(`Column ${refColId} is not a reference column`);
  }

  const targetTable = tables.find(t => t.fields.tableId === targetTableId);

  if (!targetTable) {
    throw new Error(`Target table ${targetTableId} not found`);
  }

  const showColumn = columns.find(c =>
    c.fields.parentId === targetTable.id && c.fields.colId === showColId,
  );

  if (!showColumn) {
    throw new Error(`Column ${showColId} not found in target table`);
  }

  // Apply both actions together:
  // 1. Update visibleCol in metadata
  // 2. Set the display formula
  await docApi.applyUserActions([
    ["UpdateRecord", "_grist_Tables_column", refColumn.id, { visibleCol: showColumn.id }],
    ["SetDisplayFormula", tableId, null, refColumn.id, `$${refColId}.${showColId}`],
  ]);
}

/**
 * Set conditional formatting on a column. There's probably
 * a slightly smoother way, this is patched together from just
 * hacking.
 */
async function addConditionalFormatting(
  api: UserAPI,
  docId: string,
  tableId: string,
  colId: string,
  formula: string,
  options?: {
    textColor?: string;
    fillColor?: string;
  },
) {
  const docApi = api.getDocAPI(docId);

  // Get column metadata to find the numeric IDs and string IDs
  const columns = await docApi.getRecords("_grist_Tables_column");
  const tables = await docApi.getRecords("_grist_Tables");

  const table = tables.find(t => t.fields.tableId === tableId);
  if (!table) {
    throw new Error(`Table ${tableId} not found`);
  }

  const column = columns.find(c =>
    c.fields.parentId === table.id && c.fields.colId === colId,
  );

  if (!column) {
    throw new Error(`Column ${colId} not found`);
  }

  // Add an empty rule
  await docApi.applyUserActions([
    ["AddEmptyRule", tableId, 0, column.id],
  ]);

  // Fetch the updated column to get the new rules array
  const updatedColumns = await docApi.getRecords("_grist_Tables_column");
  const updatedColumn = updatedColumns.find(c => c.id === column.id);

  if (!updatedColumn) {
    throw new Error("Failed to fetch updated column");
  }

  // The rules field is a RefList - ['L', id1, id2, ...]
  const rules = updatedColumn.fields.rules as any[];
  if (!Array.isArray(rules) || rules.length < 2 || rules[0] !== "L") {
    throw new Error("Unexpected rules format");
  }

  // Get the last rule column ID (the one we just created)
  const ruleColumnId = rules[rules.length - 1];
  const ruleIndex = rules.length - 2; // Index in the array (skip the 'L' marker)

  // Update the rule column's formula
  await docApi.applyUserActions([
    ["UpdateRecord", "_grist_Tables_column", ruleColumnId, { formula }],
  ]);

  // Now update the data column's widgetOptions with the styling for this rule
  if (options) {
    const currentWidgetOptions = updatedColumn.fields.widgetOptions as string || "{}";
    const widgetOptions = JSON.parse(currentWidgetOptions);

    if (!widgetOptions.rulesOptions) {
      widgetOptions.rulesOptions = [];
    }

    // Ensure the array is large enough
    while (widgetOptions.rulesOptions.length <= ruleIndex) {
      widgetOptions.rulesOptions.push({});
    }

    // Set the options for this rule at the correct index
    widgetOptions.rulesOptions[ruleIndex] = options;

    await docApi.applyUserActions([
      ["UpdateRecord", "_grist_Tables_column", column.id, {
        widgetOptions: JSON.stringify(widgetOptions),
      }],
    ]);
  }
}
