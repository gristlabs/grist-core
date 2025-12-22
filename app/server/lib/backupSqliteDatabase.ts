import { delay } from "app/common/delay";
import { IDocStorageManager } from "app/server/lib/IDocStorageManager";
import { LogMethods } from "app/server/lib/LogMethods";
import { fromCallback } from "app/server/lib/serverUtils";
import { Backup } from "app/server/lib/SqliteCommon";
import { SQLiteDB } from "app/server/lib/SQLiteDB";

import * as sqlite3 from "@gristlabs/sqlite3";
import * as fse from "fs-extra";

// This constant controls how many pages of the database we back up in a single step.
// The larger it is, the faster the backup overall, but the slower each step is.
// Slower steps result in longer periods when the database is locked, without any
// opportunity for a waiting client to get in and make a write.
// The size of a page, as far as sqlite is concerned, is 4096 bytes.
const PAGES_TO_BACKUP_PER_STEP = 1024;  // Backup is made in 4MB chunks.

// Between steps of the backup, we pause in case a client is waiting to make a write.
// The shorter the pause, the greater the odds that the client won't be able to make
// its write, but the faster the backup will complete.
const PAUSE_BETWEEN_BACKUP_STEPS_IN_MS = 10;

/**
 * Make a copy of a sqlite database safely and without locking it for long periods, using the
 * sqlite backup api.
 * @param src: database to copy
 * @param dest: file to which we copy the database
 * @param testProgress: a callback used for test purposes to monitor detailed timing of backup.
 * @param label: a tag to add to log messages
 * @return dest
 */
export async function backupSqliteDatabase(mainDb: SQLiteDB | undefined,
  src: string, dest: string,
  testProgress?: (e: BackupEvent) => void,
  label?: string,
  logMeta: object = {}): Promise<string> {
  const _log = new LogMethods<null>("backupSqliteDatabase: ", () => logMeta);
  _log.debug(null, `starting copy of ${src} (${label})`);
  /**
   * When available, we backup from an sqlite3 interface held by an SQLiteDB
   * object that is already managing the source (that's mainDb). Otherwise, we will need
   * to make our own (that's this db).
   */
  let db: sqlite3.DatabaseWithBackup | null = null;
  let success: boolean = false;
  let maxStepTimeMs: number = 0;
  let maxNonFinalStepTimeMs: number = 0;
  let finalStepTimeMs: number = 0;
  let numSteps: number = 0;
  let backup: Backup | undefined = undefined;
  try {
    // NOTE: fse.remove succeeds also when the file does not exist.
    await fse.remove(dest);  // Just in case some previous process terminated very badly.
    // Sqlite will try to open any existing material at this
    // path prior to overwriting it.

    // Ignore the supplied database connection if already closed.
    if (mainDb?.isClosed()) {
      mainDb = undefined;
    }
    if (mainDb) {
      // We'll we working from an already configured SqliteDB interface,
      // don't need to do anything special.
      _log.info(null, `copying ${src} (${label}) using source connection`);
    }
    else {
      // We need to open an interface to SQLite.
      await fromCallback((cb) => { db = new sqlite3.Database(dest, cb) as sqlite3.DatabaseWithBackup; });
      // Turn off protections that can slow backup steps.  If the app or OS
      // crashes, the backup may be corrupt.  In Grist use case, if app or OS
      // crashes, no use will be made of backup, so we're OK.
      // This sets flags matching the --async option to .backup in the sqlite3
      // shell program: https://www.sqlite.org/src/info/7b6a605b1883dfcb
      await fromCallback(cb => db!.exec("PRAGMA synchronous=OFF; PRAGMA journal_mode=OFF;", cb));
    }
    if (testProgress) { testProgress({ action: "open", phase: "before" }); }
    // If using mainDb, it could close any time we yield and come back.
    if (mainDb?.isClosed()) { throw new Error("source closed"); }
    backup = mainDb ? mainDb.backup(dest) : db!.backup(src, "main", "main", false);
    if (testProgress) { testProgress({ action: "open", phase: "after" }); }
    let remaining: number = -1;
    let prevError: Error | null = null;
    let errorMsgTime: number = 0;
    let restartMsgTime: number = 0;
    let busyCount: number = 0;
    for (;;) {
      // For diagnostic purposes, issue a message if the backup appears to have been
      // restarted by sqlite.  The symptom of a restart we use is that the number of
      // pages remaining in the backup increases rather than decreases.  That number
      // is reported by backup.remaining (after an initial period of where sqlite
      // doesn't yet know how many pages there are and reports -1).
      // So as not to spam the log if the user is making a burst of changes, we report
      // this message at most once a second.
      // See https://www.sqlite.org/c3ref/backup_finish.html and
      // https://github.com/mapbox/node-sqlite3/pull/1116 for api details.
      numSteps++;
      const stepStart = Date.now();
      if (remaining >= 0 && backup.remaining > remaining && stepStart - restartMsgTime > 1000) {
        _log.info(null, `copy of ${src} (${label}) restarted`);
        restartMsgTime = stepStart;
        testProgress?.({ action: "restart" });
      }
      remaining = backup.remaining;
      testProgress?.({ action: "step", phase: "before" });
      let isCompleted: boolean = false;
      if (mainDb?.isClosed()) { throw new Error("source closed"); }
      try {
        isCompleted = Boolean(await fromCallback(cb => backup!.step(PAGES_TO_BACKUP_PER_STEP, cb)));
      }
      catch (err) {
        testProgress?.({ action: "error", error: String(err) });
        if (String(err).match(/SQLITE_BUSY/)) {
          busyCount++;
          if (busyCount === 10 && mainDb) {
            _log.info(null, `pausing (${src} ${label}): serializing backup`);
            mainDb?.pause();
          }
        }
        if (String(err) !== String(prevError) || Date.now() - errorMsgTime > 1000) {
          _log.info(null, `error (${src} ${label}): ${err}`);
          errorMsgTime = Date.now();
        }
        prevError = err;
        if (backup.failed) { throw new Error(`backupSqliteDatabase (${src} ${label}): internal copy failed`); }
      }
      finally {
        const stepTimeMs = Date.now() - stepStart;
        // Keep track of the longest step taken.
        if (stepTimeMs > maxStepTimeMs) { maxStepTimeMs = stepTimeMs; }
        if (isCompleted) {
          // Keep track of the duration of last step taken, independently.
          // When backing up using the source connection, the last step does
          // more than simply copying pages.
          finalStepTimeMs = stepTimeMs;
        }
        else if (stepTimeMs > maxNonFinalStepTimeMs) {
          // Keep track of the longest step taken that was just copying
          // pages. Since we bound the number of pages to copy, all else
          // being equal the timing of these steps should be fairly
          // consistent, and a long delay is in fact a good sign of problems.
          maxNonFinalStepTimeMs = stepTimeMs;
        }
      }
      testProgress?.({ action: "step", phase: "after" });
      if (isCompleted) {
        _log.info(null, `copy of ${src} (${label}) completed successfully`);
        success = true;
        break;
      }
      await delay(PAUSE_BETWEEN_BACKUP_STEPS_IN_MS);
    }
  }
  finally {
    mainDb?.unpause();
    if (backup) { await fromCallback(cb => backup!.finish(cb)); }
    testProgress?.({ action: "close", phase: "before" });
    try {
      if (db) { await fromCallback(cb => db!.close(cb)); }
    }
    catch (err) {
      _log.debug(null, `problem stopping copy of ${src} (${label}): ${err}`);
    }
    if (!success) {
      // Something went wrong, remove backup if it was started.
      try {
        // NOTE: fse.remove succeeds also when the file does not exist.
        await fse.remove(dest);
      }
      catch (err) {
        _log.debug(null, `problem removing copy of ${src} (${label}): ${err}`);
      }
    }
    testProgress?.({ action: "close", phase: "after" });
    _log.rawLog("debug", null, `stopped copy of ${src} (${label})`, {
      finalStepTimeMs,
      maxStepTimeMs,
      maxNonFinalStepTimeMs,
      numSteps,
    });
  }
  return dest;
}

