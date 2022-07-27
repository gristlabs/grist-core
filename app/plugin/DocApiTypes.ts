import { CellValue } from "app/plugin/GristData";

/**
 * JSON schema for api /record endpoint. Used in POST method for adding new records.
 */
export interface NewRecord {
  /**
   * Initial values of cells in record. Optional, if not set cells are left
   * blank.
   */
  fields?: { [coldId: string]: CellValue };
}

/**
 * JSON schema for api /record endpoint. Used in PATCH method for updating existing records.
 */
export interface Record {
  id: number;
  fields: { [coldId: string]: CellValue };
}

/**
 * JSON schema for api /record endpoint. Used in PUT method for adding or updating records.
 */
export interface AddOrUpdateRecord {
  /**
   * The values we expect to have in particular columns, either by matching with
   * an existing record, or creating a new record.
   */
  require: { [coldId: string]: CellValue } & { id?: number };

  /**
   * The values we will place in particular columns, either overwriting values in
   * an existing record, or setting initial values in a new record.
   */
  fields?: { [coldId: string]: CellValue };
}

/**
 * JSON schema for the body of api /record PATCH endpoint
 */
export interface RecordsPatch {
  records: [Record, ...Record[]]; // at least one record is required
}

/**
 * JSON schema for the body of api /record POST endpoint
 */
export interface RecordsPost {
  records: [NewRecord, ...NewRecord[]]; // at least one record is required
}

/**
 * JSON schema for the body of api /record PUT endpoint
 */
export interface RecordsPut {
  records: [AddOrUpdateRecord, ...AddOrUpdateRecord[]]; // at least one record is required
}

export type RecordId = number;

/**
 * The row id of a record, without any of its content.
 */
export interface MinimalRecord {
  id: number
}
