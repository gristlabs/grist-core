import {
  createConfigValue,
  FileConfig,
  fileConfigAccessorFactory,
  IWritableConfigValue
} from "app/server/lib/config";
import {convertToCoreFileContents, IGristCoreConfigFileLatest} from "app/server/lib/configCoreFileFormats";
import {isAffirmative} from 'app/common/gutil';

export type Edition = "core" | "enterprise";

/**
 * Config options for Grist Core.
 */
export interface IGristCoreConfig {
  edition: IWritableConfigValue<Edition>;
}

export function loadGristCoreConfigFile(configPath?: string): IGristCoreConfig {
  const fileConfig = configPath ? FileConfig.create(configPath, convertToCoreFileContents) : undefined;
  return loadGristCoreConfig(fileConfig);
}

export function loadGristCoreConfig(fileConfig?: FileConfig<IGristCoreConfigFileLatest>): IGristCoreConfig {
  const fileConfigValue = fileConfigAccessorFactory(fileConfig);
  return {
    edition: createConfigValue<Edition>(
      isAffirmative(process.env.GRIST_FORCE_ENABLE_ENTERPRISE) ? "enterprise" : "core",
      fileConfigValue("edition")
    )
  };
}
