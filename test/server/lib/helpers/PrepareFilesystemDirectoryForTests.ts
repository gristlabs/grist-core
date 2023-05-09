import * as fse from "fs-extra";
import log from "app/server/lib/log";

export async function prepareFilesystemDirectoryForTests(directory: string) {
  // Create the tmp dir removing any previous one
  await fse.remove(directory);
  await fse.mkdirs(directory);
  log.warn(`Test logs and data are at: ${directory}/`);
}
