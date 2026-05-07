import { ApiError } from "app/common/ApiError";
import { ColValues, TableColValues, TableRecordValue } from "app/common/DocActions";
import { extractInfoFromColType, reencodeAsTypedCellValue } from "app/common/gristTypes";
import { SortFunc } from "app/common/SortFunc";
import { Sort } from "app/common/SortSpec";
import { CellFormatType } from "app/plugin/GristAPI";
import { handleSandboxErrorOnPlatform, TableOperationsPlatform } from "app/plugin/TableOperationsImpl";
import { type ActiveDoc } from "app/server/lib/ActiveDoc";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import { docSessionFromRequest } from "app/server/lib/DocSession";
import log from "app/server/lib/log";
import { optStringParam } from "app/server/lib/requestUtils";
import { ServerColumnGetters } from "app/server/lib/ServerColumnGetters";

import { Request, RequestHandler, Response } from "express";
import { Checker } from "ts-interface-checker";

export type WithDocHandler = (activeDoc: ActiveDoc, req: RequestWithLogin, resp: Response) => Promise<void>;

/**
 * Middleware for validating request's body with a Checker instance.
 */
export function validate(checker: Checker): RequestHandler {
  return (req, res, next) => {
    validateCore(checker, req, req.body);
    next();
  };
}

export function validateCore(checker: Checker, req: Request, body: any) {
  try {
    checker.check(body);
  } catch (err) {
    log.warn(`Error during api call to ${req.path}: Invalid payload: ${String(err)}`);
    throw new ApiError("Invalid payload", 400, { userError: String(err) });
  }
}

export function getErrorPlatform(tableId: string): TableOperationsPlatform {
  return {
    async getTableId() { return tableId; },
    throwError(verb, text, status) {
      throw new ApiError(verb + (verb ? " " : "") + text, status);
    },
    applyUserActions() {
      throw new Error("no document");
    },
  };
}

/**
 * Handles sandbox errors for the given engine request using backend platform options.
 */
export async function handleSandboxError<T>(tableId: string, colNames: string[], p: Promise<T>): Promise<T> {
  return handleSandboxErrorOnPlatform(tableId, colNames, p, getErrorPlatform(tableId));
}

/**
 * Fetches meta tables for the active document associated with the request.
 */
export async function getMetaTables(activeDoc: ActiveDoc, req: RequestWithLogin) {
  return await handleSandboxError("", [],
    activeDoc.fetchMetaTables(docSessionFromRequest(req)));
}

/**
 * Options for returning results from a query about document data.
 * Currently these option don't affect the query itself, only the
 * results returned to the user.
 */
export interface QueryParameters {
  sort?: string[];  // Columns names to sort by (ascending order by default,
  // prepend "-" for descending order, can contain flags,
  // see more in Sort.SortSpec).
  limit?: number;   // Limit on number of rows to return.
  cellFormat?: CellFormatType;
}

/**
 * Extract a sort parameter from a request, if present.  Follows
 * https://jsonapi.org/format/#fetching-sorting for want of a better
 * standard - comma separated, defaulting to ascending order, keys
 * prefixed by "-" for descending order.
 *
 * The sort parameter can either be given as a query parameter, or
 * as a header.
 */
function getSortParameter(req: Request): string[] | undefined {
  const sortString: string | undefined = optStringParam(req.query.sort, "sort") || req.get("X-Sort");
  if (!sortString) { return undefined; }
  return sortString.split(",");
}

/**
 * Extract a limit parameter from a request, if present.  Should be a
 * simple integer.  The limit parameter can either be given as a query
 * parameter, or as a header.
 */
function getLimitParameter(req: Request): number | undefined {
  const limitString: string | undefined = optStringParam(req.query.limit, "limit") || req.get("X-Limit");
  if (!limitString) { return undefined; }
  const limit = parseInt(limitString, 10);
  if (isNaN(limit)) { throw new Error("limit is not a number"); }
  return limit;
}

export function getCellFormatParameter(req: Request): CellFormatType | undefined {
  const allowedCellFormats: CellFormatType[] = ["normal", "typed"];
  return optStringParam(req.query.cellFormat, "cellFormat",
    { allowed: allowedCellFormats }) as CellFormatType | undefined;
}

/**
 * Extract sort and limit parameters from request, if they are present.
 */
export function getQueryParameters(req: Request): QueryParameters {
  return {
    sort: getSortParameter(req),
    limit: getLimitParameter(req),
    cellFormat: getCellFormatParameter(req),
  };
}

/**
 * Sort table contents being returned.  Sort keys with a '-' prefix
 * are sorted in descending order, otherwise ascending.  Contents are
 * modified in place. Sort keys can contain sort options.
 * Columns can be either expressed as a colId (name string) or as colRef (rowId number).
 */
function applySort(
  values: TableColValues,
  sort: string[],
  _columns: TableRecordValue[] | null = null) {
  if (!sort) { return values; }

  // First we need to prepare column description in ColValue format (plain objects).
  // This format is used by ServerColumnGetters.
  let properColumns: ColValues[] = [];

  // We will receive columns information only for user tables, not for metatables. So
  // if this is the case, we will infer them from the result.
  if (!_columns) {
    _columns = Object.keys(values).map((col, index) => ({ id: col, fields: { colRef: index } }));
  } else { // For user tables, we will not get id column (as this column is not in the schema), so we need to
    // make sure the column is there.

    // This is enough information for ServerGetters
    _columns = [..._columns, { id: "id", fields: { colRef: 0 } }];
  }

  // Once we have proper columns, we can convert them to format that ServerColumnGetters
  // understand.
  properColumns = _columns.map(c => ({
    ...c.fields,
    id: c.fields.colRef,
    colId: c.id,
  }));

  // We will sort row indices in the values object, not rows ids.
  const rowIndices = values.id.map((__, i) => i);
  const getters = new ServerColumnGetters(rowIndices, values, properColumns);
  const sortFunc = new SortFunc(getters);
  const colIdToRef = new Map(properColumns.map(({ id, colId }) => [colId as string, id as number]));
  sortFunc.updateSpec(Sort.parseNames(sort, colIdToRef));
  rowIndices.sort(sortFunc.compare.bind(sortFunc));

  // Sort resulting values according to the sorted index.
  for (const key of Object.keys(values)) {
    const col = values[key];
    values[key] = rowIndices.map(i => col[i]);
  }
  return values;
}

/**
 * Truncate columns to the first N values.  Columns are modified in place.
 */
function applyLimit(values: TableColValues, limit: number) {
  // for no limit, or 0 limit, do not apply any restriction
  if (!limit) { return values; }
  for (const key of Object.keys(values)) {
    values[key].splice(limit);
  }
  return values;
}

/**
 * Apply query parameters to table contents.  Contents are modified in place.
 */
export function applyQueryParameters(
  values: TableColValues,
  params: QueryParameters,
  columns: TableRecordValue[] | null = null,
): TableColValues {
  if (params.sort) { applySort(values, params.sort, columns); }
  if (params.limit) { applyLimit(values, params.limit); }

  if (params.cellFormat === "typed") {
    const colIdToType = new Map(columns?.map(c => [c.id, c.fields.type as string]));
    for (const [colId, colValues] of Object.entries(values)) {
      const colType = colIdToType.get(colId) || "Any";
      const typeInfo = extractInfoFromColType(colType);
      values[colId] = colValues.map(val => reencodeAsTypedCellValue(val, typeInfo));
    }
  }
  return values;
}
