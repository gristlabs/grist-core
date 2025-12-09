import {AirtableAPI, AirtableBaseSchema, AirtableFieldSchema} from 'app/common/AirtableAPI';
import {RecalcWhen} from 'app/common/gristTypes';
import {GristType} from 'app/plugin/GristData';
import {UserAction} from 'app/common/DocActions';
import {ApplyUAResult} from 'app/common/ActiveDocAPI';

export type ApplyUserActionsFunc = (userActions: UserAction[]) => Promise<ApplyUAResult>;
export type GetTableColumnInfoFunc = (tableId: string) => Promise<{ id: string, colRef: number }[]>;

export class AirtableMigrator {
  constructor(private _api: AirtableAPI, private _applyUserActions: ApplyUserActionsFunc) {
  }

  public async run(base: string) {
    const baseSchema = await this._api.getBaseSchema(base);

    console.log(baseSchema);
    const gristDocSchema = gristDocSchemaFromAirtableSchema(baseSchema);


    const results = await createTables(gristDocSchema.tables, this._applyUserActions);

    console.log(JSON.stringify(results, null, 2));

    return {
      baseSchema,
      gristSchema: await this._getGristDocSchema(base),
      results,
    };
  }

  private async _getGristDocSchema(base: string): Promise<DocSchema> {
    const baseSchema = await this._api.getBaseSchema(base);

    return gristDocSchemaFromAirtableSchema(baseSchema);
  }
}

async function createTables(schemas: TableSchema[],
                            applyUserActions: ApplyUserActionsFunc) {
  const addTableActions: UserAction[] = [];

  for (const schema of schemas) {
    addTableActions.push([
      'AddTable',
      // This will be transformed into a valid id
      schema.name,
      schema.columns.map(colInfo => ({
        // This will be transformed into a valid id
        id: colInfo.desiredId,
        type: "Any",
        isFormula: false,
      })),
    ]);
  }

  const tableCreationResults = (await applyUserActions(addTableActions)).retValues;

  const tableOriginalIdToGristTableId = new Map<string, string>();
  const tableOriginalIdToGristTableRef = new Map<string, number>();
  const colOriginalIdToGristColId = new Map<string, string>();

  // This expects everything to have been created successfully, and therefore
  // in order in the response - without any gaps.
  schemas.forEach((tableSchema, tableIndex) => {
    const tableCreationResult = tableCreationResults[tableIndex];
    tableOriginalIdToGristTableId.set(tableSchema.originalId, tableCreationResult.table_id as string);
    tableOriginalIdToGristTableRef.set(tableSchema.originalId, tableCreationResult.id as number);

    tableSchema.columns.forEach((colSchema, colIndex) => {
      colOriginalIdToGristColId.set(colSchema.originalId, tableCreationResult.columns[colIndex] as string);
    });
  });

  const getTableId = getFromOrThrowIfUndefined(tableOriginalIdToGristTableId, (key) => {
    throw new Error(`Couldn't locate Grist table id for table ${key}`);
  });

  const getColId = getFromOrThrowIfUndefined(colOriginalIdToGristColId, (key) => {
    throw new Error(`Couldn't locate Grist column id for column ${key}`);
  });

  const modifyColumnActions: UserAction[] = [];
  for (const tableSchema of schemas) {
    for (const columnSchema of tableSchema.columns) {
      // TODO - consider logging a warning for the missing ref case.
      //        Or block it entirely in TS
      const type = columnSchema.type.includes("Ref")
        ? columnSchema.ref ? `${columnSchema.type}:${getTableId(columnSchema.ref.originalTableId)}` : "Any"
        : columnSchema.type;

      modifyColumnActions.push([
        'ModifyColumn',
        getTableId(tableSchema.originalId),
        getColId(columnSchema.originalId),
        {
          type,
          isFormula: columnSchema.isFormula ?? false,
          formula: columnSchema.formula?.({ getColId }),
          label: columnSchema.label,
          // Need to decouple it - otherwise our stored column ids may now be invalid.
          untieColIdFromLabel: columnSchema.label !== undefined,
          description: columnSchema.description,
          widgetOptions: JSON.stringify(columnSchema.widgetOptions),
          // TODO - Need column ref for this (as in the numerical id) - will need to load it.
          //visibleCol: columnSchema.visibleCol?.originalColId && getColId(columnSchema.visibleCol.originalColId),
          recalcDeps: columnSchema.recalcDeps,
          recalcWhen: columnSchema.recalcWhen,
        }
      ]);
    }
  }

  console.log(modifyColumnActions);
  const modifyColumnResults = await applyUserActions(modifyColumnActions);
  console.log(JSON.stringify(modifyColumnResults, null, 2));
  console.log(modifyColumnResults);

  return {};
}

function gristDocSchemaFromAirtableSchema(airtableSchema: AirtableBaseSchema): DocSchema {
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
          .filter((column): column is ColumnSchema => column !== undefined),
      };
    })
  };
}

interface DocSchema {
  tables: TableSchema[];
}

interface TableSchema {
  originalId: string;
  name: string;
  columns: ColumnSchema[];
}

type FormulaFunc = (params: { getColId(originalId: string): string }) => string

interface ColumnSchema {
  originalId: string;
  desiredId: string;
  type: GristType;
  isFormula?: boolean;
  formula?: FormulaFunc;
  label?: string;
  description?: string;
  // Only allow null until ID mapping is implemented
  recalcDeps?: /*{ originalColId: string }[] |*/ null;
  recalcWhen?: RecalcWhen;
  ref?: { originalTableId: string };
  visibleCol?: { originalColId: string };
  untieColIdFromLabel?: boolean;
  widgetOptions?: Record<string, any>;
}

type AirtableFieldMapper = (field: AirtableFieldSchema) => ColumnSchema;
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
    let formula: FormulaFunc = () => "";
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
    let formula: FormulaFunc = () => "";
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

// Small helper to make accessing a map less verbose, and use consistent error handling.
function getFromOrThrowIfUndefined<K, V>(map: Map<K, V>, makeThrowable: (key: K) => Error) {
  return (key: K): V => {
    const value = map.get(key);
    if (!value) {
      throw makeThrowable(key);
    }
    return value;
  };
}
