import {RecalcWhen} from 'app/common/gristTypes';
import {GristType} from 'app/plugin/GristData';
import {UserAction} from 'app/common/DocActions';
import {ApplyUAResult} from 'app/common/ActiveDocAPI';
import {cloneDeep} from 'lodash';

export type ApplyUserActionsFunc = (userActions: UserAction[]) => Promise<ApplyUAResult>;

export interface DocCreationParams {
  skipTableIds?: string[];
  mapExistingTableIds?: Map<string, string>;
}

export class DocCreationHelper {
  constructor(private _applyUserActions: ApplyUserActionsFunc) {
  }

  public validateSchema(schema: DocCreationSchema) {

  }

  public async createTablesFromSchema(schema: DocCreationSchema) {
    const tableSchemas = schema.tables;
    const addTableActions: UserAction[] = [];

    for (const tableSchema of tableSchemas) {
      addTableActions.push([
        'AddTable',
        // This will be transformed into a valid id
        tableSchema.name,
        tableSchema.columns.map(colInfo => ({
          // This will be transformed into a valid id
          id: colInfo.desiredId,
          type: "Any",
          isFormula: false,
        })),
      ]);
    }

    const tableCreationResults = (await this._applyUserActions(addTableActions)).retValues;

    const tableOriginalIdToGristTableId = new Map<string, string>();
    const tableOriginalIdToGristTableRef = new Map<string, number>();
    const colOriginalIdToGristColId = new Map<string, string>();

    // This expects everything to have been created successfully, and therefore
    // in order in the response - without any gaps.
    tableSchemas.forEach((tableSchema, tableIndex) => {
      const tableCreationResult = tableCreationResults[tableIndex];
      tableOriginalIdToGristTableId.set(tableSchema.originalId, tableCreationResult.table_id as string);
      tableOriginalIdToGristTableRef.set(tableSchema.originalId, tableCreationResult.id as number);

      tableSchema.columns.forEach((colSchema, colIndex) => {
        colOriginalIdToGristColId.set(colSchema.originalId, tableCreationResult.columns[colIndex] as string);
      });
    });

    const idMappers = {
      getColId(id: string) {
        return colOriginalIdToGristColId.get(id);
      },
      getColIdOrThrow(id: string) {
        const value = colOriginalIdToGristColId.get(id);
        if (colOriginalIdToGristColId.get(id) === undefined) {
          throw new DocCreationHelperError(`Couldn't locate Grist column id for column with original id ${id}`);
        }
        return value;
      },
      getTableId(id: string) {
        return tableOriginalIdToGristTableId.get(id);
      },
      getTableIdOrThrow(id: string) {
        const value = tableOriginalIdToGristTableId.get(id);
        if (tableOriginalIdToGristTableId.get(id) === undefined) {
          throw new DocCreationHelperError(`Couldn't locate Grist table id for table with original id ${id}`);
        }
        return value;
      }
    };

    const modifyColumnActions: UserAction[] = [];
    for (const tableSchema of tableSchemas) {
      for (const columnSchema of tableSchema.columns) {
        let type: string = columnSchema.type;
        if (type.includes("Ref")) {
          const tableId = columnSchema.ref?.existingTableId ||
            columnSchema.ref?.originalTableId && idMappers.getTableId(columnSchema.ref?.originalTableId);
          // TODO - show a warning here if we couldn't resolve a table id
          type = tableId
            ? `${columnSchema.type}:${tableId}`
            : "Any";
        }

        const formula = columnSchema.formula
          ? prepareFormula(columnSchema.formula, idMappers)
          : undefined;

        modifyColumnActions.push([
          'ModifyColumn',
          idMappers.getTableIdOrThrow(tableSchema.originalId),
          idMappers.getColIdOrThrow(columnSchema.originalId),
          {
            type,
            isFormula: columnSchema.isFormula ?? false,
            formula,
            label: columnSchema.label,
            // Need to decouple it - otherwise our stored column ids may now be invalid.
            untieColIdFromLabel: columnSchema.label !== undefined,
            description: columnSchema.description,
            widgetOptions: JSON.stringify(columnSchema.widgetOptions),
            visibleCol: columnSchema.visibleCol?.originalColId
              && idMappers.getColIdOrThrow(columnSchema.visibleCol.originalColId),
            recalcDeps: columnSchema.recalcDeps,
            recalcWhen: columnSchema.recalcWhen,
          }
        ]);
      }
    }

    await this._applyUserActions(modifyColumnActions);

    return {
      tableOriginalIdToGristTableId,
      colOriginalIdToGristColId,
    };
  }
}

