import { OpenMode, SQLiteDB } from 'app/server/lib/SQLiteDB';
import { OptDocSession } from "app/server/lib/DocSession";

/**
 * Filter a Grist document when it is copied or downloaded.  Changes made:
 *   - Any FullCopies special rules are removed.
 * In the future, the changes could be made conditional on the user.  This would
 * allow us for example to permit downloads of documents with row-level filters
 * in place.
 */
export async function filterDocumentInPlace(docSession: OptDocSession, filename: string) {
  // We ignore docSession for now, since no changes are user-dependent yet.
  // The change we need to make is simple, so we open the doc as a SQLite DB.
  // Note: the change is not entered in document history.
  const db = await SQLiteDB.openDBRaw(filename, OpenMode.OPEN_EXISTING);
  // Fetch ids of any special resources mentioning FullCopies (ideally there would be
  // at most one).
  const resourceIds = (await db.all("SELECT id FROM _grist_ACLResources " +
                                    "WHERE tableId='*SPECIAL' AND colIds='FullCopies'"))
    .map(row => row.id as number);
  if (resourceIds.length > 0) {
    // Remove any related rules.
    await db.run(`DELETE FROM _grist_ACLRules WHERE resource IN (${resourceIds})`);
    // Remove the resources.
    await db.run(`DELETE FROM _grist_ACLResources WHERE id IN (${resourceIds})`);
  }
  await db.close();
}
