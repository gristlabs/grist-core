import { ListAirtableRecordsResult } from "app/common/airtable/AirtableAPI";
import { AirtableTableId } from "app/common/airtable/AirtableAPITypes";
import { AirtableBaseSchemaCrosswalk, GristTableId } from "app/common/airtable/AirtableCrosswalk";
import { BulkColValues, TableColValues } from "app/common/DocActions";

export interface AirtableDataImportParams {
  listRecords: ListRecordsFunc,
  addRows: (tableId: GristTableId, rows: BulkColValues) => Promise<number[]>,
  updateRows: UpdateRowsFunc,
  uploadAttachment: UploadAttachmentFunc,
  schemaCrosswalk: AirtableBaseSchemaCrosswalk,
  onProgress?(progress: AirtableImportProgress): void,
}

export interface AirtableImportProgress {
  percent: number;
  status?: string;
}

export type ListRecordsFunc = (tableId: AirtableTableId) => Promise<ListAirtableRecordsResult>;
export type UpdateRowsFunc = (tableId: GristTableId, rows: TableColValues) => Promise<number[]>;
export type UploadAttachmentFunc = (value: string | Blob, filename?: string) => Promise<number>;
