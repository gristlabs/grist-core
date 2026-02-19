import { ListAirtableRecordsResult } from "app/common/airtable/AirtableAPI";
import { AirtableTableId } from "app/common/airtable/AirtableAPITypes";
import { AirtableBaseSchemaCrosswalk, GristTableId } from "app/common/airtable/AirtableCrosswalk";
import { BulkColValues, TableColValues } from "app/common/DocActions";

/**
 * Parameters for importing data from Airtable into Grist.
 */
export interface AirtableDataImportParams {
  // Airtable data API operations. Used to export data from Airtable.
  listRecords: ListRecordsFunc,

  // Grist data API operations. Used to import data into Grist.
  addRows: AddRowsFunc,
  updateRows: UpdateRowsFunc,
  uploadAttachment: UploadAttachmentFunc,

  // Mapping of Airtable tables to Grist tables.
  schemaCrosswalk: AirtableBaseSchemaCrosswalk,

  onProgress?(progress: AirtableImportProgress): void,
}

/**
 * The progress of an Airtable import.
 *
 * Used by the UI to show a progress bar with an optional status message communicating
 * the current operation in progress (e.g. importing attachments).
 */
export interface AirtableImportProgress {
  percent: number;
  status?: string;
}

/**
 * Function that fetches records from an Airtable table.
 */
export type ListRecordsFunc = (tableId: AirtableTableId) => Promise<ListAirtableRecordsResult>;

/**
 * Function that adds rows to a Grist table.
 */
type AddRowsFunc = (tableId: GristTableId, rows: BulkColValues) => Promise<number[]>;

/**
 * Function that updates the column value(s) of a set of rows in a Grist table.
 */
export type UpdateRowsFunc = (tableId: GristTableId, rows: TableColValues) => Promise<number[]>;

/**
 * Function that uploads an attachment blob to Grist and returns the attachment ID.
 */
export type UploadAttachmentFunc = (value: string | Blob, filename?: string) => Promise<number>;
