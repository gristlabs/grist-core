import { AirtableFieldSchema } from "app/common/airtable/AirtableAPITypes";
import {
  AttachmentsByColumnId,
  AttachmentTracker,
  extractAttachmentsFromRecordField,
  isAttachmentField,
  TableAttachmentTracker,
} from "app/common/airtable/AirtableAttachmentTracker";
import { AirtableBaseSchemaCrosswalk } from "app/common/airtable/AirtableCrosswalk";
import { AirtableDataImportParams } from "app/common/airtable/AirtableDataImporterTypes";
import {
  extractRefFromRecordField,
  getRefFieldLinkedTableId,
  isRefField,
  ReferenceTracker,
  RefValuesByColumnId,
  TableReferenceTracker,
} from "app/common/airtable/AirtableReferenceTracker";
import { AddOrUpdateRecord } from "app/plugin/DocApiTypes";
import { CellValue, GristObjCode } from "app/plugin/GristData";
import { convertToBulkColValues } from "app/plugin/TableOperationsImpl";

export async function importDataFromAirtableBase(
  {
    listRecords,
    addRows,
    addOrUpdateRows,
    updateRows,
    uploadAttachment,
    schemaCrosswalk,
    onProgress,
  }: AirtableDataImportParams,
) {
  const referenceTracker = new ReferenceTracker();
  const attachmentTracker = new AttachmentTracker();

  const addOrUpdateRowsPromises: Promise<any>[] = [];

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

    const referenceColumns = Array.from(tableCrosswalk.fields.values())
      .filter(mapping => isRefField(mapping.airtableField))
      .map(mapping => ({
        id: mapping.gristColumn.id,
        tableId: resolveLinkedTableId(schemaCrosswalk, mapping.airtableField),
      }));

    let tableReferenceTracker: TableReferenceTracker | undefined;
    if (referenceColumns.length > 0) {
      tableReferenceTracker = referenceTracker.addTable(
        tableCrosswalk.gristTable.id,
        referenceColumns,
        { airtableIdColumnId: tableCrosswalk.airtableIdColumn?.id },
      );
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

      const airtableRecordIds: string[] = [];
      const addOrUpdateRecords: Required<AddOrUpdateRecord>[] = [];
      const refsByColumnIdForRecords: RefValuesByColumnId[] = [];
      const attachmentsByColumnIdForRecords: AttachmentsByColumnId[] = [];

      for (const record of records) {
        const addOrUpdateRecord: Required<AddOrUpdateRecord> = { require: {}, fields: {} };
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
            addOrUpdateRecord.fields[gristColumn.id] = null;
            continue;
          }

          const converter =
            AirtableFieldValueConverters[fieldMapping.airtableField.type] ?? AirtableFieldValueConverters.identity;

          const value = converter(fieldMapping.airtableField, record.fields[fieldMapping.airtableField.name]);

          addOrUpdateRecord.fields[fieldMapping.gristColumn.id] = value ?? null;
        }

        if (tableCrosswalk.airtableIdColumn) {
          addOrUpdateRecord.require[tableCrosswalk.airtableIdColumn.id] = record.id;
        }

        addOrUpdateRecords.push(addOrUpdateRecord);
        refsByColumnIdForRecords.push(refsByColumnId);
        attachmentsByColumnIdForRecords.push(attachmentsByColumnId);
      }

      let addOrUpdateRowsPromise: Promise<number[]> = Promise.resolve([]);

      if (tableCrosswalk.airtableIdColumn) {
        addOrUpdateRowsPromise =
          addOrUpdateRows(tableCrosswalk.gristTable.id, addOrUpdateRecords, { onMany: "first" })
            .then(result => result.recordIds.map(ids => ids[0]));
      } else {
        addOrUpdateRowsPromise = addRows(
          tableCrosswalk.gristTable.id, convertToBulkColValues(addOrUpdateRecords),
        );
      }

      const finishedProcessingPromise = addOrUpdateRowsPromise.then((recordIds) => {
        airtableRecordIds.forEach((airtableRecordId, index) => {
          const gristRecordId = recordIds[index];
          // Only add entries to the reference and attachment trackers once we know they're added to the table.
          referenceTracker.addRecordIdMapping(airtableRecordId, gristRecordId);
          tableReferenceTracker?.addUnresolvedRecord({
            gristRecordId,
            refsByColumnId: refsByColumnIdForRecords[index],
          });
          tableAttachmentTracker?.addRecord({
            gristRecordId,
            attachmentsByColumnId: attachmentsByColumnIdForRecords[index],
          });
        });
      });

      addOrUpdateRowsPromises.push(finishedProcessingPromise);

      listRecordsResult = await listRecordsResult.fetchNextPage();
    }
  }

  // Future improvement - report all errors here using Promise.allSettled, or continue even if
  //                      a few sets of rows throw errors
  await Promise.all(addOrUpdateRowsPromises);

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

const resolveTableId = (schemaCrosswalk: AirtableBaseSchemaCrosswalk, airtableTableId: string) =>
  schemaCrosswalk.tables.get(airtableTableId)?.gristTable.id;

function resolveLinkedTableId(schemaCrosswalk: AirtableBaseSchemaCrosswalk, field: AirtableFieldSchema) {
  const linkedTableId = getRefFieldLinkedTableId(field);
  return linkedTableId && resolveTableId(schemaCrosswalk, linkedTableId);
}
