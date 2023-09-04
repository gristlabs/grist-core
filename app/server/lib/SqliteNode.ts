import * as sqlite3 from '@gristlabs/sqlite3';
import { fromCallback } from 'app/server/lib/serverUtils';
import { MinDB, MinDBOptions, PreparedStatement, ResultRow, SqliteVariant } from 'app/server/lib/SqliteCommon';
import { OpenMode, RunResult } from 'app/server/lib/SQLiteDB';

export class NodeSqliteVariant implements SqliteVariant {
  public opener(dbPath: string, mode: OpenMode): Promise<MinDB> {
    return NodeSqlite3DatabaseAdapter.opener(dbPath, mode);
  }
}

export class NodeSqlite3PreparedStatement implements PreparedStatement {
  public constructor(private _statement: sqlite3.Statement) {
  }

  public async run(...params: any[]): Promise<RunResult> {
    return fromCallback(cb => this._statement.run(...params, cb));
  }

  public async finalize() {
    await fromCallback(cb => this._statement.finalize(cb));
  }

  public columns(): string[] {
    // This method is only needed if marshalling is not built in -
    // and node-sqlite3 has marshalling built in.
    throw new Error('not available (but should not be needed)');
  }
}

export class NodeSqlite3DatabaseAdapter implements MinDB {
  public static async opener(dbPath: string, mode: OpenMode): Promise<any> {
    const sqliteMode: number =
      // tslint:disable-next-line:no-bitwise
      (mode === OpenMode.OPEN_READONLY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE) |
      (mode === OpenMode.OPEN_CREATE || mode === OpenMode.CREATE_EXCL ? sqlite3.OPEN_CREATE : 0);
    let _db: sqlite3.Database;
    await fromCallback(cb => { _db = new sqlite3.Database(dbPath, sqliteMode, cb); });
    const result = new NodeSqlite3DatabaseAdapter(_db!);
    await result.limitAttach(0);  // Outside of VACUUM, we don't allow ATTACH.
    return result;
  }

  public constructor(protected _db: sqlite3.Database) {
    // Default database to serialized execution. See https://github.com/mapbox/node-sqlite3/wiki/Control-Flow
    // This isn't enough for transactions, which we serialize explicitly.
    this._db.serialize();
  }

  public async exec(sql: string): Promise<void> {
    return fromCallback(cb => this._db.exec(sql, cb));
  }

  public async run(sql: string, ...params: any[]): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      function callback(this: RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve(this);
        }
      }
      this._db.run(sql, ...params, callback);
    });
  }

  public async get(sql: string, ...params: any[]): Promise<ResultRow|undefined> {
    return fromCallback(cb => this._db.get(sql, ...params, cb));
  }

  public async all(sql: string, ...params: any[]): Promise<ResultRow[]> {
    return fromCallback(cb => this._db.all(sql, params, cb));
  }

  public async prepare(sql: string): Promise<PreparedStatement> {
    let stmt: sqlite3.Statement|undefined;
    // The original interface is a little strange; we resolve to Statement if prepare() succeeded.
    await fromCallback(cb => { stmt = this._db.prepare(sql, cb); }).then(() => stmt);
    if (!stmt) { throw new Error('could not prepare statement'); }
    return new NodeSqlite3PreparedStatement(stmt);
  }

  public async close() {
    this._db.close();
  }

  public async interrupt(): Promise<void> {
    this._db.interrupt();
  }

  public getOptions(): MinDBOptions {
    return {
      canInterrupt: true,
      bindableMethodsProcessOneStatement: true,
    };
  }

  public async allMarshal(sql: string, ...params: any[]): Promise<Buffer> {
    // allMarshal isn't in the typings, because it is our addition to our fork of sqlite3 JS lib.
    return fromCallback(cb => (this._db as any).allMarshal(sql, ...params, cb));

  }

  public async runAndGetId(sql: string, ...params: any[]): Promise<number> {
    const result = await this.run(sql, ...params);
    return (result as any).lastID;
  }

  public async limitAttach(maxAttach: number) {
    const SQLITE_LIMIT_ATTACHED = (sqlite3 as any).LIMIT_ATTACHED;
    // Cast because types out of date.
    (this._db as any).configure('limit', SQLITE_LIMIT_ATTACHED, maxAttach);
  }
}

