// This contains two TypeORM patches.

// Patch 1:
// TypeORM Sqlite driver does not support using transactions in async code, if it is possible
// for two transactions to get called (one of the whole point of transactions).  This
// patch adds support for that, based on a monkey patch published in:
//   https://gist.github.com/keenondrums/556f8c61d752eff730841170cd2bc3f1
// Explanation at https://github.com/typeorm/typeorm/issues/1884#issuecomment-380767213

// Patch 2:
// TypeORM parameters are global, and collisions in setting them are not detected.
// We add a patch to throw an exception if a parameter value is ever set and then
// changed during construction of a query.

import * as sqlite3 from '@gristlabs/sqlite3';
import isEqual = require('lodash/isEqual');
import {EntityManager, QueryRunner} from 'typeorm';
import {SqliteDriver} from 'typeorm/driver/sqlite/SqliteDriver';
import {SqliteQueryRunner} from 'typeorm/driver/sqlite/SqliteQueryRunner';
import {
  QueryRunnerProviderAlreadyReleasedError
} from 'typeorm/error/QueryRunnerProviderAlreadyReleasedError';
import {QueryBuilder} from 'typeorm/query-builder/QueryBuilder';


/**********************
 * Patch 1
 **********************/

type Releaser = () => void;
type Worker<T> = () => Promise<T>|T;

interface MutexInterface {
  acquire(): Promise<Releaser>;
  runExclusive<T>(callback: Worker<T>): Promise<T>;
  isLocked(): boolean;
}

class Mutex implements MutexInterface {
  private _queue: Array<(release: Releaser) => void> = [];
  private _pending = false;

  public isLocked(): boolean {
    return this._pending;
  }

  public acquire(): Promise<Releaser> {
    const ticket = new Promise<Releaser>(resolve => this._queue.push(resolve));
    if (!this._pending) {
      this._dispatchNext();
    }
    return ticket;
  }

  public runExclusive<T>(callback: Worker<T>): Promise<T> {
    return this
      .acquire()
      .then(release => {
        let result: T|Promise<T>;

        try {
          result = callback();
        } catch (e) {
          release();
          throw(e);
        }

        return Promise
          .resolve(result)
          .then(
            (x: T) => (release(), x),
            e => {
              release();
              throw e;
            }
          );
      }
           );
  }

  private _dispatchNext(): void {
    if (this._queue.length > 0) {
      this._pending = true;
      this._queue.shift()!(this._dispatchNext.bind(this));
    } else {
      this._pending = false;
    }
  }

}

// A singleton mutex for all sqlite transactions.
const mutex = new Mutex();

class SqliteQueryRunnerPatched extends SqliteQueryRunner {
  private _releaseMutex: Releaser | null;

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
    try {
      await queryRunner.startTransaction();
      const result = await runInTransaction(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      try {
        // we throw original error even if rollback thrown an error
        await queryRunner.rollbackTransaction();
        // tslint: disable-next-line
      } catch (rollbackError) {
        // tslint: disable-next-line
      }
      throw err;
    } finally {
      await queryRunner.release();
    }
  };
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
