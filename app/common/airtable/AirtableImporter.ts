import {
  AirtableBaseSchema,
  AirtableFieldSchema,
  AirtableTableSchema,
} from "app/common/airtable/AirtableAPI";
import {
  ColumnImportSchema,
  DocSchemaImportWarning,
  FormulaTemplate,
  ImportSchema,
} from "app/common/DocSchemaImport";
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
export function gristDocSchemaFromAirtableSchema(
  airtableSchema: AirtableBaseSchema,
): { schema: ImportSchema; warnings: DocSchemaImportWarning[] } {
  const getTableIdForField = (fieldId: string) => {
    const tableId = airtableSchema.tables.find(table => table.fields.find(field => field.id === fieldId))?.id;
    // Generally shouldn't happen - the schema should always have sufficient info to resolve a valid field id.
    if (tableId === undefined) {
      throw new Error(`Unable to resolve table id for Airtable field ${fieldId}`);
    }
    return tableId;
  };

  const warnings: DocSchemaImportWarning[] = [];
  const schema: ImportSchema = {
    tables: airtableSchema.tables.map((baseTable) => {
      return {
        originalId: baseTable.id,
        desiredGristId: baseTable.name,
        columns: baseTable.fields
          .map((baseField) => {
            if (!AirtableFieldMappers[baseField.type]) {
              warnings.push(new UnsupportedFieldTypeWarning(baseField.type, baseField.name));
              return undefined;
            }
            const mapperResult = AirtableFieldMappers[baseField.type]({
              field: baseField,
              table: baseTable,
              getTableIdForField,
            });
            if (mapperResult.warning) {
              warnings.push(mapperResult.warning);
            }
            return mapperResult.column;
          })
          .filter((column): column is ColumnImportSchema => column !== undefined),
      };
    }),
  };

  return { schema, warnings };
}

interface AirtableFieldMapperParams {
  field: AirtableFieldSchema,
  table: AirtableTableSchema,
  getTableIdForField: (fieldId: string) => string,
}

interface AirtableFieldMapperResult {
  column: ColumnImportSchema,
  warning?: DocSchemaImportWarning,
}

