import {ApplyUAResult} from 'app/common/ActiveDocAPI';
import {UserAction} from 'app/common/DocActions';
import {RecalcWhen} from 'app/common/gristTypes';
import {GristType} from 'app/plugin/GristData';
import {cloneDeep} from 'lodash';

export type ApplyUserActionsFunc = (userActions: UserAction[]) => Promise<ApplyUAResult>;

export interface DocCreationParams {
  skipTableIds?: string[];
  mapExistingTableIds?: Map<string, string>;
}

export class DocCreationHelper {
  constructor(private _applyUserActions: ApplyUserActionsFunc) {
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

    // TODO - Need to fix two assumptions - Grist column IDs are unique, and original ids are unique
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

// Minimal information needed from the existing document for the import to work.
interface ExistingDocSchema {
  tables: ExistingTableSchema[];
}

interface ExistingTableSchema {
  id: string;
  columns: ExistingColumnSchema[];
}

interface ExistingColumnSchema {
  id: string;
}

interface DocCreationSchemaWarning {
  tableRef?: TableRef;
  colRef?: ColRef;
}

class ColumnRefWarning implements DocCreationSchemaWarning {
  constructor(public readonly tableRef: TableRef) {
  }
}

class ColumnVisibleColRefWarning implements DocCreationSchemaWarning {
  constructor(public readonly colRef: ColRef) {
  }
}

class FormulaTableRefWarning implements DocCreationSchemaWarning {
  constructor(public readonly tableRef: TableRef) {
  }
}

class FormulaColRefWarning implements DocCreationSchemaWarning {
  constructor(public readonly colRef: ColRef) {
  }
}

/**
 * Checks the validity of a DocCreationSchema, raising warnings for any issues found.
 * The type system covers the majority of possible issues (e.g. missing properties).
 * This primarily deals with checking referential integrity.
 */
export function validateDocCreationSchema(schema: DocCreationSchema, existingSchema: ExistingDocSchema) {
  const warnings: DocCreationSchemaWarning[] = [];

  const tablesByOriginalId = new Map(schema.tables.map(table => [table.originalId, table]));
  const existingTablesById = new Map(existingSchema.tables.map(table => [table.id, table]));
  const originalColumnIds = new Set(schema.tables.flatMap(table => table.columns.map(col => col.originalId)));
  const existingColumnIds = new Set(existingSchema.tables.flatMap(table => table.columns.map(col => col.id)));

  const isTableRefValid = (ref: TableRef) => Boolean(
       ref.originalTableId && tablesByOriginalId.get(ref.originalTableId) !== undefined
    || ref.existingTableId && tablesByOriginalId.get(ref.existingTableId) !== undefined
  );

  // Checks that the existing table contains that column, or that the column exists if no table ref is provided.
  const isExistingColRefValid = (ref: ColRef, tableRef?: TableRef) => {
    const tableId = tableRef?.existingTableId;
    if (tableId) {
      return existingTablesById.get(tableId)?.columns.some(column => column.id === ref.existingColId);
    }
    return ref.existingColId && existingColumnIds.has(ref.existingColId);
  };

  // Checks that the original table contains that column, or that the column exists if no table ref is provided.
  const isOriginalColRefValid = (ref: ColRef, tableRef?: TableRef) => {
    const tableId = tableRef?.originalTableId;
    if (tableId) {
      return tablesByOriginalId.get(tableId)?.columns.some(column => column.originalId === ref.existingColId);
    }
    return ref.originalColId && originalColumnIds.has(ref.originalColId);
  };

  const isColRefValid = (ref: ColRef, tableRef?: TableRef) => Boolean(
       ref.existingColId && isExistingColRefValid(ref, tableRef)
    || ref.originalColId && isOriginalColRefValid(ref, tableRef)
  );

  schema.tables.forEach(tableSchema => {
    tableSchema.columns.forEach(columnSchema => {
      // Validate formula replacements
      columnSchema.formula?.replacements?.forEach(replacement => {
        if (replacement.tableId && !isTableRefValid(replacement.tableId)) {
          warnings.push(new FormulaTableRefWarning(replacement.tableId));
          return;
        }

        // If no table id is given, column must be in... TODO This
        if (replacement.colId && !isColRefValid(replacement.colId, replacement.tableId)) {
          warnings.push(new FormulaColRefWarning(replacement.colId));
          return;
        }
      });

      // Validate ref
      if (columnSchema.ref && !isTableRefValid(columnSchema.ref)) {
        warnings.push(new ColumnRefWarning(columnSchema.ref));
      }

      // Validate visible col
      if (columnSchema.visibleCol && !isColRefValid(columnSchema.visibleCol, columnSchema.ref)) {
        warnings.push(new ColumnVisibleColRefWarning(columnSchema.visibleCol));
      }
    });
  });

  return warnings;
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
