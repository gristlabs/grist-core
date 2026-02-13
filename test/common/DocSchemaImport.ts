import { UserAction } from "app/common/DocActions";
import {
  ApplyUserActionsFunc,
  ColumnImportSchema, DocSchemaImportTool,
  ImportSchema,
  transformImportSchema,
  validateImportSchema,
} from "app/common/DocSchemaImport";

import { assert } from "chai";
import sinon from "sinon";

function createTestSchema(): ImportSchema {
  return {
    tables: [
      {
        originalId: "1",
        desiredGristId: "Table A",
        columns: [
          {
            originalId: "1",
            desiredGristId: "Alpha",
            type: "Text",
            label: "Col Alpha",
            description: "Alpha column description",
            widgetOptions: {},
          },
          {
            originalId: "2",
            desiredGristId: "Bravo",
            type: "Text",
            isFormula: true,
            formula: {
              formula: `$[R0]`,
              replacements: [{ originalTableId: "1", originalColId: "1" }],
            },
          },
        ],
      },
      {
        originalId: "2",
        desiredGristId: "Table B",
        columns: [
          {
            originalId: "1",
            desiredGristId: "Alpha-2",
            type: "Ref",
            ref: {
              originalTableId: "1",
              originalColId: "1",
            },
          },
          {
            originalId: "2",
            desiredGristId: "Bravo-2",
            type: "Text",
            isFormula: true,
            formula: {
              formula: `[R0].lookupOne([R1]="A")`,
              replacements: [
                { originalTableId: "1" },
                { originalTableId: "1", originalColId: "1" },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("DocSchemaImport", function() {
  describe("validateImportSchema", () => {
    it("should show no warnings for a correct, self-contained schema", () => {
      const schema = createTestSchema();
      assert.isEmpty(validateImportSchema(schema));
    });

    it("should show no warnings for a correct schema referencing existing tables", () => {
      const schema = createTestSchema();
      schema.tables[1].columns[0].ref = { existingTableId: "A", existingColId: "A-1" };
      schema.tables[1].columns[1].formula = {
        formula: `[R0].lookupOne([R1]="A")`,
        replacements: [
          { existingTableId: "A" },
          { existingTableId: "A", existingColId: "A-1" },
        ],
      };
      const existingTables = {
        tables: [{
          id: "A",
          columns: [
            {
              id: "A-1",
              ref: 1,
              isFormula: false,
            },
          ],
        }],
      };
      assert.isEmpty(validateImportSchema(schema, existingTables));
    });

    it("should warn about invalid formula references", () => {
      const schema = createTestSchema();
      const invalidFormulaCol: ColumnImportSchema = {
        originalId: "Invalid-Formula",
        desiredGristId: "Invalid-Formula",
        type: "Text",
        isFormula: true,
        formula: {
          formula: "# [R0]",
          replacements: [{ originalTableId: "987654321" }],
        },
      };
      schema.tables[0].columns.push(invalidFormulaCol);
      assert.include(
        validateImportSchema(schema)[0].message,
        "Formula contains a reference to an invalid table or column",
      );

      invalidFormulaCol.formula = {
        formula: "# [R0] [R1]",
        replacements: [{ existingTableId: "1" }],
      };
      assert.include(
        validateImportSchema(schema)[0].message,
        "Formula contains a reference to an invalid table or column",
      );
    });

    it("should warn about invalid reference columns", () => {
      const schema = createTestSchema();
      const invalidRefCol: ColumnImportSchema = {
        originalId: "Invalid-Ref",
        desiredGristId: "Invalid-Ref",
        type: "Ref",
        ref: {
          originalTableId: "987654321",
          originalColId: "123456789",
        },
      };
      schema.tables[0].columns.push(invalidRefCol);
      assert.include(validateImportSchema(schema)[0].message, "does not refer to a valid table or column");

      invalidRefCol.ref = { existingTableId: "1", existingColId: "1" };
      assert.include(validateImportSchema(schema)[0].message, "does not refer to a valid table or column");
    });
  });

  describe("transformImportSchema", () => {
    it("should remove skipped tables", () => {
      const schema = createTestSchema();
      const idToSkip = schema.tables[0].originalId;
      const { schema: newSchema, warnings } = transformImportSchema(schema, {
        skipTableIds: [idToSkip],
      });
      assert.equal(newSchema.tables.length, 1);
      assert.notEqual(newSchema.tables[0].originalId, idToSkip);
      assert.lengthOf(warnings, 0);

      // Check that the missing table triggers reference errors during validation.
      assert.isTrue(validateImportSchema(newSchema).length > 0);
    });

    it("should correctly transform references when replacing a table with an existing one", () => {
      const schema = createTestSchema();

      schema.tables[1].columns[0] = {
        originalId: "1",
        desiredGristId: "Alpha-2",
        type: "Ref",
        ref: {
          originalTableId: "1",
          originalColId: "1",
        },
      };

      const existingDocSchema = {
        tables: [{
          id: "Existing1",
          columns: [{
            id: "ExistingCol1",
            ref: 1,
            // Needs to match the label on the source column for matching to work.
            label: "Col Alpha",
            isFormula: false,
          }],
        }],
      };

      const tableIdToReplace = "1";
      const { schema: newSchema, warnings } = transformImportSchema(schema, {
        mapExistingTableIds: new Map([[tableIdToReplace, "Existing1"]]),
      }, existingDocSchema);

      // Table is now at index 0 due to the replaced table being removed from the schema.
      const transformedRef = newSchema.tables[0].columns[0].ref;
      assert.equal(transformedRef?.existingTableId, "Existing1");
      assert.equal(transformedRef?.existingColId, "ExistingCol1");
      assert.lengthOf(warnings, 0);

      assert.isFalse(newSchema.tables.some(table => table.originalId === tableIdToReplace));

      // Check no validation warnings.
      assert.lengthOf(validateImportSchema(newSchema, existingDocSchema), 0);
    });

    it("should warn if a ref couldn't be resolved during table mapping", () => {
      const schema = createTestSchema();

      schema.tables[1].columns[0] = {
        originalId: "1",
        desiredGristId: "Alpha-2",
        type: "Ref",
        ref: {
          originalTableId: "12345",
          originalColId: "54321",
        },
      };

      const existingDocSchema = { tables: [] };
      const { schema: newSchema, warnings } = transformImportSchema(schema, {
        mapExistingTableIds: new Map([["12345", "Existing1"]]),
      }, existingDocSchema);

      assert.include(warnings[0].message, "Could not find column information");

      // Ref should be unaltered due to the warning.
      const originalRef = newSchema.tables[1].columns[0].ref;
      assert.equal(originalRef?.originalTableId, "12345");
      assert.equal(originalRef?.originalColId, "54321");

      // Check validation fails due to the bad reference.
      assert(validateImportSchema(newSchema).length > 0);
    });

    it("should warn if a matching table / column couldn't be found for a reference", () => {
      const schema = createTestSchema();

      schema.tables[1].columns[0] = {
        originalId: "1",
        desiredGristId: "Alpha-2",
        type: "Ref",
        ref: {
          originalTableId: "1",
          originalColId: "1",
        },
      };

      const existingDocSchema = {
        tables: [{
          id: "Existing1",
          columns: [{
            id: "ExistingCol1",
            ref: 1,
            // Label doesn't match the column schema's label - column shouldn't match.
            label: "",
            isFormula: false,
          }],
        }],
      };

      const { schema: newSchema, warnings } = transformImportSchema(schema, {
        mapExistingTableIds: new Map([["1", "Existing1"]]),
      }, existingDocSchema);

      assert.include(warnings[0].message, "Could not match column schema");

      // Ref should be unaltered due to the warning
      // Table is now at index 0 due to the replaced table being removed from the schema.
      const originalRef = newSchema.tables[0].columns[0].ref;
      assert.equal(originalRef?.originalTableId, "1");
      assert.equal(originalRef?.originalColId, "1");

      // Check validation fails due to the bad reference.
      assert(validateImportSchema(newSchema).length > 0);
    });
  });

  describe("DocSchemaImportTool", () => {
    it("generates the correct user actions for the test schema", async () => {
      const schema = createTestSchema();
      const retValues = schema.tables.map((tableSchema, index) => ({
        id: index,
        table_id: `ArbitraryTableId_${index}`,
        columns: tableSchema.columns.map(columnSchema => `ArbitraryColumnId_${columnSchema.desiredGristId}`),
      }));
      const applyUserActions: ApplyUserActionsFunc = sinon.fake.returns(Promise.resolve({
        actionNum: 0,
        actionHash: null,
        retValues,
        isModification: false,
      }));
      const importTool = new DocSchemaImportTool(applyUserActions);

      await importTool.createTablesFromSchema(schema);

      const userActionsSent = (applyUserActions as sinon.SinonSpy).firstCall.args[0];
      const expectedAddTableActions = [
        [
          "AddTable",
          "Table A",
          [
            {
              id: "Alpha",
              type: "Any",
              isFormula: false,
            },
            {
              id: "Bravo",
              type: "Any",
              isFormula: false,
            },
          ],
        ],
        [
          "AddTable",
          "Table B",
          [
            {
              id: "Alpha-2",
              type: "Any",
              isFormula: false,
            },
            {
              id: "Bravo-2",
              type: "Any",
              isFormula: false,
            },
          ],
        ],
      ];

      assert.deepEqual(userActionsSent, expectedAddTableActions);

      const modifyColumnActions = (applyUserActions as sinon.SinonSpy).secondCall.args[0];
      const expectedModifyColumnActions = [
        [
          "ModifyColumn",
          "ArbitraryTableId_0",
          "ArbitraryColumnId_Alpha",
          {
            type: "Text",
            isFormula: false,
            formula: undefined,
            label: "Col Alpha",
            untieColIdFromLabel: true,
            description: "Alpha column description",
            widgetOptions: "{}",
            visibleCol: undefined,
            recalcDeps: undefined,
            recalcWhen: undefined,
          },
        ],
        [
          "ModifyColumn",
          "ArbitraryTableId_0",
          "ArbitraryColumnId_Bravo",
          {
            type: "Text",
            isFormula: true,
            formula: "$ArbitraryColumnId_Alpha",
            label: undefined,
            untieColIdFromLabel: false,
            description: undefined,
            widgetOptions: undefined,
            visibleCol: undefined,
            recalcDeps: undefined,
            recalcWhen: undefined,
          },
        ],
        [
          "ModifyColumn",
          "ArbitraryTableId_1",
          "ArbitraryColumnId_Alpha-2",
          {
            type: "Ref:ArbitraryTableId_0",
            isFormula: false,
            formula: undefined,
            label: undefined,
            untieColIdFromLabel: false,
            description: undefined,
            widgetOptions: undefined,
            visibleCol: "ArbitraryColumnId_Alpha",
            recalcDeps: undefined,
            recalcWhen: undefined,
          },
        ],
        [
          "ModifyColumn",
          "ArbitraryTableId_1",
          "ArbitraryColumnId_Bravo-2",
          {
            type: "Text",
            isFormula: true,
            formula: 'ArbitraryTableId_0.lookupOne(ArbitraryColumnId_Alpha="A")',
            label: undefined,
            untieColIdFromLabel: false,
            description: undefined,
            widgetOptions: undefined,
            visibleCol: undefined,
            recalcDeps: undefined,
            recalcWhen: undefined,
          },
        ],
      ];

      assert.deepEqual(modifyColumnActions, expectedModifyColumnActions);
    });

    it("maps original table and column ids to the newly created ids", async () => {
      const schema = createTestSchema();

      schema.tables.push({
        originalId: "Test1",
        desiredGristId: "Test Table 1",
        columns: [
          {
            originalId: "1",
            desiredGristId: "Test1-1",
            type: "Any",
          },
          {
            originalId: "2",
            desiredGristId: "Test1-2",
            type: "Ref",
            ref: {
              originalTableId: "Test1",
              originalColId: "1",
            },
          },
        ],
      });

      const retValues = schema.tables.map((tableSchema, index) => ({
        id: index,
        table_id: `ArbitraryTableId_${tableSchema.originalId}`,
        columns: tableSchema.columns.map(columnSchema => `ArbitraryColumnId_${columnSchema.desiredGristId}`),
      }));

      const applyUserActions: ApplyUserActionsFunc = sinon.fake.returns(Promise.resolve({
        actionNum: 0,
        actionHash: null,
        retValues,
        isModification: false,
      }));

      const importTool = new DocSchemaImportTool(applyUserActions);
      await importTool.createTablesFromSchema(schema);

      // Check all ModifyColumn table and column ids are mapped.
      const modifyColumnActions: any[] = (applyUserActions as sinon.SinonSpy).secondCall.args[0];
      const tableIds = modifyColumnActions.map((action: UserAction) => action[1] as string);
      assert.isTrue(tableIds.every((id: string) => id.startsWith("ArbitraryTableId_")), "Table id not mapped");
      const columnIds = modifyColumnActions.map((action: UserAction) => action[2] as string);
      assert.isTrue(columnIds.every((id: string) => id.startsWith("ArbitraryColumnId_")), "Column id not mapped");

      const testAction = modifyColumnActions.find(
        action => action[1] === "ArbitraryTableId_Test1" && action[2] === "ArbitraryColumnId_Test1-2",
      );

      assert(testAction !== undefined);
      // Assert that the correct ID was added to the "Ref:" column type
      assert.equal(testAction[3].type.split(":")[1], "ArbitraryTableId_Test1");
      // Assert that the visible column was set to the new id
      assert.equal(testAction[3].visibleCol, "ArbitraryColumnId_Test1-1");
    });

    it("substitutes existing table / column ids for formula replacements", async () => {
      const schema = createTestSchema();

      schema.tables.push({
        originalId: "Test1",
        desiredGristId: "Test Table 1",
        columns: [
          {
            originalId: "1",
            desiredGristId: "Test1-1",
            type: "Any",
          },
          {
            originalId: "2",
            desiredGristId: "Test1-2",
            type: "Any",
            formula: {
              formula: "print('[R0]') # [R0], [R1], no [R2]",
              replacements: [
                { originalTableId: "Test1", originalColId: "1" },
                { originalTableId: "Test1" },
              ],
            },
          },
        ],
      });

      const retValues = schema.tables.map((tableSchema, index) => ({
        id: index,
        table_id: `MyCol_${tableSchema.originalId}`,
        columns: tableSchema.columns.map(columnSchema => `MyCol_${columnSchema.desiredGristId}`),
      }));

      const applyUserActions: ApplyUserActionsFunc = sinon.fake.returns(Promise.resolve({
        actionNum: 0,
        actionHash: null,
        retValues,
        isModification: false,
      }));

      const importTool = new DocSchemaImportTool(applyUserActions);
      await importTool.createTablesFromSchema(schema);

      const modifyColumnActions: any[] = (applyUserActions as sinon.SinonSpy).secondCall.args[0];
      const [, , , colInfo] = modifyColumnActions.find(action => action[2] === "MyCol_Test1-2");

      assert.equal(
        colInfo.formula,
        "print('MyCol_Test1-1') # MyCol_Test1-1, MyCol_Test1, no [R2]",
      );
    });

    it("substitutes the original ids when formula replacements fail to resolve", async () => {
      const schema = createTestSchema();

      schema.tables.push({
        originalId: "Test1",
        desiredGristId: "Test Table 1",
        columns: [
          {
            originalId: "2",
            desiredGristId: "Test1-2",
            type: "Any",
            formula: {
              formula: "print('[R0]') # [R0], [R1], no [R2]",
              replacements: [
                { originalTableId: "OtherTable", originalColId: "BadCol" },
                { originalTableId: "OtherTable" },
              ],
            },
          },
        ],
      });

      const retValues = schema.tables.map((tableSchema, index) => ({
        id: index,
        table_id: `MyCol_${tableSchema.originalId}`,
        columns: tableSchema.columns.map(columnSchema => `MyCol_${columnSchema.desiredGristId}`),
      }));

      const applyUserActions: ApplyUserActionsFunc = sinon.fake.returns(Promise.resolve({
        actionNum: 0,
        actionHash: null,
        retValues,
        isModification: false,
      }));

      const importTool = new DocSchemaImportTool(applyUserActions);
      await importTool.createTablesFromSchema(schema);

      const modifyColumnActions: any[] = (applyUserActions as sinon.SinonSpy).secondCall.args[0];
      const [, , , colInfo] = modifyColumnActions.find(action => action[2] === "MyCol_Test1-2");

      assert.equal(
        colInfo.formula,
        "print('unknown_column_BadCol') # unknown_column_BadCol, unknown_table_OtherTable, no [R2]",
      );
    });
  });
});
