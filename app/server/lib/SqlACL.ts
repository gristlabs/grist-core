/**
 * SqlACL: Translates Grist ACL predicate formulas to SQL WHERE clauses,
 * and provides ACL-filtered SQL execution via CTE wrappers.
 */

import { ApiError } from "app/common/ApiError";
import { RulePart } from "app/common/GranularAccessClause";
import { isMetadataTable } from "app/common/isHiddenTable";
import { ParsedPredicateFormula } from "app/common/PredicateFormula";
import { InfoView } from "app/common/RecordView";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { OptDocSession } from "app/server/lib/DocSession";
import log from "app/server/lib/log";
import { quoteIdent } from "app/server/lib/SQLiteDB";
import { ParsedSQL, sqlifyAST } from "app/server/lib/SqlParser";
import { ColumnTypeMap } from "app/server/lib/SqlValues";

// Marshal-encoded ["C"] blob (GristObjCode.Censored) for censored cells.
const CENSORED_BLOB = "X'5b01000000750100000043'";

export function sqlQuote(s: string): string {
  return "'" + s.replace(/\0/g, "").replace(/'/g, "''") + "'";
}

// ---- Permission text parsing ----

// ---- Formula-to-SQL compilation ----

/**
 * Compile a parsed ACL predicate formula into a SQL expression.
 * Returns null if the formula can't be translated.
 */
export function aclFormulaToSQL(
  parsed: ParsedPredicateFormula,
  user: Record<string, any>,
  tableId?: string,
  columnTypes?: Map<string, ColumnTypeMap>,
): string | null {
  try {
    const colTypes = tableId && columnTypes ? columnTypes.get(tableId) : undefined;
    return toBool(nodeToSQL(parsed, user, colTypes));
  } catch {
    return null;
  }
}

/**
 * Wrap a SQL expression to match JavaScript truthiness rules.
 * JS: null, "", 0, false are falsy. SQLite: strings try numeric conversion.
 */
function toBool(expr: string): string {
  return `(${expr} IS NOT NULL AND ${expr} != '' AND ${expr} != 0)`;
}

function nodeToSQL(
  node: ParsedPredicateFormula, user: Record<string, any>, colTypes?: ColumnTypeMap,
): string {
  const args = node.slice(1) as ParsedPredicateFormula[];
  const n = (a: ParsedPredicateFormula) => nodeToSQL(a, user, colTypes);
  switch (node[0]) {
    case "And":   return "(" + args.map(a => toBool(n(a))).join(" AND ") + ")";
    case "Or":    return "(" + args.map(a => toBool(n(a))).join(" OR ") + ")";
    case "Not":   return "(NOT " + toBool(n(args[0])) + ")";
    case "Eq": case "Is":     return binaryOp(args, user, "=", colTypes);
    case "NotEq": case "IsNot": return binaryOp(args, user, "!=", colTypes);
    case "Lt":    return binaryOp(args, user, "<", colTypes);
    case "LtE":   return binaryOp(args, user, "<=", colTypes);
    case "Gt":    return binaryOp(args, user, ">", colTypes);
    case "GtE":   return binaryOp(args, user, ">=", colTypes);
    case "In":    return n(args[0]) + " IN " + n(args[1]);
    case "NotIn": return n(args[0]) + " NOT IN " + n(args[1]);
    case "Add":   return binaryOp(args, user, "+", colTypes);
    case "Sub":   return binaryOp(args, user, "-", colTypes);
    case "Mult":  return binaryOp(args, user, "*", colTypes);
    case "Div":   return binaryOp(args, user, "/", colTypes);
    case "Mod":   return binaryOp(args, user, "%", colTypes);
    case "Const": {
      const val = node[1];
      if (val === null) { return "NULL"; }
      if (typeof val === "boolean") { return val ? "1" : "0"; }
      if (typeof val === "number") { return String(val); }
      if (typeof val === "string") { return sqlQuote(val); }
      throw new Error("unsupported const type");
    }
    case "List":
      return "(" + args.map(a => n(a)).join(", ") + ")";
    case "Name": {
      const name = node[1] as string;
      if (name === "EDITOR") { return sqlQuote("editors"); }
      if (name === "OWNER") { return sqlQuote("owners"); }
      if (name === "VIEWER") { return sqlQuote("viewers"); }
      if (name === "True") { return "1"; }
      if (name === "False") { return "0"; }
      if (name === "None") { return "NULL"; }
      throw new Error(`unknown name: ${name}`);
    }
    case "Attr":
      return nodeToSQLAttr(node, user);
    case "Call":
      return nodeToSQLCall(node, user, colTypes);
    case "Comment": return n(args[0]);
    default: throw new Error(`unsupported node: ${node[0]}`);
  }
}

function nodeToSQLAttr(node: ParsedPredicateFormula, user: Record<string, any>): string {
  const attrName = node[2] as string;
  const base = node[1] as ParsedPredicateFormula;

  if (base[0] === "Name" && (base[1] === "rec" || base[1] === "newRec")) {
    return quoteIdent(attrName);
  }

  if (base[0] === "Name" && base[1] === "user") {
    return resolveUserValue(user[attrName]);
  }

  // user.Zone.City — chained attribute access
  if (base[0] === "Attr") {
    const baseBase = base[1] as ParsedPredicateFormula;
    const baseAttr = base[2] as string;
    if (baseBase[0] === "Name" && baseBase[1] === "user") {
      const attrValue = user[baseAttr];
      if (isInfoView(attrValue)) {
        return resolveUserValue(attrValue.get(attrName));
      }
      if (attrValue && typeof attrValue === "object") {
        return resolveUserValue(attrValue[attrName]);
      }
      return "NULL";
    }
  }

  throw new Error(`unsupported attr base: ${JSON.stringify(base)}`);
}

function nodeToSQLCall(
  node: ParsedPredicateFormula, user: Record<string, any>, colTypes?: ColumnTypeMap,
): string {
  const target = node[1] as ParsedPredicateFormula;
  if (target[0] !== "Attr") { throw new Error("unsupported call target"); }
  const methodName = target[2] as string;
  const methodTarget = target[1] as ParsedPredicateFormula;
  if (methodName === "lower" || methodName === "upper") {
    return `${methodName === "lower" ? "LOWER" : "UPPER"}(${nodeToSQL(methodTarget, user, colTypes)})`;
  }
  throw new Error(`unsupported method: ${methodName}`);
}

function isInfoView(val: any): val is InfoView {
  return val && typeof val === "object" && typeof val.get === "function";
}

function resolveUserValue(val: any): string {
  if (val === null || val === undefined) { return "NULL"; }
  if (isInfoView(val)) { return resolveUserValue(val.get("id")); }
  if (typeof val === "number") { return String(val); }
  if (typeof val === "boolean") { return val ? "1" : "0"; }
  return sqlQuote(String(val));
}

function binaryOp(
  args: ParsedPredicateFormula[], user: Record<string, any>, op: string, colTypes?: ColumnTypeMap,
): string {
  const left = nodeToSQL(args[0], user, colTypes);
  const right = nodeToSQL(args[1], user, colTypes);
  if (right === "NULL" && op === "=") { return `(${left} IS NULL)`; }
  if (right === "NULL" && op === "!=") { return `(${left} IS NOT NULL)`; }
  if (left === "NULL" && op === "=") { return `(${right} IS NULL)`; }
  if (left === "NULL" && op === "!=") { return `(${right} IS NOT NULL)`; }
  if (colTypes && (op === "=" || op === "!=")) {
    if (isBoolVsNumber(args[0], args[1], colTypes) || isBoolVsNumber(args[1], args[0], colTypes)) {
      return op === "=" ? "0" : "1";
    }
  }
  return `(${left} ${op} ${right})`;
}

function isBoolVsNumber(a: ParsedPredicateFormula, b: ParsedPredicateFormula, colTypes: ColumnTypeMap): boolean {
  if (a[0] !== "Attr" || b[0] !== "Const") { return false; }
  if (typeof b[1] !== "number") { return false; }
  const base = a[1] as ParsedPredicateFormula;
  if (base[0] !== "Name" || (base[1] !== "rec" && base[1] !== "newRec")) { return false; }
  return colTypes[a[2] as string] === "Bool";
}

// ---- AST table rewriting ----

function _rewriteTableRefs(node: any, mapping: Map<string, string>): any {
  if (!node || typeof node !== "object") { return node; }
  if (Array.isArray(node)) {
    let changed = false;
    const result = node.map((n) => {
      const r = _rewriteTableRefs(n, mapping);
      if (r !== n) { changed = true; }
      return r;
    });
    return changed ? result : node;
  }
  let result: any;
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (key === "table" && typeof val === "string" && mapping.has(val)) {
      if (!result) { result = { ...node }; }
      result[key] = mapping.get(val);
    } else if (typeof val === "object" && val !== null) {
      const r = _rewriteTableRefs(val, mapping);
      if (r !== val) {
        if (!result) { result = { ...node }; }
        result[key] = r;
      }
    }
  }
  return result ?? node;
}

