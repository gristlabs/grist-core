// This contains two TypeORM patches.

// Patch 1:
// TypeORM Sqlite driver does not support using transactions in async code, if it is possible
// for two transactions to get called (one of the whole point of transactions).  This
// patch adds support for that, based on a monkey patch published in:
//   https://gist.github.com/aigoncharov/556f8c61d752eff730841170cd2bc3f1
// Explanation at https://github.com/typeorm/typeorm/issues/1884#issuecomment-380767213

// Patch 2:
// TypeORM parameters are global, and collisions in setting them are not detected.
// We add a patch to throw an exception if a parameter value is ever set and then
// changed during construction of a query.

import * as sqlite3 from '@gristlabs/sqlite3';
import {ApiError} from 'app/common/ApiError';
import {delay} from 'app/common/delay';
import log from 'app/server/lib/log';
import {Mutex, MutexInterface} from 'async-mutex';
import isEqual = require('lodash/isEqual');
import {EntityManager, QueryRunner, TypeORMError} from 'typeorm';
import {PostgresDriver} from 'typeorm/driver/postgres/PostgresDriver';
import {PostgresQueryRunner} from 'typeorm/driver/postgres/PostgresQueryRunner';
import {SqliteDriver} from 'typeorm/driver/sqlite/SqliteDriver';
import {SqliteQueryRunner} from 'typeorm/driver/sqlite/SqliteQueryRunner';
import {IsolationLevel} from 'typeorm/driver/types/IsolationLevel';
import {
  QueryRunnerProviderAlreadyReleasedError
} from 'typeorm/error/QueryRunnerProviderAlreadyReleasedError';
import {QueryBuilder} from 'typeorm/query-builder/QueryBuilder';

// Print a warning for transactions that take longer than this.
const SLOW_TRANSACTION_MS = 5000;

/*************************************************************
 * Patch 1
 * Make transactions work with SQLite.
 *************************************************************/

// A singleton mutex for all sqlite transactions.
const mutex = new Mutex();

class SqliteQueryRunnerPatched extends SqliteQueryRunner {
  private _releaseMutex: MutexInterface.Releaser | null;

  public async startTransaction(level?: any): Promise<void> {
    this._releaseMutex = await mutex.acquire();
    return super.startTransaction(level);
  }

  public async commitTransaction(): Promise<void> {
    if (!this._releaseMutex) {
      throw new Error('SqliteQueryRunnerPatched.commitTransaction -> mutex releaser unknown');
    }
    await super.commitTransaction();
    this._releaseMutex();
    this._releaseMutex = null;
  }

  public async rollbackTransaction(): Promise<void> {
    if (!this._releaseMutex) {
      throw new Error('SqliteQueryRunnerPatched.rollbackTransaction -> mutex releaser unknown');
    }
    await super.rollbackTransaction();
    this._releaseMutex();
    this._releaseMutex = null;
  }

  public async connect(): Promise<any> {
    if (!this.isTransactionActive) {
      const release = await mutex.acquire();
      release();
    }
    return super.connect();
  }
}

class SqliteDriverPatched extends SqliteDriver {
  public createQueryRunner(): QueryRunner {
    if (!this.queryRunner) {
      this.queryRunner = new SqliteQueryRunnerPatched(this);
    }
    return this.queryRunner;
  }
  protected loadDependencies(): void {
    // Use our own sqlite3 module, which is a fork of the original.
    this.sqlite = sqlite3;
  }
}

// Patch the underlying SqliteDriver, since it's impossible to convince typeorm to use only our
// patched classes. (Previously we patched DriverFactory and Connection, but those would still
// create an unpatched SqliteDriver and then overwrite it.)
SqliteDriver.prototype.createQueryRunner = SqliteDriverPatched.prototype.createQueryRunner;
(SqliteDriver.prototype as any).loadDependencies = (SqliteDriverPatched.prototype as any).loadDependencies;

