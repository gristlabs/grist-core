/**
 * Upgrade one or more documents (both the DocStorage and schema migrations).
 *
 * Usage:
 *    test/upgradeDocument <docPaths...>
 */
import {DocStorage} from 'app/server/lib/DocStorage';
import {DocStorageManager} from 'app/server/lib/DocStorageManager';
import {copyFile} from 'app/server/lib/docUtils';
import {createDocTools} from 'test/server/docTools';
import log from 'app/server/lib/log';
import * as fs from "fs";
import * as fse from "fs-extra";
import * as path from "path";
import * as tmp from "tmp";

export async function upgradeDocuments(docPaths: string[]): Promise<void> {
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
  }
}

export async function upgradeDocumentsDocStorageOnly(paths: string[]): Promise<void> {
  let tmpDir = await tmp.dirAsync({ prefix: 'grist_migrate_', unsafeCleanup: true });
  tmpDir = await fse.realpath(tmpDir);
  const docStorageManager = new DocStorageManager(tmpDir);

  for (const docPath of paths) {
    console.log(`Upgrading '${docPath}' (DocStorage migrations only)`);
    const docName = path.basename(docPath);
    const tempPath = docStorageManager.getPath(docName);
    fs.copyFileSync(docPath, tempPath);

    const docStorage = new DocStorage(docStorageManager, docName);
    await docStorage.openFile();
    await docStorage.shutdown();

    fs.copyFileSync(tempPath, docPath);
  }
}

export async function main() {
  const params = process.argv.slice(2);
  const onlyRunDocStorageMigrations = params.map((text) => text.toLowerCase()).includes("--doc-storage-only");
  const docPaths = params.filter((text) => text.trim()[0] != "-");
  if (docPaths.length === 0) {
    console.log(`Usage:\n    test/upgradeDocument path/to/doc.grist ...\n`);
    console.log(`Parameters: `);
    console.log(`  --doc-storage-only - Only runs DocStorage migrations`);
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
  try {
    if (onlyRunDocStorageMigrations) {
      await upgradeDocumentsDocStorageOnly(docPaths);
    } else {
      await upgradeDocuments(docPaths);
    }
  } finally {
    log.transports.file.level = prevLogLevel;
  }
}
