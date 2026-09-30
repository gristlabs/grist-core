import { ApiError } from "app/common/ApiError";
import { extractInfoFromColType, reencodeAsTypedCellValue } from "app/common/gristTypes";
import { isMetadataTable } from "app/common/isHiddenTable";
import * as Types from "app/plugin/DocApiTypes";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { appSettings } from "app/server/lib/AppSettings";
import { docSessionFromRequest, OptDocSession } from "app/server/lib/DocSession";
import { decodeSqliteValue } from "app/server/lib/DocStorage";
import log from "app/server/lib/log";
import { optIntegerParam } from "app/server/lib/requestUtils";
import { DmlResult, executeDMLFromParsed } from "app/server/lib/runSQLWrite";
import { isRequest, RequestOrSession } from "app/server/lib/sessionUtils";
import { tryRunWithSqlAcl } from "app/server/lib/SqlACL";
import { isDMLAst, ParsedSQL, parseSQL, sqlifyAST } from "app/server/lib/SqlParser";
import { decodeRecord, loadColumnTypes, resolveColumnTypes } from "app/server/lib/SqlValues";

// Limit SQL length to prevent parser bombs (PEG parsers can be slow on pathological input).
const MAX_SQL_LENGTH = 100_000;

// Maximum duration of a `runSQLQuery` call. Does not apply to internal calls to SQLite.
const MAX_CUSTOM_SQL_MSEC = appSettings
  .section("integrations")
  .section("sql")
  .flag("timeout")
  .requireInt({
    envVar: "GRIST_SQL_TIMEOUT_MSEC",
    defaultValue: 1000,
  });

export function dmlResultToGranular(sql: string, result: DmlResult): GranularSqlResult {
  const granResult: GranularSqlResult = {
    statement: sql,
    rowCount: result.rowCount,
    command: result.tag.split(" ")[0],
  };
  if (result.returning && result.returning.length > 0) {
    const cols = Object.keys(result.returning[0]);
    granResult.columns = cols.map(id => ({ id, type: "Any" }));
    granResult.records = result.returning.map((row) => {
      const fields: { [colId: string]: any } = {};
      for (const col of cols) { fields[col] = row[col]; }
      return { fields };
    });
  }
  if (result.actionNum) { granResult.actionNum = result.actionNum; }
  return granResult;
}

export interface GranularSqlResult {
  statement: string;
  columns?: { id: string, type: string }[];
  records?: { fields: { [colId: string]: any } }[];
  rowCount: number;
  command: string;
  actionNum?: number;   // For transaction rollback tracking
}

/**
 * Executes a SQL statement on a document and returns the result.
 *
 * Security model (granular path):
 * - All user SQL is parsed once into an AST, validated, and regenerated.
 *   Only the regenerated SQL reaches SQLite. This applies to ALL users,
 *   not just restricted ones — the round-trip is the security boundary.
 * - Writes: AST is translated to UserActions (BulkAddRecord, etc.) which
 *   go through applyUserActions with ACL checks. No direct SQLite writes.
 * - Reads: regenerated SQL is wrapped in `select * from (...)` as
 *   defense-in-depth. ACL uses CTE wrappers or temp tables for row filtering.
 * - Restricted users: additionally, table references are checked against an
 *   allowlist of user tables (no _grist_* or sqlite_master access).
 *
 * Without `granular` flag: SELECT-only, requires canCopyEverything, returns raw rows.
 * With `granular` flag: supports DML/DDL, uses granular ACL, returns decoded values
 * with column metadata.
 */
export async function runSQLQuery(
  requestOrSession: NonNullable<RequestOrSession>,
  activeDoc: ActiveDoc,
  options: Types.SqlPost,
): Promise<any[] | GranularSqlResult> {
  let docSession: OptDocSession;
  if (isRequest(requestOrSession)) {
    docSession = docSessionFromRequest(requestOrSession);
  } else {
    docSession = requestOrSession;
  }

  const sql = options.sql.replace(/;$/, "").trim();

  if (options.granular) {
    return _runGranular(docSession, activeDoc, sql, options);
  }

  // --- Legacy path (unchanged) ---
  if (!(await activeDoc.canCopyEverything(docSession))) {
    throw new ApiError("insufficient document access", 403);
  }

  if (!sql.toLowerCase().includes("select")) {
    throw new ApiError("only select statements are supported", 400);
  }

  return _execSelect(activeDoc, sql, options);
}

/**
 * Granular path: parse once, validate, regenerate, then route to DML or SELECT.
 */