export function applyPatch() {
  // tslint: disable-next-line
  EntityManager.prototype.transaction = async function<T>(
      arg1: IsolationLevel | ((entityManager: EntityManager) => Promise<T>),
      arg2?: (entityManager: EntityManager) => Promise<T>): Promise<T>
    {
    const isolation =
      typeof arg1 === "string"
        ? arg1
        : undefined;
    const runInTransaction =
      typeof arg1 === "function"
        ? arg1
        : arg2;

    if (!runInTransaction) {
      throw new TypeORMError(
        `Transaction method requires callback in second parameter if isolation level is supplied.`,
      );
    }

    if (this.queryRunner && this.queryRunner.isReleased) {
      throw new QueryRunnerProviderAlreadyReleasedError();
    }
    const queryRunner = this.queryRunner || this.connection.createQueryRunner();
    const isSqlite = this.connection.driver.options.type === 'sqlite';
    try {
      const runOrRollback = async () => {
        try {
          await queryRunner.startTransaction(isolation);

          const start = Date.now();

          const timer = setInterval(() => {
            const timeMs = Date.now() - start;
            log.warn(`TypeORM transaction slow: [${arg1} ${arg2}]`, {timeMs});
          }, SLOW_TRANSACTION_MS);

          try {
            const result = await runInTransaction(queryRunner.manager);
            await queryRunner.commitTransaction();
            return result;
          } finally {
            clearInterval(timer);
          }
        } catch (err) {
          if (!(err instanceof ApiError)) {
            // Log with a stack trace in case of unexpected DB problems. Don't bother logging for
            // errors (like ApiError) that clearly come from our own code.
            log.debug('TypeORM transaction error', err);
          }
          try {
            // we throw original error even if rollback thrown an error
            await queryRunner.rollbackTransaction();
            // tslint: disable-next-line
          } catch (rollbackError) {
            // tslint: disable-next-line
          }
          throw err;
        }
      };
      if (isSqlite) {
        return await callWithRetry(runOrRollback, {
          // Transactions may fail immediately if there are connections from
          // multiple processes, regardless of busy_timeout setting. Add a
          // retry for this kind of failure. This is relevant to tests, which
          // use connections from multiple processes, but not to single-process
          // instances of Grist, or instances of Grist that use Postgres for the
          // home server.
          worthRetry: (e) => Boolean(e.message.match(/SQLITE_BUSY/)),
          firstDelayMsec: 10,
          factor: 1.25,
          maxTotalMsec: 3000,
        });
      } else {
        // When not using SQLite, don't do anything special.
        return await runOrRollback();
      }
    } finally {
      await queryRunner.release();
    }
  };
}

/**
 * Call an operation, and if it fails with an error that is worth retrying
 * (or any error if worthRetry callback is not specified), retry it after
 * a delay of firstDelayMsec. Retries are repeated with delays growing by
 * the specified factor (or 2.0 if not specified). Stop if maxTotalMsec is
 * specified and has passed.
 */
async function callWithRetry<T>(op: () => Promise<T>, options: {
  worthRetry?: (err: Error) => boolean,
  maxTotalMsec?: number,
  firstDelayMsec: number,
  factor?: number,
}): Promise<T> {
  const startedAt = Date.now();
  let dt = options.firstDelayMsec;
  while (true) {  // eslint-disable-line no-constant-condition
    try {
      return await op();
    } catch (e) {
      // throw if not worth retrying
      if (options.worthRetry && e instanceof Error && !options.worthRetry(e)) {
        throw e;
      }
      // throw if max time has expired
      if (options.maxTotalMsec && Date.now() - startedAt > options.maxTotalMsec) {
        throw e;
      }
      // otherwise wait a bit and retry
      await delay(dt);
      dt *= options.factor ?? 2.0;
    }
  }
}


/*************************************************************
 * Patch 2
 * Watch out for parameter collisions, shout loudly if they
 * happen.
 *************************************************************/

// Augment the interface globally
declare module 'typeorm/query-builder/QueryBuilder' {
  interface QueryBuilder<Entity> {
    chain<Q extends QueryBuilder<Entity>>(this: Q, callback: (qb: Q) => Q): Q
  }
}

abstract class QueryBuilderPatched<T> extends QueryBuilder<T> {
  private static _origSetParameter = QueryBuilder.prototype.setParameter;
  public setParameter(key: string, value: any): this {
    const prev = this.expressionMap.parameters[key];
    if (prev !== undefined && !isEqual(prev, value)) {
      throw new Error(`TypeORM parameter collision for key '${key}' ('${prev}' vs '${value}')`);
    }
    QueryBuilderPatched._origSetParameter.call(this, key, value);
    return this;
  }

