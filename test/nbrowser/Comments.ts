import { TableColValues } from "app/common/DocActions";
import { UserAPIImpl } from "app/common/UserAPI";
import { arrayRepeat } from "app/plugin/gutil";
import * as gu from "test/nbrowser/gristUtils";
import { modKey, Session } from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key, WebElement } from "mocha-webdriver";
let docId: string;
let MODKEY: string;
let session: Session;
let currentApi: UserAPIImpl;
let ownerApi: UserAPIImpl;

describe("Comments", function() {
  this.timeout("8m");
  const cleanup = setupTestSuite();
  afterEach(() => gu.checkForErrors());
  const chimpy = gu.translateUser("user1");
  const kiwi = gu.translateUser("user3");
  const notification = ".test-draft-notification";
  gu.bigScreen("big");

  before(async function() {
    session = await gu.session().teamSite.login();
    MODKEY = await modKey();
    currentApi = session.createHomeApi();
    ownerApi = currentApi;
  });

  it("should not render markdown on edits", async function() {
    // Create a new document and add a comment.
    docId = (await session.tempShortDoc(cleanup, "Hello.grist")).id;
    await gu.getCell("A", 1).click();
    await openCommentsWithKey();
    await waitForInput();

    const typeSomeMarkdown = async () => {
      await gu.sendKeys("# Heading"); // This is block level markdown, so it should be rendered as h1.
      await shiftEnter();
      await gu.sendKeys("**bold**");
      await shiftEnter();
      await gu.sendKeys("*italic*");
      await shiftEnter();
      await gu.sendKeys("[Grist](https://gristlabs.com)");

      // And mention someone.
      await shiftEnter();
      await shiftEnter();

      await gu.sendKeys("Hello @");
      await selectUser(/Chimpy/);
    };

    // Save the comment.
    await typeSomeMarkdown();
    await enter();

    // Make sure we see the comment rendered properly.

    const assertRenderedOk = async (comment: WebElement) => {
      // First just plain text.
      assert.equal(
        await comment.find(".test-discussion-comment-text").getText(),
        "Heading\nbold italic\nGrist\nHello @Chimpy",
      );

      // Second, the dom is actually rendered as html.
      assert.equal(await comment.find("h1").getText(), "Heading");
      assert.equal(await comment.find("strong").getText(), "bold");
      assert.equal(await comment.find("em").getText(), "italic");
      assert.equal(await comment.find("a.grist-mention").getText(), "@Chimpy");
      assert.equal(await comment.find("a:not(.grist-mention)").getAttribute("href"), `https://gristlabs.com/`);
      assert.equal(await comment.find("a:not(.grist-mention)+span").getText(), "Grist");
    };

    await assertRenderedOk(await findComment(0));
    // Now edit that comment
    await openCommentMenu(0);
    await clickMenuItem("Edit");
    await waitForInput("edit");

    // And make sure we see markdown text, but the mention is actually a link rendered as before.
    assert.equal(
      await getEditorText("edit"),
      "# Heading\n**bold**\n*italic*\n[Grist](https://gristlabs.com)\n\nHello @Chimpy",
    );
    assert.equal(await getEditor("edit").find("a.grist-mention").getText(), "@Chimpy");
    // Make sure we don't have h1, strong or em tags there.
    for (const tag of ["h1", "strong", "em"]) {
      assert.isFalse(await getEditor("edit").find(tag).isPresent(), `Should not have ${tag} tag in the editor`);
    }

    // Save it once again and make sure it is rendered the same way.
    await enter();
    await assertRenderedOk(await findComment(0));

    // Sanity check that replies also work the same way.
    await waitForInput("add");
    await typeSomeMarkdown();
    await enter();
    await assertRenderedOk(await getReply(0, 0));
  });

  it("should open the popup by using anchor link", async function() {
    // Create a new document and add a comment.
    docId = (await session.tempShortDoc(cleanup, "Hello.grist")).id;
    await gu.getCell("A", 1).click();
    await openCommentsWithKey();
    await waitForInput();
    await gu.sendKeys("Hello from Chimpy");
    await enter();
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();

    // Copy the anchor link to this cell.
    let anchor = await gu.getAnchor();

    // Change its type to the a4 (reserved now for the comments popup).
    anchor = anchor.replace(/#a\d+/, "#a4");

    // Now open this link.
    await driver.get(anchor);

    // We should see the comments popup.
    await gu.waitForAnchor();
    await waitForPopup("filled");

    // Make sure we see the comment.
    assert.equal(await readComment(0), "Hello from Chimpy");

    // Make sure it also works via navigation.
    await session.loadDocMenu("/o/docs");
    await driver.get(anchor);
    await gu.waitForAnchor();
    await waitForPopup("filled");
    assert.equal(await readComment(0), "Hello from Chimpy");
  });

  it("should open the popup by using anchor link without p", async function() {
    // Create a new document and add a comment.
    docId = (await session.tempShortDoc(cleanup, "Hello.grist")).id;

    // Add new table, to make it the first one.
    await gu.addNewTable("Apples");
    // Add new page with Table2, it will be the second one.
    await gu.addNewPage("Table", "Table1");
    // Remove the first page.
    await gu.removePage("Table1");

    // Now copy the anchor link
    await gu.openPage("New page");
    await gu.getCell("A", 1).click();
    await openCommentsWithKey();
    await waitForInput();
    await gu.sendKeys("Hello from Chimpy");
    await enter();
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();

    // Copy the anchor link to this cell.
    let anchor = await gu.getAnchor();

    // Change its type to the a4 (reserved now for the comments popup).
    anchor = anchor.replace(/#a\d+/, "#a4");
    // Remove the 'p' parameter.
    anchor = anchor.replace(/\/p\/\d+/, "");

    // Now open this link.
    await driver.get("about:blank"); // to make sure we are not reusing the same page
    await driver.sleep(100);
    await driver.get(anchor);

    // We should see the comments popup.
    await gu.waitForAnchor();
    await gu.checkForErrors();
    await waitForPopup("filled");

    // Make sure we see the comment.
    assert.equal(await readComment(0), "Hello from Chimpy");
  });

  it("viewers can see read-only comments", async function() {
    // Create a new document and add a comment.
    docId = (await session.tempShortDoc(cleanup, "Hello.grist")).id;
    await gu.getCell("A", 1).click();
    await openCommentsWithKey();
    await waitForInput();
    await gu.sendKeys("Hello from Chimpy");
    await enter();

    // Share the document with Kiwi as a viewer.
    await ownerApi.updateDocPermissions(docId, {
      users: {
        [kiwi.email]: "viewers",
      },
    });

    // Now login as viewer and check that we can see the comment.
    await asUser(kiwi);
    await gu.getCell("A", 1).click();
    await openCommentsWithKey();
    await waitForPopup("filled");
    assert.equal(await readComment(0), "Hello from Chimpy");

    // Make sure we don't see editor.
    assert.isFalse(await driver.find(".test-discussion-comment-input").isPresent());

    // Open the menu make sure we don't see edit button.
    await openCommentMenu(0);
    assert.deepEqual(await menuOptions(), ["Copy link", "Resolve", "Remove thread", "Edit"]);
    assert.deepEqual(await disabledMenuOptions(), ["Resolve", "Remove thread", "Edit"]);

    // Click on B,1
    await gu.getCell("B", 1).click();
    // Try to open comments with shortcut.
    await openCommentsWithKey();
    // Wait a bit (as this is async).
    await driver.sleep(100);
    // Make sure menu is not opened.
    await assertNoPopup();

    // Open the panel and check that we see the comment.
    await openPanel();
    assert.equal(await commentCount("panel"), 1);
    assert.equal(await readComment(0, "panel"), "Hello from Chimpy");

    // Make sure we don't see the reply button.
    assert.isFalse(await driver.find(".test-discussion-panel .test-discussion-comment-reply-button").isPresent());
    await asOwner();
  });

  it("should restore long comment", async function() {
    docId = (await session.tempShortDoc(cleanup, "Hello.grist")).id;
    await gu.getCell("A", 1).click();
    await openCommentsWithKey();
    await waitForInput("start");
    const longText = "This is long comment more than 20 letters";
    await gu.sendKeys(longText);
    // Click away for the discard popup to be showing
    await gu.getCell("B", 1).click();
    await assertNoPopup();
    // We should see the discard notification.
    assert.isTrue(await driver.findWait(notification, 100).isDisplayed());
    // Click it to undo the discard.
    await driver.find(notification).click();
    // We should see the popup once again.
    await waitForInput("start");
    // With a text in it.
    assert.equal(await getEditorText("start"), longText);
    // Notification should be gone.
    assert.isFalse(await driver.find(notification).isPresent());
    // Send this comment.
    await enter();

    // Now reply to this comment.
    const longText2 = "2" + longText;
    await waitForInput("add");
    await gu.sendKeys(longText2);

    // Click away and test that we see the reply restored.
    await gu.getCell("C", 1).click();
    await assertNoPopup();
    assert.isTrue(await driver.findWait(notification, 100).isDisplayed());
    await driver.find(notification).click();
    await waitForInput("add");
    assert.equal(await getEditorText("add"), longText2);
    assert.isFalse(await driver.find(notification).isPresent());

    // Make sure that the cursor is on the A,1.
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 1, col: 0 });
  });

  it("should strip html from comment", async function() {
    docId = (await session.tempShortDoc(cleanup, "Hello.grist")).id;
    await gu.getCell("A", 1).click();
    await openCommentsWithKey();
    await waitForInput("start");
    await gu.sendKeys("Hello from Chimpy");
    await enter();

    // Now replace the content using API.
    await gu.sendActions([
      ["UpdateRecord", "_grist_Cells", 1, { content: JSON.stringify({ text: "<b>bolded</b>" }) }],
    ]);

    // Make sure we see literal text, not html.
    assert.equal(await readComment(0), "<b>bolded</b>");
  });

  it("should add a new line by pressing shift enter", async function() {
    docId = (await session.tempShortDoc(cleanup, "Hello.grist")).id;
    await gu.getCell("A", 1).click();
    await openCommentsWithKey();
    await waitForInput("start");
    // Pressing shift enter should'n send the comment, and shouldn't add new line in rendered comment.
    await gu.sendKeys("Hello from");
    await shiftEnter();
    await gu.sendKeys("Chimpy!");
    await enter();

    // We are rendering comments like markdown, so shift enter doesn't work here. This is consistent with
    // how cell content is rendered.
    assert.equal(await readComment(0), "Hello from Chimpy!");

    // Now add a new line using shift+enter
    await waitForInput("add");
    await gu.sendKeys("Hello from");
    await shiftEnter();
    await shiftEnter();
    await gu.sendKeys("Chimpy!");
    await enter();
    assert.equal(await readReply(0, 0), "Hello from\nChimpy!");
  });

  it("should close mention box on click away", async function() {
    docId = (await session.tempShortDoc(cleanup, "Hello.grist")).id;
    await gu.getCell("A", 1).click();
    await openCommentsWithKey();
    await waitForInput("start");
    await gu.sendKeys("Testing testing @");
    await waitForMentionList();

    // The only way to accept the mention is by clicking on the item or pressing enter, everything else
    // should result with cancellation.
    await pressSend();
    // We should see exactly the same text.
    await gu.waitForMenuToClose();
    assert.equal(await readComment(0), "Testing testing @");
    assert.lengthOf(await getMentions(await findComment(0)), 0);

    // Do the same in the reply box.
    await waitForInput("add");
    await gu.sendKeys("Replying to @");
    await waitForMentionList();
    await pressSend();
    await gu.waitForMenuToClose();

    assert.equal(await readReply(0, 0), "Replying to @");
    assert.lengthOf(await getMentions(await getReply(0, 0)), 0);

    // Do the same in the edit box.
    await openCommentMenu(0);
    await clickMenuItem("Edit");
    await waitForInput("edit");

    await clearEditor("edit");
    await gu.sendKeys("Editing Editing @");
    await waitForMentionList();
    await pressButton("Save");
    assert.equal(await readComment(0), "Editing Editing @");
    assert.lengthOf(await getMentions(await findComment(0)), 0);
    await gu.waitForMenuToClose();

    // Now click away and make sure the mention box is closed.
    await waitForInput("add");
    await gu.sendKeys("Testing2 Testing2 @");
    await waitForMentionList();

    // Click on the first comment to simulate clicking away.
    await (await findComment(0)).click();
    await gu.waitForMenuToClose();
    assert.equal(await getEditorText("add"), "Testing2 Testing2 @");

    // Now test comments panel.
    await openPanel();
    // Start replying to the first comment.
    await pressReply(0, "panel");
    await waitForInput("reply");
    await gu.sendKeys("Replying to @");
    await waitForMentionList();
    await gu.getCell("A", 1).click(); // click away
    await gu.waitForMenuToClose();
    assert.equal(await getEditorText("reply"), "Replying to @");
  });

  it("should properly show my threads", async function() {
    // Invite Chimpy to the org.
    await ownerApi.updateOrgPermissions("current", {
      users: {
        [kiwi.email]: "owners",
      },
    });
    docId = (await session.tempShortDoc(cleanup, "Hello.grist")).id;

    // Add a comment to cell A,1
    await gu.getCell("A", 1).click();
    await openCommentsWithKey();
    await waitForInput("start");
    await gu.sendKeys("Hello from Chimpy");
    await enter();

    // Now as Kiwi do the same for cell A,2
    await asUser(kiwi);
    await gu.getCell("A", 2).click();
    await openCommentsWithKey();
    await waitForInput("start");
    await gu.sendKeys("Hello from Kiwi");
    await enter();
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();

    // And in A,3, but here mention Chimpy.
    await gu.getCell("A", 3).click();
    await openCommentsWithKey();
    await waitForInput("start");
    await gu.sendKeys("Kiwi mentions @Ch");
    await selectUser(/Chimpy/);
    await enter();
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();

    // Now switch my threads option, we shouldn't see Chimpy's comment
    await openPanel();
    await panelOptions({ my: true });

    assert.equal(await commentCount("panel"), 2);
    // Make sure we see Kiwi's comment.
    assert.equal(await readComment(0, "panel"), "Hello from Kiwi");
    assert.equal(await readComment(1, "panel"), "Kiwi mentions @Chimpy");

    // Now switch to Chimpy and check this setting again.
    await asUser(chimpy);
    await openPanel();
    await panelOptions({ my: true });
    assert.equal(await commentCount("panel"), 2);
    assert.equal(await readComment(0, "panel"), "Hello from Chimpy");
    assert.equal(await readComment(1, "panel"), "Kiwi mentions @Chimpy");
    await session.resetSite();
  });

  it("allows to mention users", async function() {
    // Chimpy is the owner of the org.
    docId = await session.tempNewDoc(cleanup, "Hello", { load: false });

    // Create another doc in this workspace.
    const homeWs = await ownerApi.getOrgWorkspaces(session.teamSite.orgDomain)
      .then(list => list.find(w => w.name === "Home")?.id ?? null);
    const secondDoc = await session.forWorkspace("Home").tempNewDoc(cleanup, "Hello2", { load: false });

    // Add an Charon as an Owner of the Home workspace
    const charon = gu.translateUser("user2");
    await ownerApi.updateOrgPermissions(session.teamSite.orgDomain, {
      users: {
        [charon.email]: "editors",
      },
    });
    await ownerApi.updateWorkspacePermissions(homeWs!, {
      maxInheritedRole: null,
      users: {
        [charon.email]: "owners",
      },
    });

    // Add Kiwi as a guest to the second document (he is now guest in the Home workspace, and doesn't have any
    // access to the first document).
    await ownerApi.updateDocPermissions(secondDoc, {
      users: {
        [kiwi.email]: "editors",
      },
    });

    // Break the inheritance for this document, and share it with Ham as a guest. Ham will see only collaborators, but
    // Charon and Chimpy will see other users also. Charon will see Kiwi - who is guest in this workspace, and Chimpy
    // will see Support user, who is editor in the Org (but doesn't have access to this document).
    const ham = gu.translateUser("user4");
    await ownerApi.updateDocPermissions(docId, {
      maxInheritedRole: null,
      users: {
        [ham.email]: "editors",
        [charon.email]: "editors",
      },
    });

    // Login as all users, to make sure names are stored.
    await asUser(ham);
    await asUser(kiwi, false);

    // Now we have this situation:
    // For org:
    // - Chimpy - owner
    // - Support - editor
    // - Kiwi - guest
    // - Charon - editor
    // - Ham - guest
    // For Home workspace:
    // - Chimpy - team owner (forced)
    // - Support - no access (workspace doesn't inherit from org)
    // - Kiwi - guest (editor on the second document)
    // - Charon - owner
    // - Ham - guest - (editor on first document)
    // For first document:
    // - Chimpy - owner (forced access by being owner of the org)
    // - Support - no access
    // - Kiwi - no access
    // - Charon - editor (and owner of parent resource)
    // - Ham - editor (and guest in ws)
    // For second document:
    // - Kiwi - editor (guest in ws)
    // - Chimpy - owner (forced by being owner of the org)
    // - Charon - owner (inherited from workspace)
    // - Ham - no access
    // - Support - no access

    // Now login as charon - owner of the workspace, org's guest, and document editor.
    await asUser(charon);

    // Start adding a comment to first cell.
    await gu.sendActions([
      ["AddRecord", "Table1", null, {}],
    ]);
    await gu.getCell("A", 1).click();
    await openCommentsWithKey();
    await waitForInput();
    // Send keys to mention someone
    await gu.sendKeys("Hello @");

    // Charon should see Chimpy, Kiwi, Charon, and Ham
    // - Chimpy as he is owner of the org
    // - Kiwi as he is guest in the Home workspace (but is disabled)
    // - Ham as he is an editor.
    assert.deepEqual(await readUsers(), [charon.name, kiwi.name, chimpy.name, ham.name].sort());
    // No one is disabled.
    assert.deepEqual(await disabledList(), [kiwi.name]);
    await selectUser(/Ham/);
    await waitForInput();
    await gu.sendKeys("in this doc");
    await enter();

    // Do the same for Chimpy in reply box.
    await waitForInput();
    await gu.sendKeys("Hello @");
    await selectUser(/Chimpy/);
    await gu.sendKeys("!!");
    await enter();

    // And check if we see the comment.
    assert.equal(await readComment(0), "Hello @Ham in this doc");
    assert.equal(await readReply(0, 0), "Hello @Chimpy !!");

    // Clean up.
    await asOwner();
    await session.resetSite();
  });

  it("should be able to delete tables and columns as editors", async function() {
    docId = await session.tempNewDoc(cleanup, "Hello3");
    await ownerApi.updateOrgPermissions("current", {
      users: {
        [gu.translateUser("support").email]: "editors",
      },
    });

    // It wasn't possible to delete columns or tables with comments owned by other users (as non owner).
    // Steps:
    // 1. Add comment as an owner to cell A,1
    // 2. Login as editor, and try to delete column A.
    // 3. Try to delete table.

    await gu.addNewTable("Table2");
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("1");
    await gu.getCell("A", 1).click();

    await openCommentsWithKey();
    await waitForPopup("empty");
    await waitForInput();
    await gu.sendKeys("Owners comment");
    await enter();
    await assertNoPopup();

    await asSupport();
    await gu.openPage("Table2");
    await gu.getCell("A", 1).click();
    // Remove this column.
    await gu.deleteColumn("A");
    await gu.checkForErrors();
    assert.deepEqual(await gu.getColumnNames(), ["B", "C"]);

    // Remove this table.
    await gu.removeTable("Table2");
    await gu.checkForErrors();

    // Check it was deleted from raw data.
    await driver.find(".test-tools-raw").click();
    await driver.findWait(".test-raw-data-list", 2000);
    await gu.waitForServer();
    assert.deepEqual(
      await driver.findAll(".test-raw-data-table-id", e => e.getText()),
      ["Table1"],
    );

    await asOwner();
  });

  it("should support basic comments operation", async function() {
    docId = (await session.tempDoc(cleanup, "Hello.grist", { load: false })).id;
    await asOwner();
    await gu.getCell("A", 3).click();
    await openCommentsWithKey();
    await waitForPopup("empty");
    await waitForInput();
    await gu.sendKeys("This is first comment");
    await enter();
    assert.equal(await commentCount(), 1);
    const comments = await getCommentsData();
    assert.equal(comments.length, 1);
    assert.equal(comments[0].text, "This is first comment");
    assert.equal(comments[0].nick, "Chimpy");
    assert.equal(comments[0].time, "a few seconds ago");
    await gu.getCell("A", 1).click();
    await openCommentsWithKey();
    await waitForPopup("empty");
    assert.equal(await commentCount(), 0);
    await waitForInput();
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();
  });

  it("should read comment as a different user", async function() {
    await asSupport();
    await gu.getCell("A", 3).click();
    await openCommentsWithKey();
    await waitForPopup("filled");
    const comments = await getCommentsData();
    assert.equal(comments.length, 1);
    assert.equal(comments[0].text, "This is first comment");
    assert.equal(comments[0].nick, "Chimpy");
    assert.equal(comments[0].time, "a few seconds ago");
    await gu.getCell("A", 1).click();
    await openCommentsWithKey();
    await waitForPopup("empty");
    await waitForInput("start");
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();
  });

  it("should reply as a different user", async function() {
    await gu.getCell("A", 3).click();
    await openCommentsWithKey();
    await waitForPopup("filled");
    await waitForInput();
    await gu.sendKeys("Replying from support");
    await enter();
    const replies = await getRepliesData(0);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].text, "Replying from support");
    assert.equal(replies[0].nick, "Support");
    assert.equal(replies[0].time, "a few seconds ago");
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();
  });

  it("should read reply from a different user", async function() {
    await asOwner();
    await gu.getCell("A", 3).click();
    await openCommentsWithKey();
    await waitForPopup("filled");
    const replies = await getRepliesData(0);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].text, "Replying from support");
    assert.equal(replies[0].nick, "Support");
    assert.equal(replies[0].time, "a few seconds ago");
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();
  });

  it("should support all editor buttons on empty comment editor", async function() {
    await asSupport();
    await gu.getCell("A", 2).click();
    await openCommentsWithKey();
    await waitForPopup("empty");
    // Sending escape should close the popup
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();

    // Pressing escape with filled entry should also close the popup.
    await openCommentsWithKey();
    await waitForPopup("empty");
    await gu.sendKeys("Random comment");
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();

    // Text should be empty after pressing escape.
    await gu.waitAppFocus();
    await openCommentsWithKey();
    await waitForPopup("empty");
    assert.isEmpty(await getEditorText("start"));

    // Cancel button should work
    await openCommentsWithKey();
    await waitForPopup("empty");
    await pressCancel();
    await assertNoPopup();

    // Clicking away should close the popup
    await openCommentsWithKey();
    await waitForPopup("empty");
    await gu.getCell("A", 1).click();
    await assertNoPopup();

    // Clicking away with text filled in should close without saving.
    await gu.getCell("A", 2).click();
    await openCommentsWithKey();
    await waitForPopup("empty");
    await waitForInput("start");
    await gu.sendKeys("Random comment");
    await gu.getCell("A", 1).click();
    await assertNoPopup();
    await openCommentsWithKey();
    await waitForPopup("empty");
    assert.isEmpty(await getEditorText("start"));
    await gu.sendKeys(Key.ESCAPE);

    // Clicking comment should not send the empty comment.
    await gu.getCell("A", 2).click();
    await openCommentsWithKey();
    await waitForPopup("empty");
    assert.isTrue(await isSendDisabled());
    await pressSend();
    // Empty popup should be still there.
    await waitForPopup("empty");
    // And button should be still disabled
    assert.isTrue(await isSendDisabled());
    // And we should not see any comments
    // Writing something should enable the button.
    await driver.find(".test-discussion-comment-input").click();
    await gu.sendKeys("Random comment");
    assert.isFalse(await isSendDisabled());
    // Button to send should work
    await pressSend();
    await waitForPopup("filled");
    assert.equal(await commentCount(), 1);
    assert.equal((await getCommentsData())[0].text, "Random comment");
    // Undo last comment, should be empty again.
    await gu.undo();
    await gu.getCell("A", 2).click();
    await assertNoPopup();
    await openCommentsWithKey();
    await waitForPopup("empty");
    await gu.redo();
    await gu.getCell("A", 2).click();
    await openCommentsWithKey();
    await waitForPopup("filled");
    assert.equal(await commentCount(), 1);
    assert.equal((await getCommentsData())[0].text, "Random comment");
    await gu.undo();
    await assertNoPopup();
  });

  it("should support all editor buttons on filled comment editor", async function() {
    await asOwner();

    // Add some comment
    await gu.getCell("A", 2).click();
    await openCommentsWithKey();
    await waitForPopup("empty");
    await waitForInput("start");
    await gu.sendKeys("Sample comment");
    await enter();
    await waitForPopup("filled");
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();

    // Make sure button is disabled by default
    await openCommentsWithKey();
    await waitForPopup("filled");
    await waitForInput();
    assert.isTrue(await isSendDisabled());
    await gu.sendKeys("Some text");
    assert.isFalse(await isSendDisabled());
    await clearEditor("add");
    assert.isTrue(await isSendDisabled());
    // Pressing it shouldn't do anything.
    await pressSend();
    assert.isTrue(await isSendDisabled());
    assert.equal(await commentCount(), 1);
    // Sending spaces should be not allowed
    await clearEditor("add");
    await gu.sendKeys("        ");
    assert.isTrue(await isSendDisabled());
    await pressSend();
    assert.equal(await commentCount(), 1);

    // Escape should close the popup even when not in text area
    await driver.find(".test-discussion-comment-nick").click();
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();
  });

  it("should cancel comments edit", async function() {
    await gu.getCell("A", 2).click();
    await openCommentsWithKey();
    const editComment = async () => {
      await openCommentMenu(0);
      await clickMenuItem("Edit");
      await waitForEditor("edit");
      assert.equal(await getEditorText("edit"), "Sample comment");
      await clearEditor("edit");
      await gu.sendKeys("Edited");
    };
    const checkNoChange = async () => {
      await assertNoEditor("edit");
      assert.equal(await readComment(0), "Sample comment");
    };
    // Now test if cancel works.
    await editComment();
    await pressCancel();
    await checkNoChange();

    // Now test that escape works
    await editComment();
    await gu.sendKeys(Key.ESCAPE);
    await checkNoChange();

    // Do it once again but with click away
    await editComment();
    await gu.getCell("A", 1).click();
    await gu.getCell("A", 2).click();
    await openCommentsWithKey();
    await waitForPopup();
    await checkNoChange();
    await gu.sendKeys(Key.ESCAPE);
  });

  it("should support comments edit", async function() {
    await gu.getCell("A", 2).click();
    await openCommentsWithKey();
    await waitForPopup("filled");
    await openCommentMenu(0);
    await clickMenuItem("Edit");
    await waitForEditor("edit");
    assert.equal(await getEditorText("edit"), "Sample comment");
    await clearEditor("edit");
    await gu.sendKeys("Edited");
    await enter();
    assert.equal(await readComment(0), "Edited");
  });

  it("should allow removing comment and reply", async function() {
    await asSupport();
    // Currently we have a single comment in A,2
    await gu.getCell("A", 2).click();
    await openCommentsWithKey();
    await waitForPopup("filled");
    assert.equal(await commentCount(), 1);
    // Add a reply to the edited comment.
    await waitForInput();
    await gu.sendKeys("Reply to edited comment");
    await enter();
    // Remove reply
    const revert = await gu.begin();
    await openReplyMenu(0, 0);
    await clickMenuItem("Remove");
    assert.equal(await replyCount(0), 0);
    await revert();
    await asOwner();
    // Now remove comment
    await gu.getCell("A", 2).click();
    await openCommentsWithKey();
    await waitForPopup("filled");
    assert.equal(await commentCount(), 1);
    assert.equal(await replyCount(0), 1);
    await openCommentMenu(0);
    await clickMenuItem("Remove"); // can remove as this is my thread.
    await waitForPopup("empty");
    await gu.checkForErrors();
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();
  });

  it("should mark cells with a triangle", async function() {
    await gu.getCell("A", 2).click();
    assert.isTrue(await hasComment("A", 3));
    assert.isFalse(await hasComment("A", 2));
    assert.isFalse(await hasComment("A", 1));
  });

  it("should resolve comments", async function() {
    await gu.getCell("A", 3).click();
    await openCommentsWithKey();
    await waitForPopup("filled");
    assert.equal(await commentCount(), 1);
    await openCommentMenu(0);
    await clickMenuItem("Resolve");
    await waitForPopup("empty");
  });

  it("show comments on panel", async function() {
    await openPanel();
    await panelOptions({ resolved: false });
    // We should not see any comments (there are 2 resolved);
    assert.equal(await commentCount("panel"), 0);
    assert.equal(await countText(), "0 comments");
    // Show resolved comments
    await panelOptions({ resolved: true });
    assert.equal(await commentCount("panel"), 1);
    assert.equal(await countText(), "1 comment");
    assert.isTrue(await isCommentResolved(0, "panel"));
    // Add another one
    await gu.getCell("B", 2).click();
    await openCommentsWithKey();
    await waitForPopup("empty");
    await waitForInput();
    await gu.sendKeys("B comment");
    await enter();
    assert.equal(await commentCount("panel"), 2);
    assert.equal(await countText(), "2 comments");
    assert.isTrue(await isCommentResolved(0, "panel"));
    assert.isFalse(await isCommentResolved(1, "panel"));
  });

  it("allows to open last resolved comment", async function() {
    // The first comment in the panel is resolved and we don't see option to open it.
    await openCommentMenu(0, "panel");
    assert.deepEqual(await menuOptions(), ["Remove thread"]);
    // The second comment is not resolved and we see normal options.
    await openCommentMenu(1, "panel");
    assert.deepEqual(await menuOptions(), ["Resolve", "Remove thread", "Edit"]);
    const revert = await gu.begin();
    // Resolve the second comment and check that we can see open option.
    await clickMenuItem("Resolve");
    assert.isTrue(await isCommentResolved(0, "panel"));
    assert.isTrue(await isCommentResolved(1, "panel"));

    await openCommentMenu(0, "panel");
    assert.deepEqual(await menuOptions(), ["Remove thread"]);
    await openCommentMenu(1, "panel");
    assert.deepEqual(await menuOptions(), ["Open", "Remove thread"]);
    // Open the second comment
    await clickMenuItem("Open");
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForMenuToClose();

    assert.isTrue(await isCommentResolved(0, "panel"));
    assert.isFalse(await isCommentResolved(1, "panel"));

    await revert();
  });

  it("should support basic operations on panel", async function() {
    await openPanel();
    // Edit second comment for B
    await openCommentMenu(1, "panel");
    await clickMenuItem("Edit");
    await waitForInput();
    assert.equal(await getEditorText("edit"), "B comment");
    await clearEditor("edit");
    await gu.sendKeys("B edited");
    await enter();
    await assertNoEditor("edit");
    assert.equal(await readComment(1, "panel"), "B edited");

    // Remove comment
    await openCommentMenu(1, "panel");
    await clickMenuItem("Remove");
    assert.equal(await commentCount("panel"), 1);
    assert.equal(await countText(), "1 comment");
    await gu.undo();
    assert.equal(await commentCount("panel"), 2);
    assert.equal(await countText(), "2 comments");

    // Reply to second comment
    await pressReply(1, "panel");
    await waitForEditor("reply");
    await waitForInput();
    await gu.sendKeys("Reply to B");
    await enter();
    assert.equal(await commentCount("panel"), 2);
    assert.equal(await countText(), "2 comments");
    assert.equal(await replyCount(1, "panel"), 1);
    assert.equal(await readReply(1, 0, "panel"), "Reply to B");

    // Can edit reply
    await openReplyMenu(1, 0, "panel");
    await clickMenuItem("Edit");
    await waitForEditor("edit");
    await waitForInput();
    await clearEditor("edit");
    await gu.sendKeys("Reply to B edited");
    await enter();
    assert.equal(await readReply(1, 0, "panel"), "Reply to B edited");

    // Can resolve comment
    await openCommentMenu(1, "panel");
    await clickMenuItem("Resolve");
    assert.isTrue(await isCommentResolved(0, "panel"));
    assert.isTrue(await isCommentResolved(1, "panel"));
    // And we don' see replies
    assert.equal(await replyCount(1, "panel"), 0);
    await gu.undo();

    // Can remove reply
    assert.equal(await replyCount(1, "panel"), 1);
    await openReplyMenu(1, 0, "panel");
    await clickMenuItem("Remove");
    assert.equal(await replyCount(1, "panel"), 0);
    await gu.undo();

    // Can remove comment
    assert.equal(await commentCount("panel"), 2);
    await openCommentMenu(1, "panel");
    await clickMenuItem("Remove");
    assert.equal(await commentCount("panel"), 1);
    await gu.undo();
  });

  it("should remove comments with columns and rows", async function() {
    // Add another comment in A3 (there is a resolved comment here, so we can start a new discussion)
    await gu.getCell("A", 3).click();
    await openCommentsWithKey();
    await waitForPopup("empty");
    await waitForInput("start");
    await gu.sendKeys("This is second comment");
    await enter();
    await waitForInput("add");
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();

    // We have 3 comments in total, 2 in A,3 and 1 in B,2
    const hasAComment = async () => {
      assert.equal(await readComment(0, "panel"), "This is first comment");
      assert.equal(await commentCount("panel"), 3);
    };
    const onlyB = async () => {
      assert.equal(await commentCount("panel"), 1);
      assert.equal(await countText(), "1 comment");
      assert.isFalse(await isCommentResolved(0, "panel"));
      assert.equal(await readComment(0, "panel"), "B edited");
      assert.equal(await readReply(0, 0, "panel"), "Reply to B edited");
    };
    const test = async () => {
      await hasAComment();
      await gu.deleteColumn("A");
      await gu.checkForErrors();
      await onlyB();
      await gu.undo();
      await gu.checkForErrors();
      await hasAComment();
      await gu.removeRow(3);
      await gu.checkForErrors();
      await onlyB();
      await gu.undo();
      await gu.checkForErrors();
      await hasAComment();
    };
    // Owner can remove all comments when removing columns/rows.
    await asOwner();
    await panelOptions({ resolved: true });
    await test();
    await asSupport();
    await panelOptions({ resolved: true });

    // We still can remove owner's comments, because we can remove row.
    await hasAComment();
    await gu.removeRow(3);
    await gu.checkForErrors();
    await onlyB();
    await gu.undo();

    // But we can't remove only the comment.
    await hasAComment();
    await assertThrows(() => currentApi.applyUserActions(docId, [
      ["BulkRemoveRecord", "_grist_Cells", [1]],
    ]));
    await hasAComment();
  });

  it("should remove comments with tables", async function() {
    await asOwner();
    await panelOptions({ resolved: true });
    assert.equal(await commentCount("panel"), 3);
    await panelOptions({ page: false });
    await gu.addNewTable("Table2");
    await addRow();
    await addRow();
    await addRow();
    // Still we see 3 comments
    assert.equal(await commentCount("panel"), 3);
    await gu.removeTable("Table1");
    assert.equal(await commentCount("panel"), 0);
    await gu.undo();
    assert.equal(await commentCount("panel"), 3);
    await gu.openPage("Table2");
  });

  it("should navigate between tables and rows", async function() {
    // We have 3 comments on Table1.
    // Add one on Table2
    await gu.openPage("Table2");
    await gu.getCell("B", 3).click();
    await openCommentsWithKey();
    await waitForPopup("empty");
    await waitForInput("start");
    await gu.sendKeys("Table2,B,3");
    await enter();
    assert.equal(await commentCount("panel"), 4);
    // We are at Table2, now click first comment that should navigate to Table1
    assert.equal(await gu.getActiveSectionTitle(), "TABLE2");
    await clickComment(0, "panel");
    // We should land at Table1,A,3
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 3, col: 0 });
    assert.equal(await gu.getActiveSectionTitle(), "TABLE1");
    // Now click second comment to navigate to Table1,B,2
    await clickComment(1, "panel");
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 2, col: 1 });
    assert.equal(await gu.getActiveSectionTitle(), "TABLE1");
    // Now click last comment to navigate to Table2,B,3
    await clickComment(3, "panel");
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 3, col: 1 });
    assert.equal(await gu.getActiveSectionTitle(), "TABLE2");
  });

  it("should disable Comment option on add-row", async function() {
    await gu.openPage("Table2");
    await gu.rightClick(await gu.getCell("B", 2));
    assert.equal(await gu.findOpenMenuItem("li", /Comment/).matches(".disabled"), false);
    await gu.sendKeys(Key.ESCAPE);
    await gu.rightClick(await gu.getCell("B", 4));
    assert.equal(await gu.findOpenMenuItem("li", /Comment/).matches(".disabled"), true);
  });

  it("should offer menu option to copy anchor link", async function() {
    // Add first comment to second table
    await gu.openPage("Table2");
    await addComment("B", 2, "Testing anchor link");
    await openCommentsWithMouse("B", 2);
    await waitForPopup("filled");
    await openCommentMenu(0);
    await gu.findOpenMenuItem("li", /Copy link/).click();

    await driver.findContentWait(".test-notifier-toast-message", /Link copied/, 500);
    const anchor = (await gu.getTestState()).clipboard!;
    assert.isOk(anchor);
    await gu.onNewTab(async () => {
      await driver.get(anchor);
      await gu.waitForDocToLoad();
      await waitForPopup("filled");
      assert.equal(await commentCount(), 1);
      assert.equal((await getCommentsData())[0].text, "Testing anchor link");
    });
  });

  it("should hide comments from hidden columns", async function() {
    // Start with a fresh doc.
    docId = (await session.tempNewDoc(cleanup, "Hello.grist", { load: false }));
    await asOwner();
    // Add 3 rows to it with numbers 1,2,3.
    await currentApi.applyUserActions(docId, [["BulkAddRecord", "Table1", arrayRepeat(3, null), {
      A: [1, 2, 3],
    }]]);
    const revert = await gu.beginAclTran(ownerApi, docId);
    // Make column a visible only to owner.
    await currentApi.applyUserActions(docId, [
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "A" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "none",
      }],
    ]);
    await session.loadDoc(`/doc/${docId}`); // we are forced reload, so make sure it is over.
    // Add one comment int in column A, 1.
    await panelOptions({ page: false, resolved: true });
    await addComment("A", 1);
    await addComment("B", 2);
    assert.equal(await commentCount("panel"), 2);
    // See if we see comments as editor
    await asSupport();
    assert.equal(await commentCount("panel"), 1);
    // Go to owner and see if we see all comments
    await asOwner();
    assert.equal(await commentCount("panel"), 2);
    await asSupport();
    // Make sure client don't see hidden comments.
    assert.deepEqual(await readClientComments(), [
      "CENSORED",
      "B,2",
    ]);
    assert.deepEqual(await readApiComments(), [
      "CENSORED",
      "B,2",
    ]);
    await asOwner();
    await revert();
  });

  it("should hide comments from hidden tables", async function() {
    const revert = await gu.beginAclTran(ownerApi, docId);
    // Make column a visible only to owner.
    await currentApi.applyUserActions(docId, [
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "none",
      }],
      ["AddEmptyTable", "Public"],
      ["BulkAddRecord", "Public", arrayRepeat(3, null), {}],
    ]);
    await session.loadDoc(`/doc/${docId}`); // we are forced reload, so make sure it is over.
    await panelOptions({ page: false, resolved: true });
    // Add 2 comments to public table.
    await gu.openPage("Public");
    await gu.waitAppFocus();
    await addComment("C", 2);
    await gu.openPage("Table1");
    await gu.waitAppFocus();
    // Owner sees 3 comments.
    assert.equal(await commentCount("panel"), 3);
    await asSupport();
    // Editor sees 1 comment
    assert.equal(await commentCount("panel"), 1);
    assert.equal(await readComment(0, "panel"), "C,2");
    assert.deepEqual(await readClientComments(), [
      "CENSORED",
      "CENSORED",
      "C,2",
    ]);
    assert.deepEqual(await readApiComments(), [
      "CENSORED",
      "CENSORED",
      "C,2",
    ]);
    await asOwner();
    await revert();
    // Make sure we see all comments once again.
    await asSupport();
    await panelOptions({ page: false, resolved: true });
    assert.equal(await commentCount("panel"), 3);
    await asOwner();
  });

  it("should hide comments from hidden rows", async function() {
    const revert = await gu.beginAclTran(ownerApi, docId);
    // Hide first row from table1.
    await currentApi.applyUserActions(docId, [
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER and rec.A == 1", permissionsText: "none",
      }],
    ]);
    await session.loadDoc(`/doc/${docId}`); // we are forced reload, so make sure it is over.
    // Owner sees 3 comments.
    await panelOptions({ resolved: true, page: false, my: false });
    assert.equal(await commentCount("panel"), 3);
    await asSupport();
    await panelOptions({ resolved: true, page: false, my: false });
    // Editor sees 2 comment
    assert.equal(await commentCount("panel"), 2);
    assert.equal(await readComment(0, "panel"), "B,2");
    assert.equal(await readComment(1, "panel"), "C,2");
    await assertClientComments([
      "CENSORED",
      "B,2",
      "C,2",
    ]);
    // Hide B comment (it is on Table1)
    await gu.getCell("A", 1).click();
    await gu.enterCell("1");
    // We should see only 1 comment as editor (since second row is hidden now)
    assert.equal(await commentCount("panel"), 1);
    assert.equal(await readComment(0, "panel"), "C,2");
    await assertClientComments([
      "CENSORED",
      "CENSORED",
      "C,2",
    ]);
    // Undo last row, so we should see 2 comments again.
    await ownerApi.applyUserActions(docId, [[
      "UpdateRecord", "Table1", 2, { A: 2 },
    ]]);
    await gu.waitForServer();
    assert.equal(await commentCount("panel"), 2);
    assert.equal(await readComment(0, "panel"), "B,2");
    assert.equal(await readComment(1, "panel"), "C,2");
    await assertClientComments([
      "CENSORED",
      "B,2",
      "C,2",
    ]);
    await asOwner();
    await revert();
    // Make sure we see all comments once again.
    await asSupport();
    assert.equal(await commentCount("panel"), 3);
    await asOwner();
  });

  it("should hide for censored cells", async function() {
    // Clear all comments first
    await clearComments();
    const revert = await gu.beginAclTran(ownerApi, docId);
    // Censor B if A == 0 for everyone
    await currentApi.applyUserActions(docId, [
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "B" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "rec.A == 0", permissionsText: "none",
      }],
    ]);
    await session.loadDoc(`/doc/${docId}`); // we are forced reload, so make sure it is over.
    // Make sure we don't see any comments yet.
    assert.equal(await commentCount("panel"), 0);
    await addComment("B", 1, "First");
    await addComment("B", 1, "Second");
    await addComment("B", 2, "Visible");
    assert.equal(await commentCount("panel"), 2);
    await assertClientComments([
      "First",
      "Second",
      "Visible",
    ]);
    // Now censor column B in the first row.
    await gu.getCell("A", 1).click();
    await gu.enterCell("0");
    await gu.getCell("B", 1).click();
    // Test that all comments from B,1 are hidden.
    assert.equal(await commentCount("panel"), 1);
    await assertClientComments([
      "CENSORED",
      "CENSORED",
      "Visible",
    ]);
    // Make sure also that we don't see triangle.
    assert.isFalse(await hasComment("B", 1));
    assert.isTrue(await hasComment("B", 2));
    // Try to open comments popup for this cell.
    await openCommentsWithKey();
    await assertNoPopup();
    await openCommentsWithMouse("B", 1);
    await assertNoPopup();

    // Now show them
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus();
    await gu.enterCell("2");
    await gu.getCell("B", 1).click();
    await gu.waitAppFocus();
    assert.equal(await commentCount("panel"), 2);
    await assertClientComments([
      "First",
      "Second",
      "Visible",
    ]);
    assert.isTrue(await hasComment("B", 1));
    assert.isTrue(await hasComment("B", 2));
    // Make sure that popup works
    await assertNoPopup();
    await openCommentsWithKey();
    await waitForPopup("any");
    await gu.sendKeys(Key.ESCAPE);
    await assertNoPopup();
    await openCommentsWithMouse("B", 1);
    await waitForPopup("any");
    // Read comments from popup
    assert.equal(await commentCount("popup"), 1);
    // Make sure text for comments are ok.
    assert.equal(await readComment(0, "popup"), "First");
    assert.equal(await readReply(0, 0, "popup"), "Second");
    await gu.sendKeys(Key.ESCAPE);
    await asOwner();
    await revert();
  });

  it("should not send uncensored comments", async function() {
    // Clear all comments first
    await clearComments();
    const revertAcl = await gu.beginAclTran(ownerApi, docId);
    // Censor B if A == 1 for everyone
    await currentApi.applyUserActions(docId, [
      // Censor B column for editor
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "B" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: 'rec.B == "secret" and user.Access != OWNER', permissionsText: "-R",
      }],
      // Hide rows when A === 0 for non owners
      ["AddRecord", "_grist_ACLResources", -2, { tableId: "Table1", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -2, aclFormula: "rec.A == 0 and user.Access != OWNER", permissionsText: "-R",
      }],
    ]);
    await session.loadDoc(`/doc/${docId}`); // we are forced reload, so make sure it is over.
    // Make sure we don't see any comments yet.
    assert.equal(await commentCount("panel"), 0);
    await addComment("B", 1, "Secret");
    assert.equal(await commentCount("panel"), 1);
    assert.equal(await gu.getGridRowCount(), 3 + 1);
    await asSupport();

    // We see this comment for now
    assert.equal(await commentCount("panel"), 1);
    assert.equal(await readComment(0, "panel"), "Secret");

    // Now censor column B.
    await ownerApi.applyUserActions(docId, [[
      "UpdateRecord", "Table1", 1, { B: "secret" },
    ]]);
    await gu.waitForServer();
    assert.equal(await commentCount("panel"), 0);
    await assertClientComments([
      "CENSORED",
    ]);

    // Now hide row 1 for non owners
    await ownerApi.applyUserActions(docId, [[
      "UpdateRecord", "Table1", 1, { A: 0 },
    ]]);
    await gu.waitForServer();
    assert.equal(await commentCount("panel"), 0);
    await assertClientComments([
      "CENSORED",
    ]);
    assert.equal(await gu.getGridRowCount(), 2 + 1);

    // Now reveal row 1
    await ownerApi.applyUserActions(docId, [[
      "UpdateRecord", "Table1", 1, { A: 1 },
    ]]);
    await gu.waitForServer();
    assert.equal(await commentCount("panel"), 0);
    await assertClientComments([
      "CENSORED",
    ]);
    assert.equal(await gu.getGridRowCount(), 3 + 1);
    // And make cell in column B visible

    await ownerApi.applyUserActions(docId, [[
      "UpdateRecord", "Table1", 1, { B: "visible" },
    ]]);
    await gu.waitForServer();
    assert.equal(await commentCount("panel"), 1);
    await assertClientComments([
      "Secret",
    ]);
    await asOwner();
    await revertAcl();
  });

  it("should filter comments from actions", async function() {
    // Clear all comments first
    await clearComments();
    const revertAcl = await gu.beginAclTran(ownerApi, docId);
    // Censor B if A == 1 for everyone
    await currentApi.applyUserActions(docId, [
      // Censor B column for editor when A === 0
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "B" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "rec.A == 0 and user.Access != OWNER", permissionsText: "-R",
      }],
    ]);
    // Open document as editor
    await asOwner();
    // Add some comments as owner for column B
    await ownerApi.applyUserActions(docId, [
      ["BulkUpdateRecord", "Table1", [1, 2, 3], { A: [0, 0, 0] }],
      ["BulkAddRecord", "_grist_Cells", arrayRepeat(3, null), {
        tableRef: [1, 1, 1],
        rowId: [1, 2, 3],
        colRef: [3, 3, 3],
        type: arrayRepeat(3, 1),
        root: arrayRepeat(3, true),
        // userRef is set automatically by the data engine
        content: [1, 2, 3].map(x => JSON.stringify({ text: `B,${x}`, userName: "Owner" })),
      }],
    ]);
    await gu.waitForServer();
    assert.isTrue(await hasComment("B", 1));
    assert.isTrue(await hasComment("B", 2));
    assert.isTrue(await hasComment("B", 3));
    await assertClientComments([
      "B,1",
      "B,2",
      "B,3",
    ]);
    await asSupport();
    await assertClientComments([
      "CENSORED",
      "CENSORED",
      "CENSORED",
    ]);
    await ownerApi.applyUserActions(docId, [
      ["BulkAddRecord", "_grist_Cells", arrayRepeat(3, null), {
        tableRef: [1, 1, 1],
        rowId: [1, 2, 3],
        colRef: [3, 3, 3],
        // userRef is set automatically by the data engine
        content: [1, 2, 3].map(x => JSON.stringify({ text: `B,${x}`, userName: "Owner" })),
      }],
    ]);
    await assertClientComments([
      "CENSORED",
      "CENSORED",
      "CENSORED",
      "CENSORED",
      "CENSORED",
      "CENSORED",
    ]);
    await asOwner();
    await revertAcl();
  });

  it("should filter api comments from actions", async function() {
    // Clear all comments first
    await clearComments();
    const revertAcl = await gu.beginAclTran(ownerApi, docId);
    // Censor B if A == 1 for everyone
    await currentApi.applyUserActions(docId, [
      // Hide Table1 for non owners
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "-R",
      }],
      // Hide rows when A === 99 for non owners on Table2
      ["AddRecord", "_grist_ACLResources", -2, { tableId: "Public", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -2, aclFormula: "rec.A == 99 and user.Access != OWNER", permissionsText: "-R",
      }],
      // Hide column C on Table2 for non owners
      ["AddRecord", "_grist_ACLResources", -3, { tableId: "Public", colIds: "C" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -3, aclFormula: "user.Access != OWNER", permissionsText: "-R",
      }],
    ]);
    // Add some initial comments
    await gu.openPage("Table1");
    await addComment("C", 1, "First");
    await gu.openPage("Public");
    await addComment("B", 1, "Second");
    await addComment("C", 1, "Third");
    assert.deepEqual(await readApiComments(ownerApi), [
      "First",
      "Second",
      "Third",
    ]);
    // Switch to editor
    await asSupport();
    await assertClientComments([
      "CENSORED", // Table1 is hidden completely
      "Second",
      "CENSORED", // Column C is hidden for non owners
    ]);
    await ownerApi.applyUserActions(docId, [
      ["AddRecord", "Table1", null, {}], // add row with id 4 for Table1
      await addCommentAction("Table1", "A", 4, "Third2"),
    ]);
    await assertClientComments([
      "CENSORED",
      "Second",
      "CENSORED",
      "CENSORED", // Table1,A,4
    ]);
    await ownerApi.applyUserActions(docId, [
      ["AddRecord", "Public", null, {}],
      await addCommentAction("Public", "A", 4, "Forth"),
      await addCommentAction("Public", "A", 4, "Fifth"),
    ]);
    await gu.waitForServer();
    await assertClientComments([
      "CENSORED",
      "Second",
      "CENSORED",
      "CENSORED",
      "Forth", // New comment added just now
      "Fifth", // New comment added just now
    ]);
    await ownerApi.applyUserActions(docId, [
      ["BulkUpdateRecord", "_grist_Cells", [5, 6], {
        content: [
          JSON.stringify({ text: `Forth-updated`, userName: "Owner" }),
          JSON.stringify({ text: `Fifth-updated`, userName: "Owner" }),
        ],
      }],
    ]);
    await gu.waitForServer();
    await assertClientComments([
      "CENSORED",
      "Second",
      "CENSORED",
      "CENSORED",
      "Forth-updated",
      "Fifth-updated",
    ]);
    // Add some comments to hidden column
    await ownerApi.applyUserActions(docId, [
      ["AddRecord", "Public", null, {}], // add row with id 5 for Public
      await addCommentAction("Public", "C", 5, "HiddenC"),
    ]);
    await gu.waitForServer();
    await assertClientComments([
      "CENSORED",
      "Second",
      "CENSORED",
      "CENSORED",
      "Forth-updated",
      "Fifth-updated",
      "CENSORED", // HiddenC
    ]);
    // Hide 4th row, by setting it to 0
    await gu.getCell("A", 4).click();
    await gu.enterCell("99");
    await assertClientComments([
      "CENSORED",
      "Second",
      "CENSORED",
      "CENSORED",
      "CENSORED", // those comments are censored now
      "CENSORED", // because 1st row is == 0
      "CENSORED", // HiddenC
    ]);
    // Reveal it using owner API.
    await ownerApi.applyUserActions(docId, [[
      "UpdateRecord", "Public", 4, { A: 3 },
    ]]);
    await gu.waitForServer();
    await assertClientComments([
      "CENSORED",
      "Second",
      "CENSORED",
      "CENSORED",
      "Forth-updated",
      "Fifth-updated",
      "CENSORED", // HiddenC
    ]);
    // Check that in database everything is ok.
    assert.deepEqual(await readApiComments(ownerApi), [
      "First",
      "Second",
      "Third",
      "Third2",
      "Forth-updated",
      "Fifth-updated",
      "HiddenC",
    ]);
    await asOwner();
    await revertAcl();
  });

  it("should reject updates to censored comments", async function() {
    // Clear all comments first
    await clearComments();
    const revertAcl = await gu.beginAclTran(ownerApi, docId);
    await currentApi.applyUserActions(docId, [
      // Hide Table1 rows with A == 1 for editors
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "rec.A == 1 and user.Access != OWNER", permissionsText: "-R",
      }],
      // Hide column C for non owners
      ["AddRecord", "_grist_ACLResources", -2, { tableId: "Public", colIds: "C" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -2, aclFormula: "user.Access != OWNER", permissionsText: "-R",
      }],
      // Take schema access from editors.
      ["AddRecord", "_grist_ACLResources", -3, { tableId: "*", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -3, aclFormula: "user.Access == EDITOR", permissionsText: "-S",
      }],
    ]);
    // Add first comment to first table
    await gu.openPage("Table1");
    await addComment("A", 1, "From owner");
    await gu.getCell("A", 1).click();
    await gu.waitAppFocus(true);
    await gu.enterCell("1");
    // Switch to editor
    await asSupport();
    await assertClientComments([
      "CENSORED",
    ]);
    // Try various ways to update/remove hidden comment.
    await assertThrows(() => currentApi.applyUserActions(docId, [
      ["UpdateRecord", "_grist_Cells", 1, { content: JSON.stringify({ text: "Updated", userName: "Editor" }) }],
    ]));
    await assertThrows(() => currentApi.applyUserActions(docId, [
      ["BulkUpdateRecord", "_grist_Cells", [1], { content: [JSON.stringify({ text: "Updated", userName: "Editor" })] }],
    ]));
    await assertThrows(() => currentApi.applyUserActions(docId, [
      ["BulkRemoveRecord", "_grist_Cells", [1]],
    ]));
    await assertThrows(async () => await currentApi.applyUserActions(docId, [
      await addCommentAction("Public", "C", 1, "HiddenC"),
    ]));
    await assertClientComments([
      "CENSORED",
    ]);
    await asOwner();
    await revertAcl();
  });

  it("should reject removals from someone else", async function() {
    // Clear all comments first
    await clearComments();
    // Add first comment to first table
    await gu.openPage("Table1");
    await addComment("A", 1, "From owner");
    // Switch to editor
    await asSupport();
    await assertClientComments([
      "From owner",
    ]);
    // Try to remove this comment.
    await openCommentMenu(0, "panel");
    await clickMenuItem("Remove");
    // This will be a noop since button is disabled.
    await assertClientComments([
      "From owner",
    ]);
    // Can't remove comments (we are not owner)
    await assertThrows(() => currentApi.applyUserActions(docId, [
      ["RemoveRecord", "_grist_Cells", 1],
    ]));
  });

  it("should allow owner to remove any comment", async function() {
    // Clear all comments first
    await clearComments();
    await gu.openPage("Table1");

    // Editor adds a comment
    await asSupport();
    await addComment("A", 1, "From editor");
    await assertClientComments([
      "From editor",
    ]);

    // Switch to owner and verify they can see the comment
    await asOwner();
    assert.equal(await commentCount("panel"), 1);
    assert.equal(await readComment(0, "panel"), "From editor");

    // Owner should be able to remove editor's comment via UI
    await openCommentMenu(0, "panel");
    await clickMenuItem("Remove thread");
    await gu.waitForServer();

    // Verify comment is deleted
    assert.equal(await commentCount("panel"), 0);
    await assertClientComments([]);
  });

  it("should allow owner to resolve any thread", async function() {
    // Clear all comments first
    await clearComments();
    await gu.openPage("Table1");

    // Editor adds a comment
    await asSupport();
    await addComment("A", 1, "Thread from editor");
    await assertClientComments([
      "Thread from editor",
    ]);

    // Switch to owner and verify they can see the comment
    await asOwner();
    await openPanel();
    await panelOptions({ resolved: false });
    assert.equal(await commentCount("panel"), 1);
    assert.equal(await readComment(0, "panel"), "Thread from editor");

    // Owner should be able to resolve editor's thread via UI
    await openCommentMenu(0, "panel");
    await clickMenuItem("Resolve");
    await gu.waitForServer();

    // Verify comment is resolved (not visible by default with resolved: false)
    assert.equal(await commentCount("panel"), 0);

    // Enable showing resolved comments to verify it's still there
    await panelOptions({ resolved: true });

    // Now we should see the resolved comment
    assert.equal(await commentCount("panel"), 1);
    assert.equal(await readComment(0, "panel"), "Thread from editor");

    // Verify the comment is marked as resolved
    assert.isTrue(await isCommentResolved(0, "panel"));
  });
});

