import {
  AirtableBaseSchema,
  AirtableFieldSchema,
  AirtableTableSchema,
} from "app/common/airtable/AirtableAPI";
import { ColumnImportSchema, FormulaTemplate, ImportSchema } from "app/common/DocSchemaImport";
import { RecalcWhen } from "app/common/gristTypes";

/**
 * Design note: this needs to be deterministic and based solely on the Airtable base schema,
 * it should not be based on the current state of the Grist doc or any other parameters passed to
 * the import.
 *
 * Other areas of the import code may transform the created schema
 * (e.g. skipping tables, resolving references).
 * If this schema changes based on the destination document state, a user-given parameter or anything
 * not directly derived from the Airtable schema, the remainder of the import code may not adapt the
 * schema properly for the target document.
 */
export function gristDocSchemaFromAirtableSchema(airtableSchema: AirtableBaseSchema): ImportSchema {
  const getTableIdForField = (fieldId: string) => {
    const tableId = airtableSchema.tables.find(table => table.fields.find(field => field.id === fieldId))?.id;
    // Generally shouldn't happen - the schema should always have sufficient info to resolve a valid field id.
    if (tableId === undefined) {
      throw new Error(`Unable to resolve table id for Airtable field ${fieldId}`);
    }
    return tableId;
  };

  return {
    tables: airtableSchema.tables.map((baseTable) => {
      return {
        originalId: baseTable.id,
        desiredGristId: baseTable.name,
        columns: baseTable.fields
          .map((baseField) => {
            if (!AirtableFieldMappers[baseField.type]) { return undefined; }
            return AirtableFieldMappers[baseField.type]({
              field: baseField,
              table: baseTable,
              getTableIdForField,
            });
          })
          .filter((column): column is ColumnImportSchema => column !== undefined),
      };
    }),
  };
}

interface AirtableFieldMapperParams {
  field: AirtableFieldSchema,
  table: AirtableTableSchema,
  getTableIdForField: (fieldId: string) => string,
}

