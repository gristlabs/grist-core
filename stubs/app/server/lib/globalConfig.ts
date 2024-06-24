import path from "path";
import { getInstanceRoot } from "app/server/lib/places";
import { IGristCoreConfig } from "app/server/lib/configCore";

const globalConfigPath: string = path.join(getInstanceRoot(), 'config.json');
let cachedGlobalConfig: IGristCoreConfig | undefined = undefined;

/**
 * Retrieves the cached grist config, or loads it from the default global path.
 */
export async function getGlobalConfig(): Promise<IGristCoreConfig> {
  if (!cachedGlobalConfig) {
    cachedGlobalConfig = await loadGristCoreConfig(globalConfigPath);
  }

  return cachedGlobalConfig;
}
