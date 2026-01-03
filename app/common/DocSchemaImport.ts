import { ApplyUAResult } from "app/common/ActiveDocAPI";
import { UserAction } from "app/common/DocActions";
import { RecalcWhen } from "app/common/gristTypes";
import { GristType } from "app/plugin/GristData";

import { cloneDeep } from "lodash";

export interface ImportSchema {
  tables: TableImportSchema[];
}

export interface TableImportSchema {
  originalId: string;
  name: string;
  columns: ColumnImportSchema[];
}

export interface ColumnImportSchema {
  originalId: string;
  desiredId: string;
  type: GristType;
  isFormula?: boolean;
  formula?: FormulaTemplate;
  label?: string;
  description?: string;
  // Only allow null until ID mapping is implemented
  recalcDeps?: /* { originalColId: string }[] | */ null;
  recalcWhen?: RecalcWhen;
  // If a column reference is used, visible column will be set.
  ref?: TableRef | ColRef;
  untieColIdFromLabel?: boolean;
  widgetOptions?: Record<string, any>;
}

/**
 * Enables formulas to have Table/Column ids safely replaced.
 * [R0], [R1], [R2], etc refers to a specific reference to insert
 * Every replacement refers to either a column or a table
 * { tableId: "Table1" } will expand to "Table1", with a different ID
 * { tableId: "Table1", colId: "Col1" } will expand to "Col1", with a different ID
 *
 * Square brackets are used to prevent collisions with Javascript/Python template syntax.
 */
export interface FormulaTemplate {
  formula: string,
  replacements?: (TableRef | ColRef)[],
}

interface OriginalTableRef {
  originalTableId: string;
  originalColId?: never;

  existingTableId?: never;
  existingColId?: never;
}

interface ExistingTableRef {
  originalTableId?: never;
  originalColId?: never;

  existingTableId: string;
  existingColId?: never;
}

// Allows any property to be read, but assignments must be mutually exclusive.
type TableRef = OriginalTableRef | ExistingTableRef;

interface OriginalColRef {
  existingTableId?: never;
  existingColId?: never;

  originalTableId: string;
  originalColId: string;
}

interface ExistingColRef {
  existingTableId: string;
  existingColId: string;

  originalTableId?: never;
  originalColId?: never;
}

// Allows any property to be read, but assignments must be mutually exclusive.
type ColRef = OriginalColRef | ExistingColRef;

export type ApplyUserActionsFunc = (userActions: UserAction[]) => Promise<ApplyUAResult>;

export class DocSchemaImportTool {
  constructor(private _applyUserActions: ApplyUserActionsFunc) {
  }

