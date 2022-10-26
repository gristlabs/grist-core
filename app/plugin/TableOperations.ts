import * as Types from './DocApiTypes';

/**
 * Offer CRUD-style operations on a table.
 */
export interface TableOperations {
  /**
   * Create a record or records.
   */
  create(records: Types.NewRecord, options?: OpOptions): Promise<Types.MinimalRecord>;
  create(records: Types.NewRecord[], options?: OpOptions): Promise<Types.MinimalRecord[]>;

  /**
   * Update a record or records.
   */
  update(records: Types.Record|Types.Record[], options?: OpOptions): Promise<void>;

  /**
   * Delete a record or records.
   */
  destroy(recordIds: Types.RecordId|Types.RecordId[]): Promise<void>;

  /**
   * Add or update a record or records.
   */
  upsert(records: Types.AddOrUpdateRecord|Types.AddOrUpdateRecord[],
         options?: UpsertOptions): Promise<void>;

  /**
   * Determine the tableId of the table.
   */
  getTableId(): Promise<string>;

  // TODO: offer a way to query the table.
  // select(): Records;
}

/**
 * General options for table operations.
 */
export interface OpOptions {
  /** Whether to parse strings based on the column type. Defaults to true. */
  parseStrings?: boolean;
}

/**
 * Extra options for upserts.
 */
export interface UpsertOptions extends OpOptions {
  /** Permit inserting a record. Defaults to true. */
  add?: boolean;
  /** Permit updating a record. Defaults to true. */
  update?: boolean;
  /** Whether to update none, one, or all matching records. Defaults to "first". */
  onMany?: 'none' | 'first' | 'all';
  /** Allow "wildcard" operation. Defaults to false. */
  allowEmptyRequire?: boolean;
}
