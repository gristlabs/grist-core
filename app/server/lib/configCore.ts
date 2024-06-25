import {
  createConfigValue,
  FileConfig,
  fileConfigAccessorFactory,
  IWritableConfigValue
} from "./config";
import { convertToCoreFileContents, IGristCoreConfigFileLatest } from "./configCoreFileFormats";

export type Edition = "core" | "enterprise";

/**
 * Config options for Grist Core.
 */
export interface IGristCoreConfig {
  edition: IWritableConfigValue<Edition>;
}

export async function loadGristCoreConfigFile(configPath?: string): Promise<IGristCoreConfig> {
  const fileConfig = configPath ? await FileConfig.create(configPath, convertToCoreFileContents) : undefined;
  return loadGristCoreConfig(fileConfig);
}

export function loadGristCoreConfig(fileConfig?: FileConfig<IGristCoreConfigFileLatest>): IGristCoreConfig {
  const fileConfigValue = fileConfigAccessorFactory(fileConfig);
  return {
    edition: createConfigValue("core", fileConfigValue("edition"))
  };
}
