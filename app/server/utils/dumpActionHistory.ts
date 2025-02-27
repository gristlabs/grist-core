import {create} from "app/server/lib/create";
import * as gutil from 'app/common/gutil';
import {ActionHistoryImpl} from 'app/server/lib/ActionHistoryImpl';
import {DocStorage} from 'app/server/lib/DocStorage';
import log from "app/server/lib/log";

import * as fs from 'node:fs/promises';

export async function dumpActionHistory(docPath: string, options: {
  maxActions?: number
  output?: string
  debug?: boolean
}) {
  const { maxActions, output: outputFile } = options;
  if (!docPath || !gutil.endsWith(docPath, '.grist')) {
    throw new Error('Invalid document: Document should be a valid .grist file');
  }

  log.transports.file.level = 'info';
  const storageManager = await create.createLocalDocStorageManager(".", ".");
  const docStorage = new DocStorage(storageManager, docPath);
  await docStorage.openFile();
  try {
    const history = new ActionHistoryImpl(docStorage);
    const actions = await history.getRecentActions(maxActions);
    const dump = JSON.stringify(actions, null, 2);
    if (outputFile) {
      await fs.writeFile(outputFile, dump, {encoding: 'utf-8'});
    } else {
      console.info(dump);
    }
  } finally {
    await docStorage.shutdown();
  }
}
