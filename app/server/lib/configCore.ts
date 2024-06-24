import {
  ConfigValidationError,
  createFileBackedConfig,
  createFileConfigValue,
  createMemoryConfigValue,
  IWritableConfigValue
} from "./config";
import configCoreTI from './configCore-ti'
import { CheckerT, createCheckers } from "ts-interface-checker";

export type Edition = "core" | "enterprise";

/**
 * The contents of the grist core config file.
 */
export interface IGristCoreConfigFileContents {
  edition?: Edition
}

/**
 * Global config values accessible from anywhere in core.
 */
export interface IGristCoreConfig {
  edition: IWritableConfigValue<Edition>;
}

export const checkers = createCheckers(configCoreTI) as
  { IGristCoreConfigFileContents: CheckerT<IGristCoreConfigFileContents> };

export function createDefaultCoreConfigInMemory(): IGristCoreConfig {
  return {
    edition: createMemoryConfigValue("core"),
  };
}

export function convertToCoreFileContents(input: any): IGristCoreConfigFileContents | null {
  if (!checkers.IGristCoreConfigFileContents.test(input)) {
    return null;
  }

  return input;
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
