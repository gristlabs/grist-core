/**
 * Miscellaneous tests:
 * - Reference column conversion when target table is deleted
 * - String parsing in user actions
 * - Shares handling (/s/ variants)
 * - Document protection during upload-and-import
 *
 * Tests run in multiple server configurations:
 * - Merged server (home + docs in one process)
 * - Separated servers (home + docworker, requires Redis)
 * - Direct to docworker (requires Redis)
 */

import { SHARE_KEY_PREFIX } from "app/common/gristUrls";
import { addAllScenarios, TestContext } from "test/server/lib/docapi/scenarios";
import * as testUtils from "test/server/testUtils";
import { getDatabase } from "test/testUtils";

import axios, { AxiosResponse } from "axios";
import { assert } from "chai";
import FormData from "form-data";
import defaultsDeep from "lodash/defaultsDeep";

describe("DocApiMisc", function() {
  this.timeout(30000);
  testUtils.setTmpLogLevel("error");

  addAllScenarios(addMiscTests, "docapi-misc");
});

function addMiscTests(getCtx: () => TestContext) {
  // This is mostly tested in Python, but this case requires the data engine to call
  // 'external' (i.e. JS) code to do the type conversion.
  it("converts reference columns when the target table is deleted", async () => {
    const { serverUrl, userApi, chimpy } = getCtx();
    // Create a test document.
    const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
    const docId = await userApi.newDoc({ name: "testdoc" }, ws1);
    const docUrl = `${serverUrl}/api/docs/${docId}`;

    // Make a new table with a reference column pointing at Table1, displaying column A.
    let resp = await axios.post(`${docUrl}/apply`, [
      ["AddTable", "Table2", [{ id: "R", type: "RefList:Table1" }]],
      ["ModifyColumn", "Table2", "R", { visibleCol: 2 }],
      ["SetDisplayFormula", "Table2", 0, 6, "$R.A"],
      ["BulkAddRecord", "Table1", [1, 2], { A: ["Alice", "Bob"] }],
      ["BulkAddRecord", "Table2", [1], { R: [["L", 1, 2]] }],
    ], chimpy);
    assert.equal(resp.status, 200);

    // Now delete the referenced table.
    // This action has to be separate for the test to pass.
    resp = await axios.post(`${docUrl}/apply`, [
      ["RemoveTable", "Table1"],
    ], chimpy);
    assert.equal(resp.status, 200);

    resp = await axios.get(`${docUrl}/tables/Table2/columns`, chimpy);
    assert.deepEqual(resp.data, {
      columns: [
        {
          id: "R",
          fields: {
            colRef: 6,
            parentId: 2,
            parentPos: 6,
            // Type changed from RefList to Text
            type: "Text",
            widgetOptions: "",
            isFormula: false,
            formula: "",
            label: "R",
            description: "",
            untieColIdFromLabel: false,
            summarySourceCol: 0,
            // Display and visible columns cleared
            displayCol: 0,
            visibleCol: 0,
            rules: null,
            recalcWhen: 0,
            recalcDeps: null,
            reverseCol: 0,
          },
        },
      ],
    },
    );

    resp = await axios.get(`${docUrl}/tables/Table2/records`, chimpy);
    assert.deepEqual(resp.data, {
      records:
          [
            // Reflist converted to comma separated display values.
            { id: 1, fields: { R: "Alice, Bob" } },
          ],
    },
    );
  });

  it("parses strings in user actions", async () => {
    const { serverUrl, userApi, chimpy } = getCtx();
    // Create a test document.
    const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
    const docId = await userApi.newDoc({ name: "testdoc" }, ws1);
    const docUrl = `${serverUrl}/api/docs/${docId}`;
    const recordsUrl = `${docUrl}/tables/Table1/records`;

    // Make the column numeric, delete the other columns we don't care about
    await axios.post(`${docUrl}/apply`, [
      ["ModifyColumn", "Table1", "A", { type: "Numeric" }],
      ["RemoveColumn", "Table1", "B"],
      ["RemoveColumn", "Table1", "C"],
    ], chimpy);

    // Add/update some records without and with string parsing
    // Specifically test:
    // 1. /apply, with an AddRecord
    // 2. POST  /records (BulkAddRecord)
    // 3. PATCH /records (BulkUpdateRecord)
    // Send strings that look like currency which need string parsing to become numbers
    for (const queryParams of ["?noparse=1", ""]) {
      await axios.post(`${docUrl}/apply${queryParams}`, [
        ["AddRecord", "Table1", null, { A: "$1" }],
      ], chimpy);

      const response = await axios.post(`${recordsUrl}${queryParams}`,
        {
          records: [
            { fields: { A: "$2" } },
            { fields: { A: "$3" } },
          ],
        },
        chimpy);

      // Update $3 -> $4
      const rowId = response.data.records[1].id;
      await axios.patch(`${recordsUrl}${queryParams}`,
        {
          records: [
            { id: rowId, fields: { A: "$4" } },
          ],
        },
        chimpy);
    }

    // Check the results
    const resp = await axios.get(recordsUrl, chimpy);
    assert.deepEqual(resp.data, {
      records:
          [
            // Without string parsing
            { id: 1, fields: { A: "$1" } },
            { id: 2, fields: { A: "$2" } },
            { id: 3, fields: { A: "$4" } },

            // With string parsing
            { id: 4, fields: { A: 1 } },
            { id: 5, fields: { A: 2 } },
            { id: 6, fields: { A: 4 } },
          ],
    },
    );
  });

  it(`POST /workspaces/{wid}/import can import a new file`, async function() {
    const { homeUrl, userApi, chimpy } = getCtx();
    const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
    const formData = new FormData();
    formData.append("upload", "A,B\n1,2\n3,4\n", "table1.csv");
    const config = defaultsDeep({ headers: formData.getHeaders() }, chimpy);
    const importResp = await axios.post(`${homeUrl}/api/workspaces/${wid}/import`, formData, config);
    assert.equal(importResp.status, 200);
    const urlId = importResp.data.id;

    const docDetailsResp = await axios.get(`${homeUrl}/api/docs/${urlId}`, chimpy);
    assert.equal(docDetailsResp.status, 200);
    assert.equal(docDetailsResp.data.name, "table1");
    assert.equal(docDetailsResp.data.workspace.name, "Private");

    // content was successfully stored
    const contentResp = await axios.get(`${homeUrl}/api/docs/${urlId}/tables/Table1/data`, chimpy);
    assert.deepEqual(contentResp.data, { id: [1, 2], manualSort: [1, 2], A: [1, 3], B: [2, 4] });
  });

  it("handles /s/ variants for shares", async function() {
    const { serverUrl, userApi, chimpy } = getCtx();
    const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
    const docId = await userApi.newDoc({ name: "BlankTest" }, wid);
    // const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
    const userActions = [
      ["AddRecord", "_grist_Shares", null, {
        linkId: "x",
        options: '{"publish": true}',
      }],
      ["UpdateRecord", "_grist_Views_section", 1,
        { shareOptions: '{"publish": true, "form": true}' }],
      ["UpdateRecord", "_grist_Pages", 1, { shareRef: 1 }],
    ];
    let resp: AxiosResponse;
    resp = await axios.post(`${serverUrl}/api/docs/${docId}/apply`, userActions, chimpy);
    assert.equal(resp.status, 200);

    const db = await getDatabase();
    const shares = await db.connection.query("select * from shares");
    const { key } = shares[0];

    resp = await axios.get(`${serverUrl}/api/docs/${docId}/tables/Table1/records`, chimpy);
    assert.equal(resp.status, 200);

    resp = await axios.get(`${serverUrl}/api/s/${key}/tables/Table1/records`, chimpy);
    assert.equal(resp.status, 200);

    resp = await axios.get(`${serverUrl}/api/docs/${key}/tables/Table1/records`, chimpy);
    assert.equal(resp.status, 404);

    resp = await axios.get(`${serverUrl}/api/docs/${SHARE_KEY_PREFIX}${key}/tables/Table1/records`, chimpy);
    assert.equal(resp.status, 200);

    resp = await axios.get(`${serverUrl}/api/s/${key}xxx/tables/Table1/records`, chimpy);
    assert.equal(resp.status, 404);
  });

  it("document is protected during upload-and-import sequence", async function() {
    const { userApi, chimpy, kiwi, home } = getCtx();
    if (!process.env.TEST_REDIS_URL) {
      this.skip();
    }
    // Prepare an API for a different user.
    const kiwiApi = home.makeUserApi("Fish", "kiwi");
    // upload something for Chimpy and something else for Kiwi.
    const worker1 = await userApi.getWorkerAPI("import");
    const fakeData1 = await testUtils.readFixtureDoc("Hello.grist");
    const uploadId1 = await worker1.upload(fakeData1, "upload.grist");
    const worker2 = await kiwiApi.getWorkerAPI("import");
    const fakeData2 = await testUtils.readFixtureDoc("Favorite_Films.grist");
    const uploadId2 = await worker2.upload(fakeData2, "upload2.grist");

    // Check that kiwi only has access to their own upload.
    let wid = (await kiwiApi.getOrgWorkspaces("current")).find(w => w.name === "Big")!.id;
    let resp = await axios.post(`${worker2.url}/api/workspaces/${wid}/import`, { uploadId: uploadId1 },
      kiwi);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, { error: "access denied" });

    resp = await axios.post(`${worker2.url}/api/workspaces/${wid}/import`, { uploadId: uploadId2 },
      kiwi);
    assert.equal(resp.status, 200);

    // Check that chimpy has access to their own upload.
    wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
    resp = await axios.post(`${worker1.url}/api/workspaces/${wid}/import`, { uploadId: uploadId1 },
      chimpy);
    assert.equal(resp.status, 200);
  });
}
