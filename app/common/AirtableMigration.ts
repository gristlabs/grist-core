import {AirtableAPI, AirtableBaseSchema, AirtableFieldSchema} from 'app/common/AirtableAPI';
import {RecalcWhen} from 'app/common/gristTypes';
import {GristType} from 'app/plugin/GristData';
import {UserAction} from 'app/common/DocActions';
import {ApplyUAResult} from 'app/common/ActiveDocAPI';

export type ApplyUserActionsFunc = (userActions: UserAction[]) => Promise<ApplyUAResult>;

export class AirtableMigrator {
  constructor(private _api: AirtableAPI, private _applyUserActions: ApplyUserActionsFunc) {
  }

  public async run(base: string) {
    const baseSchema = await this._api.getBaseSchema(base);

    console.log(baseSchema);
    const gristDocSchema = gristDocSchemaFromAirtableSchema(baseSchema);


    const results = await createTables(gristDocSchema.tables, this._applyUserActions);

    console.log(JSON.stringify(results, null, 2));

    // Calculate base schema
    // Create tables
    // Create fields
    // Apply field types and customization
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

/* TODO:
- It's safe to pass any Column info to AddTable as it's handled in useractions.py
- Make sure ColumnSchema is converted into the correct format for the user action
- Set this up to do two passes (creation, update)
- Apply the two passes in createTable (one to create, then one derived from col schema)
 */

async function createTables(schemas: TableSchema[], _applyUserActions: ApplyUserActionsFunc) {
  const addTableActions: UserAction[] = [];

  for (const schema of schemas) {
    addTableActions.push([
      'AddTable',
      schema.name,
      schema.columns.map(colInfo => ({
        ...colInfo,
        id: colInfo.desiredId,
        //formula: colInfo.formula ?? "",
      })),
    ]);
  }

  const actionResults = (await _applyUserActions(addTableActions)).retValues;

  return {
    tables: schemas.map((tableSchema, actionIndex) => {
      const result: any = actionResults[actionIndex];
      return {
        id: result.id as string,
        schema: tableSchema,
        columns: tableSchema.columns.map((columnSchema, colIndex) => ({
          id: result.columns[colIndex],
          schema: columnSchema,
        })),
      };
    })
  };
}

function gristDocSchemaFromAirtableSchema(airtableSchema: AirtableBaseSchema): DocSchema {
  return {
    tables: airtableSchema.tables.map(baseTable => {
      return {
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
  name: string;
  columns: ColumnSchema[];
}

interface ColumnSchema {
  desiredId: string;
  type: GristType;
  isFormula: boolean;
  formula?: string;
  label?: string;
  description?: string;
  recalcDeps?: number[] | null;
  recalcWhen?: RecalcWhen;
  visibleCol?: number;
  untieColIdFromLabel?: boolean;
  widgetOptions?: string;
}

type AirtableFieldMapper = (field: AirtableFieldSchema) => ColumnSchema;
const AirtableFieldMappers: { [type: string]: AirtableFieldMapper } = {
  aiText(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  autoNumber(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Should have trigger formula
    };
  },
  checkbox(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Bool',
      isFormula: false,
    };
  },
  count(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Should be a formula
    };
  },
  createdBy(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  createdTime(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'DateTime',
      isFormula: false,
      // TODO - Should have a trigger formula
    };
  },
  currency(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Should have currency formatting
    };
  },
  date(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Date',
      isFormula: false,
      // TODO - Choose best format for date based on the Airtable configuration
    };
  },
  dateTime(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'DateTime',
      isFormula: false,
      // TODO - Choose best format for datetime based on the Airtable configuration
    };
  },
  duration(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Should also produce a formatted duration formula column.
    };
  },
  email(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  formula(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
      // It would be helpful to convert formulas, but that's significant work.
    };
  },
  lastModifiedBy(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Add trigger formula
    };
  },
  lastModifiedTime(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'DateTime',
      isFormula: false,
      // TODO - Add trigger formula
    };
  },
  multilineText(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Set up formatting
    };
  },
  multipleAttachments(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Attachments',
      isFormula: false,
    };
  },
  multipleCollaborators(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Format this sensibly
    };
  },
  /*
  multipleRecordLinks(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'RefList',
      isFormula: false,
      // TODO - Set up references
    };
  },
  */
  multipleSelects(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'ChoiceList',
      isFormula: false,
      // TODO - Set up choices
    };
  },
  number(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Set up formatting / precision info
    };
  },
  percent(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Set up percentage formatting
    };
  },
  phoneNumber(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  rating(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Int',
      isFormula: false,
      // Consider setting up some nice conditional formatting.
    };
  },
  richText(field) {
    return {
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
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  singleLineText(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Set up formatting
    };
  },
  singleSelect(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Choice',
      isFormula: false,
      // TODO - Set up choices
    };
  },
  url(field) {
    return {
      desiredId: field.name,
      label: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Set up hyperlink formatting.
    };
  },
};
