/**
 * Tests for document operations:
 * - POST /docs/{did}/force-reload
 * - POST /docs/{did}/assign
 * - GET/POST /docs/{did}/replace
 * - GET /docs/{did}/snapshots
 * - POST /docs/{did}/states/remove
 * - GET /docs/{did}/compare
 * - GET /docs/{did1}/compare/{did2}
 * - URL ID handling
 *
 * Tests run in multiple server configurations:
 * - Merged server (home + docs in one process)
 * - Separated servers (home + docworker, requires Redis)
 * - Direct to docworker (requires Redis)
 */

import { ActionSummary } from "app/common/ActionSummary";
import { DocState } from "app/common/DocState";
import { UserAPI, UserAPIImpl } from "app/common/UserAPI";
import { configForUser } from "test/gen-server/testUtils";
import { addAllScenarios, ORG_NAME, TestContext } from "test/server/lib/docapi/helpers";
import * as testUtils from "test/server/testUtils";

import axios from "axios";
import { assert } from "chai";
import FormData from "form-data";
import range from "lodash/range";
import fetch from "node-fetch";

describe("DocApiDocuments", function() {
  this.timeout(30000);
  testUtils.setTmpLogLevel("error");

  addAllScenarios(addDocumentsTests, "docapi-documents");
});

