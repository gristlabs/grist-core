/**
 * Tests for document and workspace permissions/ownership.
 *
 * Tests run in multiple server configurations:
 * - Merged server (home + docs in one process)
 * - Separated servers (home + docworker, requires Redis)
 * - Direct to docworker (requires Redis)
 */

import { UserAPIImpl } from "app/common/UserAPI";
import { addAllScenarios, TestContext } from "test/server/lib/docapi/scenarios";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";
import FormData from "form-data";
import fetch from "node-fetch";

describe("DocApiPermissions", function() {
  this.timeout(30000);
  testUtils.setTmpLogLevel("error");

  addAllScenarios(addPermissionsTests, "docapi-permissions");
});

function addPermissionsTests(getCtx: () => TestContext) {
  it("creator should be owner of a created ws", async function() {
    const { userApi, homeUrl } = getCtx();
    const kiwiEmail = "kiwi@getgrist.com";
    const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
    // Make sure kiwi isn't allowed here.
    await userApi.updateOrgPermissions("docs-1", { users: { [kiwiEmail]: null } });
    const kiwiApi = new UserAPIImpl(`${homeUrl}/o/docs-1`, {
      headers: { Authorization: "Bearer api_key_for_kiwi" },
      fetch: fetch as unknown as typeof globalThis.fetch,
      newFormData: () => new FormData() as any,
    });
    await assert.isRejected(kiwiApi.getWorkspaceAccess(ws1), /Forbidden/);
    // Add kiwi as an editor for the org.
    await assert.isRejected(kiwiApi.getOrgAccess("docs-1"), /Forbidden/);
    await userApi.updateOrgPermissions("docs-1", { users: { [kiwiEmail]: "editors" } });
    // Make a workspace as Kiwi, he should be owner of it.
    const kiwiWs = await kiwiApi.newWorkspace({ name: "kiwiWs" }, "docs-1");
    const kiwiWsAccess = await kiwiApi.getWorkspaceAccess(kiwiWs);
    assert.equal(kiwiWsAccess.users.find(u => u.email === kiwiEmail)?.access, "owners");
    // Delete workspace.
    await kiwiApi.deleteWorkspace(kiwiWs);
    // Remove kiwi from the org.
    await userApi.updateOrgPermissions("docs-1", { users: { [kiwiEmail]: null } });
  });

  it("creator should be owner of a created doc", async function() {
    const { userApi, homeUrl } = getCtx();
    const kiwiEmail = "kiwi@getgrist.com";
    const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
    await userApi.updateOrgPermissions("docs-1", { users: { [kiwiEmail]: null } });
    // Make sure kiwi isn't allowed here.
    const kiwiApi = new UserAPIImpl(`${homeUrl}/o/docs-1`, {
      headers: { Authorization: "Bearer api_key_for_kiwi" },
      fetch: fetch as unknown as typeof globalThis.fetch,
      newFormData: () => new FormData() as any,
    });
    await assert.isRejected(kiwiApi.getWorkspaceAccess(ws1), /Forbidden/);
    // Add kiwi as an editor of this workspace.
    await userApi.updateWorkspacePermissions(ws1, { users: { [kiwiEmail]: "editors" } });
    await assert.isFulfilled(kiwiApi.getWorkspaceAccess(ws1));
    // Create a document as kiwi.
    const kiwiDoc = await kiwiApi.newDoc({ name: "kiwiDoc" }, ws1);
    // Make sure kiwi is an owner of the document.
    const kiwiDocAccess = await kiwiApi.getDocAccess(kiwiDoc);
    assert.equal(kiwiDocAccess.users.find(u => u.email === kiwiEmail)?.access, "owners");
    await kiwiApi.deleteDoc(kiwiDoc);
    // Remove kiwi from the workspace.
    await userApi.updateWorkspacePermissions(ws1, { users: { [kiwiEmail]: null } });
    await assert.isRejected(kiwiApi.getWorkspaceAccess(ws1), /Forbidden/);
  });

  it("should allow only owners to remove a document", async function() {
    const { userApi, homeUrl } = getCtx();
    const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
    const doc1 = await userApi.newDoc({ name: "testdeleteme1" }, ws1);
    const kiwiApi = new UserAPIImpl(`${homeUrl}/o/docs-1`, {
      headers: { Authorization: "Bearer api_key_for_kiwi" },
      fetch: fetch as unknown as typeof globalThis.fetch,
      newFormData: () => new FormData() as any,
    });

    // Kiwi is editor of the document, so he can't delete it.
    await userApi.updateDocPermissions(doc1, { users: { "kiwi@getgrist.com": "editors" } });
    await assert.isRejected(kiwiApi.softDeleteDoc(doc1), /Forbidden/);
    await assert.isRejected(kiwiApi.deleteDoc(doc1), /Forbidden/);

    // Kiwi is owner of the document - now he can delete it.
    await userApi.updateDocPermissions(doc1, { users: { "kiwi@getgrist.com": "owners" } });
    await assert.isFulfilled(kiwiApi.softDeleteDoc(doc1));
    await assert.isFulfilled(kiwiApi.deleteDoc(doc1));
  });

  it("should allow only owners to rename a document", async function() {
    const { userApi, homeUrl } = getCtx();
    const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
    const doc1 = await userApi.newDoc({ name: "testrenameme1" }, ws1);
    const kiwiApi = new UserAPIImpl(`${homeUrl}/o/docs-1`, {
      headers: { Authorization: "Bearer api_key_for_kiwi" },
      fetch: fetch as unknown as typeof globalThis.fetch,
      newFormData: () => new FormData() as any,
    });

    // Kiwi is editor of the document, so he can't rename it.
    await userApi.updateDocPermissions(doc1, { users: { "kiwi@getgrist.com": "editors" } });
    await assert.isRejected(kiwiApi.renameDoc(doc1, "testrenameme2"), /Forbidden/);

    // Kiwi is owner of the document - now he can rename it.
    await userApi.updateDocPermissions(doc1, { users: { "kiwi@getgrist.com": "owners" } });
    await assert.isFulfilled(kiwiApi.renameDoc(doc1, "testrenameme2"));

    await userApi.deleteDoc(doc1);
  });
}
