import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/projects/testUtils";

import { assert, driver, Key, stackWrapFunc } from "mocha-webdriver";

describe("DocMenu", function() {
  this.timeout(60000);      // Set a longer default timeout.
  gu.bigScreen();
  setupTestSuite();

  const openWorkspaceMenu = stackWrapFunc(async function(wsRegex: RegExp) {
    await driver.findContent(".test-dm-workspace", wsRegex).mouseMove()
      .find(".test-dm-workspace-options").click();
  });

  const openDocMenu = stackWrapFunc(async function(docRegex: RegExp) {
    // Note that this matches all text of doc entry, including "Edited ..." text. It's a bit
    // tricky to avoid that. If element is out of view, the first mouseMove() will scroll it into
    // view. It seems that a second one is needed to actually move the mouse over it.
    await driver.findContent(".test-dm-doc", docRegex).mouseMove().mouseMove()
      .find(".test-dm-doc-options").click();
  });

  const getDocs = stackWrapFunc(async function(workspace?: string) {
    let docs = await driver.findAll(".test-dm-doc");
    if (workspace) {
      const results = await Promise.all(
        docs.map(
          async d => (await d.find(".test-dm-doc-workspace").getText()) === "Workspace\n" + workspace,
        ),
      );
      docs = docs.filter((_, index) => results[index]);
    }
    return docs;
  });

  const getDocNames = stackWrapFunc(async function(workspace?: string) {
    const docs = await getDocs(workspace);
    const result = await Promise.all(
      docs.map(d => d.find(".test-dm-doc-name").getText()),
    );
    return result;
  });

  const getDocTimes = stackWrapFunc(async function(workspace?: string) {
    const docs = await getDocs(workspace);
    return await Promise.all(
      docs.map(d => d.find(".test-dm-doc-edited-at").getText()),
    );
  });

  const getPinnedDocNames = stackWrapFunc(async function(workspace?: string) {
    let docs = await getDocs(workspace);
    const results = await Promise.all(
      docs.map(async d => await d.find(".test-dm-doc-pinned").isPresent()),
    );
    docs = docs.filter((_, index) => results[index]);
    return await Promise.all(
      docs.map(d => d.find(".test-dm-doc-name").getText()),
    );
  });

  before(async function() {
    await driver.get(`${server.getHost()}/DocMenu`);
    // Prevent the opening of new pages using using a UrlState hook. This prevents the testing of
    // navigation, but allows for better testing of the DocMenu page itself.
    await driver.executeScript(`window._urlStateLoadPage = () => {};`);
    // Hide all popups; they interfere with some clicks.
    await gu.dismissCardPopups(null);
  });

  it("should correctly detect initials in doc names", async function() {
    // We will work on document Doc22, which is single pinned document in the August
    // workspace.

    await gu.openWorkspace("August");
    await gu.selectTab("Pinned");
    assert.deepEqual(
      await getDocNames(),
      ["Doc22"],
    );

    await testName("A", "A");
    await testName("Aa", "A");
    await testName("A A", "AA");
    await testName("A B", "AB");
    await testName("A Bc", "AB");
    await testName("A B C", "AB");
    await testName(" foo  bar cat", "FB", "foo bar cat");
    await testName(" foo-bar cat", "FC", "foo-bar cat");
    await testName("foo-bar", "F");
    await testName("  Something", "S", "Something");
    await openDialog();
    await typeName("      ");
    await checkInitials("", "      ");
    await cancel();
  });

  it("should correctly detect initials in doc names with emojis characters", async function() {
    await testName("😀", "😀", "");
    await testName("😀😀", "😀", "😀");
    await testName("😀 Hello", "😀", "Hello");
    await testName("😀😀 World", "😀", "😀 World");
    await testName("😀A", "😀", "A");
    await testName("😀 A", "😀", "A");
    await testName("😀-A", "😀", "-A");
    await testName("😀_A", "😀", "_A");
    await testName("😀123", "😀", "123");
    await testName("😀😀😀", "😀", "😀😀");
    await testName("😀😀 A", "😀", "😀 A");
    await testName("😀-😀", "😀", "-😀");
    await testName("😀_😀", "😀", "_😀");

    // Now emoji should be ignored as a second character, alongside any non letter/digit.
    await testName("A😀A", "A", "A😀A");
    await testName("A😀", "A", "A😀");
    await testName("A😀😀", "A", "A😀😀");
    await testName("A😀 😀", "A", "A😀 😀");
    await testName("A😀-😀", "A", "A😀-😀");
    await testName("A😀 B", "AB");
    await testName("A😀-B", "A");
    await testName("A😀_B", "A");
    await testName("A😀123", "A");
    await testName("A😀😀 😀B", "A");
    await testName("A😀😀 😀B C", "A");
  });

  it("should ignore digits in the front of the name", async function() {
    // Couple of more test cases with digits.
    await testName("1😀 Foo", "1F", "1😀 Foo");
    await testName("1😀😀 Foo", "1F", "1😀😀 Foo");
    await testName("1😀 😀Foo", "1",  "1😀 😀Foo"); // second word must start with a letter/digit
    await testName("1😀 1Foo", "11",  "1😀 1Foo"); // second word must start with a letter/digit
    await testName("1😀 AFoo", "1A",  "1😀 AFoo"); // second word must start with a letter/digit
    await testName("A😀 1Foo", "A1",  "A😀 1Foo"); // second word must start with a letter/digit
  });

  it("should not ignore spaces around emojis", async function() {
    await testName(" 😀", "",  "😀"); // with space in front, there is not icon at all.
    await testName(" 😀 ", "",  "😀");
    await testName("😀 ", "😀",  "");
    await testName(" Foo Bar", "FB",  "Foo Bar");
    await testName(" Foo.", "F", "Foo.");
    await testName(" Foo (Copy)", "F", "Foo (Copy)");
    await testName(" Foo", "F", "Foo");
    await testName(" Foo 1bar", "F1", "Foo 1bar");
    await testName(" 1bar foo", "1F", "1bar foo");
  });

  it("should work with complex emojis", async function() {
    // Complex emojis on the left.
    await testName("👨‍👩‍👧‍👦 Foo", "👨‍👩‍👧‍👦", "Foo");
    await testName("👨‍👩‍👧‍👦1 Foo", "👨‍👩‍👧‍👦", "1 Foo");
    await testName("1👨‍👩‍👧‍👦 Foo", "1F", "1👨‍👩‍👧‍👦 Foo");

    // Complex emojis on the right, display name should be the same,
    await testName("Foo 👨‍👩‍👧‍👦", "F", "Foo 👨‍👩‍👧‍👦");
    await testName("Foo 👨‍👩‍👧‍👦1", "F", "Foo 👨‍👩‍👧‍👦1");
    await testName("Foo 1👨‍👩‍👧‍👦", "F1", "Foo 1👨‍👩‍👧‍👦");

    // Empty spaces.
    await testName("Foo  👨‍👩‍👧‍👦", "F", "Foo 👨‍👩‍👧‍👦"); // Spaces between are ignored when getting it from driver.
    await testName("Foo  👨‍👩‍👧‍👦  ", "F", "Foo 👨‍👩‍👧‍👦");
    await testName("  Foo  👨‍👩‍👧‍👦  ", "F", "Foo 👨‍👩‍👧‍👦");

    // Complex sequence emojis.
    await testName("👨‍👩‍👧‍👦👨‍👩‍👧‍👦", "👨‍👩‍👧‍👦", "👨‍👩‍👧‍👦");
    await testName("👨‍👩‍👧‍👦👨‍👩‍👧‍👦1", "👨‍👩‍👧‍👦", "👨‍👩‍👧‍👦1");
    await testName("1👨‍👩‍👧‍👦👨‍👩‍👧‍👦 Foo", "1F", "1👨‍👩‍👧‍👦👨‍👩‍👧‍👦 Foo");
    await testName("👨‍👩‍👧‍👦👨‍👩‍👧‍👦Foo Bar", "👨‍👩‍👧‍👦", "👨‍👩‍👧‍👦Foo Bar");
  });

  it("should correctly detect initials in doc names with special symbols", async function() {
    // Only letters and digits all allowed in the initials.
    await testName("A !A", "A", "A !A");
    await testName("A @A", "A", "A @A");
    await testName("A (Copy)", "A", "A (Copy)");
    await testName("A (Copy) B", "A", "A (Copy) B");
  });

  it("should ignore emoji if icon is set", async function() {
    // Now special symbols like, they should be ignored if the second word starts with it.
    await testNameWithIcon("Foo Bar");
    await testNameWithIcon("😀 Foo Bar");
    await testNameWithIcon("😀😀 Foo Bar");

    // Restore original name.
    await openDialog();
    await driver.find(".test-dm-reset-icon").click();
    await confirm();
    await testName("Doc22", "D");
  });

  it("should filter the docs via the workspace sidepane", async function() {
    // Assert that initially all doc blocks are visible
    await driver.find(".test-dm-all-docs").click();
    await driver.findContent(".test-dm-doclist .test-component-tabs-tab", /All/).click();
    assert.deepEqual(
      await getDocNames(),
      [
        "Doc01",
        "Doc02",
        "Doc03",
        "Doc04",
        "Doc05",
        "Doc06",
        "Doc07",
        "Doc08",
        "Doc09",
        "Doc10",
        "Doc11",
        "Doc12",
        "Doc13",
        "Doc14",
        "Doc15",
        "Doc16",
        "Doc18",
        "Doc19",
        "Doc20",
        "Doc21",
        "Doc22",
        "Doc23",
        "One doc to rule them all with a long name and a strong fist",
      ],
    );

    // Assert that clicking a workspace in the sidepane filters the doclist and the filtered
    // docs are as expected.
    await driver.findContent(".test-dm-workspace", /August/).doClick();
    assert.deepEqual(await getDocNames(), ["Doc22", "Doc23"]);

    // Assert that clicking back on the 'All Documents' buttons once again shows all the docs
    await driver.find(".test-dm-all-docs").doClick();
    await driver.findContent(".test-dm-doclist .test-component-tabs-tab", /All/).click();
    assert.deepEqual(
      await getDocNames(),
      [
        "Doc01",
        "Doc02",
        "Doc03",
        "Doc04",
        "Doc05",
        "Doc06",
        "Doc07",
        "Doc08",
        "Doc09",
        "Doc10",
        "Doc11",
        "Doc12",
        "Doc13",
        "Doc14",
        "Doc15",
        "Doc16",
        "Doc18",
        "Doc19",
        "Doc20",
        "Doc21",
        "Doc22",
        "Doc23",
        "One doc to rule them all with a long name and a strong fist",
      ],
    );
  });

  it("should allow adding, removing, and renaming docs", async function() {
    // Add a doc. Note that we prevent the loading of new pages in before().
    await openAddNew();
    await driver.find(".test-dm-new-doc").doClick();
    assert.deepEqual(await getDocNames("August"), ["Doc22", "Doc23", "Untitled document"]);

    // Assert that the added doc modified time is as expected
    assert.deepEqual(
      await getDocTimes("August"),
      ["Edited a few seconds ago", "Edited a few seconds ago", "Edited a few seconds ago"],
    );

    // Rename the doc.
    await openDocMenu(/Untitled document/);
    await driver.findWait(".test-dm-rename-doc", 100).doClick();
    await driver.findWait(".test-modal-dialog", 100);
    await gu.waitForFocus("#name");
    await driver.sendKeys("NewDocRenamed", Key.ENTER);
    assert.deepEqual(await getDocNames("August"), ["Doc22", "Doc23", "NewDocRenamed"]);

    // Start to delete the doc, check that cancelling works.
    await openDocMenu(/NewDocRenamed/);
    await driver.findWait(".test-dm-delete-doc", 100).doClick();
    await driver.findWait(".test-modal-cancel", 100).doClick();
    assert.deepEqual(await getDocNames("August"), ["Doc22", "Doc23", "NewDocRenamed"]);

    // Delete the doc.
    await openDocMenu(/NewDocRenamed/);
    await driver.findWait(".test-dm-delete-doc", 100).doClick();
    await driver.findWait(".test-modal-confirm", 100).doClick();
    assert.deepEqual(await getDocNames("August"), ["Doc22", "Doc23"]);
  });

  it("should allow adding, removing, and renaming workspaces", async function() {
    // Start adding a workspace, check that cancelling works.
    await openAddNew();
    await driver.findWait(".test-dm-new-workspace", 100).doClick();
    await driver.sendKeys(Key.ESCAPE);
    let wsNames = await driver.findAll(".test-dm-workspace", e => e.getText());
    assert.deepEqual(wsNames, ["August", "Personal", "Real estate"]);

    // Add a workspace.
    await addWorkspace("October");
    wsNames = await driver.findAll(".test-dm-workspace", e => e.getText());
    assert.deepEqual(wsNames, ["August", "October", "Personal", "Real estate"]);

    // Rename the workspace.
    await openWorkspaceMenu(/October/);
    await driver.findWait(".test-dm-rename-workspace", 100).doClick();
    await gu.waitForFocus(".test-dm-ws-name-editor");
    await driver.find(".test-dm-ws-name-editor").sendKeys("WorkspaceRenamed", Key.ENTER);
    wsNames = await driver.findAll(".test-dm-workspace", e => e.getText());
    assert.deepEqual(wsNames, ["August", "Personal", "Real estate", "WorkspaceRenamed"]);

    // Start to delete the workspace, check that cancelling works.
    await openWorkspaceMenu(/WorkspaceRenamed/);
    await driver.findWait(".test-dm-delete-workspace", 100).doClick();
    await driver.findWait(".test-modal-cancel", 100).click();
    wsNames = await driver.findAll(".test-dm-workspace", e => e.getText());
    assert.deepEqual(wsNames, ["August", "Personal", "Real estate", "WorkspaceRenamed"]);

    await addWorkspace("Z1");
    await addWorkspace("Z2");
    await addWorkspace("Z3");

    // Delete not selected workspace.
    const currentUrl = await driver.getCurrentUrl();
    await deleteWorkspace("WorkspaceRenamed");
    wsNames = await driver.findAll(".test-dm-workspace", e => e.getText());
    assert.deepEqual(wsNames, ["August", "Personal", "Real estate", "Z1", "Z2", "Z3"]);
    // Make sure the URL is not changed.
    assert.equal(await driver.getCurrentUrl(), currentUrl);

    // Delete selected workspace.
    await selectWs("Z2");
    await deleteWorkspace("Z2");
    assert.equal(await selectedWs(), "Z3");

    // Delete last one, Real estate should be selected.
    await selectWs("Z3");
    await deleteWorkspace("Z3");
    assert.equal(await selectedWs(), "Z1");
    await deleteWorkspace("Z1");

    async function addWorkspace(name: string) {
      await openAddNew();
      await driver.findWait(".test-dm-new-workspace", 100).click();
      await driver.findWait(".test-dm-ws-name-editor", 100).sendKeys(name, Key.ENTER);
    }

    async function deleteWorkspace(name: string) {
      await openWorkspaceMenu(gu.exactMatch(name));
      await driver.findWait(".test-dm-delete-workspace", 100).doClick();
      await driver.findWait(".test-modal-confirm", 100).click();
    }

    async function selectWs(name: string) {
      await driver.findContent(".test-dm-workspace", gu.exactMatch(name)).click();
    }

    async function selectedWs() {
      if (!await driver.find(".test-dm-workspace-selected").isPresent()) { return null; }
      return await driver.find(".test-dm-workspace-selected").getText();
    }
  });

  it("should allow add/import options only with workspace edit access", async function() {
    // Select "Real estate" workspace. It's view-only.
    await driver.findContent(".test-dm-workspace", /Real estate/).click();

    // Open the Add menu; Create/Import options should be disabled, and not work.
    await openAddNew();
    assert.include((await driver.find(".test-dm-new-doc").getAttribute("className")).split(/\s+/), "disabled");
    assert.include((await driver.find(".test-dm-import").getAttribute("className")).split(/\s+/), "disabled");
    const docs1 = await getDocNames();
    await driver.find(".test-dm-new-doc").click();
    assert.deepEqual(await getDocNames(), docs1);

    // Hit escape to close the menu
    await driver.sendKeys(Key.ESCAPE);

    // Select August workspace. We are an owner of it.
    await driver.findContent(".test-dm-workspace", /August/).click();

    // Open the Add menu; the Create/Import option should be enabled, and should create a doc.
    await openAddNew();
    await gu.findOpenMenu();
    assert.notInclude((await driver.find(".test-dm-new-doc").getAttribute("className")).split(/\s+/), "disabled");
    assert.notInclude((await driver.find(".test-dm-import").getAttribute("className")).split(/\s+/), "disabled");
    assert.deepEqual(await getDocNames(), ["Doc22", "Doc23"]);
    await driver.find(".test-dm-new-doc").click();
    assert.deepEqual(await getDocNames(), ["Doc22", "Doc23", "Untitled document"]);
  });

  it("should prevent rename and delete actions without access", async function() {
    // Try to rename a workspace with view only access.
    await openWorkspaceMenu(/Real estate/);
    await driver.findWait(".test-dm-rename-workspace", 100).doClick();
    assert.equal(await driver.find(".test-dm-ws-name-editor").isPresent(), false);

    // Click on a disabled item doesn't close the menu
    assert.strictEqual(await driver.find(".test-dm-rename-workspace").isDisplayed(), true);

    // Try to delete a workspace with view only access.
    await driver.find(".test-dm-delete-workspace").click();
    assert.equal(await driver.find(".test-modal-cancel").isPresent(), false);
    await driver.find(".test-dm-ws-label").click();     // click-away to close menu

    // Try to rename/delete a doc with view only access.
    await driver.find(".test-dm-all-docs").click();
    await openDocMenu(/Doc09/);
    await driver.find(".test-dm-rename-doc").doClick();
    assert.equal(await driver.find(".test-modal-cancel").isPresent(), false);
    await driver.find(".test-dm-delete-doc").doClick();
    assert.equal(await driver.find(".test-modal-cancel").isPresent(), false);
    // Hit escape to close the menu
    await driver.sendKeys(Key.ESCAPE);
    await gu.notPresent(".test-dm-rename-doc");
  });

  it("should show pinned docs", async function() {
    // Initially 3 docs are pinned.
    assert.deepEqual(
      await getPinnedDocNames(),
      ["One doc to rule them all with a long name and a strong fist", "Doc22", "Doc13"],
    );

    // Switch to each workspace and ensure that only that workspace's docs are shown pinned.
    await driver.findContent(".test-dm-workspace", /August/).click();
    assert.deepEqual(await getPinnedDocNames(), ["Doc22"]);

    await driver.findContent(".test-dm-workspace", /Personal/).click();
    assert.deepEqual(await getPinnedDocNames(),
      ["Doc13", "One doc to rule them all with a long name and a strong fist"]);

    await driver.findContent(".test-dm-workspace", /Real estate/).click();
    assert.deepEqual(await getPinnedDocNames(), []);
  });

  it("should allow pinning/unpinning docs", async function() {
    // Switch to 'All Documents', unpin all docs.
    await driver.find(".test-dm-all-docs").click();
    await openDocMenu(/Doc13/);
    await driver.find(".test-dm-pin-doc").click();
    await openDocMenu(/Doc22/);
    await driver.find(".test-dm-pin-doc").click();
    await openDocMenu(/One doc/);
    await driver.find(".test-dm-pin-doc").click();
    assert.deepEqual(await getPinnedDocNames(), []);

    // Pin a doc.
    await openDocMenu(/Doc22/);
    await driver.find(".test-dm-pin-doc").doClick();
    assert.deepEqual(await getPinnedDocNames(), ["Doc22"]);

    // Pin another doc.
    await openDocMenu(/Doc11/);
    await driver.find(".test-dm-pin-doc").doClick();
    assert.deepEqual(await getPinnedDocNames(), ["Doc22", "Doc11"]);

    // Check that a pinned doc can be fully removed.
    await openDocMenu(/Doc11/);
    await driver.find(".test-dm-delete-doc").doClick();
    await driver.find(".test-modal-confirm").doClick();
    assert.deepEqual(await getPinnedDocNames(), ["Doc22"]);

    // Check that a pinned doc can be unpinned.
    await openDocMenu(/Doc22/);
    await driver.find(".test-dm-pin-doc").doClick();
    assert.isEmpty(await getPinnedDocNames());
  });

  it("should allow downloading docs", async function() {
    await openDocMenu(/Doc13/);
    await driver.findContent(".test-dm-tb-share-option", /Download document/).doClick();
    await driver.findWait(".test-option-full", 2000).isDisplayed();
    assert.match(await driver.find(".test-download-button-link").getAttribute("href"), /\/mock\/download\/url/);
    await driver.sendKeys(Key.ESCAPE);
  });

  it("should allow moving docs", async function() {
    await openDocMenu(/Doc13/);
    await driver.find(".test-dm-move-doc").doClick();

    // Check that the destination workspace options are as expected.
    let destinations = await driver.findAll(".test-dm-dest-ws");
    assert.lengthOf(destinations, 3);
    assert.equal(await destinations[0].getText(), "August");

    // The last two should be disabled and contain explanations.
    assert.equal(await destinations[1].getText(), "Personal\nCurrent workspace");
    assert.isTrue(await destinations[1].matches(".test-dm-dest-ws[class*=-disabled]"));
    assert.equal(await destinations[2].getText(), "Real estate\nRequires edit permissions");
    assert.isTrue(await destinations[2].matches(".test-dm-dest-ws[class*=-disabled]"));

    // Assert that the modal confirm button is also disabled before anything is selected.
    assert.equal(await driver.find(".test-modal-confirm").getAttribute("disabled"), "true");

    // Select the only valid destination.
    await destinations[0].doClick();
    assert.isTrue(await destinations[0].matches(".test-dm-dest-ws[class*=-selected]"));
    await driver.find(".test-modal-confirm").doClick();

    // Check that the doc is now in August.
    await driver.findContent(".test-dm-workspace", /August/).doClick();
    assert.deepInclude(await getDocNames(), "Doc13");

    // Move the doc back.
    await openDocMenu(/Doc13/);
    await driver.find(".test-dm-move-doc").doClick();

    // Check that the destination workspace options are as expected.
    destinations = await driver.findAll(".test-dm-dest-ws");
    assert.lengthOf(destinations, 3);
    assert.equal(await destinations[0].getText(), "August\nCurrent workspace");
    assert.isTrue(await destinations[0].matches(".test-dm-dest-ws[class*=-disabled]"));
    assert.equal(await destinations[1].getText(), "Personal");
    assert.equal(await destinations[2].getText(), "Real estate\nRequires edit permissions");
    assert.isTrue(await destinations[2].matches(".test-dm-dest-ws[class*=-disabled]"));

    // Complete the move and check that the doc is back in Personal.
    await destinations[1].doClick();
    await driver.find(".test-modal-confirm").doClick();
    await driver.findContent(".test-dm-workspace", /Personal/).doClick();
    assert.deepInclude(await getDocNames(), "Doc13");
  });
});

