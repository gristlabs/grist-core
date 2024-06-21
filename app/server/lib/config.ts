import path from "path";
import * as fse from "fs-extra";
import log from "./log";
import { getInstanceRoot } from "./places";

export type Edition = string;

/**
 * The contents of the grist core config file.
 */
export interface IGristCoreConfigFileContents {
  edition: Edition
}

/**
 * Global config values accessible from anywhere in core.
 */
export interface IGristCoreConfig {
  edition: IWritableConfigValue<Edition>;
}

interface IReadableConfigValue<T> {
  get(): T;
}

interface IWritableConfigValue<T> extends IReadableConfigValue<T> {
  set(value: T): Promise<void>;
}

type Validator<T> = (value: any) => T | null;

/**
 * Provides type safe access to an underlying JSON file.
 *
 * Multiple FileConfigs for the same file shouldn't be used, as they risk going out of sync.
 */
class FileConfig<FileContents> {
  public static async create<CreateConfigFileContents>(
    configPath: string,
    validator: Validator<CreateConfigFileContents>
  ): Promise<FileConfig<CreateConfigFileContents> | null> {
    try {
      if (!await fse.pathExists(configPath)) {
        log.info(`Could not load config because ${configPath} missing`);
        return null;
      }

      // TODO - Typecheck this and return new file config
      return JSON.parse(await fse.readFile(configPath, 'utf8'));
    } catch(error) {
      log.error(`Could not load config due to error when loading from ${configPath}: ${error.message}`);
      return null;
    }
  }

  constructor(private _filePath: string, private _rawConfig: FileContents) {
  }

  public get<Key extends keyof FileContents>(key: Key): FileContents[Key] {
    return this._rawConfig[key];
  }

  public async set<Key extends keyof FileContents>(key: Key, value: FileContents[Key]) {
    this._rawConfig[key] = value;
    await this.persistToDisk();
  }

  public getReadableValue<Key extends keyof FileContents>(key: Key): IReadableConfigValue<FileContents[Key]> {
    return this.getWritableValue(key);
  }

  public getWritableValue<Key extends keyof FileContents>(key: Key): IWritableConfigValue<FileContents[Key]> {
    return  {
      get: () => this.get(key),
      set: async (value: FileContents[Key]) => {
        await this.set(key, value);
      }
    };
  }

  public async persistToDisk(): Promise<void> {
    await fse.writeFile(this._filePath, JSON.stringify(this._rawConfig, null, 2));
  }
}


async function createFileBackedConfig<FileContentsType, ConfigType>(
  configPath: string,
  validator: Validator<FileContentsType>,
  configConverter: (fileConfig: FileConfig<FileContentsType>) => ConfigType,
): Promise<ConfigType | null> {
  const fileConfig = await FileConfig.create<FileContentsType>(configPath, validator);
  // TODO - Catch errors and abort
  if (!fileConfig) {
    return null;
  }

  return configConverter(fileConfig);
}

async function loadGristCoreConfig(configPath: string): Promise<IGristCoreConfig | null> {
  return createFileBackedConfig(
    configPath,
    // TODO - Typecheck
    (obj) => obj as IGristCoreConfigFileContents,
    (fileConfig) => ({
      edition: fileConfig.getWritableValue('edition'),
    })
  );
}


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
