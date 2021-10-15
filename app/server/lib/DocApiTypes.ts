import { CellValue } from "app/plugin/GristData";

/**
 * JSON schema for api /record endpoint. Used in POST method for adding new records.
 */
export interface NewRecord {
  fields?: { [coldId: string]: CellValue }; // fields is optional, user can create blank records
}

/**
 * JSON schema for api /record endpoint. Used in PATCH method for updating existing records.
 */
export interface Record {
  id: number;
  fields: { [coldId: string]: CellValue };
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
