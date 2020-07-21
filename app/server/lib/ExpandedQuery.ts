import {Query} from 'app/common/ActiveDocAPI';
import {ApiError} from 'app/common/ApiError';
import {DocData} from 'app/common/DocData';
import {parseFormula} from 'app/common/Formula';
import {removePrefix} from 'app/common/gutil';
import {quoteIdent} from 'app/server/lib/SQLiteDB';

/**
 * Represents a query for Grist data with support for SQL-based
 * formulas.  Use of this representation should be limited to within a
 * trusted part of Grist since it assembles SQL strings.
 */
export interface ExpandedQuery extends Query {
  // Errors detected for given columns because of formula issues.  We
  // need to make sure the result of the query contains these error
  // objects.  It is awkward to write a sql selection that constructs
  // an error object, so instead we select 0 in the case of an error,
  // and substitute in the error object in javascript after the SQL
  // step.  That means we need to pass the error message along
  // explicitly.
  constants?: {
    [colId: string]: ['E', string] | ['P'];
  };

  // A list of join clauses to bring in data from other tables.
  joins?: string[];

  // A list of selections for regular data and data computed via formulas.
  selects?: string[];
}

/**
 * Add JOINs and SELECTs to a query in order to implement formulas via SQL.
 *
 * Supports simple formulas that load a column via a reference.
 * The referenced column itself cannot (yet) be a formula.
 * Filtered columns cannot (yet) be a formula.
 *
 * If formulas is not set, we simply mark formula columns as pending.
 */
export function expandQuery(iquery: Query, docData: DocData, formulas: boolean = true): ExpandedQuery {
  const query: ExpandedQuery = {
    tableId: iquery.tableId,
    filters: iquery.filters,
    limit: iquery.limit
  };

  // Look up the main table for the query.
  const tables = docData.getTable('_grist_Tables')!;
  const columns = docData.getTable('_grist_Tables_column')!;
  const tableRef = tables.findRow('tableId', query.tableId);
  if (!tableRef) { throw new ApiError('table not found', 404); }

  // Find any references to other tables.
  const dataColumns = columns.filterRecords({parentId: tableRef, isFormula: false});
  const references = new Map<string, string>();
  for (const column of dataColumns) {
    const refTableId = removePrefix(column.type as string, 'Ref:');
    if (refTableId) { references.set(column.colId as string, refTableId); }
  }

  // Start accumulating a set of joins and selects needed for the query.
  const joins = new Set<string>();
  const selects = new Set<string>();

  // Select all data columns
  selects.add(`${quoteIdent(query.tableId)}.*`);

  // Iterate through all formulas, adding joins and selects as we go.
  if (formulas) {
    const formulaColumns = columns.filterRecords({parentId: tableRef, isFormula: true});
    for (const column of formulaColumns) {
      const formula = parseFormula(column.formula as string);
      const colId = column.colId as string;
      let sqlFormula = "";
      let error = "";
      if (formula.kind === 'foreignColumn') {
        const altTableId = references.get(formula.refColId);
        const altTableRef = tables.findRow('tableId', altTableId);
        if (altTableId && altTableRef) {
          const altColumn = columns.filterRecords({parentId: altTableRef, isFormula: false, colId: formula.colId});
          // TODO: deal with a formula column in the other table.
          if (altColumn.length > 0) {
            const alias = `${query.tableId}_${formula.refColId}`;
            joins.add(`LEFT JOIN ${quoteIdent(altTableId)} AS ${quoteIdent(alias)} ` +
                      `ON ${quoteIdent(alias)}.id = ` +
                      `${quoteIdent(query.tableId)}.${quoteIdent(formula.refColId)}`);
            sqlFormula = `${quoteIdent(alias)}.${quoteIdent(formula.colId)}`;
          } else {
            error = "Cannot find column";
          }
        } else {
          error = "Cannot find table";
        }
      } else if (formula.kind === 'column') {
        const altColumn = columns.filterRecords({parentId: tableRef, isFormula: false, colId: formula.colId});
        // TODO: deal with a formula column.
        if (altColumn.length > 0) {
          sqlFormula = `${quoteIdent(query.tableId)}.${quoteIdent(formula.colId)}`;
        } else {
          error = "Cannot find column";
        }
      } else if (formula.kind === 'literalNumber') {
        sqlFormula = `${formula.value}`;
      } else if (formula.kind === 'error') {
        error = formula.msg;
      } else {
        throw new Error('Unrecognized type of formula');
      }
      if (error) {
        // We add a trivial selection, and store errors in the query for substitution later.
        sqlFormula = '0';
        if (!query.constants) { query.constants = {}; }
        query.constants[colId] = ['E', error];
      }
      if (sqlFormula) {
        selects.add(`${sqlFormula} as ${quoteIdent(colId)}`);
      }
    }
  } else {
    const formulaColumns = columns.filterRecords({parentId: tableRef, isFormula: true});
    for (const column of formulaColumns) {
      if (!column.formula) { continue; }  // Columns like this won't get calculated, so skip.
      const colId = column.colId as string;
      if (!query.constants) { query.constants = {}; }
      query.constants[colId] = ['P'];
      selects.add(`0 as ${quoteIdent(colId)}`);
    }
  }

  // Copy decisions to the query object, and return.
  query.joins = [...joins];
  query.selects = [...selects];
  return query;
}
