# Porting from node-sqlite3 to Node.js built-in `node:sqlite`

## What this is

A prototype adapter that lets Grist use Node.js's built-in `node:sqlite`
module instead of the `@gristlabs/sqlite3` native addon.

Activate with `GRIST_SQLITE_VARIANT=native` (wired into `SQLiteDB.ts`'s
`getVariant()`).

## Architecture: worker-per-document

`node:sqlite`'s `DatabaseSync` API is synchronous — it blocks the thread
during SQLite operations. To keep the main event loop responsive, each
database connection runs in a dedicated `Worker` thread:

```
Main thread                          Worker thread (one per document)
─────────────────────────────────    ──────────────────────────────────
SqliteNative.ts                      SqliteNativeWorker.ts
  NativeSqliteDatabaseAdapter          DatabaseSync connection
    ._call(method, args)  ──────►      handleMessage()
       postMessage({id,method,args})     dispatch(method, args)
    ◄──────                              postMessage({id, result})
       resolve pending promise
```

**Why one worker per document:** Grist already uses one `DocStorage` per
`ActiveDoc`. A shared pool would require cross-document serialization and
complicate connection lifecycle. One-to-one mapping is simple, matches the
existing model, and avoids contention.

**Thread overhead:** ~2 MB per Worker. For typical Grist deployments with
tens of open documents, this is negligible. The overhead is comparable to
the existing `@gristlabs/sqlite3` thread pool (which uses one thread per
connection internally).

## Files

- `app/server/lib/SqliteNative.ts` — main-thread adapter implementing
  `MinDB` by dispatching to a Worker thread via `postMessage`
- `app/server/lib/SqliteNativeWorker.ts` — worker thread script that owns
  the `DatabaseSync` connection and handles all SQLite operations
- `test/server/lib/SqliteNative.ts` — 28 tests
- `app/server/lib/SQLiteDB.ts` — one-line change to `getVariant()` for
  `GRIST_SQLITE_VARIANT=native`

## Test results

106 passing, 0 failing across 5 test suites with `GRIST_SQLITE_VARIANT=native`:

| Suite | Pass | Fail |
|---|---|---|
| SqliteNative (new) | 28 | 0 |
| DocStorage | 29 | 0 |
| DocStorageQuery | 6 | 0 |
| ActionHistory | 26 | 0 |
| SQLiteDB | 17 | 0 |

All tests also pass with the default `@gristlabs/sqlite3` variant (78
passing). The DQS fixes to test SQL are backward compatible.

## What went well

**Grist's abstraction layer made this easy.** The `MinDB`/`SqliteVariant`
interfaces in `SqliteCommon.ts` are well designed. The new adapter follows
the same pattern as the existing `SqliteBetter.ts` (for better-sqlite3)
in grist-static.

**API coverage is good.** `node:sqlite` covers all the core operations Grist
needs: `exec`, `prepare`/`run`/`get`/`all`, custom aggregate functions
(for `grist_marshal`), backup, and open modes.

**Worker threads are a natural fit.** One worker per document matches
Grist's existing one-connection-per-DocStorage model. The async
`postMessage` boundary maps cleanly onto the `MinDB` async interface.

**No native compilation.** The main win: eliminates the `@gristlabs/sqlite3`
native addon dependency entirely, simplifying builds and cross-platform
support.

## What was a problem

### DQS (Double-Quoted Strings) — the biggest issue

`node:sqlite` disables DQS by default, which is correct per the SQL
standard. SQLite's DQS misfeature treats `"hello"` as a string literal when
no column named `hello` exists. `@gristlabs/sqlite3` allows this.

Impact and fixes:
- `allMarshalQuery()` in `SqliteCommon.ts` relies on DQS — it uses
  `quoteIdent()` (double quotes) to embed column names as string literals in
  a UNION. The adapter overrides `allMarshal` with proper `'name' AS "name"`
  syntax.
- Several tests used `VALUES ("hello")` instead of `VALUES ('hello')`.
  Fixed to use single-quoted string literals (backtick JS template literals
  where needed). Production code was already clean.
- The ATTACH-blocking test expected a specific error message from
  `sqlite3_limit`; updated to also accept the authorizer's "not authorized".

