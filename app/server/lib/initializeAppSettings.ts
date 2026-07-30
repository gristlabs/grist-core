import { ActivationsManager } from "app/gen-server/lib/ActivationsManager";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { appSettings } from "app/server/lib/AppSettings";
import { migrateConfigFileEdition } from "app/server/lib/migrateConfigFileEdition";

/**
 * Initializes the global {@link appSettings} instance with setting values
 * from `prefs.envVars` of the current activation.
 *
 * Calling this function will create a new activation record if one does
 * not already exist, and migrate the edition from the legacy config.json
 * file (if present) to the `GRIST_SERVER_EDITION` setting stored in the
 * `prefs.envVars` column of the activation record
 * (see {@link migrateConfigFileEdition}).
 *
 * You should only call this function once, early during the construction of
 * the Grist server: before any values from appSettings are read, and before
 * the first `getCreate` call creates the server's ICreate instance.
 */
export async function initializeAppSettings(): Promise<void> {
  const dbManager = new HomeDBManager();
  await dbManager.connect();
  const activationsManager = new ActivationsManager(dbManager);
  let activation = await activationsManager.current();
  activation = await migrateConfigFileEdition(activationsManager, activation);
  appSettings.setEnvVars(activation.prefs?.envVars || {});
}
