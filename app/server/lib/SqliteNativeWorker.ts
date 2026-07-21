/**
 * Worker thread script for SqliteNative.
 *
 * Owns a DatabaseSync connection and processes requests from the main
 * thread via parentPort messages. One worker per Grist document.
 *
 * Message protocol:
 *   Main → Worker: { id, method, args }
 *   Worker → Main: { id, result } | { id, error: { message, code } }
 *
 * Special methods:
 *   open(dbPath, readOnly) — create DatabaseSync, register aggregate, set authorizer
 *   close() — close the database
 *   stmtPrepare(sql) — prepare a statement, return { stmtId, columns }
 *   stmtRun(stmtId, ...params) — run a prepared statement
 *   stmtFinalize(stmtId) — release a prepared statement
 *   limitAttach(maxAttach) — allow/deny ATTACH
 *   backupTo(destPath, rate) — backup via node:sqlite backup()
 *   exec, run, get, all, runAndGetId, allMarshal — standard MinDB methods
 */

import { parentPort } from "worker_threads";

const nodeSqlite: any = require("node:sqlite");
const { DatabaseSync: DatabaseSyncClass, constants: sqliteConstants, backup: sqliteBackup } = nodeSqlite;

// Loaded via require (not import) to work from the compiled _build directory.
// node:sqlite also uses require because @types/node doesn't include its types.
const { gristMarshal, fixParameters, quoteLiteral } = require("app/server/lib/SqliteCommon");
const { quoteIdent } = require("app/server/lib/SQLiteDB");

let db: any = null;
let attachAllowed = false;
let nextStmtId = 1;
const statements = new Map<number, any>();

/**
 * Map SQLite numeric error codes to string codes matching @gristlabs/sqlite3.
 */
const SQLITE_ERRCODE_MAP: Record<number, string> = {
  1: 'SQLITE_ERROR',
  5: 'SQLITE_BUSY',
  8: 'SQLITE_READONLY',
  9: 'SQLITE_INTERRUPT',
  14: 'SQLITE_CANTOPEN',
  19: 'SQLITE_CONSTRAINT',
  23: 'SQLITE_AUTH',
};

function translateError(e: any): { message: string; code?: string } {
  let code = e?.code;
  let message = e?.message || String(e);
  if (code === 'ERR_SQLITE_ERROR' && typeof e.errcode === 'number') {
    const sqliteCode = SQLITE_ERRCODE_MAP[e.errcode]
      || SQLITE_ERRCODE_MAP[e.errcode & 0xff]
      || `SQLITE_ERRCODE_${e.errcode}`;
    code = sqliteCode;
    if (!message.startsWith(sqliteCode)) {
      message = `${sqliteCode}: ${message}`;
    }
  }
  return { message, code };
}

/**
 * Handle a single request from the main thread.
 */
async function handleMessage(msg: { id: number; method: string; args: any[] }) {
  const { id, method, args } = msg;
  try {
    const result = await dispatch(method, args);
    // For Buffer results (allMarshal), transfer zero-copy when possible.
    // Large Buffers own their ArrayBuffer; small ones share Node's 8KB pool
    // and can't be transferred, so fall back to structured clone (cheap copy).
    if (Buffer.isBuffer(result) &&
        result.byteOffset === 0 && result.byteLength === result.buffer.byteLength) {
      parentPort!.postMessage({ id, result }, [result.buffer]);
    } else {
      parentPort!.postMessage({ id, result });
    }
  } catch (e) {
    parentPort!.postMessage({ id, error: translateError(e) });
  }
}

async function dispatch(method: string, args: any[]): Promise<any> {
  switch (method) {
    case 'open': {
      const [dbPath, readOnly] = args;
      db = new DatabaseSyncClass(dbPath, { readOnly });
      // Register grist_marshal aggregate.
      db.aggregate('grist_marshal', {
        varargs: true,
        start: gristMarshal.initialize,
        step: gristMarshal.step,
        result: (accum: any) => Buffer.from(gristMarshal.finalize(accum)),
      });
      // Block ATTACH by default.
      db.setAuthorizer((actionCode: number) => {
        if (actionCode === sqliteConstants.SQLITE_ATTACH && !attachAllowed) {
          return sqliteConstants.SQLITE_DENY;
        }
        return sqliteConstants.SQLITE_OK;
      });
      return;
    }

    case 'close':
      statements.clear();
      if (db) { db.close(); db = null; }
      return;

    case 'exec':
      db.exec(args[0]);
      return;

    // Note: run/get/all each call db.prepare() inline without explicit finalization.
    // This is fine — node:sqlite's DatabaseSync prepared statements are lightweight
    // synchronous objects that are GC'd automatically (same as better-sqlite3).
    // The stmtPrepare/stmtFinalize path exists for callers that need to reuse a
    // statement across multiple calls, not because finalization is required.

    case 'run': {
      const [sql, ...params] = args;
      const stmt = db.prepare(sql);
      const result = stmt.run(...fixParameters(params));
      return { changes: Number(result.changes) };
    }

    case 'get': {
      const [sql, ...params] = args;
      const stmt = db.prepare(sql);
      return stmt.get(...fixParameters(params)) ?? undefined;
    }

    case 'all': {
      const [sql, ...params] = args;
      const stmt = db.prepare(sql);
      return stmt.all(...fixParameters(params));
    }

    case 'runAndGetId': {
      const [sql, ...params] = args;
      const stmt = db.prepare(sql);
      const result = stmt.run(...fixParameters(params));
      const rid = result.lastInsertRowid;
      if (typeof rid === 'bigint') {
        if (rid > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error('runAndGetId: lastInsertRowid exceeds safe integer range');
        }
        return Number(rid);
      }
      return rid;
    }

    case 'allMarshal': {
      const [sql, ...params] = args;
      const probe = db.prepare(sql);
      const columns: string[] = probe.columns().map((c: any) => c.name);
      const quotedColumnList = columns.map(quoteIdent).join(",");
      const nameExprs = columns.map(
        (c: string) => quoteLiteral(c) + " AS " + quoteIdent(c)
      ).join(",");
      const marshalStmt = db.prepare(
        `SELECT grist_marshal(${quotedColumnList}) AS buf FROM ` +
        `(SELECT ${nameExprs} UNION ALL SELECT * FROM (${sql}))`
      );
      const query = marshalStmt.all(...fixParameters(params));
      const buf = query[0].buf;
      return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    }

    case 'stmtPrepare': {
      const [sql] = args;
      const stmt = db.prepare(sql);
      const stmtId = nextStmtId++;
      statements.set(stmtId, stmt);
      const columns = stmt.columns().map((c: any) => c.name);
      return { stmtId, columns };
    }

    case 'stmtRun': {
      const [stmtId, ...params] = args;
      const stmt = statements.get(stmtId);
      if (!stmt) { throw new Error(`No prepared statement with id ${stmtId}`); }
      const result = stmt.run(...fixParameters(params));
      return { changes: Number(result.changes) };
    }

    case 'stmtFinalize': {
      const [stmtId] = args;
      statements.delete(stmtId);
      return;
    }

    case 'limitAttach': {
      attachAllowed = args[0] > 0;
      return;
    }

    case 'backupTo': {
      const [destPath, rate] = args;
      await sqliteBackup(db, destPath, { rate: rate ?? 100 });
      return;
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// Listen for messages from main thread.
parentPort!.on('message', handleMessage);
