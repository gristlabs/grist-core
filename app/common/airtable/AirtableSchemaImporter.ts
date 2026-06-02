import {
  AirtableBaseSchema, AirtableChoiceValue,
  AirtableFieldSchema,
  AirtableTableSchema,
} from "app/common/airtable/AirtableAPITypes";
import {
  ColumnImportSchema,
  DocSchemaImportWarning,
  FormulaTemplate,
  ImportSchema,
  OriginalTableRef,
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
  baseSchema: AirtableBaseSchema,
): { schema: ImportSchema; warnings: DocSchemaImportWarning[] } {
  const warnings: DocSchemaImportWarning[] = [];

  const schema: ImportSchema = {
    tables: baseSchema.tables.map((baseTable) => {
      const { columns, warnings: columnWarnings } =
        convertAirtableTableFieldsToColumnSchemas({ base: baseSchema, table: baseTable });

      warnings.push(...columnWarnings);

      return {
        originalId: baseTable.id,
        desiredGristId: baseTable.name,
        columns: [createAirtableIdColumnSchema(), ...columns],
      };
    }),
  };

  return { schema, warnings };
}

function convertAirtableTableFieldsToColumnSchemas(
  params: { base: AirtableBaseSchema, table: AirtableTableSchema },
) {
  const { table } = params;
  const warnings: DocSchemaImportWarning[] = [];
  const columns = table.fields
    .map((field) => {
      const result = convertAirtableFieldToColumnSchema({ field, ...params });

      if (result.warning) {
        warnings.push(result.warning);
      }

      return result.column;
    })
    .filter((column): column is ColumnImportSchema => column !== undefined);

  return { columns, warnings };
}

function convertAirtableFieldToColumnSchema(
  params: { base: AirtableBaseSchema, table: AirtableTableSchema, field: AirtableFieldSchema  },
): { column?: ColumnImportSchema, warning?: DocSchemaImportWarning } {
  const { field, table, base } = params;

  if (!AirtableFieldMappers[field.type]) {
    return {
      column: undefined,
      warning: new UnsupportedFieldTypeWarning(field.type, field.name, { originalTableId: table.id }),
    };
  }
  return AirtableFieldMappers[field.type]({
    field,
    table,
    getTableIdForField: (fieldId: string) => findTableIdForField(base, fieldId),
  });
}

function findTableIdForField(baseSchema: AirtableBaseSchema, fieldId: string) {
  const tableId = baseSchema.tables.find(table => table.fields.find(field => field.id === fieldId))?.id;
  // Generally shouldn't happen - the schema should always have sufficient info to resolve a valid field id.
  if (tableId === undefined) {
    throw new Error(`Unable to resolve table id for Airtable field ${fieldId}`);
  }
  return tableId;
}

