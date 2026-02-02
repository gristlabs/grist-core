/**
 * Tests for column operations.
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

describe("DocApiColumns", function() {
  this.timeout(30000);
  testUtils.setTmpLogLevel("error");

  addAllScenarios(addColumnsTests, "docapi-columns");
});

function addColumnsTests(getCtx: () => TestContext) {
  async function generateDocAndUrl(docName: string = "Dummy") {
    const { serverUrl, userApi } = getCtx();
    const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
    const docId = await userApi.newDoc({ name: docName }, wid);
    return {
      docId,
      url: `${serverUrl}/api/docs/${docId}/tables/Table1/columns`,
    };
  }

  it("GET /docs/{did}/tables/{tid}/columns retrieves columns", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const data = {
      columns: [
        {
          id: "A",
          fields: {
            colRef: 2,
            parentId: 1,
            parentPos: 1,
            type: "Text",
            widgetOptions: "",
            isFormula: false,
            formula: "",
            label: "A",
            description: "",
            untieColIdFromLabel: false,
            summarySourceCol: 0,
            displayCol: 0,
            visibleCol: 0,
            rules: null,
            recalcWhen: 0,
            recalcDeps: null,
            reverseCol: 0,
          },
        },
        {
          id: "B",
          fields: {
            colRef: 3,
            parentId: 1,
            parentPos: 2,
            type: "Text",
            widgetOptions: "",
            isFormula: false,
            formula: "",
            label: "B",
            description: "",
            untieColIdFromLabel: false,
            summarySourceCol: 0,
            displayCol: 0,
            visibleCol: 0,
            rules: null,
            recalcWhen: 0,
            recalcDeps: null,
            reverseCol: 0,
          },
        },
        {
          id: "C",
          fields: {
            colRef: 4,
            parentId: 1,
            parentPos: 3,
            type: "Text",
            widgetOptions: "",
            isFormula: false,
            formula: "",
            label: "C",
            description: "",
            untieColIdFromLabel: false,
            summarySourceCol: 0,
            displayCol: 0,
            visibleCol: 0,
            rules: null,
            recalcWhen: 0,
            recalcDeps: null,
            reverseCol: 0,
          },
        },
        {
          id: "D",
          fields: {
            colRef: 5,
            parentId: 1,
            parentPos: 3,
            type: "Any",
            widgetOptions: "",
            isFormula: true,
            formula: "",
            label: "D",
            description: "",
            untieColIdFromLabel: false,
            summarySourceCol: 0,
            displayCol: 0,
            visibleCol: 0,
            rules: null,
            recalcWhen: 0,
            recalcDeps: null,
            reverseCol: 0,
          },
        },
        {
          id: "E",
          fields: {
            colRef: 6,
            parentId: 1,
            parentPos: 4,
            type: "Any",
            widgetOptions: "",
            isFormula: true,
            formula: "$A.upper()",
            label: "E",
            description: "",
            untieColIdFromLabel: false,
            summarySourceCol: 0,
            displayCol: 0,
            visibleCol: 0,
            rules: null,
            recalcWhen: 0,
            recalcDeps: null,
            reverseCol: 0,
          },
        },
      ],
    };
    const respWithTableId = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/columns`, chimpy);
    assert.equal(respWithTableId.status, 200);
    assert.deepEqual(respWithTableId.data, data);
    const respWithTableRef = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/1/columns`, chimpy);
    assert.equal(respWithTableRef.status, 200);
    assert.deepEqual(respWithTableRef.data, data);
  });

  it('GET /docs/{did}/tables/{tid}/columns retrieves hidden columns when "hidden" is set', async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const params = { hidden: true };
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/columns`,
      { ...chimpy, params },
    );
    assert.equal(resp.status, 200);
    const columnsMap = new Map(resp.data.columns.map(({ id, fields}: { id: string, fields: object }) => [id, fields]));
    assert.include([...columnsMap.keys()], "manualSort");
    assert.deepInclude(columnsMap.get("manualSort"), {
      colRef: 1,
      type: "ManualSortPos",
    });
  });

  it("GET /docs/{did}/tables/{tid}/columns returns 404 for non-existent doc", async function() {
    const { serverUrl, chimpy } = getCtx();
    const resp = await axios.get(`${serverUrl}/api/docs/typotypotypo/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /document not found/i);
  });

  it("GET /docs/{did}/tables/{tid}/columns returns 404 for non-existent table", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Typo1/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /table not found/i);
  });

  describe("/docs/{did}/tables/{tid}/columns", function() {
    async function generateDocAndUrlForColumns(name: string) {
      const { url, docId } = await generateDocAndUrl(name);
      return { docId, url };
    }

    describe("PUT /docs/{did}/tables/{tid}/columns", function() {
      async function getColumnFieldsMapById(url: string, params: any) {
        const { chimpy } = getCtx();
        const result = await axios.get(url, { ...chimpy, params });
        assert.equal(result.status, 200);
        return new Map<string, object>(
          result.data.columns.map(
            ({ id, fields}: { id: string, fields: object }) => [id, fields],
          ),
        );
      }

      interface RecordWithStringId {
        id: string;
        fields: Record<string, any>;
      }

      async function checkPut(
        columns: [RecordWithStringId, ...RecordWithStringId[]],
        params: Record<string, any>,
        expectedFieldsByColId: Record<string, object>,
        opts?: { getParams?: any },
      ) {
        const { chimpy } = getCtx();
        const { url } = await generateDocAndUrlForColumns("ColumnsPut");
        const body = { columns };
        const resp = await axios.put(url, body, { ...chimpy, params });
        assert.equal(resp.status, 200);
        const fieldsByColId = await getColumnFieldsMapById(url, opts?.getParams);

        assert.deepEqual(
          [...fieldsByColId.keys()],
          Object.keys(expectedFieldsByColId),
          "The updated table should have the expected columns",
        );

        for (const [colId, expectedFields] of Object.entries(expectedFieldsByColId)) {
          assert.deepInclude(fieldsByColId.get(colId), expectedFields);
        }
      }

      const COLUMN_TO_ADD = {
        id: "Foo",
        fields: {
          type: "Text",
          label: "FooLabel",
        },
      };

      const COLUMN_TO_UPDATE = {
        id: "A",
        fields: {
          type: "Numeric",
          colId: "NewA",
        },
      };

      it("should create new columns", async function() {
        await checkPut([COLUMN_TO_ADD], {}, {
          A: {}, B: {}, C: {}, Foo: COLUMN_TO_ADD.fields,
        });
      });

      it("should update existing columns and create new ones", async function() {
        await checkPut([COLUMN_TO_ADD, COLUMN_TO_UPDATE], {}, {
          NewA: { type: "Numeric", label: "A" }, B: {}, C: {}, Foo: COLUMN_TO_ADD.fields,
        });
      });

      it("should only update existing columns when noadd is set", async function() {
        await checkPut([COLUMN_TO_ADD, COLUMN_TO_UPDATE], { noadd: "1" }, {
          NewA: { type: "Numeric" }, B: {}, C: {},
        });
      });

      it("should only add columns when noupdate is set", async function() {
        await checkPut([COLUMN_TO_ADD, COLUMN_TO_UPDATE], { noupdate: "1" }, {
          A: { type: "Any" }, B: {}, C: {}, Foo: COLUMN_TO_ADD.fields,
        });
      });

      it("should remove existing columns if replaceall is set", async function() {
        await checkPut([COLUMN_TO_ADD, COLUMN_TO_UPDATE], { replaceall: "1" }, {
          NewA: { type: "Numeric" }, Foo: COLUMN_TO_ADD.fields,
        });
      });

      it("should NOT remove hidden columns even when replaceall is set", async function() {
        await checkPut([COLUMN_TO_ADD, COLUMN_TO_UPDATE], { replaceall: "1" }, {
          manualSort: { type: "ManualSortPos" }, NewA: { type: "Numeric" }, Foo: COLUMN_TO_ADD.fields,
        }, { getParams: { hidden: true } });
      });

      it("should forbid update by viewers", async function() {
        const { userApi, kiwi } = getCtx();
        // given
        const { url, docId } = await generateDocAndUrlForColumns("ColumnsPut");
        await userApi.updateDocPermissions(docId, { users: { "kiwi@getgrist.com": "viewers" } });

        // when
        const resp = await axios.put(url, { columns: [COLUMN_TO_ADD] }, kiwi);

        // then
        assert.equal(resp.status, 403);
      });

      it("should return 404 when table is not found", async function() {
        const { chimpy } = getCtx();
        // given
        const { url } = await generateDocAndUrlForColumns("ColumnsPut");
        const notFoundUrl = url.replace("Table1", "NonExistingTable");

        // when
        const resp = await axios.put(notFoundUrl, { columns: [COLUMN_TO_ADD] }, chimpy);

        // then
        assert.equal(resp.status, 404);
        assert.equal(resp.data.error, 'Table not found "NonExistingTable"');
      });
    });

    describe("DELETE /docs/{did}/tables/{tid}/columns/{colId}", function() {
      it("should delete some column", async function() {
        const { chimpy } = getCtx();
        const { url } = await generateDocAndUrlForColumns("ColumnDelete");
        const deleteUrl = url + "/A";
        const resp = await axios.delete(deleteUrl, chimpy);

        assert.equal(resp.status, 200, "Should succeed in requesting column deletion");

        const listColResp = await axios.get(url, { ...chimpy, params: { hidden: true } });
        assert.equal(listColResp.status, 200, "Should succeed in listing columns");

        const columnIds = listColResp.data.columns.map(({ id}: { id: string }) => id).sort();
        assert.deepEqual(columnIds, ["B", "C", "manualSort"]);
      });

      it("should return 404 if table not found", async function() {
        const { chimpy } = getCtx();
        const { url } = await generateDocAndUrlForColumns("ColumnDelete");
        const deleteUrl = url.replace("Table1", "NonExistingTable") + "/A";
        const resp = await axios.delete(deleteUrl, chimpy);

        assert.equal(resp.status, 404);
        assert.equal(resp.data.error, 'Table or column not found "NonExistingTable.A"');
      });

      it("should return 404 if column not found", async function() {
        const { chimpy } = getCtx();
        const { url } = await generateDocAndUrlForColumns("ColumnDelete");
        const deleteUrl = url + "/NonExistingColId";
        const resp = await axios.delete(deleteUrl, chimpy);

        assert.equal(resp.status, 404);
        assert.equal(resp.data.error, 'Table or column not found "Table1.NonExistingColId"');
      });

      it("should forbid column deletion by viewers", async function() {
        const { userApi, kiwi } = getCtx();
        const { url, docId } = await generateDocAndUrlForColumns("ColumnDelete");
        await userApi.updateDocPermissions(docId, { users: { "kiwi@getgrist.com": "viewers" } });
        const deleteUrl = url + "/A";
        const resp = await axios.delete(deleteUrl, kiwi);

        assert.equal(resp.status, 403);
      });
    });
  });
}
