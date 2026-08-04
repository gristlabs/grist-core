/**
 * SQLite adapter using Node.js built-in node:sqlite module (available from Node 22.5+).
 *
 * Each database connection runs in a dedicated Worker thread, so SQLite's
 * synchronous operations don't block the main event loop. One worker per
 * Grist document matches the existing one-connection-per-DocStorage model.
 *
 * The worker script is SqliteNativeWorker.ts, which owns the DatabaseSync
 * and handles all SQLite operations. This file is the main-thread adapter
 * that implements MinDB by sending messages to the worker.
 *
 * Status: prototype. Requires Node 22.5+ with --experimental-sqlite flag,
 * or Node 25.7+ where it is stable.
 *
 * Known limitations vs @gristlabs/sqlite3:
 *  - No interrupt() support (node:sqlite doesn't expose sqlite3_interrupt)
 *  - Backup uses node:sqlite's single-call async backup()
 *  - Structured clone overhead for parameters and results crossing the
 *    thread boundary (Buffers are transferred zero-copy)
 */

import * as fs from "fs";
import * as path from "path";
import { Worker } from "worker_threads";

import { OpenMode } from "app/server/lib/SQLiteDB";
import {
  MinDB,
  MinDBOptions,
  MinRunResult,
  PreparedStatement,
  ResultRow,
  SqliteVariant,
} from "app/server/lib/SqliteCommon";

/**
 * Resolves the path to the compiled worker script.
 * In development the source is in app/server/lib/ but the compiled JS
 * is in _build/app/server/lib/.
 */
function getWorkerPath(): string {
  // __dirname at runtime is _build/app/server/lib (compiled output).
  return path.join(__dirname, 'SqliteNativeWorker.js');
}


export class NativeSqliteVariant implements SqliteVariant {
  public opener(dbPath: string, mode: OpenMode): Promise<MinDB> {
    return NativeSqliteDatabaseAdapter.opener(dbPath, mode);
  }
}


export class NativeSqliteDatabaseAdapter implements MinDB {
  private _worker: Worker;
  private _nextId = 1;
  private _pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private _closed = false;

  public static async opener(dbPath: string, mode: OpenMode): Promise<MinDB> {
    const readOnly = mode === OpenMode.OPEN_READONLY;

    // node:sqlite doesn't have a fileMustExist option. For OPEN_EXISTING
    // (readwrite but no create), check existence manually.
    if (mode === OpenMode.OPEN_EXISTING) {
      if (!fs.existsSync(dbPath)) {
        const err: any = new Error(`SQLITE_CANTOPEN: unable to open database file`);
        err.code = 'SQLITE_CANTOPEN';
        throw err;
      }
    }

    const adapter = new NativeSqliteDatabaseAdapter();
    await adapter._call('open', dbPath, readOnly);
    return adapter;
  }

  private constructor() {
    this._worker = new Worker(getWorkerPath());
    this._worker.on('message', (msg: { id: number; result?: any; error?: { message: string; code?: string } }) => {
      const pending = this._pending.get(msg.id);
      if (!pending) { return; }
      this._pending.delete(msg.id);
      if (msg.error) {
        const err: any = new Error(msg.error.message);
        if (msg.error.code) { err.code = msg.error.code; }
        pending.reject(err);
      } else {
        pending.resolve(msg.result);
      }
    });
    this._worker.on('error', (err) => {
      this._closed = true;
      for (const pending of this._pending.values()) {
        pending.reject(err);
      }
      this._pending.clear();
    });
    this._worker.on('exit', (code) => {
      this._closed = true;
      if (this._pending.size > 0) {
        const err = new Error(`Worker exited with code ${code}`);
        for (const pending of this._pending.values()) {
          pending.reject(err);
        }
        this._pending.clear();
      }
    });
  }

  /**
   * Send a method call to the worker and return a promise for the result.
   */
  private _call(method: string, ...args: any[]): Promise<any> {
    if (this._closed && method !== 'close') {
      return Promise.reject(new Error('Database is closed'));
    }
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      this._pending.set(id, { resolve, reject });
      this._worker.postMessage({ id, method, args });
    });
  }

  /**
   * Structured clone across the worker boundary converts Buffer to Uint8Array.
   * Convert back so callers get the Buffer methods they expect (e.g. toString('utf8')).
   */
  private _fixRow(row: any): any {
    if (!row) { return row; }
    for (const key of Object.keys(row)) {
      if (row[key] instanceof Uint8Array && !Buffer.isBuffer(row[key])) {
        row[key] = Buffer.from(row[key]);
      }
    }
    return row;
  }

  public async exec(sql: string): Promise<void> {
    await this._call('exec', sql);
  }

  public async run(sql: string, ...params: any[]): Promise<MinRunResult> {
    return this._call('run', sql, ...params);
  }

  public async get(sql: string, ...params: any[]): Promise<ResultRow | undefined> {
    const row = await this._call('get', sql, ...params);
    return this._fixRow(row);
  }

  public async all(sql: string, ...params: any[]): Promise<ResultRow[]> {
    const rows = await this._call('all', sql, ...params);
    return rows.map((r: any) => this._fixRow(r));
  }

  public async prepare(sql: string): Promise<PreparedStatement> {
    const { stmtId, columns } = await this._call('stmtPrepare', sql);
    return new WorkerPreparedStatement(
      (method: string, ...args: any[]) => this._call(method, ...args),
      stmtId, columns,
    );
  }

  public async runAndGetId(sql: string, ...params: any[]): Promise<number> {
    return this._call('runAndGetId', sql, ...params);
  }

  public async allMarshal(sql: string, ...params: any[]): Promise<Buffer> {
    // Dispatched to the worker as a single call (not via allMarshalQuery)
    // so the result Buffer can be transferred zero-copy.
    const result = await this._call('allMarshal', sql, ...params);
    return Buffer.isBuffer(result) ? result : Buffer.from(result);
  }

  public async close(): Promise<void> {
    this._closed = true;
    await this._call('close');
    await this._worker.terminate();
  }

  public async limitAttach(maxAttach: number): Promise<void> {
    await this._call('limitAttach', maxAttach);
  }

  // node:sqlite does not expose sqlite3_interrupt().
  // interrupt is optional in MinDB, so we simply don't provide it.

  public getOptions(): MinDBOptions {
    return {
      canInterrupt: false,
      bindableMethodsProcessOneStatement: true,
    };
  }

  /**
   * Perform a backup using node:sqlite's built-in backup() function.
   */
  public async backupTo(
    destPath: string,
    options?: { rate?: number }
  ): Promise<void> {
    await this._call('backupTo', destPath, options?.rate);
  }

}


class WorkerPreparedStatement implements PreparedStatement {
  constructor(
    private _call: (method: string, ...args: any[]) => Promise<any>,
    private _stmtId: number,
    private _columns: string[],
  ) {}

  public async run(...params: any[]): Promise<MinRunResult> {
    return this._call('stmtRun', this._stmtId, ...params);
  }

  public async finalize(): Promise<void> {
    await this._call('stmtFinalize', this._stmtId);
  }

  public columns(): string[] {
    return this._columns;
  }
}