function addDocumentsTests(getCtx: () => TestContext) {
  function makeUserApi(org: string, username: string, options?: { baseUrl?: string }): UserAPI {
    const { homeUrl } = getCtx();
    const config = configForUser(username);
    const baseUrl = options?.baseUrl || homeUrl;
    return new UserAPIImpl(`${baseUrl}/o/${org}`, {
      headers: config.headers as Record<string, string>,
      fetch: fetch as unknown as typeof globalThis.fetch,
      newFormData: () => new FormData() as any,
    });
  }

  it("allows forced reloads", async function() {
    const { serverUrl, docIds, chimpy, support, hasHomeApi } = getCtx();
    let resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/force-reload`, null, chimpy);
    assert.equal(resp.status, 200);
    // Check that support cannot force a reload.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/force-reload`, null, support);
    assert.equal(resp.status, 403);
    if (hasHomeApi) {
      // Check that support can force a reload through housekeeping api.
      resp = await axios.post(`${serverUrl}/api/housekeeping/docs/${docIds.Timesheets}/force-reload`, null, support);
      assert.equal(resp.status, 200);
      // Check that regular user cannot force a reload through housekeeping api.
      resp = await axios.post(`${serverUrl}/api/housekeeping/docs/${docIds.Timesheets}/force-reload`, null, chimpy);
      assert.equal(resp.status, 403);
    }
  });

  it("allows assignments", async function() {
    const { serverUrl, docIds, chimpy, support, hasHomeApi } = getCtx();
    let resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/assign`, null, chimpy);
    assert.equal(resp.status, 200);
    // Check that support cannot force an assignment.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/assign`, null, support);
    assert.equal(resp.status, 403);
    if (hasHomeApi) {
      // Check that support can force an assignment through housekeeping api.
      resp = await axios.post(`${serverUrl}/api/housekeeping/docs/${docIds.Timesheets}/assign`, null, support);
      assert.equal(resp.status, 200);
      // Check that regular user cannot force an assignment through housekeeping api.
      resp = await axios.post(`${serverUrl}/api/housekeeping/docs/${docIds.Timesheets}/assign`, null, chimpy);
      assert.equal(resp.status, 403);
    }
  });

  it("honors urlIds", async function() {
    const { serverUrl, userApi, chimpy } = getCtx();
    // Make a document with a urlId
    const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
    const doc1 = await userApi.newDoc({ name: "testdoc1", urlId: "urlid1" }, ws1);
    try {
      // Make sure an edit made by docId is visible when accessed via docId or urlId
      await axios.post(`${serverUrl}/api/docs/${doc1}/tables/Table1/data`, {
        A: ["Apple"], B: [99],
      }, chimpy);
      let resp = await axios.get(`${serverUrl}/api/docs/${doc1}/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[0], "Apple");
      resp = await axios.get(`${serverUrl}/api/docs/urlid1/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[0], "Apple");
      // Make sure an edit made by urlId is visible when accessed via docId or urlId
      await axios.post(`${serverUrl}/api/docs/urlid1/tables/Table1/data`, {
        A: ["Orange"], B: [42],
      }, chimpy);
      resp = await axios.get(`${serverUrl}/api/docs/${doc1}/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[1], "Orange");
      resp = await axios.get(`${serverUrl}/api/docs/urlid1/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[1], "Orange");
    } finally {
      await userApi.deleteDoc(doc1);
    }
  });

  it("filters urlIds by org", async function() {
    const { serverUrl, userApi, chimpy } = getCtx();
    // Make two documents with same urlId
    const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
    const doc1 = await userApi.newDoc({ name: "testdoc1", urlId: "urlid" }, ws1);
    const nasaApi = makeUserApi("nasa", "chimpy");
    const ws2 = (await nasaApi.getOrgWorkspaces("current"))[0].id;
    const doc2 = await nasaApi.newDoc({ name: "testdoc2", urlId: "urlid" }, ws2);
    try {
      // Place a value in "docs" doc
      await axios.post(`${serverUrl}/o/docs/api/docs/urlid/tables/Table1/data`, {
        A: ["Apple"], B: [99],
      }, chimpy);
      // Place a value in "nasa" doc
      await axios.post(`${serverUrl}/o/nasa/api/docs/urlid/tables/Table1/data`, {
        A: ["Orange"], B: [99],
      }, chimpy);
      // Check the values made it to the right places
      let resp = await axios.get(`${serverUrl}/api/docs/${doc1}/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[0], "Apple");
      resp = await axios.get(`${serverUrl}/api/docs/${doc2}/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[0], "Orange");
    } finally {
      await userApi.deleteDoc(doc1);
      await nasaApi.deleteDoc(doc2);
    }
  });

  it("allows docId access to any document from merged org", async function() {
    const { serverUrl, userApi, chimpy } = getCtx();
    // Make two documents
    const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
    const doc1 = await userApi.newDoc({ name: "testdoc1" }, ws1);
    const nasaApi = makeUserApi("nasa", "chimpy");
    const ws2 = (await nasaApi.getOrgWorkspaces("current"))[0].id;
    const doc2 = await nasaApi.newDoc({ name: "testdoc2" }, ws2);
    try {
      // Should fail to write to a document in "docs" from "nasa" url
      let resp = await axios.post(`${serverUrl}/o/nasa/api/docs/${doc1}/tables/Table1/data`, {
        A: ["Apple"], B: [99],
      }, chimpy);
      assert.equal(resp.status, 404);
      // Should successfully write to a document in "nasa" from "docs" url
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc2}/tables/Table1/data`, {
        A: ["Orange"], B: [99],
      }, chimpy);
      assert.equal(resp.status, 200);
      // Should fail to write to a document in "nasa" from "pr" url
      resp = await axios.post(`${serverUrl}/o/pr/api/docs/${doc2}/tables/Table1/data`, {
        A: ["Orange"], B: [99],
      }, chimpy);
      assert.equal(resp.status, 404);
    } finally {
      await userApi.deleteDoc(doc1);
      await nasaApi.deleteDoc(doc2);
    }
  });

  it("GET /docs/{did}/replace replaces one document with another", async function() {
    const { serverUrl, userApi, chimpy, kiwi } = getCtx();
    const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
    const doc1 = await userApi.newDoc({ name: "testdoc1" }, ws1);
    const doc2 = await userApi.newDoc({ name: "testdoc2" }, ws1);
    const doc3 = await userApi.newDoc({ name: "testdoc3" }, ws1);
    const doc4 = await userApi.newDoc({ name: "testdoc4" }, ws1);
    await userApi.updateDocPermissions(doc2, { users: { "kiwi@getgrist.com": "editors" } });
    await userApi.updateDocPermissions(doc3, { users: { "kiwi@getgrist.com": "viewers" } });
    await userApi.updateDocPermissions(doc4, { users: { "kiwi@getgrist.com": "owners" } });
    try {
      // Put some material in doc3
      let resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc3}/tables/Table1/data`, {
        A: ["Orange"],
      }, chimpy);
      assert.equal(resp.status, 200);

      // Kiwi cannot replace doc2 with doc3, not an owner
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc2}/replace`, {
        sourceDocId: doc3,
      }, kiwi);
      assert.equal(resp.status, 403);
      assert.match(resp.data.error, /Only owners can replace a document/);

      // Kiwi can't replace doc1 with doc3, no access to doc1
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc1}/replace`, {
        sourceDocId: doc3,
      }, kiwi);
      assert.equal(resp.status, 403);
      assert.match(resp.data.error, /No view access/);

      // Kiwi can't replace doc2 with doc1, no read access to doc1
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc2}/replace`, {
        sourceDocId: doc1,
      }, kiwi);
      assert.equal(resp.status, 403);
      assert.match(resp.data.error, /access denied/);

      // Kiwi cannot replace a doc with material they have only partial read access to.
      resp = await axios.post(`${serverUrl}/api/docs/${doc3}/apply`, [
        ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "A" }],
        ["AddRecord", "_grist_ACLRules", null, {
          resource: -1, aclFormula: "user.Access not in [OWNER]", permissionsText: "-R",
        }],
      ], chimpy);
      assert.equal(resp.status, 200);
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc4}/replace`, {
        sourceDocId: doc3,
      }, kiwi);
      assert.equal(resp.status, 403);
      assert.match(resp.data.error, /not authorized/);
      resp = await axios.post(`${serverUrl}/api/docs/${doc3}/tables/_grist_ACLRules/data/delete`,
        [2], chimpy);
      assert.equal(resp.status, 200);
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc4}/replace`, {
        sourceDocId: doc3,
      }, kiwi);
      assert.equal(resp.status, 200);
    } finally {
      await userApi.deleteDoc(doc1);
      await userApi.deleteDoc(doc2);
      await userApi.deleteDoc(doc3);
      await userApi.deleteDoc(doc4);
    }
  });

  it("GET /docs/{did}/snapshots retrieves a list of snapshots", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/snapshots`, chimpy);
    assert.equal(resp.status, 200);
    assert.isAtLeast(resp.data.snapshots.length, 1);
    assert.hasAllKeys(resp.data.snapshots[0], ["docId", "lastModified", "snapshotId"]);
  });

  it("POST /docs/{did}/states/remove removes old states", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    // Check doc has plenty of states.
    let resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/states`, chimpy);
    assert.equal(resp.status, 200);
    const states: DocState[] = resp.data.states;
    assert.isAbove(states.length, 5);

    // Remove all but 3.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/states/remove`, { keep: 3 }, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/states`, chimpy);
    assert.equal(resp.status, 200);
    assert.lengthOf(resp.data.states, 3);
    assert.equal(resp.data.states[0].h, states[0].h);
    assert.equal(resp.data.states[1].h, states[1].h);
    assert.equal(resp.data.states[2].h, states[2].h);

    // Remove all but 1.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/states/remove`, { keep: 1 }, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/states`, chimpy);
    assert.equal(resp.status, 200);
    assert.lengthOf(resp.data.states, 1);
    assert.equal(resp.data.states[0].h, states[0].h);
  });

  it("GET /docs/{did1}/compare/{did2} tracks changes between docs", async function() {
    const { serverUrl, docs } = getCtx();
    // Pass kiwi's headers as it contains both Authorization and Origin headers
    // if run behind a proxy, so we can ensure that the Origin header check is not made.
    const userApiServerUrl = docs.proxiedServer ? serverUrl : undefined;
    const chimpyApi = makeUserApi(ORG_NAME, "chimpy", { baseUrl: userApiServerUrl });
    const ws1 = (await chimpyApi.getOrgWorkspaces("current"))[0].id;
    const docId1 = await chimpyApi.newDoc({ name: "testdoc1" }, ws1);
    const docId2 = await chimpyApi.newDoc({ name: "testdoc2" }, ws1);
    const doc1 = chimpyApi.getDocAPI(docId1);
    const doc2 = chimpyApi.getDocAPI(docId2);

    // Stick some content in column A so it has a defined type
    await doc2.addRows("Table1", { A: [0] });

    let comp = await doc1.compareDoc(docId2);
    assert.hasAllKeys(comp, ["left", "right", "parent", "summary"]);
    assert.equal(comp.summary, "unrelated");
    assert.equal(comp.parent, null);
    assert.hasAllKeys(comp.left, ["n", "h"]);
    assert.hasAllKeys(comp.right, ["n", "h"]);
    assert.equal(comp.left.n, 1);
    assert.equal(comp.right.n, 2);

    await doc1.replace({ sourceDocId: docId2 });

    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, "same");
    assert.equal(comp.left.n, 2);
    assert.deepEqual(comp.left, comp.right);
    assert.deepEqual(comp.left, comp.parent);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, { detail: true });
    assert.deepEqual(comp.details, {
      leftChanges: { tableRenames: [], tableDeltas: {} },
      rightChanges: { tableRenames: [], tableDeltas: {} },
    });

    await doc1.addRows("Table1", { A: [1] });
    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, "left");
    assert.equal(comp.left.n, 3);
    assert.equal(comp.right.n, 2);
    assert.deepEqual(comp.right, comp.parent);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, { detail: true });
    assert.deepEqual(comp.details!.rightChanges,
      { tableRenames: [], tableDeltas: {} });
    const addA1: ActionSummary = {
      tableRenames: [],
      tableDeltas: {
        Table1: {
          updateRows: [],
          removeRows: [],
          addRows: [2],
          columnDeltas: {
            A: { [2]: [null, [1]] },
            manualSort: { [2]: [null, [2]] },
          },
          columnRenames: [],
        },
      },
    };
    assert.deepEqual(comp.details!.leftChanges, addA1);

    await doc2.addRows("Table1", { A: [1] });
    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, "both");
    assert.equal(comp.left.n, 3);
    assert.equal(comp.right.n, 3);
    assert.equal(comp.parent!.n, 2);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, { detail: true });
    assert.deepEqual(comp.details!.leftChanges, addA1);
    assert.deepEqual(comp.details!.rightChanges, addA1);

    await doc1.replace({ sourceDocId: docId2 });

    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, "same");
    assert.equal(comp.left.n, 3);
    assert.deepEqual(comp.left, comp.right);
    assert.deepEqual(comp.left, comp.parent);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, { detail: true });
    assert.deepEqual(comp.details, {
      leftChanges: { tableRenames: [], tableDeltas: {} },
      rightChanges: { tableRenames: [], tableDeltas: {} },
    });

    await doc2.addRows("Table1", { A: range(2, 100) });
    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, "right");
    assert.equal(comp.left.n, 3);
    assert.equal(comp.right.n, 4);
    assert.deepEqual(comp.left, comp.parent);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, { detail: true });
    assert.deepEqual(comp.details!.leftChanges,
      { tableRenames: [], tableDeltas: {} });
    const addA2To99Truncated: ActionSummary = {
      tableRenames: [],
      tableDeltas: {
        Table1: {
          updateRows: [],
          removeRows: [],
          addRows: range(3, 101),
          columnDeltas: {
            A: [...range(3, 12), 100].reduce(
              (acc, cur) => ({ ...acc, [cur]: [null, [cur - 1]] }),
              {},
            ),
            manualSort: [...range(3, 12), 100].reduce(
              (acc, cur) => ({ ...acc, [cur]: [null, [cur]] }),
              {},
            ),
          },
          columnRenames: [],
        },
      },
    };
    assert.deepEqual(comp.details!.rightChanges, addA2To99Truncated);

    const addA2To99Full: ActionSummary = {
      tableRenames: [],
      tableDeltas: {
        Table1: {
          updateRows: [],
          removeRows: [],
          addRows: range(3, 101),
          columnDeltas: {
            A: range(3, 101).reduce(
              (acc, cur) => ({ ...acc, [cur]: [null, [cur - 1]] }),
              {},
            ),
            manualSort: range(3, 101).reduce(
              (acc, cur) => ({ ...acc, [cur]: [null, [cur]] }),
              {},
            ),
          },
          columnRenames: [],
        },
      },
    };
    for (const maxRows of [100, null]) {
      comp = await doc1.compareDoc(docId2, { detail: true, maxRows });
      assert.deepEqual(comp.details!.rightChanges, addA2To99Full);
    }
  });

  it("GET /docs/{did}/compare tracks changes within a doc", async function() {
    const { userApi } = getCtx();
    // Create a test document.
    const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
    const docId = await userApi.newDoc({ name: "testdoc" }, ws1);
    const doc = userApi.getDocAPI(docId);

    // Give the document some history.
    await doc.addRows("Table1", { A: ["a1"], B: ["b1"] });
    await doc.addRows("Table1", { A: ["a2"], B: ["b2"] });
    await doc.updateRows("Table1", { id: [1], A: ["A1"] });

    // Examine the most recent change, from HEAD~ to HEAD.
    let comp = await doc.compareVersion("HEAD~", "HEAD");
    assert.hasAllKeys(comp, ["left", "right", "parent", "summary", "details"]);
    assert.equal(comp.summary, "right");
    assert.deepEqual(comp.parent, comp.left);
    assert.notDeepEqual(comp.parent, comp.right);
    assert.hasAllKeys(comp.left, ["n", "h"]);
    assert.hasAllKeys(comp.right, ["n", "h"]);
    assert.equal(comp.left.n, 3);
    assert.equal(comp.right.n, 4);
    assert.deepEqual(comp.details!.leftChanges, { tableRenames: [], tableDeltas: {} });
    assert.deepEqual(comp.details!.rightChanges, {
      tableRenames: [],
      tableDeltas: {
        Table1: {
          updateRows: [1],
          removeRows: [],
          addRows: [],
          columnDeltas: {
            A: { [1]: [["a1"], ["A1"]] },
          },
          columnRenames: [],
        },
      },
    });

    // Check we get the same result with actual hashes.
    assert.notMatch(comp.left.h, /HEAD/);
    assert.notMatch(comp.right.h, /HEAD/);
    const comp2 = await doc.compareVersion(comp.left.h, comp.right.h);
    assert.deepEqual(comp, comp2);

    // Check that comparing the HEAD with itself shows no changes.
    comp = await doc.compareVersion("HEAD", "HEAD");
    assert.equal(comp.summary, "same");
    assert.deepEqual(comp.parent, comp.left);
    assert.deepEqual(comp.parent, comp.right);
    assert.deepEqual(comp.details!.leftChanges, { tableRenames: [], tableDeltas: {} });
    assert.deepEqual(comp.details!.rightChanges, { tableRenames: [], tableDeltas: {} });

    // Examine the combination of the last two changes.
    comp = await doc.compareVersion("HEAD~~", "HEAD");
    assert.hasAllKeys(comp, ["left", "right", "parent", "summary", "details"]);
    assert.equal(comp.summary, "right");
    assert.deepEqual(comp.parent, comp.left);
    assert.notDeepEqual(comp.parent, comp.right);
    assert.hasAllKeys(comp.left, ["n", "h"]);
    assert.hasAllKeys(comp.right, ["n", "h"]);
    assert.equal(comp.left.n, 2);
    assert.equal(comp.right.n, 4);
    assert.deepEqual(comp.details!.leftChanges, { tableRenames: [], tableDeltas: {} });
    assert.deepEqual(comp.details!.rightChanges, {
      tableRenames: [],
      tableDeltas: {
        Table1: {
          updateRows: [1],
          removeRows: [],
          addRows: [2],
          columnDeltas: {
            A: {
              [1]: [["a1"], ["A1"]],
              [2]: [null, ["a2"]],
            },
            B: { [2]: [null, ["b2"]] },
            manualSort: { [2]: [null, [2]] },
          },
          columnRenames: [],
        },
      },
    });
  });

  it("doc worker endpoints ignore any /dw/.../ prefix", async function() {
    const { homeUrl, docs, docIds, chimpy } = getCtx();
    if (docs.proxiedServer) {
      this.skip();
    }
    const docWorkerUrl = docs.serverUrl;
    let resp = await axios.get(`${docWorkerUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 200);
    assert.containsAllKeys(resp.data, ["A", "B", "C"]);

    resp = await axios.get(`${docWorkerUrl}/dw/zing/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 200);
    assert.containsAllKeys(resp.data, ["A", "B", "C"]);

    if (docWorkerUrl !== homeUrl) {
      resp = await axios.get(`${homeUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
      assert.equal(resp.status, 200);
      assert.containsAllKeys(resp.data, ["A", "B", "C"]);

      resp = await axios.get(`${homeUrl}/dw/zing/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
      assert.equal(resp.status, 404);
    }
  });
}