export function transformDocCreationSchema(schema: DocCreationSchema,
                                           params: DocCreationParams): DocCreationSchema {
  const newSchema = cloneDeep(schema);
  // Skip tables - allow the validation step to pick up on any issues introduced.
  newSchema.tables = newSchema.tables.filter(table => !params.skipTableIds?.includes(table.originalId));

  // Map original tables to existing tables (resolve references)
  const mapTableRef = (tableRef: TableRef) => {
    const existingTableId = tableRef.originalTableId && existingTableIdMap?.get(tableRef.originalTableId);
    // Preserve the reference as-is if no mapping is found
    return existingTableId ? { existingTableId } : tableRef;
  };

  const existingTableIdMap = params.mapExistingTableIds;
  if (existingTableIdMap) {
    newSchema.tables.forEach(tableSchema => {
      tableSchema.columns.forEach(columnSchema => {
        // Manually map column properties to their existing table.
        // This is slightly error-prone long term (as each new reference needs mapping here), but manually
        // mapping fields is simple and easy for the moment.
        columnSchema.ref = columnSchema.ref && mapTableRef(columnSchema.ref);

        columnSchema.formula?.replacements?.forEach(replacement => {
          replacement.tableId = replacement.tableId && mapTableRef(replacement.tableId);
        });
      });
    });
  }
  return newSchema;
}

export interface DocCreationIssue {
  message: string;
  ref: { tableId?: string, colId?: string }
}

type TableIdMapper = (id: string) => string | undefined;
type ColIdMapper = (id: string) => string | undefined;
function prepareFormula(template: FormulaTemplate, mappers: { getTableId: TableIdMapper, getColId: ColIdMapper }) {
  if (!template.replacements || template.replacements.length === 0) {
    return template.formula;
  }
  return template.replacements.reduce((formula, replacement, index) => {
    const newTableId = replacement.tableId?.existingTableId ||
      replacement.tableId?.originalTableId && mappers.getTableId(replacement.tableId.originalTableId);
    const newColId = replacement.colId?.existingColId ||
      replacement.colId?.originalColId && mappers.getColId(replacement.colId.originalColId);

    if (replacement.tableId && !newTableId) {
      // TODO - Warning if tableId doesn't exist
      return formula;
    }

    if (replacement.colId && !newColId) {
      // TODO - Warning if colId doesn't exist
      return formula;
    }

    const replacementText = `${newTableId || ""}${newTableId && newColId ? "." : ""}${newColId || ""}`;

    return formula.replace(RegExp(`\\[R${index}\\]`, 'g'), replacementText);
  }, template.formula);
}

interface OriginalTableRef {
  originalTableId: string;
}

interface ExistingTableRef {
  existingTableId: string;
}

// Allows any property to be read, but assignments must be mutually exclusive.
type TableRef = (OriginalTableRef | ExistingTableRef) & Partial<OriginalTableRef & ExistingTableRef>;

interface OriginalColRef {
  originalColId: string;
}

interface ExistingColRef {
  existingColId: string;
}

// Allows any property to be read, but assignments must be mutually exclusive.
type ColRef = (OriginalColRef | ExistingColRef) & Partial<OriginalColRef & ExistingColRef>;

export interface DocCreationSchema {
  tables: TableCreationSchema[];
}

export interface TableCreationSchema {
  originalId: string;
  name: string;
  columns: ColumnCreationSchema[];
}

/**
 * Enables formulas to have Table/Column ids safely replaced.
 * [R0], [R1], [R2], etc refers to a specific reference to insert
 * { tableId: "Table1", colId: "Col1" } will expand to "Table1.Col1", with different IDs
 * { tableId: "Table1 } will expand to "Table1", with a different ID
 * { colId: "Col1" } will expand to "Col1", with a different ID
 *
 * Square brackets are used to prevent collisions with Javascript/Python template syntax.
 */
export interface FormulaTemplate {
  formula: string,
  replacements?: {
    tableId?: TableRef,
    colId?: ColRef,
  }[]
}


export interface ColumnCreationSchema {
  originalId: string;
  desiredId: string;
  type: GristType;
  isFormula?: boolean;
  formula?: FormulaTemplate;
  label?: string;
  description?: string;
  // Only allow null until ID mapping is implemented
  recalcDeps?: /*{ originalColId: string }[] |*/ null;
  recalcWhen?: RecalcWhen;
  ref?: TableRef;
  visibleCol?: ColRef;
  untieColIdFromLabel?: boolean;
  widgetOptions?: Record<string, any>;
}

export class DocCreationHelperError extends Error {
  constructor(message: string) {
    super(message);
  }
}