async function assertClientComments(comments: string[]) {
  assert.deepEqual(await readClientComments(), comments);
  assert.deepEqual(await readApiComments(), comments);
}

async function clearComments() {
  const dList = await ownerApi.getTable(docId, "_grist_Cells");
  await ownerApi.applyUserActions(docId, [
    ["BulkRemoveRecord", "_grist_Cells", dList.id],
  ]);
  await gu.waitForServer();
}

async function addComment(col: string, row: number, text?: string) {
  await gu.getCell(col, row).click();
  await openCommentsWithKey();
  await waitForPopup("any");
  await waitForInput();
  await gu.sendKeys(text ?? `${col},${row}`);
  await enter();
  await gu.waitForServer();
  await gu.sendKeys(Key.ESCAPE);
  await assertNoPopup();
}

async function addCommentAction(tableId: string, col: string, row: number, text?: string) {
  const tables = await ownerApi.getTable(docId, "_grist_Tables");
  const tableRef = tables.id[tables.tableId.findIndex(id => id === tableId)];
  const columns = await ownerApi.getTable(docId, "_grist_Tables_column");
  const colRef = columns.id[columns.colId.findIndex(
    (val, idx) => val === col && tableRef === columns.parentId[idx])
  ];
  return ["AddRecord", "_grist_Cells", null, {
    tableRef,
    rowId: row,
    type: 1,
    root: true,
    colRef,
    content: JSON.stringify({ text: text ?? `${tableId},${col},${row}`, userName: "Owner" }),
  }];
}

