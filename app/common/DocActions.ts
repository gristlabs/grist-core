/**
 * This mirrors action definitions from sandbox/grist/actions.py
 */

// Some definitions have moved to be part of plugin API.
import { BulkColValues, CellValue, RowRecord } from 'app/plugin/GristData';
export type { BulkColValues, CellValue, RowRecord };

// Part of a special CellValue used for comparisons, embedding several versions of a CellValue.
export interface AllCellVersions {
  parent: CellValue;
  remote: CellValue;
  local: CellValue;
}
export type CellVersions = Partial<AllCellVersions>;

export type AddRecord = ['AddRecord', string, number, ColValues];
export type BulkAddRecord = ['BulkAddRecord', string, number[], BulkColValues];
export type RemoveRecord = ['RemoveRecord', string, number];
export type BulkRemoveRecord = ['BulkRemoveRecord', string, number[]];
export type UpdateRecord = ['UpdateRecord', string, number, ColValues];
export type BulkUpdateRecord = ['BulkUpdateRecord', string, number[], BulkColValues];

export type ReplaceTableData = ['ReplaceTableData', string, number[], BulkColValues];

// This is the format in which data comes when we fetch a table from the sandbox.
export type TableDataAction = ['TableData', string, number[], BulkColValues];

export type AddColumn = ['AddColumn', string, string, ColInfo];
export type RemoveColumn = ['RemoveColumn', string, string];
export type RenameColumn = ['RenameColumn', string, string, string];
export type ModifyColumn = ['ModifyColumn', string, string, Partial<ColInfo>];

export type AddTable = ['AddTable', string, ColInfoWithId[]];
export type RemoveTable = ['RemoveTable', string];
export type RenameTable = ['RenameTable', string, string];

export type DocAction = (
  AddRecord |
  BulkAddRecord |
  RemoveRecord |
  BulkRemoveRecord |
  UpdateRecord |
  BulkUpdateRecord |
  ReplaceTableData |
  TableDataAction |
  AddColumn |
  RemoveColumn |
  RenameColumn |
  ModifyColumn |
  AddTable |
  RemoveTable |
  RenameTable
);

// type guards for convenience - see:
//   https://www.typescriptlang.org/docs/handbook/advanced-types.html#user-defined-type-guards
export function isAddRecord(act: DocAction): act is AddRecord { return act[0] === 'AddRecord'; }
export function isBulkAddRecord(act: DocAction): act is BulkAddRecord { return act[0] === 'BulkAddRecord'; }
export function isRemoveRecord(act: DocAction): act is RemoveRecord { return act[0] === 'RemoveRecord'; }
export function isBulkRemoveRecord(act: DocAction): act is BulkRemoveRecord { return act[0] === 'BulkRemoveRecord'; }
export function isUpdateRecord(act: DocAction): act is UpdateRecord { return act[0] === 'UpdateRecord'; }
export function isBulkUpdateRecord(act: DocAction): act is BulkUpdateRecord { return act[0] === 'BulkUpdateRecord'; }

export function isReplaceTableData(act: DocAction): act is ReplaceTableData { return act[0] === 'ReplaceTableData'; }

export function isAddColumn(act: DocAction): act is AddColumn { return act[0] === 'AddColumn'; }
export function isRemoveColumn(act: DocAction): act is RemoveColumn { return act[0] === 'RemoveColumn'; }
export function isRenameColumn(act: DocAction): act is RenameColumn { return act[0] === 'RenameColumn'; }
export function isModifyColumn(act: DocAction): act is ModifyColumn { return act[0] === 'ModifyColumn'; }

export function isAddTable(act: DocAction): act is AddTable { return act[0] === 'AddTable'; }
export function isRemoveTable(act: DocAction): act is RemoveTable { return act[0] === 'RemoveTable'; }
export function isRenameTable(act: DocAction): act is RenameTable { return act[0] === 'RenameTable'; }


const SCHEMA_ACTIONS = new Set(['AddTable', 'RemoveTable', 'RenameTable', 'AddColumn',
  'RemoveColumn', 'RenameColumn', 'ModifyColumn']);

const DATA_ACTIONS = new Set(['AddRecord', 'RemoveRecord', 'UpdateRecord', 'BulkAddRecord',
  'BulkRemoveRecord', 'BulkUpdateRecord', 'ReplaceTableData', 'TableData']);

/**
 * Determines whether a given action is a schema action or not.
 */
export function isSchemaAction(action: DocAction):
    action is AddTable | RemoveTable | RenameTable | AddColumn | RemoveColumn | RenameColumn | ModifyColumn {
  return SCHEMA_ACTIONS.has(action[0]);
}

export function isDataAction(action: DocAction|UserAction):
    action is AddRecord | RemoveRecord | UpdateRecord |
              BulkAddRecord | BulkRemoveRecord | BulkUpdateRecord |
              ReplaceTableData | TableDataAction {
  return DATA_ACTIONS.has(String(action[0]));
}

