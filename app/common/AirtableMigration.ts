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
                            applyUserActions: ApplyUserActionsFunc,
                            /*getColumnInfo: GetTableColumnInfoFunc*/) {
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
          isFormula: columnSchema.formula !== undefined,
          formula: columnSchema.formula,
          label: columnSchema.label,
          // Need to decouple it - otherwise our stored column ids may now be invalid.
          untieColIdFromLabel: columnSchema.label !== undefined,
          description: columnSchema.description,
          widgetOptions: JSON.stringify(columnSchema.widgetOptions),
          // TODO - Need column ref for this (as in the numerical id) - will need to load it.
          //visibleCol: columnSchema.visibleCol?.originalColId && getColId(columnSchema.visibleCol.originalColId),
          // TODO - This
          //recalcDeps: number[] | null;
          //recalcWhen?: RecalcWhen;
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

interface ColumnSchema {
  originalId: string;
  desiredId: string;
  type: GristType;
  formula?: string;
  label?: string;
  description?: string;
  recalcDeps?: number[] | null;
  recalcWhen?: RecalcWhen;
  ref?: { originalTableId: string };
  visibleCol?: { originalColId: string };
  untieColIdFromLabel?: boolean;
  widgetOptions?: { [key: string]: any };
}

type AirtableFieldMapper = (field: AirtableFieldSchema) => ColumnSchema;
const AirtableFieldMappers: { [type: string]: AirtableFieldMapper } = {
  aiText(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  autoNumber(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Should have trigger formula
    };
  },
  checkbox(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Bool',
      isFormula: false,
    };
  },
  count(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Should be a formula
    };
  },
  createdBy(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  createdTime(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'DateTime',
      isFormula: false,
      // TODO - Should have a trigger formula
    };
  },
  currency(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Should have currency formatting
    };
  },
  date(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Date',
      isFormula: false,
      // TODO - Choose best format for date based on the Airtable configuration
    };
  },
  dateTime(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'DateTime',
      isFormula: false,
      // TODO - Choose best format for datetime based on the Airtable configuration
    };
  },
  duration(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Should also produce a formatted duration formula column.
    };
  },
  email(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  formula(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
      // It would be helpful to convert formulas, but that's significant work.
    };
  },
  lastModifiedBy(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Add trigger formula
    };
  },
  lastModifiedTime(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'DateTime',
      isFormula: false,
      // TODO - Add trigger formula
    };
  },
  multilineText(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Set up formatting
    };
  },
  multipleAttachments(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Attachments',
      isFormula: false,
    };
  },
  multipleCollaborators(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Format this sensibly
    };
  },
  multipleRecordLinks(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'RefList',
      isFormula: false,
      ref: {
        originalTableId: field.options.linkedTableId,
      }
    };
  },
  multipleSelects(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'ChoiceList',
      isFormula: false,
      // TODO - Set up choices
    };
  },
  number(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Set up formatting / precision info
    };
  },
  percent(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Set up percentage formatting
    };
  },
  phoneNumber(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  rating(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Int',
      isFormula: false,
      // Consider setting up some nice conditional formatting.
    };
  },
  richText(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Set up markdown
    };
  },
  /*
  rollup(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: '',
      isFormula: false,
      formula: field.options?.formula || '',
    };
  },
  */
  singleCollaborator(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  singleLineText(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Set up formatting
    };
  },
  singleSelect(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Choice',
      isFormula: false,
      // TODO - Set up choices
    };
  },
  url(field) {
    return {
      originalId: field.id,
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
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
