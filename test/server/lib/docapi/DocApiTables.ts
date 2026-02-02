/**
 * Tests for table operations:
 * - GET /docs/{did}/tables
 * - POST /docs/{did}/tables
 * - PATCH /docs/{did}/tables
 * - POST /docs/{did}/tables/{tid}/columns
 * - PATCH /docs/{did}/tables/{tid}/columns
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

describe("DocApiTables", function() {
  this.timeout(30000);
  testUtils.setTmpLogLevel("error");

  addAllScenarios(addTablesTests, "docapi-tables");
});

function addTablesTests(getCtx: () => TestContext) {
  it("GET/POST/PATCH /docs/{did}/tables and /columns", async function() {
    const { serverUrl, docIds, chimpy } = getCtx();
    // POST /tables: Create new tables
    let resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/tables`, {
      tables: [
        { columns: [{}] },  // The minimal allowed request
        { id: "", columns: [{ id: "" }] },
        { id: "NewTable1", columns: [{ id: "NewCol1", fields: {} }] },
        {
          id: "NewTable2",
          columns: [
            { id: "NewCol2", fields: { label: "Label2" } },
            { id: "NewCol3", fields: { label: "Label3" } },
            { id: "NewCol3", fields: { label: "Label3" } },  // Duplicate column id
          ],
        },
        {
          id: "NewTable2",   // Create a table with duplicate tableId
          columns: [
            { id: "NewCol2", fields: { label: "Label2" } },
            { id: "NewCol3", fields: { label: "Label3" } },
          ],
        },
      ],
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      tables: [
        { id: "Table2" },
        { id: "Table3" },
        { id: "NewTable1" },
        { id: "NewTable2" },
        { id: "NewTable2_2" },  // duplicated tableId ends with _2
      ],
    });

    // POST /columns: Create new columns
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/NewTable2/columns`, {
      columns: [
        {},
        { id: "" },
        { id: "NewCol4", fields: {} },
        { id: "NewCol4", fields: {} },  // Create a column with duplicate colId
        { id: "NewCol5", fields: { label: "Label5" } },
      ],
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      columns: [
        { id: "A" },
        { id: "B" },
        { id: "NewCol4" },
        { id: "NewCol4_2" },  // duplicated colId ends with _2
        { id: "NewCol5" },
      ],
    });

    // POST /columns: Create new columns using tableRef in URL
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/5/columns`, {
      columns: [{ id: "NewCol6", fields: {} }],
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, { columns: [{ id: "NewCol6" }] });

    // POST /columns to invalid table ID
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/NoSuchTable/columns`,
      { columns: [{}] }, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, { error: 'Table not found "NoSuchTable"' });

    // PATCH /tables: Modify a table. This is pretty much only good for renaming tables.
    resp = await axios.patch(`${serverUrl}/api/docs/${docIds.Timesheets}/tables`, {
      tables: [
        { id: "Table3", fields: { tableId: "Table3_Renamed" } },
      ],
    }, chimpy);
    assert.equal(resp.status, 200);

    // Repeat the same operation to check that it gives 404 if the table doesn't exist.
    resp = await axios.patch(`${serverUrl}/api/docs/${docIds.Timesheets}/tables`, {
      tables: [
        { id: "Table3", fields: { tableId: "Table3_Renamed" } },
      ],
    }, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, { error: 'Table not found "Table3"' });

    // PATCH /columns: Modify a column.
    resp = await axios.patch(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table2/columns`, {
      columns: [
        { id: "A", fields: { colId: "A_Renamed" } },
      ],
    }, chimpy);
    assert.equal(resp.status, 200);

    // Repeat the same operation to check that it gives 404 if the column doesn't exist.
    resp = await axios.patch(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table2/columns`, {
      columns: [
        { id: "A", fields: { colId: "A_Renamed" } },
      ],
    }, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, { error: 'Column not found "A"' });

    // Repeat the same operation to check that it gives 404 if the table doesn't exist.
    resp = await axios.patch(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table222/columns`, {
      columns: [
        { id: "A", fields: { colId: "A_Renamed" } },
      ],
    }, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, { error: 'Table not found "Table222"' });

    // Rename NewTable2.A -> B to test the name conflict resolution.
    resp = await axios.patch(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/NewTable2/columns`, {
      columns: [
        { id: "A", fields: { colId: "B" } },
      ],
    }, chimpy);
    assert.equal(resp.status, 200);

    // Hide NewTable2.NewCol5 and NewTable2_2 with ACL
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/apply`, [
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "NewTable2", colIds: "NewCol5" }],
      ["AddRecord", "_grist_ACLResources", -2, { tableId: "NewTable2_2", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "", permissionsText: "-R",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        // Don't use permissionsText: 'none' here because we need S permission to delete the table at the end.
        resource: -2, aclFormula: "", permissionsText: "-R",
      }],
    ], chimpy);
    assert.equal(resp.status, 200);

    // GET /tables: Check that the tables were created and renamed.
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      {
        tables: [
          {
            id: "Table1",
            fields: {
              rawViewSectionRef: 2,
              recordCardViewSectionRef: 3,
              primaryViewId: 1,
              onDemand: false,
              summarySourceTable: 0,
              tableRef: 1,
            },
          },
          // New tables start here
          {
            id: "Table2",
            fields: {
              rawViewSectionRef: 5,
              recordCardViewSectionRef: 6,
              primaryViewId: 2,
              onDemand: false,
              summarySourceTable: 0,
              tableRef: 2,
            },
          },
          {
            id: "Table3_Renamed",
            fields: {
              rawViewSectionRef: 8,
              recordCardViewSectionRef: 9,
              primaryViewId: 3,
              onDemand: false,
              summarySourceTable: 0,
              tableRef: 3,
            },
          },
          {
            id: "NewTable1",
            fields: {
              rawViewSectionRef: 11,
              recordCardViewSectionRef: 12,
              primaryViewId: 4,
              onDemand: false,
              summarySourceTable: 0,
              tableRef: 4,
            },
          },
          {
            id: "NewTable2",
            fields: {
              rawViewSectionRef: 14,
              recordCardViewSectionRef: 15,
              primaryViewId: 5,
              onDemand: false,
              summarySourceTable: 0,
              tableRef: 5,
            },
          },
          // NewTable2_2 is hidden by ACL
        ],
      },
    );

    // Check the created columns.
    // TODO these columns should probably be included in the GET /tables response.
    async function checkColumns(tableId: string, expected: { colId: string, label: string }[]) {
      const colsResp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/${tableId}/columns`, chimpy);
      assert.equal(colsResp.status, 200);
      const actual = colsResp.data.columns.map((c: any) => ({
        colId: c.id,
        label: c.fields.label,
      }));
      assert.deepEqual(actual, expected);
    }

    await checkColumns("Table2", [
      { colId: "A_Renamed", label: "A" },
    ]);
    await checkColumns("Table3_Renamed", [
      { colId: "A", label: "A" },
    ]);
    await checkColumns("NewTable1", [
      { colId: "NewCol1", label: "NewCol1" },
    ]);
    await checkColumns("NewTable2", [
      { colId: "NewCol2", label: "Label2" },
      { colId: "NewCol3", label: "Label3" },
      { colId: "NewCol3_2", label: "Label3" },
      { colId: "B2", label: "A" },  // Result of renaming A -> B
      { colId: "B", label: "B" },
      { colId: "NewCol4", label: "NewCol4" },
      { colId: "NewCol4_2", label: "NewCol4_2" },
      // NewCol5 is hidden by ACL
      { colId: "NewCol6", label: "NewCol6" },
    ]);

    resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/NewTable2_2/columns`, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, { error: 'Table not found "NewTable2_2"' });  // hidden by ACL

    // Clean up the created tables for other tests
    // TODO add a DELETE endpoint for /tables and /columns. Probably best to do alongside DELETE /records.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/_grist_Tables/data/delete`,
      [2, 3, 4, 5, 6], chimpy);
    assert.equal(resp.status, 200);

    // Despite deleting tables (even in a more official way than above),
    // there are rules lingering relating to them. TODO: look into this.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/_grist_ACLRules/data/delete`,
      [2, 3], chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/_grist_ACLResources/data/delete`,
      [2, 3], chimpy);
    assert.equal(resp.status, 200);
  });
}
