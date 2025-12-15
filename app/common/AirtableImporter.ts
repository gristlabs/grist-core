import {AirtableAPI, AirtableBaseSchema, AirtableFieldSchema} from 'app/common/AirtableAPI';
import {RecalcWhen} from 'app/common/gristTypes';
import {UserAction} from 'app/common/DocActions';
import {ApplyUAResult} from 'app/common/ActiveDocAPI';
import {
  ColumnCreationSchema,
  createTablesFromSchemas,
  DocCreationSchema,
  FormulaCreationFunc
} from 'app/common/DocCreationHelper';

export type ApplyUserActionsFunc = (userActions: UserAction[]) => Promise<ApplyUAResult>;

export class AirtableImporter {
  constructor(private _api: AirtableAPI, private _applyUserActions: ApplyUserActionsFunc) {
  }

  public async run(base: string) {
    const baseSchema = await this._api.getBaseSchema(base);

    console.log(baseSchema);
    const gristDocSchema = gristDocSchemaFromAirtableSchema(baseSchema);


    const results = await createTablesFromSchemas(gristDocSchema.tables, this._applyUserActions);

    console.log(JSON.stringify(results, null, 2));

    return {
      baseSchema,
      gristSchema: await this._getGristDocSchema(base),
      results,
    };
  }

  private async _getGristDocSchema(base: string): Promise<DocCreationSchema> {
    const baseSchema = await this._api.getBaseSchema(base);

    return gristDocSchemaFromAirtableSchema(baseSchema);
  }
}

function gristDocSchemaFromAirtableSchema(airtableSchema: AirtableBaseSchema): DocCreationSchema {
  return {
    tables: airtableSchema.tables.map(baseTable => {
      return {
        originalId: baseTable.id,
        name: baseTable.name,
        columns: baseTable.fields
          .map(baseField => {
            if (!AirtableFieldMappers[baseField.type]) { return undefined; }
            return AirtableFieldMappers[baseField.type](baseField);
          })
          .filter((column): column is ColumnCreationSchema => column !== undefined),
      };
    })
  };
}

type AirtableFieldMapper = (field: AirtableFieldSchema) => ColumnCreationSchema;
const AirtableFieldMappers: { [type: string]: AirtableFieldMapper } = {
  aiText(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
    };
  },
  autoNumber(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      // TODO - Need a simple formula for this - PREVIOUS runs into working correctly, circular reference issues
    };
  },
  checkbox(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Bool',
    };
  },
  count(field) {
    let formula: FormulaCreationFunc = () => "";
    const fieldOptions = field.options;
    if (fieldOptions && fieldOptions.isValid && fieldOptions.recordLinkFieldId) {
      // These can have conditions set in Airtable to filter them, but we have no way of knowing
      // if they're present - they're not exported in the schema definition...
      // Warning: This may not strictly match 1-to-1 with airtable as a result.
      formula = ({ getColId }) => `len($${getColId(fieldOptions.recordLinkFieldId)})`;
    }

    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      isFormula: true,
      formula,
    };
  },
  createdBy(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',

    };
  },
  createdTime(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'DateTime',
      formula: () => "NOW()",
      recalcWhen: RecalcWhen.DEFAULT,
    };
  },
  currency(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      widgetOptions: {
        // Airtable only provides a currency symbol, which is pretty useless for setting this column up.
        // Instead of showing a wrong currency - omit currency formatting and just use precision.
        decimals: field.options?.precision ?? 2,
        maxDecimals: field.options?.precision ?? 2,
      }
    };
  },
  date(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Date',
      widgetOptions: {
        isCustomDateFormat: true,
        dateFormat: field.options?.dateFormat?.format ?? "MM/DD/YYYY",
      },
    };
  },
  dateTime(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'DateTime',
      widgetOptions: {
        isCustomDateFormat: true,
        dateFormat: field.options?.dateFormat?.format ?? "MM/DD/YYYY",
        isCustomTimeFormat: true,
        timeFormat: field.options?.timeFormat?.format ?? "h:mma",
      },
    };
  },
  duration(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      // TODO - Should also produce a formatted duration formula column.
    };
  },
  email(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
    };
  },
  formula(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      // The field schema from Airtable has more information on what this should be,
      // such as field type and options. The logic to implement that however doesn't seem worth
      // the time investment.
      type: 'Any',
      // Store the formula as a comment to prevent it showing errors.
      formula: () => `#${field.options?.formula || "No formula set"}`,
      isFormula: true,
    };
  },
  lastModifiedBy(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      formula: () => 'user and f"{user.Name}"',
      recalcWhen: 2,
    };
  },
  lastModifiedTime(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'DateTime',
      formula: () => 'NOW()',
      recalcWhen: 2,
      widgetOptions: {
        isCustomDateFormat: true,
        dateFormat: field.options?.dateFormat?.format ?? "MM/DD/YYYY",
        isCustomTimeFormat: true,
        timeFormat: field.options?.timeFormat?.format ?? "h:mma",
      },
    };
  },
  multilineText(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
    };
  },
  multipleAttachments(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Attachments',
    };
  },
  multipleCollaborators(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      // Do we make a collaborators table and make this a reference instead?
    };
  },
  multipleRecordLinks(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'RefList',
      ref: {
        originalTableId: field.options?.linkedTableId,
      }
    };
  },
  multipleSelects(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'ChoiceList',
      widgetOptions: {
        choices: field.options?.choices.map((choice: any) => choice.name),
        // We could import the color by mapping choice.color (e.g. tealLight2) to a hex color
        choiceOptions: {},
      },
    };
  },
  number(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      widgetOptions: {
        decimals: field.options?.precision,
      }
    };
  },
  percent(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      widgetOptions: {
        numMode: "percent",
      },
    };
  },
  phoneNumber(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
    };
  },
  rating(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Int',
      // Consider setting up some nice conditional formatting.
    };
  },
  richText(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      widgetOptions: {
        widget: "Markdown",
      },
    };
  },
  rollup(field) {
    let formula: FormulaCreationFunc = () => "";
    const fieldOptions = field.options;
    if (fieldOptions && fieldOptions.recordLinkFieldId && fieldOptions.fieldIdInLinkedTable) {
      formula = ({ getColId }) => `
        $${getColId(fieldOptions.recordLinkFieldId)}.${getColId(fieldOptions.fieldIdInLinkedTable)}
      `.trim();
    }
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Any',
      isFormula: true,
      formula,
      // TODO - Warn that this won't be perfect.
    };
  },
  singleCollaborator(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
    };
  },
  singleLineText(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
    };
  },
  singleSelect(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Choice',
      widgetOptions: {
        choices: field.options?.choices.map((choice: any) => choice.name),
        // We could import the color by mapping choice.color (e.g. tealLight2) to a hex color
        choiceOptions: {},
      },
    };
  },
  url(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      widgetOptions: {
        widget: "HyperLink",
      },
    };
  },
};
