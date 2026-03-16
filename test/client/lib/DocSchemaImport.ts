import { getExistingDocSchema } from "app/client/lib/DocSchemaImport";
import { DocAPI } from "app/common/UserAPI";
import { TableMetadata } from "app/plugin/DocApiTypes";
import clientUtil from "test/client/clientUtil";

import { assert } from "chai";
import sinon from "sinon";

describe("DocSchemaImport", function() {
  clientUtil.setTmpMochaGlobals();

  describe("getExistingDocSchema", () => {
    it("returns a correctly formatted document description from an SQL response", async () => {
      const tables: TableMetadata[] = [
        {
          id: "Table1",
          fields: {
            tableRef: 1,
          },
          columns: [
            {
              id: "Col1",
              fields: {
                colRef: 1,
                label: "Column 1",
                isFormula: false,
              },
            },
            {
              id: "Col2",
              fields: {
                colRef: 2,
                label: "Column 2",
                isFormula: true,
              },
            },
          ],
        },
        {
          id: "Table2",
          fields: {
            tableRef: 2,
          },
          columns: [
            {
              id: "Col3",
              fields: {
                colRef: 3,
                label: "Column 3",
                isFormula: false,
              },
            },
          ],
        },
      ];

      const docApi = {
        getTables: sinon.fake(() => ({ tables })),
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
      assert.deepEqual(table1.columns.map(col => col.isFormula), [false, true]);
    });
  });
});
