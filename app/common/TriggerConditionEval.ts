/**
 * Evaluates trigger conditions from structured ConditionConfig objects.
 *
 * This module is used by both the server (Triggers.ts) and the client (TriggersPageEdit.ts)
 * to evaluate trigger conditions directly from the config, without converting to Python text.
 * This supports relative date filters (TODAY, This week, etc.) which can't be expressed
 * as static Python expressions.
 */
import { buildColFilter, ColumnFilterFunc } from "app/common/ColumnFilterFunc";
import { RowRecord } from "app/common/DocActions";
import { CompiledPredicateFormula, compilePredicateFormula, ParsedPredicateFormula } from "app/common/PredicateFormula";
import { ConditionConfig } from "app/common/Triggers";

export interface CompiledTriggerConfig {
  /** Evaluates whether a row matches the filter (for row highlighting, no notifyWhen logic). */
  matchesFilter: (rec: RowRecord) => boolean;
  /** Evaluates whether a trigger should fire (includes notifyWhen enter/leave/update logic). */
  matchesTrigger: (rec: RowRecord, oldRec: RowRecord) => boolean;
}

/**
 * Compiles a ConditionConfig into filter and trigger predicates.
 *
 * @param config The structured condition configuration from the UI.
 * @param getColumnType Returns the column type string (e.g. "Date", "DateTime:America/New_York")
 *   for a given colId. Used to correctly evaluate date range filters with relative dates.
 * @param getColId Resolves a column ref (number) to a colId (string). Returns undefined
 *   if the ref cannot be resolved (e.g. column was deleted).
 */
export function compileTriggerConfig(
  config: ConditionConfig,
  getColumnType: (colId: string) => string,
  getColId: (ref: number) => string | undefined,
): CompiledTriggerConfig {
  const colFilterFuncs: { colId: string; func: ColumnFilterFunc }[] = [];
  if (config.columnFilters?.length) {
    for (const { colRef, filter } of config.columnFilters) {
      const colId = getColId(colRef);
      if (!colId) { continue; }
      const func = buildColFilter(filter, getColumnType(colId));
      if (func) {
        colFilterFuncs.push({ colId, func });
      }
    }
  }

  const requiredColIds: string[] = (config.requiredColumns ?? [])
    .map(ref => getColId(ref))
    .filter((id): id is string => typeof id === "string");

  let customFn: CompiledPredicateFormula | null = null;
  if (config.customExpressionParsed) {
    try {
      customFn = compilePredicateFormula(
        config.customExpressionParsed as ParsedPredicateFormula,
        { variant: "trigger" },
      );
    } catch {
      // If the custom expression fails to compile, treat it as non-matching.
      customFn = () => false;
    }
  }

  // Checks whether a record passes all column filters, required columns, and custom expression.
  // Custom expression receives the record as `rec` with an empty `oldRec`.
  function matchesRecord(record: RowRecord): boolean {
    for (const { colId, func } of colFilterFuncs) {
      if (!func(record[colId])) { return false; }
    }
    for (const colId of requiredColIds) {
      if (!record[colId]) { return false; }
    }
    if (customFn && !customFn({ rec: record, oldRec: { id: 0 } })) { return false; }
    return true;
  }

  function matchesFilter(rec: RowRecord): boolean {
    return matchesRecord(rec);
  }

  function matchesTrigger(rec: RowRecord, oldRec: RowRecord): boolean {
    const { notifyWhen } = config;

    if (!notifyWhen || notifyWhen === "enters") {
      if (!matchesRecord(rec)) { return false; }
      if (notifyWhen === "enters") {
        if (oldRec.id && matchesRecord(oldRec)) { return false; }
      }
      return true;
    }

    if (notifyWhen === "leaves") {
      if (!matchesRecord(oldRec)) { return false; }
      if (rec.id && matchesRecord(rec)) { return false; }
      return true;
    }

    if (notifyWhen === "updated") {
      if (!matchesRecord(rec)) { return false; }
      if (!oldRec.id || !matchesRecord(oldRec)) { return false; }
      return true;
    }

    return matchesRecord(rec);
  }

  return { matchesFilter, matchesTrigger };
}