function rewriteAndSqlify(parsed: ParsedSQL, mapping: Map<string, string>): string | null {
  try {
    return sqlifyAST(_rewriteTableRefs(parsed.ast, mapping), parsed.dialect);
  } catch {
    return null;
  }
}

// ---- Helpers for extracting parsed formulas from RuleParts ----

/** Get the parsed formula AST from a RulePart, or null if empty/absent. */
function getParsedFormula(rule: RulePart): ParsedPredicateFormula | null {
  if (!rule.aclFormula) { return null; }
  const raw = rule.origRecord?.aclFormulaParsed;
  if (!raw || typeof raw !== "string") { return null; }
  try { return JSON.parse(raw); } catch { return null; }
}

// ---- Per-table ACL → SQL compilation ----

/** Build a SQL WHERE clause from row-level rules (first-match CASE WHEN). */
function compileRowFilter(
  rules: RulePart[], userInfo: Record<string, any>,
  tableId: string, columnTypes: Map<string, ColumnTypeMap>,
): string | null {
  const caseBranches: string[] = [];
  let defaultAllow = true;

  for (const rule of rules) {
    const perm = rule.permissions.read;
    if (!perm) { continue; }

    const formula = getParsedFormula(rule);
    if (!formula) {
      defaultAllow = perm === "allow";
      break;
    }

    const sqlWhere = aclFormulaToSQL(formula, userInfo, tableId, columnTypes);
    if (sqlWhere === null) {
      throw new ApiError("ACL rules for this document cannot be applied to SQL queries", 403);
    }
    caseBranches.push(`WHEN ${sqlWhere} THEN ${perm === "allow" ? "1" : "0"}`);
  }

  if (caseBranches.length > 0) {
    return `(CASE ${caseBranches.join(" ")} ELSE ${defaultAllow ? "1" : "0"} END = 1)`;
  }
  return defaultAllow ? null : "0";
}

