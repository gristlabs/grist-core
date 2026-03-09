/**
 * Tests for document creation:
 * - POST /api/docs (create unsaved docs, create saved docs)
 * - Column type guessing
 * - Anonymous user restrictions
 *
 * Tests run in multiple server configurations:
 * - Merged server (home + docs in one process)
 * - Separated servers (home + docworker, requires Redis)
 * - Direct to docworker (requires Redis)
 */

import { addAllScenarios, ORG_NAME, TestContext } from "test/server/lib/docapi/helpers";
import * as testUtils from "test/server/testUtils";

import axios from "axios";
import { assert } from "chai";
import FormData from "form-data";
import defaultsDeep from "lodash/defaultsDeep";

describe("DocApiCreation", function() {
  this.timeout(30000);
  testUtils.setTmpLogLevel("error");

  addAllScenarios(addCreationTests, "docapi-creation");
});

function addCreationTests(getCtx: () => TestContext) {
  // Note: The test "should not allow anonymous users to create new docs" is in anonPlayground.ts
  // because it requires GRIST_ANON_PLAYGROUND: "false" environment setting.

  it("guesses types of new columns", async () => {
    const { serverUrl, chimpy, getOrCreateTestDoc } = getCtx();
    const testDoc = await getOrCreateTestDoc();
    const userActions = [
      ["AddTable", "GuessTypes", []],
      // Make 5 blank columns of type Any
      ["AddColumn", "GuessTypes", "Date", {}],
      ["AddColumn", "GuessTypes", "DateTime", {}],
      ["AddColumn", "GuessTypes", "Bool", {}],
      ["AddColumn", "GuessTypes", "Numeric", {}],
      ["AddColumn", "GuessTypes", "Text", {}],
      // Add string values from which the initial type will be guessed
      ["AddRecord", "GuessTypes", null, {
        Date: "1970-01-02",
        DateTime: "1970-01-02 12:00",
        Bool: "true",
        Numeric: "1.2",
        Text: "hello",
      }],
    ];
    const resp = await axios.post(`${serverUrl}/api/docs/${testDoc}/apply`, userActions, chimpy);
    assert.equal(resp.status, 200);

    // Check that the strings were parsed to typed values
    assert.deepEqual(
      (await axios.get(`${serverUrl}/api/docs/${testDoc}/tables/GuessTypes/records`, chimpy)).data,
      {
        records: [
          {
            id: 1,
            fields: {
              Date: 24 * 60 * 60,
              DateTime: 36 * 60 * 60,
              Bool: true,
              Numeric: 1.2,
              Text: "hello",
            },
          },
        ],
      },
    );

    // Check the column types
    assert.deepEqual(
      (await axios.get(`${serverUrl}/api/docs/${testDoc}/tables/GuessTypes/columns`, chimpy))
        .data.columns.map((col: any) => col.fields.type),
      ["Date", "DateTime:UTC", "Bool", "Numeric", "Text"],
    );
  });

  for (const content of ["with content", "without content"]) {
    for (const mode of ["logged in", "anonymous"]) {
      it(`POST /api/docs ${content} can create unsaved docs when ${mode}`, async function() {
        const { serverUrl, homeUrl, chimpy, charon, nobody } = getCtx();
        const user = (mode === "logged in") ? chimpy : nobody;
        const formData = new FormData();
        formData.append("upload", "A,B\n1,2\n3,4\n", "table1.csv");
        const config = defaultsDeep({ headers: formData.getHeaders() }, user);
        let resp = await axios.post(`${serverUrl}/api/docs`,
          ...(content === "with content" ? [formData, config] : [null, user]));
        assert.equal(resp.status, 200);
        const urlId = resp.data;
        if (mode === "logged in") {
          assert.match(urlId, /^new~[^~]*~[0-9]+$/);
        } else {
          assert.match(urlId, /^new~[^~]*$/);
        }

        // Access information about that document should be sane for current user
        resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, user);
        assert.equal(resp.status, 200);
        assert.equal(resp.data.name, "Untitled");
        assert.equal(resp.data.workspace.name, "Examples & Templates");
        assert.equal(resp.data.access, "owners");
        if (mode === "anonymous") {
          resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, chimpy);
          assert.equal(resp.data.access, "owners");
        } else {
          resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, charon);
          assert.equal(resp.status, 403);
          resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, nobody);
          assert.equal(resp.status, 403);
        }

        // content was successfully stored
        resp = await axios.get(`${serverUrl}/api/docs/${urlId}/tables/Table1/data`, user);
        if (content === "with content") {
          assert.deepEqual(resp.data, { id: [1, 2], manualSort: [1, 2], A: [1, 3], B: [2, 4] });
        } else {
          assert.deepEqual(resp.data, { id: [], manualSort: [], A: [], B: [], C: [] });
        }
      });
    }

    it(`POST /api/docs ${content} can create saved docs in workspaces`, async function() {
      const { serverUrl, homeUrl, userApi, chimpy, charon, nobody } = getCtx();
      // Make a workspace.
      const chimpyWs = await userApi.newWorkspace({ name: "Chimpy's Workspace" }, ORG_NAME);

      // Create a document in the new workspace.
      const user = chimpy;
      const body = {
        documentName: "Chimpy's Document",
        workspaceId: chimpyWs,
      };
      const formData = new FormData();
      formData.append("upload", "A,B\n1,2\n3,4\n", "table1.csv");
      formData.append("documentName", body.documentName);
      formData.append("workspaceId", body.workspaceId);
      const config = defaultsDeep({ headers: formData.getHeaders() }, user);
      let resp = await axios.post(`${serverUrl}/api/docs`,
        ...(content === "with content" ?
          [formData, config] :
          [body, user]),
      );
      assert.equal(resp.status, 200);
      const urlId = resp.data;
      assert.notMatch(urlId, /^new~[^~]*~[0-9]+$/);
      assert.match(urlId, /^[^~]+$/);

      // Check document metadata.
      resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, user);
      assert.equal(resp.status, 200);
      assert.equal(resp.data.name, "Chimpy's Document");
      assert.equal(resp.data.workspace.name, "Chimpy's Workspace");
      assert.equal(resp.data.access, "owners");
      resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, charon);
      assert.equal(resp.status, 200);
      resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, nobody);
      assert.equal(resp.status, 403);

      // Check document contents.
      resp = await axios.get(`${serverUrl}/api/docs/${urlId}/tables/Table1/data`, user);
      if (content === "with content") {
        assert.deepEqual(resp.data, { id: [1, 2], manualSort: [1, 2], A: [1, 3], B: [2, 4] });
      } else {
        assert.deepEqual(resp.data, { id: [], manualSort: [], A: [], B: [], C: [] });
      }

      // Delete the workspace.
      await userApi.deleteWorkspace(chimpyWs);
    });

    it(`POST /api/docs ${content} fails if workspace access is denied`, async function() {
      const { serverUrl, homeUrl, userApi, chimpy, charon, kiwi } = getCtx();
      // Make a workspace.
      const chimpyWs = await userApi.newWorkspace({ name: "Chimpy's Workspace" }, ORG_NAME);

      // Try to create a document in the new workspace as Kiwi and Charon, who do not have write access.
      for (const user of [kiwi, charon]) {
        const body = {
          documentName: "Untitled document",
          workspaceId: chimpyWs,
        };
        const formData = new FormData();
        formData.append("upload", "A,B\n1,2\n3,4\n", "table1.csv");
        formData.append("documentName", body.documentName);
        formData.append("workspaceId", body.workspaceId);
        const config = defaultsDeep({ headers: formData.getHeaders() }, user);
        const resp = await axios.post(`${serverUrl}/api/docs`,
          ...(content === "with content" ?
            [formData, config] :
            [body, user]),
        );
        assert.equal(resp.status, 403);
        assert.equal(resp.data.error, "access denied");
      }

      // Try to create a document in the new workspace as Chimpy, who does have write access.
      const user = chimpy;
      const body = {
        documentName: "Chimpy's Document",
        workspaceId: chimpyWs,
      };
      const formData = new FormData();
      formData.append("upload", "A,B\n1,2\n3,4\n", "table1.csv");
      formData.append("documentName", body.documentName);
      formData.append("workspaceId", body.workspaceId);
      const config = defaultsDeep({ headers: formData.getHeaders() }, user);
      let resp = await axios.post(`${serverUrl}/api/docs`,
        ...(content === "with content" ?
          [formData, config] :
          [body, user]),
      );
      assert.equal(resp.status, 200);
      const urlId = resp.data;
      assert.notMatch(urlId, /^new~[^~]*~[0-9]+$/);
      assert.match(urlId, /^[^~]+$/);
      resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, user);
      assert.equal(resp.status, 200);
      assert.equal(resp.data.name, "Chimpy's Document");
      assert.equal(resp.data.workspace.name, "Chimpy's Workspace");
      assert.equal(resp.data.access, "owners");

      // Delete the workspace.
      await userApi.deleteWorkspace(chimpyWs);
    });

    it(`POST /api/docs ${content} fails if workspace is soft-deleted`, async function() {
      const { serverUrl, userApi, chimpy } = getCtx();
      // Make a workspace and promptly remove it.
      const chimpyWs = await userApi.newWorkspace({ name: "Chimpy's Workspace" }, ORG_NAME);
      await userApi.softDeleteWorkspace(chimpyWs);

      // Try to create a document in the soft-deleted workspace.
      const user = chimpy;
      const body = {
        documentName: "Chimpy's Document",
        workspaceId: chimpyWs,
      };
      const formData = new FormData();
      formData.append("upload", "A,B\n1,2\n3,4\n", "table1.csv");
      formData.append("documentName", body.documentName);
      formData.append("workspaceId", body.workspaceId);
      const config = defaultsDeep({ headers: formData.getHeaders() }, user);
      const resp = await axios.post(`${serverUrl}/api/docs`,
        ...(content === "with content" ?
          [formData, config] :
          [body, user]),
      );
      assert.equal(resp.status, 400);
      assert.equal(resp.data.error, "Cannot add document to a deleted workspace");

      // Delete the workspace.
      await userApi.deleteWorkspace(chimpyWs);
    });

    it(`POST /api/docs ${content} fails if workspace does not exist`, async function() {
      const { serverUrl, chimpy } = getCtx();
      // Try to create a document in a non-existent workspace.
      const user = chimpy;
      const body = {
        documentName: "Chimpy's Document",
        workspaceId: 123456789,
      };
      const formData = new FormData();
      formData.append("upload", "A,B\n1,2\n3,4\n", "table1.csv");
      formData.append("documentName", body.documentName);
      formData.append("workspaceId", body.workspaceId);
      const config = defaultsDeep({ headers: formData.getHeaders() }, user);
      const resp = await axios.post(`${serverUrl}/api/docs`,
        ...(content === "with content" ?
          [formData, config] :
          [body, user]),
      );
      assert.equal(resp.status, 404);
      assert.equal(resp.data.error, "workspace not found");
    });
  }
}
