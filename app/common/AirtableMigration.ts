import {AirtableAPI, AirtableBaseSchema, AirtableFieldSchema} from 'app/common/AirtableAPI';
import {RecalcWhen} from 'app/common/gristTypes';
import {GristType} from 'app/plugin/GristData';
import {DocAction, UserAction} from 'app/common/DocActions';
import {ApplyUAResult} from 'app/common/ActiveDocAPI';

export type ApplyUserActionsFunc = (userActions: UserAction[]) => Promise<ApplyUAResult>;

export class AirtableMigrator {
  constructor(private _api: AirtableAPI, private _applyUserActions: ApplyUserActionsFunc) {
  }

  public async run(base: string) {
    const baseSchema = await this._api.getBaseSchema(base);

    console.log(baseSchema);
    const gristDocSchema = gristDocSchemaFromAirtableSchema(baseSchema);

    const addTableActions: DocAction[] = [];

    for (const table of gristDocSchema.tables) {
      addTableActions.push([
        'AddTable',
        table.name,
        table.columns.map(colInfo => ({
          id: colInfo.id,
          type: colInfo.type,
          isFormula: colInfo.isFormula,
          formula: colInfo.formula ?? "",
        })),
      ]);
    }

    const results = await this._applyUserActions(addTableActions);
    console.log(JSON.stringify(results, null, 2));

    // Calculate base schema
    // Create tables
    // Create fields
    // Apply field types and customization
    return {
      baseSchema,
      gristSchema: await this._getGristDocSchema(base),
    };
  }

  private async _getGristDocSchema(base: string): Promise<DocSchema> {
    const baseSchema = await this._api.getBaseSchema(base);

    return gristDocSchemaFromAirtableSchema(baseSchema);
  }
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
  id: string;
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
      id: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  autoNumber(field) {
    return {
      id: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Should have trigger formula
    };
  },
  checkbox(field) {
    return {
      id: field.name,
      type: 'Bool',
      isFormula: false,
    };
  },
  count(field) {
    return {
      id: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Should be a formula
    };
  },
  createdBy(field) {
    return {
      id: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  createdTime(field) {
    return {
      id: field.name,
      type: 'DateTime',
      isFormula: false,
      // TODO - Should have a trigger formula
    };
  },
  currency(field) {
    return {
      id: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Should have currency formatting
    };
  },
  date(field) {
    return {
      id: field.name,
      type: 'Date',
      isFormula: false,
      // TODO - Choose best format for date based on the Airtable configuration
    };
  },
  dateTime(field) {
    return {
      id: field.name,
      type: 'DateTime',
      isFormula: false,
      // TODO - Choose best format for datetime based on the Airtable configuration
    };
  },
  duration(field) {
    return {
      id: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Should also produce a formatted duration formula column.
    };
  },
  email(field) {
    return {
      id: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  formula(field) {
    return {
      id: field.name,
      type: 'Text',
      isFormula: false,
      // It would be helpful to convert formulas, but that's significant work.
    };
  },
  lastModifiedBy(field) {
    return {
      id: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Add trigger formula
    };
  },
  lastModifiedTime(field) {
    return {
      id: field.name,
      type: 'DateTime',
      isFormula: false,
      // TODO - Add trigger formula
    };
  },
  multilineText(field) {
    return {
      id: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Set up formatting
    };
  },
  multipleAttachments(field) {
    return {
      id: field.name,
      type: 'Attachments',
      isFormula: false,
    };
  },
  multipleCollaborators(field) {
    return {
      id: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Format this sensibly
    };
  },
  /*
  multipleRecordLinks(field) {
    return {
      id: field.name,
      type: 'RefList',
      isFormula: false,
      // TODO - Set up references
    };
  },
  */
  multipleSelects(field) {
    return {
      id: field.name,
      type: 'ChoiceList',
      isFormula: false,
      // TODO - Set up choices
    };
  },
  number(field) {
    return {
      id: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Set up formatting / precision info
    };
  },
  percent(field) {
    return {
      id: field.name,
      type: 'Numeric',
      isFormula: false,
      // TODO - Set up percentage formatting
    };
  },
  phoneNumber(field) {
    return {
      id: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  rating(field) {
    return {
      id: field.name,
      type: 'Int',
      isFormula: false,
      // Consider setting up some nice conditional formatting.
    };
  },
  richText(field) {
    return {
      id: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Set up markdown
    };
  },
  /*
  rollup(field) {
    return {
      id: field.name,
      type: '',
      isFormula: false,
      formula: field.options?.formula || '',
    };
  },
  */
  singleCollaborator(field) {
    return {
      id: field.name,
      type: 'Text',
      isFormula: false,
    };
  },
  singleLineText(field) {
    return {
      id: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Set up formatting
    };
  },
  singleSelect(field) {
    return {
      id: field.name,
      type: 'Choice',
      isFormula: false,
      // TODO - Set up choices
    };
  },
  url(field) {
    return {
      id: field.name,
      type: 'Text',
      isFormula: false,
      // TODO - Set up hyperlink formatting.
    };
  },
};
