import * as fse from "fs-extra";

/**
 * Readonly config value - no write access.
 */
export interface IReadableConfigValue<T> {
  get(): T;
}

/**
 * Writeable config value. Write behaviour is asynchronous and defined by the implementation.
 */
export interface IWritableConfigValue<T> extends IReadableConfigValue<T> {
  set(value: T): Promise<void>;
}

type FileContentsValidator<T> = (value: any) => T | null;

export class MissingConfigFileError extends Error {
  public name: string = "MissingConfigFileError";

  constructor(message: string) {
    super(message);
  }
}

export class ConfigValidationError extends Error {
  public name: string = "ConfigValidationError";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Provides type safe access to an underlying JSON file.
 *
 * Multiple FileConfigs for the same file shouldn't be used, as they risk going out of sync.
 */
class FileConfig<FileContents> {
  /**
   * Creates a new type-safe FileConfig, by loading and checking the contents of the file with `validator`.
   * @param configPath - Path to load.
   * @param validator - Validates the contents are in the correct format, and converts to the correct type.
   *  Should throw an error or return null if not vallid.
   */
  public static async create<CreateConfigFileContents>(
    configPath: string,
    validator: FileContentsValidator<CreateConfigFileContents>
  ): Promise<FileConfig<CreateConfigFileContents>> {
    if (!await fse.pathExists(configPath)) {
      throw new MissingConfigFileError(`Could not load config because ${configPath} missing`);
    }

    const rawFileContents = JSON.parse(await fse.readFile(configPath, 'utf8'));
    const fileContents = validator(rawFileContents);

    if (!fileContents) {
      throw new ConfigValidationError(`Config at ${configPath} failed validation - check the format?`);
    }

    return new FileConfig<CreateConfigFileContents>(configPath, fileContents);
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

  public async persistToDisk(): Promise<void> {
    await fse.writeFile(this._filePath, JSON.stringify(this._rawConfig, null, 2));
  }
}

export function createFileConfigValue<FileContents, Key extends keyof FileContents>(
  fileConfig: FileConfig<FileContents>,
  key: Key,
): IWritableConfigValue<FileContents[Key]> {
  return {
    get: () => fileConfig.get(key),
    set: async (value: FileContents[Key]) => { return fileConfig.set(key, value); }
  };
}

export function createMemoryConfigValue<T>(initialValue: T): IWritableConfigValue<T> {
  let _value = initialValue;
  return {
    get: () => _value,
    set: async (newValue: T) => { _value = newValue; },
  };
}

export async function createFileBackedConfig<FileContentsType, ConfigType>(
  configPath: string,
  validator: FileContentsValidator<FileContentsType>,
  configConverter: (fileConfig: FileConfig<FileContentsType>) => ConfigType,
): Promise<ConfigType> {
  const fileConfig = await FileConfig.create<FileContentsType>(configPath, validator);
  return configConverter(fileConfig);
}
