import * as gutil from 'app/common/gutil';
import {ActionHistoryImpl} from 'app/server/lib/ActionHistoryImpl';
import {DocStorage} from 'app/server/lib/DocStorage';
import {DocStorageManager} from 'app/server/lib/DocStorageManager';
import * as docUtils from 'app/server/lib/docUtils';
import log from 'app/server/lib/log';

/**
 * A utility script for cleaning up the action log.
 *
 * @param {String} docPath - The path to the document from the current directory including
 *  the document name.
 * @param {Int} keepN - The number of recent actions to keep. Must be at least 1. Defaults to 1
 *  if not provided.
 */
export async function pruneActionHistory(docPath: string, keepN: number) {
  if (!docPath || !gutil.endsWith(docPath, '.grist')) {
    throw new Error('Invalid document: Document should be a valid .grist file');
  }

  const storageManager = new DocStorageManager(".", ".");
  const docStorage = new DocStorage(storageManager, docPath);
  const backupPath = gutil.removeSuffix(docPath, '.grist') + "-backup.grist";

  // If the backup already exists, abort. Otherwise, create a backup copy and continue.
  const exists = await docUtils.pathExists(backupPath);
  if (exists) { throw new Error('Backup file already exists, aborting pruneActionHistory'); }
  await docUtils.copyFile(docPath, backupPath);
  await docStorage.openFile();
  try {
    const history = new ActionHistoryImpl(docStorage);
    await history.initialize();
    await history.deleteActions(keepN);
  } finally {
    await docStorage.shutdown();
  }
}

/**
 * Variant that accepts and parses command line arguments.
 */
export async function pruneActionHistoryFromConsole(argv: string[]): Promise<number> {
  if (argv.length === 0) {
    log.error("Please supply document name, and optionally the number of actions to preserve (default=1)");
    return 1;
  }
  const docPath = argv[0];
  const keepN = parseInt(argv[1], 10) || 1;
  try {
    await pruneActionHistory(docPath, keepN);
  } catch (e) {
    log.error(e);
    return 1;
  }
  return 0;
}

if (require.main === module) {
  pruneActionHistoryFromConsole(process.argv.slice(2)).catch((e) => {
    log.error("pruneActionHistory failed: %s", e);
    process.exit(1);
  });
}
