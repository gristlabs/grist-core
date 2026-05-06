import { appSettings } from "app/server/lib/AppSettings";
import { ExternalStorageSettings, wrapWithKeyMappedStorage } from "app/server/lib/ExternalStorage";
import { FilesystemExternalStorage } from "app/server/lib/FilesystemExternalStorage";
import log from "app/server/lib/log";

export function configureFilesystemExternalStorage(
  purpose: ExternalStorageSettings["purpose"], extraPrefix: string,
) {
  const dir = checkFilesystemExternalStorage();
  if (!dir) { return undefined; }
  log.warn(
    "FilesystemExternalStorage activated at %s via GRIST_FS_STORAGE_DIR. " +
    "This backend is for testing and local development only; do not use in production.",
    dir);
  return wrapWithKeyMappedStorage(new FilesystemExternalStorage(dir), {
    basePrefix: "docs/",
    extraPrefix,
    purpose,
  });
}

export function checkFilesystemExternalStorage(): string | undefined {
  const settings = appSettings.section("externalStorage").section("filesystem");
  const dir = settings.flag("dir").readString({
    envVar: ["GRIST_FS_STORAGE_DIR"],
  });
  if (!dir) { return undefined; }
  settings.flag("url").set(`file://${dir}`);
  settings.flag("active").set(true);
  return dir;
}
