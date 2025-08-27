import { SchemaTypes } from "app/common/schema";
import { ActiveDoc } from "app/server/lib/ActiveDoc";

export function getTableById(doc: ActiveDoc, id: number) {
  return getRecordById(doc, "_grist_Tables", id);
}

export function getTableColumnById(doc: ActiveDoc, id: number) {
  return getRecordById(doc, "_grist_Tables_column", id);
}

export function getTableColumnsByTableId(doc: ActiveDoc, tableId: number) {
  const table = getTableById(doc, tableId);
  return getDocDataOrThrow(doc)
    .getMetaTable("_grist_Tables_column")
    .filterRecords({
      parentId: table.id,
    });
}

export function getWidgetById(doc: ActiveDoc, id: number) {
  return getRecordById(doc, "_grist_Views_section", id);
}

export function getWidgetsByPageId(doc: ActiveDoc, pageId: number) {
  const page = getRecordById(doc, "_grist_Views", pageId);
  return getDocDataOrThrow(doc)
    .getMetaTable("_grist_Views_section")
    .filterRecords({ parentId: page.id });
}

export function getDocDataOrThrow(doc: ActiveDoc) {
  const docData = doc.docData;
  if (!docData) {
    throw new Error("Document not ready");
  }

  return docData;
}

function getRecordById<TableId extends keyof SchemaTypes>(
  doc: ActiveDoc,
  tableId: TableId,
  id: number
) {
  const record = getDocDataOrThrow(doc).getMetaTable(tableId).getRecord(id);
  if (!record) {
    throw new Error(`${getRecordName(tableId)} ${id} not found`);
  }

  return record;
}

function getRecordName(tableId: keyof SchemaTypes) {
  switch (tableId) {
    case "_grist_Tables": {
      return "Table";
    }
    case "_grist_Tables_column": {
      return "Column";
    }
    case "_grist_Views_section": {
      return "Widget";
    }
    default: {
      return "Record";
    }
  }
}
