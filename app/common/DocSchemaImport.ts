import { ApplyUAResult } from "app/common/ActiveDocAPI";
import { UserAction } from "app/common/DocActions";
import { RecalcWhen } from "app/common/gristTypes";
import { GristType } from "app/plugin/GristData";

import { cloneDeep } from "lodash";

/**
 * A self-contained schema for a Grist document, that can be declared, validated and then used
 * to generate Grist tables and columns.
 *
 * Acts as an intermediate target for external import tools, e.g.
 *     Airtable base -> Airtable importer -> Grist import schema -> Grist document
 *
 * Supports internal references, where one element of the import schema references another.
 * These are translated to real Grist tables / columns during Grist doc creation.
 */
export interface ImportSchema {
  tables: TableImportSchema[];
}

export interface TableImportSchema {
  // Original ID of the table in the source (e.g. airtable), or an arbitrary ID
  // Can be referenced in other parts of the schema, and will be converted to a real Grist id during import.
  originalId: string;
  // Name for the table in Grist
  name: string;
  columns: ColumnImportSchema[];
}

export interface ColumnImportSchema {
  // Original ID of the column in the source (e.g. airtable), or an arbitrary ID.
  // Must be unique within the table, but not globally unique.
  // Can be referenced in other parts of the schema, and will be converted to a real Grist id during import.
  originalId: string;
  // ID the column should have in Grist. This will be transformed during import and won't match exactly.
  desiredId: string;
  // Grist column type.
  type: GristType;
  // Is the column a formula column (and not a data column)? False with `formula` set for trigger formulas.
  isFormula?: boolean;
  // Formula for the column. See FormulaTemplate docs for more information on format.
  formula?: FormulaTemplate;
  // Label for the column - will be preserved exactly.
  label?: string;
  // Description for the column.
  description?: string;
  // TODO - Only allow null until ID mapping is implemented
  recalcDeps?: /* { originalColId: string }[] | */ null;
  // When the trigger formula (if provided) will be recalculated.
  recalcWhen?: RecalcWhen;
  // If this column is a reference column, sets the table that's referenced.
  // If a column reference is provided (instead of a table reference), shows that columns value.
  ref?: TableRef | ColRef;
  // Prevents column id changing when label is changed when True.
  untieColIdFromLabel?: boolean;
  // Options for the column's display (e.g. currency formatting). Varies based on column type.
  widgetOptions?: Record<string, any>;
}

/**
 * Formula columns are often needed to replicate columns found in other tools,
 * such as Airtable's count column.
 *
 * An import schema doesn't know the IDs of the final Grist columns that will be created, due to
 * Grist transforming column IDs when they're created (e.g. "My Column " becomes "My_Column_").
 * Pre-calculating the ID isn't guaranteed to match - especially if the code changes over time.
 *
 * The formula template allows a formula to be written with placeholders (e.g. `len([R0])`),
 * which are later replaced by the real Grist table or column ids after they're created.
 *
 * The `replacements` field specifies what will be substituted. These replacements can be:
 * - References to tables or columns within the schema - which are transformed into real Grist
 *   ids before being substituted.
 * - References to existing tables or columns in the document - these are preserved as-is.
 *
 * E.g.
 * - { originalTableId: "32", originalColId: "10" } with `len($[R0])` will possibly become `len($Col10)
 * - { originalTableId: "32" } with `[R0].lookupOne()` will possibly become `MyTable32.lookupOne()`
 * - { existingTableId: "Table1" } with `[R0].lookupOne()` will definitely become `Table1.lookupOne()`
 *
 * Square brackets are used to prevent collisions with Javascript/Python template syntax.
 */
export interface FormulaTemplate {
  formula: string,
  replacements?: (TableRef | ColRef)[],
}

/**
 * Reference to a table within the import schema (i.e. using the table's originalId);
 */
interface OriginalTableRef {
  originalTableId: string;
  // 'never' types below allow convenient type guard usage
  // e.g. `if (ref.originalTableId && ref.originalColId === undefined)` will narrow any ref to an
  // OriginalTableRef.
  originalColId?: never;

  existingTableId?: never;
  existingColId?: never;
}

/**
 * Reference to a table that already exists in the Grist doc. Uses the table's Grist id.
 */
interface ExistingTableRef {
  originalTableId?: never;
  originalColId?: never;

  existingTableId: string;
  existingColId?: never;
}

// Any table reference - can be narrowed using `ref.originalTableId !== undefined`
type TableRef = OriginalTableRef | ExistingTableRef;