async function countText() {
  return await driver.find(".test-discussion-comment-count").getText();
}

async function panelOptions(options: {
  my?: boolean,
  page?: boolean,
  resolved?: boolean
}) {
  async function sync(state: boolean, el: WebElement) {
    if (state && !await el.getAttribute("checked")) {
      await el.click();
    } else if (!state && await el.getAttribute("checked")) {
      await el.click();
    }
  }
  await driver.findWait(".test-discussion-panel-menu", 1000).click();
  await driver.findWait(".grist-floating-menu", 100);
  if (options.my !== undefined) {
    await sync(options.my, await driver.find(`.test-discussion-my-threads`));
  }
  if (options.page !== undefined) {
    await sync(options.page, await driver.find(`.test-discussion-only-page`));
  }
  if (options.resolved !== undefined) {
    await sync(options.resolved, await driver.find(`.test-discussion-show-resolved`));
  }
  await gu.sendKeys(Key.ESCAPE);
}

async function hasComment(col: string, row: number) {
  return (await gu.getCell(col, row).getAttribute("class")).includes("field-with-comments");
}

async function openPanel() {
  await driver.findWait(".test-open-discussion", 1000).click();
  await driver.sleep(500);
}

function _mapCommentsToText(data: any) {
  return (data).sort((a: any, b: any) => a.id - b.id).map((r: any) => {
    if (Array.isArray(r.content)) {
      assert.equal(r.userRef, "");
      return "CENSORED";
    }
    return r.content ? JSON.parse(r.content).text : "";
  });
}

