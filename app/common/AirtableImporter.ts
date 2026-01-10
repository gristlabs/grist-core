import { ApplyUAResult } from "app/common/ActiveDocAPI";
import {
  AirtableAPI,
  AirtableBaseSchema,
  AirtableFieldSchema,
  AirtableTableSchema,
} from "app/common/AirtableAPI";
import { UserAction } from "app/common/DocActions";
import {
  ColumnImportSchema,
  DocSchemaImportTool, FormulaTemplate,
  ImportSchema,
} from "app/common/DocSchemaImport";
import { RecalcWhen } from "app/common/gristTypes";

export type ApplyUserActionsFunc = (userActions: UserAction[]) => Promise<ApplyUAResult>;

export class AirtableImporter {
  constructor(private _api: AirtableAPI) {
  }

  /*
  Importer will:
    - Optionally create a new doc
    - Get the schema from the given service (or be given it)
    - Apply schema to the doc?
   */

  public async createDocSchema(base: string) {
    const baseSchema = await this._api.getBaseSchema(base);

    return gristDocSchemaFromAirtableSchema(baseSchema);
  }

  public async importSchema(applyUserActions: ApplyUserActionsFunc, schema: ImportSchema) {
    const helper = new DocSchemaImportTool(applyUserActions);
    return await helper.createTablesFromSchema({ tables: schema.tables });
  }
}

/**
 * Design note: this needs to be deterministic based solely on the input schema, and should not be
 * based on the current state of the Grist doc or any other parameters passed to the import.
 *
 * Other areas of the import might skip tables, or re-use existing tables. If this schema changes
 * based on the import parameters, the remainder of the import code may not be able to adapt the
 * schema properly for the existing environment.
 */
function gristDocSchemaFromAirtableSchema(airtableSchema: AirtableBaseSchema): ImportSchema {
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
        dateFormat: field.options?.dateFormat?.format ?? "MM/DD/YYYY",
        isCustomTimeFormat: true,
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
      // such as field type and options. The logic to implement that however doesn't seem worth
      // the time investment.
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
        dateFormat: field.options?.dateFormat?.format ?? "MM/DD/YYYY",
        isCustomTimeFormat: true,
        timeFormat: field.options?.timeFormat?.format ?? "h:mma",
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
      // TODO - Warn that this won't be perfect.
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
