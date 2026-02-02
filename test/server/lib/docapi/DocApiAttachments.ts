/**
 * Tests for attachment operations:
 * - POST /docs/{did}/attachments (upload)
 * - GET /docs/{did}/attachments (list)
 * - GET /docs/{did}/attachments/{id} (metadata)
 * - GET /docs/{did}/attachments/{id}/download
 * - GET /docs/{did}/attachments/archive
 * - POST /docs/{did}/attachments/updateUsed
 * - POST /docs/{did}/attachments/removeUnused
 * - External attachment stores
 *
 * Tests run in multiple server configurations:
 * - Merged server (home + docs in one process)
 * - Separated servers (home + docworker, requires Redis)
 * - Direct to docworker (requires Redis)
 */

import { UserAction } from "app/common/DocActions";
import { arrayRepeat } from "app/common/gutil";
import { Record as ApiRecord } from "app/plugin/DocApiTypes";
import { addAllScenarios, TestContext } from "test/server/lib/docapi/scenarios";
import * as testUtils from "test/server/testUtils";
import { readFixtureDoc } from "test/server/testUtils";

import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { assert } from "chai";
import decompress from "decompress";
import FormData from "form-data";
import * as _ from "lodash";
import defaultsDeep from "lodash/defaultsDeep";

describe("DocApiAttachments", function() {
  this.timeout(30000);
  testUtils.setTmpLogLevel("error");

  addAllScenarios(addAttachmentsTests, "docapi-attachments");
});

function checkError(status: number, pattern: RegExp, resp: AxiosResponse) {
  assert.equal(resp.status, status);
  assert.match(resp.data.error, pattern);
}

async function addAttachmentsToDoc(
  serverUrl: string,
  docId: string,
  attachments: { name: string; contents: string }[],
  config: AxiosRequestConfig,
) {
  const formData = new FormData();
  for (const attachment of attachments) {
    formData.append("upload", attachment.contents, attachment.name);
  }
  const resp = await axios.post(`${serverUrl}/api/docs/${docId}/attachments`, formData,
    defaultsDeep({ headers: formData.getHeaders() }, config));
  assert.equal(resp.status, 200);
  return resp;
}

