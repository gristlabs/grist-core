import * as Types from "./DocApiTypes";
import { BulkColValues } from './GristData';
import { OpOptions, TableOperations, UpsertOptions } from './TableOperations';
import { arrayRepeat } from './gutil';
import flatMap = require('lodash/flatMap');
import isEqual = require('lodash/isEqual');
import pick = require('lodash/pick');
import groupBy = require('lodash/groupBy');

/**
 * An implementation of the TableOperations interface, given a platform
 * capable of applying user actions. Used by REST API server, and by the
 * Grist plugin API that is embedded in custom widgets.
 */
export class TableOperationsImpl implements TableOperations {
  public constructor(private _platform: TableOperationsPlatform,
                     private _defaultOptions: OpOptions) {
  }

  public getTableId() {
    return this._platform.getTableId();
  }

  public create(records: Types.NewRecord, options?: OpOptions): Promise<Types.MinimalRecord>;
  public create(records: Types.NewRecord[], options?: OpOptions): Promise<Types.MinimalRecord[]>;
  public async create(recordsOrRecord: Types.NewRecord[]|Types.NewRecord,
                      options?: OpOptions): Promise<Types.MinimalRecord[]|Types.MinimalRecord> {
    return await withRecords(recordsOrRecord, async (records) => {
      const postRecords = convertToBulkColValues(records);
      // postRecords can be an empty object, in that case we will create empty records.
      const ids = await this.addRecords(records.length, postRecords, options);
      return ids.map(id => ({id}));
    });
  }

  public async update(recordOrRecords: Types.Record|Types.Record[], options?: OpOptions) {
    await withRecords(recordOrRecords, async (records) => {
      if (!areSameFields(records)) {
        this._platform.throwError('PATCH', 'requires all records to have same fields', 400);
      }
      const rowIds = records.map(r => r.id);
      const columnValues = convertToBulkColValues(records);
      if (!rowIds.length || !columnValues) {
        // For patch method, we require at least one valid record.
        this._platform.throwError('PATCH', 'requires a valid record object', 400);
      }
      await this.updateRecords(columnValues, rowIds, options);
      return [];
    });
  }

  public async upsert(recordOrRecords: Types.AddOrUpdateRecord|Types.AddOrUpdateRecord[],
                      upsertOptions?: UpsertOptions): Promise<void> {
    await withRecords(recordOrRecords, async (records) => {
      const tableId = await this._platform.getTableId();
      const options = {
        add: upsertOptions?.add,
        update: upsertOptions?.update,
        on_many: upsertOptions?.onMany,
        allow_empty_require: upsertOptions?.allowEmptyRequire
      };
      const recordOptions: OpOptions = pick(upsertOptions, 'parseStrings');

      // Group records based on having the same keys in `require` and `fields`.
      // A single bulk action will be applied to each group.
      // We don't want one bulk action for all records that might have different shapes,
      // because that would require filling arrays with null values.
      const recGroups = groupBy(records, rec => {
        const requireKeys = Object.keys(rec.require).sort().join(',');
        const fieldsKeys = Object.keys(rec.fields || {}).sort().join(',');
        return `${requireKeys}:${fieldsKeys}`;
      });
      const actions = Object.values(recGroups).map(group => {
        const require = convertToBulkColValues(group.map(r => ({fields: r.require})));
        const fields = convertToBulkColValues(group.map(r => ({fields: r.fields || {}})));
        return ["BulkAddOrUpdateRecord", tableId, require, fields, options];
      });
      await this._applyUserActions(tableId, [...fieldNames(records)],
                                   actions, recordOptions);
      return [];
    });
  }

  public async destroy(recordIdOrRecordIds: Types.RecordId|Types.RecordId[]): Promise<void> {
    await withRecords(recordIdOrRecordIds, async (recordIds) => {
      const tableId = await this._platform.getTableId();
      const actions = [['BulkRemoveRecord', tableId, recordIds]];
      await this._applyUserActions(tableId, [], actions);
      return [];
    });
  }

  // Update records identified by rowIds. Any invalid id fails
  // the request and returns a 400 error code.
  // This is exposed as a public method to support the older /data endpoint.
  public async updateRecords(columnValues: BulkColValues, rowIds: number[],
                             options?: OpOptions) {
    await this._addOrUpdateRecords(columnValues, rowIds, 'BulkUpdateRecord', options);
  }