async function readClientComments(): Promise<string[]> {
  return _mapCommentsToText(await readClientRecords("_grist_Cells"));
}

async function readApiComments(userApi?: UserAPIImpl): Promise<string[]> {
  function records(rows: TableColValues) {
    // Convert column representation to record representation
    const list = [];
    for (let i = 0; i < rows.id.length; i++) {
      const record: any = {};
      for (const key of Object.keys(rows)) {
        record[key] = rows[key][i];
      }
      list.push(record);
    }
    return list;
  }
  const docApi = (userApi ?? currentApi).getDocAPI(docId);
  const rows = await docApi.getRows("_grist_Cells");
  return _mapCommentsToText(records(rows));
}

async function readClientRecords(tableId: string): Promise<any[]> {
  const data = await driver.executeScript(
    function(tab: any) {
      return (window as any).gristDocPageModel.gristDoc.get()
        .docData.getMetaTable(tab).getRecords();
    }, tableId);
  return data as any[];
}

function waitForEditor(which: EditorType) {
  const container = driver.findWait(`.test-discussion-editor-${which}`, 100);
  return container;
}

async function menuOptions() {
  return await gu.findOpenMenuAllItems("li", e => e.getText());
}

/**
 * Gets disabled items from mention list.
 */
async function disabledMenuOptions() {
  const menuItems = await gu.findOpenMenuAllItems("li", async e =>
    await e.matches(".disabled") ? await e.getText() : "",
  );
  return menuItems.filter(Boolean);
}

