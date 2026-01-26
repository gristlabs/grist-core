import { getExistingDocSchema } from "app/client/lib/DocSchemaImport";
import { DocAPI } from "app/common/UserAPI";
import clientUtil from "test/client/clientUtil";

import { assert } from "chai";
import sinon from "sinon";

describe("DocSchemaImport", function() {
  clientUtil.setTmpMochaGlobals();

  describe("getExistingDocSchema", () => {
    it("returns a correctly formatted document description from an SQL response", async () => {
      const records = [
        {
          fields: {
            tableRef: 1,
            tableId: "Table1",
            colRef: 1,
            colId: "Col1",
            colLabel: "Column 1",
          },
        },
        {
          fields: {
            tableRef: 1,
            tableId: "Table1",
            colRef: 2,
            colId: "Col2",
            colLabel: "Column 2",
          },
        },
        {
          fields: {
            tableRef: 2,
            tableId: "Table2",
            colRef: 3,
            colId: "Col3",
            colLabel: "Column 3",
          },
        },
      ];

      const docApi = {
        sql: sinon.fake((sql: string) => ({ statement: sql, records })),
      } as unknown as DocAPI;

      const schema = await getExistingDocSchema(docApi);
      assert.lengthOf(schema.tables, 2);
      assert.deepEqual(schema.tables.map(t => t.id), ["Table1", "Table2"]);
      assert.deepEqual(schema.tables.map(t => t.ref), [1, 2]);

      const table1 = schema.tables.find(t => t.id === "Table1")!;
      assert.lengthOf(table1.columns, 2);
      assert.deepEqual(table1.columns.map(col => col.id), ["Col1", "Col2"]);
      assert.deepEqual(table1.columns.map(col => col.ref), [1, 2]);
      assert.deepEqual(table1.columns.map(col => col.label), ["Column 1", "Column 2"]);
    });

    it("throws on a malformed SQL response", async () => {
      const records = [
        {
          fields: {
            frodo: "baggins",
          },
        },
      ];

      const docApi = {
        sql: sinon.fake((sql: string) => ({ statement: sql, records })),
      } as unknown as DocAPI;

      await assert.isRejected(getExistingDocSchema(docApi), "value[0].tableRef is missing");
    });
  });
});