  /**
   * Adds records to a table. If columnValues is an empty object (or not provided) it will create empty records.
   * This is exposed as a public method to support the older /data endpoint.
   * @param columnValues Optional values for fields (can be an empty object to add empty records)
   * @param count Number of records to add
   */
  public async addRecords(
    count: number, columnValues: BulkColValues, options?: OpOptions
  ): Promise<number[]> {
    // user actions expect [null, ...] as row ids
    const rowIds = arrayRepeat(count, null);
    return this._addOrUpdateRecords(columnValues, rowIds, 'BulkAddRecord', options);
  }

  private async _addOrUpdateRecords(
    columnValues: BulkColValues, rowIds: (number | null)[],
    actionType: 'BulkUpdateRecord' | 'BulkAddRecord',
    options?: OpOptions
  ) {
    const tableId = await this._platform.getTableId();
    const colNames = Object.keys(columnValues);
    const sandboxRes = await this._applyUserActions(
      tableId, colNames,
      [[actionType, tableId, rowIds, columnValues]],
      options
    );
    return sandboxRes.retValues[0];
  }

  // Apply the supplied actions with the given options. The tableId and
  // colNames are just to improve error reporting.
  private async _applyUserActions(tableId: string, colNames: string[], actions: any[][],
                                  options: OpOptions = {}): Promise<any> {
    return handleSandboxErrorOnPlatform(tableId, colNames, this._platform.applyUserActions(
      actions, {...this._defaultOptions, ...options}
    ), this._platform);
  }
}

/**
 * The services needed by TableOperationsImpl.
 */
export interface TableOperationsPlatform {
  // Get the tableId of the table upon which we are supposed to operate.
  getTableId(): Promise<string>;

  // Throw a platform-specific error.
  throwError(verb: string, text: string, status: number): never;

  // Apply the supplied actions with the given options.
  applyUserActions(actions: any[][], opts: any): Promise<any>;
}

export function convertToBulkColValues(records: Array<Types.Record | Types.NewRecord>): BulkColValues {
  // User might want to create empty records, without providing a field name, for example for requests:
  // { records: [{}] }; { records: [{fields:{}}] }
  // Retrieve all field names from fields property.
  const result: BulkColValues = {};
  for (const fieldName of fieldNames(records)) {
    result[fieldName] = records.map(record => record.fields?.[fieldName] ?? null);
  }
  return result;
}

export function fieldNames(records: any[]) {
  return new Set<string>(flatMap(records, r => Object.keys({...r.fields, ...r.require})));
}

export function areSameFields(records: Array<Types.Record | Types.NewRecord>) {
  const recordsFields = records.map(r => new Set(Object.keys(r.fields || {})));
  return recordsFields.every(s => isEqual(recordsFields[0], s));
}

/**
 * Adapt an operation that takes a list and returns a list to an input that may
 * be a single object or a list. If input is empty list, return the empty list.
 * If input is a single object, return a single object. Otherwise return a list.
 */
async function withRecords<T, T2>(recordsOrRecord: T[]|T, op: (records: T[]) => Promise<T2[]>): Promise<T2|T2[]> {
  const records = Array.isArray(recordsOrRecord) ? recordsOrRecord : [recordsOrRecord];
  const result = records.length == 0 ? [] : await op(records);
  return Array.isArray(recordsOrRecord) ? result : result[0];
}

/**
 * Catches the errors thrown by the sandbox, and converts to more descriptive ones (such as for
 * invalid table names, columns, or rowIds) with better status codes. Accepts the table name, a
 * list of column names in that table, and a promise for the result of the sandbox call.
 */
export async function handleSandboxErrorOnPlatform<T>(
  tableId: string, colNames: string[], p: Promise<T>, platform: TableOperationsPlatform
): Promise<T> {
  try {
    return await p;
  } catch (err) {
    const message = ((err instanceof Error) && err.message?.startsWith('[Sandbox] ')) ? err.message : undefined;
    if (message) {
      let match = message.match(/non-existent record #([0-9]+)/);
      if (match) {
        platform.throwError('', `Invalid row id ${match[1]}`, 400);
      }
      match = message.match(
        // eslint-disable-next-line max-len
        /\[Sandbox] (?:KeyError u?'(?:Table \w+ has no column )?|ValueError No such table: |ValueError No such column: )([\w.]+)/
      );
      if (match) {
        if (match[1] === tableId) {
          platform.throwError('', `Table not found "${tableId}"`, 404);
        } else if (colNames.includes(match[1])) {
          platform.throwError('', `Invalid column "${match[1]}"`, 400);
        } else if (colNames.includes(match[1].replace(`${tableId}.`, ''))) {
          platform.throwError('', `Table or column not found "${match[1]}"`, 404);
        }
      }
      platform.throwError('', `Error manipulating data: ${message}`, 400);
    }
    throw err;
  }
}