/**
 * Reference to a column within the import schema (i.e. using the column's originalId);
 * A table ID also needs to be provided as column ids may not be unique.
 */
interface OriginalColRef {
  existingTableId?: never;
  existingColId?: never;

  originalTableId: string;
  originalColId: string;
}

/**
 * Reference to a column that already exists in the Grist doc. Uses the table and column's Grist id.
 */
interface ExistingColRef {
  existingTableId: string;
  existingColId: string;

  originalTableId?: never;
  originalColId?: never;
}

// Any column reference - can be narrowed using `ref.originalColumnId !== undefined`
type ColRef = OriginalColRef | ExistingColRef;

// References to the import schema (i.e. using original id) can be resolved to an actual Grist
// id, once tables / columns are created. This maps the types from a schema (original) reference to
// an existing one.
type ResolvedRef<T> =
  T extends (ExistingColRef | OriginalColRef) ? ExistingColRef :
    T extends (ExistingTableRef | OriginalTableRef) ? ExistingTableRef :
      T extends undefined ? undefined : never;

export type ApplyUserActionsFunc = (userActions: UserAction[]) => Promise<ApplyUAResult>;

/**
 * Imports an ImportSchema, adding tables / columns to a document until it matches the schema's contents.
 *
 * This will not modify existing tables, and should be entirely non-destructive.
 *
 * Generates and applies user actions, meaning this tool works anywhere a user action can be applied
 * to a document.
 */
export class DocSchemaImportTool {
  // Abstracting user action application allows this logic to work on both frontend and backend.
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

    const tableIdsMap = new Map<string, TableIdsInfo>();

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

    const refResolvers = makeResolveRefFuncs(tableIdsMap);
    // Errors should only be thrown when:
    // - An id is needed (e.g. the ids passed as targets for the user action)
    // - The id will always exist if the import is running correctly (e.g. ids created in the previous step)
    // Any other unresolved references (e.g. to existing columns that don't actually exist) should be warnings.
    const { resolveRef, resolveRefOrThrow } = refResolvers;

    const modifyColumnActions: UserAction[] = [];
    for (const tableSchema of tableSchemas) {
      for (const columnSchema of tableSchema.columns) {
        let type: string = columnSchema.type;
        const resolvedSchemaRef = resolveRef(columnSchema.ref);
        if (type.includes("Ref")) {
          // TODO - show a warning here if we couldn't resolve a table id
          type = resolvedSchemaRef ?
            `${columnSchema.type}:${resolvedSchemaRef.existingTableId}` :
            "Any";
        }

        const existingColRef = resolveRefOrThrow({
          originalTableId: tableSchema.originalId,
          originalColId: columnSchema.originalId,
        });

        modifyColumnActions.push([
          "ModifyColumn",
          existingColRef.existingTableId,
          existingColRef.existingColId,
          {
            type,
            isFormula: columnSchema.isFormula ?? false,
            formula: columnSchema.formula && prepareFormula(columnSchema.formula, refResolvers),
            label: columnSchema.label,
            // Need to decouple it - otherwise our stored column ids may now be invalid.
            untieColIdFromLabel: columnSchema.label !== undefined,
            description: columnSchema.description,
            widgetOptions: JSON.stringify(columnSchema.widgetOptions),
            visibleCol: resolvedSchemaRef?.existingColId,
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
  // Label is required for column matching to work correctly.
  label?: string;
}

/**
 * Implemented by all schema-related warnings. Should be used almost exclusively (instead of actual
 * warning types) to allow compatibility between the different places that generate warnings.
 *
 * "Warnings" here means anything the code thinks is important to show to the user, and may be
 * purely informational or a significant error.
 */
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
 * The type system covers the majority of possible issues (e.g. missing properties) but not all
 * combinations of fields.
 *
 * This primarily deals with checking referential integrity, ensuring internal schema references
 * ( original id references ) are valid and that existing references point to a valid part of
 * existingSchema.
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

      // Validate reference columns
      if (columnSchema.ref && !isRefValid(columnSchema.ref)) {
        warnings.push(new ColumnRefWarning(columnSchema.ref));
      }
    });
  });