/** Compute column visibility from column-level RuleSets (from ACLRuleCollection). */
function compileColumnFilter(
  colRuleSets: import("app/common/GranularAccessClause").RuleSet[],
  userInfo: Record<string, any>,
  tableId: string, columnTypes: Map<string, ColumnTypeMap>,
): { deniedCols: Set<string>, grantedCols: Set<string>, censoredCols: Map<string, string> } {
  const deniedCols = new Set<string>();
  const grantedCols = new Set<string>();
  const colBranches = new Map<string, { cond: string, deny: boolean }[]>();
  const colDefaults = new Map<string, boolean>();

  for (const ruleSet of colRuleSets) {
    const cols = ruleSet.colIds === "*" ? [] : ruleSet.colIds;
    for (const rule of ruleSet.body) {
      const perm = rule.permissions.read;
      if (!perm) { continue; }
      const isDeny = perm === "deny";
      const formula = getParsedFormula(rule);

      if (!formula) {
        for (const col of cols) {
          if (isDeny && !colBranches.has(col)) { deniedCols.add(col); }
          if (!isDeny) { grantedCols.add(col); }
          colDefaults.set(col, isDeny);
        }
      } else {
        const sqlCond = aclFormulaToSQL(formula, userInfo, tableId, columnTypes);
        if (sqlCond === null) {
          throw new ApiError("ACL rules for this document cannot be applied to SQL queries", 403);
        }
        for (const col of cols) {
          if (!colBranches.has(col)) { colBranches.set(col, []); }
          colBranches.get(col)!.push({ cond: sqlCond, deny: isDeny });
        }
      }
    }
  }

  const censoredCols = new Map<string, string>();
  for (const [col, branches] of colBranches) {
    if (deniedCols.has(col)) { continue; }
    const whens = branches.map(b =>
      `WHEN ${b.cond} THEN ${b.deny ? CENSORED_BLOB : quoteIdent(col)}`,
    ).join(" ");
    const defaultDeny = colDefaults.get(col) ?? false;
    const elseVal = defaultDeny ? CENSORED_BLOB : quoteIdent(col);
    censoredCols.set(col, `CASE ${whens} ELSE ${elseVal} END`);
  }

  return { deniedCols, grantedCols, censoredCols };
}

