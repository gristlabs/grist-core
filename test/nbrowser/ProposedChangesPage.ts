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
    await gu.enterCell(["test1"]);

    // Work on a copy.
    await driver.find(".test-tb-share").click();
    await driver.findWait(".test-work-on-copy", 2000).click();
    await gu.waitForServer();
    await gu.waitForDocToLoad();

    // Change the content of the first cell.
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell(["test2"]);

    // Go to the propose-changes page.
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes (1)");
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
    await gu.enterCell(["Bird"]);

    await proposeChange();

    // Work on another copy and propose a different change.
    await workOnCopy(url);
    await gu.getCell("B", 2).click();
    await gu.waitAppFocus();
    await gu.enterCell(["Mammal"]);
    await proposeChange();

    // Work on another copy and propose a different change.
    await workOnCopy(url);
    await gu.getCell("B", 3).click();
    await gu.waitAppFocus();
    await gu.enterCell(["SpaceDuck"]);
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
    await gu.enterCell(["Bird"]);

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
    await gu.enterCell(["Bird"]);

    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes (1)");

    // Make another change.
    await gu.getCell("A", 2).click();
    await gu.waitAppFocus();
    await gu.enterCell(["15"]);

    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes (2)");

    await gu.undo();
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes (1)");

    await gu.redo();
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes (2)");

    await gu.reloadDoc();
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes (2)");

    assert.notInclude(await driver.find(".test-undo").getAttribute("class"), "-disable");

    await proposeChange();
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes");

    assert.include(await driver.find(".test-undo").getAttribute("class"), "-disable");

    await gu.openPage("Life");
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell(["13"]);
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes (1)");
    assert.notInclude(await driver.find(".test-undo").getAttribute("class"), "-disable");
    await proposeChange();
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes");
    assert.include(await driver.find(".test-undo").getAttribute("class"), "-disable");

    await driver.findContentWait("span", /original document/, 2000).click();
    await driver.findWait(".test-proposals-header", 2000);
    await gu.openPage("Life");
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell(["1"]);

    await driver.get(forkUrl);
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell(["99"]);
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes (1)");
    await proposeChange();
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes");
    await gu.openPage("Life");
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell(["999"]);
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes (1)");
    await proposeChange();
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes");

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
    await gu.enterCell(["Bird"]);

    // Make a change to the Plants table.
    await gu.openPage("Plants");
    await gu.getCell("Type", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell(["Deciduous Tree"]);

    // Check that the count shows 2 changes
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes (2)");

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
    await gu.enterCell(["Desert"]);

    // Check that the count shows 1 change
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes (1)");

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
    await gu.enterCell(["Ocean"]);
    await gu.enterCell(["Desert"]);
    await gu.enterCell(["Arctic"]);
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();

    // Check that the count shows 1 change
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes (1)");

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

    // Check that the count shows 2 changes.
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes (2)");

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
    await gu.enterCell(["Ocean"]);

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

    // Check that the count shows 2 changes.
    assert.equal(await driver.find(".test-tools-proposals").getText(),
      "Suggest changes (2)");

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
    await gu.enterCell(["Fizh"]);

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