/**
 * A summary of an event during a backup.  Emitted for test purposes, to check timing.
 */
export interface BackupEvent {
  action: "step" | "close" | "open" | "restart" | "error";
  phase?: "before" | "after";
  error?: string;
}

/**
 *
 * Calls an operation with an optional database connection. If a
 * database connection was supplied, and gets closed during the
 * operation, and the operation failed, then we retry the operation,
 * calling a logging function with the error.
 *
 * This is used for making backups, where we use a database connection
 * handled externally if available. We can make the backup with or
 * without that connection, but we should use it if available (so
 * backups can terminate under constant changes made using that
 * connection), which is how we got backed into this awkward retry corner.
 *
 */
export async function retryOnClose<T>(db: SQLiteDB | undefined,
  log: (err: Error) => void,
  op: () => Promise<T>): Promise<T> {
  const wasClosed = db?.isClosed();
  try {
    return await op();
  }
  catch (err) {
    if (wasClosed || !db?.isClosed()) {
      throw err;
    }
    log(err);
    return await op();
  }
}

/**
 * Make a backup of the given document using either an already
 * open connection, or a fresh one if to existing connection is
 * available. Handle connection availability dropping during
 * the call.
 */
export async function backupUsingBestConnection(
  storageManager: IDocStorageManager,
  docId: string, options: {
    log: (err: Error) => void,
    postfix?: string,
    output?: string,
  }) {
  const postfix = options.postfix ?? "backup";
  const docPath = storageManager.getPath(docId);
  const outPath = options.output || `${docPath}-${postfix}`;
  const db = storageManager.getSQLiteDB(docId);
  return retryOnClose(
    db,
    options.log,
    () => backupSqliteDatabase(db, docPath, outPath, undefined, postfix, { docId }),
  );
}
