import path from "path";
import * as fse from "fs-extra";
import log from "./log";
import { getInstanceRoot } from "./places";

/**
 * Global grist config options that can be used at any point in the process' lifecycle.
 */
export type IGristConfig = Readonly<Record<string, unknown>>;

export async function loadConfigFromFile(configPath: string): Promise<IGristConfig> {
  try {
    if (await fse.pathExists(configPath)) {
      log.info(`Loading config from ${configPath}`);
      return JSON.parse(await fse.readFile(configPath, 'utf8'));
    } else {
      log.info(`Loading empty config because ${configPath} missing`);
      return {};
    }
  } catch(error) {
    log.error(`Loading empty config due to error when loading from ${configPath}: ${error.message}`);
    return {};
  }
}

const globalConfigPath: string = path.join(getInstanceRoot(), 'config.json');
let cachedGlobalConfig: IGristConfig | undefined = undefined;

/**
 * Retrieves the cached grist config, or loads it from the default global path.
 */
export async function getGlobalConfig(): Promise<IGristConfig> {
  if (!cachedGlobalConfig) {
    cachedGlobalConfig = await loadConfigFromFile(globalConfigPath);
  }

  return cachedGlobalConfig;
}