/** Build a CTE SELECT for a single table with row filter and column visibility. */
function buildTableCTE(
  tableId: string,
  rowFilter: string | null,
  colFilter: { deniedCols: Set<string>, grantedCols: Set<string>, censoredCols: Map<string, string> },
  columnTypes: Map<string, ColumnTypeMap>,
): { sql: string, cteName: string } {
  const typeMap = columnTypes.get(tableId) || {};
  const allowedCols = Object.keys(typeMap)
    .filter(c => c !== "manualSort" && !c.startsWith("gristHelper_") && !colFilter.deniedCols.has(c));

  // When column grants coexist with a conditional row filter, the interaction is:
  // - Granted columns: always visible (column grant overrides table deny)
  // - Non-granted columns: censored for rows failing the row filter
  // - Denied columns: hidden entirely
  // The row filter becomes per-column censoring, not a WHERE clause,
  // because granted columns must be visible for ALL rows.
  // (For unconditional deny "0", non-granted columns are excluded entirely.)
  if (colFilter.grantedCols.size > 0 && rowFilter && rowFilter !== "0") {
    const colExprs = allowedCols.map((c) => {
      if (colFilter.grantedCols.has(c)) {
        // Granted: always visible
        const caseExpr = colFilter.censoredCols.get(c);
        return caseExpr ? `${caseExpr} AS ${quoteIdent(c)}` : quoteIdent(c);
      }
      // Non-granted: censor when row filter fails
      const baseCensor = colFilter.censoredCols.get(c);
      const colExpr = baseCensor || quoteIdent(c);
      return `CASE WHEN ${rowFilter} THEN ${colExpr} ELSE ${CENSORED_BLOB} END AS ${quoteIdent(c)}`;
    });
    const colList = ["id", ...colExprs].join(", ");
    const cteName = `_acl_${tableId}`;
    return {
      sql: `${quoteIdent(cteName)} AS (SELECT ${colList} FROM ${quoteIdent(tableId)})`,
      cteName,
    };
  }

  // Simple cases: only grants (no row filter), or only row filter (no grants)
  if (colFilter.grantedCols.size > 0) {
    // Pure column-grant pattern: only granted columns, no row filter needed
    const grantedOnly = allowedCols.filter(c => colFilter.grantedCols.has(c));
    const colExprs = grantedOnly.map((c) => {
      const caseExpr = colFilter.censoredCols.get(c);
      return caseExpr ? `${caseExpr} AS ${quoteIdent(c)}` : quoteIdent(c);
    });
    const colList = ["id", ...colExprs].join(", ");
    const cteName = `_acl_${tableId}`;
    return {
      sql: `${quoteIdent(cteName)} AS (SELECT ${colList} FROM ${quoteIdent(tableId)})`,
      cteName,
    };
  }

  // No grants: standard path with row filter and column censoring
  const colExprs = allowedCols.map((c) => {
    const caseExpr = colFilter.censoredCols.get(c);
    return caseExpr ? `${caseExpr} AS ${quoteIdent(c)}` : quoteIdent(c);
  });
  const colList = ["id", ...colExprs].join(", ");
  const whereClause = rowFilter ? ` WHERE ${rowFilter}` : "";
  const cteName = `_acl_${tableId}`;
  return {
    sql: `${quoteIdent(cteName)} AS (SELECT ${colList} FROM ${quoteIdent(tableId)}${whereClause})`,
    cteName,
  };
}