  public async createTablesFromSchema(schema: ImportSchema) {
    const tableSchemas = schema.tables;
    const addTableActions: UserAction[] = [];

    for (const tableSchema of tableSchemas) {
      addTableActions.push([
        "AddTable",
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

    const tableIdsMap = new Map<string, {
      originalId: string;
      gristId: string;
      gristRefId: number;
      columnIdMap: Map<string, string>;
    }>();

    // This expects everything to have been created successfully, and therefore
    // in order in the response - without any gaps.
    tableSchemas.forEach((tableSchema, tableIndex) => {
      const tableCreationResult = tableCreationResults[tableIndex];
      const tableIds = {
        originalId: tableSchema.originalId,
        gristId: tableCreationResult.table_id as string,
        gristRefId: tableCreationResult.id as number,
        columnIdMap: new Map(),
      };
      tableIdsMap.set(tableSchema.originalId, tableIds);

      tableSchema.columns.forEach((colSchema, colIndex) => {
        tableIds.columnIdMap.set(colSchema.originalId, tableCreationResult.columns[colIndex] as string);
      });
    });

    const idMappers = {
      getColId(tableId: string, colId: string) {
        return tableIdsMap.get(tableId)?.columnIdMap.get(colId);
      },
      getColIdOrThrow(tableId: string, colId: string) {
        const value = tableIdsMap.get(tableId)?.columnIdMap.get(colId);
        if (value === undefined) {
          throw new DocSchemaImportError(`Couldn't find Grist column id for column '${colId}' in table '${tableId}'`);
        }
        return value;
      },
      getTableId(id: string) {
        return tableIdsMap.get(id)?.gristId;
      },
      getTableIdOrThrow(id: string) {
        const value = tableIdsMap.get(id)?.gristId;
        if (value === undefined) {
          throw new DocSchemaImportError(`Couldn't locate Grist table id for table ${id}`);
        }
        return value;
      },
    };

    const modifyColumnActions: UserAction[] = [];
    for (const tableSchema of tableSchemas) {
      for (const columnSchema of tableSchema.columns) {
        let type: string = columnSchema.type;
        if (type.includes("Ref")) {
          const tableId = columnSchema.ref?.existingTableId ||
            (columnSchema.ref?.originalTableId && idMappers.getTableId(columnSchema.ref?.originalTableId));
          // TODO - show a warning here if we couldn't resolve a table id
          type = tableId ?
            `${columnSchema.type}:${tableId}` :
            "Any";
        }

        modifyColumnActions.push([
          "ModifyColumn",
          // TODO - Decide if this should throw or warn.
          idMappers.getTableIdOrThrow(tableSchema.originalId),
          idMappers.getColIdOrThrow(tableSchema.originalId, columnSchema.originalId),
          {
            type,
            isFormula: columnSchema.isFormula ?? false,
            formula: columnSchema.formula && prepareFormula(columnSchema.formula, idMappers),
            label: columnSchema.label,
            // Need to decouple it - otherwise our stored column ids may now be invalid.
            untieColIdFromLabel: columnSchema.label !== undefined,
            description: columnSchema.description,
            widgetOptions: JSON.stringify(columnSchema.widgetOptions),
            visibleCol: columnSchema.ref?.existingColId || (
              columnSchema.ref?.originalColId &&
              idMappers.getColIdOrThrow(columnSchema.ref.originalTableId, columnSchema.ref.originalColId)
            ),
            recalcDeps: columnSchema.recalcDeps,
            recalcWhen: columnSchema.recalcWhen,
          },
        ]);
      }
    }

    await this._applyUserActions(modifyColumnActions);

    return {
      tableIdsMap,
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
  label?: string;
}

interface DocSchemaImportWarning {
  message: string;
  ref?: TableRef | ColRef;
}

class ColumnRefWarning implements DocSchemaImportWarning {
  public readonly message: string;

  constructor(public readonly ref: TableRef | ColRef) {
    this.message = `Column references non-existent entity: ${JSON.stringify(ref)}`;
  }
}

class FormulaRefWarning implements DocSchemaImportWarning {
  public readonly message: string;

  constructor(public readonly formula: FormulaTemplate, public readonly ref: TableRef | ColRef) {
    const formulaSnippet = formula.formula.trim().split("\n")[0].trim().substring(0, 40);
    this.message = `Formula references non-existent entity: ${JSON.stringify(ref)} in formula "${formulaSnippet}"`;
  }
}

/**
 * Checks the validity of an ImportSchema, raising warnings for any issues found.
 * The type system covers the majority of possible issues (e.g. missing properties).
 * This primarily deals with checking referential integrity.
 */
export function validateImportSchema(schema: ImportSchema, existingSchema?: ExistingDocSchema) {
  existingSchema = existingSchema ?? { tables: [] };
  const warnings: DocSchemaImportWarning[] = [];

  const tablesByOriginalId = new Map(schema.tables.map(table => [table.originalId, table]));
  const existingTablesById = new Map(existingSchema.tables.map(table => [table.id, table]));

  const isTableRefValid = (ref: TableRef) => Boolean(
    ref.originalTableId && tablesByOriginalId.get(ref.originalTableId) !== undefined ||
    ref.existingTableId && existingTablesById.get(ref.existingTableId) !== undefined,
  );

  // Checks that the existing table contains that column, or that the column exists if no table ref is provided.
  const isExistingColRefValid = (ref: ExistingColRef) =>
    existingTablesById.get(ref.existingTableId)?.columns.some(column => column.id === ref.existingColId);

  // Checks that the original table contains that column, or that the column exists if no table ref is provided.
  const isOriginalColRefValid = (ref: OriginalColRef) =>
    tablesByOriginalId.get(ref.originalTableId)?.columns.some(column => column.originalId === ref.originalColId);

  const isRefValid = (ref: TableRef | ColRef) =>
    ref.existingColId !== undefined ? isExistingColRefValid(ref) :
      ref.originalColId !== undefined ? isOriginalColRefValid(ref) :
        isTableRefValid(ref);

  schema.tables.forEach((tableSchema) => {
    tableSchema.columns.forEach((columnSchema) => {
      // Validate formula replacements
      columnSchema.formula?.replacements?.forEach((replacement) => {
        if (columnSchema.formula && !isRefValid(replacement)) {
          warnings.push(new FormulaRefWarning(columnSchema.formula, replacement));
        }
      });

      // Validate ref
      if (columnSchema.ref && !isRefValid(columnSchema.ref)) {
        warnings.push(new ColumnRefWarning(columnSchema.ref));
      }
    });
  });

  return warnings;
}

export interface ImportSchemaTransformParams {
  skipTableIds?: string[];
  mapExistingTableIds?: Map<string, string>;
  existingDocSchema?: ExistingDocSchema;
}

class NoColumnInfoForRefWarning implements DocSchemaImportWarning {
  public readonly message: string;

  constructor(public readonly ref: TableRef | ColRef) {
    this.message = `Could not find column information in the schema for this ref: ${JSON.stringify(ref)}`;
  }
}

class NoMatchingColumnWarning implements DocSchemaImportWarning {
  public readonly message: string;

  constructor(public readonly colSchema: ColumnImportSchema) {
    this.message = `Could not match column schema with an existing column: ${JSON.stringify(colSchema)}`;
  }
}

// Maps a single table/column reference to an existing table/column if needed.
function transformSchemaMapRef(schema: ImportSchema, params: ImportSchemaTransformParams, ref: TableRef | ColRef): {
  ref: TableRef | ColRef,
  warning?: DocSchemaImportWarning,
} {
  const { mapExistingTableIds, existingDocSchema } = params;
  const existingTableId = ref.originalTableId && mapExistingTableIds?.get(ref.originalTableId);
  // Preserve the reference as-is if no mapping is found or needed.
  if (!existingTableId) {
    return { ref };
  }

  // No column id - only map the table id.
  if (!ref.originalColId) {
    return { ref: { existingTableId } };
  }

  const colSchema = schema
    .tables.find(table => table.originalId === ref.originalTableId)
    ?.columns.find(column => column.originalId === ref.originalColId);

  const existingTableSchema = existingDocSchema?.tables.find(table => table.id === existingTableId);

  if (!colSchema) {
    return { ref, warning: new NoColumnInfoForRefWarning(ref) };
  }

  const matchingCol = existingTableSchema && findMatchingExistingColumn(colSchema, existingTableSchema);

  if (!matchingCol) {
    return { ref, warning: new NoMatchingColumnWarning(colSchema) };
  }

  return { ref: { existingTableId, existingColId: matchingCol.id } };
}

// TODO - Cleanup parameters and readability on this function signature
export function transformImportSchema(schema: ImportSchema,
  params: ImportSchemaTransformParams): { schema: ImportSchema, warnings: DocSchemaImportWarning[] } {

  const warnings: DocSchemaImportWarning[] = [];
  const newSchema = cloneDeep(schema);
  const { mapExistingTableIds } = params;
  const skipTableIds = params.skipTableIds ?? [];

  if (mapExistingTableIds) {
    skipTableIds.push(...mapExistingTableIds.keys());
  }

  // Skip tables - allow the validation step to pick up on any issues introduced.
  newSchema.tables = newSchema.tables.filter(table => !skipTableIds.includes(table.originalId));

  const mapRef = (originalRef: TableRef | ColRef) => {
    const { ref, warning } = transformSchemaMapRef(schema, params, originalRef);
    if (warning) {
      warnings.push(warning);
    }
    return ref;
  };

  if (mapExistingTableIds) {
    newSchema.tables.forEach((tableSchema) => {
      tableSchema.columns.forEach((columnSchema) => {
        // Manually map column properties to their existing table.
        // This is slightly error-prone long term (as each new reference needs mapping here), but manually
        // mapping fields is simple and easy for the moment.
        columnSchema.ref = columnSchema.ref && mapRef(columnSchema.ref);

        if (columnSchema.formula?.replacements) {
          columnSchema.formula.replacements = columnSchema.formula.replacements.map(mapRef);
        }
      });
    });
  }
  return { schema: newSchema, warnings };
}

function findMatchingExistingColumn(colSchema: ColumnImportSchema, existingTable: ExistingTableSchema) {
  return existingTable.columns.find(existingCol =>
    colSchema.label !== undefined && colSchema.label === existingCol.label || colSchema.desiredId === existingCol.id,
  );
}

type TableIdMapper = (id: string) => string | undefined;
type ColIdMapper = (tableId: string, colId: string) => string | undefined;
function prepareFormula(template: FormulaTemplate, mappers: { getTableId: TableIdMapper, getColId: ColIdMapper }) {
  if (!template.replacements || template.replacements.length === 0) {
    return template.formula;
  }
  return template.replacements.reduce((formula, ref, index) => {
    const tableId = ref?.existingTableId ||
      ref?.originalTableId && mappers.getTableId(ref.originalTableId);
    const colId = ref?.existingColId || ref?.originalColId && mappers.getColId(ref.originalTableId, ref.originalColId);

    if (!tableId) {
      // TODO - Warning if tableId doesn't exist
      return formula;
    }

    // existingColId doesn't need checking, as we only care about mapper failures here.
    if (ref.originalColId && !colId) {
      // TODO - Warning if colId doesn't exist
      return formula;
    }

    const replacementText = colId ?? tableId;

    return formula.replace(RegExp(`\\[R${index}\\]`, "g"), replacementText);
  }, template.formula);
}

export class DocSchemaImportError extends Error {
  constructor(message: string) {
    super(message);
  }
}
