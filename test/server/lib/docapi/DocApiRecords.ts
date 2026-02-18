/**
 * Tests for record operations.
 *
 * Tests run in multiple server configurations:
 * - Merged server (home + docs in one process)
 * - Separated servers (home + docworker, requires Redis)
 * - Direct to docworker (requires Redis)
 */

import { BulkColValues, CellValue } from "app/common/DocActions";
import { AddOrUpdateRecord } from "app/plugin/DocApiTypes";
import { GristObjCode } from "app/plugin/GristData";
import { addAllScenarios, TestContext } from "test/server/lib/docapi/helpers";
import * as testUtils from "test/server/testUtils";

import axios, { AxiosResponse } from "axios";
import { assert } from "chai";

describe("DocApiRecords", function() {
  this.timeout(30000);
  testUtils.setTmpLogLevel("error");

  addAllScenarios(addRecordsTests, "docapi-records");
});

function addRecordsTests(getCtx: () => TestContext) {
  it("GET /docs/{did}/tables/{tid}/data retrieves data in column format", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const data = {
      id: [1, 2, 3, 4],
      A: ["hello", "", "", ""],
      B: ["", "world", "", ""],
      C: ["", "", "", ""],
      D: [null, null, null, null],
      E: ["HELLO", "", "", ""],
      manualSort: [1, 2, 3, 4],
    };
    const respWithTableId = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
    assert.equal(respWithTableId.status, 200);
    assert.deepEqual(respWithTableId.data, data);
    const respWithTableRef = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/1/data`, chimpy);
    assert.equal(respWithTableRef.status, 200);
    assert.deepEqual(respWithTableRef.data, data);
  });

  it("GET /docs/{did}/tables/{tid}/records retrieves data in records format", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const data = {
      records:
        [
          {
            id: 1,
            fields: {
              A: "hello",
              B: "",
              C: "",
              D: null,
              E: "HELLO",
            },
          },
          {
            id: 2,
            fields: {
              A: "",
              B: "world",
              C: "",
              D: null,
              E: "",
            },
          },
          {
            id: 3,
            fields: {
              A: "",
              B: "",
              C: "",
              D: null,
              E: "",
            },
          },
          {
            id: 4,
            fields: {
              A: "",
              B: "",
              C: "",
              D: null,
              E: "",
            },
          },
        ],
    };
    const respWithTableId = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/records`, chimpy);
    assert.equal(respWithTableId.status, 200);
    assert.deepEqual(respWithTableId.data, data);
    const respWithTableRef = await axios.get(
      `${serverUrl}/api/docs/${docIds.Timesheets}/tables/1/records`, chimpy);
    assert.equal(respWithTableRef.status, 200);
    assert.deepEqual(respWithTableRef.data, data);
  });

  it('GET /docs/{did}/tables/{tid}/records honors the "hidden" param', async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const params = { hidden: true };
    const data = {
      id: 1,
      fields: {
        manualSort: 1,
        A: "hello",
        B: "",
        C: "",
        D: null,
        E: "HELLO",
      },
    };
    const respWithTableId = await axios.get(
      `${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/records`,
      { ...chimpy, params },
    );
    assert.equal(respWithTableId.status, 200);
    assert.deepEqual(respWithTableId.data.records[0], data);
    const respWithTableRef = await axios.get(
      `${serverUrl}/api/docs/${docIds.Timesheets}/tables/1/records`,
      { ...chimpy, params },
    );
    assert.equal(respWithTableRef.status, 200);
    assert.deepEqual(respWithTableRef.data.records[0], data);
  });

  it("GET /docs/{did}/tables/{tid}/records handles errors and hidden columns", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    let resp = await axios.get(`${serverUrl}/api/docs/${docIds.ApiDataRecordsTest}/tables/Table1/records`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      {
        records: [
          {
            id: 1,
            fields: {
              A: null,
              B: "Hi",
              C: 1,
            },
            errors: {
              A: "ZeroDivisionError",
            },
          },
        ],
      },
    );

    // /data format for comparison: includes manualSort, gristHelper_Display, and ["E", "ZeroDivisionError"]
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.ApiDataRecordsTest}/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      {
        id: [
          1,
        ],
        manualSort: [
          1,
        ],
        A: [
          [
            "E",
            "ZeroDivisionError",
          ],
        ],
        B: [
          "Hi",
        ],
        C: [
          1,
        ],
        gristHelper_Display: [
          "Hi",
        ],
      },
    );
  });

  it("GET /docs/{did}/tables/{tid}/data returns 404 for non-existent doc", async function() {
    const { serverUrl, chimpy } = getCtx();
    const resp = await axios.get(`${serverUrl}/api/docs/typotypotypo/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /document not found/i);
  });

  it("GET /docs/{did}/tables/{tid}/data returns 404 for non-existent table", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Typo1/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /table not found/i);
  });

  it("GET /docs/{did}/tables/{tid}/data supports filters", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    function makeQuery(filters: { [colId: string]: any[] }) {
      const query = "filter=" + encodeURIComponent(JSON.stringify(filters));
      return axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data?${query}`, chimpy);
    }

    function checkResults(resp: AxiosResponse, expectedData: any) {
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, expectedData);
    }

    checkResults(await makeQuery({ B: ["world"] }), {
      id: [2], A: [""], B: ["world"], C: [""], D: [null], E: [""], manualSort: [2],
    });

    // Can query by id
    checkResults(await makeQuery({ id: [1] }), {
      id: [1], A: ["hello"], B: [""], C: [""], D: [null], E: ["HELLO"], manualSort: [1],
    });

    checkResults(await makeQuery({ B: [""], A: [""] }), {
      id: [3, 4], A: ["", ""], B: ["", ""], C: ["", ""], D: [null, null], E: ["", ""], manualSort: [3, 4],
    });

    // Empty filter is equivalent to no filter and should return full data.
    checkResults(await makeQuery({}), {
      id: [1, 2, 3, 4],
      A: ["hello", "", "", ""],
      B: ["", "world", "", ""],
      C: ["", "", "", ""],
      D: [null, null, null, null],
      E: ["HELLO", "", "", ""],
      manualSort: [1, 2, 3, 4],
    });

    // An impossible filter should succeed but return an empty set of rows.
    checkResults(await makeQuery({ B: ["world"], C: ["Neptune"] }), {
      id: [], A: [], B: [], C: [], D: [], E: [], manualSort: [],
    });

    // An invalid filter should return an error
    {
      const resp = await makeQuery({ BadCol: [""] });
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /BadCol/);
    }

    {
      const resp = await makeQuery({ B: "world" } as any);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /filter values must be arrays/);
    }
  });

  for (const mode of ["url", "header"]) {
    it(`GET /docs/{did}/tables/{tid}/data supports sorts and limits in ${mode}`, async function() {
      const { serverUrl, docIds, chimpy } = getCtx();
      function makeQuery(params: { sort?: string; limit?: number }) {
        const url = `${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`;
        if (mode === "url") {
          const urlParams = new URLSearchParams(params as any);
          return axios.get(`${url}?${urlParams}`, chimpy);
        } else {
          return axios.get(url, { ...chimpy, headers: {
            ...chimpy.headers, "X-Sort": params.sort, "X-Limit": params.limit,
          } });
        }
      }

      function checkResults(resp: AxiosResponse, expectedData: any) {
        assert.equal(resp.status, 200);
        assert.deepEqual(resp.data, expectedData);
      }

      checkResults(await makeQuery({ sort: "A" }), {
        id: [2, 3, 4, 1], A: ["", "", "", "hello"], B: ["world", "", "", ""],
        C: ["", "", "", ""], D: [null, null, null, null], E: ["", "", "", "HELLO"], manualSort: [2, 3, 4, 1],
      });
      checkResults(await makeQuery({ sort: "-A" }), {
        id: [1, 2, 3, 4], A: ["hello", "", "", ""], B: ["", "world", "", ""],
        C: ["", "", "", ""], D: [null, null, null, null], E: ["HELLO", "", "", ""], manualSort: [1, 2, 3, 4],
      });
      checkResults(await makeQuery({ sort: "B,-A" }), {
        id: [1, 3, 4, 2], A: ["hello", "", "", ""], B: ["", "", "", "world"],
        C: ["", "", "", ""], D: [null, null, null, null], E: ["HELLO", "", "", ""], manualSort: [1, 3, 4, 2],
      });
      checkResults(await makeQuery({ limit: 1 }), {
        id: [1], A: ["hello"], B: [""], C: [""], D: [null], E: ["HELLO"], manualSort: [1],
      });
      checkResults(await makeQuery({ sort: "B", limit: 2 }), {
        id: [1, 3], A: ["hello", ""], B: ["", ""], C: ["", ""], D: [null, null], E: ["HELLO", ""], manualSort: [1, 3],
      });
      checkResults(await makeQuery({ sort: "-B", limit: 2 }), {
        id: [2, 1], A: ["", "hello"], B: ["world", ""], C: ["", ""], D: [null, null], E: ["", "HELLO"],
        manualSort: [2, 1],
      });
      // Sort disc, then asc
      checkResults(await makeQuery({ sort: "-B,A", limit: 2 }), {
        id: [2, 3], A: ["", ""], B: ["world", ""], C: ["", ""], D: [null, null], E: ["", ""], manualSort: [2, 3],
      });
      // Limit only
      checkResults(await makeQuery({ limit: 2 }), {
        id: [1, 2], A: ["hello", ""], B: ["", "world"], C: ["", ""], D: [null, null], E: ["HELLO", ""],
        manualSort: [1, 2],
      });
      // Limit with sorting in reverse order
      checkResults(await makeQuery({ sort: "-id", limit: 2 }), {
        id: [4, 3],
        A: ["", ""],
        B: ["", ""],
        C: ["", ""],
        D: [null, null],
        E: ["", ""],
        manualSort: [4, 3],
      });
    });
  }

  it("GET /docs/{did}/tables/{tid}/data respects document permissions", async function() {
    const { serverUrl, docIds, kiwi } = getCtx();
    // as not part of any group kiwi cannot fetch Timesheets
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`, kiwi);
    assert.equal(resp.status, 403);
  });

  it("GET /docs/{did}/tables/{tid}/data returns matches /not found/ for bad table id", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Bad_Foo_/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /not found/);
  });

  it("POST /docs/{did}/apply applies user actions", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    const userActions = [
      ["AddTable", "Foo", [{ id: "A" }, { id: "B" }]],
      ["BulkAddRecord", "Foo", [1, 2], { A: ["Santa", "Bob"], B: [1, 11] }],
    ];
    const resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/apply`, userActions, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(
      (await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy)).data,
      { id: [1, 2], A: ["Santa", "Bob"], B: ["1", "11"], manualSort: [1, 2] });
  });

  it("POST /docs/{did}/apply respects document permissions", async function() {
    const { serverUrl, docIds, chimpy, kiwi } = getCtx();
    const userActions = [
      ["AddTable", "FooBar", [{ id: "A" }]],
    ];
    let resp: AxiosResponse;

    // as a guest chimpy cannot edit Bananas
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Bananas}/apply`, userActions, chimpy);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, { error: "No write access" });

    // check that changes did not apply
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.Bananas}/tables/FooBar/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /not found/);

    // as not in any group kiwi cannot edit TestDoc
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/apply`, userActions, kiwi);
    assert.equal(resp.status, 403);

    // check that changes did not apply
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/FooBar/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /not found/);
  });

  it("POST /docs/{did}/tables/{tid}/data adds records", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
      A: ["Alice", "Felix"],
      B: [2, 22],
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, [3, 4]);
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy);
    assert.deepEqual(resp.data, {
      id: [1, 2, 3, 4],
      A: ["Santa", "Bob", "Alice", "Felix"],
      B: ["1", "11", "2", "22"],
      manualSort: [1, 2, 3, 4],
    });
  });

  it("POST /docs/{did}/tables/{tid}/data respects document permissions", async function() {
    const { serverUrl, docIds, chimpy, kiwi } = getCtx();
    let resp: AxiosResponse;
    // as a guest chimpy cannot edit Bananas
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Bananas}/tables/Table1/data`, { A: ["Alice"] }, chimpy);
    assert.equal(resp.status, 403);

    // as not in any group kiwi cannot edit TestDoc
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, { A: ["Alice"] }, kiwi);
    assert.equal(resp.status, 403);
  });

  it("POST /docs/{did}/tables/{tid}/records adds records", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`, {
      records: [
        { fields: { A: "John", B: 55 } },
        { fields: { A: "Jane", B: 0 } },
      ],
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      records: [
        { id: 5 },
        { id: 6 },
      ],
    });
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      {
        records:
          [
            {
              id: 1,
              fields: {
                A: "Santa",
                B: "1",
              },
            },
            {
              id: 2,
              fields: {
                A: "Bob",
                B: "11",
              },
            },
            {
              id: 3,
              fields: {
                A: "Alice",
                B: "2",
              },
            },
            {
              id: 4,
              fields: {
                A: "Felix",
                B: "22",
              },
            },
            {
              id: 5,
              fields: {
                A: "John",
                B: "55",
              },
            },
            {
              id: 6,
              fields: {
                A: "Jane",
                B: "0",
              },
            },
          ],
      });
  });

  for (const { desc, url } of [
    {
      desc: "POST /docs/{did}/tables/{tid}/data/delete deletes records",
      url: "tables/Foo/data/delete",
    },
    {
      desc: "POST /docs/{did}/tables/{tid}/records/delete deletes records",
      url: "tables/Foo/records/delete",
    },
  ]) {
    it(desc, async function() {
      const { serverUrl, docIds, chimpy } = getCtx();
      let resp = await axios.post(
        `${serverUrl}/api/docs/${docIds.TestDoc}/${url}`,
        [3, 4, 5, 6],
        chimpy,
      );
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, null);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy);
      assert.deepEqual(resp.data, {
        id: [1, 2],
        A: ["Santa", "Bob"],
        B: ["1", "11"],
        manualSort: [1, 2],
      });

      // restore rows
      await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
        A: ["Alice", "Felix"],
        B: [2, 22],
      }, chimpy);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy);
      assert.deepEqual(resp.data, {
        id: [1, 2, 3, 4],
        A: ["Santa", "Bob", "Alice", "Felix"],
        B: ["1", "11", "2", "22"],
        manualSort: [1, 2, 3, 4],
      });
    });
  }

  describe("PUT /docs/{did}/tables/{tid}/records", function() {
    it("should add or update records", async function() {
      const { serverUrl, userApi, chimpy } = getCtx();
      // create sample document for testing
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "BlankTest" }, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;

      async function check(records: AddOrUpdateRecord[], expectedTableData: BulkColValues, params: any = {}) {
        const resp = await axios.put(url, { records }, { ...chimpy, params });
        assert.equal(resp.status, 200);
        const table = await userApi.getTable(docId, "Table1");
        delete table.manualSort;
        delete table.C;
        assert.deepStrictEqual(table, expectedTableData);
      }

      // Add 3 new records, since the table is empty so nothing matches `requires`
      await check(
        [
          {
            require: { A: 1 },
          },
          {
            // Since no record with A=2 is found, create a new record,
            // but `fields` overrides `require` for the value when creating,
            // so the new record has A=3
            require: { A: 2 },
            fields: { A: 3 },
          },
          {
            require: { A: 4 },
            fields: { B: 5 },
          },
        ],
        { id: [1, 2, 3], A: [1, 3, 4], B: [0, 0, 5] },
      );

      // Update all three records since they all match the `require` values here
      await check(
        [
          {
            // Does nothing
            require: { A: 1 },
          },
          {
            // Changes A from 3 to 33
            require: { A: 3 },
            fields: { A: 33 },
          },
          {
            // Changes B from 5 to 6 in the third record where A=4
            require: { A: 4 },
            fields: { B: 6 },
          },
        ],
        { id: [1, 2, 3], A: [1, 33, 4], B: [0, 0, 6] },
      );

      // This would normally add a record, but noadd suppresses that
      await check([
        {
          require: { A: 100 },
        },
      ],
      { id: [1, 2, 3], A: [1, 33, 4], B: [0, 0, 6] },
      { noadd: "1" },
      );

      // This would normally update A from 1 to 11, bot noupdate suppresses that
      await check([
        {
          require: { A: 1 },
          fields: { A: 11 },
        },
      ],
      { id: [1, 2, 3], A: [1, 33, 4], B: [0, 0, 6] },
      { noupdate: "1" },
      );

      // There are 2 records with B=0, update them both to B=1
      // Use onmany=all to specify that they should both be updated
      await check([
        {
          require: { B: 0 },
          fields: { B: 1 },
        },
      ],
      { id: [1, 2, 3], A: [1, 33, 4], B: [1, 1, 6] },
      { onmany: "all" },
      );

      // In contrast to the above, the default behaviour for no value of onmany
      // is to only update the first matching record,
      // so only one of the records with B=1 is updated to B=2
      await check([
        {
          require: { B: 1 },
          fields: { B: 2 },
        },
      ],
      { id: [1, 2, 3], A: [1, 33, 4], B: [2, 1, 6] },
      );

      // By default, strings in `require` and `fields` are parsed based on column type,
      // so these dollar amounts are treated as currency
      // and parsed as A=4 and A=44
      await check([
        {
          require: { A: "$4" },
          fields: { A: "$44" },
        },
      ],
      { id: [1, 2, 3], A: [1, 33, 44], B: [2, 1, 6] },
      );

      // Turn off the default string parsing with noparse=1
      // Now we need A=44 to actually be a number to match,
      // A="$44" wouldn't match and would create a new record.
      // Because A="$55" isn't parsed, the raw string is stored in the table.
      await check([
        {
          require: { A: 44 },
          fields: { A: "$55" },
        },
      ],
      { id: [1, 2, 3], A: [1, 33, "$55"], B: [2, 1, 6] },
      { noparse: 1 },
      );

      await check([
        // First three records already exist and nothing happens
        { require: { A: 1 } },
        { require: { A: 33 } },
        { require: { A: "$55" } },
        // Without string parsing, A="$33" doesn't match A=33 and a new record is created
        { require: { A: "$33" } },
      ],
      { id: [1, 2, 3, 4], A: [1, 33, "$55", "$33"], B: [2, 1, 6, 0] },
      { noparse: 1 },
      );

      // Checking that updating by `id` works.
      await check([
        {
          require: { id: 3 },
          fields: { A: "66" },
        },
      ],
      { id: [1, 2, 3, 4], A: [1, 33, 66, "$33"], B: [2, 1, 6, 0] },
      );

      // Test bulk case with a mixture of record shapes
      await check([
        {
          require: { A: 1 },
          fields: { A: 111 },
        },
        {
          require: { A: 33 },
          fields: { A: 222, B: 444 },
        },
        {
          require: { id: 3 },
          fields: { A: 555, B: 666 },
        },
      ],
      { id: [1, 2, 3, 4], A: [111, 222, 555, "$33"], B: [2, 444, 666, 0] },
      );

      // allow_empty_require option with empty `require` updates all records
      await check([
        {
          require: {},
          fields: { A: 99, B: 99 },
        },
      ],
      { id: [1, 2, 3, 4], A: [99, 99, 99, 99], B: [99, 99, 99, 99] },
      { allow_empty_require: "1", onmany: "all" },
      );
    });

    it("should 404 for missing tables", async function() {
      const { serverUrl, userApi, chimpy } = getCtx();
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "BlankTest2" }, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table2/records`;
      const resp = await axios.put(url, { records: [{ require: { A: 1 } }] }, chimpy);
      assert.equal(resp.status, 404);
      assert.match(resp.data.error, /Table not found/);
    });

    it("should 400 for missing columns", async function() {
      const { serverUrl, userApi, chimpy } = getCtx();
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "BlankTest3" }, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      const resp = await axios.put(url, {
        records: [
          { require: { NoColumn: 1 } },
        ],
      }, chimpy);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /Invalid column "NoColumn"/);
    });

    it("should 400 for an incorrect onmany parameter", async function() {
      const { serverUrl, docIds, chimpy } = getCtx();
      const resp = await axios.put(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`,
        { records: [{ require: { id: 1 } }] }, { ...chimpy, params: { onmany: "foo" } });
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /onmany parameter foo should be one of first,none,all/);
    });

    it("should 400 for an empty require without allow_empty_require", async function() {
      const { serverUrl, userApi, chimpy } = getCtx();
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "BlankTest5" }, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      const resp = await axios.put(url, {
        records: [{ require: {} }],
      }, chimpy);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /require is empty but allow_empty_require isn't set/);
    });

    it("should validate request schema", async function() {
      const { serverUrl, docIds, chimpy } = getCtx();
      const url = `${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`;
      const test = async (payload: any, error: { error: string, details: { userError: string } }) => {
        const resp = await axios.put(url, payload, chimpy);
        assert.equal(resp.status, 400);
        assert.deepEqual(resp.data, error);
      };
      await test({}, { error: "Invalid payload", details: { userError: "Error: body.records is missing" } });
      await test({ records: 1 }, {
        error: "Invalid payload",
        details: { userError: "Error: body.records is not an array" } });
      await test({ records: [{ fields: {} }] },
        {
          error: "Invalid payload",
          details: { userError: "Error: " +
            "body.records[0] is not a AddOrUpdateRecord; " +
            "body.records[0].require is missing",
          } });
      await test({ records: [{ require: { id: "1" } }] },
        {
          error: "Invalid payload",
          details: { userError: "Error: " +
            "body.records[0] is not a AddOrUpdateRecord; " +
            "body.records[0].require.id is not a number",
          } });
    });
  });

  describe("POST /docs/{did}/tables/{tid}/records", function() {
    it("POST should have good errors", async function() {
      const { serverUrl, userApi, chimpy } = getCtx();
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "PostErrors" }, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;

      // Completely invalid request
      let resp = await axios.post(url, { records: "hi" }, chimpy);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /Invalid payload/);

      // Missing records
      resp = await axios.post(url, {}, chimpy);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /Invalid payload/);
    });

    it("allows to create a blank record", async function() {
      const { serverUrl, userApi, chimpy } = getCtx();
      // create sample document for testing
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "BlankTest" }, wid);
      // Create two blank records
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      const resp = await axios.post(url, { records: [{}, { fields: {} }] }, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, { records: [{ id: 1 }, { id: 2 }] });
    });

    it("allows to create partial records", async function() {
      const { serverUrl, userApi, chimpy } = getCtx();
      // create sample document for testing
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "BlankTest" }, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      // create partial records
      const resp = await axios.post(url, { records: [{ fields: { A: 1 } }, { fields: { B: 2 } }, {}] }, chimpy);
      assert.equal(resp.status, 200);
      const table = await userApi.getTable(docId, "Table1");
      delete table.manualSort;
      assert.deepStrictEqual(
        table,
        { id: [1, 2, 3], A: [1, null, null], B: [null, 2, null], C: [null, null, null] });
    });

    it("validates request schema", async function() {
      const { serverUrl, docIds, chimpy } = getCtx();
      const url = `${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`;
      const test = async (payload: any, error: { error: string, details: { userError: string } }) => {
        const resp = await axios.post(url, payload, chimpy);
        assert.equal(resp.status, 400);
        assert.deepEqual(resp.data, error);
      };
      await test({}, { error: "Invalid payload", details: { userError: "Error: body.records is missing" } });
      await test({ records: 1 }, {
        error: "Invalid payload",
        details: { userError: "Error: body.records is not an array" } });
      // All column types are allowed, except Arrays (or objects) without correct code.
      const testField = async (A: any) => {
        await test({ records: [{ id: 1, fields: { A } }] }, { error: "Invalid payload", details: { userError:
                    "Error: body.records[0] is not a NewRecord; " +
                    "body.records[0].fields.A is not a CellValue; " +
                    "body.records[0].fields.A is none of number, " +
                    "string, boolean, null, 1 more; body.records[0]." +
                    "fields.A[0] is not a GristObjCode; body.records[0]" +
                    ".fields.A[0] is not a valid enum value" } });
      };
      // test no code at all
      await testField([]);
      // test invalid code
      await testField(["ZZ"]);
    });

    it("allows CellValue as a field", async function() {
      const { serverUrl, userApi, chimpy } = getCtx();
      // create sample document
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "PostTest" }, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      const testField = async (A?: CellValue, message?: string) => {
        const resp = await axios.post(url, { records: [{ fields: { A } }] }, chimpy);
        assert.equal(resp.status, 200, message ?? `Error for code ${A}`);
      };
      // test allowed types for a field
      await testField(1); // ints
      await testField(1.2); // floats
      await testField("string"); // strings
      await testField(true); // true and false
      await testField(false);
      await testField(null); // null
      // encoded values (though not all make sense)
      for (const code of [
        GristObjCode.List,
        GristObjCode.Dict,
        GristObjCode.DateTime,
        GristObjCode.Date,
        GristObjCode.Skip,
        GristObjCode.Censored,
        GristObjCode.Reference,
        GristObjCode.ReferenceList,
        GristObjCode.Exception,
        GristObjCode.Pending,
        GristObjCode.Unmarshallable,
        GristObjCode.Versions,
      ]) {
        await testField([code]);
      }
    });
  });

  describe("PATCH /docs/{did}/tables/{tid}/records", function() {
    it("updates records", async function() {
      const { serverUrl, docIds, chimpy } = getCtx();
      let resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`, {
        records: [
          {
            id: 1,
            fields: {
              A: "Father Christmas",
            },
          },
        ],
      }, chimpy);
      assert.equal(resp.status, 200);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`, chimpy);
      // check that rest of the data is left unchanged
      assert.deepEqual(resp.data, {
        records:
          [
            {
              id: 1,
              fields: {
                A: "Father Christmas",
                B: "1",
              },
            },
            {
              id: 2,
              fields: {
                A: "Bob",
                B: "11",
              },
            },
            {
              id: 3,
              fields: {
                A: "Alice",
                B: "2",
              },
            },
            {
              id: 4,
              fields: {
                A: "Felix",
                B: "22",
              },
            },
          ],
      });
    });

    it("validates request schema", async function() {
      const { serverUrl, docIds, chimpy } = getCtx();
      const url = `${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`;
      async function failsWithError(payload: any, error: { error: string, details?: { userError: string } }) {
        const resp = await axios.patch(url, payload, chimpy);
        assert.equal(resp.status, 400);
        assert.deepEqual(resp.data, error);
      }

      await failsWithError({}, { error: "Invalid payload", details: { userError: "Error: body.records is missing" } });

      await failsWithError({ records: 1 }, {
        error: "Invalid payload",
        details: { userError: "Error: body.records is not an array" } });

      await failsWithError({ records: [] }, { error: "Invalid payload", details: { userError:
                  "Error: body.records[0] is not a Record; body.records[0] is not an object" } });

      await failsWithError({ records: [{}] }, { error: "Invalid payload", details: { userError:
                  "Error: body.records[0] is not a Record\n    " +
                  "body.records[0].id is missing\n    " +
                  "body.records[0].fields is missing" } });

      await failsWithError({ records: [{ id: "1" }] }, { error: "Invalid payload", details: { userError:
                  "Error: body.records[0] is not a Record\n" +
                  "    body.records[0].id is not a number\n" +
                  "    body.records[0].fields is missing" } });

      await failsWithError(
        { records: [{ id: 1, fields: { A: 1 } }, { id: 2, fields: { B: 3 } }] },
        { error: "PATCH requires all records to have same fields" });

      // Test invalid object codes
      const fieldIsNotValid = async (A: any) => {
        await failsWithError({ records: [{ id: 1, fields: { A } }] }, { error: "Invalid payload", details: { userError:
                    "Error: body.records[0] is not a Record; " +
                    "body.records[0].fields.A is not a CellValue; " +
                    "body.records[0].fields.A is none of number, " +
                    "string, boolean, null, 1 more; body.records[0]." +
                    "fields.A[0] is not a GristObjCode; body.records[0]" +
                    ".fields.A[0] is not a valid enum value" } });
      };
      await fieldIsNotValid([]);
      await fieldIsNotValid(["ZZ"]);
    });

    it("allows CellValue as a field", async function() {
      const { serverUrl, userApi, chimpy } = getCtx();
      // create sample document for testing
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "PatchTest" }, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      // create record for patching
      const id = (await axios.post(url, { records: [{}] }, chimpy)).data.records[0].id;
      const testField = async (A?: CellValue, message?: string) => {
        const resp = await axios.patch(url, { records: [{ id, fields: { A } }] }, chimpy);
        assert.equal(resp.status, 200, message ?? `Error for code ${A}`);
      };
      await testField(1);
      await testField(1.2);
      await testField("string");
      await testField(true);
      await testField(false);
      await testField(null);
      for (const code of [
        GristObjCode.List,
        GristObjCode.Dict,
        GristObjCode.DateTime,
        GristObjCode.Date,
        GristObjCode.Skip,
        GristObjCode.Censored,
        GristObjCode.Reference,
        GristObjCode.ReferenceList,
        GristObjCode.Exception,
        GristObjCode.Pending,
        GristObjCode.Unmarshallable,
        GristObjCode.Versions,
      ]) {
        await testField([code]);
      }
    });
  });

  describe("PATCH /docs/{did}/tables/{tid}/data", function() {
    it("updates records", async function() {
      const { serverUrl, docIds, chimpy } = getCtx();
      let resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
        id: [1],
        A: ["Santa Klaus"],
      }, chimpy);
      assert.equal(resp.status, 200);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy);
      // check that rest of the data is left unchanged
      assert.deepEqual(resp.data, {
        id: [1, 2, 3, 4],
        A: ["Santa Klaus", "Bob", "Alice", "Felix"],
        B: ["1", "11", "2", "22"],
        manualSort: [1, 2, 3, 4],
      });
    });

    it("throws 400 for invalid row ids", async function() {
      const { serverUrl, docIds, chimpy } = getCtx();
      // combination of valid and invalid ids fails
      let resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
        id: [1, 5],
        A: ["Alice", "Felix"],
      }, chimpy);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /Invalid row id 5/);

      // only invalid ids also fails
      resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
        id: [10, 5],
        A: ["Alice", "Felix"],
      }, chimpy);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /Invalid row id 10/);

      // check that changes related to id 1 did not apply
      assert.deepEqual((await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy)).data, {
        id: [1, 2, 3, 4],
        A: ["Santa Klaus", "Bob", "Alice", "Felix"],
        B: ["1", "11", "2", "22"],
        manualSort: [1, 2, 3, 4],
      });
    });

    it("throws 400 for invalid column", async function() {
      const { serverUrl, docIds, chimpy } = getCtx();
      const resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
        id: [1],
        A: ["Alice"],
        X: ["mystery"],
      }, chimpy);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /Invalid column "X"/);

      // check that changes related to A did not apply
      assert.deepEqual((await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy)).data, {
        id: [1, 2, 3, 4],
        A: ["Santa Klaus", "Bob", "Alice", "Felix"],
        B: ["1", "11", "2", "22"],
        manualSort: [1, 2, 3, 4],
      });
    });

    it("respects document permissions", async function() {
      const { serverUrl, docIds, chimpy, kiwi } = getCtx();
      let resp: AxiosResponse;
      // as a guest Chimpy cannot edit Bananas
      resp = await axios.patch(`${serverUrl}/api/docs/${docIds.Bananas}/tables/Table1/data`,
        { id: [1], A: ["Alice"] }, chimpy);
      assert.equal(resp.status, 403);

      // as not in any group kiwi cannot edit TestDoc
      resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`,
        { id: [1], A: ["Alice"] }, kiwi);
      assert.equal(resp.status, 403);
    });
  });
}
