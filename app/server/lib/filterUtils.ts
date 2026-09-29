import { DocumentSettings } from "app/common/DocumentSettings";
import { safeJsonParse } from "app/common/gutil";
import { ActionHistoryImpl } from "app/server/lib/ActionHistoryImpl";
import { OptDocSession } from "app/server/lib/DocSession";
import { OpenMode, quoteIdent, SQLiteDB } from "app/server/lib/SQLiteDB";

/**
 * Filter a Grist document when it is copied or downloaded.  Changes that should
 * likely be always made:
 *   - Any FullCopies special rules are removed.
 * Optional changes:
 *   - Removing all data rows.
 *   - Removing action history.
 * In the future, the changes could be made conditional on the user.  This would
 * allow us for example to permit downloads of documents with row-level filters
 * in place.
 */
export interface FilterOptions {
  removeData: boolean;
  removeHistory: boolean;
  removeFullCopiesSpecialRight: boolean;
  markAction: boolean;
  disableTriggers: boolean;
}

/**
 * The filtering a document gets on its way out, as a download or a fork.
 * Removing data and history is asked for per download; the rest always applies.
 */
export function makeFilterOptions(
  options: { removeData?: boolean, removeHistory?: boolean } = {},
): FilterOptions {
  return {
    removeData: false,
    removeHistory: false,
    ...options,
    removeFullCopiesSpecialRight: true,
    markAction: true,
    disableTriggers: true,
  };
}

export async function filterDocumentInPlace(
  docSession: OptDocSession, filename: string, options: FilterOptions,
) {
  // We ignore docSession for now, since no changes are user-dependent yet.
  if (options.markAction) {
    await markAction(filename);
  }
  if (options.removeData) {
    await removeData(filename);
  }
  if (options.removeHistory) {
    await removeHistory(filename);
  }
  if (options.removeFullCopiesSpecialRight) {
    await removeFullCopiesSpecialRight(filename);
  }
  if (options.disableTriggers) {
    await disableTriggers(filename);
  }
}

async function removeFullCopiesSpecialRight(filename: string) {
  // The change we need to make is simple, so we open the doc as a SQLite DB.
  // Note: the change is not entered in document history.
  const db = await SQLiteDB.openDBRaw(filename, OpenMode.OPEN_EXISTING);
  // Fetch ids of any special resources mentioning FullCopies (ideally there would be
  // at most one).
  const resourceIds = (
    await db.all("SELECT id FROM _grist_ACLResources " +
      "WHERE tableId='*SPECIAL' AND colIds='FullCopies'")
  ).map(row => row.id as number);
  if (resourceIds.length > 0) {
    // Remove any related rules.
    await db.run(`DELETE FROM _grist_ACLRules WHERE resource IN (${resourceIds})`);
    // Remove the resources.
    await db.run(`DELETE FROM _grist_ACLResources WHERE id IN (${resourceIds})`);
  }
  await db.close();
}

/**
 * Remove rows from all user tables.
 */
async function removeData(filename: string) {
  const db = await SQLiteDB.openDBRaw(filename, OpenMode.OPEN_EXISTING);
  const tableIds = (await db.all("SELECT name FROM sqlite_master WHERE type='table'"))
    .map(row => row.name as string)
    .filter(name => !name.startsWith("_grist"));
  for (const tableId of tableIds) {
    await db.run(`DELETE FROM ${quoteIdent(tableId)}`);
  }
  await db.run(`DELETE FROM _grist_Attachments`);
  await db.run(`DELETE FROM _gristsys_Files`);
  await db.close();
}

/**
 * Wipe as much history as we can.
 */
async function removeHistory(filename: string) {
  const db = await SQLiteDB.openDBRaw(filename, OpenMode.OPEN_EXISTING);
  const history = new ActionHistoryImpl(db);
  await history.deleteActions(1);
  await db.close();
}

async function markAction(filename: string) {
  const db = await SQLiteDB.openDBRaw(filename, OpenMode.OPEN_EXISTING);
  const history = new ActionHistoryImpl(db);
  const states = await history.getRecentStates(1);
  // documentSettings arrived in schema version 23; an older document has
  // nowhere to record the action, and gains the column when it migrates.
  if (states.length > 0 && await hasColumn(db, "_grist_DocInfo", "documentSettings")) {
    const documentSettings: string = (await db.all("SELECT documentSettings FROM _grist_DocInfo"))[0]?.documentSettings;
    const documentSettingsObj: DocumentSettings = safeJsonParse(documentSettings, {});
    documentSettingsObj.baseAction = states[0];
    await db.run("UPDATE _grist_DocInfo SET documentSettings = ?",
      JSON.stringify(documentSettingsObj));
  }
  await db.close();
}

/**
 * Whether a table has a given column. The pragma yields nothing for a missing
 * table, so this covers documents predating the table itself.
 */
async function hasColumn(db: SQLiteDB, tableId: string, colId: string): Promise<boolean> {
  const columns = await db.all(`PRAGMA table_info(${quoteIdent(tableId)})`);
  return columns.some(column => column.name === colId);
}

/**
 * Disable all triggers, so that they won't run when the document is downloaded and then opened.
 */
async function disableTriggers(filename: string) {
  const db = await SQLiteDB.openDBRaw(filename, OpenMode.OPEN_EXISTING);
  // _grist_Triggers arrived in schema version 24, its `enabled` column only in
  // 39, so check the column. Having no triggers is no protection: SQLite
  // resolves column names when it prepares the statement.
  if (await hasColumn(db, "_grist_Triggers", "enabled")) {
    await db.run("UPDATE _grist_Triggers SET enabled = 0");
  }
  await db.close();
}
