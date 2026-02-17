import { AirtableFieldSchema } from "app/common/airtable/AirtableAPITypes";
import { AirtableFieldMappingInfo, GristTableId } from "app/common/airtable/AirtableCrosswalk";
import { createEmptyBulkColValues } from "app/common/airtable/AirtableReferenceTracker";
import { TableColValues } from "app/common/DocActions";
import { getMaxUploadSizeAttachmentMB } from "app/common/gristUrls";
import { arrayRepeat, byteString } from "app/common/gutil";
import { GristObjCode } from "app/plugin/GristData";

import pick from "lodash/pick";
import pLimit from "p-limit";

export type AttachmentsByColumnId = Record<string, Attachment[] | undefined>;

interface Attachment {
  filename: string;
  size: number;
  url: string;
}

interface AttachmentsForRecord {
  gristRecordId: number;
  attachmentsByColumnId: AttachmentsByColumnId;
}

export class AttachmentTracker {
  private _tableAttachmentTrackers = new Map<string, TableAttachmentTracker>();

  public addTable(gristTableId: string, columnIdsToUpdate: string[]) {
    const tableTracker = new TableAttachmentTracker(gristTableId, columnIdsToUpdate);
    this._tableAttachmentTrackers.set(gristTableId, tableTracker);
    return tableTracker;
  }

  public getTables(): TableAttachmentTracker[] {
    return Array.from(this._tableAttachmentTrackers.values());
  }
}

class TableAttachmentTracker {
  private _attachmentsForRecords: AttachmentsForRecord[] = [];

  public constructor(private _tableId: string, private _columnIds: string[]) {
  }

  public addRecord(attachmentsForRecord: AttachmentsForRecord) {
    this._attachmentsForRecords.push(attachmentsForRecord);
  }

  public async importAttachments(
    uploadAttachment: (value: string | Blob, filename?: string) => Promise<number>,
    updateRows: (tableId: GristTableId, rows: TableColValues) => Promise<number[]>,
    options: {
      maxConcurrentUploads?: number;
      updateRowsBatchSize?: number;
    } = {},
  ) {
    const { maxConcurrentUploads = 5, updateRowsBatchSize = 100 } = options;

    while (this._attachmentsForRecords.length > 0) {
      const attachmentsForRecords = this._attachmentsForRecords.splice(0, updateRowsBatchSize);
      const limit = pLimit(maxConcurrentUploads);
      const tableColValues: TableColValues = { id: [], ...createEmptyBulkColValues(this._columnIds) };
      const uploads: Promise<void>[] = [];

      for (let rowIdx = 0; rowIdx < attachmentsForRecords.length; rowIdx++) {
        const { gristRecordId, attachmentsByColumnId } = attachmentsForRecords[rowIdx];

        tableColValues.id.push(gristRecordId);

        for (const colId of this._columnIds) {
          const attachments = attachmentsByColumnId[colId] ?? [];
          const cellValue: [GristObjCode.List, ...(number | undefined)[]] = [
            GristObjCode.List, ...arrayRepeat(attachments.length, undefined)];
          tableColValues[colId][rowIdx] = cellValue;

          attachments.forEach((attachment, index) => {
            uploads.push(
              limit(() => this._uploadAttachment(attachment, uploadAttachment)).then((id) => {
                cellValue[index + 1] = id;
              }),
            );
          });
        }
      }

      // TODO: Use a pipeline instead of batching uploads. Batches are only as fast as the slowest
      // item, and a particularly large attachment could hold up starting a new batch.
      // Also consider switching to allSettled and reporting any warnings/errors to the client.
      // Note that all errors are currently handled by _uploadAttachment, so this call shouldn't
      // throw.
      await Promise.all(uploads);

      for (const colId of this._columnIds) {
        for (let rowIdx = 0; rowIdx < attachmentsForRecords.length; rowIdx++) {
          const cellValue = tableColValues[colId][rowIdx] as [GristObjCode.List, ...(number | undefined)[]];
          const attachmentIds = cellValue.slice(1) as (number | undefined)[];
          tableColValues[colId][rowIdx] = [GristObjCode.List, ...attachmentIds.filter(id => id !== undefined)];
        }
      }

      await updateRows(this._tableId, tableColValues);
    }
  }

  private async _uploadAttachment(
    { filename, size, url }: Attachment,
    uploadAttachment: (value: string | Blob, filename?: string) => Promise<number>,
  ): Promise<number | undefined> {
    try {
      const maxSize = getMaxUploadSizeAttachmentMB() * 1024 * 1024;
      if (size > maxSize) {
        throw new Error(`Attachments must not exceed ${byteString(maxSize)}`);
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();
      return await uploadAttachment(blob, filename);
    } catch (error) {
      console.error(`Failed to upload attachment "${filename}" (URL: ${url}):`, error);
      return undefined;
    }
  }
}

export function isAttachmentField({ type }: AirtableFieldSchema) {
  return type === "multipleAttachments";
}

export function extractAttachmentsFromRecordField(
  fieldValue: any,
  fieldMapping: AirtableFieldMappingInfo,
): Attachment[] | undefined {
  if (fieldMapping.airtableField.type !== "multipleAttachments") { return undefined; }

  const attachments = Array.isArray(fieldValue) ? fieldValue : undefined;
  if (!attachments) { return undefined; }

  return attachments.map(a => pick(a, "filename", "size", "url"));
}
