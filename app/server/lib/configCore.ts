import { createFileBackedConfig, createFileConfigValue, createMemoryConfigValue, IWritableConfigValue } from "./config";
import { convertToCoreFileContents } from "./configCoreFileFormats";

export type Edition = "core" | "enterprise";

/**
 * Config options for Grist Core.
 */
export interface IGristCoreConfig {
  edition: IWritableConfigValue<Edition>;
}

export async function loadGristCoreConfigFile(configPath: string): Promise<IGristCoreConfig> {
  return createFileBackedConfig(
    configPath,
    convertToCoreFileContents,
    (fileConfig) => ({
      edition: createFileConfigValue(fileConfig, 'edition')
    })
  );
}

export function createDefaultGristCoreConfigInMemory(): IGristCoreConfig {
  return {
    edition: createMemoryConfigValue("core"),
  };
}