async function _runGranular(
  docSession: OptDocSession,
  activeDoc: ActiveDoc,
  sql: string,
  options: Types.SqlPost,
): Promise<GranularSqlResult> {
  if (!sql) {
    return { statement: options.sql, rowCount: 0, command: "EMPTY" };
  }

  // Limit SQL length to prevent parser bombs (PEG parser can be slow on pathological input)
  if (sql.length > MAX_SQL_LENGTH) {
    throw new ApiError("SQL statement too long", 400);
  }

  // Load column types for table allowlist and value decoding
  const columnTypes = loadColumnTypes(activeDoc.docData!);

  // Step 1: Parse once. This is the single parse for the entire pipeline.
  const parsed = parseSQL(sql);

  // Step 2: Validate. Restricted users can only reference user tables.
  const isRestricted = !(await activeDoc.canCopyEverything(docSession));
  if (isRestricted) {
    validateForRestrictedUser(parsed, columnTypes);
  }

  // Step 3: Regenerate SQL from AST. ALL users get regenerated SQL —
  // the original user string is never executed.
  const safeSql = _regenerateSQL(parsed);

  if (isDMLAst(parsed.ast)) {
    // Write: AST → UserActions → applyUserActions (with ACL checks).
    const result = await executeDMLFromParsed(parsed, activeDoc, docSession);
    return dmlResultToGranular(options.sql, result);
  }

  // Read: execute regenerated SQL with ACL filtering.
  const records = await _runSelectWithAcl(activeDoc, docSession, safeSql, parsed, columnTypes, options);

  if (!records || records.length === 0) {
    return { statement: options.sql, columns: [], records: [], rowCount: 0, command: "SELECT" };
  }

  const columns = Object.keys(records[0]);
  const colTypes = resolveColumnTypes(columns, columnTypes);
  const colInfo = columns.map((id, i) => ({ id, type: colTypes[i] || "Text" }));

  const decodedRecords = records.map((rec) => {
    if (options.cellFormat === "typed") {
      // cellFormat=typed: unmarshal blobs, then re-encode with type metadata,
      // matching REST API cellFormat=typed. Uses reencodeAsTypedCellValue
      // from gristTypes.ts (same function the REST API uses).
      const fields: { [colId: string]: any } = {};
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const colType = colTypes[i] || "Text";
        // Canonical raw CellValue normalization (same as REST API path).
        const raw = decodeSqliteValue(rec[col], colType);
        const typeInfo = extractInfoFromColType(colType);
        fields[col] = reencodeAsTypedCellValue(raw, typeInfo);
      }
      return { fields };
    }
    // Default: decode to plain values (ISO dates, null for Ref 0, etc.)
    return { fields: decodeRecord(rec, columns, colTypes) };
  });

  return {
    statement: options.sql,
    columns: colInfo,
    records: decodedRecords,
    rowCount: records.length,
    command: "SELECT",
  };
}

/**
 * Validate a parsed query for restricted users: allowlist tables, reject writable CTEs.
 */
export function validateForRestrictedUser(parsed: ParsedSQL, columnTypes: Map<string, any>): void {
  const allowedTables = new Set(
    [...columnTypes.keys()].filter(t => !isMetadataTable(t)),
  );

  // Reject writable CTEs (WITH ... INSERT/UPDATE/DELETE ... RETURNING).
  // The parser types CTE bodies as Select, but at runtime a writable CTE
  // would have a different AST type. Check defensively.
  if (parsed.ast.type === "select" && parsed.ast.with) {
    for (const cte of parsed.ast.with) {
      const stmtAst = cte.stmt as { type?: string };
      if (stmtAst?.type && stmtAst.type !== "select") {
        throw new ApiError(
          "Writable CTEs (WITH ... INSERT/UPDATE/DELETE) are not permitted", 403);
      }
    }
  }

  // Allowlist table references
  for (const table of parsed.tables) {
    if (!allowedTables.has(table)) {
      throw new ApiError(
        `Access to "${table}" is not available. SQL access is limited to document tables.`, 403);
    }
  }
}

/**
 * Regenerate SQL from AST. This is the security boundary: only SQL constructs
 * the parser understood and can reproduce will reach SQLite.
 */
function _regenerateSQL(parsed: ParsedSQL): string {
  try {
    return sqlifyAST(parsed.ast, parsed.dialect);
  } catch {
    throw new ApiError("Query could not be regenerated for safe execution", 403);
  }
}

/**
 * For the PgWire transaction path: parse, validate (if restricted), regenerate.
 * Returns the safe SQL string. Used by execDmlInTransaction.
 */
export function sanitizeQuery(sql: string, columnTypes: Map<string, any>): string {
  if (sql.length > MAX_SQL_LENGTH) {
    throw new ApiError("SQL statement too long", 400);
  }
  const parsed = parseSQL(sql);
  validateForRestrictedUser(parsed, columnTypes);
  return _regenerateSQL(parsed);
}

/**
 * Run a SELECT with ACL:
 * 1. canCopyEverything → run directly (fast path)
 * 2. ACL rules translated to SQL CTE wrappers
 */
async function _runSelectWithAcl(
  activeDoc: ActiveDoc,
  docSession: OptDocSession,
  sql: string,
  parsed: ParsedSQL,
  columnTypes: Map<string, any>,
  options: Types.SqlPost,
): Promise<any[]> {
  if (await activeDoc.canCopyEverything(docSession)) {
    return _execSelect(activeDoc, sql, options);
  }

  return tryRunWithSqlAcl(sql, parsed, activeDoc, docSession, columnTypes);
}

/**
 * Execute a SELECT statement against the document's SQLite, with timeout.
 */
async function _execSelect(
  activeDoc: ActiveDoc,
  sql: string,
  options: Types.SqlPost,
): Promise<any[]> {
  const sqlOptions = activeDoc.docStorage.getOptions();
  if (!sqlOptions?.canInterrupt || !sqlOptions?.bindableMethodsProcessOneStatement) {
    throw new ApiError("The available SQLite wrapper is not adequate", 500);
  }
  const timeout = Math.max(0, Math.min(
    MAX_CUSTOM_SQL_MSEC,
    optIntegerParam(options.timeout, "timeout") || MAX_CUSTOM_SQL_MSEC,
  ));
  const wrappedStatement = `select * from (${sql})`;
  const interrupt = setTimeout(async () => {
    try { await activeDoc.docStorage.interrupt(); } catch (e) {
      log.error("runSQL interrupt failed with error ", e);
    }
  }, timeout);
  try {
    return await activeDoc.docStorage.all(wrappedStatement, ...(options.args || []));
  } finally {
    clearTimeout(interrupt);
  }
}
