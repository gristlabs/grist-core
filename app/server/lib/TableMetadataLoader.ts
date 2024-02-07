import { BulkColValues, TableColValues, TableDataAction, toTableDataAction } from 'app/common/DocActions';
import log from 'app/server/lib/log';

import fromPairs = require('lodash/fromPairs');

/**
 *
 * Handle fetching tables from the database and pushing them to the data engine during
 * document load.  The goal is to allow opening a document and viewing its contents
 * without needing to wait for the data engine.
 *
 * Fetches are done in parallel, but will be bottlenecked by node-sqlite3 and then
 * sqlite itself.  Pushes are limited to concurrency of 3, and will be bottlenecked
 * by pipe to engine in any case.
 *
 * Historically, there is some tolerance for missing tables.  TableMetadataLoader retains
 * that tolerance.
 *
 * The TableMetadataLoader doesn't play a role in document creation or migrations.
 *
 * This class is only used for loading metadata. There is no need to use it for
 * user tables, since the server never needs those tables, they should be passed
 * on to the data engine without caching. Everything the TableMetadataLoader loads persists
 * until clean() is called.
 *
 */
export class TableMetadataLoader {
  // Promises of buffers for tables being fetched from database, by tableId.
  private _fetches = new Map<string, Promise<Buffer|null>>();

  // Set of all tableIds for tables that are fully fetched from database.
  private _fetched = new Set<string>();

  // Operation promises for tables being loaded into the data engine.
  private _pushes = new Map<string, Promise<void>>();

  // Set of all tableIds for tables fully loaded into the data engine.
  private _pushed = new Set<string>();

  // Unpacked tables, for reading within node. Only done if requested.
  private _tables = new Map<string, TableDataAction>();

  // Operation promise for loading core schema (table and column list) into the data engine.
  private _corePush: Promise<void>|undefined;

  // True once core push is complete.
  private _corePushed: boolean = false;

  // The number of promises currently pending.
  private _pending: number = 0;

  // Buffers will only be pushed to data engine once startStreamingToEngine() is called.
  private _allowPushes: boolean = false;

  // TableMetadataLoader requires access to database, and the ability to call the data engine.
  constructor(private _options: {
    decodeBuffer(buffer: Buffer, tableId: string): TableColValues,
    fetchTable(tableId: string): Promise<Buffer>,
    loadMetaTables(tables: Buffer, columns: Buffer): Promise<any>,
    loadTable(tableId: string, buffer: Buffer): Promise<any>,
  }) {
  }

  // Start sending tables to data engine as they are fetched.
  public startStreamingToEngine() {
    this._allowPushes = true;
    this._update();
  }

  // Start fetching a table from the database, if it isn't already on the way.
  public startFetchingTable(tableId: string): void {
    if (!this._fetches.has(tableId)) {
      this._fetches.set(tableId, this._counted(this.opFetch(tableId)));
    }
  }

  // Read out a table as a Buffer.
  public async fetchTableAsBuffer(tableId: string): Promise<Buffer> {
    this.startFetchingTable(tableId);
    const buffer = await this._fetches.get(tableId);
    if (!buffer) {
      throw new Error(`required table not found: ${tableId}`);
    }
    return buffer;
  }

  // Read out a table as a TableDataAction. Table is cached in this._tables.
  public async fetchTableAsAction(tableId: string): Promise<TableDataAction> {
    let cachedTable = this._tables.get(tableId);
    if (cachedTable) { return cachedTable; }
    const buffer = await this.fetchTableAsBuffer(tableId);
    const values = this._options.decodeBuffer(buffer, tableId);
    cachedTable = toTableDataAction(tableId, values);
    this._tables.set(tableId, cachedTable);
    return cachedTable;
  }

  // Read content of table as BulkColValues. Does not include row ids.
  public async fetchBulkColValuesWithoutIds(tableId: string): Promise<BulkColValues> {
    const table = await this.fetchTableAsAction(tableId);
    return table[3];
  }

  // Read out all tables requested thus far as TableDataActions.
  public async fetchTablesAsActions(): Promise<Record<string, TableDataAction>> {
    for (const [tableId, opFetch] of this._fetches.entries()) {
      if (!await opFetch) {
        // Tolerate missing tables.
        continue;
      }
      await this.fetchTableAsAction(tableId);
    }
    return fromPairs([...this._tables.entries()]);
  }

  // Wait for all operations to complete.
  public async wait() {
    while (this._pending > 0) {
      await Promise.all(this._fetches.values());
      await this._corePush;
      await Promise.all(this._pushes.values());
    }
  }

  // Wipe all stored state.
  public async clean() {
    await this.wait();
    this._fetches.clear();
    this._fetched.clear();
    this._pushes.clear();
    this._pushed.clear();
    this._corePush = undefined;
    this._corePushed = false;
    this._tables.clear();
    this._pending = 0;
  }

  // Core push operation. Before we can send arbitrary tables to engine, we must call
  // load_meta_tables with tables and columns.
  public async opCorePush() {
    const tables = await this.fetchTableAsBuffer('_grist_Tables');
    const columns = await this.fetchTableAsBuffer('_grist_Tables_column');
    await this._options.loadMetaTables(tables, columns);
    this._corePushed = true;
    // It appears to be bad and unnecessary to send tables and columns outside of core push.
    this._pushed.add('_grist_Tables');
    this._pushed.add('_grist_Tables_column');
    this._update();
  }

  // Operation to fetch a single table from database.
  public async opFetch(tableId: string) {
    try {
      return await this._options.fetchTable(tableId);
    } catch (err) {
      if (/no such table/.test(err.message)) { return null; }
      throw err;
    } finally {
      this._fetched.add(tableId);
      this._update();
    }
  }

  // Operation to push a single table to the data engine.
  public async opPush(tableId: string) {
    const buffer = await this._fetches.get(tableId);
    // Tolerate missing tables.
    if (buffer) {
      await this._options.loadTable(tableId, buffer);
    }
    this._pushed.add(tableId);
    this._update();
  }

  // Called after any operation has completed, to see if there's any more work we can start
  // doing.
  private _update() {
    // If pushes are not allowed yet, there's no possibility of follow-on work.
    if (!this._allowPushes) { return; }

    // Get a list of new pushes that will be needed.
    const newPushes = new Set([...this._fetched]
                              .filter(tableId => !(this._pushes.has(tableId) ||
                                                   this._pushed.has(tableId))));

    // Be careful to do the core push first, once we can.
    if (!this._corePushed) {
      if (this._corePush === undefined && newPushes.has('_grist_Tables') && newPushes.has('_grist_Tables_column')) {
        this._corePush = this._counted(this.opCorePush()).catch(e => {
          log.warn(`TableMetadataLoader opCorePush failed: ${e}`);
        });
      }
      return;
    }

    // Start new pushes. Sort to give a bit more determinism, but the order depends on a lot
    // of low-level details (meaning DocRegressionTest is not on a very firm foundation).
    for (const tableId of [...newPushes].sort()) {
      // Put a limit on the number of outstanding pushes permitted.
      if (this._pushes.size >= this._pushed.size + 3) { break; }
      const promise = this._counted(this.opPush(tableId));
      this._pushes.set(tableId, promise);
      // Mark the promise as handled to avoid "unhandledRejection", but without affecting other
      // code (which will still see `promise`, not the new promise returned by `.catch()`).
      promise.catch(() => {});
   }
  }

  // Wrapper to keep track of pending promises.
  private async _counted<T>(op: Promise<T>): Promise<T> {
    this._pending++;
    try {
      return await op;
    } finally {
      this._pending--;
    }
  }
}