async function clickMenuItem(command: "Edit" | "Remove" | "Remove thread" | "Reply" | "Resolve" | "Open") {
  const menu = await driver.findWait(".grist-floating-menu", 100);
  const item = await menu.findContent("li", command);
  await item.click();
  await gu.waitForServer();
}

async function openCommentMenu(commentIndex: number, where: Place = "popup") {
  const menu = await (await findComment(commentIndex, where)).find(".test-discussion-comment-menu");
  await menu.click();
  await driver.findWait(".grist-floating-menu", 100);
}

async function getReply(commentIndex: number, replyIndex: number, where: Place = "popup") {
  const comment = await findComment(commentIndex, where);
  const reply = await comment.findAll(`.test-discussion-reply`);
  return reply[replyIndex];
}

async function readReply(commentIndex: number, replyIndex: number, where: Place = "popup") {
  const data = await getRepliesData(commentIndex, where);
  const reply = data[replyIndex];
  return reply.text;
}

async function openReplyMenu(commentIndex: number, replyIndex: number, where: Place = "popup") {
  const comment = await getReply(commentIndex, replyIndex, where);
  const menu = await comment.find(".test-discussion-comment-menu");
  await menu.click();
  await driver.findWait(".grist-floating-menu", 100);
}

async function clearEditor(which: EditorType) {
  const editor = await waitForEditor(which);
  await editor.find(".test-discussion-textarea").click();
  await gu.clearInput();
}

