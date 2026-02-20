import {
  AirtableBaseSchema,
  AirtableFieldSchema,
  AirtableTableSchema,
} from "app/common/airtable/AirtableAPITypes";
import { gristDocSchemaFromAirtableSchema } from "app/common/airtable/AirtableSchemaImporter";
import { ColumnImportSchema } from "app/common/DocSchemaImport";
import { RecalcWhen } from "app/common/gristTypes";

import * as crypto from "crypto";

import { assert } from "chai";

describe("AirtableImporter", function() {
  const firstTableName = "A basic table";
  const firstTableId = tableNameToId(firstTableName);

  function createTableSchema(): AirtableTableSchema {
    return {
      id: firstTableId,
      name: firstTableName,
      primaryFieldId: fieldNameToId("Arbitrary column name 1"),
      fields: [{
        type: "singleLineText",
        id: fieldNameToId("Arbitrary column name 1"),
        name: "Arbitrary column name 1",
      }],
    };
  }

  function createBaseSchema(): AirtableBaseSchema {
    return {
      tables: [createTableSchema()],
    };
  }

  function createBasicAirtableField(name: string, type: string) {
    return {
      id: fieldNameToId(name),
      name,
      type,
      options: {} as any,
    };
  }

  describe("gristDocSchemaFromAirtableSchema", () => {
    it("correctly converts a very basic airtable schema", () => {
      const result = gristDocSchemaFromAirtableSchema(createBaseSchema());
      assert.deepEqual(result.schema, {
        tables: [
          {
            originalId: firstTableId,
            desiredGristId: "A basic table",
            columns: [
              {
                originalId: "airtableId",
                desiredGristId: "Airtable Id",
                label: "Airtable Id",
                type: "Text",
                untieColIdFromLabel: true,
              },
              {
                originalId: fieldNameToId("Arbitrary column name 1"),
                desiredGristId: "Arbitrary column name 1",
                label: "Arbitrary column name 1",
                type: "Text",
              },
            ],
          },
        ],
      });
      assert.isEmpty(result.warnings);
    });

    interface ConvertAirtableFieldParams {
      field: AirtableFieldSchema,
      fieldDependenciesByTable?: { [tableId: string]: AirtableFieldSchema[] },
    }

    function convertAirtableField(params: ConvertAirtableFieldParams) {
      const airtableSchema = createBaseSchema();
      airtableSchema.tables[0].fields[0] = params.field;
      const { fieldDependenciesByTable } = params;
      if (fieldDependenciesByTable) {
        Object.keys(fieldDependenciesByTable).forEach((tableId) => {
          const fields = fieldDependenciesByTable[tableId];
          let table = airtableSchema.tables.find(table => table.id === tableId);
          if (!table) {
            table = {
              id: tableId,
              name: tableId,
              primaryFieldId: fields[0].id,
              fields: [],
            };
            airtableSchema.tables.push(table);
          }
          table.fields.push(...fields);
        });
      }
      const result = gristDocSchemaFromAirtableSchema(airtableSchema);
      return {
        airtableSchema,
        importSchema: result.schema,
        warnings: result.warnings,
        testField: airtableSchema.tables[0].fields.find(field => field.id === params.field.id)!,
        testColumn: result.schema.tables[0].columns.find(column => column.originalId === params.field.id)!,
      };
    }

    function runBasicFieldTest(field: AirtableFieldSchema, column: ColumnImportSchema) {
      assert.equal(field.id, column.originalId);
      assert.equal(field.name, column.desiredGristId);
      assert.equal(field.name, column.label);
    }

    // The majority of tests are simple checks that input field X became some column Y with specific
    // properties set.
    // This helper provides a minimalist way of checking that case.
    function basicDeepIncludeFieldTest(
      fieldParams: Omit<AirtableFieldSchema, "id">,
      getIncludesValue: (testField: AirtableFieldSchema, testColumn: ColumnImportSchema) => any,
    ) {
      const field = {
        ...createBasicAirtableField(fieldParams.name, fieldParams.type),
        ...fieldParams,
      };
      const { testField, testColumn } = convertAirtableField({ field });
      runBasicFieldTest(testField, testColumn);
      assert.deepInclude(testColumn, getIncludesValue(testField, testColumn));
    }

    it("correctly converts an aiText column", () => {
      const field = createBasicAirtableField("An AiText column", "aiText");
      const referencedField = createBasicAirtableField("A referenced field", "Text");
      const fieldDependenciesByTable = {
        [firstTableId]: [referencedField],
      };

      field.options = {
        referencedFieldIds: [referencedField.id],
        prompt: ["This is an example prompt, referencing field: ", {
          field: {
            fieldId: referencedField.id,
          },
        }],
      };

      // No additional options or changes needed for aiText field.
      const { testField, testColumn } = convertAirtableField({ field, fieldDependenciesByTable });

      runBasicFieldTest(testField, testColumn);

      assert.deepInclude(testColumn, {
        type: "Text",
      });
    });

    it("correctly converts an autoNumber column", () => basicDeepIncludeFieldTest(
      { name: "An autonumber column", type: "autoNumber" },
      (testField, testColumn) => ({
        type: "Numeric",
      }),
    ));

    it("correctly converts a checkbox column", () => basicDeepIncludeFieldTest(
      { name: "A checkbox column", type: "checkbox" },
      (testField, testColumn) => ({
        type: "Bool",
      }),
    ));

    it("correctly converts a count column", () => {
      const field = createBasicAirtableField("A bool column", "count");
      const referencedField = createBasicAirtableField("A referenced field", "Text");
      const fieldDependenciesByTable = {
        [firstTableId]: [referencedField],
      };
      field.options = {
        isValid: true,
        recordLinkFieldId: referencedField.id,
      };
      const { testField, testColumn } = convertAirtableField({ field, fieldDependenciesByTable });
      runBasicFieldTest(testField, testColumn);
      assert.deepInclude(testColumn, {
        type: "Numeric",
        isFormula: true,
        formula: {
          formula: "len($[R0])",
          replacements: [{ originalTableId: firstTableId, originalColId: referencedField.id }],
        },
      });
    });

    it("correctly converts a createdBy column", () => basicDeepIncludeFieldTest(
      { name: "A createdBy column", type: "createdBy" },
      (testField, testColumn) => ({
        type: "Text",
      }),
    ));

    it("correctly converts a createdTime column", () => basicDeepIncludeFieldTest(
      { name: "A createdTime column", type: "createdTime" },
      (testField, testColumn) => ({
        type: "DateTime",
        formula: {
          formula: "NOW()",
        },
        recalcWhen: RecalcWhen.DEFAULT,
      }),
    ));

    it("correctly converts a currency column", () => {
      const field = createBasicAirtableField("A currency column", "currency");
      field.options = {
        precision: 3,
        // Can't easily convert this back to the correct currency code
        symbol: "$",
      };
      const { testField, testColumn } = convertAirtableField({ field });
      runBasicFieldTest(testField, testColumn);
      assert.deepInclude(testColumn, {
        type: "Numeric",
        widgetOptions: {
          decimals: 3,
          maxDecimals: 3,
        },
      });

      field.options.precision = undefined;
      const noPrecisionResult = convertAirtableField({ field });
      assert.deepInclude(noPrecisionResult.testColumn, {
        widgetOptions: {
          decimals: 2,
          maxDecimals: 2,
        },
      });
    });

    it("correctly converts a date column", () => basicDeepIncludeFieldTest(
      {
        name: "A date column",
        type: "date",
        options: {
          dateFormat: {
            name: "local",
            format: "l",
          },
        },
      },
      (testField, testColumn) => ({
        type: "Date",
        widgetOptions: {
          isCustomDateFormat: true,
          dateFormat: "l",
        },
      }),
    ));

    it("correctly converts a dateTime column", () => basicDeepIncludeFieldTest(
      {
        name: "A dateTime column",
        type: "dateTime",
        options: {
          dateFormat: {
            name: "iso",
            format: "YYYY-MM-DD",
          },
          timeFormat: {
            name: "24hour",
            format: "HH:mm",
          },
          timeZone: "utc",
        },
      },
      (testField, testColumn) => ({
        type: "DateTime",
        widgetOptions: {
          isCustomDateFormat: true,
          dateFormat: "YYYY-MM-DD",
          isCustomTimeFormat: true,
          timeFormat: "HH:mm",
        },
      }),
    ));

    it("correctly converts a duration column", () => basicDeepIncludeFieldTest(
      {
        name: "A duration column",
        type: "duration",
        options: {
          durationFormat: "h:mm",
        },
      },
      (testField, testColumn) => ({
        type: "Numeric",
      }),
    ));

    it("correctly converts an email column", () => basicDeepIncludeFieldTest(
      {
        name: "An email column",
        type: "email",
      },
      (testField, testColumn) => ({
        type: "Text",
      }),
    ));

    it("correctly converts a formula column", () => basicDeepIncludeFieldTest(
      {
        name: "A formula column",
        type: "formula",
        options: {
          formula: "DATETIME_DIFF({fldBSBtZ30nsLogpl}, TODAY(), 'days')",
          referencedFieldIds: ["fldBSBtZ30nsLogpl"],
          result: {
            type: "number",
            options: {
              precision: 0,
            },
          },
        },
      },
      (testField, testColumn) => ({
        type: "Any",
        isFormula: true,
        formula: {
          // Expect to find a commented out version of the formula
          formula: `#${testField.options?.formula}`,
        },
      }),
    ));

    it("correctly converts a lastModifiedBy column", () => basicDeepIncludeFieldTest(
      { name: "A lastModifiedBy column", type: "lastModifiedBy" },
      (testField, testColumn) => ({
        type: "Text",
        formula: {
          formula: 'user and f"{user.Name}"',
        },
        recalcWhen: RecalcWhen.MANUAL_UPDATES,
      }),
    ));

    it("correctly converts a lastModifiedTime column", () => basicDeepIncludeFieldTest(
      {
        name: "A lastModifiedTime column",
        type: "lastModifiedTime",
        options: {
          isValid: true,
          referencedFieldIds: [],
          result: {
            type: "date",
            dateFormat: {
              name: "iso",
              format: "YYYY-MM-DD",
            },
            timeFormat: {
              name: "24hour",
              format: "HH:mm",
            },
          },
        },
      },
      (testField, testColumn) => ({
        type: "DateTime",
        formula: { formula: "NOW()" },
        recalcWhen: RecalcWhen.MANUAL_UPDATES,
        widgetOptions: {
          isCustomDateFormat: true,
          dateFormat: "YYYY-MM-DD",
          isCustomTimeFormat: true,
          timeFormat: "HH:mm",
        },
      }),
    ));

    it("correctly converts a multilineText column", () => basicDeepIncludeFieldTest(
      { name: "A multiline text column", type: "multilineText" },
      (testField, testColumn) => ({
        type: "Text",
      }),
    ));

    it("correctly converts a multipleAttachments column", () => basicDeepIncludeFieldTest(
      {
        name: "A multipleAttachments column",
        type: "multipleAttachments",
        options: {
          isReversed: true,
        },
      },
      (testField, testColumn) => ({
        type: "Attachments",
      }),
    ));

    it("correctly converts a multipleCollaborators column", () => basicDeepIncludeFieldTest(
      { name: "A multipleCollaborators column", type: "multipleCollaborators" },
      (testField, testColumn) => ({
        type: "Text",
      }),
    ));

    it("correctly converts a multipleLookupValues column", () => {
      const otherTableId = tableNameToId("other table");
      const otherField = createBasicAirtableField("Any field", "");
      const refField = {
        ...createBasicAirtableField("A multipleRecordLinks column", "multipleRecordLinks"),
        options: {
          linkedTableId: otherTableId,
          isReversed: false,
          prefersSingleRecordLink: false,
          // No valid value needed for this test
          inverseLinkFieldId: "",
        },
      };
      const fieldDependenciesByTable = {
        [firstTableId]: [refField],
        [otherTableId]: [otherField],
      };

      const field = {
        ...createBasicAirtableField("A multipleLookupValues column", "multipleLookupValues"),
        options: {
          isValid: true,
          recordLinkFieldId: refField.id,
          fieldIdInLinkedTable: otherField.id,
          referencedFieldIds: [],
          result: {
            type: "singleLineText",
          },
        },
      };

      const { testField, testColumn } = convertAirtableField({ field, fieldDependenciesByTable });
      runBasicFieldTest(testField, testColumn);
      assert.deepInclude(testColumn, {
        type: "Any",
        isFormula: true,
        formula: {
          formula: "$[R0].[R1]",
          replacements: [
            { originalTableId: firstTableId, originalColId: refField.id },
            { originalTableId: otherTableId, originalColId: otherField.id },
          ],
        },
      });
    });

    it("correctly converts a multipleRecordLinks column", () => {
      const field = {
        ...createBasicAirtableField("A multipleRecordLinks column", "multipleRecordLinks"),
        options: {
          linkedTableId: firstTableId,
          isReversed: false,
          prefersSingleRecordLink: false,
          inverseLinkFieldId: "",
        },
      };
      const inverseField = {
        ...createBasicAirtableField("An inverse multipleRecordLinks column", "multipleRecordLinks"),
        options: {
          linkedTableId: firstTableId,
          isReversed: true,
          prefersSingleRecordLink: false,
          inverseLinkFieldId: field.id,
        },
      };
      field.options.inverseLinkFieldId = inverseField.id;
      const fieldDependenciesByTable = {
        [firstTableId]: [inverseField],
      };
      const { testField, testColumn } = convertAirtableField({ field, fieldDependenciesByTable });
      runBasicFieldTest(testField, testColumn);
      assert.deepInclude(testColumn, {
        type: "RefList",
        ref: { originalTableId: firstTableId },
      });
    });

    it("correctly converts a multipleSelects column", () => basicDeepIncludeFieldTest(
      {
        name: "A multipleSelects column",
        type: "multipleSelects",
        options: {
          choices: [
            {
              id: "selyK3p8gKM4n1gXF",
              name: "Tag 1",
              color: "blueLight2",
            },
            {
              id: "selIcGw9oH8NCd8TA",
              name: "Tag 2",
              color: "cyanLight2",
            },
            {
              id: "self9MQIcLOj4iW9d",
              name: "Tag 3",
              color: "tealLight2",
            },
          ],
        },
      },
      (testField, testColumn) => ({
        type: "ChoiceList",
        widgetOptions: {
          choices: ["Tag 1", "Tag 2", "Tag 3"],
          choiceOptions: {},
        },
      }),
    ));

    it("correctly converts a number column", () => basicDeepIncludeFieldTest(
      {
        name: "A number column",
        type: "number",
        options: {
          precision: 4,
        },
      },
      (testField, testColumn) => ({
        type: "Numeric",
        widgetOptions: {
          decimals: 4,
        },
      }),
    ));

    it("correctly converts a percent column", () => basicDeepIncludeFieldTest(
      {
        name: "A percent column",
        type: "percent",
        options: {
          precision: 4,
        },
      },
      (testField, testColumn) => ({
        type: "Numeric",
        widgetOptions: {
          decimals: 4,
          numMode: "percent",
        },
      }),
    ));

    it("correctly converts a phoneNumber column", () => basicDeepIncludeFieldTest(
      { name: "A phoneNumber column", type: "phoneNumber" },
      (testField, testColumn) => ({
        type: "Text",
      }),
    ));

    it("correctly converts a rating column", () => basicDeepIncludeFieldTest(
      { name: "A rating column", type: "rating" },
      (testField, testColumn) => ({
        type: "Int",
      }),
    ));

    it("correctly converts a richText column", () => basicDeepIncludeFieldTest(
      { name: "A richText column", type: "richText" },
      (testField, testColumn) => ({
        type: "Text",
        widgetOptions: {
          widget: "Markdown",
        },
      }),
    ));

    it("correctly converts a rollup column", () => {
      const otherTableId = tableNameToId("other table");
      const otherField = createBasicAirtableField("Any field", "");
      const refField = {
        ...createBasicAirtableField("A multipleRecordLinks column", "multipleRecordLinks"),
        options: {
          linkedTableId: otherTableId,
          isReversed: false,
          prefersSingleRecordLink: false,
          // No valid value needed for this test
          inverseLinkFieldId: "",
        },
      };
      const fieldDependenciesByTable = {
        [firstTableId]: [refField],
        [otherTableId]: [otherField],
      };

      const field = {
        ...createBasicAirtableField("A rollup column", "rollup"),
        options: {
          isValid: true,
          recordLinkFieldId: refField.id,
          fieldIdInLinkedTable: otherField.id,
          referencedFieldIds: [],
          result: {
            type: "singleLineText",
          },
        },
      };

      const { testField, testColumn } = convertAirtableField({ field, fieldDependenciesByTable });
      runBasicFieldTest(testField, testColumn);
      assert.deepInclude(testColumn, {
        type: "Any",
        isFormula: true,
        formula: {
          formula: "$[R0].[R1]",
          replacements: [
            { originalTableId: firstTableId, originalColId: refField.id },
            { originalTableId: otherTableId, originalColId: otherField.id },
          ],
        },
      });
    });

    it("correctly converts a singleCollaborator column", () => basicDeepIncludeFieldTest(
      { name: "A singleCollaborator column", type: "singleCollaborator" },
      (testField, testColumn) => ({
        type: "Text",
      }),
    ));

    it("correctly converts a singleLineText column", () => basicDeepIncludeFieldTest(
      { name: "A singleLineText column", type: "singleLineText" },
      (testField, testColumn) => ({
        type: "Text",
      }),
    ));

    it("correctly converts a singleSelect column", () => basicDeepIncludeFieldTest(
      {
        name: "A singleSelect column",
        type: "singleSelect",
        options: {
          choices: [
            {
              id: "selyK3p8gKM4n1gXF",
              name: "Tag 1",
              color: "blueLight2",
            },
            {
              id: "selIcGw9oH8NCd8TA",
              name: "Tag 2",
              color: "cyanLight2",
            },
            {
              id: "self9MQIcLOj4iW9d",
              name: "Tag 3",
              color: "tealLight2",
            },
          ],
        },
      },
      (testField, testColumn) => ({
        type: "Choice",
        widgetOptions: {
          choices: ["Tag 1", "Tag 2", "Tag 3"],
          choiceOptions: {},
        },
      }),
    ));

    it("correctly converts a url column", () => basicDeepIncludeFieldTest(
      { name: "A url column", type: "url" },
      (testField, testColumn) => ({
        type: "Text",
        widgetOptions: {
          widget: "HyperLink",
        },
      }),
    ));
  });
});

// Field ids seem to be randomly generated, but always 17 characters prefixed with "fld".
// Approximate that by hashing the field name and using the first 14 characters.
function fieldNameToId(name: string) {
  return `fld${crypto.createHash("md5").update(name).digest("base64").substring(0, 14)}`;
}

// Table ids seem to be randomly generated, but always 17 characters prefixed with "tbl".
// Approximate that by hashing the field name and using the first 14 characters.
function tableNameToId(name: string) {
  return `tbl${crypto.createHash("md5").update(name).digest("base64").substring(0, 14)}`;
}
