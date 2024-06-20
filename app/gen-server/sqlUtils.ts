import {DatabaseType, QueryRunner, SelectQueryBuilder} from 'typeorm';
import {RelationCountLoader} from 'typeorm/query-builder/relation-count/RelationCountLoader';
import {RelationIdLoader} from 'typeorm/query-builder/relation-id/RelationIdLoader';
import {RawSqlResultsToEntityTransformer} from "typeorm/query-builder/transformer/RawSqlResultsToEntityTransformer";

/**
 *
 * Generates an expression to simulate postgres's bit_or
 * aggregate function in sqlite.  The expression is verbose,
 * and has a term for each bit in the permission bitmap,
 * but this seems ok since sqlite is only used in the dev
 * environment.
 * @param column: the sql column to aggregate
 * @param bits: the maximum number of bits to consider
 *
 */
export function sqliteBitOr(column: string, bits: number): string {
  const parts: string[] = [];
  let mask: number = 1;
  for (let b = 0; b < bits; b++) {
    parts.push(`((sum(${column}&${mask})>0)<<${b})`);
    mask *= 2;
  }
  return `(${parts.join('+')})`;
}

/**
 * Generates an expression to aggregate the named column
 * by taking the bitwise-or of all the values it takes on.
 * @param dbType: the type of database (sqlite and postgres are supported)
 * @param column: the sql column to aggregate
 * @param bits: the maximum number of bits to consider (used for sqlite variant)
 */
export function bitOr(dbType: DatabaseType, column: string, bits: number): string {
  switch (dbType) {
    case 'postgres':
      return `bit_or(${column})`;
    case 'sqlite':
      return sqliteBitOr(column, bits);
    default:
      throw new Error(`bitOr not implemented for ${dbType}`);
  }
}


/**
 * Checks if a set of columns contains only the given ids (or null).
 * Uses array containment operator on postgres (with array_remove to deal with nulls),
 * and a clunkier syntax for sqlite.
 */
export function hasOnlyTheseIdsOrNull(dbType: DatabaseType, ids: number[], columns: string[]): string {
  switch (dbType) {
    case 'postgres':
      return `array[${ids.join(',')}] @> array_remove(array[${columns.join(',')}],null)`;
    case 'sqlite':
      return columns.map(col => `coalesce(${col} in (${ids.join(',')}), true)`).join(' AND ');
    default:
      throw new Error(`hasOnlyTheseIdsOrNull not implemented for ${dbType}`);
  }
}

/**
 * Checks if at least one of a set of ids is present in a set of columns.
 * There must be at least one id and one column.
 * Uses the intersection operator on postgres, and a clunkier syntax for sqlite.
 */
export function hasAtLeastOneOfTheseIds(dbType: DatabaseType, ids: number[], columns: string[]): string {
  switch (dbType) {
    case 'postgres':
      return `array[${ids.join(',')}] && array[${columns.join(',')}]`;
    case 'sqlite':
      return ids.map(id => `${id} in (${columns.join(',')})`).join(' OR ');
    default:
      throw new Error(`hasAtLeastOneOfTheseIds not implemented for ${dbType}`);
  }
}

/**
 * Convert a json value returned by the database into a javascript
 * object.  For postgres, the value is already unpacked, but for sqlite
 * it is a string.
 */
export function readJson(dbType: DatabaseType, selection: any) {
  switch (dbType) {
    case 'postgres':
      return selection;
    case 'sqlite':
      return JSON.parse(selection);
    default:
      throw new Error(`readJson not implemented for ${dbType}`);
  }
}

export function now(dbType: DatabaseType) {
  switch (dbType) {
    case 'postgres':
      return 'now()';
    case 'sqlite':
      return "datetime('now')";
    default:
      throw new Error(`now not implemented for ${dbType}`);
  }
}

// Understands strings like: "-30 days" or "1 year"
export function fromNow(dbType: DatabaseType, relative: string) {
  switch (dbType) {
    case 'postgres':
      return `(now() + interval '${relative}')`;
    case 'sqlite':
      return `datetime('now','${relative}')`;
    default:
      throw new Error(`fromNow not implemented for ${dbType}`);
  }
}

export function datetime(dbType: DatabaseType) {
  switch (dbType) {
    case 'postgres':
      return 'timestamp with time zone';
    case 'sqlite':
      return "datetime";
    default:
      throw new Error(`now not implemented for ${dbType}`);
  }
}

/**
 *
 * Generate SQL code from one QueryBuilder, get the "raw" results, and then decode
 * them as entities using a different QueryBuilder.
 *
 * This is useful for example if we have a query Q and we wish to add
 * a where clause referring to one of the query's selected columns by
 * its alias.  This isn't supported by Postgres (since the SQL
 * standard says not to).  A simple solution is to wrap Q in a query
 * like "SELECT * FROM (Q) WHERE ...".  But if we do that in TypeORM,
 * it loses track of metadata and isn't able to decode the results,
 * even though nothing has changed structurally.  Hence this method.
 *
 * (An alternate solution to this scenario is to simply duplicate the
 * SQL code for the selected column in the where clause.  But our SQL
 * queries are getting awkwardly long.)
 *
 * The results are returned in the same format as SelectQueryBuilder's
 * getRawAndEntities.
 */
export async function getRawAndEntities<T>(rawQueryBuilder: SelectQueryBuilder<any>,
                                           nominalQueryBuilder: SelectQueryBuilder<T>): Promise<{
  entities: T[],
  raw: any[],
}> {
  const raw = await rawQueryBuilder.getRawMany();

  // The following code is based on SelectQueryBuilder's
  // executeEntitiesAndRawResults.  To extract and use it here, we
  // need to access the QueryBuilder's QueryRunner, which is
  // protected, so we break abstraction a little bit.
  const runnerSource = nominalQueryBuilder as any as QueryRunnerSource;
  const queryRunner = runnerSource.obtainQueryRunner();
  try {
    const expressionMap = nominalQueryBuilder.expressionMap;
    const connection = nominalQueryBuilder.connection;
    const relationIdLoader = new RelationIdLoader(connection, queryRunner, expressionMap.relationIdAttributes);
    const relationCountLoader = new RelationCountLoader(connection, queryRunner, expressionMap.relationCountAttributes);
    const rawRelationIdResults = await relationIdLoader.load(raw);
    const rawRelationCountResults = await relationCountLoader.load(raw);
    const transformer = new RawSqlResultsToEntityTransformer(expressionMap, connection.driver,
                                                             rawRelationIdResults, rawRelationCountResults,
                                                             queryRunner);
    const entities = transformer.transform(raw, expressionMap.mainAlias!);
    return {
      entities,
      raw,
    };
  } finally {
    // This is how the QueryBuilder <-> QueryRunner relationship is managed in TypeORM code.
    if (queryRunner !== runnerSource.queryRunner) {
      await queryRunner.release();
    }
  }
}

/**
 * QueryBuilders keep track of a runner that we need for getRawAndEntities,
 * but access is protected.  This interface declared the fields we expect.
 */
interface QueryRunnerSource {
  queryRunner: QueryRunner;
  obtainQueryRunner(): QueryRunner;
}
