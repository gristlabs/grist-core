import { ServerQuery } from 'app/common/ActiveDocAPI';
import { ApiError } from 'app/common/ApiError';
import { DocData } from 'app/common/DocData';
import { parseFormula } from 'app/common/Formula';
import { removePrefix } from 'app/common/gutil';
import { GristObjCode } from 'app/plugin/GristData';
import { quoteIdent } from 'app/server/lib/SQLiteDB';

/**
 * Represents a query for Grist data with support for SQL-based
 * formulas.  Use of this representation should be limited to within a
 * trusted part of Grist since it assembles SQL strings.
 */
export interface ExpandedQuery extends ServerQuery {
  // Errors detected for given columns because of formula issues.  We
  // need to make sure the result of the query contains these error
  // objects.  It is awkward to write a sql selection that constructs
  // an error object, so instead we select 0 in the case of an error,
  // and substitute in the error object in javascript after the SQL
  // step.  That means we need to pass the error message along
  // explicitly.
  constants?: {
    [colId: string]: [GristObjCode.Exception, string] | [GristObjCode.Pending];
  };

  // A list of join clauses to bring in data from other tables.
  joins?: string[];

  // A list of selections for regular data and data computed via formulas.
  selects?: string[];

  // A list of conditions for filtering query results.
  wheres?: string[];
}

/**
 * Add JOINs and SELECTs to a query in order to implement formulas via SQL.
 *
 * Supports simple formulas that load a column via a reference.
 * The referenced column itself cannot (yet) be a formula.
 * Filtered columns cannot (yet) be a formula.
 *
 * If onDemandFormulas is set, ignore stored formula columns, and compute them using SQL.
 */
export function expandQuery(iquery: ServerQuery, docData: DocData, onDemandFormulas: boolean = true): ExpandedQuery {
  const query: ExpandedQuery = {
    tableId: iquery.tableId,
    filters: iquery.filters,
    limit: iquery.limit
  };

  // Start accumulating a set of joins and selects needed for the query.
  const joins = new Set<string>();
  const selects = new Set<string>();

  // Iterate through all formulas, adding joins and selects as we go.
  if (onDemandFormulas) {
    // Look up the main table for the query.
    const tables = docData.getMetaTable('_grist_Tables');
    const columns = docData.getMetaTable('_grist_Tables_column');
    const tableRef = tables.findRow('tableId', query.tableId);
    if (!tableRef) { throw new ApiError('table not found', 404); }

    // Find any references to other tables.
    const dataColumns = columns.filterRecords({parentId: tableRef, isFormula: false});
    const references = new Map<string, string>();
    for (const column of dataColumns) {
      const refTableId = removePrefix(column.type as string, 'Ref:');
      if (refTableId) { references.set(column.colId as string, refTableId); }
    }

    selects.add(`${quoteIdent(query.tableId)}.id`);
    for (const column of dataColumns) {
      selects.add(`${quoteIdent(query.tableId)}.${quoteIdent(column.colId as string)}`);
    }
    const formulaColumns = columns.filterRecords({parentId: tableRef, isFormula: true});
    for (const column of formulaColumns) {
      const formula = parseFormula(column.formula as string);
      const colId = column.colId as string;
      let sqlFormula = "";
      let error = "";
      if (formula.kind === 'foreignColumn') {
        const altTableId = references.get(formula.refColId);
        const altTableRef = tables.findRow('tableId', altTableId!);
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
        query.constants[colId] = [GristObjCode.Exception, error];
      }
      if (sqlFormula) {
        selects.add(`${sqlFormula} as ${quoteIdent(colId)}`);
      }
    }
  } else {
    // Select all data and formula columns.
    selects.add(`${quoteIdent(query.tableId)}.*`);
  }

  // Copy decisions to the query object, and return.
  query.joins = [...joins];
  query.selects = [...selects];
  return query;
}

/**
 * Build a query that relates two homogeneous tables sharing a common set of columns,
 * returning rows that exist in both tables (if they have differences), and rows from
 * `leftTableId` that don't exist in `rightTableId`.
 *
 * In practice, this is currently only used for generating diffs and add/update actions
 * for incremental imports into existing tables. Specifically, `leftTableId` is the
 * source table, and `rightTableId` is the destination table.
 *
 * Columns from the query result are prefixed with the table id and a '.' separator.
 *
 * NOTE: Intended for internal use from trusted parts of Grist only.
 *
 * @param {string} leftTableId Name of the left table in the comparison.
 * @param {string} rightTableId Name of the right table in the comparison.
 * @param {Map<string, string[]>} selectColumns Map of left table column ids to their matching equivalent(s)
 * from the right table. A single left column can be compared against 2 or more right columns, so the
 * values of `selectColumns` are arrays. All of these columns will be included in the result, aliased by
 * table id.
 * @param {Map<string, string>} joinColumns Map of right table column ids to their matching equivalent
 * from the left table. These columns are used to join `leftTableId` to `rightTableId`.
 * @returns {ExpandedQuery} The constructed query.
 */