// Helper function to open the Add menu.
async function openAddNew() {
  await driver.find(".test-dm-add-new").click();
  await gu.findOpenMenu();
}

async function openDialog() {
  await gu.rightClick(driver.find(".test-dm-doc"));
  await gu.findOpenMenuItem("li", /Rename and set icon/).click();
  assert.isTrue(await driver.findWait(".test-modal-dialog", 100).isDisplayed());
}

async function typeName(name: string) {
  await driver.find(".test-modal-dialog #name").click();
  await gu.clearInput();
  await gu.sendKeys(name);
}

async function checkInitials(initials: string, name: string) {
  await gu.waitToPass(async () => {
    assert.equal(
      await driver.find(".test-dm-doc-icon-preview").getText(),
      initials,
      `Expected "${initials}" for "${name}"`,
    );
  }, 100);
}

async function confirm() {
  await driver.find(".test-modal-confirm").click();
  await gu.notPresent(".test-modal-dialog");
}

async function cancel() {
  await driver.find(".test-modal-cancel").click();
  await gu.notPresent(".test-modal-dialog");
}

async function checkDocName(name: string) {
  assert.equal(
    await driver.find(".test-dm-doc-name").getText(),
    name,
  );
}

async function testName(enter: string, initials: string, docName?: string) {
  await openDialog();
  await typeName(enter);
  await checkInitials(initials, enter);
  await confirm();
  assert.equal(
    await driver.find(".test-dm-doc-name").getText(),
    docName ?? enter,
  );
  await checkDocName(docName ?? enter);
}

async function testNameWithIcon(docName: string) {
  await openDialog();
  await typeName(docName);
  await driver.find(".test-dm-choose-icon").click();
  // Find span with emoji 📋
  await gu.waitForDisplay("em-emoji-picker");
  await driver.executeScript(() => {
    const emojiPicker = document.querySelector("em-emoji-picker")?.shadowRoot;
    const emojiSpan = Array.from(emojiPicker?.querySelectorAll("span") || [])
      .find(el => el.textContent === "📋")!;
    emojiSpan?.click();
  });
  await gu.waitForContent(".test-dm-doc-icon-preview", "📋");
  await confirm();
  await checkDocName(docName);
}
