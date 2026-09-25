/**
 * runSQLWrite: Translates SQL INSERT/UPDATE/DELETE/DDL statements to Grist UserActions.
 *
 * Security: the AST is provided by the caller (already parsed and validated by the
 * pipeline in runSQLQuery). The AST is used to construct UserActions (BulkAddRecord,
 * etc.) which go through applyUserActions with ACL checks. For UPDATE/DELETE, row-ID
 * lookup queries are reconstructed from the AST via sqlifyAST() and wrapped in
 * select * from (...) — they are not raw user input.
 *
 * All mutations go through applyUserActions → Python data engine → GranularAccess,
 * providing formula recalculation, access control, undo, triggers, and client broadcast.
 */

import { ApplyUAResult } from "app/common/ActiveDocAPI";
import { ApiError } from "app/common/ApiError";
import { BulkColValues, CellValue, UserAction } from "app/common/DocActions";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { OptDocSession } from "app/server/lib/DocSession";
import { DocStorage } from "app/server/lib/DocStorage";
import { quoteIdent } from "app/server/lib/SQLiteDB";
import { ParsedSQL, SqlAST, sqlifyAST } from "app/server/lib/SqlParser";

import type { Alter, Create, Delete, Drop, Insert_Replace, SetList, Update } from "node-sql-parser";

// ---- Types for parser sub-nodes and SQLite results ----

/** A row returned from docStorage.all(). Column values keyed by name. */
interface SqliteRow { [col: string]: CellValue; }

/** A parsed expression node (WHERE clause, SET value, etc.).
 *  The parser's own type for these is `any`; we use this to be
 *  explicit that we're passing an opaque parser expression. */
type Expr = object | null;

// ---- Helpers ----

/** Extract a column name string from a parser AST node.
 *  The parser produces column refs in several shapes depending on
 *  dialect and context. We check each known shape and fall back to
 *  String() for anything unexpected. */