  return warnings;
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

/**
 * All transformations that can be applied to an import schema.
 */
export interface ImportSchemaTransformParams {
  // Remove these tables from the schema. May result in invalid references that don't pass validation.
  skipTableIds?: string[];
  // Maps internal schema references to a table that already exists in the document.
  // Implies that the table will be added to skipTableIds (and not created).
  // Will attempt to automatically match column references with columns in the existing table.
  mapExistingTableIds?: Map<string, string>;
  // Details of tables and columns in the existing document - required to map references.
  existingDocSchema?: ExistingDocSchema;
}

/**
 * Applies one or more transformations an import schema (see {ImportSchemaTransformParams}).
 *
 * @param {ImportSchema} schema Original schema to transform
 * @param {ImportSchemaTransformParams} params Transformations that should be applied.
 * @returns {{schema: ImportSchema, warnings: DocSchemaImportWarning[]}} The transformed schema (a
 *  deep copy) and warnings for any issues with the transformed schema.
 */
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

// Maps a single reference in the import schema to a new reference for the transformed schema,
// based on the requested transformations. May raise a warning if a problem is found.
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

// Given a column schema, attempts to find a corresponding column in an existing table.
function findMatchingExistingColumn(colSchema: ColumnImportSchema, existingTable: ExistingTableSchema) {
  return existingTable.columns.find(existingCol =>
    colSchema.label !== undefined && colSchema.label === existingCol.label || colSchema.desiredId === existingCol.id,
  );
}

// Converts a FormulaTemplate into a formula, resolving any IDs that need mapping and substituting
// them into the formula.
function prepareFormula(template: FormulaTemplate, mappers: ReturnType<typeof makeResolveRefFuncs>) {
  if (!template.replacements || template.replacements.length === 0) {
    return template.formula;
  }
  return template.replacements.reduce((formula, ref, index) => {
    const resolvedRef = mappers.resolveRef(ref);

    if (resolvedRef === undefined) {
      // TODO - Warning if formula replacements couldn't be mapped.
      return formula;
    }

    const replacementText = resolvedRef.existingColId ?? resolvedRef.existingTableId;

    return formula.replace(RegExp(`\\[R${index}\\]`, "g"), replacementText);
  }, template.formula);
}

export class DocSchemaImportError extends Error {
  constructor(message: string) {
    super(message);
  }
}

// Small helper function throwing an import error when a reference can't be resolved.
function throwUnresolvedRefError(ref: TableRef | ColRef) {
  if (ref.originalColId) {
    throw new DocSchemaImportError(
      `Couldn't find Grist column id for column '${ref.originalColId}' in table '${ref.originalTableId}'`,
    );
  }
  throw new DocSchemaImportError(`Couldn't locate Grist table id for table ${ref.originalTableId}`);
}

/**
 * Creates helper functions that resolve internal schema references that use `originalId` to
 * references to existing Grist entities (tables or columns).
 */
function makeResolveRefFuncs(tableIdsMap: Map<string, TableIdsInfo>) {
  /**
   * Resolves any reference type to an ExistingXRef or undefined, if there's no mapping possible.
   *
   * Generic overloads greatly simplify type checking, by always returning the narrowest type possible.
   * E.g. a table reference input will always result in a table reference returned.
   * E.g. Avoids introducing undefined if it isn't necessary (existing references are always resolvable)
   */
  function resolveRef<T extends (ExistingTableRef | ExistingColRef | undefined)>(ref: T): ResolvedRef<T>;
  function resolveRef<T extends (TableRef | ColRef | undefined)>(ref: T): ResolvedRef<T>;
  function resolveRef(ref?: TableRef | ColRef): ExistingTableRef | ExistingColRef | undefined {
    if (ref === undefined) { return undefined; }
    if (ref.existingTableId !== undefined) { return ref; }
    const tableIds = tableIdsMap.get(ref.originalTableId);
    if (!tableIds) { return undefined; }
    if (ref.originalColId === undefined) {
      return { existingTableId: tableIds.gristId };
    }
    const colId = tableIds.columnIdMap.get(ref.originalColId);
    if (colId === undefined) { return undefined; }
    return { existingTableId: tableIds.gristId, existingColId: colId };
  }

  /**
   * Wrapper for resolveRef that throws if the reference isn't mappable.
   */
  function resolveRefOrThrow<T extends (TableRef | ColRef)>(ref: T) {
    const resolvedRef = resolveRef(ref);
    if (resolvedRef === undefined) {
      throwUnresolvedRefError(ref);
    }
    return resolvedRef;
  }

  return {
    resolveRef,
    resolveRefOrThrow,
  };
}

interface TableIdsInfo {
  originalId: string;
  gristId: string;
  gristRefId: number;
  columnIdMap: Map<string, string>;
}