export const AirtableIdColumnLabel = "Airtable Id";
function createAirtableIdColumnSchema(): ColumnImportSchema {
  return {
    originalId: "airtableId",
    desiredGristId: "Airtable Id",
    type: "Text",
    label: AirtableIdColumnLabel,
    untieColIdFromLabel: true,
  };
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
  autoNumber({ field, table }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Numeric",
        formula: {
          formula: "MAX(PEEK([R0].all.[R1]))+1",
          replacements: [
            { originalTableId: table.id },
            { originalTableId: table.id, originalColId: field.id },
          ],
        },
      },
      warning: new AutoNumberLimitationWarning(field.name, { originalTableId: table.id }),
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
      warning: new CountLimitationWarning(field.name, { originalTableId: table.id }),
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
  duration({ field, table }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Numeric",
      },
      warning: new DurationFormatWarning(field.name, { originalTableId: table.id }),
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
  formula({ field, getTableIdForField }) {
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
        formula: convertFormulaFieldReferences(formattedFormula, getTableIdForField),
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
  multipleLookupValues({ field, table, getTableIdForField }) {
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
    };
  },
  multipleRecordLinks({ field }) {
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: field.options?.prefersSingleRecordLink ? "Ref" : "RefList",
        ref: {
          originalTableId: field.options?.linkedTableId,
        },
      },
    };
  },
  multipleSelects({ field }) {
    const choices: AirtableChoiceValue[] = field.options?.choices ?? [];
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "ChoiceList",
        widgetOptions: {
          choices: choices.map(choice => choice.name),
          choiceOptions: buildChoiceOptions(choices),
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
      warning: new RollupLimitationWarning(field.name, { originalTableId: table.id }),
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
    const choices: AirtableChoiceValue[] = field.options?.choices ?? [];
    return {
      column: {
        originalId: field.id,
        desiredGristId: field.name,
        label: field.name,
        type: "Choice",
        widgetOptions: {
          choices: choices.map(choice => choice.name),
          choiceOptions: buildChoiceOptions(choices),
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

  constructor(fieldType: string, fieldName: string, public readonly ref: OriginalTableRef) {
    this.message = `Field "${fieldName}" has unsupported type "${fieldType}" and will be skipped`;
  }
}

class AutoNumberLimitationWarning implements DocSchemaImportWarning {
  public readonly message: string;

  constructor(fieldName: string, public readonly ref: OriginalTableRef) {
    this.message = `AutoNumber field "${fieldName}" behaviour will not be identical to Airtable's. Values may be re-used if rows are edited or deleted.`;
  }
}

class DurationFormatWarning implements DocSchemaImportWarning {
  public readonly message: string;

  constructor(fieldName: string, public readonly ref: OriginalTableRef) {
    this.message = `Duration field "${fieldName}" will be imported as a numeric duration in seconds. Duration formatting is not yet supported.`;
  }
}

class RollupLimitationWarning implements DocSchemaImportWarning {
  public readonly message: string;

  constructor(fieldName: string, public readonly ref: OriginalTableRef) {
    this.message = `Rollup field "${fieldName}" may not match Airtable. Summary parameters and filter conditions are not supported.`;
  }
}

class CountLimitationWarning implements DocSchemaImportWarning {
  public readonly message: string;

  constructor(fieldName: string, public readonly ref: OriginalTableRef) {
    this.message = `Count field "${fieldName}" may not match Airtable. Filter conditions are not supported.`;
  }
}

// Maps Airtable's named color codes to Grist hex fill/text color pairs.
// Airtable has 10 color families x 4 shades each (Light2, Light1, Bright, Dark1).
// Light shades (Light2, Light1) get black text; dark shades (Bright, Dark1) get white text.
const AIRTABLE_COLOR_TO_GRIST_HEX: Record<string, { fillColor: string; textColor: string }> = {
  blueLight2: { fillColor: "#CFDFFF", textColor: "#000000" },
  blueLight1: { fillColor: "#9CC7FF", textColor: "#000000" },
  blueBright: { fillColor: "#2D7FF9", textColor: "#FFFFFF" },
  blueDark1: { fillColor: "#2750AE", textColor: "#FFFFFF" },

  cyanLight2: { fillColor: "#D0F0FD", textColor: "#000000" },
  cyanLight1: { fillColor: "#77D1F3", textColor: "#000000" },
  cyanBright: { fillColor: "#18BFFF", textColor: "#FFFFFF" },
  cyanDark1: { fillColor: "#0B76B7", textColor: "#FFFFFF" },

  tealLight2: { fillColor: "#C2F5E9", textColor: "#000000" },
  tealLight1: { fillColor: "#72DDC3", textColor: "#000000" },
  tealBright: { fillColor: "#20D9D2", textColor: "#FFFFFF" },
  tealDark1: { fillColor: "#02AAA4", textColor: "#FFFFFF" },

  greenLight2: { fillColor: "#D1F7C4", textColor: "#000000" },
  greenLight1: { fillColor: "#93E088", textColor: "#000000" },
  greenBright: { fillColor: "#20C933", textColor: "#FFFFFF" },
  greenDark1: { fillColor: "#338A17", textColor: "#FFFFFF" },

  yellowLight2: { fillColor: "#FFEAB6", textColor: "#000000" },
  yellowLight1: { fillColor: "#FFD66E", textColor: "#000000" },
  yellowBright: { fillColor: "#FCB400", textColor: "#FFFFFF" },
  yellowDark1: { fillColor: "#E08D00", textColor: "#FFFFFF" },

  orangeLight2: { fillColor: "#FEE2D5", textColor: "#000000" },
  orangeLight1: { fillColor: "#FFA981", textColor: "#000000" },
  orangeBright: { fillColor: "#FF6F2C", textColor: "#FFFFFF" },
  orangeDark1: { fillColor: "#D74D26", textColor: "#FFFFFF" },

  redLight2: { fillColor: "#FFDCE5", textColor: "#000000" },
  redLight1: { fillColor: "#FF9EB7", textColor: "#000000" },
  redBright: { fillColor: "#F82B60", textColor: "#FFFFFF" },
  redDark1: { fillColor: "#BA1E45", textColor: "#FFFFFF" },

  pinkLight2: { fillColor: "#FFDAF6", textColor: "#000000" },
  pinkLight1: { fillColor: "#F99DE2", textColor: "#000000" },
  pinkBright: { fillColor: "#FF08C2", textColor: "#FFFFFF" },
  pinkDark1: { fillColor: "#B2158B", textColor: "#FFFFFF" },

  purpleLight2: { fillColor: "#EDE2FE", textColor: "#000000" },
  purpleLight1: { fillColor: "#CDB0FF", textColor: "#000000" },
  purpleBright: { fillColor: "#8B46FF", textColor: "#FFFFFF" },
  purpleDark1: { fillColor: "#6B1CB0", textColor: "#FFFFFF" },

  grayLight2: { fillColor: "#EEEEEE", textColor: "#000000" },
  grayLight1: { fillColor: "#CCCCCC", textColor: "#000000" },
  grayBright: { fillColor: "#666666", textColor: "#FFFFFF" },
  grayDark1: { fillColor: "#444444", textColor: "#FFFFFF" },
};

function buildChoiceOptions(
  choices: AirtableChoiceValue[],
): Record<string, { fillColor: string; textColor: string }> {
  const choiceOptions: Record<string, { fillColor: string; textColor: string }> = {};
  for (const choice of choices) {
    const colors = choice.color ? AIRTABLE_COLOR_TO_GRIST_HEX[choice.color] : undefined;
    if (colors) {
      choiceOptions[choice.name] = colors;
    }
  }
  return choiceOptions;
}

function convertFormulaFieldReferences(
  formula: string, getTableIdForField: (fieldId: string) => string,
): FormulaTemplate {
  const fieldRefs = Array.from(new Set(formula.match(/{fld[A-Za-z0-9]+}/g) ?? []));

  let newFormula = formula;
  fieldRefs.forEach((fieldRef, index) => {
    newFormula = newFormula.split(fieldRef).join(`$[R${index}]`);
  });

  const replacements = fieldRefs.map((fieldRef) => {
    // Remove the {} brackets from around the ID
    const fieldId = fieldRef.slice(1, -1);
    return {
      originalTableId: getTableIdForField(fieldId),
      originalColId: fieldId,
    };
  });

  return {
    formula: newFormula,
    replacements,
  };
}