type AirtableFieldMapper = (params: AirtableFieldMapperParams) => ColumnImportSchema;
const AirtableFieldMappers: { [type: string]: AirtableFieldMapper } = {
  aiText({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Text",
    };
  },
  autoNumber({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Numeric",
      // TODO - Need a simple formula for this - PREVIOUS runs into working correctly, circular
      // reference issues
    };
  },
  checkbox({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Bool",
    };
  },
  count({ field, table }) {
    let formula: FormulaTemplate = { formula: "", replacements: [] };
    const fieldOptions = field.options;
    if (fieldOptions?.isValid && fieldOptions.recordLinkFieldId) {
      // These can have conditions set in Airtable to filter them, but we have no way of knowing
      // if they're present - they're not exported in the schema definition...
      // Warning: This may not strictly match 1-to-1 with airtable as a result.
      formula = {
        formula: "len($[R0])",
        replacements: [{ originalTableId: table.id, originalColId: fieldOptions.recordLinkFieldId }],
      };
    }

    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Numeric",
      isFormula: true,
      formula,
    };
  },
  createdBy({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Text",
    };
  },
  createdTime({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "DateTime",
      formula: { formula: "NOW()" },
      recalcWhen: RecalcWhen.DEFAULT,
    };
  },
  currency({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Numeric",
      widgetOptions: {
        // Airtable only provides a currency symbol, which is pretty useless for setting this column up.
        // Instead of showing a wrong currency - omit currency formatting and just use precision.
        decimals: field.options?.precision ?? 2,
        maxDecimals: field.options?.precision ?? 2,
      },
    };
  },
  date({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Date",
      widgetOptions: {
        isCustomDateFormat: true,
        // Airtable and Grist seem to share identical format syntax, based on limited testing
        dateFormat: field.options?.dateFormat?.format ?? "MM/DD/YYYY",
      },
    };
  },
  dateTime({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "DateTime",
      widgetOptions: {
        isCustomDateFormat: true,
        // Airtable and Grist seem to share identical format syntax, based on limited testing
        dateFormat: field.options?.dateFormat?.format ?? "MM/DD/YYYY",
        isCustomTimeFormat: true,
        // Airtable and Grist seem to share identical format syntax, based on limited testing
        timeFormat: field.options?.timeFormat?.format ?? "h:mma",
      },
    };
  },
  duration({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Numeric",
      // TODO - Should also produce a formatted duration formula column.
    };
  },
  email({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Text",
    };
  },
  formula({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      // The field schema from Airtable has more information on what this should be,
      // such as field type, options and referenced fields.
      // The logic to implement that however doesn't seem worth the time investment.
      type: "Any",
      // Store the formula as a comment to prevent it showing errors.
      formula: { formula: `#${field.options?.formula || "#No formula set"}` },
      isFormula: true,
    };
  },
  lastModifiedBy({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Text",
      formula: { formula: 'user and f"{user.Name}"' },
      recalcWhen: 2,
    };
  },
  lastModifiedTime({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "DateTime",
      formula: { formula: "NOW()" },
      recalcWhen: 2,
      widgetOptions: {
        isCustomDateFormat: true,
        dateFormat: field.options?.result?.dateFormat?.format ?? "MM/DD/YYYY",
        isCustomTimeFormat: true,
        timeFormat: field.options?.result?.timeFormat?.format ?? "h:mma",
      },
    };
  },
  multilineText({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Text",
    };
  },
  multipleAttachments({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Attachments",
    };
  },
  multipleCollaborators({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Text",
      // Do we make a collaborators table and make this a reference instead?
    };
  },
  multipleRecordLinks({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "RefList",
      ref: {
        originalTableId: field.options?.linkedTableId,
      },
    };
  },
  multipleSelects({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "ChoiceList",
      widgetOptions: {
        choices: field.options?.choices.map((choice: any) => choice.name),
        // We could import the color by mapping choice.color (e.g. tealLight2) to a hex color
        choiceOptions: {},
      },
    };
  },
  number({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Numeric",
      widgetOptions: {
        decimals: field.options?.precision,
      },
    };
  },
  percent({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Numeric",
      widgetOptions: {
        decimals: field.options?.precision,
        numMode: "percent",
      },
    };
  },
  phoneNumber({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Text",
    };
  },
  rating({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Int",
      // Consider setting up some nice conditional formatting.
    };
  },
  richText({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Text",
      widgetOptions: {
        widget: "Markdown",
      },
    };
  },
  rollup({ field, table, getTableIdForField }) {
    let formula: FormulaTemplate = { formula: "" };
    const fieldOptions = field.options;
    if (fieldOptions?.recordLinkFieldId && fieldOptions.fieldIdInLinkedTable) {
      formula = {
        formula: "$[R0].[R1]",
        replacements: [
          { originalTableId: table.id, originalColId: fieldOptions.recordLinkFieldId },
          {
            originalTableId: getTableIdForField(fieldOptions.fieldIdInLinkedTable),
            originalColId: fieldOptions.fieldIdInLinkedTable,
          },
        ],
      };
    }
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Any",
      isFormula: true,
      formula,
      // TODO - Warn that this won't be perfect. There's a lot summary parameters rollup supports,
      //        that we're not supporting in Grist (yet). A lot of this information also isn't
      //        exported in the Airtable schema API.
    };
  },
  singleCollaborator({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Text",
    };
  },
  singleLineText({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Text",
      // We could potentially limit this to only a single line, but it's a view section option
      // which isn't (at the time of writing) supported by any of the import tools (which only deal
      // with structure, e.g. tables and columns).
    };
  },
  singleSelect({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Choice",
      widgetOptions: {
        choices: field.options?.choices.map((choice: any) => choice.name),
        // We could import the color by mapping choice.color (e.g. tealLight2) to a hex color
        choiceOptions: {},
      },
    };
  },
  url({ field }) {
    return {
      originalId: field.id,
      desiredGristId: field.name,
      label: field.name,
      type: "Text",
      widgetOptions: {
        widget: "HyperLink",
      },
    };
  },
};
