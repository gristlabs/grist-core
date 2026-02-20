import { AirtableFieldSchema } from "app/common/airtable/AirtableAPITypes";
import {
  AttachmentsByColumnId,
  AttachmentTracker,
  extractAttachmentsFromRecordField,
  isAttachmentField,
  TableAttachmentTracker,
} from "app/common/airtable/AirtableAttachmentTracker";
import { AirtableDataImportParams } from "app/common/airtable/AirtableDataImporterTypes";
import {
  createEmptyBulkColValues,
  extractRefFromRecordField,
  isRefField,
  ReferenceTracker,
  RefValuesByColumnId,
  TableReferenceTracker,
} from "app/common/airtable/AirtableReferenceTracker";
import { BulkColValues, CellValue, GristObjCode } from "app/plugin/GristData";

export async function importDataFromAirtableBase(
  { listRecords, addRows, updateRows, uploadAttachment, schemaCrosswalk, onProgress }: AirtableDataImportParams,
) {
  const referenceTracker = new ReferenceTracker();
  const attachmentTracker = new AttachmentTracker();

  const addRowsPromises: Promise<any>[] = [];

  // TODO: Strings passed to onProgress calls in common code aren't translatable.
  onProgress?.({ percent: 0, status: "Importing records from Airtable..." });

  for (const [tableId, tableCrosswalk] of schemaCrosswalk.tables.entries()) {
    // Filter out any formula columns early - Grist will error on any write to formula columns.
    const fieldMappings = Array.from(tableCrosswalk.fields.values()).filter(mapping => !mapping.gristColumn.isFormula);
    const gristColumnIds = fieldMappings.map(mapping => mapping.gristColumn.id);

    // Airtable ID needs to be handled separately to fields, as it's not stored as a field in Airtable
    if (tableCrosswalk.airtableIdColumn) {
      gristColumnIds.push(tableCrosswalk.airtableIdColumn.id);
    }

    const referenceColumnIds = Array.from(tableCrosswalk.fields.values())
      .filter(mapping => isRefField(mapping.airtableField))
      .map(mapping => mapping.gristColumn.id);

    let tableReferenceTracker: TableReferenceTracker | undefined;
    if (referenceColumnIds.length > 0) {
      tableReferenceTracker = referenceTracker.addTable(tableCrosswalk.gristTable.id, referenceColumnIds);
    }

    const attachmentColumnIds = Array.from(tableCrosswalk.fields.values())
      .filter(mapping => isAttachmentField(mapping.airtableField))
      .map(mapping => mapping.gristColumn.id);

    let tableAttachmentTracker: TableAttachmentTracker | undefined;
    if (attachmentColumnIds.length > 0) {
      tableAttachmentTracker = attachmentTracker.addTable(tableCrosswalk.gristTable.id, attachmentColumnIds);
    }

    let listRecordsResult = await listRecords(tableId);

    while (listRecordsResult.records.length > 0) {
      const { records } = listRecordsResult;

      const colValues: BulkColValues = createEmptyBulkColValues(gristColumnIds);
      const airtableRecordIds: string[] = [];
      const refsByColumnIdForRecords: RefValuesByColumnId[] = [];
      const attachmentsByColumnIdForRecords: AttachmentsByColumnId[] = [];

      for (const record of records) {
        const refsByColumnId: RefValuesByColumnId = {};
        const attachmentsByColumnId: AttachmentsByColumnId = {};

        airtableRecordIds.push(record.id);
        for (const fieldMapping of fieldMappings) {
          const { airtableField, gristColumn } = fieldMapping;
          const rawFieldValue = record.fields[airtableField.name];

          if (isRefField(airtableField)) {
            refsByColumnId[gristColumn.id] = extractRefFromRecordField(rawFieldValue, fieldMapping);
          }

          if (isAttachmentField(airtableField)) {
            attachmentsByColumnId[gristColumn.id] = extractAttachmentsFromRecordField(rawFieldValue, fieldMapping);
          }

          if (isRefField(airtableField) || isAttachmentField(airtableField)) {
            // Column should remain blank until it's filled in by a later step.
            colValues[gristColumn.id].push(null);
            continue;
          }

          const converter =
            AirtableFieldValueConverters[fieldMapping.airtableField.type] ?? AirtableFieldValueConverters.identity;

          const value = converter(fieldMapping.airtableField, record.fields[fieldMapping.airtableField.name]);

          // Always push, even if the value is undefined, so that row values are always at the right index.
          colValues[fieldMapping.gristColumn.id].push(value ?? null);
        }

        if (tableCrosswalk.airtableIdColumn) {
          colValues[tableCrosswalk.airtableIdColumn.id].push(record.id);
        }

        refsByColumnIdForRecords.push(refsByColumnId);
        attachmentsByColumnIdForRecords.push(attachmentsByColumnId);
      }

      const addRowsPromise = addRows(tableCrosswalk.gristTable.id, colValues)
        .then((gristRowIds) => {
          airtableRecordIds.forEach((airtableRecordId, index) => {
            // Only add entries to the reference and attachment trackers once we know they're added to the table.
            referenceTracker.addRecordIdMapping(airtableRecordId, gristRowIds[index]);
            tableReferenceTracker?.addUnresolvedRecord({
              gristRecordId: gristRowIds[index],
              refsByColumnId: refsByColumnIdForRecords[index],
            });
            tableAttachmentTracker?.addRecord({
              gristRecordId: gristRowIds[index],
              attachmentsByColumnId: attachmentsByColumnIdForRecords[index],
            });
          });
        });

      addRowsPromises.push(addRowsPromise);

      listRecordsResult = await listRecordsResult.fetchNextPage();
    }
  }

  // Future improvement - report all errors here using Promise.allSettled, or continue even if
  //                      a few sets of rows throw errors
  await Promise.all(addRowsPromises);

  for (const tableReferenceTracker of referenceTracker.getTables()) {
    await tableReferenceTracker.bulkUpdateRowsWithUnresolvedReferences(updateRows);
  }

  const totalAttachmentsCount = attachmentTracker.getRemainingAttachmentsCount();
  for (const tableAttachmentTracker of attachmentTracker.getTables()) {
    await tableAttachmentTracker.importAttachments(
      uploadAttachment,
      updateRows,
      {
        onBatchComplete: () => {
          const remainingAttachmentsCount = attachmentTracker.getRemainingAttachmentsCount();
          const uploadedAttachmentsCount = totalAttachmentsCount - remainingAttachmentsCount;
          const attachmentsPercent = (uploadedAttachmentsCount / totalAttachmentsCount) * 100;
          onProgress?.({
            percent: 50 + (attachmentsPercent * 0.50),
            status: `Importing attachments from Airtable... (${remainingAttachmentsCount} remaining)`,
          });
        },
      },
    );
  }

  onProgress?.({ percent: 100 });
}

