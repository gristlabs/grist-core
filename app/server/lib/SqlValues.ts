/**
 * SqlValues: Decodes raw SQLite values from Grist documents into
 * human-readable typed values, based on Grist column type metadata.
 *
 * Used by the /sql endpoint (with granular flag) to return decoded
 * values and column metadata.
 */

import { CellValue } from "app/common/DocActions";
import { DocData } from "app/common/DocData";
import { extractTypeFromColType } from "app/common/gristTypes";
import {
  CensoredValue, decodeObject, GristDate, GristDateTime,
  PendingValue, RaisedException, Reference, ReferenceList, SkipValue, UnknownValue,
} from "app/plugin/objtypes";
import { decodeSqliteValue } from "app/server/lib/DocStorage";

export interface ColumnTypeMap {
  [colId: string]: string;  // colId → gristType
}

/**
 * Load column type metadata for all tables from the document's docData.
 */
export function loadColumnTypes(
  docData: DocData,
): Map<string, ColumnTypeMap> {
  const result = new Map<string, ColumnTypeMap>();
  const tablesTable = docData.getMetaTable("_grist_Tables");
  const columnsTable = docData.getMetaTable("_grist_Tables_column");
  if (!tablesTable || !columnsTable) { return result; }

  const getTableId = tablesTable.getRowPropFunc("tableId");
  const tableIdById = new Map<number, string>();
  for (const id of tablesTable.getRowIds()) {
    tableIdById.set(id, String(getTableId(id) ?? ""));
  }
  const getParentId = columnsTable.getRowPropFunc("parentId");
  const getColId = columnsTable.getRowPropFunc("colId");
  const getType = columnsTable.getRowPropFunc("type");
  for (const id of columnsTable.getRowIds()) {
    const tableId = tableIdById.get(getParentId(id) as number) ?? "";
    const colId = String(getColId(id) ?? "");
    const type = String(getType(id) ?? "");
    if (!tableId || !colId) { continue; }
    let tableMap = result.get(tableId);
    if (!tableMap) { tableMap = {}; result.set(tableId, tableMap); }
    tableMap[colId] = type;
  }
  return result;
}

/**
 * Resolve Grist types for a list of column names by searching all tables.
 */
export function resolveColumnTypes(
  columns: string[],
  allColumnTypes: Map<string, ColumnTypeMap>,
): string[] {
  return columns.map((col) => {
    for (const typeMap of allColumnTypes.values()) {
      if (typeMap[col]) { return typeMap[col]; }
    }
    if (col === "id") { return "Int"; }
    return "";
  });
}

/**
 * Decode a raw SQLite result row into a fields object with decoded values.
 */
export function decodeRecord(
  record: Record<string, CellValue>,
  columns: string[],
  colTypes: string[],
): Record<string, CellValue> {
  const fields: Record<string, CellValue> = {};
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const val = record[col];
    const gristType = colTypes[i];
    fields[col] = gristType ? decodeValue(val, gristType) : decodeValueFallback(val);
  }
  return fields;
}

/**
 * Decode a raw SQLite value to a plain value for SQL API responses.
 * Uses DocStorage.decodeValue for the canonical raw-CellValue normalization
 * (unmarshal, Bool, list prefix), then applies SQL-specific decoding
 * (dates to ISO strings, Refs to numbers, Grist objects to plain values).
 */
export function decodeValue(val: any, gristType: string): any {
  if (val === null || val === undefined) { return null; }

  // Canonical raw CellValue normalization (shared with REST API path).
  val = decodeSqliteValue(val, gristType);

  // Grist-encoded objects (arrays with string code prefix)
  if (Array.isArray(val) && val.length > 0 && typeof val[0] === "string") {
    return decodeGristObject(val);
  }

  // SQL-specific type decoding: convert to plain JSON-safe values
  const baseType = extractTypeFromColType(gristType);
  switch (baseType) {
    case "Bool":
      // DocStorage.decodeValue already handled 0/1 → true/false
      return val;
    case "Date":
      if (typeof val === "number" && val !== 0) { return GristDate.fromGristValue(val).toString(); }
      return val === 0 ? null : val;
    case "DateTime":
      if (typeof val === "number" && val !== 0) { return new GristDateTime(val * 1000).toISOString(); }
      return val === 0 ? null : val;
    case "Int":
    case "Id":
      return typeof val === "number" ? Math.round(val) : val;
    case "Numeric":
    case "ManualSortPos":
    case "PositionNumber":
      return val;
    case "Ref":
      return (typeof val === "number" && val === 0) ? null : val;
    case "ChoiceList":
    case "Attachments":
    case "RefList":
      if (typeof val === "string" && val.startsWith("[")) {
        try { return JSON.parse(val); } catch { /* fall through */ }
      }
      return val;
    default:
      if (typeof val === "object") { return JSON.stringify(val); }
      return val;
  }
}

function decodeValueFallback(val: any): any {
  if (val === null || val === undefined) { return null; }
  return decodeSqliteValue(val, "Any");
}

/**
 * Decode a Grist-encoded value tuple [code, args...] to a plain value
 * for SQL API responses. Delegates to decodeObject() from objtypes.ts
 * (the authoritative decoder), then converts class instances to simple
 * types suitable for JSON API output.
 */
function decodeGristObject(val: any[]): any {
  const obj = decodeObject(val as CellValue);
  return toPlainValue(obj);
}

/** Convert a decoded Grist object to a plain JSON-safe value. */
function toPlainValue(obj: unknown): any {
  if (obj instanceof GristDateTime) { return obj.toISOString(); }
  if (obj instanceof GristDate) { return obj.toString(); }  // YYYY-MM-DD
  if (obj instanceof Reference) { return obj.rowId === 0 ? null : obj.rowId; }
  if (obj instanceof ReferenceList) { return obj.rowIds; }
  if (obj instanceof RaisedException) { return `#${obj}`; }
  if (obj instanceof CensoredValue) { return "#CENSORED"; }
  if (obj instanceof PendingValue) { return "#PENDING"; }
  if (obj instanceof SkipValue) { return null; }
  if (obj instanceof UnknownValue) { return String(obj); }
  if (Array.isArray(obj)) { return obj.map(toPlainValue); }
  return obj;
}