function colName(col: unknown): string {
  if (typeof col === "string") { return col; }
  if (!col || typeof col !== "object") { return String(col); }
  const obj = col as Record<string, unknown>;
  if (typeof obj.value === "string") { return obj.value; }
  if (obj.expr && typeof obj.expr === "object" && typeof (obj.expr as Record<string, unknown>).value === "string") {
    return (obj.expr as Record<string, unknown>).value as string;
  }
  if (obj.column !== undefined) { return colName(obj.column); }
  return String(col);
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface DmlResult {
  tag: string;
  rowCount: number;
  returning?: SqliteRow[];
  actionNum?: number;
  actionHash?: string | null;
}

export interface DmlOptions {
  withinTransaction?: boolean;
}

interface DmlContext {
  activeDoc: ActiveDoc;
  docSession: OptDocSession;
  opts: DmlOptions;
  dialect: "postgresql" | "default";
}

async function applyActions(ctx: DmlContext, actions: UserAction[]): Promise<ApplyUAResult> {
  if (ctx.opts.withinTransaction) {
    return ctx.activeDoc.applyUserActionsWithinTransaction(ctx.docSession, actions);
  }
  return ctx.activeDoc.applyUserActions(ctx.docSession, actions);
}

async function applyPrepared(
  ctx: DmlContext, prepare: (docStorage: DocStorage) => Promise<UserAction[]>,
): Promise<ApplyUAResult> {
  if (ctx.opts.withinTransaction) {
    const actions = await prepare(ctx.activeDoc.docStorage);
    if (actions.length === 0) {
      return { actionNum: 0, actionHash: null, retValues: [], isModification: false };
    }
    return ctx.activeDoc.applyUserActionsWithinTransaction(ctx.docSession, actions);
  }
  return ctx.activeDoc.applyPreparedUserActions(ctx.docSession, prepare);
}

/**
 * Execute a DML statement from a pre-parsed result. The caller has already
 * parsed, validated, and regenerated — this translates the AST to UserActions.
 */
export async function executeDMLFromParsed(
  parsed: ParsedSQL,
  activeDoc: ActiveDoc,
  docSession: OptDocSession,
  options?: DmlOptions,
): Promise<DmlResult> {
  const ctx: DmlContext = { activeDoc, docSession, opts: options || {}, dialect: parsed.dialect };
  switch (parsed.ast.type) {
    case "insert": case "replace": return executeInsert(parsed.ast, ctx);
    case "update":  return executeUpdate(parsed.ast, ctx);
    case "delete":  return executeDelete(parsed.ast, ctx);
    case "create":  return executeCreate(parsed.ast, ctx);
    case "drop":    return executeDrop(parsed.ast, ctx);
    case "alter":   return executeAlter(parsed.ast, ctx);
    default:
      throw new ApiError(`Unsupported statement type: ${parsed.ast.type}`, 400);
  }
}

// ---- Value extraction ----

interface ValueNode { type: string; value: CellValue; }

function extractValue(node: ValueNode | null | undefined): CellValue {
  if (node === null || node === undefined) { return null; }
  switch (node.type) {
    case "number":
    case "single_quote_string":
    case "string":
    case "double_quote_string":
      return node.value;
    case "bool":
      return node.value === "TRUE" || node.value === true;
    case "null":
      return null;
    case "origin":
      if (String(node.value).toUpperCase() === "DEFAULT") { return null; }
      return node.value;
    default:
      if (node.value !== undefined) { return node.value; }
      throw new ApiError(`Unsupported value expression type: ${node.type}`, 400);
  }
}

function isLiteralValue(node: ValueNode | null | undefined): boolean {
  if (!node) { return true; }
  const t = node.type;
  return t === "number" || t === "single_quote_string" || t === "string" ||
    t === "double_quote_string" || t === "bool" || t === "null" || t === "origin";
}

// ---- Table name extraction ----

function getTableName(ast: Insert_Replace | Update | Delete): string {
  const refs = ast.type === "delete" ? ast.from : ast.table;
  if (!refs?.length) {
    throw new ApiError("No table specified", 400);
  }
  return refs[0].table;
}

// ---- AST construction for SQLite queries ----

/** Build a SELECT that returns matching row IDs for a WHERE clause.
 *  Constructed from AST (not user input), wrapped for defense-in-depth. */
function buildIdSelectSql(tableId: string, where: Expr, ctx: DmlContext): string {
  return buildSelectSql(
    [{ expr: { type: "column_ref", table: null, column: "id" }, as: null }],
    [{ db: null, table: tableId, as: null }],
    where, ctx.dialect, "row ID query",
  );
}

function buildSelectSql(
  columns: object[], from: object[], where: Expr,
  dialect: "postgresql" | "default", label: string,
): string {
  try {
    const sql = sqlifyAST({ type: "select", columns, from, where: where || null } as SqlAST, dialect);
    return `select * from (${sql})`;
  } catch (e) {
    throw new ApiError(`Failed to build ${label}: ${errMessage(e)}`, 400);
  }
}

// ---- INSERT ----

async function executeInsert(
  ast: Insert_Replace,
  ctx: DmlContext,
): Promise<DmlResult> {
  const tableId = getTableName(ast);
  const columns: string[] = (ast.columns || []).map(c => colName(c));
  if (!columns || columns.length === 0) {
    throw new ApiError("INSERT without column list is not supported", 400);
  }

  if (ast.values?.type === "select") {
    return _executeInsertSelect(ast, tableId, columns, ctx);
  }

  const valueRows = ast.values?.values;
  if (!valueRows || valueRows.length === 0) {
    throw new ApiError("INSERT with no values", 400);
  }

  const idColIdx = columns.indexOf("id");
  const dataCols = columns.filter(c => c !== "id");
  const colValues: BulkColValues = {};
  for (const col of dataCols) { colValues[col] = []; }
  const rowIds: (number | null)[] = [];

  for (const row of valueRows) {
    const vals = row.value as ValueNode[];
    if (vals.length !== columns.length) {
      throw new ApiError(
        `INSERT has ${columns.length} columns but ${vals.length} values`, 400,
      );
    }
    if (idColIdx >= 0) {
      const idVal = extractValue(vals[idColIdx]);
      rowIds.push(idVal === null ? null : Number(idVal));
    } else {
      rowIds.push(null);
    }
    for (let i = 0; i < columns.length; i++) {
      if (i === idColIdx) { continue; }
      colValues[columns[i]].push(extractValue(vals[i]));
    }
  }

  const result = await applyActions(ctx,
    [["BulkAddRecord", tableId, rowIds, colValues]]);
  const insertedIds: number[] = result.retValues?.[0] || [];
  const count = Array.isArray(insertedIds) ? insertedIds.length : valueRows.length;
  const dmlResult: DmlResult = {
    tag: `INSERT 0 ${count}`, rowCount: count,
    actionNum: result.actionNum, actionHash: result.actionHash,
  };
  if (ast.returning && Array.isArray(insertedIds) && insertedIds.length > 0) {
    // Fetch the full inserted rows (including formula columns) from SQLite.
    const idList = insertedIds.join(",");
    const rows: SqliteRow[] = await ctx.activeDoc.docStorage.all(
      `SELECT * FROM ${quoteIdent(tableId)} WHERE id IN (${idList})`);
    dmlResult.returning = rows;
  }
  return dmlResult;
}

async function _executeInsertSelect(
  ast: Insert_Replace,
  tableId: string,
  columns: string[],
  ctx: DmlContext,
): Promise<DmlResult> {
  let selectSql: string;
  try {
    const rawSql = sqlifyAST(ast.values as SqlAST, ctx.dialect);
    selectSql = `select * from (${rawSql})`;
  } catch (e) {
    throw new ApiError(`Failed to build INSERT...SELECT query: ${errMessage(e)}`, 400);
  }

  const result = await applyPrepared(ctx, async (docStorage) => {
    const rows: SqliteRow[] = await docStorage.all(selectSql);
    if (rows.length === 0) { return []; }

    const selectCols = Object.keys(rows[0]);
    if (selectCols.length !== columns.length) {
      throw new ApiError(
        `INSERT has ${columns.length} columns but SELECT returns ${selectCols.length}`, 400,
      );
    }

    const colValues: BulkColValues = {};
    for (const col of columns) { colValues[col] = []; }
    for (const row of rows) {
      for (let i = 0; i < columns.length; i++) {
        colValues[columns[i]].push(row[selectCols[i]]);
      }
    }
    return [["BulkAddRecord", tableId, new Array(rows.length).fill(null), colValues]];
  });

  const count = result.retValues?.[0]?.length ?? 0;
  return {
    tag: `INSERT 0 ${count}`, rowCount: count,
    actionNum: result.actionNum, actionHash: result.actionHash,
  };
}

// ---- UPDATE ----

async function executeUpdate(
  ast: Update,
  ctx: DmlContext,
): Promise<DmlResult> {
  const tableId = getTableName(ast);
  const setList: SetList[] = ast.set;
  if (!setList || setList.length === 0) {
    throw new ApiError("UPDATE with no SET clause", 400);
  }

  const hasExpressions = setList.some(item => !isLiteralValue(item.value as ValueNode));

  let selectSql: string;
  if (hasExpressions) {
    const selectCols: object[] = [
      { expr: { type: "column_ref", table: null, column: "id" }, as: null },
    ];
    for (let i = 0; i < setList.length; i++) {
      selectCols.push({ expr: setList[i].value, as: `_set_${i}` });
    }
    selectSql = buildSelectSql(selectCols, ast.table || [], ast.where, ctx.dialect, "computed UPDATE query");
  } else {
    selectSql = buildIdSelectSql(tableId, ast.where, ctx);
  }

  const literalValues: Record<string, CellValue> | null = hasExpressions ? null :
    Object.fromEntries(setList.map(item =>
      [colName(item.column), extractValue(item.value as ValueNode)]));

  let rowCount = 0;
  const result = await applyPrepared(ctx, async (docStorage) => {
    const rows: SqliteRow[] = await docStorage.all(selectSql);
    if (rows.length === 0) { return []; }
    rowCount = rows.length;

    const rowIds = rows.map(r => r.id as number);
    const colValues: BulkColValues = {};
    if (hasExpressions) {
      for (let i = 0; i < setList.length; i++) {
        colValues[colName(setList[i].column)] = rows.map(r => r[`_set_${i}`]);
      }
    } else {
      for (const item of setList) {
        const name = colName(item.column);
        colValues[name] = new Array(rowIds.length).fill(literalValues![name]);
      }
    }
    return [["BulkUpdateRecord", tableId, rowIds, colValues]];
  });

  return { tag: `UPDATE ${rowCount}`, rowCount, actionNum: result.actionNum, actionHash: result.actionHash };
}

// ---- DELETE ----

async function executeDelete(
  ast: Delete,
  ctx: DmlContext,
): Promise<DmlResult> {
  const tableId = getTableName(ast);
  const selectSql = buildIdSelectSql(tableId, ast.where, ctx);

  let rowCount = 0;
  const result = await applyPrepared(ctx, async (docStorage) => {
    const rows: SqliteRow[] = await docStorage.all(selectSql);
    if (rows.length === 0) { return []; }
    rowCount = rows.length;
    return [["BulkRemoveRecord", tableId, rows.map(r => r.id as number)]];
  });

  return { tag: `DELETE ${rowCount}`, rowCount, actionNum: result.actionNum, actionHash: result.actionHash };
}

// ---- CREATE TABLE ----

function sqlTypeToGrist(sqlType: string): string {
  const t = sqlType.toUpperCase();
  if (t.startsWith("INT") || t === "SERIAL" || t === "BIGINT" || t === "SMALLINT") { return "Int"; }
  if (t.startsWith("FLOAT") || t.startsWith("DOUBLE") || t === "REAL" || t === "DECIMAL" ||
    t === "NUMERIC" || t === "MONEY") { return "Numeric"; }
  if (t === "BOOLEAN" || t === "BOOL") { return "Bool"; }
  if (t === "DATE") { return "Date"; }
  if (t.startsWith("TIMESTAMP")) { return "DateTime"; }
  if (t.startsWith("VARCHAR") || t.startsWith("CHAR") || t === "TEXT" || t === "CLOB" ||
    t === "UUID" || t === "JSON" || t === "JSONB") { return "Text"; }
  return "Text";
}

async function executeCreate(
  ast: Create,
  ctx: DmlContext,
): Promise<DmlResult> {
  if (ast.keyword !== "table") {
    throw new ApiError(`CREATE ${ast.keyword} is not supported`, 400);
  }

  const tableRef = Array.isArray(ast.table) ? ast.table[0] : ast.table;
  const tableId = tableRef?.table;
  if (!tableId) {
    throw new ApiError("No table specified", 400);
  }

  const defs = ast.create_definitions;
  if (!defs || defs.length === 0) {
    throw new ApiError("CREATE TABLE with no columns", 400);
  }

  const columns: { id: string, type: string }[] = [];
  for (const def of defs) {
    if (def.resource !== "column") { continue; }
    const cname = colName(def.column);
    if (!cname) { continue; }
    const sqlType = def.definition?.dataType || "TEXT";
    columns.push({ id: cname, type: sqlTypeToGrist(sqlType) });
  }

  if (columns.length === 0) {
    throw new ApiError("CREATE TABLE with no columns", 400);
  }

  const result = await applyActions(ctx, [["AddTable", tableId, columns]]);
  return { tag: "CREATE TABLE", rowCount: 0, actionNum: result.actionNum, actionHash: result.actionHash };
}

// ---- DROP TABLE ----

async function executeDrop(
  ast: Drop,
  ctx: DmlContext,
): Promise<DmlResult> {
  if (ast.keyword !== "table") {
    throw new ApiError(`DROP ${ast.keyword} is not supported`, 400);
  }

  const tableId = ast.name?.[0]?.table;
  if (!tableId) {
    throw new ApiError("No table specified", 400);
  }

  const result = await applyActions(ctx, [["RemoveTable", tableId]]);
  return { tag: "DROP TABLE", rowCount: 0, actionNum: result.actionNum, actionHash: result.actionHash };
}

// ---- ALTER TABLE ----

async function executeAlter(
  ast: Alter,
  ctx: DmlContext,
): Promise<DmlResult> {
  const firstTable = ast.table?.[0];
  const tableId = firstTable && "table" in firstTable ? firstTable.table : undefined;
  if (!tableId) {
    throw new ApiError("No table specified", 400);
  }

  const exprs: { action: string; [k: string]: unknown }[] = ast.expr;
  if (!exprs || exprs.length === 0) {
    throw new ApiError("ALTER TABLE with no operations", 400);
  }

  const actions: UserAction[] = [];
  for (const expr of exprs) {
    switch (expr.action) {
      case "add": {
        const cname = colName((expr.column));
        const sqlType = (expr.definition as { dataType?: string })?.dataType || "TEXT";
        if (!cname) { throw new ApiError("ADD COLUMN with no column name", 400); }
        actions.push(["AddColumn", tableId, cname, { type: sqlTypeToGrist(sqlType) }]);
        break;
      }
      case "drop": {
        const cname = colName((expr.column));
        if (!cname) { throw new ApiError("DROP COLUMN with no column name", 400); }
        actions.push(["RemoveColumn", tableId, cname]);
        break;
      }
      case "rename": {
        if (expr.resource === "column") {
          const oldName = colName((expr.old_column));
          const newName = colName((expr.column));
          if (!oldName || !newName) { throw new ApiError("RENAME COLUMN missing names", 400); }
          actions.push(["RenameColumn", tableId, oldName, newName]);
        } else if (expr.resource === "table") {
          const newName = expr.table as string;
          if (!newName) { throw new ApiError("RENAME TO missing new name", 400); }
          actions.push(["RenameTable", tableId, newName]);
        } else {
          throw new ApiError(`Unsupported ALTER RENAME resource: ${expr.resource}`, 400);
        }
        break;
      }
      default:
        throw new ApiError(`Unsupported ALTER TABLE action: ${expr.action}`, 400);
    }
  }

  let resultInfo: { actionNum?: number, actionHash?: string | null } = {};
  if (actions.length > 0) {
    const result = await applyActions(ctx, actions);
    resultInfo = { actionNum: result.actionNum, actionHash: result.actionHash };
  }

  return { tag: "ALTER TABLE", rowCount: 0, ...resultInfo };
}
