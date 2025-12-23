import { UserAPI } from "app/common/UserAPI";
import { TestServer } from "test/gen-server/apiUtils";
import { GristClient, openClient } from "test/server/gristClient";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";

/**
 * Test suite for comment ownership rules.
 *
 * These tests verify that the following rules are enforced:
 * - Author of comment can edit the text of the comment (OWNER of document isn't enough)
 * - Author of comment or OWNER of document can delete the comment
 * - Full thread is deleted when the cell it's attached to is deleted
 * - Author of first comment in thread or OWNER of document can resolve the thread
 * - Timestamps cannot be modified by anyone
 * - Author identifier (userRef) cannot be modified by anyone
 *
 * Note: OWNER of document can reupload modified document, so nothing is protected from the OWNER.
 */
describe("CommentAccess2", function() {
  this.timeout("80s");
  let home: TestServer;
  testUtils.setTmpLogLevel("error");
  let owner: UserAPI;
  let editor: UserAPI;
  let docId: string;
  let wsId: number;
  let cliOwner: GristClient;
  let cliEditor: GristClient;
  let oldEnv: testUtils.EnvironmentSnapshot;

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_NOTIFIER = "test";
    home = new TestServer(this);
    await home.start(["home", "docs"]);
    const api = await home.createHomeApi("chimpy", "docs", true);
    await api.newOrg({ name: "testy", domain: "testy" });
    owner = await home.createHomeApi("chimpy", "testy", true);
    wsId = await owner.newWorkspace({ name: "ws" }, "current");
    await owner.updateWorkspacePermissions(wsId, {
      users: {
        "charon@getgrist.com": "editors",
      },
    });
    editor = await home.createHomeApi("charon", "testy", true);
  });

  beforeEach(async function() {
    docId = await owner.newDoc({ name: "doc" }, wsId);
    cliEditor = await getWebsocket(editor);
    cliOwner = await getWebsocket(owner);
    await cliEditor.openDocOnConnect(docId);
    await cliOwner.openDocOnConnect(docId);
    await owner.applyUserActions(docId, [
      ["AddRecord", "Table1", null, {}],
    ]);
    cliEditor.flush();
    cliOwner.flush();
  });

  afterEach(async function() {
    if (docId) {
      for (const cli of [cliEditor, cliOwner]) {
        try {
          await cli.send("closeDoc", 0);
        }
        catch (e) {
          // Do not worry if socket is already closed by the other side.
          if (!String(e).match(/WebSocket is not open/)) {
            throw e;
          }
        }
        await cli.close();
      }
      docId = "";
    }
  });

  after(async function() {
    const api = await home.createHomeApi("chimpy", "docs");
    await api.deleteOrg("testy");
    await home.stop();
    oldEnv.restore();
  });

  it("allows only creator of the comment to edit it", async function() {
    // Add a comment as an editor
    await comment(editor, "This is editor's comment");

    // Update the comment as editor - should work
    await updateComment(editor, 1, { text: "Edited by editor" });

    // Now try to update it as a doc owner - should fail
    await assert.isRejected(updateComment(owner, 1, { text: "Owner edit" }));

    // Check if comment still has the editor's text
    const commentData = await getComment(1);
    assert.equal(commentData.text, "Edited by editor");
  });

  it("allows comment author to delete their own comment", async function() {
    // Add a comment as editor
    await comment(editor, "Editor's comment to delete");

    // Editor should be able to delete their own comment
    await editor.applyUserActions(docId, [["RemoveRecord", "_grist_Cells", 1]]);

    // Verify comment is deleted
    const cells = await owner.getTable(docId, "_grist_Cells");
    assert.equal(cells.id.length, 0);
  });

  it("allows document owner to delete any comment", async function() {
    // Add a comment as editor
    await comment(editor, "Editor's comment");

    // Verify comment exists
    let cells = await owner.getTable(docId, "_grist_Cells");
    assert.equal(cells.id.length, 1);

    // Owner should be able to delete editor's comment
    await owner.applyUserActions(docId, [
      ["RemoveRecord", "_grist_Cells", 1],
    ]);

    // Verify comment is deleted
    cells = await owner.getTable(docId, "_grist_Cells");
    assert.equal(cells.id.length, 0);
  });

  it("prevents non-author from deleting comment", async function() {
    // Add a comment as owner
    await comment(owner, "Owner's comment");

    // Editor should NOT be able to delete owner's comment
    await assert.isRejected(editor.applyUserActions(docId, [
      ["RemoveRecord", "_grist_Cells", 1],
    ]));

    // Verify comment still exists
    const cells = await owner.getTable(docId, "_grist_Cells");
    assert.equal(cells.id.length, 1);
    const content = JSON.parse(String(cells.content[0]));
    assert.equal(content.text, "Owner's comment");
  });

  it("deletes full thread when cell is deleted as owner", async function() {
    // Add a root comment as editor
    await comment(editor, "Root comment");

    // Add a reply to the comment
    await comment(owner, "Reply to comment", 1);

    // Verify we have 2 comments (root + reply)
    let cells = await owner.getTable(docId, "_grist_Cells");
    assert.equal(cells.id.length, 2);

    // Delete the first row (root comment)
    await owner.applyUserActions(docId, [
      ["RemoveRecord", "Table1", 1],
    ]);

    // Verify all comments are deleted
    cells = await owner.getTable(docId, "_grist_Cells");
    assert.equal(cells.id.length, 0);
  });

  it("allows thread author to resolve thread", async function() {
    // Add a comment as editor (thread author)
    await comment(editor, "Thread to resolve");

    // Editor should be able to update content to mark it resolved
    await updateComment(editor, 1, { resolved: true });
  });

  it("allows document owner to resolve any thread", async function() {
    // Add a comment as editor
    await comment(editor, "Editor's thread");

    // Owner should be able to update to mark it resolved
    await updateComment(owner, 1, { resolved: true });

    // Verify thread is resolved
    const flatComment = await getComment(1);
    assert.isTrue(flatComment.resolved);
  });

  it("prevents non-author from resolving thread", async function() {
    // Add a comment as owner
    await comment(owner, "Owner's thread");

    // Editor should NOT be able to update owner's comment
    await assert.isRejected(
      updateComment(editor, 1, { resolved: true }),
    );

    // Verify thread is not resolved
    const commentData = await getComment(1);
    assert.isFalse(commentData.resolved);
  });

  it("prevents modification of timestamps in content", async function() {
    // Add a comment as editor
    await comment(editor, "Test comment");

    // Get the original timestamps
    const originalComment = await getComment(1);
    const originalTimeCreated = originalComment.timeCreated;

    // Try to modify timestamps directly - should fail with error
    await assert.isRejected(
      editor.applyUserActions(docId, [
        ["UpdateRecord", "_grist_Cells", 1, { timeCreated: 999999 }],
      ]),
      /Cannot modify timeCreated field directly/,
    );
    await assert.isRejected(
      editor.applyUserActions(docId, [
        ["UpdateRecord", "_grist_Cells", 1, { timeUpdated: 888888 }],
      ]),
      /Cannot modify timeUpdated field directly/,
    );

    // Verify timestamps haven't changed
    const updatedComment = await getComment(1);
    assert.equal(updatedComment.timeCreated, originalTimeCreated);
  });

  it("prevents modification of userRef", async function() {
    // Add a comment as editor
    await comment(editor, "Test comment");

    // Get the original userRef
    const editorRef = (await editor.getSessionActive()).user.ref || "";
    const ownerRef = (await owner.getSessionActive()).user.ref || "";
    const originalComment = await getComment(1);
    assert.equal(originalComment.userRef, editorRef);

    // Try to change userRef as the author - should fail
    await assert.isRejected(
      editor.applyUserActions(docId, [
        ["UpdateRecord", "_grist_Cells", 1, { userRef: ownerRef }],
      ]),
      /Cannot modify userRef field directly/,
    );

    // Verify userRef hasn't changed
    let updatedComment = await getComment(1);
    assert.equal(updatedComment.userRef, editorRef);

    // Try to change userRef as the owner - should also fail
    await assert.isRejected(
      owner.applyUserActions(docId, [
        ["UpdateRecord", "_grist_Cells", 1, { userRef: ownerRef }],
      ]),
      /Cannot modify userRef field directly/,
    );

    // Verify userRef still hasn't changed
    updatedComment = await getComment(1);
    assert.equal(updatedComment.userRef, editorRef);
  });

  it("allows replies to be edited by their authors only", async function() {
    // Add a root comment by owner
    await comment(owner, "Root comment");

    // Add a reply by editor
    await comment(editor, "Editor's reply", 1);

    // Editor can edit their reply
    await updateComment(editor, 2, { text: "Editor updated reply" });

    // Owner cannot edit editor's reply
    await assert.isRejected(
      updateComment(owner, 2, { text: "Owner tries to update" }),
    );

    // But owner can delete editor's reply (owner has delete permission)
    await owner.applyUserActions(docId, [
      ["RemoveRecord", "_grist_Cells", 2],
    ]);

    const finalCells = await owner.getTable(docId, "_grist_Cells");
    assert.equal(finalCells.id.length, 1);
  });

  it("allows editor to delete thread with owner replies", async function() {
    // Add a root comment by editor
    await comment(editor, "Editor's root comment");

    // Add a reply by owner
    await comment(owner, "Owner's reply", 1);

    // Verify we have 2 comments (root + reply)
    let cells = await owner.getTable(docId, "_grist_Cells");
    assert.equal(cells.id.length, 2);

    // Editor (author of root comment) should be able to delete the thread
    await editor.applyUserActions(docId, [
      ["RemoveRecord", "_grist_Cells", 1],
    ]);

    // All comments are now removed.
    cells = await owner.getTable(docId, "_grist_Cells");
    assert.equal(cells.id.length, 0);
  });

  it("allows owner to delete thread with editor replies", async function() {
    // Add a root comment by owner
    await comment(owner, "Owner's root comment");

    // Add a reply by editor
    await comment(editor, "Editor's reply", 1);

    // Verify we have 2 comments (root + reply)
    let cells = await owner.getTable(docId, "_grist_Cells");
    assert.equal(cells.id.length, 2);

    // Owner should be able to delete the thread, as any other user, and the someone's else
    // reply is auto deleted as part of the thread.
    await owner.applyUserActions(docId, [
      ["RemoveRecord", "_grist_Cells", 1],
    ]);

    // All comments are now removed.
    cells = await owner.getTable(docId, "_grist_Cells");
    assert.equal(cells.id.length, 0);
  });

  async function getWebsocket(api: UserAPI) {
    const who = await api.getSessionActive();
    return openClient(home.server, who.user.email, who.org?.domain || "docs");
  }

  async function comment(api: UserAPI, message: string, parentId?: number) {
    const row: any = {
      tableRef: await tableRef("Table1"),
      colRef: await colRef("Table1", "A"),
      rowId: 1,
      type: 1,
      root: parentId !== undefined ? false : true,
      // userRef is set automatically by the data engine
      content: JSON.stringify({
        text: message,
        mentions: [],
        sectionId: 1,
      }),
    };
    if (parentId !== undefined) {
      row.parentId = parentId;
    }
    await api.applyUserActions(docId, [
      ["AddRecord", "_grist_Cells", null, row],
    ]);
  }

  async function getComment(commentId: number) {
    const cells = await owner.getTable(docId, "_grist_Cells");
    const idx = cells.id.indexOf(commentId);
    if (idx === -1) {
      throw new Error(`Comment ${commentId} not found`);
    }
    const content = JSON.parse(String(cells.content[idx]));
    return {
      id: cells.id[idx],
      userRef: cells.userRef[idx],
      timeCreated: cells.timeCreated[idx],
      timeUpdated: cells.timeUpdated[idx],
      resolved: cells.resolved[idx],
      text: content.text,
    };
  }

  async function updateComment(api: UserAPI, commentId: number, updates: { text?: string, resolved?: boolean }) {
    // Read current state
    const cells = await owner.getTable(docId, "_grist_Cells");
    const idx = cells.id.indexOf(commentId);
    if (idx === -1) {
      throw new Error(`Comment ${commentId} not found`);
    }

    const tableUpdates: any = {};

    // Handle table-level fields
    if ("resolved" in updates) {
      tableUpdates.resolved = updates.resolved;
    }

    // Handle content field (text)
    if ("text" in updates) {
      const currentContent = JSON.parse(String(cells.content[idx]));
      const newContent = { ...currentContent, text: updates.text };
      tableUpdates.content = JSON.stringify(newContent);
    }

    // Apply the update
    await api.applyUserActions(docId, [
      ["UpdateRecord", "_grist_Cells", commentId, tableUpdates],
    ]);
  }

  async function tableRef(tableId: string) {
    const tables = await owner.getTable(docId, "_grist_Tables");
    return tables.id[tables.tableId.findIndex(id => id === tableId)];
  }

  async function colRef(tableId: string, colId: string) {
    const tRef = await tableRef(tableId);
    const columns = await owner.getTable(docId, "_grist_Tables_column");
    return columns.id[columns.colId.findIndex(
      (val, idx) => val === colId && tRef === columns.parentId[idx])
    ];
  }
});