  /**
   * A very simple helper to neater code organization. For instance, instead of
   *    qb = myFunc(qb.foo().bar());
   * You can do
   *    qb = qb.foo().bar().chain(myFunc).baz();
   * This way the order in which myFunc is applied is clearer.
   */
  public chain<Q extends QueryBuilder<T>>(this: Q, callback: (qb: Q) => Q): Q {
    return callback(this);
  }
}

(QueryBuilder.prototype as any).setParameter = (QueryBuilderPatched.prototype as any).setParameter;
(QueryBuilder.prototype as any).chain = (QueryBuilderPatched.prototype as any).chain;


/*************************************************************
 * Patch 3
 * Allow use of PREPAREd statements with Postgres.
 *************************************************************/

const preparedSqlToName = new Map<string, string>();
const preparedNameToSql = new Map<string, string>();
const usedNames = new Set<string>();

/**
 * Return true if a query is worth preparing. This would probably
 * be best judged by hand, but there's not much downside to
 * preparing any longish queries, as long as we don't end up with
 * too many of them. That could happen if queries contain embedded
 * parameters in their text.
 */
function worthPreparing(sql: string) {
  return sql.length > 120;
}

/**
 * Give a label to a query. We can't call PREPARE directly, or
 * pass statement names through TypeORM, so we have to do some
 * hijinks.
 */
export function setPreparedStatement(name: string, sql: string) {
  if (preparedNameToSql.has(name)) { return; }
  preparedSqlToName.set(sql, name);
  preparedNameToSql.set(name, sql);
}

/**
 * If a query looks to be worth preparing and we haven't already,
 * plan on doing so.
 */
export function maybePrepareStatement(sql: string) {
  if (worthPreparing(sql) && !preparedSqlToName.has(sql)) {
    const key = pickStatementName(sql);
    setPreparedStatement(key, sql);
  }
}

const prefixCounts = new Map<string, number>();

/**
 * Pick a name for a statement.
 */
export function pickStatementName(query: string): string {
  const prefix = query.toLowerCase().replace(/["']/g, '').replace(/[^a-z0-9]/g, '_').slice(0, 16);
  const count = (prefixCounts.get(prefix) || 0) + 1;
  prefixCounts.set(prefix, count);
  return `prep_${prefix}_${count}`;
}

/**
 * A test function for checking how many statements are getting
 * prepared and if they are properly used.
 */
export function testGetPreparedStatementCount() {
  return {
    preparedCount: preparedNameToSql.size,
    usedCount: usedNames.size,
  };
}

/**
 * Reset bookwork for tracking prepared statements.
 */
export function testResetPreparedStatements() {
  preparedSqlToName.clear();
  preparedNameToSql.clear();
  usedNames.clear();
}

/**
 * Patch typeorm postgres driver to use pg library "name"
 * feature for recognized queries.
 */
export class PostgresQueryRunnerPatched extends PostgresQueryRunner {
  public async connect() {
    const result = await super.connect();
    const client = this.databaseConnection;
    if (!client._preparedWrapped) {
      const originalQuery = client.query.bind(client);
      client.query = async (text: any, values?: any[]) => {
        if (typeof text === "string" && worthPreparing(text) && preparedSqlToName.size) {
          const name = preparedSqlToName.get(text);
          if (name) {
            if (!usedNames.has(name)) {
              usedNames.add(name);
              log.rawDebug(`used a new prepared statement`, {
                name,
                usedCount: usedNames.size,
                preparedCount: preparedNameToSql.size,
              });
            }
            return originalQuery({
              name, text, values
            });
          }
        }
        return originalQuery(text, values);
      };
      client._preparedWrapped = true;
    }
    return result;
  }
}

export class PostgresDriverPatched extends PostgresDriver {
  public createQueryRunner(mode: 'master' | 'slave'): PostgresQueryRunner {
    return new PostgresQueryRunnerPatched(this, mode);
  }
}

PostgresDriver.prototype.createQueryRunner = PostgresDriverPatched.prototype.createQueryRunner;
