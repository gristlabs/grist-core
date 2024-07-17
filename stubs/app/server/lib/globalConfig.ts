import path from "path";
import { getInstanceRoot } from "app/server/lib/places";
import { IGristCoreConfig, loadGristCoreConfigFile } from "app/server/lib/configCore";
import log from "app/server/lib/log";

const globalConfigPath: string = path.join(getInstanceRoot(), 'config.json');
let cachedGlobalConfig: IGristCoreConfig | undefined = undefined;

/**
 * Retrieves the cached grist config, or loads it from the default global path.
 */
export function getGlobalConfig(): IGristCoreConfig {
  if (!cachedGlobalConfig) {
    log.info(`Loading config file from ${globalConfigPath}`);
    cachedGlobalConfig = loadGristCoreConfigFile(globalConfigPath);
  }

  return cachedGlobalConfig;
}