/**
 * Returns the tableId from the action.
 */
export function getTableId(action: DocAction): string {
  return action[1];   // It happens to always be in the same position in the action tuple.
}

export interface TableDataActionSet {
  [tableId: string]: TableDataAction;
}

// Helper types used in the definitions above.

export interface ColValues { [colId: string]: CellValue; }
export interface ColInfoMap { [colId: string]: ColInfo; }

export interface ColInfo {
  type: string;
  isFormula: boolean;
  formula: string;
}

export interface ColInfoWithId extends ColInfo {
  id: string;
}

// Multiple records in column-oriented format, i.e. same as BulkColValues but with a mandatory
// 'id' column. This is preferred over TableDataAction in external APIs.
export interface TableColValues {
  id: number[];
  [colId: string]: CellValue[];
}

// Multiple records in record-oriented format
export interface TableRecordValues {
  records: TableRecordValue[];
}

export interface TableRecordValue {
  id: number | string;
  fields: {
    [colId: string]: CellValue
  };
}

// Both UserActions and DocActions are represented as [ActionName, ...actionArgs].
// TODO I think it's better to represent DocAction as a Buffer containing the marshalled action.

export type UserAction = Array<string|number|object|boolean|null|undefined>;

// Actions that are performed automatically by the server
// for things like regular maintenance or triggering formula calculations in the data engine.
// Typically applied using `makeExceptionalDocSession("system")`.
// They're also 'non-essential' in the sense that we don't need to worry about storing them
// in action/undo history if they don't change anything (which they often won't)
// and we can dismiss their result if the document is shutting down.
export const SYSTEM_ACTIONS = new Set([
  // Initial dummy action performed when the document laods.
  'Calculate',
  // Called automatically at regular intervals, again to trigger formula calculations.
  'UpdateCurrentTime',
  // Part of the formula calculation process for formulas that use the `REQUEST` function.
  'RespondToRequests',
  // Performed at shutdown to clean up temporary helper columns.
  'RemoveTransformColumns'
]);

export function getNumRows(action: DocAction): number {
  return !isDataAction(action) ? 0
    : Array.isArray(action[2]) ? action[2].length
    : 1;
}

// Convert from TableColValues (used by DocStorage and external APIs) to TableDataAction (used
// mainly by the sandbox).
export function toTableDataAction(tableId: string, colValues: TableColValues): TableDataAction {
  const colData = {...colValues};   // Make a copy to avoid changing passed-in arguments.
  const rowIds: number[] = colData.id;
  delete (colData as BulkColValues).id;
  return ['TableData', tableId, rowIds, colData];
}

// Convert from TableDataAction (used mainly by the sandbox) to TableColValues (used by DocStorage
// and external APIs).
// Also accepts a TableDataAction nested as a tableData member of a larger structure,
// for convenience in dealing with the result of fetches.
export function fromTableDataAction(tableData: TableDataAction|{tableData: TableDataAction}): TableColValues {
  const data = ('tableData' in tableData) ? tableData.tableData : tableData;
  const rowIds: number[] = data[2];
  const colValues: BulkColValues = data[3];
  return {id: rowIds, ...colValues};
}

/**
 * Convert a list of rows into an object with columns of values, used for
 * BulkAddRecord/BulkUpdateRecord actions.
 */
export function getColValues(records: Partial<RowRecord>[]): BulkColValues {
  const colIdSet = new Set<string>();
  for (const r of records) {
    for (const c of Object.keys(r)) {
      if (c !== 'id') {
        colIdSet.add(c);
      }
    }
  }
  const result: BulkColValues = {};
  for (const colId of colIdSet) {
    result[colId] = records.map(r => r[colId]!);
  }
  return result;
}

/**
 * Extract the col ids mentioned in a record-related DocAction as a list
 * (even if the action is not a bulk action). Returns undefined if no col ids
 * mentioned.
 */
export function getColIdsFromDocAction(docActions: RemoveRecord | BulkRemoveRecord | AddRecord |
  BulkAddRecord | UpdateRecord | BulkUpdateRecord | ReplaceTableData |
  TableDataAction): string[] | undefined {
  if (docActions[3]) { return Object.keys(docActions[3]); }
  return undefined;
}

/**
 * Extract column values for a particular column as CellValue[] from a
 * record-related DocAction. Undefined if absent.
 */
export function getColValuesFromDocAction(docAction: RemoveRecord | BulkRemoveRecord | AddRecord |
  BulkAddRecord | UpdateRecord | BulkUpdateRecord | ReplaceTableData |
  TableDataAction, colId: string): CellValue[]|undefined {
  const colValues = docAction[3];
  if (!colValues) { return undefined; }
  const cellValues = colValues[colId];
  if (!cellValues) { return undefined; }
  if (Array.isArray(docAction[2])) {
    return cellValues as CellValue[];
  } else {
    return [cellValues as CellValue];
  }
}