function addAttachmentsTests(getCtx: () => TestContext) {
  async function getWorkspaceId(name: string): Promise<number> {
    const { userApi } = getCtx();
    const workspaces = await userApi.getOrgWorkspaces("current");
    return workspaces.find(w => w.name === name)!.id;
  }

  describe("attachments", function() {
    it("POST /docs/{did}/attachments adds attachments", async function() {
      const { homeUrl, docIds, chimpy } = getCtx();
      const uploadResp = await addAttachmentsToDoc(homeUrl, docIds.TestDoc, [
        { name: "hello.doc", contents: "foobar" },
        { name: "world.jpg", contents: "123456" },
      ], chimpy);
      assert.deepEqual(uploadResp.data, [1, 2]);

      // Another upload gets the next number.
      const upload2Resp = await addAttachmentsToDoc(homeUrl, docIds.TestDoc, [
        { name: "hello.png", contents: "abcdef" },
      ], chimpy);
      assert.deepEqual(upload2Resp.data, [3]);
    });

    it("GET /docs/{did}/attachments lists attachment metadata", async function() {
      const { homeUrl, docIds, chimpy } = getCtx();
      // Test that the usual /records query parameters like sort and filter also work
      const url = `${homeUrl}/api/docs/${docIds.TestDoc}/attachments?sort=-fileName&limit=2`;
      const resp = await axios.get(url, chimpy);
      assert.equal(resp.status, 200);
      const { records } = resp.data;
      for (const record of records) {
        assert.match(record.fields.timeUploaded, /^\d{4}-\d{2}-\d{2}T/);
        delete record.fields.timeUploaded;
      }
      assert.deepEqual(records, [
        { id: 2, fields: { fileName: "world.jpg", fileSize: 6 } },
        { id: 3, fields: { fileName: "hello.png", fileSize: 6 } },
      ],
      );
    });

    it("GET /docs/{did}/attachments/{id} returns attachment metadata", async function() {
      const { homeUrl, docIds, chimpy } = getCtx();
      const resp = await axios.get(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments/2`, chimpy);
      assert.equal(resp.status, 200);
      assert.include(resp.data, { fileName: "world.jpg", fileSize: 6 });
      assert.match(resp.data.timeUploaded, /^\d{4}-\d{2}-\d{2}T/);
    });

    it("GET /docs/{did}/attachments/{id}/download downloads attachment contents", async function() {
      const { homeUrl, docIds, chimpy } = getCtx();
      const resp = await axios.get(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments/2/download`,
        { ...chimpy, responseType: "arraybuffer" });
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers["content-type"], "image/jpeg");
      assert.deepEqual(resp.headers["content-disposition"], 'attachment; filename="world.jpg"');
      assert.deepEqual(resp.headers["cache-control"], "private, max-age=3600");
      assert.deepEqual(resp.data, Buffer.from("123456"));
    });

    async function assertArchiveContents(
      archive: string | Buffer, expectedFiles: { name: string; contents?: string }[],
    ) {
      const getFileName = (filePath: string) => filePath.substring(filePath.indexOf("_") + 1);
      const files = await decompress(archive);
      for (const expectedFile of expectedFiles) {
        const file = files.find(file => getFileName(file.path) === expectedFile.name);
        assert(file, "file not found in archive");
        if (expectedFile.contents) {
          assert.equal(file?.data.toString(), expectedFile.contents, "file contents in archive don't match");
        }
      }
    }

    it("GET /docs/{did}/attachments/archive downloads all attachments as a .zip", async function() {
      const { homeUrl, docIds, chimpy } = getCtx();
      const resp = await axios.get(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments/archive`,
        { ...chimpy, responseType: "arraybuffer" });
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers["content-type"], "application/zip");
      assert.deepEqual(resp.headers["content-disposition"], `attachment; filename="TestDoc-Attachments.zip"`);

      await assertArchiveContents(resp.data, [
        {
          name: "hello.doc",
          contents: "foobar",
        },
        {
          name: "world.jpg",
        },
        {
          name: "hello.png",
        },
      ]);
    });

    it("GET /docs/{did}/attachments/archive downloads all attachments as a .tar", async function() {
      const { homeUrl, docIds, chimpy } = getCtx();
      const resp = await axios.get(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments/archive?format=tar`,
        { ...chimpy, responseType: "arraybuffer" });
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers["content-type"], "application/x-tar");
      assert.deepEqual(resp.headers["content-disposition"], `attachment; filename="TestDoc-Attachments.tar"`);

      await assertArchiveContents(resp.data, [
        {
          name: "hello.doc",
          contents: "foobar",
        },
        {
          name: "world.jpg",
        },
        {
          name: "hello.png",
        },
      ]);
    });

    it("GET /docs/{did}/attachments/{id}/download works after doc shutdown", async function() {
      const { homeUrl, docIds, chimpy } = getCtx();
      // Check that we can download when ActiveDoc isn't currently open.
      let resp = await axios.post(`${homeUrl}/api/docs/${docIds.TestDoc}/force-reload`, null, chimpy);
      assert.equal(resp.status, 200);
      resp = await axios.get(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments/2/download`,
        { ...chimpy, responseType: "arraybuffer" });
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers["content-type"], "image/jpeg");
      assert.deepEqual(resp.headers["content-disposition"], 'attachment; filename="world.jpg"');
      assert.deepEqual(resp.headers["cache-control"], "private, max-age=3600");
      assert.deepEqual(resp.data, Buffer.from("123456"));
    });

    it("GET /docs/{did}/attachments/{id}... returns 404 when attachment not found", async function() {
      const { homeUrl, docIds, chimpy } = getCtx();
      let resp = await axios.get(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments/22`, chimpy);
      checkError(404, /Attachment not found: 22/, resp);
      resp = await axios.get(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments/moo`, chimpy);
      checkError(400, /parameter cannot be understood as an integer: moo/, resp);
      resp = await axios.get(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments/22/download`, chimpy);
      checkError(404, /Attachment not found: 22/, resp);
      resp = await axios.get(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments/moo/download`, chimpy);
      checkError(400, /parameter cannot be understood as an integer: moo/, resp);
    });

    it("POST /docs/{did}/attachments produces reasonable errors", async function() {
      const { homeUrl, docIds, chimpy } = getCtx();
      // Check that it produces reasonable errors if we try to use it with non-form-data
      let resp = await axios.post(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments`, [4, 5, 6], chimpy);
      assert.equal(resp.status, 415);     // Wrong content-type

      // Check for an error if there is no data included.
      const formData = new FormData();
      resp = await axios.post(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments`, formData,
        defaultsDeep({ headers: formData.getHeaders() }, chimpy));
      assert.equal(resp.status, 400);
      // TODO The error here is "stream ended unexpectedly", which isn't really reasonable.
    });

    it("POST/GET /docs/{did}/attachments respect document permissions", async function() {
      const { homeUrl, docIds, kiwi } = getCtx();
      const formData = new FormData();
      formData.append("upload", "xyzzz", "wrong.png");
      let resp = await axios.post(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments`, formData,
        defaultsDeep({ headers: formData.getHeaders() }, kiwi));
      checkError(403, /No view access/, resp);

      resp = await axios.get(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments/3`, kiwi);
      checkError(403, /No view access/, resp);

      resp = await axios.get(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments/3/download`, kiwi);
      checkError(403, /No view access/, resp);
    });

    it("POST /docs/{did}/attachments respects untrusted content-type only if valid", async function() {
      const { homeUrl, docIds, chimpy } = getCtx();
      const formData = new FormData();
      formData.append("upload", "xyz", { filename: "foo", contentType: "application/pdf" });
      formData.append("upload", "abc", { filename: "hello.png", contentType: "invalid/content-type" });
      formData.append("upload", "def", { filename: "world.doc", contentType: "text/plain\nbad-header: 1\n\nEvil" });
      let resp = await axios.post(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments`, formData,
        defaultsDeep({ headers: formData.getHeaders() }, chimpy));
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, [4, 5, 6]);

      resp = await axios.get(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments/4/download`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers["content-type"], "application/pdf");    // A valid content-type is respected
      assert.deepEqual(resp.headers["content-disposition"], 'attachment; filename="foo.pdf"');
      assert.deepEqual(resp.data, "xyz");

      resp = await axios.get(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments/5/download`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers["content-type"], "image/png");    // Did not pay attention to invalid header
      assert.deepEqual(resp.headers["content-disposition"], 'attachment; filename="hello.png"');
      assert.deepEqual(resp.data, "abc");

      resp = await axios.get(`${homeUrl}/api/docs/${docIds.TestDoc}/attachments/6/download`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers["content-type"], "application/msword");    // Another invalid header ignored
      assert.deepEqual(resp.headers["content-disposition"], 'attachment; filename="world.doc"');
      assert.deepEqual(resp.headers["cache-control"], "private, max-age=3600");
      assert.deepEqual(resp.headers["bad-header"], undefined);   // Attempt to hack in more headers didn't work
      assert.deepEqual(resp.data, "def");
    });

    it("POST /docs/{did}/attachments/updateUsed updates timeDeleted on metadata", async function() {
      const { homeUrl, userApi, chimpy } = getCtx();
      const wid = await getWorkspaceId("Private");
      const docId = await userApi.newDoc({ name: "TestDoc2" }, wid);

      // Apply the given user actions,
      // POST to /attachments/updateUsed
      // Check that Table1 and _grist_Attachments contain the expected rows
      async function check(
        actions: UserAction[],
        userData: { id: number, Attached: any }[],
        metaData: { id: number, deleted: boolean }[],
      ) {
        const docUrl = `${homeUrl}/api/docs/${docId}`;

        let resp = await axios.post(`${docUrl}/apply`, actions, chimpy);
        assert.equal(resp.status, 200);

        resp = await axios.post(`${docUrl}/attachments/updateUsed`, null, chimpy);
        assert.equal(resp.status, 200);

        resp = await axios.get(`${docUrl}/tables/Table1/records`, chimpy);
        const actualUserData = resp.data.records.map(
          ({ id, fields: { Attached } }: ApiRecord) =>
            ({ id, Attached }),
        );
        assert.deepEqual(actualUserData, userData);

        resp = await axios.get(`${docUrl}/tables/_grist_Attachments/records`, chimpy);
        const actualMetaData = resp.data.records.map(
          ({ id, fields: { timeDeleted } }: ApiRecord) =>
            ({ id, deleted: Boolean(timeDeleted) }),
        );
        assert.deepEqual(actualMetaData, metaData);
      }

      // Set up the document and initial data.
      await check(
        [
          ["AddColumn", "Table1", "Attached", { type: "Attachments" }],
          ["BulkAddRecord", "Table1", [1, 2], { Attached: [["L", 1], ["L", 2, 3]] }],
          // There's no actual attachments here but that doesn't matter
          ["BulkAddRecord", "_grist_Attachments", [1, 2, 3], {}],
        ],
        [
          { id: 1, Attached: ["L", 1] },
          { id: 2, Attached: ["L", 2, 3] },
        ],
        [
          { id: 1, deleted: false },
          { id: 2, deleted: false },
          { id: 3, deleted: false },
        ],
      );

      // Remove the record containing ['L', 2, 3], so the metadata for 2 and 3 now says deleted
      await check(
        [["RemoveRecord", "Table1", 2]],
        [
          { id: 1, Attached: ["L", 1] },
        ],
        [
          { id: 1, deleted: false },
          { id: 2, deleted: true },  // deleted here
          { id: 3, deleted: true },  // deleted here
        ],
      );

      // Add back a reference to attachment 2 to test 'undeletion', plus some junk values
      await check(
        [["BulkAddRecord", "Table1", [3, 4, 5], { Attached: [null, "foo", ["L", 2, 2, 4, 4, 5]] }]],
        [
          { id: 1, Attached: ["L", 1] },
          { id: 3, Attached: null },
          { id: 4, Attached: "foo" },
          { id: 5, Attached: ["L", 2, 2, 4, 4, 5] },
        ],
        [
          { id: 1, deleted: false },
          { id: 2, deleted: false },  // undeleted here
          { id: 3, deleted: true },
        ],
      );

      // Remove the whole column to test what happens when there's no Attachment columns
      await check(
        [["RemoveColumn", "Table1", "Attached"]],
        [
          { id: 1, Attached: undefined },
          { id: 3, Attached: undefined },
          { id: 4, Attached: undefined },
          { id: 5, Attached: undefined },
        ],
        [
          { id: 1, deleted: true },  // deleted here
          { id: 2, deleted: true },  // deleted here
          { id: 3, deleted: true },
        ],
      );

      // Test performance with a large number of records and attachments.
      const numRecords = 10000;
      const attachmentsPerRecord = 4;
      const totalUsedAttachments = numRecords * attachmentsPerRecord;
      const totalAttachments = totalUsedAttachments * 1.1;

      const attachedValues = _.chunk(_.range(1, totalUsedAttachments + 1), attachmentsPerRecord)
        .map(arr => ["L", ...arr]);
      await check(
        [
          // Reset the state: add back the removed column and delete the previously added data
          ["AddColumn", "Table1", "Attached", { type: "Attachments" }],
          ["BulkRemoveRecord", "Table1", [1, 3, 4, 5]],
          ["BulkRemoveRecord", "_grist_Attachments", [1, 2, 3]],
          ["BulkAddRecord", "Table1", arrayRepeat(numRecords, null), { Attached: attachedValues }],
          ["BulkAddRecord", "_grist_Attachments", arrayRepeat(totalAttachments, null), {}],
        ],
        attachedValues.map((Attached, index) => ({ id: index + 1, Attached })),
        _.range(totalAttachments).map(index => ({ id: index + 1, deleted: index >= totalUsedAttachments })),
      );
    });

    it("POST /docs/{did}/attachments/removeUnused removes unused attachments", async function() {
      const { homeUrl, userApi, chimpy } = getCtx();
      const wid = await getWorkspaceId("Private");
      const docId = await userApi.newDoc({ name: "TestDoc3" }, wid);
      const docUrl = `${homeUrl}/api/docs/${docId}`;

      const formData = new FormData();
      formData.append("upload", "foobar", "hello.doc");
      formData.append("upload", "123456", "world.jpg");
      formData.append("upload", "foobar", "hello2.doc");
      let resp = await axios.post(`${docUrl}/attachments`, formData,
        defaultsDeep({ headers: formData.getHeaders() }, chimpy));
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, [1, 2, 3]);

      async function checkAttachmentIds(ids: number[]) {
        resp = await axios.get(`${docUrl}/attachments`, chimpy);
        assert.equal(resp.status, 200);
        assert.deepEqual(resp.data.records.map((r: any) => r.id), ids);
      }

      resp = await axios.patch(
        `${docUrl}/tables/_grist_Attachments/records`,
        {
          records: [
            { id: 1, fields: { timeDeleted: Date.now() / 1000 - 8 * 24 * 60 * 60 } },  // 8 days ago, i.e. expired
            { id: 2, fields: { timeDeleted: Date.now() / 1000 - 6 * 24 * 60 * 60 } },  // 6 days ago, i.e. not expired
          ],
        },
        chimpy,
      );
      assert.equal(resp.status, 200);
      await checkAttachmentIds([1, 2, 3]);

      // Remove the expired attachment (1) by force-reloading, so it removes it during shutdown.
      resp = await axios.post(`${docUrl}/force-reload`, null, chimpy);
      assert.equal(resp.status, 200);
      await checkAttachmentIds([2, 3]);
      resp = await axios.post(`${docUrl}/attachments/verifyFiles`, null, chimpy);
      assert.equal(resp.status, 200);

      // Remove the not expired attachments (2 and 3).
      resp = await axios.post(`${docUrl}/attachments/removeUnused?verifyfiles=1`, null, chimpy);
      assert.equal(resp.status, 200);
      await checkAttachmentIds([]);
    });

    describe("external attachment stores", async () => {
      let docId = "";
      let docUrl = "";

      before(async () => {
        const { homeUrl, userApi, chimpy } = getCtx();
        const wid = await getWorkspaceId("Private");
        docId = await userApi.newDoc({ name: "TestDocExternalAttachments" }, wid);
        docUrl = `${homeUrl}/api/docs/${docId}`;

        const resp = await addAttachmentsToDoc(homeUrl, docId, [
          { name: "hello.doc", contents: "foobar" },
          { name: "world.jpg", contents: "123456" },
          // Duplicate of 'hello.doc', so only 2 files should be in external storage.
          { name: "hello2.doc", contents: "foobar" },
        ], chimpy);
        assert.deepEqual(resp.data, [1, 2, 3]);
      });

      after(async () => {
        const { userApi } = getCtx();
        await userApi?.deleteDoc(docId);
      });

      it("GET /docs/{did}/attachments/transferStatus reports idle transfer status", async function() {
        const { chimpy } = getCtx();
        const resp = await axios.get(`${docUrl}/attachments/transferStatus`, chimpy);
        assert.deepEqual(resp.data, {
          status: {
            pendingTransferCount: 0,
            isRunning: false,
            successes: 0,
            failures: 0,
          },
          locationSummary: "internal",
        });
      });

      it("GET /docs/{did}/attachments/store gets the external store", async function() {
        const { chimpy } = getCtx();
        const resp = await axios.get(`${docUrl}/attachments/store`, chimpy);
        assert.equal(resp.data.type, "internal");
      });

      it("POST /docs/{did}/attachments/store sets the external store", async function() {
        const { chimpy } = getCtx();
        const postResp = await axios.post(`${docUrl}/attachments/store`, {
          type: "external",
        }, chimpy);
        assert.equal(postResp.status, 200, JSON.stringify(postResp.data));

        const getResp = await axios.get(`${docUrl}/attachments/store`, chimpy);
        assert.equal(getResp.data.type, "external");
      });

      it("POST /docs/{did}/attachments/transferAll transfers all attachments", async function() {
        const { chimpy } = getCtx();
        const transferResp = await axios.post(`${docUrl}/attachments/transferAll`, {}, chimpy);

        assert.deepEqual(transferResp.data, {
          status: {
            pendingTransferCount: 2,
            isRunning: true,
            successes: 0,
            failures: 0,
          },
          locationSummary: "internal",
        });
      });

      it("GET /docs/{did}/attachments/archive downloads all attachments as a .zip when external", async function() {
        const { chimpy } = getCtx();
        const resp = await axios.get(`${docUrl}/attachments/archive`,
          { ...chimpy, responseType: "arraybuffer" });
        assert.equal(resp.status, 200);
        assert.deepEqual(resp.headers["content-type"], "application/zip");
        assert.deepEqual(resp.headers["content-disposition"],
          `attachment; filename="TestDocExternalAttachments-Attachments.zip"`,
        );

        await assertArchiveContents(resp.data, [
          {
            name: "hello.doc",
            contents: "foobar",
          },
          {
            name: "world.jpg",
          },
        ]);
      });

      it("POST /docs/{did}/attachments/archive adds missing attachments from a .tar", async function() {
        const { homeUrl, chimpy } = getCtx();
        const archiveResp = await axios.get(`${docUrl}/attachments/archive?format=tar`,
          { ...chimpy, responseType: "arraybuffer" });
        assert.equal(archiveResp.status, 200, "can download the archive");

        const docResp = await axios.get(`${docUrl}/download`,
          { ...chimpy, responseType: "arraybuffer" });
        assert.equal(docResp.status, 200, "can download the doc");

        const docWorkspaceId = (await axios.get(docUrl, chimpy)).data.workspace.id;

        const docUploadForm = new FormData();
        docUploadForm.append("upload", docResp.data, "ExternalAttachmentsMissing.grist");
        docUploadForm.append("workspaceId", docWorkspaceId);
        const docUploadResp = await axios.post(`${homeUrl}/api/docs`, docUploadForm,
          defaultsDeep({ headers: docUploadForm.getHeaders() }, chimpy));
        assert.equal(docUploadResp.status, 200, "can upload the doc");

        const newDocId = docUploadResp.data;

        const tarUploadForm = new FormData();
        tarUploadForm.append("upload", archiveResp.data, {
          filename: "AttachmentsAreHere.tar",
          contentType: "application/x-tar",
        });

        const tarUploadResp = await axios.post(`${homeUrl}/api/docs/${newDocId}/attachments/archive`, tarUploadForm,
          defaultsDeep({ headers: tarUploadForm.getHeaders() }, chimpy));
        assert.equal(tarUploadResp.status, 200, "can upload the attachment archive");

        assert.deepEqual(tarUploadResp.data, {
          added: 2,
          errored: 0,
          // One attachment in the .tar is a duplicate (identical content + extension), so it won't be used
          unused: 1,
        }, "2 attachments should be added, 1 unused, no errors");
      });

      it("POST /docs/{did}/attachments/archive errors if no .tar file is found", async function() {
        const { chimpy } = getCtx();
        const badUploadForm = new FormData();
        badUploadForm.append("upload", "Random content", {
          filename: "AttachmentsAreHere.zip",
          contentType: "application/zip",
        });

        const tarUploadResp = await axios.post(`${docUrl}/attachments/archive`, badUploadForm,
          defaultsDeep({ headers: badUploadForm.getHeaders() }, chimpy));
        assert.equal(tarUploadResp.status, 400, "should be a bad request");
      });

      it("POST /docs/{did}/attachments/archive has a useful error if a bad file is used", async function() {
        const { chimpy } = getCtx();
        const badUploadForm = new FormData();
        badUploadForm.append("upload", "Random content", {
          filename: "AttachmentsAreHere.tar",
          contentType: "application/x-tar",
        });

        const tarUploadResp = await axios.post(`${docUrl}/attachments/archive`, badUploadForm,
          defaultsDeep({ headers: badUploadForm.getHeaders() }, chimpy));
        assert.equal(tarUploadResp.status, 500, "should be a bad request");
        assert.deepEqual(tarUploadResp.data, { error: "File is not a valid .tar" });
      });

      it("POST /docs/{did}/copy doesn't throw when the document has external attachments", async function() {
        const { userApi } = getCtx();
        const worker1 = await userApi.getWorkerAPI(docId);
        await worker1.copyDoc(docId, undefined, "copy");
      });

      it("POST /docs/{did} with sourceDocId can copy a document with external attachments", async function() {
        const { homeUrl, userApi, chimpy } = getCtx();
        const chimpyWs = await userApi.newWorkspace({ name: "Chimpy's Workspace" }, "current");
        const resp = await axios.post(`${homeUrl}/api/docs`, {
          sourceDocumentId: docId,
          documentName: "copy of TestDocExternalAttachments",
          asTemplate: false,
          workspaceId: chimpyWs,
        }, chimpy);
        assert.equal(resp.status, 200);
        assert.isString(resp.data);
        // There's no expectation that the external attachments are copied - just that the document is.
      });

      it(
        `enables documents with external attachments from other installations to work when imported`,
        async function() {
          const { homeUrl, userApi, chimpy } = getCtx();
          const wid = await getWorkspaceId("Private");
          const formData = new FormData();
          formData.append(
            "upload",
            // This doc has a store id that won't exist on the server.
            // This should be updated to a valid one by the server on import.
            await readFixtureDoc("ExternalAttachmentsInvalidStoreId.grist"),
            "ExternalAttachmentsInvalidStoreId.grist",
          );
          const config = defaultsDeep({ headers: formData.getHeaders() }, chimpy);
          const importResp = await axios.post(`${homeUrl}/api/workspaces/${wid}/import`, formData, config);
          assert.equal(importResp.status, 200);
          const importedDocId = importResp.data.id;
          const docApi = userApi.getDocAPI(importedDocId);

          assert.equal((await docApi.getAttachmentStore()).type, "external");

          await addAttachmentsToDoc(homeUrl, importedDocId, [{ name: "Test.txt", contents: "Irrelevant" }], chimpy);

          const transferStatus = await docApi.getAttachmentTransferStatus();
          assert.equal(transferStatus.locationSummary, "external", "all attachments should be external");

          const url = `${homeUrl}/api/docs/${importedDocId}/attachments`;
          const resp = await axios.get(url, chimpy);
          assert.equal(resp.status, 200);
          assert.equal(resp.data.records[0].fields.fileName, "Test.txt");
        });
    });
  });
}
