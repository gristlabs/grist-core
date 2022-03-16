import * as Types from 'app/plugin/DocApiTypes';

/**
 * Offer CRUD-style operations on a table.
 */
export interface TableOperations {
  // Create a record or records.
  create(records: Types.NewRecord, options?: OpOptions): Promise<Types.MinimalRecord>;
  create(records: Types.NewRecord[], options?: OpOptions): Promise<Types.MinimalRecord[]>;

  // Update a record or records.
  update(records: Types.Record|Types.Record[], options?: OpOptions): Promise<void>;

  // Delete a record or records.
  destroy(recordId: Types.RecordId): Promise<Types.RecordId>;
  destroy(recordIds: Types.RecordId[]): Promise<Types.RecordId[]>;

  // Add or update a record or records.
  upsert(records: Types.AddOrUpdateRecord|Types.AddOrUpdateRecord[],
         options?: UpsertOptions): Promise<void>;

  // Determine the tableId of the table.
  getTableId(): Promise<string>;

  // TODO: offer a way to query the table.
  // select(): Records;
}

/**
 * General options for table operations.
 * By default, string field values will be parsed based on the column type.
 * This can be disabled.
 */
export interface OpOptions {
  parseStrings?: boolean;
}

/**
 * Extra options for upserts. By default, add and update are true,
 * onMany is first, and allowEmptyRequire is false.
 */
export interface UpsertOptions extends OpOptions {
  add?: boolean;      // permit inserting a record
  update?: boolean;   // permit updating a record
  onMany?: 'none' | 'first' | 'all';  // whether to update none, one, or all matching records
  allowEmptyRequire?: boolean; // allow "wildcard" operation
}