async function pressCancel() {
  await driver.find(".test-discussion-button-Cancel").click();
}

async function isSendDisabled() {
  const value = await driver.find(".test-discussion-button-send").getAttribute("disabled");
  return value === "true";
}

async function pressSend() {
  await driver.find(".test-discussion-button-send").click();
  await gu.waitForServer();
}

async function pressButton(text: string) {
  await driver.findContent(".test-discussion-popup button", text).click();
  await gu.waitForServer();
}

type EditorType = "start" | "edit" | "reply" | "add";

function getEditor(where: EditorType) {
  return waitForEditor(where).find(".test-discussion-textarea");
}

async function getEditorText(where: EditorType) {
  return await getEditor(where).getText();
}

async function assertNoEditor(which: EditorType) {
  assert.isFalse(await driver.find(`.test-discussion-editor-${which}`).isPresent());
}

type Place = "popup" | "panel";

async function pressReply(index: number, where: Place = "popup") {
  await (await findComment(index, where)).find(".test-discussion-comment-reply-button").click();
}

async function isCommentResolved(index: number, where: Place = "popup") {
  const comment = await findComment(index, where);
  return await comment.find(".test-discussion-comment-resolved").isPresent();
}

function waitForPopup(state: "empty" | "filled" | "any" = "any") {
  if (state === "empty") {
    return driver.findWait(".test-discussion-popup .test-discussion-topic-empty", 100);
  } else if (state === "filled") {
    return driver.findWait(".test-discussion-popup .test-discussion-topic-filled", 100);
  } else {
    return driver.findWait(".test-discussion-popup .test-discussion-topic", 100);
  }
}