// ---- Main entry point ----

function getReferencedTables(parsed: ParsedSQL, columnTypes: Map<string, ColumnTypeMap>): string[] {
  const knownTables = new Set(columnTypes.keys());
  if (parsed.tables.length > 0) {
    return parsed.tables.filter(t => knownTables.has(t) && !isMetadataTable(t));
  }
  return [...knownTables].filter(t => !isMetadataTable(t));
}

/**
 * Run a query with ACL rules translated to SQL via CTE wrappers.
 */
export async function tryRunWithSqlAcl(
  sql: string,
  parsed: ParsedSQL,
  activeDoc: ActiveDoc,
  docSession: OptDocSession,
  columnTypes: Map<string, ColumnTypeMap>,
): Promise<any[]> {
  const docStorage = activeDoc.docStorage;
  const userInfo = await activeDoc.getUser(docSession);
  if (!userInfo) {
    throw new ApiError("Cannot resolve user for access control", 403);
  }
  // Phase 1: Get rules from the existing ACLRuleCollection (shared with GranularAccess).
  const ruleCollection = activeDoc.getACLRuleCollection();
  const tableIds = getReferencedTables(parsed, columnTypes);

  // Phase 2: Check table-level access (matches REST API's 403 behavior)
  for (const tableId of tableIds) {
    if (!await activeDoc.hasTableAccess(docSession, tableId)) {
      throw new ApiError(`Access to table "${tableId}" is denied`, 403);
    }
  }

  // Phase 3: Compile per-table row and column filters → CTEs
  const ctes: string[] = [];
  const tableMapping = new Map<string, string>();
  const docRuleSet = ruleCollection.getDocDefaultRuleSet();

  for (const tableId of tableIds) {
    const tableRuleSet = ruleCollection.getTableDefaultRuleSet(tableId);
    const rowRules = [
      ...(tableRuleSet?.body || []),
      ...docRuleSet.body,
    ];
    const rowFilter = compileRowFilter(rowRules, userInfo, tableId, columnTypes);
    const colFilter = compileColumnFilter(
      ruleCollection.getAllColumnRuleSets(tableId), userInfo, tableId, columnTypes);
    const { sql: cteSql, cteName } = buildTableCTE(tableId, rowFilter, colFilter, columnTypes);
    ctes.push(cteSql);
    tableMapping.set(tableId, cteName);
  }

  // Phase 4: Rewrite query and execute
  if (ctes.length === 0) {
    return docStorage.all(`SELECT * FROM (${sql})`);
  }

  const filteredSql = rewriteAndSqlify(parsed, tableMapping);
  if (filteredSql === null) {
    throw new ApiError("ACL rules for this document cannot be applied to SQL queries", 403);
  }

  const fullSql = `WITH ${ctes.join(", ")} SELECT * FROM (${filteredSql})`;
  log.debug("SqlACL: filtered SQL", { sql: fullSql.substring(0, 300) });
  return docStorage.all(fullSql);
}
