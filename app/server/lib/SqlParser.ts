/**
 * Shared SQL parser instance for the PgWire/SQL execution pipeline.
 *
 * All SQL parsing should go through parseSQL() which tries PostgreSQL mode
 * first, then falls back to default mode. The returned ParsedSQL carries
 * the AST and dialect so that sqlify uses the matching mode.
 */
import { ApiError } from "app/common/ApiError";

import { AST, Option, Parser } from "node-sql-parser";

export const sqlParser = new Parser();
export const SQL_PARSE_OPTS = { database: "postgresql" as const };

/** Re-export the parser's AST type for use in entry-point signatures. */
export type SqlAST = AST;

type Dialect = "postgresql" | "default";

export interface ParsedSQL {
  ast: AST;
  dialect: Dialect;
  tables: string[];
}

const DML_TYPES = new Set(["insert", "update", "delete", "create", "drop", "alter"]);

/**
 * Parse a SQL string into an AST. Tries PostgreSQL mode first, falls back
 * to default mode. This is the single entry point for all SQL parsing —
 * no other code should call parser.astify directly.
 *
 * Why the fallback: node-sql-parser's PostgreSQL mode doesn't support some
 * valid SQL constructs (e.g., ALTER TABLE RENAME COLUMN). The default mode
 * (MySQL-like) is more permissive and handles these. The fallback only
 * triggers when PostgreSQL mode fails to parse entirely — not when it
 * produces a different AST. The dialect is tracked so that sqlifyAST uses
 * the matching mode for regeneration.
 *
 * Risk: if a query fails in PostgreSQL mode for a non-obvious reason and
 * default mode parses it with different semantics (e.g., double-quoted
 * strings vs identifiers), the regenerated SQL could differ from user
 * intent. In practice this hasn't occurred because the cases triggering
 * fallback are unsupported DDL syntax, not ambiguous quoting. If this
 * becomes a concern, the fallback could be restricted to DDL only.
 */
export function parseSQL(sql: string): ParsedSQL {
  let ast: AST | AST[];
  let dialect: Dialect;
  let tables: string[];

  try {
    ast = sqlParser.astify(sql, SQL_PARSE_OPTS);
    dialect = "postgresql";
  } catch {
    // PostgreSQL mode couldn't parse — retry in default mode.
    // See docstring above for why this is safe in practice.
    try {
      ast = sqlParser.astify(sql);
      dialect = "default";
    } catch (e: unknown) {
      throw new ApiError(`SQL parse error: ${e instanceof Error ? e.message : String(e)}`, 400);
    }
  }

  if (Array.isArray(ast)) {
    if (ast.length !== 1) {
      throw new ApiError("Only single statements are supported", 400);
    }
    ast = ast[0];
  }

  try {
    const tableList = sqlParser.tableList(sql, dialectOpts(dialect));
    tables = tableList.map(entry => entry.split("::")[2]);
  } catch {
    tables = [];  // Caller should handle empty tables if needed
  }

  return { ast, dialect, tables };
}

/** Get parser options for a dialect — PostgreSQL mode or default. */
function dialectOpts(dialect: Dialect): Option | undefined {
  return dialect === "postgresql" ? SQL_PARSE_OPTS : undefined;
}

/** Check whether an AST represents a write (DML/DDL) statement. */
export function isDMLAst(ast: AST): boolean {
  return DML_TYPES.has(ast?.type);
}

/** Regenerate SQL from an AST using the dialect it was parsed with. */
export function sqlifyAST(ast: AST | AST[], dialect: Dialect): string {
  return sqlParser.sqlify(ast, dialectOpts(dialect));
}