async function openCommentsWithKey() {
  await gu.sendKeys(Key.chord(MODKEY, Key.ALT, "m"));
}

async function openCommentsWithMouse(col: string, row: number) {
  await gu.rightClick(await gu.getCell(col, row));
  await gu.findOpenMenuItem(".test-cmd-name", /Comment/).click();
}

interface Comment {
  text: string;
  time: string;
  nick: string;
}

async function getCommentsData(where: "popup" | "panel" = "popup") {
  return await extractData(await findComments(where));
}

async function extractData(elements: WebElement[]) {
  const comments: Comment[] = [];
  for (const element of elements) {
    const text = await element.find(".test-discussion-comment-text");
    const time = await element.find(".test-discussion-comment-time");
    const nick = await element.find(".test-discussion-comment-nick");
    comments.push({
      text: await text.getText(),
      time: await time.getText(),
      nick: await nick.getText(),
    });
  }
  return comments;
}

async function readComment(index: number, where: "popup" | "panel" = "popup") {
  return (await getCommentsData(where))[index].text;
}

async function getMentions(comment: WebElement) {
  const mentionElements = await comment.findAll("span.mention", e => e.getText());
  return mentionElements.sort();
}

async function replyCount(index: number, where: "popup" | "panel" = "popup") {
  const replies = await getRepliesData(index, where);
  return replies.length;
}