export function buildComparisonQuery(leftTableId: string, rightTableId: string, selectColumns: Map<string, string[]>,
                                     joinColumns: Map<string, string>): ExpandedQuery {
  const query: ExpandedQuery = { tableId: leftTableId, filters: {} };

  // Start accumulating the JOINS, SELECTS and WHERES needed for the query.
  const joins: string[] = [];
  const selects: string[] = [];
  const wheres: string[] = [];

  // Include the 'id' column from both tables.
  selects.push(
    `${quoteIdent(leftTableId)}.id AS ${quoteIdent(leftTableId + '.id')}`,
    `${quoteIdent(rightTableId)}.id AS ${quoteIdent(rightTableId + '.id')}`
  );

  // Select columns from both tables, using the table id as a prefix for each column name.
  selectColumns.forEach((rightTableColumns, leftTableColumn) => {
    const leftColumnAlias = `${leftTableId}.${leftTableColumn}`;
    selects.push(`${quoteIdent(leftTableId)}.${quoteIdent(leftTableColumn)} AS ${quoteIdent(leftColumnAlias)}`);

    rightTableColumns.forEach(colId => {
      const rightColumnAlias = `${rightTableId}.${colId}`;
      selects.push(`${quoteIdent(rightTableId)}.${quoteIdent(colId)} AS ${quoteIdent(rightColumnAlias)}`
      );
    });
  });

  /**
   * Performance can suffer when large (right) tables have many duplicates for their join columns.
   * Specifically, the number of rows returned by the query can be unreasonably large if each
   * row from the left table is joined against up to N rows from the right table.
   *
   * To work around this, we de-duplicate the right table before joining, returning the first row id
   * we find for a given group of join column values. In practice, this means that each row from
   * the left table can only be matched with at most 1 equivalent row from the right table.
   */
  const dedupedRightTableQuery =
    `SELECT MIN(id) AS id, ${[...joinColumns.keys()].map(v => quoteIdent(v)).join(', ')} ` +
    `FROM ${quoteIdent(rightTableId)} ` +
    `GROUP BY ${[...joinColumns.keys()].map(v => quoteIdent(v)).join(', ')}`;
  const dedupedRightTableAlias = quoteIdent('deduped_' + rightTableId);

  // Join the left table to the (de-duplicated) right table, and include unmatched left rows.
  const joinConditions: string[] = [];
  joinColumns.forEach((leftTableColumn, rightTableColumn) => {
    const leftExpression = `${quoteIdent(leftTableId)}.${quoteIdent(leftTableColumn)}`;
    const rightExpression = `${dedupedRightTableAlias}.${quoteIdent(rightTableColumn)}`;
    joinConditions.push(`${leftExpression} = ${rightExpression}`);
  });
  joins.push(
    `LEFT JOIN (${dedupedRightTableQuery}) AS ${dedupedRightTableAlias} ` +
    `ON ${joinConditions.join(' AND ')}`);

  // Finally, join the de-duplicated right table to the original right table to get all its columns.
  joins.push(
    `LEFT JOIN ${quoteIdent(rightTableId)} ` +
    `ON ${dedupedRightTableAlias}.id = ${quoteIdent(rightTableId)}.id`);

  // Filter out matching rows where all non-join columns from both tables are identical.
  const whereConditions: string[] = [];
  for (const [leftTableColumnId, rightTableColumnIds] of selectColumns.entries()) {
    const leftColumnAlias = quoteIdent(`${leftTableId}.${leftTableColumnId}`);

    for (const rightTableColId of rightTableColumnIds) {
      // If this left/right column id pair was already used for joining, skip it.
      if (joinColumns.get(rightTableColId) === leftTableColumnId) { continue; }

      // Only include rows that have differences in column values.
      const rightColumnAlias = quoteIdent(`${rightTableId}.${rightTableColId}`);
      whereConditions.push(`${leftColumnAlias} IS NOT ${rightColumnAlias}`);
    }
  }
  if (whereConditions.length > 0) {
    wheres.push(`(${whereConditions.join(' OR ')})`);
  }

  // Copy decisions to the query object, and return.
  query.joins = joins;
  query.selects = selects;
  query.wheres = wheres;
  return query;
}
