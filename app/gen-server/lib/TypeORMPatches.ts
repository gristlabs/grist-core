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
import {delay} from 'app/common/delay';
import log from 'app/server/lib/log';
import {Mutex, MutexInterface} from 'async-mutex';
import isEqual = require('lodash/isEqual');
import {EntityManager, QueryRunner} from 'typeorm';
import {SqliteDriver} from 'typeorm/driver/sqlite/SqliteDriver';
import {SqliteQueryRunner} from 'typeorm/driver/sqlite/SqliteQueryRunner';
import {
  QueryRunnerProviderAlreadyReleasedError
} from 'typeorm/error/QueryRunnerProviderAlreadyReleasedError';
import {QueryBuilder} from 'typeorm/query-builder/QueryBuilder';

// Print a warning for transactions that take longer than this.
const SLOW_TRANSACTION_MS = 5000;

/**********************
 * Patch 1
 **********************/

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
  EntityManager.prototype.transaction = async function <T>(arg1: any,  arg2?: any): Promise<T> {
    if (this.queryRunner && this.queryRunner.isReleased) {
      throw new QueryRunnerProviderAlreadyReleasedError();
    }
    if (this.queryRunner && this.queryRunner.isTransactionActive) {
      throw new Error(`Cannot start transaction because its already started`);
    }
    const queryRunner = this.connection.createQueryRunner();
    const runInTransaction = typeof arg1 === "function" ? arg1 : arg2;
    const isSqlite = this.connection.driver.options.type === 'sqlite';
    try {
      async function runOrRollback() {
        try {
          await queryRunner.startTransaction();

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
          log.debug(`TypeORM transaction error [${arg1} ${arg2}] - ${err}`);
          try {
            // we throw original error even if rollback thrown an error
            await queryRunner.rollbackTransaction();
            // tslint: disable-next-line
          } catch (rollbackError) {
            // tslint: disable-next-line
          }
          throw err;
        }
      }
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


/**********************
 * Patch 2
 **********************/

abstract class QueryBuilderPatched<T> extends QueryBuilder<T> {
  public setParameter(key: string, value: any): this {
    const prev = this.expressionMap.parameters[key];
    if (prev !== undefined && !isEqual(prev, value)) {
      throw new Error(`TypeORM parameter collision for key '${key}' ('${prev}' vs '${value}')`);
    }
    this.expressionMap.parameters[key] = value;
    return this;
  }
}

(QueryBuilder.prototype as any).setParameter = (QueryBuilderPatched.prototype as any).setParameter;
