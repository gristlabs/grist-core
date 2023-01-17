/**
 * Upgrade one or more documents (both the DocStorage and schema migrations).
 *
 * Usage:
 *    test/upgradeDocument <docPaths...>
 */
import {copyFile} from 'app/server/lib/docUtils';
import {createDocTools} from 'test/server/docTools';
import log from 'app/server/lib/log';
import * as fs from "fs";

export async function main() {
  const docPaths = process.argv.slice(2);
  if (docPaths.length === 0) {
    console.log(`Usage:\n    test/upgradeDocument path/to/doc.grist ...\n`);
    throw new Error("Document argument required");
  }
  for (const docPath of docPaths) {
    if (!docPath.endsWith('.grist')) {
      throw new Error(`Document path should have .grist extension: ${docPath}`);
    }
    if (!fs.existsSync(docPath)) {
      throw new Error(`Document path doesn't exist: ${docPath}`);
    }
  }

  const prevLogLevel = log.transports.file.level;
  log.transports.file.level = 'warn';
  const docTools = createDocTools();
  await docTools.before();
  try {
    for (const docPath of docPaths) {
      console.log(`Upgrading ${docPath}`);
      const activeDoc = await docTools.loadLocalDoc(docPath);
      await activeDoc.waitForInitialization();
      await activeDoc.shutdown();
      await copyFile(docTools.getStorageManager().getPath(activeDoc.docName), docPath);
    }
  } finally {
    await docTools.after();
    log.transports.file.level = prevLogLevel;
  }
}