DQS was arguably a latent bug that the old SQLite wrapper was masking.

### Error code differences

`node:sqlite` throws errors with `code: 'ERR_SQLITE_ERROR'` and a numeric
`errcode`, while `@gristlabs/sqlite3` uses string codes like
`'SQLITE_ERROR'`, `'SQLITE_READONLY'`, `'SQLITE_CANTOPEN'`. Grist code
checks both `err.code` and `err.message` for these strings.

Fixed with a translation layer in `SqliteNativeWorker.ts` that maps numeric
errcodes (including extended codes like 2067 = `SQLITE_CONSTRAINT_UNIQUE`)
to the expected string codes and prefixes messages.

### Uint8Array vs Buffer (double conversion)

`node:sqlite` returns `Uint8Array` for BLOB columns. `Buffer` extends
`Uint8Array` but they differ on `.toString()`: `Buffer.toString()` gives
UTF-8 text, `Uint8Array.toString()` gives comma-separated numbers.

With the worker architecture, this requires conversion in **two places**:
1. In the worker (`fixRow()`) — converts before sending results
2. On the main thread (`_fixRow()`) — converts again because structured
   clone across the worker boundary turns Buffer back into Uint8Array

### undefined parameters

`node:sqlite` rejects `undefined` as a bound parameter (throws
`TypeError`). `@gristlabs/sqlite3` silently treats it as NULL. Fixed by
converting `undefined` to `null` in `tweakParams()`.

### ATTACH limiting mechanism

`@gristlabs/sqlite3` uses `sqlite3_limit(SQLITE_LIMIT_ATTACHED, 0)`.
The `node:sqlite` constructor `limits: { attach: 0 }` option exists but
doesn't work on Node 24. Used `setAuthorizer()` to deny `SQLITE_ATTACH`
instead — functionally equivalent but produces a different error message.

### Missing `interrupt()`

`node:sqlite` doesn't expose `sqlite3_interrupt()`. The adapter reports
`canInterrupt: false`. This means long-running queries can't be cancelled,
which matters for server responsiveness but isn't a correctness issue.
With the worker architecture, adding interrupt support would require a
cross-thread signaling mechanism (e.g. `SharedArrayBuffer` or a control
channel).

### Backup API mismatch

`node:sqlite` has an async `backup(db, path, options)` function instead of
the step-based `db.backup(path).step(pages, cb)` API. The adapter exposes
`backupTo()` directly rather than shimming the step-based interface.
`backupSqliteDatabase.ts` would need a separate code path to use this.

### Maturity

`node:sqlite` is experimental on Node 22 (Grist's current target per
`.nvmrc`), requiring `--experimental-sqlite`. It reached release candidate
status in Node 25.7. Practical deployment depends on Grist's Node version
policy.

### Type definitions

The project's `@types/node` doesn't include `node:sqlite` types. The adapter
uses `require()` and `any` casts. Not a runtime issue but reduces type
safety.

## Remaining concerns

### Node version requirement (the real gate)

The worker architecture, DQS handling, error translation, and type
conversions are all solved — 106/106 tests pass. The blocker for production
use is that `node:sqlite` is experimental on Node 22 (Grist's current
target), requiring `--experimental-sqlite`, and only reached stable in
Node 25.7. Deploying means either accepting API churn risk on Node 22 or
waiting for Grist to bump its Node version.

### No clean query cancellation

`worker.terminate()` can kill a runaway query, but it destroys the entire
connection rather than cancelling one statement. A real fix requires Node.js
to expose `sqlite3_interrupt()`, or a `SharedArrayBuffer`-based signaling
mechanism to the worker thread.

### Structured clone overhead

Every result set is deep-copied across the worker boundary (only raw
`Buffer`/`Uint8Array` values transfer zero-copy). For typical Grist
workloads this is likely fine, but bulk operations like large imports could
see measurable overhead vs. in-process `@gristlabs/sqlite3`.

### DQS dependency in shared code

The adapter overrides `allMarshal` to avoid the DQS-dependent
`allMarshalQuery()` in `SqliteCommon.ts`. If any other caller hits
`allMarshalQuery()` directly, it would break with the native adapter.
Worth auditing.