async function getRepliesData(index: number, where: "popup" | "panel" = "popup") {
  const commentElements = await findComments(where);
  const comment = commentElements[index];
  if (!comment) {
    throw new Error(`Comment ${index} not found`);
  }
  const replyElements = await comment.findAll(".test-discussion-reply");
  return await extractData(replyElements);
}

async function waitForComment(where: "popup" | "panel" = "popup") {
  const container = where === "popup" ? ".test-discussion-popup" : ".test-discussion-panel";
  await driver.findWait(`${container} .test-discussion-comment`, 1000);
}

async function findComments(where: "popup" | "panel" = "popup") {
  const container = where === "popup" ? ".test-discussion-popup" : ".test-discussion-panel";
  const commentElements = await driver.findAll(`${container} .test-discussion-comment`);
  return commentElements;
}

async function findComment(index: number, where: "popup" | "panel" = "popup") {
  await waitForComment(where);
  const commentElements = await findComments(where);
  const comment = commentElements[index];
  if (!comment) {
    throw new Error(`Comment ${index} not found`);
  }
  return comment;
}

async function clickComment(index: number, where: "popup" | "panel" = "popup") {
  return (await findComment(index, where)).click();
}

async function commentCount(where: "popup" | "panel" = "popup") {
  return (await findComments(where)).length;
}

async function enter() {
  await gu.sendKeys(Key.ENTER);
  await gu.waitForServer();
}

async function shiftEnter() {
  await gu.sendKeys(Key.chord(Key.SHIFT, Key.ENTER));
}

async function asSupport() {
  await asUser("support");
}

async function asUser(data: gu.TestUser | gu.UserData, loadDoc = true) {
  let user: gu.TestUser = typeof data === "string" ? data : data.name.toLowerCase() as any;
  // If data is object, then we need to translate it to id from the enum.
  if (typeof data === "object") {
    user = Object.entries(gu.TestUserEnum).find(([k, v]) => v === data.name.toLowerCase())?.[0] as gu.TestUser;
  }
  session = await gu.session().teamSite.user(user).login();
  currentApi = session.createHomeApi();
  if (loadDoc) {
    await session.loadDoc(`/doc/${docId}`);
  }
}

async function asOwner() {
  session = await gu.session().teamSite.login();
  await session.loadDoc(`/doc/${docId}`);
  currentApi = session.createHomeApi();
  ownerApi = currentApi;
  void ownerApi;
}

async function addRow() {
  await gu.sendKeys(Key.chord(MODKEY, Key.ENTER));
  await gu.waitForServer();
}

async function assertThrows(test: () => Promise<any>) {
  try {
    await test();
  } catch (err) {
    assert.match(err.message, /Cannot access cell/);
    return;
  }
  assert.fail("Should have thrown");
}

async function waitForInput(which?: EditorType) {
  // Waits for the .test-comments-textarea to be displayed and active element.
  await gu.waitToPass(async () => {
    const input = await (which ? waitForEditor(which) : driver).find(".test-discussion-textarea");
    assert.isTrue(await input.isDisplayed());
    assert.isTrue(await input.hasFocus());
    // Wait for the access to be ready.
    assert.isTrue(await input.matches(".test-mention-textbox-ready"));
  }, 1000);
}

async function assertNoPopup() {
  await gu.waitToPass(async () => {
    assert.isFalse(await driver.find(".test-comments-popup").isPresent());
  });
}

async function readUsers() {
  await waitForMentionList();
  return (await driver.findAll(".test-mention-textbox-acitem-text", e => e.getText())).sort();
}

async function waitForMentionList() {
  await gu.findOpenMenu();
  await driver.findWait(".test-mention-textbox-acitem", 1000);
}

/**
 * Gets disabled items from mention list.
 */
async function disabledList() {
  await gu.findOpenMenu();
  const list = await driver.findAll(
    ".test-mention-textbox-acitem.test-mention-textbox-disabled .test-mention-textbox-acitem-text",
    e => e.getText());
  return list;
}

async function selectUser(usr: string | RegExp) {
  await gu.findOpenMenu();
  await driver.findContent(".test-mention-textbox-acitem-text", usr).click();
  await gu.waitForMenuToClose();
}