type AirtableFieldMapper = (params: AirtableFieldMapperParams) => AirtableFieldMapperResult;
const AirtableFieldMappers: { [type: string]: AirtableFieldMapper } = {
  aiText({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Text",
      },
    };
  },
  autoNumber({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Numeric",
      },
      warning: new AutoNumberLimitationWarning(field.name),
    };
  },
  checkbox({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Bool",
      },
    };
  },
  count({ field, table }) {
    let formula: FormulaTemplate = { formula: "", replacements: [] };
    const fieldOptions = field.options;
    if (fieldOptions?.isValid && fieldOptions.recordLinkFieldId) {
      formula = {
        formula: "len($[R0])",
        replacements: [{ originalTableId: table.id, originalColId: fieldOptions.recordLinkFieldId }],
      };
    }

    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Numeric",
        isFormula: true,
        formula,
      },
      warning: new CountLimitationWarning(field.name),
    };
  },
  createdBy({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Text",
      },
    };
  },
  createdTime({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "DateTime",
        formula: { formula: "NOW()" },
        recalcWhen: RecalcWhen.DEFAULT,
      },
    };
  },
  currency({ field }) {
    return {
      column: {
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
      },
    };
  },
  date({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Date",
        widgetOptions: {
          isCustomDateFormat: true,
          // Airtable and Grist seem to share identical format syntax, based on limited testing
          dateFormat: field.options?.dateFormat?.format ?? "MM/DD/YYYY",
        },
      },
    };
  },
  dateTime({ field }) {
    return {
      column: {
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
      },
    };
  },
  duration({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Numeric",
      },
      warning: new DurationFormatWarning(field.name),
    };
  },
  email({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Text",
      },
    };
  },
  formula({ field }) {
    const formula = typeof field.options?.formula === "string" ? field.options?.formula : "No formula set";
    // Store the formula as a comment to prevent it showing errors.
    const formattedFormula = formula.split("\n").map(line => `#${line.trim()}`).join("\n");
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        // The field schema from Airtable has more information on what this should be,
        // such as field type, options and referenced fields.
        // The logic to implement that however doesn't seem worth the time investment.
        type: "Any",
        formula: { formula: formattedFormula },
        isFormula: true,
      },
    };
  },
  lastModifiedBy({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Text",
        formula: { formula: 'user and f"{user.Name}"' },
        recalcWhen: 2,
      },
    };
  },
  lastModifiedTime({ field }) {
    return {
      column: {
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
      },
    };
  },
  multilineText({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Text",
      },
    };
  },
  multipleAttachments({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Attachments",
      },
    };
  },
  multipleCollaborators({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Text",
        // Do we make a collaborators table and make this a reference instead?
      },
    };
  },
  multipleRecordLinks({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "RefList",
        ref: {
          originalTableId: field.options?.linkedTableId,
        },
      },
    };
  },
  multipleSelects({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "ChoiceList",
        widgetOptions: {
          choices: field.options?.choices.map((choice: any) => choice.name),
          // We could import the color by mapping choice.color (e.g. tealLight2) to a hex color
          choiceOptions: {},
        },
      },
    };
  },
  number({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Numeric",
        widgetOptions: {
          decimals: field.options?.precision,
        },
      },
    };
  },
  percent({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Numeric",
        widgetOptions: {
          decimals: field.options?.precision,
          numMode: "percent",
        },
      },
    };
  },
  phoneNumber({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Text",
      },
    };
  },
  rating({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Int",
        // Consider setting up some nice conditional formatting.
      },
    };
  },
  richText({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Text",
        widgetOptions: {
          widget: "Markdown",
        },
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
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Any",
        isFormula: true,
        formula,
      },
      warning: new RollupLimitationWarning(field.name),
    };
  },
  singleCollaborator({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Text",
      },
    };
  },
  singleLineText({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Text",
        // We could potentially limit this to only a single line, but it's a view section option
        // which isn't (at the time of writing) supported by any of the import tools (which only deal
        // with structure, e.g. tables and columns).
      },
    };
  },
  singleSelect({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Choice",
        widgetOptions: {
          choices: field.options?.choices.map((choice: any) => choice.name),
          // We could import the color by mapping choice.color (e.g. tealLight2) to a hex color
          choiceOptions: {},
        },
      },
    };
  },
  url({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Text",
        widgetOptions: {
          widget: "HyperLink",
        },
      },
    };
  },
};

class UnsupportedFieldTypeWarning implements DocSchemaImportWarning {
  public readonly message: string;

  constructor(fieldType: string, fieldName: string) {
    this.message = `Field "${fieldName}" has unsupported type "${fieldType}" and will be skipped`;
  }
}

// TODO - Fix
class AutoNumberLimitationWarning implements DocSchemaImportWarning {
  public readonly message: string;

  constructor(fieldName: string) {
    this.message = `AutoNumber field "${fieldName}" will be imported as plain Numeric. Automatic numbering is not yet supported.`;
  }
}

class DurationFormatWarning implements DocSchemaImportWarning {
  public readonly message: string;

  constructor(fieldName: string) {
    this.message = `Duration field "${fieldName}" will be imported as a numeric duration in seconds. Duration formatting is not yet supported.`;
  }
}

class RollupLimitationWarning implements DocSchemaImportWarning {
  public readonly message: string;

  constructor(fieldName: string) {
    this.message = `Rollup field "${fieldName}" may not match Airtable. Summary parameters and filter conditions are not supported.`;
  }
}

class CountLimitationWarning implements DocSchemaImportWarning {
  public readonly message: string;

  constructor(fieldName: string) {
    this.message = `Count field "${fieldName}" may not match Airtable. Filter conditions are not supported.`;
  }
}
