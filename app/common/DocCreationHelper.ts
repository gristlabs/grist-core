import {RecalcWhen} from 'app/common/gristTypes';
import {GristType} from 'app/plugin/GristData';
import {UserAction} from 'app/common/DocActions';
import {ApplyUAResult} from 'app/common/ActiveDocAPI';

export type ApplyUserActionsFunc = (userActions: UserAction[]) => Promise<ApplyUAResult>;

export async function createTablesFromSchemas(schemas: TableCreationSchema[],
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

  const getTableId = getFromOrThrowIfUndefined(tableOriginalIdToGristTableId, (key) =>
    new DocCreationHelperError(`Couldn't locate Grist table id for table with original id ${key}`)
  );

  const getColId = getFromOrThrowIfUndefined(colOriginalIdToGristColId, (key) =>
    new DocCreationHelperError(`Couldn't locate Grist column id for column with original id ${key}`)
  );

  const modifyColumnActions: UserAction[] = [];
  for (const tableSchema of schemas) {
    for (const columnSchema of tableSchema.columns) {
      let type: string = columnSchema.type;
      if (type.includes("Ref")) {
          type = columnSchema.ref
            ? `${columnSchema.type}:${getTableId(columnSchema.ref.originalTableId)}`
            : "Any";
      }

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
          visibleCol: columnSchema.visibleCol?.originalColId && getColId(columnSchema.visibleCol.originalColId),
          recalcDeps: columnSchema.recalcDeps,
          recalcWhen: columnSchema.recalcWhen,
        }
      ]);
    }
  }

  await applyUserActions(modifyColumnActions);

  return {
    tableOriginalIdToGristTableId,
    colOriginalIdToGristColId,
  };
}

export interface DocCreationSchema {
  tables: TableCreationSchema[];
}

export interface TableCreationSchema {
  originalId: string;
  name: string;
  columns: ColumnCreationSchema[];
}

export type FormulaCreationFunc = (params: { getColId(originalId: string): string }) => string

export interface ColumnCreationSchema {
  originalId: string;
  desiredId: string;
  type: GristType;
  isFormula?: boolean;
  formula?: FormulaCreationFunc;
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

export class DocCreationHelperError extends Error {
  constructor(message: string) {
    super(message);
  }
}

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
