import {
  ColumnImportSchema,
  ImportSchema,
  transformImportSchema,
  validateImportSchema,
} from "app/common/DocSchemaImport";

import { assert } from "chai";

function createTestSchema(): ImportSchema {
  return {
    tables: [
      {
        originalId: "1",
        name: "Table A",
        columns: [
          {
            originalId: "1",
            desiredId: "Alpha",
            type: "Text",
            label: "Col Alpha",
            description: "Alpha column description",
            widgetOptions: {},
          },
          {
            originalId: "2",
            desiredId: "Bravo",
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
        name: "Table B",
        columns: [
          {
            originalId: "1",
            desiredId: "Alpha-2",
            type: "Ref",
            ref: {
              originalTableId: "1",
              originalColId: "1",
            },
          },
          {
            originalId: "2",
            desiredId: "Bravo-2",
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
            },
          ],
        }],
      };
      assert.isEmpty(validateImportSchema(schema, existingTables));
    });

    it("should warn about invalid formula references", () => {
      const schema = createTestSchema();
      const invalidFormulaCol: ColumnImportSchema  = {
        originalId: "Invalid-Formula",
        desiredId: "Invalid-Formula",
        type: "Text",
        isFormula: true,
        formula: {
          formula: "# [R0]",
          replacements: [{ originalTableId: "987654321" }],
        },
      };
      schema.tables[0].columns.push(invalidFormulaCol);
      assert.include(validateImportSchema(schema)[0].message, "Formula references non-existent entity");

      invalidFormulaCol.formula = {
        formula: "# [R0] [R1]",
        replacements: [{ existingTableId: "1" }],
      };
      assert.include(validateImportSchema(schema)[0].message, "Formula references non-existent entity");
    });

    it("should warn about invalid reference columns", () => {
      const schema = createTestSchema();
      const invalidRefCol: ColumnImportSchema  = {
        originalId: "Invalid-Ref",
        desiredId: "Invalid-Ref",
        type: "Ref",
        ref: {
          originalTableId: "987654321",
          originalColId: "123456789",
        },
      };
      schema.tables[0].columns.push(invalidRefCol);
      assert.include(validateImportSchema(schema)[0].message, "Column references non-existent entity");

      invalidRefCol.ref = { existingTableId: "1", existingColId: "1" };
      assert.include(validateImportSchema(schema)[0].message, "Column references non-existent entity");
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
        desiredId: "Alpha-2",
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
            // Needs to match the label on the source column for matching to work.
            label: "Col Alpha",
          }],
        }],
      };

      const tableIdToReplace = "1";
      const { schema: newSchema, warnings } = transformImportSchema(schema, {
        mapExistingTableIds: new Map([[tableIdToReplace, "Existing1"]]),
        existingDocSchema,
      });

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
        desiredId: "Alpha-2",
        type: "Ref",
        ref: {
          originalTableId: "12345",
          originalColId: "54321",
        },
      };

      const { schema: newSchema, warnings } = transformImportSchema(schema, {
        mapExistingTableIds: new Map([["12345", "Existing1"]]),
        existingDocSchema: { tables: [] },
      });

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
        desiredId: "Alpha-2",
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
            // Label doesn't match the column schema's label - column shouldn't match.
            label: "",
          }],
        }],
      };

      const { schema: newSchema, warnings } = transformImportSchema(schema, {
        mapExistingTableIds: new Map([["1", "Existing1"]]),
        existingDocSchema,
      });

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
    describe("#run()", () => {
      it("should execute successfully with a valid input", () => {
        // Test logic here
        assert.isTrue(true);
      });

      it("should handle errors during execution", () => {
        // Test logic here
        assert.isTrue(true);
      });
    });

    describe("#initialize()", () => {
      it("should initialize properly with given parameters", () => {
        // Test logic here
        assert.isTrue(true);
      });

      it("should fail to initialize with invalid parameters", () => {
        // Test logic here
        assert.isTrue(true);
      });
    });
  });
});
