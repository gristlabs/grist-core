import { ActivationsManager } from "app/gen-server/lib/ActivationsManager";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { appSettings } from "app/server/lib/AppSettings";

/**
 * Initializes the global {@link appSettings} instance with setting values
 * from `prefs.envVars` of the current activation.
 *
 * Calling this function will create a new activation record if one does
 * not already exist.
 *
 * You should call this function once and early during the construction of
 * the Grist server, before accessing any values from {@link appSettings}
 * are read.
 */
export async function initializeAppSettings(): Promise<void> {
  const dbManager = new HomeDBManager();
  await dbManager.connect();
  const activationsManager = new ActivationsManager(dbManager);
  const activation = await activationsManager.current();
  appSettings.setEnvVars(activation.prefs?.envVars || {});
}
