import log from "app/server/lib/log";

import * as fse from "fs-extra";

export async function prepareFilesystemDirectoryForTests(directory: string) {
  // Create the tmp dir removing any previous one
  await fse.remove(directory);
  await fse.mkdirs(directory);
  log.warn(`Test logs and data are at: ${directory}/`);
}