type AirtableFieldValueConverter = (fieldSchema: AirtableFieldSchema, value: any) => CellValue | undefined;
const AirtableFieldValueConverters: Record<string, AirtableFieldValueConverter> = {
  identity(fieldSchema, value) {
    return value;
  },
  aiText(fieldSchema, aiTextState) {
    return aiTextState?.value;
  },
  createdBy(fieldSchema, collaborator) {
    return formatCollaborator(collaborator);
  },
  count(fieldSchema, collaborator) {
    throw new Error("Count is a formula column, and should not have data conversion run");
  },
  formula(fieldSchema, collaborator) {
    throw new Error("Formula is a formula column, and should not have data conversion run");
  },
  lastModifiedBy(fieldSchema, collaborator) {
    return formatCollaborator(collaborator);
  },
  lookup(fieldSchema, value) {
    // Lookup fields fetch values from other columns. This should be a formula in Grist, no value needed.
    throw new Error("Lookup is a formula column, and should not have data conversion run");
  },
  multipleCollaborators(fieldSchema, collaborators) {
    const formattedCollaborators = collaborators?.map(formatCollaborator);
    if (!formattedCollaborators) { return null; }
    return formattedCollaborators.join(", ");
  },
  singleCollaborator(fieldSchema, collaborator) {
    return formatCollaborator(collaborator);
  },
  multipleSelects(fieldSchema, choices?: string[]) {
    if (!choices) { return null; }
    return [GristObjCode.List, ...choices];
  },
  rollup(fieldSchema, collaborator) {
    throw new Error("Rollup is a formula column, and should not have data conversion run");
  },
};

const formatCollaborator = (collaborator: any) => collaborator?.name;
