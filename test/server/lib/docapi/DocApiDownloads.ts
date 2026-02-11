/**
 * Tests for download endpoints:
 * - GET /docs/{did}/download (document download)
 * - GET /docs/{did}/download/csv
 * - GET /docs/{did}/download/xlsx
 * - GET /docs/{did}/download/table-schema
 * - POST /docs/{did}/copy
 * - POST /workspaces/{wid}/import
 *
 * Tests run in multiple server configurations:
 * - Merged server (home + docs in one process)
 * - Separated servers (home + docworker, requires Redis)
 * - Direct to docworker (requires Redis)
 */

import { addAllScenarios, TestContext } from "test/server/lib/docapi/scenarios";
import * as testUtils from "test/server/testUtils";

import axios from "axios";
import { assert } from "chai";

const ORG_NAME = "docs-1";

describe("DocApiDownloads", function() {
  this.timeout(30000);
  testUtils.setTmpLogLevel("error");

  addAllScenarios(addDownloadsTests, "docapi-downloads");
});

function addDownloadsTests(getCtx: () => TestContext) {
  // Set up test data that the CSV/table-schema download tests depend on
  before(async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    // Create Foo table with test data in TestDoc
    const userActions = [
      ["AddTable", "Foo", [{ id: "A" }, { id: "B" }]],
      ["BulkAddRecord", "Foo", [1, 2, 3, 4], {
        A: ["Santa", "Bob", "Alice", "Felix"],
        B: [1, 11, 2, 22],
      }],
    ];
    await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/apply`, userActions, chimpy);
  });

  async function generateDocAndUrl(docName: string = "Dummy") {
    const { serverUrl, userApi } = getCtx();
    const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
    const docId = await userApi.newDoc({ name: docName }, wid);
    const docUrl = `${serverUrl}/api/docs/${docId}`;
    const tableUrl = `${serverUrl}/api/docs/${docId}/tables/Table1`;
    return { docUrl, tableUrl, docId };
  }

  it("GET /docs/{did}/download serves document", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download`, chimpy);
    assert.equal(resp.status, 200);
    assert.match(resp.data, /grist_Tables_column/);
  });

  it("GET /docs/{did}/download respects permissions", async function() {
    const { serverUrl, docIds, kiwi } = getCtx();
    // kiwi has no access to TestDoc
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download`, kiwi);
    assert.equal(resp.status, 403);
    assert.notMatch(resp.data, /grist_Tables_column/);
  });

  // A tiny test that /copy doesn't throw.
  it("POST /copy succeeds on a doc worker", async function() {
    const { userApi, docIds } = getCtx();
    const docId = docIds.TestDoc;
    const worker1 = await userApi.getWorkerAPI(docId);
    await worker1.copyDoc(docId, undefined, "copy");
  });

  it("POST /docs/{did} with sourceDocId copies a document", async function() {
    const { serverUrl, userApi, docIds, chimpy } = getCtx();
    const chimpyWs = await userApi.newWorkspace({ name: "Chimpy's Workspace" }, ORG_NAME);
    const resp = await axios.post(`${serverUrl}/api/docs`, {
      sourceDocumentId: docIds.TestDoc,
      documentName: "copy of TestDoc",
      asTemplate: false,
      workspaceId: chimpyWs,
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.isString(resp.data);
  });

  it("POST /docs/{did}/copy copies a document", async function() {
    const { serverUrl, userApi, docIds, chimpy } = getCtx();
    const chimpyWs2 = await userApi.newWorkspace({ name: "Chimpy's Workspace 2" }, ORG_NAME);
    const resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/copy`, {
      documentName: "copy of TestDoc",
      workspaceId: chimpyWs2,
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.isString(resp.data);
  });

  it("GET /docs/{did}/download/csv serves CSV-encoded document", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/download/csv?tableId=Table1`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data, "A,B,C,D,E\nhello,,,,HELLO\n,world,,,\n,,,,\n,,,,\n");

    const resp2 = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/csv?tableId=Foo`, chimpy);
    assert.equal(resp2.status, 200);
    assert.equal(resp2.data, "A,B\nSanta,1\nBob,11\nAlice,2\nFelix,22\n");
  });

  it("GET /docs/{did}/download/csv with header=colId shows columns id in the header instead of their name",
    async function() {
      const { chimpy } = getCtx();
      const { docUrl } = await generateDocAndUrl("csvWithColIdAsHeader");
      const AColRef = 2;
      const userActions = [
        ["AddRecord", "Table1", null, { A: "a1", B: "b1" }],
        ["UpdateRecord", "_grist_Tables_column", AColRef, { untieColIdFromLabel: true }],
        ["UpdateRecord", "_grist_Tables_column", AColRef, {
          label: "Column label for A",
          colId: "AColId",
        }],
      ];
      const resp = await axios.post(`${docUrl}/apply`, userActions, chimpy);
      assert.equal(resp.status, 200);
      const csvResp = await axios.get(`${docUrl}/download/csv?tableId=Table1&header=colId`, chimpy);
      assert.equal(csvResp.status, 200);
      assert.equal(csvResp.data, "AColId,B,C\na1,b1,\n");
    });

  it("GET /docs/{did}/download/csv respects permissions", async function() {
    const { serverUrl, docIds, kiwi } = getCtx();
    // kiwi has no access to TestDoc
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/csv?tableId=Table1`, kiwi);
    assert.equal(resp.status, 403);
    assert.notEqual(resp.data, "A,B,C,D,E\nhello,,,,HELLO\n,world,,,\n,,,,\n,,,,\n");
  });

  it("GET /docs/{did}/download/csv returns 404 if tableId is invalid", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/csv?tableId=MissingTableId`, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, { error: "Table MissingTableId not found." });
  });

  it("GET /docs/{did}/download/csv returns 404 if viewSectionId is invalid", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/csv?tableId=Table1&viewSection=9999`, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, { error: "No record 9999 in table _grist_Views_section" });
  });

  it("GET /docs/{did}/download/csv returns 400 if tableId is missing", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/csv`, chimpy);
    assert.equal(resp.status, 400);
    assert.deepEqual(resp.data, { error: "tableId parameter is required" });
  });

  it("GET /docs/{did}/download/table-schema serves table-schema-encoded document", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/table-schema?tableId=Foo`, chimpy);
    assert.equal(resp.status, 200);
    const expected = {
      format: "csv",
      mediatype: "text/csv",
      encoding: "utf-8",
      dialect: {
        delimiter: ",",
        doubleQuote: true,
      },
      name: "foo",
      title: "Foo",
      schema: {
        fields: [{
          name: "A",
          type: "string",
          format: "default",
        }, {
          name: "B",
          type: "string",
          format: "default",
        }],
      },
    };
    assert.deepInclude(resp.data, expected);

    const resp2 = await axios.get(resp.data.path, chimpy);
    assert.equal(resp2.status, 200);
    assert.equal(resp2.data, "A,B\nSanta,1\nBob,11\nAlice,2\nFelix,22\n");
  });

  it("GET /docs/{did}/download/table-schema serves table-schema-encoded document with header=colId", async function() {
    const { chimpy } = getCtx();
    const { docUrl, tableUrl } = await generateDocAndUrl("tableSchemaWithColIdAsHeader");
    const columns = [
      {
        id: "Some_ID",
        fields: {
          label: "Some Label",
          type: "Text",
        },
      },
    ];
    const setupColResp = await axios.put(`${tableUrl}/columns`, { columns }, { ...chimpy, params: { replaceall: true } });
    assert.equal(setupColResp.status, 200);

    const resp = await axios.get(`${docUrl}/download/table-schema?tableId=Table1&header=colId`, chimpy);
    assert.equal(resp.status, 200);
    const expected = {
      format: "csv",
      mediatype: "text/csv",
      encoding: "utf-8",
      dialect: {
        delimiter: ",",
        doubleQuote: true,
      },
      name: "table1",
      title: "Table1",
      schema: {
        fields: [{
          name: "Some_ID",
          type: "string",
          format: "default",
        }],
      },
    };
    assert.deepInclude(resp.data, expected);
  });

  it("GET /docs/{did}/download/table-schema respects permissions", async function() {
    const { serverUrl, docIds, kiwi } = getCtx();
    // kiwi has no access to TestDoc
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/table-schema?tableId=Table1`, kiwi);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, { error: "No view access" });
  });

  it("GET /docs/{did}/download/table-schema returns 404 if tableId is invalid", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/table-schema?tableId=MissingTableId`,
      chimpy,
    );
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, { error: "Table MissingTableId not found." });
  });

  it("GET /docs/{did}/download/table-schema returns 400 if tableId is missing", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/table-schema`, chimpy);
    assert.equal(resp.status, 400);
    assert.deepEqual(resp.data, { error: "tableId parameter is required" });
  });

  it("GET /docs/{did}/download/xlsx serves XLSX-encoded document", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/download/xlsx?tableId=Table1`, chimpy);
    assert.equal(resp.status, 200);
    assert.notEqual(resp.data, null);
  });

  it("GET /docs/{did}/download/xlsx respects permissions", async function() {
    const { serverUrl, docIds, kiwi } = getCtx();
    // kiwi has no access to TestDoc
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/xlsx?tableId=Table1`, kiwi);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, { error: "No view access" });
  });

  it("GET /docs/{did}/download/xlsx returns 404 if tableId is invalid", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/xlsx?tableId=MissingTableId`,
      chimpy,
    );
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, { error: "Table MissingTableId not found." });
  });

  it("GET /docs/{did}/download/xlsx returns 404 if viewSectionId is invalid", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/xlsx?tableId=Table1&viewSection=9999`, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, { error: "No record 9999 in table _grist_Views_section" });
  });

  it("GET /docs/{did}/download/xlsx returns 200 if tableId is missing", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/xlsx`, chimpy);
    assert.equal(resp.status, 200);
    assert.notEqual(resp.data, null);
  });

  it("GET /docs/{did}/download/xlsx returns 200 if tableId is missing and header present", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/xlsx?header=label`, chimpy);
    assert.equal(resp.status, 200);
    assert.notEqual(resp.data, null);
  });

  it("POST /workspaces/{wid}/import handles empty filenames", async function() {
    const { userApi, chimpy } = getCtx();
    if (!process.env.TEST_REDIS_URL) {
      this.skip();
    }
    const worker = await userApi.getWorkerAPI("import");
    const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
    const fakeData1 = await testUtils.readFixtureDoc("Hello.grist");
    const uploadId1 = await worker.upload(fakeData1, ".grist");
    const resp = await axios.post(`${worker.url}/api/workspaces/${wid}/import`, { uploadId: uploadId1 }, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.title, "Untitled upload");
    assert.equal(typeof resp.data.id, "string");
    assert.notEqual(resp.data.id, "");
  });
}
